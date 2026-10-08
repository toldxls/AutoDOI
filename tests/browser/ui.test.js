// Drives the built page in headless Chromium with every external API mocked, so it runs offline and gives
// the same answer every time.  Covers the three tabs, deep links, a lookup, single-style mode and copy,
// the DOI finder, reference matching, RIS and BibTeX file import, a journal style rendered through
// citeproc, the error path with its bug-report link, and axe accessibility checks on each tab with
// content, in light and dark mode.
//
// The citation engine, one style and the locale are the only things fetched from the network, once,
// into tests/browser/cache/ (gitignored); after that the suite is fully offline.  Without them the CSL
// checks are skipped (and fail under CI=1, where the network is expected to work).
// Usage: npm install && npx playwright install chromium && node tests/browser/ui.test.js
var http = require('http'), fs = require('fs'), path = require('path');
var { chromium } = require('playwright');
var { AxeBuilder } = require('@axe-core/playwright');

var ROOT = path.join(__dirname, '..', '..');
var OUT = path.join(__dirname, 'out');     // screenshot on an unexpected exception (gitignored)
var CACHE = path.join(__dirname, 'cache'); // citeproc, nature.csl, locale (gitignored)
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var work = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'w.json'), 'utf8')); // Crossref record for 10.1038/nature12373
// A retracted paper as Crossref returns it (the Wakefield 1998 Lancet article): a title prefix and two Retraction Watch notices
var retracted = JSON.parse(JSON.stringify(work)); retracted.message.DOI = '10.1016/s0140-6736(97)11096-0'; retracted.message.URL = 'https://doi.org/10.1016/s0140-6736(97)11096-0';
retracted.message.title = ['RETRACTED: Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children'];
retracted.message.author = [{ given: 'A. J.', family: 'Wakefield' }, { given: 'S. H.', family: 'Murch' }]; retracted.message['container-title'] = ['The Lancet']; retracted.message.volume = '351'; retracted.message.issue = '9103'; retracted.message.page = '637-641';
retracted.message.issued = { 'date-parts': [[1998, 2]] }; retracted.message['published-print'] = { 'date-parts': [[1998, 2]] }; delete retracted.message['published-online'];
retracted.message['updated-by'] = [
  { DOI: '10.1016/s0140-6736(04)15715-2', type: 'correction', label: 'Correction', source: 'retraction-watch', updated: { 'date-parts': [[2004, 3, 6]] } },
  { DOI: '10.1016/s0140-6736(10)60175-4', type: 'retraction', label: 'Retraction', source: 'retraction-watch', updated: { 'date-parts': [[2010, 2, 6]] } }];
delete retracted.message.ISSN; delete retracted.message['short-container-title']; // so its journal abbreviation is looked up by title, the path the NLM mock below answers
// The arXiv preprint of a paper, as Crossref deposits posted content: its relation names the published version
var preprint = { status: 'ok', 'message-type': 'work', message: { DOI: '10.48550/arXiv.1706.03762', URL: 'https://doi.org/10.48550/arXiv.1706.03762', type: 'posted-content', subtype: 'preprint', title: ['Attention is all you need'],
  author: [{ given: 'Ashish', family: 'Vaswani' }, { given: 'Noam', family: 'Shazeer' }], issued: { 'date-parts': [[2017, 6, 12]] }, 'group-title': 'Computer Science', institution: [{ name: 'arXiv' }], publisher: 'arXiv',
  relation: { 'is-preprint-of': [{ 'id-type': 'doi', id: '10.1038/nature12373', 'asserted-by': 'subject' }] } } };
var pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
var versionInUrl = new RegExp('AutoDOI%20' + pkgVersion.replace(/\./g, '\\.'));
var passed = 0, failed = 0, skipped = [];
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++; console.log('FAIL ' + name + (detail ? '\n     ' + String(detail).slice(0, 400) : ''));
}

// --- the page's own pins, so the cached files match what the page asks for ---
var CITEPROC_URL = (html.match(/var CITEPROC = '([^']+)'/) || [])[1];
var STYLES_SHA = (html.match(/CSL_STYLES_COMMIT = '([0-9a-f]{40})'/) || [])[1];
var LOCALES_SHA = (html.match(/CSL_LOCALES_COMMIT = '([0-9a-f]{40})'/) || [])[1];
var STYLE_URL = 'https://raw.githubusercontent.com/citation-style-language/styles/' + STYLES_SHA + '/nature.csl';
var LOCALE_URL = 'https://raw.githubusercontent.com/citation-style-language/locales/' + LOCALES_SHA + '/locales-en-US.xml';
var DEP_STYLE_URL = 'https://raw.githubusercontent.com/citation-style-language/styles/' + STYLES_SHA + '/dependent/nature-geoscience.csl'; // dependent style: rendered with nature.csl as parent
var HARVARD_URL = 'https://raw.githubusercontent.com/citation-style-language/styles/' + STYLES_SHA + '/harvard-cite-them-right.csl'; // a style whose terms ("pp.", "Available at") show the locale
var LOCALE_DE_URL = 'https://raw.githubusercontent.com/citation-style-language/locales/' + LOCALES_SHA + '/locales-de-DE.xml';
var upstream = {}; // url -> body
async function loadUpstream() {
  var want = { citeproc: CITEPROC_URL, style: STYLE_URL, dependent: DEP_STYLE_URL, locale: LOCALE_URL, harvard: HARVARD_URL, localede: LOCALE_DE_URL };
  fs.mkdirSync(CACHE, { recursive: true });
  for (var k in want) {
    var url = want[k], f = path.join(CACHE, k + '-' + url.split('/').slice(-2).join('_').replace(/[^\w.-]/g, '_'));
    if (!fs.existsSync(f)) {
      try { var res = await fetch(url); if (!res.ok) throw new Error(res.status); fs.writeFileSync(f, Buffer.from(await res.arrayBuffer())); }
      catch (e) { console.log('note: could not fetch ' + url + ' (' + e.message + '); CSL checks will be skipped'); return false; }
    }
    upstream[url] = fs.readFileSync(f);
  }
  return true;
}

// --- a static server for the repository root, so data/ loads like it does on GitHub Pages ---
var TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise(function (resolve) {
    var srv = http.createServer(function (req, res) {
      var p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      var f = path.join(ROOT, p);
      if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', function () { resolve({ srv: srv, base: 'http://127.0.0.1:' + srv.address().port + '/' }); });
  });
}

// --- network mocks: only the local server is real ---
function json(route, body, status) { return route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) }); }
async function mockNetwork(page, base, log) {
  var tooMany = 0; // Crossref's 429s for the retry probe, counted per page
  await page.route('**/*', function (route) {
    var url = route.request().url();
    log.push(url);
    if (url.indexOf(base) === 0) return route.continue();
    if (/api\.crossref\.org\/works\/10\.5555%2Flong-/.test(url)) { // a long DOI of its own: the Copy-link cap
      var longDoi = decodeURIComponent(url.match(/works\/(.+?)(\?|$)/)[1]), lw = JSON.parse(JSON.stringify(work.message)); lw.DOI = longDoi; lw.URL = 'https://doi.org/' + longDoi; lw.title = ['Paper ' + longDoi.slice(-2)];
      return json(route, { status: 'ok', 'message-type': 'work', message: lw });
    }
    if (/api\.crossref\.org\/works\/10\.1016%2Ferratum-x/.test(url)) { // an erratum's DOI pasted after the paper it corrects
      var er = JSON.parse(JSON.stringify(work.message)); er.DOI = '10.1016/erratum-x'; er.URL = 'https://doi.org/10.1016/erratum-x'; er.title = ['Erratum: Nanometre-scale thermometry in a living cell']; er.volume = '507'; er.issue = '7491'; er.page = '258'; er.issued = { 'date-parts': [[2014, 3]] }; er['published-print'] = { 'date-parts': [[2014, 3]] }; delete er['published-online'];
      return json(route, { status: 'ok', 'message-type': 'work', message: er });
    }
    if (/api\.crossref\.org\/works\?.*query\.bibliographic=Retry%20probe/.test(url) && tooMany++ < 2) return route.fulfill({ status: 429, headers: { 'Retry-After': '1', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Retry-After' }, contentType: 'text/plain', body: 'Too Many Requests' });
    if (/api\.crossref\.org\/works\?.*query\.bibliographic=Slow%20probe/.test(url)) { setTimeout(function () { json(route, { status: 'ok', 'message-type': 'work-list', message: { items: [work.message], 'total-results': 1 } }).catch(function () {}); }, 4000); return; } // 4 s each: a batch to abandon
    if (/api\.crossref\.org\/works\?.*query\.bibliographic=Dataset%20first/.test(url)) { // Dryad's "Data from:" record listed before the paper
      var ds = JSON.parse(JSON.stringify(work.message)); ds.DOI = '10.5061/dryad.x1'; ds.URL = 'https://doi.org/10.5061/dryad.x1'; ds.type = 'dataset'; ds.title = ['Data from: Nanometre-scale thermometry in a living cell']; ds.publisher = 'Dryad'; delete ds['container-title'];
      return json(route, { status: 'ok', 'message-type': 'work-list', message: { items: [ds, work.message], 'total-results': 2 } });
    }
    if (/api\.crossref\.org\/works\?.*query\.bibliographic=Chapter%20probe/.test(url)) { // an edited book listed before the chapter in it that the reference cites by its pages
      var bk = JSON.parse(JSON.stringify(work.message)); bk.DOI = '10.1515/9781501508998'; bk.URL = 'https://doi.org/10.1515/9781501508998'; bk.type = 'edited-book'; bk.title = ['Hydrous Phyllosilicates']; bk.subtitle = ['(Exclusive of Micas)']; bk.publisher = 'De Gruyter';
      bk.editor = [{ family: 'Bailey', given: 'S. W.' }]; delete bk.author; delete bk['container-title']; delete bk.volume; delete bk.issue; delete bk.page; bk.issued = { 'date-parts': [[1988]] }; bk['published-print'] = { 'date-parts': [[1988]] }; delete bk['published-online'];
      var chp = JSON.parse(JSON.stringify(bk)); chp.DOI = '10.1515/9781501508998-015'; chp.URL = 'https://doi.org/10.1515/9781501508998-015'; chp.type = 'book-chapter'; chp.title = ['Chapter 10. CHLORITES: STRUCTURES AND CRYSTAL CHEMISTRY']; delete chp.subtitle;
      chp.author = [{ family: 'Bailey', given: 'S. W.' }]; delete chp.editor; chp['container-title'] = ['Hydrous Phyllosilicates']; chp.page = '347-403';
      return json(route, { status: 'ok', 'message-type': 'work-list', message: { items: [bk, chp], 'total-results': 2 } });
    }
    if (/api\.crossref\.org\/works\?.*query\.bibliographic=(Merged|Pause|Quota)%20probe/.test(url)) return json(route, { status: 'ok', 'message-type': 'work-list', message: { items: [], 'total-results': 0 } });
    if (/api\.openalex\.org\/works\?.*search=Merged%20probe/.test(url)) return json(route, { results: [{ // an OpenAlex work merged under the sample paper's DOI: Crossref's record for it is another paper
      id: 'https://openalex.org/W2', doi: 'https://doi.org/' + work.message.DOI, title: 'Olivine rheology under lower mantle conditions', display_name: 'Olivine rheology under lower mantle conditions',
      authorships: [{ author: { display_name: 'Tom Brown' } }], publication_year: 2018, publication_date: '2018-01-01', biblio: { volume: '3', first_page: '5', last_page: '6' }, primary_location: { source: { display_name: 'Science', type: 'journal' } }, type: 'article', is_retracted: false }] });
    if (/api\.openalex\.org\/works\?.*search=Pause%20probe/.test(url)) return route.fulfill({ status: 429, headers: { 'Retry-After': '1', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Retry-After' }, contentType: 'application/json', body: '{"error":"Too Many Requests"}' });
    if (/api\.openalex\.org\/works\?.*search=Quota%20probe/.test(url)) return route.fulfill({ status: 429, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: '{"error":"Daily limit exceeded: your network has used its free daily allowance"}' });
    if (/fonts\.googleapis\.com/.test(url)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (upstream[url]) return route.fulfill({ status: 200, contentType: /\.js$/.test(url) ? 'application/javascript' : 'text/plain; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: upstream[url] });
    var m = url.match(/api\.crossref\.org\/works\/(.+?)(\?|$)/);
    if (m) {
      var doi = decodeURIComponent(m[1]);
      if (doi.toLowerCase() === retracted.message.DOI) return json(route, retracted);
      if (doi.toLowerCase() === preprint.message.DOI.toLowerCase()) return json(route, preprint);
      return doi.toLowerCase() === work.message.DOI.toLowerCase() ? json(route, work) : json(route, { status: 'error', message: 'Resource not found.' }, 404);
    }
    if (/api\.crossref\.org\/works\?.*Wakefield/i.test(url)) return json(route, { status: 'ok', 'message-type': 'work-list', message: { items: [retracted.message], 'total-results': 1 } });
    if (/api\.crossref\.org\/works\?.*query\.bibliographic=Learning(&|$)/.test(url)) { // a paper titled only "Learning" in Memory and Cognition: the split a one-word head guesses
      var one = JSON.parse(JSON.stringify(work.message)); one.DOI = '10.3758/learning-one-word'; one.URL = 'https://doi.org/10.3758/learning-one-word'; one.title = ['Learning']; one['container-title'] = ['Memory and Cognition'];
      return json(route, { status: 'ok', 'message-type': 'work-list', message: { items: [one], 'total-results': 1 } });
    }
    if (/api\.crossref\.org\/works\?/.test(url)) { // a twin with the same title and another DOI: the runner-up the row offers
      var twin = JSON.parse(JSON.stringify(work.message)); twin.DOI = '10.1038/nature12373-twin'; twin.title = [twin.title[0] + ' (II)']; twin.URL = 'https://doi.org/10.1038/nature12373-twin';
      return json(route, { status: 'ok', 'message-type': 'work-list', message: { items: [work.message, twin], 'total-results': 2 } });
    }
    if (/doi\.org\//.test(url)) return route.fulfill({ status: 404, contentType: 'text/html', body: 'DOI not found' });
    var up = url.match(/api\.unpaywall\.org\/v2\/(.+?)\?email=/); // as Unpaywall really answers for the sample paper: a stale unlicensed publisher copy first, a PubMed Central copy after it
    if (up) {
      var bronze = { url: 'https://www.nature.com/articles/nature12373.pdf', url_for_pdf: 'https://www.nature.com/articles/nature12373.pdf', url_for_landing_page: 'https://doi.org/10.1038/nature12373', version: 'publishedVersion', host_type: 'publisher', license: null };
      var pmc = { url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/4221854', url_for_pdf: null, url_for_landing_page: 'https://www.ncbi.nlm.nih.gov/pmc/articles/4221854', version: 'submittedVersion', host_type: 'repository', repository_institution: 'PubMed Central', license: null };
      var poisoned = { url: 'javascript:alert(1)', url_for_pdf: null, url_for_landing_page: 'javascript:alert(1)', version: 'publishedVersion', host_type: 'repository', repository_institution: 'A poisoned record', license: 'cc-by' }; // would rank first; must be dropped for not being http(s)
      var upDoi = decodeURIComponent(up[1]).toLowerCase();
      if (upDoi === work.message.DOI.toLowerCase()) return json(route, { doi: work.message.DOI, is_oa: true, oa_status: 'bronze', best_oa_location: bronze, oa_locations: [poisoned, bronze, pmc] });
      if (upDoi === work.message.DOI.toLowerCase() + '-twin') return json(route, { doi: upDoi, is_oa: true, oa_status: 'bronze', best_oa_location: bronze, oa_locations: [bronze] }); // publisher copy only
      return json(route, { HTTP_status_code: 404, error: true }, 404);
    }
    if (/api\.openalex\.org\/works\?.*search=thermometry(&|$)/.test(url)) return json(route, { results: [{ // the retracted paper as OpenAlex has it: a display name, and no notices
      id: 'https://openalex.org/W1', doi: 'https://doi.org/' + retracted.message.DOI, title: retracted.message.title[0], display_name: retracted.message.title[0],
      authorships: [{ author: { display_name: 'Andrew Wakefield' } }], publication_year: 1998, publication_date: '1998-02-28', biblio: { volume: '351', issue: '9103', first_page: '637', last_page: '641' },
      primary_location: { source: { display_name: 'The Lancet', type: 'journal' } }, type: 'article', is_retracted: false }] });
    // The NLM Catalog: Nature by its ISSN, The Lancet by its title, nothing for the rest
    var es = url.match(/eutils\.ncbi\.nlm\.nih\.gov\/entrez\/eutils\/esearch\.fcgi\?.*term=([^&]*)/);
    if (es) { var term = decodeURIComponent(es[1]); return json(route, { esearchresult: { idlist: /0028-0836\[issn\]/.test(term) ? ['0410462'] : /Lancet/.test(term) ? ['2985213R'] : [] } }); }
    if (/eutils\.ncbi\.nlm\.nih\.gov\/entrez\/eutils\/esummary\.fcgi/.test(url)) return json(route, { result: { '0410462': { medlineta: 'Nature', titlemainlist: [{ title: 'Nature.' }] }, '2985213R': { medlineta: 'Lancet', titlemainlist: [{ title: 'Lancet.' }] } } });
    // OpenAlex, Europe PMC, Open Library, JabRef lists, other CSL styles: nothing to say
    return json(route, {}, 404);
  });
}

async function newPage(browser, base, dark) {
  var ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, colorScheme: dark ? 'dark' : 'light', permissions: ['clipboard-read', 'clipboard-write'] });
  var page = await ctx.newPage();
  var state = { errors: [], requests: [] };
  page.on('pageerror', function (e) { state.errors.push('pageerror: ' + e.message + ' @ ' + String(e.stack || '').split('\n').slice(1, 4).join(' <- ').replace(/\s+/g, ' ')); });
  // axe-core reads cross-origin stylesheets by fetching them, which the page's connect-src rightly refuses for the font stylesheet: that one report is the tool's, not the page's
  page.on('console', function (msg) { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text()) && !/^Connecting to 'https:\/\/fonts\.googleapis\.com\/[^']*' violates .*connect-src/.test(msg.text())) state.errors.push('console: ' + msg.text()); });
  await mockNetwork(page, base, state.requests);
  return { ctx: ctx, page: page, state: state };
}

// Five records neither alphabetical nor chronological as given, two of them by one author in one year, for the list's order menu
var ORDER_RIS = [['Mills, C.', 'Mapping the delta', '2001'], ['Zeller, D.', 'Tides of the estuary', '2019'], ['Abbott, A.', 'Dunes in winter', '2010'], ['Brown, B.', 'Zebra finches at dusk', '2019'], ['Brown, B.', 'Apple orchards at dawn', '2019']]
  .map(function (x, i) { return ['TY  - JOUR', 'AU  - ' + x[0], 'TI  - ' + x[1], 'JO  - Journal of Field Notes', 'PY  - ' + x[2], 'VL  - ' + (i + 1), 'SP  - 1', 'EP  - 9', 'ER  - ', ''].join('\r\n'); }).join('');
var RIS_FILE = ['TY  - JOUR', 'AU  - Kucsko, G.', 'AU  - Maurer, P. C.', 'AU  - Yao, N. Y.', 'TI  - Nanometre-scale thermometry in a living cell', 'JO  - Nature', 'PY  - 2013', 'VL  - 500', 'IS  - 7460', 'SP  - 54', 'EP  - 58', 'DO  - 10.1038/nature12373', 'DP  - JSTOR', 'AN  - 41403188', 'ER  - ', ''].join('\r\n');
var BIB_FILE = '@article{vaswani2017attention,\n  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},\n  title = {Attention is all you need},\n  journal = {Advances in Neural Information Processing Systems},\n  year = {2017},\n  volume = {30},\n  pages = {5998--6008}\n}\n';

// A zip (the .docx container) built by hand: stored entries unless an entry says method 8, and a central directory that may lie
// about an entry's unpacked size or the number of entries, which is what the reader checks before inflating anything
function zipOf(entries, opts) {
  opts = opts || {};
  var locals = [], dirs = [], offset = 0;
  entries.forEach(function (e) {
    var name = Buffer.from(e.name), data = e.data, method = e.method || 0, usize = e.usize !== undefined ? e.usize : data.length;
    var lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26);
    var cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(usize, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(lh, name, data); dirs.push(cd, name); offset += 30 + name.length + data.length;
  });
  var dir = Buffer.concat(dirs), eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(opts.count !== undefined ? opts.count : entries.length, 8); eocd.writeUInt16LE(opts.count !== undefined ? opts.count : entries.length, 10); eocd.writeUInt32LE(dir.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([dir, eocd]));
}

// Everything the page does, once per colour scheme; axe runs on each tab once it has content
async function runFlows(browser, base, dark, cslReady) {
  var scheme = dark ? 'dark' : 'light';
  var s = await newPage(browser, base, dark), page = s.page;
  var name = function (n) { return n + ' [' + scheme + ']'; };
  async function axeCheck(label) {
    var results = await new AxeBuilder({ page: page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
    var v = results.violations.filter(function (x) { return x.impact === 'critical' || x.impact === 'serious' || x.impact === 'moderate' || x.impact === 'minor'; });
    check(name('axe: no violations on ' + label), v.length === 0, v.map(function (x) { return x.id + ' (' + x.impact + ', ' + x.nodes.length + ' nodes): ' + x.help + ' e.g. ' + x.nodes[0].target.join(' '); }).join(' | '));
  }
  var textOf = async function (sel) { return page.locator(sel).textContent(); };

  // 1. Loads clean, with metadata and version
  await page.goto(base, { waitUntil: 'load' });
  check(name('title is AutoDOI'), (await page.title()) === 'AutoDOI');
  check(name('favicon link present'), await page.locator('link[rel="icon"]').count() === 1);
  check(name('the page links its web app manifest and the manifest is served'), (await page.locator('link[rel="manifest"]').getAttribute('href')) === 'manifest.webmanifest' && (await page.evaluate(function () { return fetch('manifest.webmanifest').then(function (r) { return r.ok && r.json(); }).then(function (m) { return m && m.name === 'AutoDOI'; }); })));
  check(name('the service worker is served but not registered over plain http'), (await page.evaluate(function () { return fetch('sw.js').then(function (r) { return r.ok; }); })) && !(await page.evaluate(function () { return navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(function (r) { return r.length > 0; }) : false; })));
  check(name('footer shows the package version'), (await textOf('#app-version')) === 'v' + pkgVersion, await textOf('#app-version'));
  check(name('sample record renders at rest'), /Kucsko/.test(await textOf('#doi-result')));
  check(name('bug link carries the version'), versionInUrl.test(await page.locator('#link-bug').getAttribute('href')));
  check(name('no page errors on load'), s.state.errors.length === 0, s.state.errors.join(' | '));
  check(name('no lookup left the page on load'), !s.state.requests.some(function (u) { return /api\.crossref|openalex|unpaywall|ebi\.ac\.uk|ncbi|jabref/i.test(u); }), s.state.requests.join(', '));
  check(name('the example record offers to look for a free copy without doing so'), (await page.locator('#doi-result button:has-text("Free copy?")').count()) === 1);
  check(name('colour scheme applied'), (await page.evaluate(function () { return getComputedStyle(document.body).backgroundColor; })) === (dark ? 'rgb(20, 23, 27)' : 'rgb(245, 246, 243)'), await page.evaluate(function () { return getComputedStyle(document.body).backgroundColor; }));
  check(name('the References tab is first and opens by default'), (await page.getAttribute('#tab-export', 'aria-selected')) === 'true' && await page.isVisible('#panel-export') && (await page.locator('nav[role=tablist] button').first().getAttribute('id')) === 'tab-export');
  await axeCheck('References tab at rest');

  // 2. Tabs: mouse, keyboard, aria state, persistence
  await page.click('#tab-find');
  check(name('click selects Find tab'), (await page.getAttribute('#tab-find', 'aria-selected')) === 'true' && await page.isHidden('#panel-cite') && await page.isVisible('#panel-find'));
  await page.focus('#tab-find'); await page.keyboard.press('ArrowRight');
  check(name('ArrowRight moves to the DOI tab and focuses it'), (await page.getAttribute('#tab-cite', 'aria-selected')) === 'true' && (await page.evaluate(function () { return document.activeElement.id; })) === 'tab-cite');
  await page.keyboard.press('Home');
  check(name('Home returns to the first tab, References'), (await page.getAttribute('#tab-export', 'aria-selected')) === 'true');
  await page.keyboard.press('End');
  check(name('End goes to the last tab, DOI → reference'), (await page.getAttribute('#tab-cite', 'aria-selected')) === 'true');
  await page.reload({ waitUntil: 'load' });
  check(name('selected tab survives a reload'), (await page.getAttribute('#tab-cite', 'aria-selected')) === 'true' && await page.isVisible('#panel-cite'));
  await axeCheck('DOI tab at rest');
  await page.click('#tab-find'); await axeCheck('Find tab empty');
  check(name('a Settings button sits in the header'), (await page.locator('header #settings-toggle').count()) === 1 && await page.isHidden('#settings-panel'));
  await page.click('#settings-toggle');
  check(name('Settings opens under the header and the button shows it is open'), await page.isVisible('#settings-panel') && (await page.getAttribute('#settings-toggle', 'aria-expanded')) === 'true' && (await page.evaluate(function () { var p = document.getElementById('settings-panel').getBoundingClientRect(), n = document.querySelector('nav[role=tablist]').getBoundingClientRect(); return p.bottom <= n.top; })));
  await axeCheck('Settings open');
  await page.keyboard.press('Escape');
  check(name('Escape closes Settings and returns focus to the button'), await page.isHidden('#settings-panel') && (await page.evaluate(function () { return document.activeElement.id; })) === 'settings-toggle');
  await page.click('#settings-toggle');
  await page.click('#settings-panel #polite-email');
  check(name('a click inside Settings leaves it open'), await page.isVisible('#settings-panel'));
  await page.fill('#settings-panel #polite-email', 'probe@example.org'); // Settings promises it to Crossref and OpenAlex only: checked after the free-copy lookup below
  await page.locator('main p.lead:visible').first().click();
  check(name('a click outside Settings closes it'), await page.isHidden('#settings-panel') && (await page.getAttribute('#settings-toggle', 'aria-expanded')) === 'false');

  // 3. DOI lookup through the form
  await page.click('#tab-cite');
  await page.fill('#doi-input', 'https://doi.org/10.1038/nature12373');
  await page.click('#doi-go');
  await page.waitForFunction(function () { return /Copy/.test(document.querySelector('#doi-result').textContent) && !/Looking/.test(document.querySelector('#doi-status').textContent); }, null, { timeout: 15000 });
  var text = await textOf('#doi-result');
  check(name('lookup renders the record'), /Kucsko/.test(text) && /2013/.test(text) && /Nanometre-scale thermometry/.test(text), text.slice(0, 200));
  check(name('lookup renders every built-in style'), ['APA', 'MLA', 'Chicago', 'Harvard', 'Vancouver', 'IEEE'].every(function (st) { return text.indexOf(st) !== -1; }), text.slice(0, 300));
  check(name('lookup shows export formats'), /BibTeX/.test(text) && /RIS/.test(text) && /EndNote/.test(text));
  check(name('View article links through doi.org'), (await page.locator('#doi-result a[href="https://doi.org/10.1038/nature12373"]').count()) >= 1);
  await page.waitForSelector('#doi-result a.free', { timeout: 10000 }).catch(function () {});
  var freeLink = page.locator('#doi-result a.free');
  check(name('the repository copy is offered over the stale publisher one, as an accepted manuscript'), (await freeLink.count()) === 1 && (await freeLink.getAttribute('href')) === 'https://www.ncbi.nlm.nih.gov/pmc/articles/4221854' && /Free copy \(accepted manuscript\)/.test(await freeLink.textContent()) && /PubMed Central/.test(await freeLink.getAttribute('title')), await page.locator('#doi-result .record-head').innerHTML());
  check(name('no Free PDF button points at the unlicensed publisher copy'), (await page.locator('#doi-result a[href="https://www.nature.com/articles/nature12373.pdf"]').count()) === 0);
  check(name('the free copy was asked of Unpaywall with a contact address'), s.state.requests.some(function (u) { return /api\.unpaywall\.org\/v2\/10\.1038\/nature12373\?email=/.test(u); }), s.state.requests.filter(function (u) { return /unpaywall/.test(u); }).join(', '));
  check(name('the polite email from Settings went to Crossref but never to Unpaywall'), s.state.requests.some(function (u) { return /api\.crossref\.org.*mailto=probe%40example\.org/.test(u); }) && !s.state.requests.some(function (u) { return /unpaywall/.test(u) && /probe/.test(u); }), s.state.requests.filter(function (u) { return /unpaywall|mailto/.test(u); }).join(', '));
  await page.click('#settings-toggle'); await page.fill('#settings-panel #polite-email', ''); await page.click('#settings-toggle');
  check(name('no Via library button until a library link is set'), (await page.locator('#doi-result a:has-text("Via library")').count()) === 0);
  await page.click('#settings-toggle'); // the field sits in the closed Settings panel
  await page.fill('#library-link', 'https://ezproxy.example.edu/login?url='); await page.dispatchEvent('#library-link', 'change');
  var lib = page.locator('#doi-result a:has-text("Via library")');
  check(name('a library link adds a Via library button through the proxy'), (await lib.count()) === 1 && (await lib.getAttribute('href')) === 'https://ezproxy.example.edu/login?url=https://doi.org/10.1038/nature12373', await lib.getAttribute('href'));
  await page.fill('#library-link', 'https://resolver.example.edu/openurl?id=doi:{doi}'); await page.dispatchEvent('#library-link', 'change');
  check(name('a {doi} template fills the DOI in'), (await page.locator('#doi-result a:has-text("Via library")').getAttribute('href')) === 'https://resolver.example.edu/openurl?id=doi:10.1038/nature12373', await page.locator('#doi-result a:has-text("Via library")').getAttribute('href'));
  await page.fill('#library-link', ''); await page.dispatchEvent('#library-link', 'change');
  check(name('clearing the library link removes the button'), (await page.locator('#doi-result a:has-text("Via library")').count()) === 0);
  await page.click('#settings-toggle');
  check(name('Report it link is prefilled with the DOI'), /doi=10\.1038%2Fnature12373/.test(await page.locator('#doi-result a:has-text("Report it")').getAttribute('href')));
  check(name('URL now carries ?q='), /[?&]q=10\.1038/.test(page.url()), page.url());
  var crossrefCalls = s.state.requests.filter(function (u) { return /api\.crossref\.org\/works\/10\.1038/.test(u); }).length;
  check(name('exactly one Crossref lookup for the DOI'), crossrefCalls === 1, crossrefCalls);
  await axeCheck('DOI tab with a result');

  // The looked-up record follows you to the other tabs' empty fields
  await page.click('#tab-find');
  check(name('Find fields are prefilled from the looked-up record'), (await page.inputValue('#find-title')) === 'Nanometre-scale thermometry in a living cell' && (await page.inputValue('#find-journal')) === 'Nature', (await page.inputValue('#find-title')) + ' / ' + (await page.inputValue('#find-journal')));
  await page.focus('#find-title');
  check(name('focusing a prefilled field selects it, so typing replaces it'), await page.evaluate(function () { var i = document.getElementById('find-title'); return i.selectionStart === 0 && i.selectionEnd === i.value.length; }));
  await page.click('#tab-export');
  check(name('the References box is prefilled with the DOI'), (await page.inputValue('#export-input')) === '10.1038/nature12373', await page.inputValue('#export-input'));
  await page.waitForFunction(function () { return /1 reference/.test(document.querySelector('#split-count').textContent); }, null, { timeout: 5000 }).catch(function () {});
  check(name('the prefilled DOI counts as one reference'), /1 reference/.test(await textOf('#split-count')), await textOf('#split-count'));
  await page.fill('#export-input', '');
  await page.click('#tab-find'); await page.fill('#find-title', ''); await page.fill('#find-journal', '');
  await page.click('#tab-cite');
  await page.click('#tab-find');
  check(name('a cleared field is not prefilled again for the same record'), (await page.inputValue('#find-title')) === '', await page.inputValue('#find-title'));
  await page.click('#tab-cite');

  // Single-style mode and copy
  await page.selectOption('#style-select', 'apa');
  await page.waitForFunction(function () { return !/MLA/.test(document.querySelector('#doi-result').textContent); });
  check(name('choosing APA shows only APA'), /APA/.test(await textOf('#doi-result')));
  await page.locator('#doi-result .cite .actions button:has-text("Copy")').first().click();
  var clip = await page.evaluate(function () { return navigator.clipboard.readText(); });
  check(name('Copy puts the APA reference on the clipboard'), /Kucsko, G\./.test(clip) && /\(2013\)/.test(clip), clip.slice(0, 120));
  // Rich: what Word and Google Docs take, HTML with the italics, beside the plain text; the clipboard write is caught in the page
  var richOf = async function (sel) {
    await page.evaluate(function () { window.__rich = null; navigator.clipboard.write = function (items) { window.__rich = items; return Promise.resolve(); }; });
    await page.locator(sel).first().click();
    return page.evaluate(function () { var it = window.__rich && window.__rich[0]; if (!it) return null; return Promise.all([it.getType('text/html').then(function (b) { return b.text(); }), it.getType('text/plain').then(function (b) { return b.text(); })]); });
  };
  var rich = await richOf('#doi-result .cite .actions button:has-text("Rich")');
  check(name('Rich puts the reference on the clipboard as HTML with the journal in italics, and as plain text'), !!rich && /<i>Nature<\/i>/.test(rich[0]) && /Kucsko, G\./.test(rich[0]) && /Nature, 500/.test(rich[1]) && !/<i>/.test(rich[1]), JSON.stringify(rich).slice(0, 300));
  // In-text citations: the parenthetical and narrative forms under the reference, with the pages typed in the toolbar
  var forms = async function () { return page.locator('#doi-result .cite .intext .form').allTextContents(); };
  check(name('APA shows its in-text and narrative forms'), (await forms()).join(' | ') === '(Kucsko et al., 2013) | Kucsko et al. (2013)', (await forms()).join(' | '));
  await page.fill('#cite-pages', '55');
  await page.waitForFunction(function () { return /p\. 55/.test(document.querySelector('#doi-result').textContent); }, null, { timeout: 5000 });
  check(name('typed pages go into both forms'), (await forms()).join(' | ') === '(Kucsko et al., 2013, p. 55) | Kucsko et al. (2013, p. 55)', (await forms()).join(' | '));
  await page.locator('#doi-result .cite .intext button[aria-label="Copy the in text"]').click();
  clip = await page.evaluate(function () { return navigator.clipboard.readText(); });
  check(name('the in-text Copy puts the citation on the clipboard'), clip === '(Kucsko et al., 2013, p. 55)', clip);
  await page.selectOption('#style-select', 'chicago');
  await page.waitForFunction(function () { return /Note:/.test(document.querySelector('#doi-result').textContent); }, null, { timeout: 5000 });
  var chiForms = await forms();
  check(name('Chicago shows the footnote with the page, and its short form'), /^G\. Kucsko et al\., \u201CNanometre-scale thermometry in a living cell,\u201D Nature 500, no\. 7460 \(August 2013\): 55, https:\/\/doi\.org\/10\.1038\/nature12373\.$/.test(chiForms[0]) && chiForms[1] === 'Kucsko et al., \u201CNanometre-scale thermometry in a living cell,\u201D 55.', chiForms.join(' | '));
  await page.fill('#cite-pages', '');
  await page.selectOption('#style-select', 'apa');
  await page.waitForFunction(function () { return !/p\. 55/.test(document.querySelector('#doi-result').textContent) && /APA/.test(document.querySelector('#doi-result').textContent); }, null, { timeout: 5000 });

  // Title case conversion and word override
  await page.selectOption('#case-select', 'title');
  await page.waitForFunction(function () { return /Nanometre-Scale Thermometry in a Living Cell/.test(document.querySelector('#doi-result').textContent); }, null, { timeout: 10000 });
  check(name('Title Case converts the heading'), /Nanometre-Scale Thermometry in a Living Cell/.test(await textOf('#doi-result')));
  await page.selectOption('#case-select', 'none');
  await page.selectOption('#style-select', 'all');

  // 4. A journal style from the CSL repository, rendered by citeproc
  if (cslReady) {
    await page.selectOption('#style-select', 'search');
    await page.waitForSelector('#csl-box:not([hidden])');
    await page.fill('#csl-search', 'nature');
    await page.waitForSelector('#csl-results .hit.style');
    var hit = page.locator('#csl-results .hit.style').filter({ has: page.locator('.m', { hasText: /^nature( ·|$)/ }) }).first();
    check(name('style search finds Nature'), (await hit.count()) === 1, await textOf('#csl-results'));
    await hit.click();
    await page.waitForFunction(function () { var c = document.querySelector('#doi-result .cite .text'); return c && !/Rendering/.test(c.textContent); }, null, { timeout: 20000 });
    var cslText = await page.locator('#doi-result .cite').first().textContent();
    check(name('citeproc renders the Nature style'), /Nature/.test(cslText) && /Kucsko, G\. et al\./.test(cslText) && /500, 54/.test(cslText) && /\(2013\)/.test(cslText), cslText.slice(0, 300));
    check(name('the numeric journal style shows its in-text number with a Copy'), (await forms()).join(' | ') === '\u00B9' && (await page.locator('#doi-result .cite .intext button').count()) === 1, (await forms()).join(' | '));
    check(name('style select shows the picked style'), /^csl:nature$/.test(await page.inputValue('#style-select')), await page.inputValue('#style-select'));
    check(name('citation engine came from the pinned, integrity-checked URL'), s.state.requests.indexOf(CITEPROC_URL) !== -1 && s.state.requests.indexOf(STYLE_URL) !== -1 && s.state.requests.indexOf(LOCALE_URL) !== -1);
    check(name('no page errors after CSL rendering'), s.state.errors.length === 0, s.state.errors.join(' | '));
    await axeCheck('DOI tab with a CSL style');
    // A dependent style: its own file only names a parent, which must be fetched and used
    await page.selectOption('#style-select', 'search');
    await page.fill('#csl-search', 'nature geoscience');
    var dep = page.locator('#csl-results .hit.style').filter({ has: page.locator('.m', { hasText: /^nature-geoscience( ·|$)/ }) }).first();
    await dep.waitFor();
    await dep.click();
    await page.waitForFunction(function () { var c = document.querySelector('#doi-result .cite .text'); return c && !/Rendering/.test(c.textContent) && /Kucsko/.test(c.textContent); }, null, { timeout: 20000 });
    var depText = await page.locator('#doi-result .cite').first().textContent();
    check(name('dependent style renders with its parent'), /Nature Geoscience/.test(depText) && /Kucsko, G\. et al\./.test(depText) && /500, 54/.test(depText), depText.slice(0, 300));
    check(name('dependent style fetched its own file and reused the cached parent'), s.state.requests.indexOf(DEP_STYLE_URL) !== -1 && s.state.requests.filter(function (u) { return u === STYLE_URL; }).length === 1, s.state.requests.filter(function (u) { return /citation-style-language/.test(u); }).join(', '));
    check(name('style select remembers both picked styles'), (await page.locator('#style-select option[value="csl:nature"]').count()) === 1 && (await page.locator('#style-select option[value="csl:nature-geoscience"]').count()) === 1);
    // Deep link into a CSL style
    await page.goto(base + '?q=10.1038/nature12373&style=csl:nature', { waitUntil: 'load' });
    await page.waitForFunction(function () { var c = document.querySelector('#doi-result .cite .text'); return c && !/Rendering/.test(c.textContent) && /Kucsko/.test(c.textContent); }, null, { timeout: 20000 });
    check(name('?style=csl: deep link renders through citeproc'), /Nature 500, 54/.test(await page.locator('#doi-result .cite').first().textContent()));
    // Deep link into a dependent style on a fresh page (no remembered title): the title comes from the style file
    await page.evaluate(function () { localStorage.removeItem('autodoi.cslrecent'); localStorage.removeItem('autodoi.style'); });
    await page.goto(base + '?q=10.1038/nature12373&style=csl:nature-geoscience', { waitUntil: 'load' });
    await page.waitForFunction(function () { var c = document.querySelector('#doi-result .cite .text'); return c && !/Rendering/.test(c.textContent) && /Kucsko/.test(c.textContent); }, null, { timeout: 20000 });
    check(name('?style=csl: deep link to a dependent style renders and names it'), /Nature Geoscience/.test(await page.locator('#doi-result .cite').first().textContent()) && /Nature Geoscience/.test(await page.locator('#style-select option:checked').textContent()), await page.locator('#style-select option:checked').textContent());
    await page.selectOption('#style-select', 'all');
  }

  // 4b. The language of journal styles: German turns Harvard's "pp." and "Available at" into "S." and "Verfügbar unter"; back to English restores them
  if (cslReady) {
    await page.goto(base + '?q=10.1038/nature12373&style=csl:harvard-cite-them-right', { waitUntil: 'load' });
    await page.waitForFunction(function () { var c = document.querySelector('#doi-result .cite .text'); return c && !/Rendering/.test(c.textContent) && /Kucsko/.test(c.textContent); }, null, { timeout: 20000 });
    var enText = await page.locator('#doi-result .cite .text').first().textContent();
    check(name('Harvard through citeproc prints English terms'), /pp\. 54/.test(enText) && /Available at:/.test(enText), enText.slice(0, 200));
    await page.click('#settings-toggle'); await page.selectOption('#csl-locale', 'de-DE'); await page.keyboard.press('Escape');
    await page.waitForFunction(function () { var c = document.querySelector('#doi-result .cite .text'); return c && /S\. 54/.test(c.textContent); }, null, { timeout: 20000 });
    var deText = await page.locator('#doi-result .cite .text').first().textContent();
    check(name('German prints "S." and "Verfügbar unter" and fetched the German locale'), /Verf\u00fcgbar unter/.test(deText) && s.state.requests.indexOf(LOCALE_DE_URL) !== -1, deText.slice(0, 200));
    await page.click('#settings-toggle'); await page.selectOption('#csl-locale', 'en-US'); await page.keyboard.press('Escape');
    await page.waitForFunction(function () { var c = document.querySelector('#doi-result .cite .text'); return c && /pp\. 54/.test(c.textContent); }, null, { timeout: 20000 });
    check(name('back to English'), /pp\. 54/.test(await page.locator('#doi-result .cite .text').first().textContent()));
  }
  // 5. Deep link to a built-in style
  await page.goto(base + '?q=10.1038/nature12373&style=vancouver', { waitUntil: 'load' });
  await page.waitForFunction(function () { return /Kucsko/.test(document.querySelector('#doi-result').textContent) && /Copy/.test(document.querySelector('#doi-result').textContent); }, null, { timeout: 15000 });
  check(name('?q= deep link runs the lookup'), (await page.inputValue('#doi-input')) === '10.1038/nature12373');
  check(name('?style= deep link selects the style'), (await page.inputValue('#style-select')) === 'vancouver', await page.inputValue('#style-select'));
  await page.selectOption('#style-select', 'all');

  // 6. Error path: unknown DOI shows an error with a prefilled bug report
  await page.fill('#doi-input', '10.9999/does-not-exist');
  await page.click('#doi-go');
  await page.waitForSelector('#doi-status.err a:has-text("Report this")', { timeout: 15000 });
  var href = await page.locator('#doi-status a:has-text("Report this")').getAttribute('href');
  check(name('error status names the problem'), /not found/i.test(await textOf('#doi-status')), await textOf('#doi-status'));
  check(name('Report this link opens a prefilled issue with version and error'), /issues\/new\?template=bug_report\.yml/.test(href) && versionInUrl.test(href) && /errors=/.test(href) && /10\.9999/.test(href), href.slice(0, 200));
  check(name('error path leaves no unhandled page errors'), s.state.errors.length === 0, s.state.errors.join(' | '));
  await axeCheck('DOI tab with an error');

  // 7. Find a DOI, then click a hit to format it
  await page.click('#tab-find');
  check(name('the Search button stands on the same foot as the title box'), await page.evaluate(function () { var b = document.querySelector('#find-go').getBoundingClientRect(), t = document.querySelector('#find-title').getBoundingClientRect(); return Math.abs(b.bottom - t.bottom) <= 1 && Math.abs(b.top - t.top) <= 2; }), await page.evaluate(function () { var b = document.querySelector('#find-go').getBoundingClientRect(), t = document.querySelector('#find-title').getBoundingClientRect(); return 'button ' + b.top + '-' + b.bottom + ', input ' + t.top + '-' + t.bottom; }));
  await page.fill('#find-title', ''); await page.fill('#find-journal', '');
  await page.focus('#find-title'); await page.keyboard.press('Tab');
  check(name('Tab in the empty title box fills in the example and keeps the focus'), (await page.inputValue('#find-title')) === 'Nanometre-scale thermometry in a living cell' && (await page.evaluate(function () { return document.activeElement.id; })) === 'find-title');
  await page.keyboard.press('Tab');
  check(name('a second Tab moves on to the journal box'), (await page.evaluate(function () { return document.activeElement.id; })) === 'find-journal');
  await page.keyboard.press('Tab');
  check(name('Tab fills the journal example too'), (await page.inputValue('#find-journal')) === 'Nature');
  await page.click('#find-go');
  await page.waitForSelector('#find-results .hit', { timeout: 15000 });
  check(name('find shows a hit with a Title match chip'), /Title match/.test(await page.locator('#find-results .hit').first().textContent()));
  check(name('find hit shows the DOI'), /10\.1038\/nature12373/.test(await textOf('#find-results')));
  check(name('the search words are lit in the hit\'s title and journal'), (await page.locator('#find-results .hit').first().locator('.t mark').count()) === 6 && (await page.locator('#find-results .hit').first().locator('.m mark:has-text("Nature")').count()) === 1, await page.locator('#find-results .hit').first().innerHTML().then(function (h) { return h.slice(0, 400); }));
  check(name('the top hit replaces the example on the DOI tab'), (await page.locator('#doi-result .chip:has-text("Found by title")').count()) === 1 && (await page.inputValue('#doi-input')) === '10.1038/nature12373' && /[?&]q=10\.1038/.test(page.url()), page.url());
  check(name('hits carry no Format button: the card itself is the control'), (await page.locator('#find-results .hit button.btn:has-text("Format")').count()) === 0 && (await page.locator('#find-results .hit.pickable').count()) >= 1);
  await axeCheck('Find tab with results');
  await page.locator('#find-results .hit.pickable').first().click({ position: { x: 24, y: 10 } });
  check(name('clicking a hit jumps to the DOI tab with the record'), (await page.getAttribute('#tab-cite', 'aria-selected')) === 'true' && (await page.inputValue('#doi-input')) === '10.1038/nature12373' && /Kucsko/.test(await textOf('#doi-result')));
  check(name('the picked hit stays lit'), (await page.locator('#find-results .hit.picked').count()) === 1);

  // 8. Reference matching and export
  await page.click('#tab-export');
  await page.selectOption('#split-mode', 'lines');
  await page.fill('#export-input', 'Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., & Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. Naturee, 500(7460), 54-58.\nVaswani A, Shazeer N, Parmar N. Attention is all you need. Advances in Neural Information Processing Systems. 2017;30:5998-6008.'); // "Naturee": a typo the record should expose
  await page.waitForFunction(function () { return /2 references/.test(document.querySelector('#split-count').textContent); }, null, { timeout: 5000 }).catch(function () {});
  check(name('split count reports two references'), /2 references/.test(await textOf('#split-count')), await textOf('#split-count'));
  await page.click('#export-go');
  await page.waitForFunction(function () { return /good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  var status = await textOf('#export-status');
  check(name('status counts one good and one unmatched'), /1 good/.test(status) && /1 not matched/.test(status), status);
  check(name('one row is a good match'), (await page.locator('#export-matches .match.good').count()) === 1);
  check(name('the first good row replaces the DOI tab record'), (await page.locator('#doi-result .chip:has-text("From your references")').count()) === 1 && /Kucsko/.test(await textOf('#doi-result')));
  await page.locator('#export-matches .match.good button:has-text("Format")').click();
  check(name('Format on a row opens it on the DOI tab'), (await page.getAttribute('#tab-cite', 'aria-selected')) === 'true' && (await page.inputValue('#doi-input')) === '10.1038/nature12373' && (await page.locator('#doi-result .chip:has-text("From your references")').count()) === 0);
  await page.click('#tab-export');
  check(name('coming back keeps the pasted references'), /Naturee/.test(await page.inputValue('#export-input')));
  await page.click('#export-input', { clickCount: 3, position: { x: 30, y: 12 } });
  check(name('a triple click in the References box selects the whole paste, not one line'), await page.evaluate(function () { var t = document.getElementById('export-input'); return t.selectionStart === 0 && t.selectionEnd === t.value.length && t.value.indexOf('\n') !== -1; }));
  var zone = page.locator('#export-output .export-zone');
  var textDois = await page.locator('#export-output .export:has(.section-label:has-text("Your text with DOIs")) pre').textContent();
  check(name('the pasted text comes back with the DOI appended to the matched line only'), textDois === 'Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., & Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. Naturee, 500(7460), 54-58. https://doi.org/10.1038/nature12373\nVaswani A, Shazeer N, Parmar N. Attention is all you need. Advances in Neural Information Processing Systems. 2017;30:5998-6008.', JSON.stringify(textDois));
  var cslJson = await page.locator('#export-output .export:has(.section-label:has-text("CSL JSON")) pre').textContent();
  check(name('CSL JSON export holds the ticked record'), (function () { try { var j = JSON.parse(cslJson); return j.length === 1 && j[0].DOI === '10.1038/nature12373' && j[0].type === 'article-journal' && j[0].author[0].family === 'Kucsko'; } catch (e) { return false; } })(), cslJson.slice(0, 200));
  check(name('the export sits in its own bordered box with the download buttons'), (await zone.count()) === 1 && /Your export/.test(await zone.textContent()) && (await zone.locator('button.fill:has-text("Download")').count()) >= 3 && (await zone.locator('.reflist').count()) === 1, await page.locator('#export-output').innerHTML().then(function (h) { return h.slice(0, 300); }));
  check(name('the export box is distinct in colour'), await page.evaluate(function () { var z = document.querySelector('#export-output .export-zone'), m = document.querySelector('#export-matches .match'); var zs = getComputedStyle(z); return zs.borderTopWidth === '2px' && zs.borderTopColor !== getComputedStyle(m).borderTopColor && zs.backgroundColor !== getComputedStyle(m).backgroundColor; }));
  check(name('a matched row has no Include label; it is lit as being in the export'), (await page.locator('#export-matches .match label:has-text("Include")').count()) === 0 && (await page.locator('#export-matches .match.good.included').count()) === 1 && /In the export/.test(await page.locator('#export-matches .match.good .pick').textContent()));
  await page.locator('#export-matches .match.good').click({ position: { x: 10, y: 6 } });
  await page.waitForFunction(function () { return !document.querySelector('#export-matches .match.good.included'); }, null, { timeout: 5000 }); // the kept-as-written line still gives the export box something to hold
  check(name('a click on the row takes it out of the export and dims it'), (await page.locator('#export-matches .match.good.included').count()) === 0 && /Click to include/.test(await page.locator('#export-matches .match.good .pick').textContent()) && !(await page.locator('#export-matches .match.good input[type=checkbox][id^=inc-]').isChecked()));
  await page.locator('#export-matches .match.good .out .t').click(); // a click on the record's title: the same toggle
  await page.waitForSelector('#export-zone', { timeout: 5000 });
  check(name('a click on the row puts it back'), (await page.locator('#export-matches .match.good.included').count()) === 1);
  await page.locator('#export-matches .match.good button:has-text("Copy DOI"), #export-matches .match.good .out code').first().click().catch(function () {});
  check(name('a click on a control or link inside the row does not toggle it'), (await page.locator('#export-matches .match.good.included').count()) === 1);
  var jump = page.locator('#export-status button:has-text("Go to export")');
  check(name('the status line offers a button down to the export'), (await jump.count()) === 1);
  await jump.click();
  check(name('Go to export focuses the export box'), (await page.evaluate(function () { return document.activeElement && document.activeElement.id; })) === 'export-zone');
  // In-text citations under the list's entries: off by default, numbered by list position, never part of what Copy takes
  check(name('the list shows no in-text lines until asked'), (await page.locator('#export-output .reflist .intext').count()) === 0);
  await page.check('#list-intext');
  await page.waitForSelector('#export-output .reflist .intext', { timeout: 5000 });
  var listForms = await page.locator('#export-output .reflist .intext .form').allTextContents();
  check(name('APA entries get their in-text and narrative forms; the kept line gets none'), listForms.join(' | ') === '(Kucsko et al., 2013) | Kucsko et al. (2013)' && (await page.locator('#export-output .reflist p').count()) === 2, listForms.join(' | '));
  await page.locator('#export-output .reflist button:has-text("Copy")').first().click();
  clip = await page.evaluate(function () { return navigator.clipboard.readText(); });
  check(name('an in-text Copy on the list copies that form'), clip === '(Kucsko et al., 2013)', clip);
  await page.locator('#export-output .export .actions button:has-text("Copy")').first().click();
  clip = await page.evaluate(function () { return navigator.clipboard.readText(); });
  check(name('the list Copy leaves the in-text forms out'), /Kucsko, G\./.test(clip) && !/\(Kucsko et al\., 2013\)/.test(clip), clip.slice(0, 200));
  await page.selectOption('#list-style', 'ieee');
  await page.waitForFunction(function () { return /\[1\]/.test(document.querySelector('#export-output .reflist').textContent); }, null, { timeout: 5000 });
  check(name('IEEE numbers the in-text form by list position'), (await page.locator('#export-output .reflist .intext .form').allTextContents()).join(' | ') === '[1]');
  await page.selectOption('#list-style', 'apa');
  await page.uncheck('#list-intext');
  // Include DOI: on by default, but off for Annals, whose guide has no DOI; appended only where the style left it out; remembered per style
  var listText = function () { return page.locator('#export-output .reflist').textContent(); };
  check(name('Include DOI is on for APA, which already carries the DOI once'), (await page.isChecked('#list-doi')) && ((await listText()).match(/10\.1038\/nature12373/g) || []).length === 1, await listText());
  await page.selectOption('#list-style', 'carnegie');
  await page.waitForFunction(function () { return /Kucsko, G\., P\.C\. Maurer/.test(document.querySelector('#export-output .reflist').textContent); }, null, { timeout: 5000 });
  check(name('Annals starts without the DOI'), !(await page.isChecked('#list-doi')) && !/10\.1038/.test(await listText()), await listText());
  await page.check('#list-doi');
  await page.waitForFunction(function () { return /https:\/\/doi\.org\/10\.1038\/nature12373/.test(document.querySelector('#export-output .reflist').textContent); }, null, { timeout: 5000 });
  check(name('ticking Include DOI appends the DOI link to the Annals entry'), /54-58\. https:\/\/doi\.org\/10\.1038\/nature12373$/.test(await page.locator('#export-output .reflist p:has-text("Kucsko")').textContent()), await listText());
  await page.selectOption('#list-style', 'apa');
  await page.waitForFunction(function () { return /Kucsko, G\., Maurer, P\. C\./.test(document.querySelector('#export-output .reflist').textContent); }, null, { timeout: 5000 });
  check(name('the choice is per style: APA is still on and carries the DOI once'), (await page.isChecked('#list-doi')) && ((await listText()).match(/10\.1038\/nature12373/g) || []).length === 1, await listText());
  await page.selectOption('#list-style', 'carnegie');
  await page.waitForFunction(function () { return /https:\/\/doi\.org\/10\.1038\/nature12373/.test(document.querySelector('#export-output .reflist').textContent); }, null, { timeout: 5000 });
  check(name('Annals remembers that it was switched on'), await page.isChecked('#list-doi'));
  await page.uncheck('#list-doi');
  await page.waitForFunction(function () { return !/10\.1038/.test(document.querySelector('#export-output .reflist').textContent); }, null, { timeout: 5000 });
  await page.selectOption('#list-style', 'apa');
  await page.waitForFunction(function () { return /Kucsko, G\., Maurer, P\. C\./.test(document.querySelector('#export-output .reflist').textContent); }, null, { timeout: 5000 });
  // The order menu: a kept line goes by the year written in it, and Copy link carries the order
  var listFirst = function () { return page.locator('#export-output .reflist p').first().textContent(); };
  check(name('the list starts in the style’s order, alphabetical for APA'), (await page.inputValue('#list-order')) === 'style' && /^Kucsko/.test(await listFirst()), await listFirst());
  await page.selectOption('#list-order', 'newest');
  check(name('Newest first puts the kept 2017 line above the 2013 record'), /^Vaswani/.test(await listFirst()) && (await page.locator('#export-output .reflist p').count()) === 2, await listText());
  await page.locator('#export-zone .zone-head button:has-text("Copy link")').click();
  clip = await page.evaluate(function () { return navigator.clipboard.readText(); });
  check(name('Copy link carries the order'), /&order=newest$/.test(clip), clip);
  await page.selectOption('#list-order', 'style');
  check(name('back in the style’s order the link names none'), /^Kucsko/.test(await listFirst()) && !/order=/.test(await (async function () { await page.locator('#export-zone .zone-head button:has-text("Copy link")').click(); return page.evaluate(function () { return navigator.clipboard.readText(); }); })()));
  // A journal style searched for from the list's own menu: it sets the list's style only, and the DOI tab's menu gains it
  if (cslReady) {
    var doiStyle = await page.inputValue('#style-select');
    await page.selectOption('#list-style', 'search');
    await page.waitForSelector('#export-output .list-find:not([hidden])');
    check(name('the list menu keeps showing its style while the search is open'), (await page.inputValue('#list-style')) === 'apa', await page.inputValue('#list-style'));
    await page.fill('#list-style-search', 'nature');
    var listHit = page.locator('#export-output .list-find .hit.style').filter({ has: page.locator('.m', { hasText: /^nature( ·|$)/ }) }).first();
    await listHit.waitFor();
    await listHit.click();
    await page.waitForFunction(function () { var l = document.querySelector('#export-output .reflist'); return l && !/Rendering/.test(l.textContent) && /Kucsko, G\./.test(l.textContent) && !/Maurer, P\. C\./.test(l.textContent); }, null, { timeout: 20000 });
    check(name('a journal style picked from the list search renders the list and closes the search'), (await page.inputValue('#list-style')) === 'csl:nature' && (await page.locator('#export-output .list-find').isHidden()) && /Nature 500, 54/.test(await listText()), await listText());
    check(name('the list search leaves the DOI tab style alone and adds the journal to its menu'), (await page.inputValue('#style-select')) === doiStyle && (await page.locator('#style-select option[value="csl:nature"]').count()) === 1, await page.inputValue('#style-select'));
    await page.locator('#export-zone .zone-head button:has-text("Copy link")').click();
    clip = await page.evaluate(function () { return navigator.clipboard.readText(); });
    check(name('Copy link carries the searched list style'), /&list=csl%3Anature$/.test(clip), clip);
    await page.selectOption('#list-style', 'apa');
    await page.waitForFunction(function () { return /Kucsko, G\., Maurer, P\. C\./.test(document.querySelector('#export-output .reflist').textContent); }, null, { timeout: 5000 });
  }
  // The Word download: a valid .docx whose one paragraph per entry keeps the italics and carries a hanging indent
  var dlPromise = page.waitForEvent('download', { timeout: 10000 });
  await page.locator('#export-output .export .actions button:has-text("Word")').click();
  var dl = await dlPromise, dlPath = await dl.path();
  var docxBuf = fs.readFileSync(dlPath), docXml = '';
  (function () { // stored zip entries: find word/document.xml by its local header
    var i = docxBuf.indexOf('word/document.xml');
    while (i !== -1) { var hdr = i - 30; if (docxBuf.readUInt32LE(hdr) === 0x04034b50) { var size = docxBuf.readUInt32LE(hdr + 18), nlen = docxBuf.readUInt16LE(hdr + 26), xlen = docxBuf.readUInt16LE(hdr + 28); docXml = docxBuf.slice(hdr + 30 + nlen + xlen, hdr + 30 + nlen + xlen + size).toString('utf8'); break; } i = docxBuf.indexOf('word/document.xml', i + 1); }
  })();
  check(name('the Word file is a zip named references.docx with a document part'), dl.suggestedFilename() === 'references.docx' && docxBuf.readUInt32LE(0) === 0x04034b50 && /<w:document /.test(docXml), docXml.slice(0, 120));
  check(name('each entry is a paragraph with a hanging indent, the journal in italics and the kept line as text'), (docXml.match(/<w:p>/g) || []).length === 2 && /<w:ind w:left="720" w:hanging="720"\/>/.test(docXml) && /<w:rPr><w:i\/><w:iCs\/><\/w:rPr><w:t xml:space="preserve">Nature<\/w:t>/.test(docXml) && /Attention is all you need/.test(docXml), docXml.slice(0, 600));
  await page.waitForFunction(function () { return !document.querySelector('#export-output .reflist .intext'); }, null, { timeout: 5000 });
  var rowFree = page.locator('#export-matches .match.good button:has-text("Free copy?")');
  check(name('a matched row offers to look for a free copy'), (await rowFree.count()) === 1);
  await rowFree.click();
  await page.waitForSelector('#export-matches .match.good a.free', { timeout: 10000 }).catch(function () {});
  check(name('the row shows the free copy button once found'), (await page.locator('#export-matches .match.good a.free[href="https://www.ncbi.nlm.nih.gov/pmc/articles/4221854"]').count()) === 1, await page.locator('#export-matches .match.good .out').innerHTML());
  var offer = page.locator('#export-matches .match.good .note:has-text("Not this one?") button');
  check(name('a close runner-up is offered on the row'), (await offer.count()) === 1 && /\(II\)/.test(await offer.first().textContent()), await page.locator('#export-matches .match.good').innerHTML());
  await offer.first().click();
  await page.waitForFunction(function () { return /nature12373-twin/.test(document.querySelector('#export-matches .match .out code').textContent); }, null, { timeout: 5000 }).catch(function () {});
  await page.locator('#export-matches .match button:has-text("Free copy?")').first().click(); // the twin: Unpaywall lists only an unlicensed publisher copy
  await page.waitForSelector('#export-matches .match a.unsure', { timeout: 10000 }).catch(function () {});
  var unsure = page.locator('#export-matches .match a.unsure');
  check(name('a publisher-only unlicensed copy is offered as Maybe free, not Free PDF'), (await unsure.count()) === 1 && /Maybe free/.test(await unsure.textContent()) && /may be paywalled/.test(await unsure.getAttribute('title')) && (await page.locator('#export-matches .match a.free').count()) === 0, await page.locator('#export-matches .match .out').first().innerHTML());
  check(name('choosing the runner-up swaps the record'), /nature12373-twin/.test(await page.locator('#export-matches .match .out code').first().textContent()) && (await page.locator('#export-matches .match .note:has-text("Not this one?")').count()) === 0, await page.locator('#export-matches .match').first().innerHTML());
  await page.evaluate(function () { var s = document.getElementById('case-select'); s.value = 'title'; s.dispatchEvent(new Event('change', { bubbles: true })); }); // the control sits on the DOI tab
  await page.waitForSelector('#export-output details.case-changes', { timeout: 10000 });
  var caseWords = await page.locator('#export-output details.case-changes button').allTextContents();
  check(name('Title Case changes are listed under the reference list'), caseWords.length >= 3 && caseWords.indexOf('Thermometry') !== -1, caseWords.join(' '));
  await page.locator('#export-output details.case-changes summary').click();
  await page.locator('#export-output details.case-changes button', { hasText: 'Thermometry' }).click();
  await page.waitForFunction(function () { var d = document.querySelector('#export-output details.case-changes'); return !d || Array.prototype.every.call(d.querySelectorAll('button'), function (b) { return b.textContent !== 'Thermometry'; }); }, null, { timeout: 10000 });
  var listText = await page.locator('#export-output .reflist').textContent();
  check(name('clicking a word keeps the publisher\'s capital and drops it from the list'), /thermometry/.test(listText) && !/Thermometry/.test(listText), listText.slice(0, 200));
  await page.evaluate(function () { document.getElementById('clear-words').click(); var s = document.getElementById('case-select'); s.value = 'none'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#export-go');
  await page.waitForFunction(function () { return /good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  var marks = page.locator('#export-matches .match.good .in mark');
  check(name('the misspelt journal is marked in the pasted text with the record\'s spelling'), (await marks.count()) === 1 && /^Naturee$/.test(await marks.first().textContent()) && /nature/.test(await marks.first().getAttribute('title')), (await page.locator('#export-matches .match.good .in').innerHTML()).slice(0, 300));
  check(name('the wrong-paper row is not ticked and offers a fix box'), (await page.locator('#export-matches .match.bad, #export-matches .match.warn').count()) === 1 && (await page.locator('#export-matches .match.good input[type=checkbox]').first().isChecked()));
  var outText = await textOf('#export-output');
  check(name('export output holds the matched record'), /Kucsko/.test(outText) && /RIS|EndNote|BibTeX/.test(outText), outText.slice(0, 200));
  await axeCheck('Export tab with matches');

  // 8a. Diacritics typed in the reference are lent to a record that lacks them, and reach the exports
  await page.fill('#export-input', 'Kučsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., & Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. Nature, 500(7460), 54-58.');
  await page.click('#export-go');
  await page.waitForFunction(function () { return /good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  var lentText = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('#export-output textarea, #export-output pre, #export-output code'), function (e) { return e.value || e.textContent; }).join('\n') + '\n' + document.querySelector('#export-output').textContent; });
  check(name('a diacritic typed in the reference is lent to the record and reaches the exports'), /Kučsko/.test(lentText) && !/Kucsko/.test(lentText.replace(/kucsko\d*/gi, '')), lentText.slice(0, 200));
  check(name('the lent name is not marked as a difference'), (await page.locator('#export-matches .match.good .in mark').count()) === 0, await page.locator('#export-matches .match.good .in').innerHTML());
  // 8a2. A plain paste with UTF-8 read as Windows-1252 is repaired
  await page.fill('#export-input', '');
  await page.evaluate(function () {
    var ta = document.getElementById('export-input'), dt = new DataTransfer();
    dt.setData('text/plain', 'Ba\u00c4\u008dk, P., \u00c5\u00a0koda, R. (2026). Modraite \u00e2\u20ac\u201c Mal\u00c3\u00a9 Karpaty. American Mineralogist.');
    ta.focus(); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  check(name('garbled UTF-8 in a plain paste is repaired'), /Ba\u010dk, P\., \u0160koda, R\. \(2026\)\. Modraite \u2013 Mal\u00e9 Karpaty/.test(await page.inputValue('#export-input')), JSON.stringify(await page.inputValue('#export-input')));
  // 8b. A rich paste (Word, Google Docs) keeps its sub- and superscripts as Unicode; a plain paste is untouched
  await page.fill('#export-input', '');
  await page.evaluate(function () {
    var ta = document.getElementById('export-input'), dt = new DataTransfer();
    dt.setData('text/html', '<html><body><p class=MsoNormal>Uher, P. and Bačík, P., 2026. Modraite, Ca<sub>19</sub>Fe<sup>2+</sup>Al<sub>4</sub>(Al<sub>7</sub>Fe<sup>2+</sup>)(SiO<sub>4</sub>)<sub>10</sub>, a new mineral. <i>American Mineralogist</i>.<o:p></o:p></p><p class=MsoNormal>Second, R., 2020. Water, H<span style="vertical-align:sub">2</span>O. <i>Nature</i>.</p></body></html>');
    dt.setData('text/plain', 'Uher, P. and Bačík, P., 2026. Modraite, Ca19Fe2+Al4(Al7Fe2+)(SiO4)10, a new mineral. American Mineralogist.\r\nSecond, R., 2020. Water, H2O. Nature.');
    ta.focus(); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  var pasted = await page.inputValue('#export-input');
  check(name('a rich paste keeps sub- and superscripts as Unicode'), /Ca\u2081\u2089Fe\u00b2\u207aAl\u2084\(Al\u2087Fe\u00b2\u207a\)\(SiO\u2084\)\u2081\u2080/.test(pasted) && /H\u2082O/.test(pasted), JSON.stringify(pasted).slice(0, 200));
  check(name('a rich paste keeps its paragraphs as lines'), pasted.split('\n').filter(Boolean).length === 2 && !/<|MsoNormal/.test(pasted), JSON.stringify(pasted).slice(0, 200));
  await page.evaluate(function () {
    var ta = document.getElementById('export-input'), dt = new DataTransfer(); ta.value = '';
    dt.setData('text/html', '<p>Plain, P. (2020). No scripts here. <i>Journal</i>.</p>'); dt.setData('text/plain', 'Plain, P. (2020). No scripts here. Journal.');
    ta.focus(); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  check(name('a paste without scripts is left to the browser'), (await page.inputValue('#export-input')) === '', JSON.stringify(await page.inputValue('#export-input')));
  // Word puts a line break between paragraphs; a table's number column is a list number; hidden and struck text is dropped; a footnote after a DOI stays out of it
  await page.selectOption('#split-mode', 'auto');
  await page.evaluate(function () {
    var ta = document.getElementById('export-input'), dt = new DataTransfer(); ta.value = '';
    dt.setData('text/html', '<p class=MsoNormal>Smith, J. (2020). A long title about H<sub>2</sub>O in the</p>\r\n<p class=MsoNormal>deep mantle. Journal, 1, 1–5.</p>\r\n<p class=MsoNormal>Jones, K. (2019). Title<span style="display:none">DRAFT</span>. J 2:2. <del>peridotite</del><ins>eclogite</ins> https://doi.org/10.1038/nature12373<sup>2</sup></p>\r\n<table><tr><td>3</td><td>Brown, B. (2018). Water, H<sub>2</sub>O. J 3:3.</td></tr></table>');
    dt.setData('text/plain', 'x');
    ta.focus(); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  var wordPaste = await page.inputValue('#export-input');
  check(name('Word paragraphs paste as lines without blank lines between them'), wordPaste.split('\n').length === 4 && /in the\ndeep mantle/.test(wordPaste), JSON.stringify(wordPaste));
  check(name('hidden and struck text is dropped, a table number column becomes a list number, a footnote after a DOI stays out'), /Title\. J 2:2\. eclogite https:\/\/doi\.org\/10\.1038\/nature12373²$/m.test(wordPaste) && /^3\. Brown, B\. \(2018\)\. Water, H₂O\. J 3:3\.$/m.test(wordPaste), JSON.stringify(wordPaste));
  await page.waitForFunction(function () { return /3 references/.test(document.querySelector('#split-count').textContent); }, null, { timeout: 5000 }).catch(function () {});
  check(name('the pasted Word text splits into three references in automatic layout'), /^3 references/.test(await page.textContent('#split-count')), await page.textContent('#split-count'));
  await page.fill('#export-input', '');
  await page.selectOption('#split-mode', 'lines');
  // 9. File import: a RIS file and a BibTeX file are read directly, no lookup
  await page.fill('#export-input', '');
  var before = s.state.requests.length;
  await page.setInputFiles('#export-file-input', [
    { name: 'refs.ris', mimeType: 'application/x-research-info-systems', buffer: Buffer.from(RIS_FILE) },
    { name: 'refs.bib', mimeType: 'text/plain', buffer: Buffer.from(BIB_FILE) }
  ]);
  await page.waitForFunction(function () { return /records read from the file/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  status = await textOf('#export-status');
  check(name('file import reads both records'), /2 records read from the file/.test(status), status);
  var chips = await page.locator('#export-matches .match .chip').allTextContents();
  check(name('rows are labelled with their file type'), chips.some(function (c) { return /From RIS file/.test(c); }) && chips.some(function (c) { return /From BibTeX file/.test(c); }), chips.join(' | '));
  check(name('file import made no Crossref lookup'), !s.state.requests.slice(before).some(function (u) { return /api\.crossref|openalex/.test(u); }), s.state.requests.slice(before).join(', '));
  outText = await textOf('#export-output');
  check(name('export output holds both file records'), /Nanometre-scale thermometry/.test(outText) && /Attention is all you need/.test(outText) && /Vaswani/.test(outText), outText.slice(0, 300));
  check(name('the file input is cleared for the next pick'), (await page.inputValue('#export-file-input')) === '');
  var exportsText = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('#export-output textarea, #export-output pre, #export-output code'), function (e) { return e.value || e.textContent; }).join('\n'); });
  check(name('the database name from the RIS file is written back into the RIS export'), /DP {2}- JSTOR/.test(exportsText) && /AN {2}- 41403188/.test(exportsText), exportsText.slice(0, 300));
  // 9a. The order menu on a list of five: alphabetical unless asked, as given, or by year; numbers and year letters follow the order
  await page.fill('#export-input', '');
  await page.setInputFiles('#export-file-input', [{ name: 'order.ris', mimeType: 'application/x-research-info-systems', buffer: Buffer.from(ORDER_RIS) }]);
  await page.waitForFunction(function () { return /5 records read from the file/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  var KEYS = ['Mapping', 'Tides', 'Dunes', 'Zebra', 'Apple'];
  var listOrder = async function () { return (await page.locator('#export-output .reflist p').allTextContents()).map(function (t) { return KEYS.filter(function (k) { return t.indexOf(k) !== -1; })[0] || '?'; }).join(' '); };
  var orderIs = function (want) { return page.waitForFunction(function (a) { var ps = document.querySelectorAll('#export-output .reflist p'); return ps.length === 5 && Array.prototype.map.call(ps, function (p) { return a.keys.filter(function (k) { return p.textContent.indexOf(k) !== -1; })[0] || '?'; }).join(' ') === a.want; }, { keys: KEYS, want: want }, { timeout: 20000 }).then(function () { return true; }, function () { return false; }); };
  await page.selectOption('#list-style', 'apa');
  check(name('the style’s order is alphabetical for APA'), await orderIs('Dunes Apple Zebra Mapping Tides'), await listOrder());
  // Two Brown 2019 papers: a letter on the year, by title, in the list and in the in-text forms alike
  var brownLetters = async function () { return (await page.locator('#export-output .reflist p').allTextContents()).filter(function (t) { return /Brown/.test(t); }).map(function (t) { return (t.match(/\(2019[a-z]?\)/) || ['?'])[0] + ' ' + (t.match(/Apple|Zebra/) || ['?'])[0]; }).join(', '); };
  check(name('APA letters one author’s two papers in a year, by title'), (await brownLetters()) === '(2019a) Apple, (2019b) Zebra', await brownLetters());
  await page.check('#list-intext');
  await page.waitForSelector('#export-output .reflist .intext', { timeout: 5000 });
  var brownForms = (await page.locator('#export-output .reflist .intext .form').allTextContents()).filter(function (t) { return /Brown/.test(t); });
  check(name('the in-text forms carry the same letters'), brownForms.join(' | ') === '(Brown, 2019a) | Brown (2019a) | (Brown, 2019b) | Brown (2019b)', brownForms.join(' | '));
  var listRich = await richOf('#export-output .export .actions button:has-text("Rich")');
  check(name('the list’s Rich copies HTML with italics and the letters, without the in-text forms'), !!listRich && /<i>Journal of Field Notes<\/i>/.test(listRich[0]) && /\(2019a\)/.test(listRich[0]) && !/\(Brown, 2019a\)/.test(listRich[0]) && (listRich[0].match(/<p>/g) || []).length === 5, JSON.stringify(listRich).slice(0, 300));
  await page.uncheck('#list-intext');
  await page.waitForFunction(function () { return !document.querySelector('#export-output .reflist .intext'); }, null, { timeout: 5000 });
  await page.selectOption('#list-order', 'given');
  check(name('As given keeps the references in the order of the file'), await orderIs('Mapping Tides Dunes Zebra Apple'), await listOrder());
  await page.selectOption('#list-order', 'newest');
  check(name('Newest first sorts by year, by author within a year'), await orderIs('Apple Zebra Tides Dunes Mapping'), await listOrder());
  check(name('the order is remembered'), (await page.evaluate(function () { return localStorage.getItem('autodoi.listorder'); })) === 'newest');
  await page.selectOption('#list-order', 'oldest');
  check(name('Oldest first is the reverse by year'), await orderIs('Mapping Dunes Apple Zebra Tides'), await listOrder());
  await page.selectOption('#list-style', 'vancouver');
  check(name('a numbered style keeps the chosen order when the style changes'), (await page.inputValue('#list-order')) === 'oldest' && await orderIs('Mapping Dunes Apple Zebra Tides'), await listOrder());
  await page.selectOption('#list-order', 'newest');
  var vanc = await page.locator('#export-output .reflist p').allTextContents();
  check(name('a numbered style is numbered in the chosen order'), (await orderIs('Apple Zebra Tides Dunes Mapping')) && /^1\. Brown B\. Apple/.test((vanc = await page.locator('#export-output .reflist p').allTextContents())[0]) && /^5\. Mills C\. Mapping/.test(vanc[4]), vanc.join(' | '));
  await page.selectOption('#list-order', 'style');
  check(name('a numbered style’s own order is the order given'), await orderIs('Mapping Tides Dunes Zebra Apple'), await listOrder());
  if (cslReady) { // a journal style: its own sort is set aside, so the year letters follow the order shown
    await page.selectOption('#list-style', 'search');
    await page.fill('#list-style-search', 'cite them right');
    var harvardHit = page.locator('#export-output .list-find .hit.style').filter({ has: page.locator('.m', { hasText: /^harvard-cite-them-right( ·|$)/ }) }).first();
    await harvardHit.waitFor();
    await harvardHit.click();
    check(name('a journal style sorts the list itself, lettering one author’s year by title'), await orderIs('Dunes Apple Zebra Mapping Tides'), await listOrder());
    var letters = async function () { return (await page.locator('#export-output .reflist p').allTextContents()).filter(function (t) { return /Brown/.test(t); }).map(function (t) { return (t.match(/2019[a-z]/) || ['?'])[0] + ' ' + (t.match(/Apple|Zebra/) || ['?'])[0]; }).join(', '); };
    check(name('in the style’s order the first by title is 2019a'), (await letters()) === '2019a Apple, 2019b Zebra', await letters());
    await page.selectOption('#list-order', 'given');
    check(name('a journal style follows the order given'), await orderIs('Mapping Tides Dunes Zebra Apple'), await listOrder());
    check(name('and letters the year in that order'), (await letters()) === '2019a Zebra, 2019b Apple', await letters());
    await page.selectOption('#list-order', 'newest');
    check(name('a journal style goes newest first'), await orderIs('Apple Zebra Tides Dunes Mapping'), await listOrder());
    await page.selectOption('#list-style', 'search');
    await page.fill('#list-style-search', 'nature');
    var natureHit = page.locator('#export-output .list-find .hit.style').filter({ has: page.locator('.m', { hasText: /^nature( ·|$)/ }) }).first();
    await natureHit.waitFor();
    await natureHit.click();
    var nat = [];
    check(name('a numbered journal style is numbered newest first'), (await orderIs('Apple Zebra Tides Dunes Mapping')) && /^1\.\s*Brown/.test((nat = await page.locator('#export-output .reflist p').allTextContents())[0]) && /^5\.\s*Mills/.test(nat[4]), nat.join(' | '));
  }
  await page.selectOption('#list-order', 'style');
  await page.selectOption('#list-style', 'apa');
  await orderIs('Dunes Apple Zebra Mapping Tides');
  await page.locator('#split-details summary').click();
  await axeCheck('Export tab with file records and split list open');
  // 9b. A Word manuscript: the paragraphs after its References heading, and nothing else, land in the box and are matched
  await page.fill('#export-input', '');
  var beforeDocx = s.state.requests.length;
  await page.setInputFiles('#export-file-input', [{ name: 'manuscript.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'manuscript.docx')) }]);
  await page.waitForFunction(function () { return /Read 2 paragraphs/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  var docxText = await page.inputValue('#export-input');
  check(name('the manuscript gives up its two references and nothing else'), docxText === 'Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., & Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. Nature, 500(7460), 54-58.\nVaswani A, Shazeer N, Parmar N. Attention is all you need. Advances in Neural Information Processing Systems. 2017;30:5998-6008.', JSON.stringify(docxText));
  status = await textOf('#export-status');
  check(name('the status says where the references came from and matches them'), /Read 2 paragraphs after "References" in manuscript\.docx\. 1 good, 1 not matched/.test(status) && (await page.inputValue('#split-mode')) === 'lines', status);
  check(name('the document itself never left the browser'), !s.state.requests.slice(beforeDocx).some(function (u) { return /kernite|thermometry%20of/i.test(u); }));
  await page.fill('#export-input', '');
  // The Word reader inflates only the parts it reads, and refuses a file that says it is huge, before touching it; a dropped file's name
  // is shown on the page and never put in a bug report
  var issueHrefs = function () { return page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('a[href*="issues/new"]'), function (a) { return a.href; }); }); };
  var dropStatus = async function (fname, buf) {
    await page.evaluate(function () { document.getElementById('export-status').textContent = ''; }); // the last run's summary must not pass for this file's
    await page.setInputFiles('#export-file-input', [{ name: fname, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: buf }]);
    await page.waitForFunction(function (f) { return new RegExp(f.replace(/\./g, '\\.')).test(document.querySelector('#export-status').textContent) || /Read \d+ paragraphs/.test(document.querySelector('#export-status').textContent); }, fname, { timeout: 10000 });
    return textOf('#export-status');
  };
  var DOC_XML = '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>References</w:t></w:r></w:p><w:p><w:r><w:t>Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., &amp; Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. Nature, 500(7460), 54-58.</w:t></w:r></w:p></w:body></w:document>';
  status = await dropStatus('refused-huge.docx', zipOf([{ name: 'word/document.xml', data: Buffer.from(DOC_XML) }, { name: 'word/media/image1.png', data: Buffer.from('tiny'), usize: 100 * 1024 * 1024 }]));
  check(name('a Word file whose directory says it unpacks past 64 MB is refused, with its name on the page'), /^Could not read refused-huge\.docx: the file would unpack to more than 64 MB/.test(status) && (await page.inputValue('#export-input')) === '', status);
  status = await dropStatus('refused-many.docx', zipOf([{ name: 'word/document.xml', data: Buffer.from(DOC_XML) }], { count: 20000 }));
  check(name('a Word file claiming 20,000 parts is refused'), /^Could not read refused-many\.docx: the file holds more than 10,000 parts/.test(status), status);
  status = await dropStatus('not-a-zip.docx', Buffer.from('this is not a zip file at all'));
  check(name('a file that is not a zip is refused in words'), /^Could not read not-a-zip\.docx: not a zip file/.test(status), status);
  var hrefs = await issueHrefs();
  check(name('no dropped file name reaches a bug report link'), hrefs.length >= 1 && !hrefs.some(function (u) { return /refused-huge|refused-many|not-a-zip/.test(decodeURIComponent(u)); }), hrefs.map(decodeURIComponent).join(' | ').slice(0, 400));
  check(name('the error log still carries the read failure, without the name'), /file-read/.test(decodeURIComponent(await page.locator('#link-bug').getAttribute('href'))));
  status = await dropStatus('crafted.docx', zipOf([{ name: 'word/document.xml', data: Buffer.from(DOC_XML) }, { name: 'word/media/image1.png', data: Buffer.from('not really deflated'), method: 8 }]));
  await page.waitForFunction(function () { return /good|not matched/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  check(name('a part the reader does not need is never inflated: a garbage image beside a good document.xml does no harm'), /Read 1 paragraphs? after "References" in crafted\.docx/.test(await textOf('#export-status')) && /Nanometre-scale thermometry/.test(await page.inputValue('#export-input')), await textOf('#export-status'));
  await page.fill('#export-input', '');
  // 10. A retracted paper is flagged on the DOI tab and on a matcher row, with the notices, and the reference itself is left alone
  await page.click('#tab-cite');
  await page.fill('#doi-input', '10.1016/s0140-6736(97)11096-0');
  await page.click('#doi-go');
  await page.waitForFunction(function () { return /Wakefield/.test(document.querySelector('#doi-result').textContent) && /Copy/.test(document.querySelector('#doi-result').textContent); }, null, { timeout: 15000 });
  check(name('a retracted paper gets a red Retracted chip'), (await page.locator('#doi-result .record-head .chip.bad:has-text("Retracted")').count()) === 1, await page.locator('#doi-result .record-head').innerHTML());
  var noteText = await page.locator('#doi-result .update-note').textContent();
  check(name('the note names the retraction with its date and notice DOI'), /Retracted on 6 February 2010: 10\.1016\/s0140-6736\(10\)60175-4/.test(noteText), noteText);
  check(name('the note names the earlier correction too'), /Correction published 6 March 2004: 10\.1016\/s0140-6736\(04\)15715-2/.test(noteText), noteText);
  check(name('the notice DOI links through doi.org'), (await page.locator('#doi-result .update-note a[href="https://doi.org/10.1016/s0140-6736(10)60175-4"]').count()) === 1);
  check(name('the note is announced to screen readers'), (await page.locator('#doi-result .update-note').getAttribute('role')) === 'alert');
  var apaText = await page.locator('#doi-result .cite .text').first().textContent();
  check(name('the formatted reference is not rewritten'), /Wakefield/.test(apaText) && !/Retraction published/.test(apaText), apaText);
  await axeCheck('DOI tab with a retracted record');
  await page.click('#tab-export');
  await page.selectOption('#split-mode', 'lines');
  await page.fill('#export-input', 'Wakefield AJ, Murch SH. Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children. The Lancet. 1998;351(9103):637-641.');
  await page.click('#export-go');
  await page.waitForFunction(function () { return /good|not matched/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  status = await textOf('#export-status');
  check(name('the status line counts the retracted row'), /1 retracted/.test(status), status);
  check(name('the matcher row carries the Retracted chip and the note'), (await page.locator('#export-matches .match .chip.bad:has-text("Retracted")').count()) === 1 && /Retracted on 6 February 2010/.test(await page.locator('#export-matches .match .update-note').textContent()), await page.locator('#export-matches').innerHTML());
  check(name('the retracted row is still ticked: citing it is the writer\'s call'), await page.locator('#export-matches .match input[type=checkbox][id^=inc-]').isChecked());
  await page.waitForFunction(function () { return !/Adding journal abbreviations/.test(document.querySelector('#export-status').textContent); }, null, { timeout: 15000 });
  await page.selectOption('#list-style', 'vancouver');
  await page.waitForFunction(function () { return /Wakefield AJ/.test(document.querySelector('#export-output .reflist').textContent); }, null, { timeout: 5000 });
  var vancText = await page.locator('#export-output .reflist').textContent();
  check(name('Vancouver abbreviates the journal from the NLM Catalog, found by title'), /children\. Lancet\. 1998 Feb;351\(9103\):637-41\./.test(vancText) && !/The Lancet/.test(vancText), vancText);
  check(name('the catalogue was asked by title, then for the summary'), s.state.requests.some(function (u) { return /esearch\.fcgi\?.*Lancet/.test(u); }) && s.state.requests.some(function (u) { return /esummary\.fcgi\?.*id=2985213R/.test(u); }), s.state.requests.filter(function (u) { return /eutils/.test(u); }).join(', '));
  await page.selectOption('#list-style', 'apa');
  await axeCheck('Export tab with a retracted row');
  // 11. The list comes back on the next visit, rebuilt from memory with no lookup; ticks are remembered; a link rebuilds it from its DOIs
  var beforeReload = s.state.requests.length;
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(function () { return /good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 15000 });
  status = await textOf('#export-status');
  check(name('the last list is back and rebuilt at once'), /Your list from last time/.test(status) && /1 good/.test(status) && /Wakefield/.test(await page.inputValue('#export-input')), status);
  check(name('rebuilding it made no lookup'), !s.state.requests.slice(beforeReload).some(function (u) { return /api\.crossref\.org|api\.openalex\.org\/works\?/.test(u); }), s.state.requests.slice(beforeReload).filter(function (u) { return /crossref|openalex/.test(u); }).join(', ')); // the free-copy lookup for the DOI tab's record may still ask OpenAlex
  check(name('the rebuilt row keeps its record and its retraction flag'), (await page.locator('#export-matches .match.good').count()) === 1 && (await page.locator('#export-matches .match .chip.bad:has-text("Retracted")').count()) === 1);
  await page.locator('#export-matches .match').first().click({ position: { x: 10, y: 6 } });
  await page.waitForFunction(function () { return !document.querySelector('#export-zone'); }, null, { timeout: 5000 });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(function () { return /good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 15000 });
  check(name('an unticked row stays unticked after a reload'), !(await page.locator('#export-matches .match input[type=checkbox][id^=inc-]').isChecked()) && (await page.locator('#export-zone').count()) === 0);
  await page.locator('#export-matches .match').first().click({ position: { x: 10, y: 6 } });
  await page.waitForSelector('#export-zone', { timeout: 5000 });
  await page.locator('#export-zone button:has-text("Copy link")').click();
  clip = await page.evaluate(function () { return navigator.clipboard.readText(); });
  check(name('Copy link carries the DOIs of the ticked rows and nothing pasted'), clip === base + '?refs=' + encodeURIComponent('10.1016/s0140-6736(97)11096-0'), clip);
  await page.goto(clip, { waitUntil: 'load' });
  await page.waitForFunction(function () { return /good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 15000 });
  check(name('the link opens the References tab with the list rebuilt from its DOIs'), (await page.getAttribute('#tab-export', 'aria-selected')) === 'true' && /1 good/.test(await textOf('#export-status')) && (await page.locator('#export-matches .match .chip:has-text("From DOI")').count()) === 1 && (await page.locator('#export-zone').count()) === 1, await textOf('#export-status'));
  // the list that was in the box before the link opened is not lost: the summary offers it back
  var restore = page.locator('#export-status button:has-text("Restore previous list")');
  check(name('a link over a remembered list says so and offers the old list back'), (await restore.count()) === 1 && /This link replaced the list you had/.test(await textOf('#export-status')), await textOf('#export-status'));
  await restore.click();
  await page.waitForFunction(function () { return /Wakefield AJ/.test(document.getElementById('export-input').value) && /good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 15000 });
  check(name('Restore puts the pasted list back and runs it again'), /^Wakefield AJ, Murch SH\./.test(await page.inputValue('#export-input')) && (await page.locator('#export-status button:has-text("Restore previous list")').count()) === 0 && (await page.locator('#export-matches .match.good').count()) === 1, await textOf('#export-status'));
  await page.goto(clip, { waitUntil: 'load' });
  await page.waitForFunction(function () { return /good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 15000 });
  if (cslReady) { // a link in a journal list style this browser has never used: the style still comes up, named from its file, and is remembered once it renders
    var recentNames = function () { return page.evaluate(function () { return JSON.parse(localStorage.getItem('autodoi.cslrecent') || '[]').map(function (r) { return r.name + '=' + r.title; }); }); };
    var listDone = function (re) { return page.waitForFunction(function (src) { var l = document.querySelector('#export-output .reflist'); return l && !/Rendering/.test(l.textContent) && new RegExp(src).test(l.textContent); }, re, { timeout: 20000 }); };
    await page.evaluate(function () { localStorage.removeItem('autodoi.cslrecent'); localStorage.removeItem('autodoi.liststyle'); });
    await page.goto(clip + '&list=csl:nature-geoscience', { waitUntil: 'load' });
    await page.waitForFunction(function () { var o = document.querySelector('#list-style option:checked'); return o && o.textContent === 'Nature Geoscience' && /Wakefield, A\. J\. & Murch, S\. H\./.test(document.querySelector('#export-output .reflist').textContent); }, null, { timeout: 20000 });
    check(name('a link with an unused journal list style opens the list in it'), (await page.inputValue('#list-style')) === 'csl:nature-geoscience', await page.inputValue('#list-style'));
    check(name('the style from the link is remembered, by its title, once it has rendered'), (await recentNames()).join() === 'nature-geoscience=Nature Geoscience', (await recentNames()).join());
    check(name('the list style from the link is kept for next time once it has rendered'), (await page.evaluate(function () { return localStorage.getItem('autodoi.liststyle'); })) === 'csl:nature-geoscience');
    await page.goto(clip + '&list=csl:no-such-style&order=oldest', { waitUntil: 'load' });
    await listDone('Could not load');
    check(name('a mistyped style in a link says so and is not remembered'), (await recentNames()).join() === 'nature-geoscience=Nature Geoscience', (await recentNames()).join());
    var kept = await page.evaluate(function () { return [localStorage.getItem('autodoi.liststyle'), localStorage.getItem('autodoi.listorder')].join(' '); });
    check(name('a style that does not render, and the order beside it, are not kept for next time'), !/no-such-style/.test(kept) && !/oldest/.test(kept), kept);
    // twelve remembered: a thirteenth picked in the list's search drops the oldest, which the list's menu still offers and still renders
    await page.evaluate(function () { var r = []; for (var k = 0; k < 11; k++) r.push({ name: 'fake-' + k, title: 'Fake ' + k }); r.push({ name: 'nature', title: 'Nature' }); localStorage.setItem('autodoi.cslrecent', JSON.stringify(r)); localStorage.setItem('autodoi.liststyle', 'csl:nature'); });
    await page.goto(clip, { waitUntil: 'load' });
    await listDone('Wakefield');
    await page.selectOption('#list-style', 'search');
    await page.fill('#list-style-search', 'nature geoscience');
    var capHit = page.locator('#export-output .list-find .hit.style').filter({ has: page.locator('.m', { hasText: /^nature-geoscience( ·|$)/ }) }).first();
    await capHit.waitFor(); await capHit.click();
    await listDone('Nature Geoscience|Wakefield');
    await page.selectOption('#list-style', 'csl:nature');
    await listDone('Wakefield');
    check(name('a style dropped from the twelve still renders from the list menu'), /Lancet 351/.test(await page.locator('#export-output .reflist').textContent()), await page.locator('#export-output .reflist').textContent()); // the Nature style prints the abbreviated journal, from the mocked NLM Catalog
    await page.selectOption('#list-style', 'apa');
  }
  // 12. Editing a record, and writing one by hand
  await page.click('#tab-cite');
  check(name('the record offers an Edit button'), (await page.locator('#doi-result .record-head button:has-text("Edit")').count()) === 1);
  await page.locator('#doi-result .record-head button:has-text("Edit")').click();
  await page.waitForSelector('#doi-result form.edit-form', { timeout: 5000 });
  check(name('the form opens on the record\'s fields with the title focused'), (await page.inputValue('#doi-result form.edit-form input[name=title]')).indexOf('Ileal-lymphoid') !== -1 && (await page.inputValue('#doi-result form.edit-form input[name=year]')) === '1998' && (await page.evaluate(function () { return document.activeElement.name; })) === 'title');
  await axeCheck('DOI tab with the edit form open');
  check(name('the form has no Apply button'), (await page.locator('#doi-result form.edit-form button:has-text("Apply")').count()) === 0 && (await page.locator('#doi-result form.edit-form button:has-text("Done")').count()) === 1);
  await page.fill('#doi-result form.edit-form input[name=title]', 'A corrected title');
  await page.waitForFunction(function () { return /A corrected title/.test(document.querySelector('#doi-result .cite .text').textContent); }, null, { timeout: 5000 });
  check(name('the reference follows as you type, with the form still open and the title box still focused'), (await page.locator('#doi-result form.edit-form').count()) === 1 && (await page.evaluate(function () { return document.activeElement.name; })) === 'title');
  await page.fill('#doi-result form.edit-form input[name=year]', '1999');
  await page.fill('#doi-result form.edit-form textarea[name=authors]', 'Wakefield, A. J.\nWorld Health Organization');
  await page.waitForFunction(function () { return /World Health Organization\. \(1999\)/.test(document.querySelector('#doi-result .cite .text').textContent); }, null, { timeout: 5000 });
  var apaEdited = await page.locator('#doi-result .cite .text').first().textContent();
  check(name('each change rebuilds the record: new title, year and an organisation author, chip says Edited'), /Wakefield, A\. J\., & World Health Organization\. \(1999\)\. A corrected title\./.test(apaEdited) && (await page.locator('#doi-result .record-head .chip:has-text("Edited")').count()) === 1, apaEdited);
  check(name('the edit keeps the retraction notices'), (await page.locator('#doi-result .record-head .chip.bad:has-text("Retracted")').count()) === 1);
  await page.locator('#doi-result form.edit-form button:has-text("Done")').click();
  await page.waitForFunction(function () { return !document.querySelector('#doi-result form.edit-form'); }, null, { timeout: 5000 });
  check(name('Done closes the editor and keeps the edited record'), /A corrected title/.test(await page.locator('#doi-result .cite .text').first().textContent()));
  await page.locator('#doi-result .record-head .meta').click({ position: { x: 4, y: 4 } });
  await page.waitForSelector('#doi-result form.edit-form', { timeout: 5000 });
  check(name('a click on the byline opens the editor on the authors'), (await page.evaluate(function () { return document.activeElement.name; })) === 'authors');
  await page.locator('#doi-result form.edit-form button:has-text("Done")').click();
  await page.waitForFunction(function () { return !document.querySelector('#doi-result form.edit-form'); }, null, { timeout: 5000 });
  await page.click('#tab-export');
  check(name('the edit went back into the matcher row it came from'), /A corrected title/.test(await page.locator('#export-matches .match').first().textContent()) && (await page.locator('#export-matches .match .chip:has-text("Edited")').count()) === 1 && /A corrected title/.test(await page.locator('#export-output .reflist').textContent()), await page.locator('#export-matches .match').first().textContent());
  await page.click('#tab-cite');
  check(name('Write a reference by hand sits below the result, not under the search box'), await page.evaluate(function () { var h = document.querySelector('.by-hand-line').getBoundingClientRect(), r = document.querySelector('#doi-result').getBoundingClientRect(), f = document.querySelector('#form-cite').getBoundingClientRect(); return h.top >= r.bottom && h.top - f.bottom > 100; }));
  await page.click('#cite-by-hand');
  await page.waitForSelector('#doi-result form.edit-form', { timeout: 5000 });
  check(name('By hand opens an empty form and no styles yet'), (await page.inputValue('#doi-result form.edit-form input[name=title]')) === '' && (await page.locator('#doi-result .cite').count()) === 0 && (await page.locator('#doi-result .record-head .chip:has-text("By hand")').count()) === 1);
  await page.selectOption('#doi-result form.edit-form select[name=kind]', 'web');
  await page.fill('#doi-result form.edit-form input[name=title]', 'Privacy policy');
  await page.fill('#doi-result form.edit-form textarea[name=authors]', 'Google');
  await page.fill('#doi-result form.edit-form input[name=container]', 'Privacy & Terms');
  await page.fill('#doi-result form.edit-form input[name=year]', '2023'); await page.fill('#doi-result form.edit-form input[name=month]', '11'); await page.fill('#doi-result form.edit-form input[name=day]', '15');
  await page.fill('#doi-result form.edit-form input[name=url]', 'https://policies.google.com/privacy');
  await page.waitForFunction(function () { return /policies\.google\.com/.test(document.querySelector('#doi-result').textContent) && document.querySelectorAll('#doi-result .cite').length > 0; }, null, { timeout: 5000 });
  var apaHand = await page.locator('#doi-result .cite .text').first().textContent();
  check(name('a web page written by hand formats in APA with its full date and URL'), /^Google\. \(2023, November 15\)\. Privacy policy\. Privacy & Terms\. https:\/\/policies\.google\.com\/privacy/.test(apaHand), apaHand);
  check(name('no lookup was made for a reference written by hand'), !s.state.requests.slice(beforeReload).some(function (u) { return /api\.crossref\.org\/works\?|openalex\.org\/works\?/.test(u); }));
  var handReport = await page.locator('#doi-result a:has-text("Report it")').getAttribute('href');
  check(name('the Report it link under a hand-written record carries no title of yours'), /issues\/new\?template=bug_report\.yml/.test(handReport) && !/Privacy/.test(decodeURIComponent(handReport)) && !(await issueHrefs()).some(function (u) { return /Privacy|Google/.test(decodeURIComponent(u)); }), decodeURIComponent(handReport).slice(0, 300));
  await page.click('#tab-export'); await page.fill('#export-input', ''); // leave nothing behind for the next flow in this context
  await page.evaluate(function () { try { localStorage.removeItem('autodoi.batch'); } catch (e) {} });
  // 13. A line that is only a title is looked up by title, as on Find a DOI; a list of titles splits one per line
  await page.selectOption('#split-mode', 'auto');
  await page.fill('#export-input', 'Nanometre-scale thermometry in a living cell\nMolecular structure of nucleic acids');
  await page.waitForFunction(function () { return /2 references/.test(document.querySelector('#split-count').textContent); }, null, { timeout: 5000 }).catch(function () {});
  check(name('two bare titles split one per line in automatic layout'), /^2 references/.test(await textOf('#split-count')), await textOf('#split-count'));
  var beforeTitles = s.state.requests.length;
  await page.click('#export-go');
  await page.waitForFunction(function () { return /good|not matched/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  status = await textOf('#export-status');
  check(name('one title is found and the other is not'), /1 good/.test(status) && /1 not matched/.test(status), status);
  var titleRow = page.locator('#export-matches .match').first();
  check(name('an exact title is green, Found by title, and in the export'), (await titleRow.locator('.chip:has-text("Found by title")').count()) === 1 && /\bgood\b/.test(await titleRow.getAttribute('class')) && (await titleRow.locator('input[type=checkbox][id^=inc-]').isChecked()) && /10\.1038\/nature12373/.test(await titleRow.textContent()), await titleRow.innerHTML().then(function (h) { return h.slice(0, 300); }));
  check(name('a title with nothing close is red with a title chip and a fix box'), (await page.locator('#export-matches .match.bad .chip:has-text("Weak title match")').count()) === 1 && (await page.locator('#export-matches .match.bad .fixrow input[type=text]').count()) === 1);
  var titleCalls = s.state.requests.slice(beforeTitles).filter(function (u) { return /api\.crossref\.org\/works\?.*Nanometre/.test(u); });
  check(name('an exact title costs one Crossref search'), titleCalls.length === 1, titleCalls.join(', '));
  check(name('an exact title folds its other matches away'), (await titleRow.locator('.hits details summary:has-text("Other matches (1)")').count()) === 1 && !(await titleRow.locator('.hits details').first().evaluate(function (d) { return d.open; })));
  var badRow = page.locator('#export-matches .match.bad');
  check(name('a title with nothing close lists the candidates open, with a chip each'), (await badRow.locator('.hits .hit.pickable').count()) === 2 && (await badRow.locator('.hits .hit .chip:has-text("Weak")').count()) === 2 && (await badRow.locator('.hits details').count()) === 0);
  await axeCheck('References tab with title rows');
  await badRow.locator('.hits .hit').nth(1).locator('button.pick').click();
  await page.waitForFunction(function () { return document.querySelectorAll('#export-matches .match.good').length === 2; }, null, { timeout: 5000 });
  var pickedRow = page.locator('#export-matches .match').nth(1);
  check(name('a picked candidate makes the row green as Your pick, ticked, with the list folded'), (await pickedRow.locator('.chip:has-text("Your pick")').count()) === 1 && (await pickedRow.locator('input[type=checkbox][id^=inc-]').isChecked()) && /nature12373-twin/.test(await pickedRow.textContent()) && (await pickedRow.locator('.hits details summary').count()) === 1 && (await pickedRow.locator('.fixrow input[type=text]').count()) === 0);
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(function () { return /good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 15000 });
  check(name('the title rows come back with their pick and their lists'), /2 good/.test(await textOf('#export-status')) && (await page.locator('#export-matches .match .chip:has-text("Your pick")').count()) === 1 && (await page.locator('#export-matches .match .hits').count()) === 2, await textOf('#export-status'));
  // An OpenAlex hit picked under a title row is kept as Crossref's record for its DOI: the authors as deposited, and its retraction
  await page.evaluate(function () { try { localStorage.removeItem('autodoi.batch'); } catch (e) {} });
  var runRefs = async function (text) {
    await page.fill('#export-input', text); await page.click('#export-go');
    await page.waitForFunction(function () { return /good|check|not matched/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  };
  await runRefs('thermometry');
  var oaHit = page.locator('#export-matches .match .hits .hit').filter({ hasText: 'Ileal-lymphoid' });
  check(name('a one-word title lists the OpenAlex hit among its candidates'), (await oaHit.count()) === 1, await page.locator('#export-matches').textContent());
  await oaHit.locator('button.pick').click();
  await page.waitForFunction(function () { return /Your pick/.test(document.querySelector('#export-matches .match').textContent); }, null, { timeout: 10000 });
  check(name('a picked OpenAlex hit becomes Crossref\'s record, with its retraction and its authors as deposited'), (await page.locator('#export-matches .match .chip.bad:has-text("Retracted")').count()) === 1 && /Wakefield, A\. J\., & Murch, S\. H\./.test(await page.locator('#export-output .reflist').textContent()), await page.locator('#export-output .reflist').textContent());
  // A one-word title before a journal is a guessed split: the whole line is searched too, and an exact one-word title waits for a pick
  var beforeGuess = s.state.requests.length;
  await runRefs('Learning, Memory and Cognition');
  var guessRow = page.locator('#export-matches .match').first();
  check(name('an exact match on a guessed one-word title is amber, with its candidates open'), /\bwarn\b/.test(await guessRow.getAttribute('class')) && (await guessRow.locator('.hits .note:has-text("Which paper?")').count()) === 1 && /learning-one-word/.test(await guessRow.textContent()), await guessRow.textContent());
  check(name('the whole line is searched as well'), s.state.requests.slice(beforeGuess).some(function (u) { return /query\.bibliographic=Learning%20Memory%20and%20Cognition/.test(u); }), s.state.requests.slice(beforeGuess).filter(function (u) { return /crossref/.test(u); }).join(', '));
  // Storage full: the remembered list gives up its candidate lists and keeps the rest
  await page.evaluate(function () { var orig = Storage.prototype.setItem; window.__setItem = orig; Storage.prototype.setItem = function (k, v) { if (k === 'autodoi.batch' && /"hits"/.test(v)) throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); }; });
  await guessRow.click({ position: { x: 10, y: 6 } }); // a tick: the memory saves a moment later
  var saved = await page.waitForFunction(function () { var v = localStorage.getItem('autodoi.batch') || ''; return !/"hits"/.test(v) && /learning-one-word/.test(v); }, null, { timeout: 5000 }).then(function () { return true; }, function () { return false; });
  check(name('with storage full, the list is still remembered without its candidate lists'), saved);
  await page.evaluate(function () { Storage.prototype.setItem = window.__setItem; });
  // --- the 2026-10 page-logic audit: grading, the network and the list ---
  var KUCSKO = 'Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., & Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. Nature, 500(7460), 54-58.';
  var crRequests = function (from, re) { return s.state.requests.slice(from).filter(function (u) { return /api\.crossref\.org/.test(u) && re.test(u); }).length; };
  // 1. Crossref lists a Dryad dataset before the paper: the paper wins
  await runRefs('Dataset first. ' + KUCSKO);
  check(name('a dataset listed first does not beat the paper'), (await page.locator('#export-matches .match.good').count()) === 1 && /10\.1038\/nature12373/.test(await page.locator('#export-matches .match .out code').first().textContent()) && !/dryad/.test(await page.locator('#export-matches .match .out code').first().textContent()), await page.locator('#export-matches .match').first().textContent());
  // 1b. the edited book outscores the chapter the reference cites by its pages: the chapter of that book is the one cited
  await runRefs('Chapter probe. Bailey S.W. (1988) Chlorites: structures and crystal chemistry. Hydrous Phyllosilicates (Exclusive of Micas). Reviews in Mineralogy, 19. Washington, D.C., Mineralogical Society of America, 347\u2013403.');
  check(name('a chapter cited by its pages beats the book it is in'), (await page.locator('#export-matches .match.good').count()) === 1 && /9781501508998-015/.test(await page.locator('#export-matches .match .out code').first().textContent()), await page.locator('#export-matches .match .out code').first().textContent());
  // 2. an OpenAlex work merged under another paper's DOI: Crossref's record is graded afresh, so the other paper is not green
  await runRefs('Merged probe. Brown, T. (2018). Olivine rheology under lower mantle conditions. Science, 3, 5-6.');
  check(name('an OpenAlex DOI that resolves to another paper is not green'), (await page.locator('#export-matches .match.good').count()) === 0 && (await page.locator('#export-matches .match.bad, #export-matches .match.warn').count()) === 1, await page.locator('#export-matches .match').first().innerHTML().then(function (h) { return h.slice(0, 400); }));
  // 3. an erratum's DOI after the paper's own reference: amber, Check DOI, the record and the fix box kept
  await runRefs(KUCSKO + ' https://doi.org/10.1016/erratum-x');
  var errRow = page.locator('#export-matches .match').first();
  check(name('an erratum DOI inside a reference drops to amber with a Check DOI chip'), /\bwarn\b/.test(await errRow.getAttribute('class')) && (await errRow.locator('.chip:has-text("Check DOI")').count()) === 1 && /erratum-x/.test(await errRow.locator('.out code').textContent()) && (await errRow.locator('.fixrow input[type=text]').count()) === 1 && !(await errRow.locator('input[type=checkbox][id^=inc-]').isChecked()), await errRow.innerHTML().then(function (h) { return h.slice(0, 400); }));
  await runRefs(KUCSKO + ' https://doi.org/10.1038/nature12373');
  check(name('the paper\'s own DOI inside its reference is still green'), (await page.locator('#export-matches .match.good .chip:has-text("From DOI")').count()) === 1);
  // 3b. the same reference twice: the second copy is flagged and left out of the list
  await runRefs(KUCSKO + '\n' + KUCSKO);
  var dupChip = page.locator('#export-matches .match .chip.warn:has-text("Duplicate of #1")');
  check(name('a reference pasted twice gets a Duplicate chip on the second row and one entry in the list'), (await page.locator('#export-matches .match.good').count()) === 2 && (await dupChip.count()) === 1 && (await dupChip.isVisible()) && (await page.locator('#export-matches .match').nth(1).locator('.chip:has-text("Duplicate")').count()) === 1 && (await page.locator('#export-output .reflist p').count()) === 1, await page.locator('#export-matches').textContent());
  // 3c. an arXiv ID resolves to its preprint record, which names the published version; Swap takes it
  await runRefs('arXiv:1706.03762');
  var preRow = page.locator('#export-matches .match').first();
  check(name('an arXiv ID is a From DOI row flagged as a preprint with its published version'), (await preRow.locator('.chip:has-text("From DOI")').count()) === 1 && /Preprint; published version: 10\.1038\/nature12373/.test(await preRow.textContent()) && (await preRow.locator('button:has-text("Swap")').count()) === 1 && /\[Preprint\]|arXiv/.test(await page.locator('#export-output .reflist').textContent()), await preRow.textContent());
  await preRow.locator('button:has-text("Swap")').click();
  await page.waitForFunction(function () { return /Nanometre-scale thermometry/.test(document.querySelector('#export-matches .match').textContent); }, null, { timeout: 10000 });
  check(name('Swap replaces the preprint with the published record'), /10\.1038\/nature12373/.test(await preRow.locator('.out code').first().textContent()) && !/Preprint;/.test(await preRow.textContent()) && /Kucsko, G\./.test(await page.locator('#export-output .reflist').textContent()), await preRow.textContent());
  // 4. a bare number in a list is debris, not a PubMed ID; alone it is one
  var pmBefore = s.state.requests.length;
  await page.fill('#export-input', KUCSKO + '\n23903748\nVaswani A, Shazeer N, Parmar N. Attention is all you need. Advances in Neural Information Processing Systems. 2017;30:5998-6008.');
  await page.waitForFunction(function () { return /references found/.test(document.querySelector('#split-count').textContent); }, null, { timeout: 5000 }).catch(function () {});
  check(name('a bare number between two references is not a reference'), /^2 references/.test(await textOf('#split-count')), await textOf('#split-count'));
  await page.fill('#export-input', 'PMID: 23903748\n' + KUCSKO);
  await page.waitForFunction(function () { return /^2 references/.test(document.querySelector('#split-count').textContent); }, null, { timeout: 5000 }).catch(function () {});
  check(name('a prefixed PubMed ID in a list is a reference'), /^2 references/.test(await textOf('#split-count')), await textOf('#split-count'));
  await page.fill('#export-input', '23903748');
  await page.waitForFunction(function () { return /^1 reference/.test(document.querySelector('#split-count').textContent); }, null, { timeout: 5000 }).catch(function () {});
  check(name('a bare PubMed ID alone is still a lookup'), /^1 reference/.test(await textOf('#split-count')), await textOf('#split-count'));
  check(name('the preview looked nothing up'), !s.state.requests.slice(pmBefore).some(function (u) { return /europepmc/.test(u); }));
  // 11. Crossref answers 429 twice, Retry-After 1 s: the row says Retrying… and comes good on the third try
  var retryFrom = s.state.requests.length;
  await page.fill('#export-input', 'Retry probe. ' + KUCSKO); await page.click('#export-go');
  var sawRetry = await page.waitForFunction(function () { return /Retrying/.test(document.querySelector('#export-matches').textContent); }, null, { timeout: 5000 }).then(function () { return true; }, function () { return false; });
  await page.waitForFunction(function () { return /good|check|not matched/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  check(name('a 429 is retried after Retry-After, with Retrying… on the row meanwhile'), sawRetry && (await page.locator('#export-matches .match.good').count()) === 1 && crRequests(retryFrom, /Retry%20probe/) === 3, 'saw ' + sawRetry + ', ' + crRequests(retryFrom, /Retry%20probe/) + ' calls, ' + await textOf('#export-status'));
  // 12. OpenAlex 429: a burst limit is a pause in memory; a spent daily allowance blocks the day and is remembered
  await page.evaluate(function () { try { localStorage.removeItem('autodoi.oaBlocked'); } catch (e) {} });
  await runRefs('Pause probe. Brown, T. (2018). Olivine rheology under lower mantle conditions. Science, 3, 5-6.');
  var oaBlocked = await page.evaluate(function () { return localStorage.getItem('autodoi.oaBlocked'); });
  check(name('an OpenAlex burst 429 is not remembered as the day\'s allowance'), !oaBlocked && (await page.locator('#oa-notice').isHidden()), 'oaBlocked=' + oaBlocked);
  await page.waitForTimeout(1300); // the pause asked for
  await runRefs('Quota probe. Brown, T. (2018). Olivine rheology under lower mantle conditions. Science, 3, 5-6.');
  oaBlocked = Number(await page.evaluate(function () { return localStorage.getItem('autodoi.oaBlocked'); }));
  check(name('a spent OpenAlex daily allowance blocks until midnight UTC, with the notice'), oaBlocked > Date.now() + 1000 && oaBlocked <= Date.now() + 86400000 && (await page.locator('#oa-notice').isVisible()), 'oaBlocked=' + oaBlocked);
  await page.evaluate(function () { try { localStorage.removeItem('autodoi.oaBlocked'); } catch (e) {} });
  // 14. a resubmit while a batch runs (a dropped file, a shared link) abandons that batch's look-ahead lookups, so the new batch is not queued behind them
  await page.fill('#export-input', 'Slow probe 1. ' + KUCSKO + '\nSlow probe 2. ' + KUCSKO + '\nSlow probe 3. ' + KUCSKO); await page.click('#export-go');
  await page.waitForFunction(function () { return document.querySelectorAll('#export-matches .match').length >= 1; }, null, { timeout: 5000 });
  var t0 = Date.now();
  await page.fill('#export-input', KUCSKO);
  await page.evaluate(function () { document.getElementById('form-export').requestSubmit(); }); // the Match button is disabled while a batch runs; a file drop submits this way
  await page.waitForFunction(function () { return /good|check|not matched/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  var took = Date.now() - t0;
  check(name('a resubmit is not kept waiting behind the abandoned batch'), took < 7000 && (await page.locator('#export-matches .match').count()) === 1 && (await page.locator('#export-matches .match.good').count()) === 1, took + ' ms, ' + await textOf('#export-status'));
  // 13. Copy link holds at most 7,500 characters of DOIs and says so; 15. a layout set by the link does not outlive the run
  await page.selectOption('#split-mode', 'auto');
  var longDois = []; for (var li = 0; li < 20; li++) longDois.push('10.5555/long-' + '\u00e9'.repeat(60) + (li < 10 ? '0' : '') + li);
  await page.goto(base + '?refs=' + longDois.map(encodeURIComponent).join(','), { waitUntil: 'load' });
  await page.waitForFunction(function () { return /20 good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  await page.waitForSelector('#export-zone', { timeout: 5000 });
  await page.locator('#export-zone button:has-text("Copy link")').click();
  var longLink = await page.evaluate(function () { return navigator.clipboard.readText(); });
  var linkCount = (longLink.split('?refs=')[1] || '').split('&')[0].split(',').length;
  check(name('Copy link is capped at 7,500 characters and says first N of M'), longLink.length <= 7500 && linkCount === 19 && (await page.locator('#export-zone .zone-sub:has-text("Link: first 19 of 20 DOIs")').count()) === 1 && /first 19 of 20 DOIs/.test(await page.locator('#export-zone button:has-text("Copy link")').getAttribute('title')), longLink.length + ' chars, ' + linkCount + ' DOIs');
  check(name('the layout the link set for its run does not stay'), (await page.inputValue('#split-mode')) === 'auto', await page.inputValue('#split-mode'));
  // 16. a ?q= deep link with an arXiv ID: the preprint on the DOI tab, with the way to its published version
  await page.goto(base + '?q=arXiv:1706.03762', { waitUntil: 'load' });
  await page.waitForFunction(function () { return /Vaswani/.test(document.querySelector('#doi-result').textContent) && /Copy/.test(document.querySelector('#doi-result').textContent); }, null, { timeout: 15000 });
  var preText = await page.locator('#doi-result .cite .text').first().textContent();
  check(name('?q=arXiv: resolves the ID to its DOI and renders the preprint'), (await page.inputValue('#doi-input')) === '10.48550/arXiv.1706.03762' && /^Vaswani, A\., & Shazeer, N\. \(2017\)\. Attention is all you need\. arXiv\. https:\/\/doi\.org\/10\.48550\/arXiv\.1706\.03762/.test(preText), preText);
  check(name('the DOI tab names the published version with a button to use it'), /This is a preprint\. Published version: 10\.1038\/nature12373/.test(await textOf('#doi-result')) && (await page.locator('#doi-result button:has-text("Use published version")').count()) === 1, await textOf('#doi-result'));
  await page.locator('#doi-result button:has-text("Use published version")').click();
  await page.waitForFunction(function () { return /Kucsko/.test(document.querySelector('#doi-result').textContent); }, null, { timeout: 15000 });
  check(name('Use published version swaps the record on the DOI tab'), (await page.inputValue('#doi-input')) === '10.1038/nature12373' && !/This is a preprint/.test(await textOf('#doi-result')));
  await page.click('#tab-export');
  await page.evaluate(function () { try { localStorage.removeItem('autodoi.batch'); } catch (e) {} });
  await page.fill('#export-input', ''); await page.selectOption('#split-mode', 'lines');
  await page.evaluate(function () { try { localStorage.removeItem('autodoi.batch'); } catch (e) {} });
  check(name('no page errors at the end'), s.state.errors.length === 0, s.state.errors.join(' | '));
  await s.ctx.close();
}

// Phone width: nothing overflows sideways on any tab, before and after content arrives, and axe still passes
async function mobileFlows(browser, base) {
  var ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  var page = await ctx.newPage(), errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  await mockNetwork(page, base, []);
  var name = function (n) { return n + ' [phone]'; };
  var DEVICE_W = 390;
  async function fits(label) {
    // Mobile Chrome widens the layout viewport to fit overflowing content (innerWidth grows past the screen), so
    // everything is measured against the device width, never against innerWidth
    var r = await page.evaluate(function (w) {
      var bad = [];
      if (window.innerWidth > w + 1) bad.push('layout viewport widened to ' + window.innerWidth + 'px');
      if (document.documentElement.scrollWidth > w + 1) bad.push('document ' + document.documentElement.scrollWidth + 'px');
      Array.prototype.forEach.call(document.querySelectorAll('body *'), function (el) {
        if (!el.offsetParent && el.tagName !== 'BODY') return;
        var b = el.getBoundingClientRect(); if (b.width && b.right > w + 1) bad.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ' ' + Math.round(b.right) + 'px');
      });
      return { w: w, bad: bad.slice(0, 6) };
    }, DEVICE_W);
    check(name('no horizontal overflow: ' + label), r.bad.length === 0, r.w + 'px wide; ' + r.bad.join(', '));
  }
  async function axeCheck(label) {
    var results = await new AxeBuilder({ page: page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
    var v = results.violations.filter(function (x) { return x.impact === 'critical' || x.impact === 'serious' || x.impact === 'moderate' || x.impact === 'minor'; });
    check(name('axe: no violations on ' + label), v.length === 0, v.map(function (x) { return x.id + ' (' + x.impact + '): ' + x.help + ' e.g. ' + x.nodes[0].target.join(' '); }).join(' | '));
  }
  await page.goto(base, { waitUntil: 'load' });
  check(name('viewport meta present'), /width=device-width/.test(await page.locator('meta[name="viewport"]').getAttribute('content')));
  await fits('References tab at rest');
  var tabsRight = await page.evaluate(function () { return Math.round(document.querySelector('[role=tablist]').getBoundingClientRect().right); });
  check(name('tab strip fits the screen'), tabsRight <= DEVICE_W, tabsRight + 'px');
  await page.tap('#tab-find'); await fits('Find tab');
  await page.tap('#tab-export'); await fits('Export tab');
  await page.tap('#tab-cite');
  await page.fill('#doi-input', '10.1038/nature12373'); await page.tap('#doi-go');
  await page.waitForFunction(function () { return /Copy/.test(document.querySelector('#doi-result').textContent) && !/Looking/.test(document.querySelector('#doi-status').textContent); }, null, { timeout: 15000 });
  await fits('DOI tab with a result'); await axeCheck('DOI tab with a result');
  var tapOk = await page.evaluate(function () { // buttons and links people tap should be at least 24px tall (WCAG 2.5.8)
    return Array.prototype.filter.call(document.querySelectorAll('#doi-result button, [role=tab], .btn'), function (b) { var r = b.getBoundingClientRect(); return r.height && r.height < 24; }).map(function (b) { return b.textContent.trim().slice(0, 20) + ' ' + Math.round(b.getBoundingClientRect().height) + 'px'; });
  });
  check(name('tap targets are at least 24px tall'), tapOk.length === 0, tapOk.join(', '));
  await page.tap('#tab-export');
  await page.selectOption('#split-mode', 'lines');
  await page.fill('#export-input', 'Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., & Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. Nature, 500(7460), 54-58.\nVaswani A, Shazeer N, Parmar N. Attention is all you need. Advances in Neural Information Processing Systems. 2017;30:5998-6008.');
  await page.tap('#export-go');
  await page.waitForFunction(function () { return /good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  await fits('Export tab with matches'); await axeCheck('Export tab with matches');
  check(name('no page errors'), errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function main() {
  var cslReady = await loadUpstream();
  if (!cslReady) { skipped.push('CSL rendering (citeproc, nature.csl or locale not fetched)'); if (process.env.CI) { failed++; console.log('FAIL CSL files must be fetchable under CI'); } }
  var server = await serve(), base = server.base, browser;
  try { browser = await chromium.launch(); }
  catch (e) { browser = await chromium.launch({ channel: 'chrome' }); } // no downloaded Chromium: use the installed Chrome
  var t0 = Date.now();
  try {
    await runFlows(browser, base, false, cslReady);
    await runFlows(browser, base, true, cslReady);
    await mobileFlows(browser, base);
  } catch (e) {
    failed++; console.log('FAIL exception: ' + (e.stack || e.message));
    try { fs.mkdirSync(OUT, { recursive: true }); var pages = browser.contexts().flatMap(function (c) { return c.pages(); }); if (pages.length) await pages[0].screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }); } catch (e2) {}
  } finally {
    await browser.close(); server.srv.close();
  }
  if (skipped.length) console.log('skipped: ' + skipped.join('; '));
  console.log(passed + ' passed, ' + failed + ' failed  (' + (Date.now() - t0) + ' ms)');
  process.exitCode = failed ? 1 : 0;
}
main();
