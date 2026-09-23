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
var upstream = {}; // url -> body
async function loadUpstream() {
  var want = { citeproc: CITEPROC_URL, style: STYLE_URL, dependent: DEP_STYLE_URL, locale: LOCALE_URL };
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
  await page.route('**/*', function (route) {
    var url = route.request().url();
    log.push(url);
    if (url.indexOf(base) === 0) return route.continue();
    if (/fonts\.googleapis\.com/.test(url)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (upstream[url]) return route.fulfill({ status: 200, contentType: /\.js$/.test(url) ? 'application/javascript' : 'text/plain; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: upstream[url] });
    var m = url.match(/api\.crossref\.org\/works\/(.+?)(\?|$)/);
    if (m) {
      var doi = decodeURIComponent(m[1]);
      return doi.toLowerCase() === work.message.DOI.toLowerCase() ? json(route, work) : json(route, { status: 'error', message: 'Resource not found.' }, 404);
    }
    if (/api\.crossref\.org\/works\?/.test(url)) return json(route, { status: 'ok', 'message-type': 'work-list', message: { items: [work.message], 'total-results': 1 } });
    if (/doi\.org\//.test(url)) return route.fulfill({ status: 404, contentType: 'text/html', body: 'DOI not found' });
    // OpenAlex, Europe PMC, NLM Catalog, Open Library, JabRef lists, other CSL styles: nothing to say
    return json(route, {}, 404);
  });
}

async function newPage(browser, base, dark) {
  var ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, colorScheme: dark ? 'dark' : 'light', permissions: ['clipboard-read', 'clipboard-write'] });
  var page = await ctx.newPage();
  var state = { errors: [], requests: [] };
  page.on('pageerror', function (e) { state.errors.push('pageerror: ' + e.message); });
  page.on('console', function (msg) { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) state.errors.push('console: ' + msg.text()); });
  await mockNetwork(page, base, state.requests);
  return { ctx: ctx, page: page, state: state };
}

var RIS_FILE = ['TY  - JOUR', 'AU  - Kucsko, G.', 'AU  - Maurer, P. C.', 'AU  - Yao, N. Y.', 'TI  - Nanometre-scale thermometry in a living cell', 'JO  - Nature', 'PY  - 2013', 'VL  - 500', 'IS  - 7460', 'SP  - 54', 'EP  - 58', 'DO  - 10.1038/nature12373', 'ER  - ', ''].join('\r\n');
var BIB_FILE = '@article{vaswani2017attention,\n  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},\n  title = {Attention is all you need},\n  journal = {Advances in Neural Information Processing Systems},\n  year = {2017},\n  volume = {30},\n  pages = {5998--6008}\n}\n';

// Everything the page does, once per colour scheme; axe runs on each tab once it has content
async function runFlows(browser, base, dark, cslReady) {
  var scheme = dark ? 'dark' : 'light';
  var s = await newPage(browser, base, dark), page = s.page;
  var name = function (n) { return n + ' [' + scheme + ']'; };
  async function axeCheck(label) {
    var results = await new AxeBuilder({ page: page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
    var v = results.violations.filter(function (x) { return x.impact === 'critical' || x.impact === 'serious' || x.impact === 'moderate'; });
    check(name('axe: no violations on ' + label), v.length === 0, v.map(function (x) { return x.id + ' (' + x.impact + ', ' + x.nodes.length + ' nodes): ' + x.help + ' e.g. ' + x.nodes[0].target.join(' '); }).join(' | '));
  }
  var textOf = async function (sel) { return page.locator(sel).textContent(); };

  // 1. Loads clean, with metadata and version
  await page.goto(base, { waitUntil: 'load' });
  check(name('title is AutoDOI'), (await page.title()) === 'AutoDOI');
  check(name('favicon link present'), await page.locator('link[rel="icon"]').count() === 1);
  check(name('footer shows the package version'), (await textOf('#app-version')) === 'v' + pkgVersion, await textOf('#app-version'));
  check(name('sample record renders at rest'), /Kucsko/.test(await textOf('#doi-result')));
  check(name('bug link carries the version'), versionInUrl.test(await page.locator('#link-bug').getAttribute('href')));
  check(name('no page errors on load'), s.state.errors.length === 0, s.state.errors.join(' | '));
  check(name('no lookup left the page on load'), !s.state.requests.some(function (u) { return /api\.crossref|openalex|ebi\.ac\.uk|ncbi|jabref/i.test(u); }), s.state.requests.join(', '));
  check(name('colour scheme applied'), (await page.evaluate(function () { return getComputedStyle(document.body).backgroundColor; })) === (dark ? 'rgb(20, 23, 27)' : 'rgb(245, 246, 243)'), await page.evaluate(function () { return getComputedStyle(document.body).backgroundColor; }));
  await axeCheck('DOI tab at rest');

  // 2. Tabs: mouse, keyboard, aria state, persistence
  await page.click('#tab-find');
  check(name('click selects Find tab'), (await page.getAttribute('#tab-find', 'aria-selected')) === 'true' && await page.isHidden('#panel-cite') && await page.isVisible('#panel-find'));
  await page.focus('#tab-find'); await page.keyboard.press('ArrowRight');
  check(name('ArrowRight moves to Export tab and focuses it'), (await page.getAttribute('#tab-export', 'aria-selected')) === 'true' && (await page.evaluate(function () { return document.activeElement.id; })) === 'tab-export');
  await page.keyboard.press('Home');
  check(name('Home returns to the first tab'), (await page.getAttribute('#tab-cite', 'aria-selected')) === 'true');
  await page.keyboard.press('End');
  await page.reload({ waitUntil: 'load' });
  check(name('selected tab survives a reload'), (await page.getAttribute('#tab-export', 'aria-selected')) === 'true' && await page.isVisible('#panel-export'));
  await axeCheck('Export tab empty');
  await page.click('#tab-find'); await axeCheck('Find tab empty');
  await page.locator('details.settings summary').click(); await axeCheck('Settings open'); await page.locator('details.settings summary').click();

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
  check(name('Report it link is prefilled with the DOI'), /doi=10\.1038%2Fnature12373/.test(await page.locator('#doi-result a:has-text("Report it")').getAttribute('href')));
  check(name('URL now carries ?q='), /[?&]q=10\.1038/.test(page.url()), page.url());
  var crossrefCalls = s.state.requests.filter(function (u) { return /api\.crossref\.org\/works\/10\.1038/.test(u); }).length;
  check(name('exactly one Crossref lookup for the DOI'), crossrefCalls === 1, crossrefCalls);
  await axeCheck('DOI tab with a result');

  // Single-style mode and copy
  await page.selectOption('#style-select', 'apa');
  await page.waitForFunction(function () { return !/MLA/.test(document.querySelector('#doi-result').textContent); });
  check(name('choosing APA shows only APA'), /APA/.test(await textOf('#doi-result')));
  await page.locator('#doi-result button:has-text("Copy")').first().click();
  var clip = await page.evaluate(function () { return navigator.clipboard.readText(); });
  check(name('Copy puts the APA reference on the clipboard'), /Kucsko, G\./.test(clip) && /\(2013\)/.test(clip), clip.slice(0, 120));

  // Title case conversion and word override
  await page.selectOption('#case-select', 'title');
  await page.waitForFunction(function () { return /Nanometre-Scale Thermometry in a Living Cell/.test(document.querySelector('#doi-result').textContent); }, null, { timeout: 10000 });
  check(name('Title Case converts the heading'), true);
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
    await page.evaluate(function () { localStorage.removeItem('autodoi.cslRecent'); localStorage.removeItem('autodoi.style'); });
    await page.goto(base + '?q=10.1038/nature12373&style=csl:nature-geoscience', { waitUntil: 'load' });
    await page.waitForFunction(function () { var c = document.querySelector('#doi-result .cite .text'); return c && !/Rendering/.test(c.textContent) && /Kucsko/.test(c.textContent); }, null, { timeout: 20000 });
    check(name('?style=csl: deep link to a dependent style renders and names it'), /Nature Geoscience/.test(await page.locator('#doi-result .cite').first().textContent()) && /Nature Geoscience/.test(await page.locator('#style-select option:checked').textContent()), await page.locator('#style-select option:checked').textContent());
    await page.selectOption('#style-select', 'all');
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

  // 7. Find a DOI, then Format
  await page.click('#tab-find');
  await page.fill('#find-title', 'Nanometre-scale thermometry in a living cell');
  await page.fill('#find-journal', 'Nature');
  await page.click('#find-go');
  await page.waitForSelector('#find-results .hit', { timeout: 15000 });
  check(name('find shows a hit with a Title match chip'), /Title match/.test(await page.locator('#find-results .hit').first().textContent()));
  check(name('find hit shows the DOI'), /10\.1038\/nature12373/.test(await textOf('#find-results')));
  await axeCheck('Find tab with results');
  await page.locator('#find-results .hit button:has-text("Format")').first().click();
  check(name('Format jumps to the DOI tab with the record'), (await page.getAttribute('#tab-cite', 'aria-selected')) === 'true' && (await page.inputValue('#doi-input')) === '10.1038/nature12373' && /Kucsko/.test(await textOf('#doi-result')));

  // 8. Reference matching and export
  await page.click('#tab-export');
  await page.selectOption('#split-mode', 'lines');
  await page.fill('#export-input', 'Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., & Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. Nature, 500(7460), 54-58.\nVaswani A, Shazeer N, Parmar N. Attention is all you need. Advances in Neural Information Processing Systems. 2017;30:5998-6008.');
  await page.waitForFunction(function () { return /2 references/.test(document.querySelector('#split-count').textContent); }, null, { timeout: 5000 }).catch(function () {});
  check(name('split count reports two references'), /2 references/.test(await textOf('#split-count')), await textOf('#split-count'));
  await page.click('#export-go');
  await page.waitForFunction(function () { return /good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
  var status = await textOf('#export-status');
  check(name('status counts one good and one unmatched'), /1 good/.test(status) && /1 not matched/.test(status), status);
  check(name('one row is a good match'), (await page.locator('#export-matches .match.good').count()) === 1);
  check(name('the wrong-paper row is not ticked and offers a fix box'), (await page.locator('#export-matches .match.bad, #export-matches .match.warn').count()) === 1 && (await page.locator('#export-matches .match.good input[type=checkbox]').first().isChecked()));
  var outText = await textOf('#export-output');
  check(name('export output holds the matched record'), /Kucsko/.test(outText) && /RIS|EndNote|BibTeX/.test(outText), outText.slice(0, 200));
  await axeCheck('Export tab with matches');

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
  await page.locator('#split-details summary').click();
  await axeCheck('Export tab with file records and split list open');
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
    var v = results.violations.filter(function (x) { return x.impact === 'critical' || x.impact === 'serious' || x.impact === 'moderate'; });
    check(name('axe: no violations on ' + label), v.length === 0, v.map(function (x) { return x.id + ' (' + x.impact + '): ' + x.help + ' e.g. ' + x.nodes[0].target.join(' '); }).join(' | '));
  }
  await page.goto(base, { waitUntil: 'load' });
  check(name('viewport meta present'), /width=device-width/.test(await page.locator('meta[name="viewport"]').getAttribute('content')));
  await fits('DOI tab at rest');
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
