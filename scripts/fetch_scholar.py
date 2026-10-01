#!/usr/bin/env python3
"""Fetch publications from Google Scholar and write data/publications.json.

Run by .github/workflows/scholar.yml on a schedule; can also be run locally:

    pip install beautifulsoup4
    python scripts/fetch_scholar.py

Google Scholar has no official API and sometimes answers automated requests
with a CAPTCHA. When that happens the script falls back to SerpAPI if a
SERPAPI_KEY environment variable is set; otherwise it leaves the existing
data/publications.json untouched so the site never shows an empty list.

Full author lists come from the arXiv API (Scholar truncates long lists).
Hand-written highlights (venue, awards, notes) live in
data/publications-extra.json and are merged in by the page, not here.
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup

SCHOLAR_USER = os.environ.get("SCHOLAR_USER", "YnERbZYAAAAJ")
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "publications.json"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
ARXIV_RE = re.compile(r"arXiv:(\d{4}\.\d{4,5})", re.I)


def http_get(url: str) -> str:
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def scholar_url(path: str) -> str:
    return urllib.parse.urljoin("https://scholar.google.com", path)


def fetch_direct() -> dict:
    url = (
        "https://scholar.google.com/citations?hl=en&cstart=0&pagesize=100"
        f"&sortby=pubdate&user={SCHOLAR_USER}"
    )
    html = http_get(url)
    soup = BeautifulSoup(html, "html.parser")
    if soup.select_one("#gsc_prf_in") is None:
        raise RuntimeError("Scholar returned no profile (likely a CAPTCHA)")

    stats_cells = [td.get_text(strip=True) for td in soup.select("#gsc_rsb_st td.gsc_rsb_std")]
    stats = {}
    for i, key in enumerate(("citations", "h_index", "i10_index")):
        try:
            stats[key] = int(stats_cells[2 * i])
        except (IndexError, ValueError):
            stats[key] = 0

    pubs = []
    for row in soup.select("tr.gsc_a_tr"):
        title_a = row.select_one("a.gsc_a_at")
        if title_a is None:
            continue
        grays = row.select(".gs_gray")
        authors = grays[0].get_text(strip=True) if grays else ""
        venue = ""
        if len(grays) > 1:
            for span in grays[1].select(".gs_oph"):
                span.decompose()
            venue = grays[1].get_text(strip=True)
        cite_a = row.select_one("a.gsc_a_ac")
        cites_text = cite_a.get_text(strip=True) if cite_a else ""
        year_text = row.select_one(".gsc_a_y").get_text(strip=True) if row.select_one(".gsc_a_y") else ""
        pubs.append(
            {
                "title": title_a.get_text(strip=True),
                "authors": authors,
                "venue": venue,
                "year": int(year_text) if year_text.isdigit() else None,
                "citations": int(cites_text) if cites_text.isdigit() else 0,
                "cited_by_url": cite_a["href"] if cite_a and cite_a.get("href") else None,
                "scholar_url": scholar_url(title_a["href"]),
            }
        )
    return {"stats": stats, "publications": pubs}


def fetch_serpapi(key: str) -> dict:
    params = urllib.parse.urlencode(
        {"engine": "google_scholar_author", "author_id": SCHOLAR_USER,
         "hl": "en", "num": 100, "sort": "pubdate", "api_key": key}
    )
    data = json.loads(http_get(f"https://serpapi.com/search.json?{params}"))
    if "error" in data:
        raise RuntimeError(f"SerpAPI: {data['error']}")

    table = (data.get("cited_by") or {}).get("table") or []
    stats = {}
    for entry in table:
        for key_name, out_key in (("citations", "citations"), ("h_index", "h_index"), ("i10_index", "i10_index")):
            if key_name in entry:
                stats[out_key] = entry[key_name].get("all", 0)

    pubs = []
    for art in data.get("articles", []):
        cited = art.get("cited_by") or {}
        year = str(art.get("year") or "")
        pubs.append(
            {
                "title": art.get("title", ""),
                "authors": art.get("authors", ""),
                "venue": re.sub(r",\s*\d{4}$", "", art.get("publication", "")),
                "year": int(year) if year.isdigit() else None,
                "citations": cited.get("value") or 0,
                "cited_by_url": cited.get("link"),
                "scholar_url": art.get("link"),
            }
        )
    return {"stats": stats, "publications": pubs}


def enrich_from_arxiv(pubs: list) -> None:
    """Add arxiv_id, full author list and abstract URL where an arXiv ID is known."""
    ids = {}
    for pub in pubs:
        m = ARXIV_RE.search(pub["venue"])
        if m:
            pub["arxiv_id"] = m.group(1)
            pub["url"] = f"https://arxiv.org/abs/{m.group(1)}"
            pub["pdf_url"] = f"https://arxiv.org/pdf/{m.group(1)}"
            ids[m.group(1)] = pub
    if not ids:
        return
    try:
        xml = http_get(
            "https://export.arxiv.org/api/query?max_results=100&id_list=" + ",".join(ids)
        )
    except Exception as exc:  # arXiv is a nice-to-have; keep Scholar's authors
        print(f"::warning::arXiv lookup failed: {exc}")
        return
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for entry in ET.fromstring(xml).findall("a:entry", ns):
        entry_id = entry.findtext("a:id", default="", namespaces=ns)
        m = re.search(r"abs/(\d{4}\.\d{4,5})", entry_id)
        if not m or m.group(1) not in ids:
            continue
        names = [n.findtext("a:name", default="", namespaces=ns).strip()
                 for n in entry.findall("a:author", ns)]
        if names:
            ids[m.group(1)]["authors"] = ", ".join(merge_split_names(names))


def merge_split_names(names: list) -> list:
    """arXiv sometimes splits one person into two single-word authors
    (e.g. "Herlock", "Rahimi"); glue consecutive one-word entries together."""
    merged = []
    for name in names:
        if merged and " " not in name and " " not in merged[-1]:
            merged[-1] = f"{merged[-1]} {name}"
        else:
            merged.append(name)
    return merged


def main() -> int:
    try:
        result = fetch_direct()
        source = "scholar"
    except Exception as exc:
        print(f"Direct Scholar fetch failed: {exc}")
        key = os.environ.get("SERPAPI_KEY")
        if not key:
            print("::warning::Scholar blocked the request and no SERPAPI_KEY is set; "
                  "keeping the existing data/publications.json.")
            return 0
        result = fetch_serpapi(key)
        source = "serpapi"

    if not result["publications"]:
        print("::warning::No publications parsed; keeping the existing file.")
        return 0

    time.sleep(1)
    enrich_from_arxiv(result["publications"])

    payload = {
        "scholar_user": SCHOLAR_USER,
        "profile_url": f"https://scholar.google.com/citations?user={SCHOLAR_USER}&hl=en",
        "source": source,
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        **result,
    }

    # Skip the write when only the timestamp would change, so the workflow
    # doesn't create a commit every week for nothing.
    if OUT.exists():
        old = json.loads(OUT.read_text())
        if {k: v for k, v in old.items() if k not in ("updated", "source")} == \
           {k: v for k, v in payload.items() if k not in ("updated", "source")}:
            print("No changes.")
            return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {len(payload['publications'])} publications to {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
