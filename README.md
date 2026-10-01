# herlockrahimi.github.io

Personal academic site — plain HTML/CSS/JS served by GitHub Pages.

| Page | File |
| --- | --- |
| About (home) | `index.html` (`bio.html` redirects here) |
| Publications | `publications.html` — rendered from `data/publications.json` |
| News | `news.html` — the home page shows the first 4 items automatically |
| Teaching & Service | `service.html` |

## Publications are synced from Google Scholar

`.github/workflows/scholar.yml` runs every Monday (or on demand from the
**Actions → Update publications from Google Scholar → Run workflow** button).
It runs `scripts/fetch_scholar.py`, which reads the Scholar profile
`YnERbZYAAAAJ`, fills in full author lists from arXiv, and commits
`data/publications.json` if anything changed.

To add highlights a paper's Scholar entry lacks (published venue, awards,
topic tags, a one-line summary, code/slides links), edit
`data/publications-extra.json`, keyed by arXiv ID.

Google Scholar occasionally blocks requests from GitHub's servers. If the
workflow logs a warning about that, add a free [SerpAPI](https://serpapi.com)
key as a repository secret named `SERPAPI_KEY` and it will be used as a fallback.

## Preview locally

    python3 -m http.server 8000   # then open http://localhost:8000
