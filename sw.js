/* AutoDOI service worker: the page, its data files and the pinned citation engine, styles and locales are kept for offline use.
 * The page itself is fetched from the network first so an update arrives as soon as it is deployed; the data files are served
 * from the cache and refreshed behind; the engine, styles and locales are pinned to commits, so once cached they never change.
 * Lookups (Crossref, doi.org, OpenAlex and the rest) always go to the network and are never cached. */
var VERSION = '1.13.0'; // keep in step with APP_VERSION (tests/syntax.test.js checks)
var CACHE = 'autodoi-' + VERSION;
var PAGE = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
var PINNED = /^https:\/\/(?:cdn\.jsdelivr\.net\/npm\/citeproc@|raw\.githubusercontent\.com\/citation-style-language\/(?:styles|locales)\/[0-9a-f]{40}\/)/;

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(PAGE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k.indexOf('autodoi-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (ev) {
  var req = ev.request; if (req.method !== 'GET') return;
  var url = new URL(req.url), same = url.origin === self.location.origin;
  if (req.mode === 'navigate' || (same && /\/(?:index\.html)?$/.test(url.pathname))) { // the page: network first, the cached copy when offline
    ev.respondWith(fetch(req).then(function (res) { if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { return c.put('./index.html', copy); }).catch(function () {}); } return res; }) // a 404 or a 5xx must not become the offline copy
      .catch(function () { return caches.match('./index.html'); }));
    return;
  }
  if (same && /\/data\//.test(url.pathname)) { // style index, EndNote shortlist, word list: cached copy now, fresh copy for next time
    ev.respondWith(caches.open(CACHE).then(function (c) { return c.match(req).then(function (hit) {
      var refresh = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
      return hit || refresh;
    }); }));
    return;
  }
  if (PINNED.test(req.url) || (same && /\.(?:svg|webmanifest)$/.test(url.pathname))) { // pinned by commit or version: cache first
    ev.respondWith(caches.open(CACHE).then(function (c) { return c.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }); }); }));
  }
  // anything else (the lookups) goes straight to the network
});
