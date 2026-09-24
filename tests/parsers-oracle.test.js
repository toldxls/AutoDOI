// Oracle for the file parsers: Crossref's own RIS and BibTeX renderings of 147 corpus records (tests/fixtures/
// crossref-exports.json, from api.crossref.org/works/{doi}/transform), each parsed and normalised, against the
// normalised JSON record they were made from.  Crossref is a major producer of both formats, and the truth is the
// same record, so every field difference is either a parser gap or a Crossref rendering quirk to be understood.
// Usage: node tests/parsers-oracle.test.js [--verbose]
var fs = require('fs'), path = require('path');
var ROOT = path.resolve(__dirname, '..');
var A = require(path.join(ROOT, 'citations.js')), P = require(path.join(ROOT, 'parsers.js'));
var exportsFx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'crossref-exports.json'), 'utf8'));
var corpus = {}; JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'corpus.json'), 'utf8')).forEach(function (m) { corpus[m.DOI.toLowerCase()] = m; });
var verbose = process.argv.indexOf('--verbose') !== -1;
var pass = 0, fail = 0, problems = {};
function flag(rule, sample) { fail++; (problems[rule] = problems[rule] || []).push(sample); }
function check(rule, ok, sample) { if (ok) pass++; else flag(rule, sample); }
var SUBSUP = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
function norm(s) { return A.stripTags(String(s || '')).normalize('NFC').replace(/[₀-₉⁰¹²³⁴-⁹]/g, function (c) { return SUBSUP[c]; }).toLowerCase().replace(/[‐-―]/g, '-').replace(/[^a-z0-9À-ɏͰ-ϿЀ-ӿ一-鿿]+/g, ' ').trim(); }
function compare(fmt, got, want, doi) {
  var tag = fmt + ': ';
  // Crossref's RIS drops the subtitle: the main title alone is accepted for RIS
  var wt = norm(want.title), gt = norm(got.title), mainOnly = fmt === 'ris' && want.title.indexOf(':') !== -1 && gt && wt.indexOf(gt) === 0;
  if (want.title && !(fmt === 'bibtex' && !/[{,]\s*title\s*=/i.test(String(got.raw && got.raw.fields ? Object.keys(got.raw.fields).join(',') : 'title')))) check(tag + 'title', gt === wt || mainOnly, doi + '  got "' + got.title + '" want "' + want.title + '"');
  check(tag + 'year', got.year === want.year, doi + '  got ' + got.year + ' want ' + want.year);
  check(tag + 'DOI', (got.doi || '').toLowerCase() === (want.doi || '').toLowerCase(), doi + '  got ' + got.doi);
  // Crossref's exports leave out organisation authors and split a single-field name: persons are compared
  var wantPersons = want.authors.filter(function (a) { return !a.literal; }), wantNamed = want.authors.filter(function (a) { return a.family; });
  check(tag + 'author count', got.authors.length === want.authors.length || got.authors.length === wantPersons.length, doi + '  got ' + got.authors.length + ' want ' + want.authors.length);
  var w0 = wantPersons[0] || wantNamed[0], g0 = got.authors[0];
  if (w0 && g0) {
    var same = norm(g0.family) === norm(w0.family) || (w0.literal && norm(w0.family).indexOf(norm(g0.family)) !== -1);
    check(tag + 'first author family', same, doi + '  got "' + g0.family + '" want "' + w0.family + '"');
    if (!w0.literal && !g0.literal) check(tag + 'first author given', norm(g0.given) === norm(w0.given), doi + '  got "' + g0.given + '" want "' + w0.given + '"');
  }
  if (want.editors.length && fmt === 'bibtex') check(tag + 'editor count', got.editors.length === want.editors.length, doi + '  got ' + got.editors.length + ' want ' + want.editors.length); // RIS has no editors
  if (A.kind(want) === 'journal') {
    check(tag + 'journal', norm(got.container) === norm(want.container), doi + '  got "' + got.container + '" want "' + want.container + '"');
    if (want.volume) check(tag + 'volume', got.volume === want.volume, doi + '  got ' + got.volume + ' want ' + want.volume);
    if (want.issue) check(tag + 'issue', got.issue === want.issue, doi + '  got ' + got.issue + ' want ' + want.issue);
    if (want.pages && !want.isArticleNumber) check(tag + 'pages', norm(got.pages) === norm(want.pages), doi + '  got ' + got.pages + ' want ' + want.pages); // an article number is not exported
  }
  if (A.kind(want) === 'chapter' && want.container && fmt === 'bibtex') check(tag + 'book title of a chapter', norm(got.container) === norm(want.container), doi + '  got "' + got.container + '" want "' + want.container + '"'); // RIS carries the series instead
  if (want.publisher && A.kind(want) !== 'journal') check(tag + 'publisher', norm(got.publisher) === norm(want.publisher), doi + '  got "' + got.publisher + '" want "' + want.publisher + '"');
  var lossy = /^(dataset|report|dissertation|posted-content|standard|peer-review|report-component|reference-entry|other)$/.test(want.type) && /^(other|GENERIC)$/.test(got.type) // the exporter wrote GENERIC/@misc with nothing to infer from (an encyclopedia entry and a dataset look alike without an ISBN)
    || (want.type === 'posted-content' && got.type === 'journal-article' && !got.container && !/^10\.1101\//.test(want.doi)); // publisher-hosted posted content written as @article with no journal
  check(tag + 'kind', A.kind(got) === A.kind(want) || A.kind(want) === 'generic' || lossy, doi + '  got ' + A.kind(got) + ' (' + got.type + ') want ' + A.kind(want) + ' (' + want.type + ')');
  check(tag + 'no leaked markup or entities', !/<\/?[a-z]|&[a-z#]+;|\\[a-z]+\{/i.test(got.title + got.container), doi + '  ' + got.title);
}
exportsFx.forEach(function (x) {
  var want = A.normalize(corpus[x.doi.toLowerCase()]);
  var ris, bib;
  try { ris = P.parseRIS(x.ris); } catch (e) { flag('ris: parser throws', x.doi + ' ' + e.message); }
  try { bib = P.parseBibTeX(x.bibtex); } catch (e) { flag('bibtex: parser throws', x.doi + ' ' + e.message); }
  if (ris) { check('ris: one record', ris.length === 1, x.doi + ' ' + ris.length); if (ris.length === 1) compare('ris', A.normalize(ris[0]), want, x.doi); }
  if (bib) { check('bibtex: one record', bib.length === 1, x.doi + ' ' + bib.length); if (bib.length === 1) compare('bibtex', A.normalize(bib[0]), want, x.doi); }
});
Object.keys(problems).sort(function (a, b) { return problems[b].length - problems[a].length; }).forEach(function (rule) {
  console.log('FAIL ' + rule + '  (' + problems[rule].length + ')');
  problems[rule].slice(0, verbose ? 40 : 3).forEach(function (s) { console.log('     ' + String(s).slice(0, 220)); });
});
console.log(exportsFx.length + ' records, RIS and BibTeX each');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
