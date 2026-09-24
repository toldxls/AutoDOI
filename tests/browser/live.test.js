// The live page against the real services, no mocks: a lookup, a journal style through citeproc, the DOI finder
// and a two-reference batch.  Slow and network-dependent by design; the weekly canary runs it, not CI on push.
// Usage: node tests/browser/live.test.js        (LIVE_URL=http://127.0.0.1:8000/ to point at a local server)
var { chromium } = require('playwright');
var LIVE = process.env.LIVE_URL || 'https://toldxls.github.io/AutoDOI/';
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; console.log('ok   ' + name); } else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + String(detail).replace(/\s+/g, ' ').slice(0, 400) : '')); } }
(async function () {
  var browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } }), page = await ctx.newPage();
  var errors = [], failedRequests = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('requestfailed', function (r) { if (!/fonts\.g/.test(r.url())) failedRequests.push(r.url() + ' ' + (r.failure() && r.failure().errorText)); });
  var t0 = Date.now();
  try {
    await page.goto(LIVE, { waitUntil: 'load', timeout: 60000 });
    check('page loads', (await page.title()) === 'AutoDOI');
    // DOI lookup
    await page.fill('#doi-input', '10.1038/nature12373'); await page.click('#doi-go');
    await page.waitForFunction(function () { return /Kucsko/.test(document.querySelector('#doi-result').textContent) && /Copy/.test(document.querySelector('#doi-result').textContent) && !/Looking/.test(document.querySelector('#doi-status').textContent); }, null, { timeout: 60000 });
    var text = await page.locator('#doi-result').textContent();
    check('Crossref lookup renders the record', /Kucsko, G\./.test(text) && /2013/.test(text) && /Nature/.test(text), text.slice(0, 200));
    check('no error status after the lookup', !/err/.test(await page.getAttribute('#doi-status', 'class')), await page.locator('#doi-status').textContent());
    // Vancouver needs the NLM abbreviation; wait a moment for it
    await page.selectOption('#style-select', 'vancouver');
    await page.waitForFunction(function () { return /Nature\. 2013/.test(document.querySelector('#doi-result').textContent); }, null, { timeout: 30000 }).catch(function () {});
    check('Vancouver renders with the journal abbreviation from NLM', /Nature\. 2013;500\(7460\):54-8/.test(await page.locator('#doi-result').textContent()), (await page.locator('#doi-result').textContent()).slice(0, 200));
    await page.selectOption('#style-select', 'all');
    // A journal style through citeproc, with the real style index, style file, locale and engine
    await page.selectOption('#style-select', 'search');
    await page.waitForSelector('#csl-box:not([hidden])', { timeout: 30000 });
    await page.fill('#csl-search', 'nature');
    await page.waitForSelector('#csl-results .hit.style', { timeout: 60000 });
    await page.locator('#csl-results .hit.style').filter({ has: page.locator('.m', { hasText: /^nature( ·|$)/ }) }).first().click();
    await page.waitForFunction(function () { var c = document.querySelector('#doi-result .cite .text'); return c && !/Rendering/.test(c.textContent); }, null, { timeout: 60000 });
    var csl = await page.locator('#doi-result .cite').first().textContent();
    check('citeproc renders the Nature style from the pinned files', /Kucsko, G\. et al\./.test(csl) && /Nature 500, 54/.test(csl), csl.slice(0, 200));
    await page.selectOption('#style-select', 'all');
    // Find a DOI
    await page.click('#tab-find');
    await page.fill('#find-title', 'Nanometre-scale thermometry in a living cell'); await page.fill('#find-journal', 'Nature'); await page.click('#find-go');
    await page.waitForSelector('#find-results .hit', { timeout: 60000 });
    check('Find a DOI returns the paper first with a Title match chip', /10\.1038\/nature12373/.test(await page.locator('#find-results .hit').first().textContent()) && /Title match/.test(await page.locator('#find-results .hit').first().textContent()), await page.locator('#find-results').textContent());
    // Two pasted references
    await page.click('#tab-export');
    await page.selectOption('#split-mode', 'lines');
    await page.fill('#export-input', 'Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., & Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. Nature, 500(7460), 54-58.\nHarris, C. R., Millman, K. J., van der Walt, S. J., et al. (2020). Array programming with NumPy. Nature, 585(7825), 357-362.');
    await page.click('#export-go');
    await page.waitForFunction(function () { return /good|matched/.test(document.querySelector('#export-status').textContent) && !document.querySelector('#export-go').disabled; }, null, { timeout: 120000 });
    var status = await page.locator('#export-status').textContent();
    check('batch matches both references against Crossref', /2 good/.test(status), status);
    check('export output holds both records', /Kucsko/.test(await page.locator('#export-output').textContent()) && /Harris/.test(await page.locator('#export-output').textContent()));
    check('no page errors', errors.length === 0, errors.join(' | '));
    check('no failed requests to the services', failedRequests.length === 0, failedRequests.join(' | '));
  } catch (e) {
    failed++; console.log('FAIL exception: ' + (e.stack || e.message)); console.log('     page errors: ' + errors.join(' | ') + '\n     failed requests: ' + failedRequests.join(' | '));
  } finally { await browser.close(); }
  console.log(passed + ' passed, ' + failed + ' failed  (' + (Date.now() - t0) + ' ms)');
  process.exitCode = failed ? 1 : 0;
})();
