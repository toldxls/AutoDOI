// Matching bench: real reference text with known answers through the real page and the real services.
// tests/fixtures/match-truth.json holds references as publishers deposited them in Crossref reference lists,
// each with the DOI the publisher resolved it to.  Variants degrade the text further.  The page is served
// locally; only fonts are blocked.  Slow (about two seconds per reference on Crossref's public pool).
// The glued variant joins consecutive pairs into one line ("; ", a bare space, ". ") and pastes in automatic layout mode: the
// splitter must separate them before matching can succeed.
// Usage: node tests/browser/match-bench.js [--variants deposited,lowercase,noyear,glued] [--limit N] [--batch 25] [--out file.json]
var http = require('http'), fs = require('fs'), path = require('path');
var { chromium } = require('playwright');
var ROOT = path.join(__dirname, '..', '..');
var truth = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'match-truth.json'), 'utf8'));
var arg = function (k, d) { var i = process.argv.indexOf('--' + k); return i === -1 ? d : process.argv[i + 1]; };
var VARIANTS = arg('variants', 'deposited').split(','), LIMIT = Number(arg('limit', truth.length)), BATCH = Number(arg('batch', 25)), OUT = arg('out', '');
var DOI_RE = /(?:\bdoi:?\s*)?(?:https?:\/\/(?:dx\.)?doi\.org\/)?\b10\.\d{4,9}\/[^\s"'<>]+/gi;
var degrade = {
  deposited: function (t) { return t.replace(DOI_RE, ' ').replace(/\s+/g, ' ').trim(); },                                   // as deposited, DOI removed so the search path is exercised
  lowercase: function (t) { return degrade.deposited(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(); }, // no capitals, no punctuation
  noyear: function (t) { return degrade.deposited(t).replace(/\b(1[89]|20)\d{2}[a-z]?\b/g, ' ').replace(/\s+/g, ' ').trim(); }         // year gone
};
var TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
function serve() {
  return new Promise(function (resolve) {
    var srv = http.createServer(function (req, res) {
      var p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      var f = path.join(ROOT, p);
      if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', function () { resolve({ srv: srv, base: 'http://127.0.0.1:' + srv.address().port + '/' }); });
  });
}
function normDoi(d) { return String(d || '').toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/[.,;)]+$/, ''); }
var GLUES = ['; ', ' ', '. '];
function glueTexts(a, b, g) { a = degrade.deposited(a); b = degrade.deposited(b); if (g === '. ') a = a.replace(/[.\s]+$/, ''); return a + g + b; }
function squash(t) { return String(t).replace(/\s+/g, ' ').trim(); }
async function gluedRun(page, items) {
  var pairs = [], t0 = Date.now();
  for (var i = 0; i + 1 < items.length; i += 2) pairs.push({ a: items[i], b: items[i + 1], glue: GLUES[(i / 2) % GLUES.length], line: glueTexts(items[i].text, items[i + 1].text, GLUES[(i / 2) % GLUES.length]) });
  await page.selectOption('#split-mode', 'auto');
  var PER = Math.max(4, Math.floor(BATCH / 2));
  for (var b = 0; b < pairs.length; b += PER) {
    var chunk = pairs.slice(b, b + PER);
    await page.fill('#export-input', chunk.map(function (p) { return p.line; }).join('\n'));
    await page.waitForFunction(function () { return /references?/.test(document.querySelector('#split-count').textContent); }, null, { timeout: 5000 }).catch(function () {});
    await page.click('#export-go');
    await page.waitForFunction(function () { var s = document.querySelector('#export-status').textContent; return !document.querySelector('#export-go').disabled && /good|matched|Stopped|Paste/.test(s); }, null, { timeout: 600000 });
    var got = await page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('#export-matches .match'), function (m) {
        var code = m.querySelector('.out code'), inp = m.querySelector('.in');
        return { level: /\bgood\b/.test(m.className) ? 'good' : /\bwarn\b/.test(m.className) ? 'warn' : /\bbad\b/.test(m.className) ? 'bad' : 'none', doi: code ? code.textContent : '', raw: inp ? inp.textContent : '' };
      });
    });
    chunk.forEach(function (p) {
      var mine = got.filter(function (r) { var raw = squash(r.raw); return raw && (squash(p.line).indexOf(raw) !== -1 || raw.indexOf(squash(p.line)) !== -1); });
      p.rows = mine.length;
      var dois = mine.map(function (r) { return { doi: normDoi(r.doi), level: r.level }; });
      var find = function (want) { return dois.filter(function (d) { return d.doi === normDoi(want); })[0]; };
      p.foundA = find(p.a.doi); p.foundB = find(p.b.doi);
      p.wrongGreen = dois.filter(function (d) { return d.level === 'good' && d.doi && d.doi !== normDoi(p.a.doi) && d.doi !== normDoi(p.b.doi); }).length;
    });
    process.stdout.write('.');
  }
  var split = pairs.filter(function (p) { return p.rows === 2; }).length, over = pairs.filter(function (p) { return p.rows > 2; }).length, under = pairs.filter(function (p) { return p.rows < 2; }).length;
  var refs = pairs.length * 2, green = 0, any = 0, wrongGreen = 0;
  pairs.forEach(function (p) { [p.foundA, p.foundB].forEach(function (f) { if (f) { any++; if (f.level === 'good') green++; } }); wrongGreen += p.wrongGreen; });
  var byGlue = {}; pairs.forEach(function (p) { var k = JSON.stringify(p.glue); byGlue[k] = byGlue[k] || { n: 0, split: 0 }; byGlue[k].n++; if (p.rows === 2) byGlue[k].split++; });
  var secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log('\n== glued: ' + pairs.length + ' lines holding two references each, automatic layout, ' + secs + ' s');
  console.log('   split into two: ' + split + ' | left as one: ' + under + ' | split into more: ' + over + '   by glue: ' + Object.keys(byGlue).map(function (k) { return k + ' ' + byGlue[k].split + '/' + byGlue[k].n; }).join(', '));
  console.log('   references greened: ' + green + '/' + refs + ' (' + (green / refs * 100).toFixed(1) + '%)   found at any level: ' + any + '/' + refs + '   wrong greens: ' + wrongGreen);
  pairs.filter(function (p) { return p.rows !== 2; }).slice(0, 8).forEach(function (p) { console.log('   ' + p.rows + ' row(s) [' + JSON.stringify(p.glue) + '] ' + p.line.slice(0, 150)); });
  return { pairs: pairs.map(function (p) { return { glue: p.glue, rows: p.rows, a: !!p.foundA, b: !!p.foundB, wrongGreen: p.wrongGreen, line: p.line }; }), split: split, green: green, any: any, refs: refs, wrongGreen: wrongGreen };
}
(async function () {
  var server = await serve(), browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } }), page = await ctx.newPage();
  await page.route('**/*', function (r) { return /fonts\.g/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'text/css', body: '' }) : r.continue(); });
  var errors = []; page.on('pageerror', function (e) { errors.push(e.message); });
  await page.goto(server.base + '#export', { waitUntil: 'load' });
  await page.selectOption('#split-mode', 'lines');
  var items = truth.slice(0, LIMIT), results = {};
  for (var v of VARIANTS) {
    if (v === 'glued') { results.glued = await gluedRun(page, items); continue; }
    await page.selectOption('#split-mode', 'lines');
    var rows = [], t0 = Date.now();
    for (var b = 0; b < items.length; b += BATCH) {
      var chunk = items.slice(b, b + BATCH), texts = chunk.map(function (x) { return degrade[v](x.text); });
      await page.fill('#export-input', texts.join('\n'));
      await page.waitForFunction(function (n) { return new RegExp(n + ' references?').test(document.querySelector('#split-count').textContent); }, chunk.length, { timeout: 5000 }).catch(function () {});
      await page.click('#export-go');
      await page.waitForFunction(function () { var s = document.querySelector('#export-status').textContent; return !document.querySelector('#export-go').disabled && /good|matched|Stopped|Paste/.test(s); }, null, { timeout: 420000 });
      var got = await page.evaluate(function () {
        return Array.prototype.map.call(document.querySelectorAll('#export-matches .match'), function (m) {
          var code = m.querySelector('.out code'), chip = m.querySelector('.out .chip'), inp = m.querySelector('.in');
          return { level: /\bgood\b/.test(m.className) ? 'good' : /\bwarn\b/.test(m.className) ? 'warn' : /\bbad\b/.test(m.className) ? 'bad' : 'none', doi: code ? code.textContent : '', chip: chip ? chip.textContent : '', raw: inp ? inp.textContent : '' };
        });
      });
      if (got.length !== chunk.length) console.log('note: ' + chunk.length + ' pasted, ' + got.length + ' rows (batch at ' + b + '): a line holding two references was split');
      // rows belong to the pasted line whose text contains theirs (a glued line yields two rows); the row holding the wanted DOI wins, else the first
      chunk.forEach(function (x, i) {
        var line = squash(texts[i]), mine = got.filter(function (r) { var raw = squash(r.raw); return raw && (line.indexOf(raw) !== -1 || raw.indexOf(line) !== -1); });
        var g = mine.filter(function (r) { return normDoi(r.doi) === normDoi(x.doi); })[0] || mine[0] || { level: 'none', doi: '', chip: '' };
        rows.push({ text: texts[i], want: x.doi, got: normDoi(g.doi), level: g.level, chip: g.chip, correct: normDoi(g.doi) === normDoi(x.doi), extraRows: Math.max(0, mine.length - 1) });
      });
      process.stdout.write('.');
    }
    var tally = { greenRight: 0, greenWrong: 0, amberRight: 0, amberWrong: 0, redRight: 0, redWrong: 0, none: 0 };
    rows.forEach(function (r) {
      if (!r.got) tally.none++;
      else if (r.level === 'good') tally[r.correct ? 'greenRight' : 'greenWrong']++;
      else if (r.level === 'warn') tally[r.correct ? 'amberRight' : 'amberWrong']++;
      else tally[r.correct ? 'redRight' : 'redWrong']++;
    });
    var secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log('\n== ' + v + ': ' + rows.length + ' references in ' + secs + ' s (' + (secs / rows.length).toFixed(1) + ' s each)');
    console.log('   green right ' + tally.greenRight + ' | GREEN WRONG ' + tally.greenWrong + ' | amber right ' + tally.amberRight + ' | amber wrong ' + tally.amberWrong + ' | red right ' + tally.redRight + ' | red wrong ' + tally.redWrong + ' | no record ' + tally.none);
    var precision = tally.greenRight / Math.max(1, tally.greenRight + tally.greenWrong), recall = tally.greenRight / rows.length;
    console.log('   green precision ' + (precision * 100).toFixed(1) + '%   green recall ' + (recall * 100).toFixed(1) + '%   found anywhere ' + ((tally.greenRight + tally.amberRight + tally.redRight) / rows.length * 100).toFixed(1) + '%');
    rows.filter(function (r) { return r.level === 'good' && !r.correct; }).forEach(function (r) { console.log('   GREEN WRONG  [' + r.chip + '] ' + r.text.slice(0, 110) + '\n                want ' + r.want + '\n                got  ' + r.got); });
    rows.filter(function (r) { return r.correct && r.level !== 'good'; }).slice(0, 8).forEach(function (r) { console.log('   right but ' + r.level + ' [' + r.chip + '] ' + r.text.slice(0, 110)); });
    rows.filter(function (r) { return !r.got || (r.level !== 'good' && !r.correct); }).slice(0, 8).forEach(function (r) { console.log('   missed (' + r.level + ' ' + (r.got || '-') + ') ' + r.text.slice(0, 110) + '\n                want ' + r.want); });
    results[v] = { tally: tally, rows: rows };
  }
  if (errors.length) console.log('page errors: ' + errors.join(' | '));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  await browser.close(); server.srv.close();
})();
