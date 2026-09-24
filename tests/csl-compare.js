// Discovery lens: the built-in formatters against citeproc-js rendering the official CSL styles for the same records.
// Differences are either our bugs or CSL choices; the script tallies them so the systematic ones stand out.
// Needs the cached engine, styles and locale in tests/browser/cache (the browser suite and this script fetch them once).
// Usage: node tests/csl-compare.js [--limit 150] [--styles apa,mla,chicago,vancouver,ieee,harvard] [--show 6]
var fs = require('fs'), path = require('path');
var ROOT = path.resolve(__dirname, '..'), CACHE = path.join(__dirname, 'browser', 'cache');
var A = require(path.join(ROOT, 'citations.js'));
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var arg = function (k, d) { var i = process.argv.indexOf('--' + k); return i === -1 ? d : process.argv[i + 1]; };
var LIMIT = Number(arg('limit', 150)), SHOW = Number(arg('show', 6)), STYLES = arg('styles', 'apa,mla,chicago,vancouver,ieee,harvard').split(',');
var SHA = (html.match(/CSL_STYLES_COMMIT = '([0-9a-f]{40})'/) || [])[1];
var CSL_FILE = { apa: 'apa', mla: 'modern-language-association', chicago: 'chicago-notes-bibliography-17th-edition', vancouver: 'nlm-citation-sequence', ieee: 'ieee', harvard: 'harvard-cite-them-right' };
var CSL = require(fs.readdirSync(CACHE).filter(function (f) { return /^citeproc-/.test(f); }).map(function (f) { return path.join(CACHE, f); })[0]);
var locale = fs.readFileSync(fs.readdirSync(CACHE).filter(function (f) { return /^locale-/.test(f); }).map(function (f) { return path.join(CACHE, f); })[0], 'utf8');
// the page's own CSL-JSON mapping, so the comparison is of formatting rules, not of two mappings
var typesSrc = html.slice(html.indexOf('  var CSL_TYPES = {'), html.indexOf('};', html.indexOf('  var CSL_TYPES = {')) + 2);
var toCslStart = html.indexOf('  function toCsl(r, id, asContainer) {'), toCslEnd = html.indexOf('\n  }\n', toCslStart) + 4;
var toCsl = new Function('A', typesSrc + '\n' + html.slice(toCslStart, toCslEnd) + '\nreturn toCsl;')(A);
function text(h) { return String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#38;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function canon(s) { return text(s).normalize('NFC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/\.$/, '').trim(); }
function toks(s) { return canon(s).toLowerCase().replace(/[^a-z0-9À-ɏ\s\/:.-]/g, ' ').split(/\s+/).filter(Boolean); }
var corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'corpus.json'), 'utf8'));
var byType = {}; corpus.forEach(function (m) { (byType[m.type] = byType[m.type] || []).push(m); });
var want = { 'journal-article': 60, book: 20, 'book-chapter': 20, 'proceedings-article': 15, dissertation: 10, report: 10, dataset: 5, 'posted-content': 10 };
var sample = []; Object.keys(want).forEach(function (t) { sample = sample.concat((byType[t] || []).slice(0, want[t])); });
sample = sample.slice(0, LIMIT).map(A.normalize);
STYLES.forEach(function (st) {
  var xml = fs.readFileSync(path.join(CACHE, 'style-' + SHA + '-' + CSL_FILE[st] + '.csl'), 'utf8');
  var items = {}, ids = [];
  sample.forEach(function (r, i) { var it = toCsl(r, 'ITEM-' + (i + 1)); items[it.id] = it; ids.push(it.id); });
  var eng = new CSL.Engine({ retrieveLocale: function () { return locale; }, retrieveItem: function (id) { return items[id]; } }, xml);
  eng.updateItems(ids);
  var bib = eng.makeBibliography(), entries = bib[1], order = bib[0].entry_ids.map(function (e) { return e[0]; });
  var exact = 0, near = 0, missing = {}, extra = {}, samples = [];
  sample.forEach(function (r, i) {
    var theirs = canon(entries[order.indexOf('ITEM-' + (i + 1))] || ''), ours = canon(A.format(r, st));
    if (theirs === ours) { exact++; return; }
    var a = toks(ours), b = toks(theirs), bset = {}, aset = {};
    b.forEach(function (t) { bset[t] = (bset[t] || 0) + 1; }); a.forEach(function (t) { aset[t] = (aset[t] || 0) + 1; });
    var onlyOurs = a.filter(function (t) { if (bset[t]) { bset[t]--; return false; } return true; });
    var onlyTheirs = b.filter(function (t) { if (aset[t]) { aset[t]--; return false; } return true; });
    if (!onlyOurs.length && !onlyTheirs.length) { near++; return; } // same words, different punctuation or order
    onlyOurs.forEach(function (t) { extra[t] = (extra[t] || 0) + 1; }); onlyTheirs.forEach(function (t) { missing[t] = (missing[t] || 0) + 1; });
    if (samples.length < SHOW) samples.push({ kind: A.kind(r), ours: ours, theirs: theirs, onlyOurs: onlyOurs.slice(0, 8), onlyTheirs: onlyTheirs.slice(0, 8) });
  });
  var top = function (o) { return Object.keys(o).sort(function (x, y) { return o[y] - o[x]; }).slice(0, 12).map(function (k) { return k + '×' + o[k]; }).join('  '); };
  console.log('\n== ' + st + ' vs ' + CSL_FILE[st] + ': ' + sample.length + ' records; identical ' + exact + ', same words ' + near + ', differ ' + (sample.length - exact - near));
  console.log('   words only ours has:   ' + top(extra));
  console.log('   words only theirs has: ' + top(missing));
  samples.forEach(function (s) { console.log('   [' + s.kind + '] ours:   ' + s.ours.slice(0, 200) + '\n   ' + ' '.repeat(s.kind.length + 2) + ' theirs: ' + s.theirs.slice(0, 200)); });
});
