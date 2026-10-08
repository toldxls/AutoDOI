// The service worker (sw.js) run in a vm context against an in-memory CacheStorage, a scripted fetch and a fake
// clients list: install caches the page, activate drops the old autodoi-* caches, navigations are network first
// with the cached index.html when offline, data/ files are cache first and refreshed behind, the pinned engine,
// styles and locales are cache first, and the lookups (Crossref and the rest) are never intercepted.
// Usage: node tests/sw.test.js
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.resolve(__dirname, '..');
var SW_URL = 'https://toldxls.github.io/AutoDOI/sw.js', ORIGIN = 'https://toldxls.github.io', BASE = 'https://toldxls.github.io/AutoDOI/';
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + String(detail).slice(0, 300) : '')); } }

// --- the fakes: Request, Response, CacheStorage, fetch, clients ---
function Req(url, opts) { opts = opts || {}; return { url: url, method: opts.method || 'GET', mode: opts.mode || 'cors', headers: opts.headers || {}, clone: function () { return Req(url, opts); } }; }
function Res(status, body, type) { type = type || 'text/html'; return { status: status, ok: status >= 200 && status < 300, body: body, type: type, headers: { get: function (k) { return k.toLowerCase() === 'content-type' ? type : null; } }, clone: function () { return Res(status, body, type); }, text: function () { return Promise.resolve(body); } }; }
function key(req) { return new URL(typeof req === 'string' ? req : req.url, SW_URL).href; } // a relative string resolves against the worker's URL, as the real CacheStorage does
var store = {}; // cache name -> { url -> Response }
function Cache(name) {
  var m = store[name];
  return {
    match: function (req) { return Promise.resolve(m[key(req)] ? m[key(req)].clone() : undefined); },
    put: function (req, res) { m[key(req)] = res; return Promise.resolve(); },
    addAll: function (list) { return Promise.all(list.map(function (u) { return fetchStub(Req(key(u))).then(function (res) { if (!res.ok) throw new Error('addAll: ' + u + ' ' + res.status); m[key(u)] = res; }); })); },
    keys: function () { return Promise.resolve(Object.keys(m)); }
  };
}
var caches = {
  open: function (name) { store[name] = store[name] || {}; return Promise.resolve(Cache(name)); },
  keys: function () { return Promise.resolve(Object.keys(store)); },
  delete: function (name) { var had = !!store[name]; delete store[name]; return Promise.resolve(had); },
  match: function (req) { var names = Object.keys(store); for (var i = 0; i < names.length; i++) { var hit = store[names[i]][key(req)]; if (hit) return Promise.resolve(hit.clone()); } return Promise.resolve(undefined); }
};
var fetched = [], net = function () { return Promise.resolve(Res(200, 'page')); }; // the scripted network: each test sets it
function fetchStub(req) { fetched.push(typeof req === 'string' ? req : req.url); return net(typeof req === 'string' ? Req(req) : req); }
var handlers = {}, claimed = 0, skipped = 0;
var self = {
  addEventListener: function (type, fn) { handlers[type] = fn; },
  skipWaiting: function () { skipped++; return Promise.resolve(); },
  clients: { claim: function () { claimed++; return Promise.resolve(); } },
  location: { href: SW_URL, origin: ORIGIN }
};
var ctx = { self: self, caches: caches, fetch: fetchStub, URL: URL, Promise: Promise, console: console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ctx, { filename: 'sw.js' });
var VERSION = (fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/var VERSION = '([^']+)'/) || [])[1], CACHE = 'autodoi-' + VERSION;
check('sw.js registers install, activate and fetch handlers', typeof handlers.install === 'function' && typeof handlers.activate === 'function' && typeof handlers.fetch === 'function', Object.keys(handlers).join(','));

function settle() { return new Promise(function (r) { setImmediate(r); }).then(function () { return new Promise(function (r) { setImmediate(r); }); }); } // the cache writes behind a response
function fire(type, request) { // dispatch an event and give back what the worker did with it
  var ev = { request: request, responded: false, promise: undefined, waited: Promise.resolve(),
    respondWith: function (p) { ev.responded = true; ev.promise = Promise.resolve(p); },
    waitUntil: function (p) { ev.waited = Promise.all([ev.waited, p]); } }; // every cache write behind a response is awaited together
  handlers[type](ev);
  return ev;
}
function cached(url) { var c = store[CACHE] || {}; return c[key(url)]; }

(async function () {
  // install: the page and its shell are cached, and the new worker takes over at once
  net = function (req) { return Promise.resolve(Res(200, 'body of ' + req.url)); };
  var inst = fire('install'); await inst.waited;
  var PAGE = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
  check('install caches every PAGE entry in ' + CACHE, PAGE.every(function (u) { return !!cached(u); }), Object.keys(store[CACHE] || {}).join(' '));
  check('install fetched exactly the PAGE entries', fetched.length === PAGE.length && PAGE.every(function (u) { return fetched.indexOf(key(u)) !== -1; }), fetched.join(' '));
  check('install calls skipWaiting', skipped === 1);
  check('install waits for the cache before skipWaiting (a 404 shell must fail the install)', await (async function () { // a missing shell file rejects the install
    store = {}; net = function (req) { return Promise.resolve(Res(/icon\.svg$/.test(req.url) ? 404 : 200, 'x')); };
    var ev = fire('install'); try { await ev.waited; return false; } catch (e) { return true; }
  })());
  store = {}; fetched = []; net = function (req) { return Promise.resolve(Res(200, 'body of ' + req.url)); }; await fire('install').waited;

  // activate: every other autodoi-* cache goes, anything else stays, and open pages are claimed
  store['autodoi-0.0.1'] = { x: Res(200, 'old') }; store['autodoi-0.9.9'] = {}; store['not-ours'] = {};
  var act = fire('activate'); await act.waited;
  check('activate deletes the other autodoi-* caches', !store['autodoi-0.0.1'] && !store['autodoi-0.9.9'], Object.keys(store).join(','));
  check('activate keeps the current cache and caches that are not ours', !!store[CACHE] && !!store['not-ours'], Object.keys(store).join(','));
  check('activate claims the clients', claimed === 1);
  delete store['not-ours'];

  // navigation: network first, and the fresh page replaces the offline copy
  fetched = []; net = function () { return Promise.resolve(Res(200, 'fresh page')); };
  var nav = fire('fetch', Req(BASE, { mode: 'navigate' }));
  check('a navigation is intercepted', nav.responded);
  var res = await nav.promise; await settle();
  check('a navigation returns the network response', res && res.body === 'fresh page', JSON.stringify(res));
  check('a navigation stores the fresh page as index.html', cached('./index.html') && cached('./index.html').body === 'fresh page', JSON.stringify(cached('./index.html')));
  // a 500 from the server must not become the offline copy
  net = function () { return Promise.resolve(Res(500, 'server error')); };
  res = await fire('fetch', Req(BASE, { mode: 'navigate' })).promise; await settle();
  check('a 500 on navigation is passed through', res && res.status === 500, JSON.stringify(res));
  check('a 500 on navigation is not stored', cached('./index.html').body === 'fresh page', cached('./index.html').body);
  net = function () { return Promise.resolve(Res(404, 'not found')); };
  res = await fire('fetch', Req(BASE + 'index.html', { mode: 'navigate' })).promise; await settle();
  check('a 404 on navigation is not stored', cached('./index.html').body === 'fresh page', cached('./index.html').body);
  // offline: the cached page
  net = function () { return Promise.reject(new TypeError('Failed to fetch')); };
  res = await fire('fetch', Req(BASE, { mode: 'navigate' })).promise;
  check('a failed navigation returns the cached index.html', res && res.body === 'fresh page', JSON.stringify(res));
  res = await fire('fetch', Req(BASE + 'index.html', { mode: 'no-cors' })).promise;
  check('a same-origin request for index.html without navigate mode also falls back to the cache', res && res.body === 'fresh page', JSON.stringify(res));
  // only the page's own path, answered as HTML, may become the offline copy: another document on the origin or a non-HTML answer must not
  net = function () { return Promise.resolve(Res(200, '# AutoDOI readme', 'text/markdown')); };
  var md = fire('fetch', Req(BASE + 'README.md', { mode: 'navigate' })); res = await md.promise; await md.waited; await settle();
  check('navigating to README.md is answered from the network', res && res.body === '# AutoDOI readme', JSON.stringify(res));
  check('navigating to README.md must not replace the offline page', cached('./index.html').body === 'fresh page', 'index.html in cache is now: ' + cached('./index.html').body);
  net = function () { return Promise.resolve(Res(200, 'PK...', 'application/octet-stream')); };
  var bin = fire('fetch', Req(BASE, { mode: 'navigate' })); res = await bin.promise; await bin.waited; await settle();
  check('a non-HTML answer on the page path is passed through', res && res.body === 'PK...', JSON.stringify(res));
  check('a non-HTML answer on the page path must not replace the offline page', cached('./index.html').body === 'fresh page', 'index.html in cache is now: ' + cached('./index.html').body);
  net = function () { return Promise.resolve(Res(200, 'newer page', 'text/html; charset=utf-8')); };
  var pg = fire('fetch', Req(BASE + 'index.html?refs=10.1/x', { mode: 'navigate' })); res = await pg.promise; await pg.waited;
  check('the page with a query string, as HTML, is stored and its write is under waitUntil', cached('./index.html').body === 'newer page', cached('./index.html').body);
  store[CACHE][key('./index.html')] = Res(200, 'fresh page'); // as the tests below expect

  // data/ files: the cached copy now, a fresh copy stored for next time
  var dataUrl = BASE + 'data/styles-index.json';
  store[CACHE][key(dataUrl)] = Res(200, 'old index', 'application/json');
  fetched = []; net = function () { return Promise.resolve(Res(200, 'new index', 'application/json')); };
  var dat = fire('fetch', Req(dataUrl));
  check('a data/ request is intercepted', dat.responded);
  res = await dat.promise; await settle(); await dat.waited;
  check('a data/ request is served from the cache', res && res.body === 'old index', JSON.stringify(res));
  check('a data/ request is refreshed behind, under waitUntil', fetched.length === 1 && cached(dataUrl).body === 'new index', fetched.join(' ') + ' | ' + JSON.stringify(cached(dataUrl)));
  // a cache that refuses the write (quota) must not break the response
  var realPut = store[CACHE] && Cache(CACHE).put; var brokenCache = Cache(CACHE); brokenCache.put = function () { return Promise.reject(new DOMException('full', 'QuotaExceededError')); };
  var openOrig = caches.open; caches.open = function () { return Promise.resolve(brokenCache); };
  var full = fire('fetch', Req(dataUrl)); res = await full.promise; var waitedOk = await full.waited.then(function () { return true; }, function () { return false; });
  check('a failed cache write behind a data/ response is swallowed', res && res.body === 'new index' && waitedOk, JSON.stringify(res) + ' waited ok: ' + waitedOk);
  caches.open = openOrig; void realPut;
  net = function () { return Promise.resolve(Res(500, 'oops', 'application/json')); };
  res = await fire('fetch', Req(dataUrl)).promise; await settle();
  check('a failed refresh does not overwrite the cached data/ file', cached(dataUrl).body === 'new index', cached(dataUrl).body);
  delete store[CACHE][key(dataUrl)]; net = function () { return Promise.resolve(Res(200, 'first index', 'application/json')); };
  res = await fire('fetch', Req(dataUrl)).promise; await settle();
  check('an uncached data/ request goes to the network and is stored', res && res.body === 'first index' && cached(dataUrl).body === 'first index', JSON.stringify(res));
  net = function () { return Promise.reject(new TypeError('offline')); }; delete store[CACHE][key(dataUrl)];
  res = await fire('fetch', Req(dataUrl)).promise.catch(function (e) { return { error: e.message }; });
  check('an uncached data/ request offline does not return a cache miss as a response', !res || res.error || res.status, JSON.stringify(res)); // undefined or a rejection: the page sees a failed fetch

  // pinned engine, styles and locales: cache first, the network once
  var PINNED = ['https://cdn.jsdelivr.net/npm/citeproc@2.4.63/citeproc_commonjs.js', 'https://raw.githubusercontent.com/citation-style-language/styles/' + 'a'.repeat(40) + '/nature.csl', 'https://raw.githubusercontent.com/citation-style-language/locales/' + 'b'.repeat(40) + '/locales-en-US.xml'];
  for (var i = 0; i < PINNED.length; i++) {
    fetched = []; net = function (req) { return Promise.resolve(Res(200, 'net ' + req.url)); };
    var pin = fire('fetch', Req(PINNED[i]));
    check('a pinned URL is intercepted: ' + PINNED[i].slice(8, 40), pin.responded);
    res = await pin.promise; await settle();
    check('an uncached pinned URL is fetched and stored', res && res.body === 'net ' + PINNED[i] && cached(PINNED[i]) && cached(PINNED[i]).body === 'net ' + PINNED[i], JSON.stringify(res));
    fetched = [];
    res = await fire('fetch', Req(PINNED[i])).promise; await settle();
    check('a cached pinned URL is served without touching the network', res && res.body === 'net ' + PINNED[i] && fetched.length === 0, fetched.join(' '));
  }
  net = function () { return Promise.resolve(Res(500, 'cdn down')); }; var cdn = 'https://cdn.jsdelivr.net/npm/citeproc@2.4.63/other.js';
  res = await fire('fetch', Req(cdn)).promise; await settle();
  check('a failed pinned fetch is passed through and not stored', res && res.status === 500 && !cached(cdn), JSON.stringify(res));
  check('a styles URL on master (not a commit) is not pinned', !fire('fetch', Req('https://raw.githubusercontent.com/citation-style-language/styles/master/nature.csl')).responded);
  check('the icon and manifest are cache first too', fire('fetch', Req(BASE + 'icon.svg')).responded && fire('fetch', Req(BASE + 'manifest.webmanifest')).responded);

  // the lookups go straight to the network
  var LOOKUPS = ['https://api.crossref.org/works/10.1038%2Fnature12373', 'https://api.crossref.org/works?rows=3&query.bibliographic=x', 'https://doi.org/10.1038/nature12373', 'https://api.openalex.org/works?search=x', 'https://api.unpaywall.org/v2/10.1038/nature12373?email=x', 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=x', 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=nlmcatalog', 'https://openlibrary.org/isbn/9780262035613.json', 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_general.csv', 'https://www.zotero.org/styles-files/styles.json'];
  LOOKUPS.forEach(function (u) { check('not intercepted: ' + u.slice(8, 60), !fire('fetch', Req(u)).responded); });
  check('a POST is not intercepted even to the page', !fire('fetch', Req(BASE, { method: 'POST', mode: 'navigate' })).responded);
  check('a same-origin request outside the page, data/ and pinned sets is not intercepted', !fire('fetch', Req(BASE + 'CHANGELOG.md')).responded);

  console.log(passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
})().catch(function (e) { console.log('FAIL sw.test.js threw: ' + e.stack); console.log(passed + ' passed, ' + (failed + 1) + ' failed'); process.exitCode = 1; });
