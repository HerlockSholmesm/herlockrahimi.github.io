/* Shared behaviour: theme toggle, Google Scholar publication list, home-page news. */
(function () {
  "use strict";

  /* ---------- Theme toggle ---------- */
  var root = document.documentElement;
  function currentTheme() {
    return root.dataset.theme ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }
  document.querySelectorAll(".theme-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  });

  /* ---------- Helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function highlightMe(authors) {
    return authors.split(/,\s*/).map(function (name) {
      var safe = esc(name);
      return /\bHerlock\b|^H[A-Z]* Rahimi$/i.test(name.trim()) ? '<span class="me">' + safe + "</span>" : safe;
    }).join(", ");
  }
  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + ": " + r.status);
      return r.json();
    });
  }

  /* ---------- Publications ---------- */
  function mergeExtras(pubs, extras) {
    return pubs.map(function (p) {
      var x = (p.arxiv_id && extras[p.arxiv_id]) || extras[p.title] || {};
      var venue = x.venue || (/arxiv/i.test(p.venue) ? "Preprint" : p.venue);
      return Object.assign({}, p, {
        displayVenue: venue,
        isPreprint: !x.venue && /arxiv/i.test(p.venue),
        tags: x.tags || [],
        awards: x.awards || [],
        note: x.note || "",
        code: x.code, slides: x.slides
      });
    });
  }

  function pubHTML(p) {
    var title = p.url
      ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.title) + "</a>"
      : esc(p.title);
    var venue = "<em>" + esc(p.displayVenue) + "</em>";
    if (p.isPreprint && p.arxiv_id) venue += " · arXiv:" + esc(p.arxiv_id);
    if (p.year) venue += " · " + p.year;

    var badges = p.awards.map(function (a) { return '<span class="tag award">' + esc(a) + "</span>"; })
      .concat(p.tags.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }));

    var links = [];
    if (p.url) links.push('<a href="' + esc(p.url) + '" target="_blank" rel="noopener">arXiv</a>');
    if (p.pdf_url) links.push('<a href="' + esc(p.pdf_url) + '" target="_blank" rel="noopener">PDF</a>');
    if (p.code) links.push('<a href="' + esc(p.code) + '" target="_blank" rel="noopener">Code</a>');
    if (p.slides) links.push('<a href="' + esc(p.slides) + '" target="_blank" rel="noopener">Slides</a>');
    if (p.scholar_url) links.push('<a href="' + esc(p.scholar_url) + '" target="_blank" rel="noopener">Scholar</a>');

    return '<li class="pub">' +
      '<h3 class="pub-title">' + title + "</h3>" +
      '<p class="pub-authors">' + highlightMe(p.authors) + "</p>" +
      '<p class="pub-venue">' + venue + "</p>" +
      (p.note ? '<p class="pub-note">' + esc(p.note) + "</p>" : "") +
      (badges.length ? '<div class="pub-badges">' + badges.join("") + "</div>" : "") +
      '<div class="pub-links">' + links.join("") + "</div>" +
      "</li>";
  }

  function renderGrouped(el, pubs) {
    if (!pubs.length) { el.innerHTML = '<p class="empty">No publications match.</p>'; return; }
    var html = "", year = null;
    pubs.forEach(function (p) {
      if (p.year !== year) {
        if (year !== null) html += "</ul>";
        year = p.year;
        html += '<h2 class="pub-year">' + (year || "Other") + '</h2><ul class="pub-list">';
      }
      html += pubHTML(p);
    });
    el.innerHTML = html + "</ul>";
  }

  function loadPublications() {
    return Promise.all([
      getJSON("data/publications.json"),
      getJSON("data/publications-extra.json").catch(function () { return {}; })
    ]).then(function (r) {
      var data = r[0];
      var pubs = mergeExtras(data.publications || [], r[1]);
      pubs.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
      return { data: data, pubs: pubs };
    });
  }

  var full = document.getElementById("pub-root");
  if (full) {
    loadPublications().then(function (res) {
      var tagSet = {};
      res.pubs.forEach(function (p) { p.tags.forEach(function (t) { tagSet[t] = (tagSet[t] || 0) + 1; }); });
      var tags = Object.keys(tagSet).sort(function (a, b) { return tagSet[b] - tagSet[a] || a.localeCompare(b); });
      var chipsEl = document.getElementById("pub-chips");
      var activeTag = null;
      var search = document.getElementById("pub-search");

      function apply() {
        var q = (search && search.value || "").trim().toLowerCase();
        renderGrouped(full, res.pubs.filter(function (p) {
          if (activeTag && p.tags.indexOf(activeTag) < 0) return false;
          if (!q) return true;
          return (p.title + " " + p.authors + " " + p.displayVenue + " " + p.tags.join(" ") + " " + p.note)
            .toLowerCase().indexOf(q) >= 0;
        }));
      }

      if (chipsEl && tags.length) {
        chipsEl.innerHTML = ['<button class="chip" type="button" aria-pressed="true" data-tag="">All</button>']
          .concat(tags.map(function (t) {
            return '<button class="chip" type="button" aria-pressed="false" data-tag="' + esc(t) + '">' + esc(t) + "</button>";
          })).join("");
        chipsEl.addEventListener("click", function (e) {
          var b = e.target.closest(".chip");
          if (!b) return;
          activeTag = b.dataset.tag || null;
          chipsEl.querySelectorAll(".chip").forEach(function (c) {
            c.setAttribute("aria-pressed", String(c === b));
          });
          apply();
        });
      }
      if (search) search.addEventListener("input", apply);
      apply();
    }).catch(function (err) {
      console.error(err);
      full.innerHTML = '<p class="empty">Couldn’t load the publication list. See my ' +
        '<a href="https://scholar.google.com/citations?user=YnERbZYAAAAJ&hl=en">Google Scholar profile</a>.</p>';
    });
  }

  var recent = document.getElementById("recent-pubs");
  if (recent) {
    loadPublications().then(function (res) {
      var n = parseInt(recent.dataset.limit || "3", 10);
      recent.innerHTML = res.pubs.slice(0, n).map(pubHTML).join("");
    }).catch(function () {
      recent.innerHTML = '<li class="empty">See the <a href="publications.html">publications page</a>.</li>';
    });
  }

  /* ---------- Latest news on the home page (pulled from news.html) ---------- */
  var newsEl = document.getElementById("recent-news");
  if (newsEl) {
    fetch("news.html").then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var items = doc.querySelectorAll(".timeline > li");
      var n = parseInt(newsEl.dataset.limit || "4", 10);
      newsEl.innerHTML = Array.prototype.slice.call(items, 0, n)
        .map(function (li) { return li.outerHTML; }).join("");
    }).catch(function () {
      newsEl.innerHTML = '<li><span class="item"><a href="news.html">See all news</a></span></li>';
    });
  }
})();
