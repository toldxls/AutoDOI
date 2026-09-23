// Drives the built page in headless Chromium with every external API mocked, so it runs offline and gives
// the same answer every time.  Covers the three tabs, deep links, a lookup, the DOI finder, reference
// matching, the error path with its bug-report link, and axe accessibility checks on each tab.
// Usage: npm install && npx playwright install chromium && node tests/browser/ui.test.js
var http = require('http'), fs = require('fs'), path = require('path');
var { chromium } = require('playwright');
var { AxeBuilder } = require('@axe-core/playwright');

var ROOT = path.join(__dirname, '..', '..');
var OUT = path.join(__dirname, 'out'); // screenshots on failure (gitignored)
var work = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'w.json'), 'utf8')); // Crossref record for 10.1038/nature12373
var pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
var versionInUrl = new RegExp('AutoDOI%20' + pkgVersion.replace(/\./g, '\\.'));
var passed = 0, failed = 0, failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++; failures.push(name + (detail ? ': ' + String(detail).slice(0, 400) : '')); console.log('FAIL ' + name + (detail ? '\n     ' + String(detail).slice(0, 400) : ''));
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
    var m = url.match(/api\.crossref\.org\/works\/(.+?)(\?|$)/);
    if (m) {
      var doi = decodeURIComponent(m[1]);
      return doi.toLowerCase() === work.message.DOI.toLowerCase() ? json(route, work) : json(route, { status: 'error', message: 'Resource not found.' }, 404);
    }
    if (/api\.crossref\.org\/works\?/.test(url)) return json(route, { status: 'ok', 'message-type': 'work-list', message: { items: [work.message], 'total-results': 1 } });
    if (/doi\.org\//.test(url)) return route.fulfill({ status: 404, contentType: 'text/html', body: 'DOI not found' });
    // OpenAlex, Europe PMC, NLM Catalog, Open Library, JabRef lists, CSL styles: nothing to say
    return json(route, {}, 404);
  });
}

async function newPage(browser, base, opts) {
  opts = opts || {};
  var ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light', permissions: ['clipboard-read', 'clipboard-write'] });
  var page = await ctx.newPage();
  var state = { errors: [], requests: [] };
  page.on('pageerror', function (e) { state.errors.push('pageerror: ' + e.message); });
  page.on('console', function (msg) { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) state.errors.push('console: ' + msg.text()); });
  await mockNetwork(page, base, state.requests);
  return { ctx: ctx, page: page, state: state };
}

async function axeCheck(page, label) {
  var results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
  var v = results.violations.filter(function (x) { return x.impact === 'critical' || x.impact === 'serious' || x.impact === 'moderate'; });
  check('axe: no violations on ' + label, v.length === 0, v.map(function (x) { return x.id + ' (' + x.impact + ', ' + x.nodes.length + ' nodes): ' + x.help + ' e.g. ' + x.nodes[0].target.join(' '); }).join(' | '));
}

async function main() {
  var server = await serve(), base = server.base, browser;
  try { browser = await chromium.launch(); }
  catch (e) { browser = await chromium.launch({ channel: 'chrome' }); } // no downloaded Chromium: use the installed Chrome
  var t0 = Date.now();
  try {
    // 1. The page loads clean, with its metadata and version
    var s = await newPage(browser, base), page = s.page;
    await page.goto(base, { waitUntil: 'load' });
    check('title is AutoDOI', (await page.title()) === 'AutoDOI');
    check('favicon link present', await page.locator('link[rel="icon"]').count() === 1);
    check('footer shows the package version', (await page.locator('#app-version').textContent()) === 'v' + pkgVersion, await page.locator('#app-version').textContent());
    check('sample record renders at rest', /Kucsko/.test(await page.locator('#doi-result').textContent()));
    check('bug link carries the version', versionInUrl.test(await page.locator('#link-bug').getAttribute('href')));
    check('no page errors on load', s.state.errors.length === 0, s.state.errors.join(' | '));
    check('no request left the mocked set on load', !s.state.requests.some(function (u) { return /api\.crossref|openalex|ebi\.ac\.uk|ncbi/.test(u); }), s.state.requests.join(', '));
    await axeCheck(page, 'DOI tab (light)');

    // 2. Tabs: mouse, keyboard, aria state, persistence
    await page.click('#tab-find');
    check('click selects Find tab', (await page.getAttribute('#tab-find', 'aria-selected')) === 'true' && await page.isHidden('#panel-cite') && await page.isVisible('#panel-find'));
    await page.focus('#tab-find'); await page.keyboard.press('ArrowRight');
    check('ArrowRight moves to Export tab and focuses it', (await page.getAttribute('#tab-export', 'aria-selected')) === 'true' && (await page.evaluate(function () { return document.activeElement.id; })) === 'tab-export');
    await page.keyboard.press('Home');
    check('Home returns to the first tab', (await page.getAttribute('#tab-cite', 'aria-selected')) === 'true');
    await page.keyboard.press('End');
    await page.reload({ waitUntil: 'load' });
    check('selected tab survives a reload', (await page.getAttribute('#tab-export', 'aria-selected')) === 'true' && await page.isVisible('#panel-export'));
    await axeCheck(page, 'Export tab');
    await page.click('#tab-find'); await axeCheck(page, 'Find tab');

    // 3. DOI lookup through the form
    await page.click('#tab-cite');
    await page.fill('#doi-input', 'https://doi.org/10.1038/nature12373');
    await page.click('#doi-go');
    await page.waitForFunction(function () { return /Copy/.test(document.querySelector('#doi-result').textContent) && !/Looking/.test(document.querySelector('#doi-status').textContent); }, null, { timeout: 15000 });
    var text = await page.locator('#doi-result').textContent();
    check('lookup renders the record', /Kucsko/.test(text) && /2013/.test(text) && /Nanometre-scale thermometry/.test(text), text.slice(0, 200));
    check('lookup renders every built-in style', ['APA', 'MLA', 'Chicago', 'Harvard', 'Vancouver', 'IEEE'].every(function (st) { return text.indexOf(st) !== -1; }), text.slice(0, 300));
    check('lookup shows export formats', /BibTeX/.test(text) && /RIS/.test(text) && /EndNote/.test(text));
    check('View article links through doi.org', (await page.locator('#doi-result a[href="https://doi.org/10.1038/nature12373"]').count()) >= 1);
    check('Report it link is prefilled with the DOI', /doi=10\.1038%2Fnature12373/.test(await page.locator('#doi-result a:has-text("Report it")').getAttribute('href')));
    check('URL now carries ?q=', /[?&]q=10\.1038/.test(page.url()), page.url());
    var crossrefCalls = s.state.requests.filter(function (u) { return /api\.crossref\.org\/works\/10\.1038/.test(u); }).length;
    check('exactly one Crossref lookup for the DOI', crossrefCalls === 1, crossrefCalls);
    await axeCheck(page, 'DOI tab with a result');

    // Single-style mode and copy
    await page.selectOption('#style-select', 'apa');
    await page.waitForFunction(function () { return !/MLA/.test(document.querySelector('#doi-result').textContent); });
    check('choosing APA shows only APA', /APA/.test(await page.locator('#doi-result').textContent()));
    await page.locator('#doi-result button:has-text("Copy")').first().click();
    var clip = await page.evaluate(function () { return navigator.clipboard.readText(); });
    check('Copy puts the APA reference on the clipboard', /Kucsko, G\./.test(clip) && /\(2013\)/.test(clip), clip.slice(0, 120));
    await page.selectOption('#style-select', 'all');

    // 4. Deep link
    await page.goto(base + '?q=10.1038/nature12373&style=vancouver', { waitUntil: 'load' });
    await page.waitForFunction(function () { return /Kucsko/.test(document.querySelector('#doi-result').textContent) && /Copy/.test(document.querySelector('#doi-result').textContent); }, null, { timeout: 15000 });
    check('?q= deep link runs the lookup', (await page.inputValue('#doi-input')) === '10.1038/nature12373');
    check('?style= deep link selects the style', (await page.inputValue('#style-select')) === 'vancouver', await page.inputValue('#style-select'));
    await page.selectOption('#style-select', 'all');

    // 5. Error path: unknown DOI shows an error with a prefilled bug report
    await page.fill('#doi-input', '10.9999/does-not-exist');
    await page.click('#doi-go');
    await page.waitForSelector('#doi-status.err a:has-text("Report this")', { timeout: 15000 });
    var href = await page.locator('#doi-status a:has-text("Report this")').getAttribute('href');
    check('error status names the problem', /not found/i.test(await page.locator('#doi-status').textContent()), await page.locator('#doi-status').textContent());
    check('Report this link opens a prefilled issue with version and error', /issues\/new\?template=bug_report\.yml/.test(href) && versionInUrl.test(href) && /errors=/.test(href) && /10\.9999/.test(href), href.slice(0, 200));
    check('error path leaves no unhandled page errors', s.state.errors.length === 0, s.state.errors.join(' | '));

    // 6. Find a DOI, then Format
    await page.click('#tab-find');
    await page.fill('#find-title', 'Nanometre-scale thermometry in a living cell');
    await page.fill('#find-journal', 'Nature');
    await page.click('#find-go');
    await page.waitForSelector('#find-results .hit', { timeout: 15000 });
    check('find shows a hit with a Title match chip', /Title match/.test(await page.locator('#find-results .hit').first().textContent()));
    check('find hit shows the DOI', /10\.1038\/nature12373/.test(await page.locator('#find-results').textContent()));
    await page.locator('#find-results .hit button:has-text("Format")').first().click();
    check('Format jumps to the DOI tab with the record', (await page.getAttribute('#tab-cite', 'aria-selected')) === 'true' && (await page.inputValue('#doi-input')) === '10.1038/nature12373' && /Kucsko/.test(await page.locator('#doi-result').textContent()));
    await axeCheck(page, 'Find tab with results');

    // 7. Reference matching and export
    await page.click('#tab-export');
    await page.selectOption('#split-mode', 'lines');
    await page.fill('#export-input', 'Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., & Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. Nature, 500(7460), 54-58.\nVaswani A, Shazeer N, Parmar N. Attention is all you need. Advances in Neural Information Processing Systems. 2017;30:5998-6008.');
    await page.waitForFunction(function () { return /2 references/.test(document.querySelector('#split-count').textContent); }, null, { timeout: 5000 }).catch(function () {});
    check('split count reports two references', /2 references/.test(await page.locator('#split-count').textContent()), await page.locator('#split-count').textContent());
    await page.click('#export-go');
    await page.waitForFunction(function () { return /good/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 30000 });
    var status = await page.locator('#export-status').textContent();
    check('status counts one good and one unmatched', /1 good/.test(status) && /1 not matched/.test(status), status);
    check('one row is a good match', (await page.locator('#export-matches .match.good').count()) === 1);
    check('the wrong-paper row is not ticked and offers a fix box', (await page.locator('#export-matches .match.bad, #export-matches .match.warn').count()) === 1 && (await page.locator('#export-matches .match.good input[type=checkbox]').first().isChecked()));
    var outText = await page.locator('#export-output').textContent();
    check('export output holds the matched record', /Kucsko/.test(outText) && /RIS|EndNote|BibTeX/.test(outText), outText.slice(0, 200));
    check('no page errors after the batch', s.state.errors.length === 0, s.state.errors.join(' | '));
    await axeCheck(page, 'Export tab with matches');
    await s.ctx.close();

    // 8. Dark mode passes contrast checks too
    var d = await newPage(browser, base, { dark: true });
    await d.page.goto(base, { waitUntil: 'load' });
    await axeCheck(d.page, 'DOI tab (dark)');
    await d.ctx.close();
  } catch (e) {
    failed++; failures.push('exception: ' + e.message); console.log('FAIL exception: ' + (e.stack || e.message));
    try { fs.mkdirSync(OUT, { recursive: true }); var pages = browser.contexts().flatMap(function (c) { return c.pages(); }); if (pages.length) await pages[0].screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }); } catch (e2) {}
  } finally {
    await browser.close(); server.srv.close();
  }
  console.log(passed + ' passed, ' + failed + ' failed  (' + (Date.now() - t0) + ' ms)');
  process.exitCode = failed ? 1 : 0;
}
main();
