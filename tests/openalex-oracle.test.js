// Oracle for the OpenAlex mapping (fromOpenAlex): 147 OpenAlex works fetched with the page's own select list
// (tests/fixtures/openalex-works.json), mapped and normalised, against the Crossref record of the same DOI.
// OpenAlex is the second-opinion search backend; a mapping slip here becomes a wrong reference for exactly the
// records Crossref cannot find.  Usage: node tests/openalex-oracle.test.js [--verbose]
var fs = require('fs'), path = require('path');
var ROOT = path.resolve(__dirname, '..');
var A = require(path.join(ROOT, 'citations.js'));
var works = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'openalex-works.json'), 'utf8'));
var corpus = {}; JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'corpus.json'), 'utf8')).forEach(function (m) { corpus[m.DOI.toLowerCase()] = m; });
var verbose = process.argv.indexOf('--verbose') !== -1, pass = 0, fail = 0, problems = {};
function flag(rule, s) { fail++; (problems[rule] = problems[rule] || []).push(s); }
function check(rule, ok, s) { if (ok) pass++; else flag(rule, s); }
var SUBSUP = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
function norm(s) { return A.stripTags(String(s || '')).normalize('NFC').replace(/[₀-₉⁰¹²³⁴-⁹]/g, function (c) { return SUBSUP[c]; }).toLowerCase().replace(/[‐-―]/g, '-').replace(/[^a-z0-9À-ɏͰ-ϿЀ-ӿ一-鿿]+/g, ' ').trim(); }
// Records whose OpenAlex copy legitimately differs from Crossref's, found by running the comparison exactly (6 of 147):
// OpenAlex dates these five Elsevier articles by their online-first year, one before the issue year Crossref deposited
var YEAR_OFF_BY_ONE = { '10.1016/j.ejrad.2021.110103': -1, '10.1016/j.flowmeasinst.2023.102515': -1, '10.1016/j.ic.2014.10.009': -1, '10.1016/j.ijleo.2015.11.163': -1, '10.1016/j.msard.2011.07.001': -1 };
// OpenAlex lists 3 authors where Crossref has 2 persons and 2 organisations: one organisation author is dropped
var AUTHOR_COUNT = { '10.2172/1440911': 3 };
works.forEach(function (x) {
  var want = A.normalize(corpus[x.doi.toLowerCase()]), got;
  try { got = A.normalize(A.fromOpenAlex(x.work)); } catch (e) { flag('fromOpenAlex throws', x.doi + ' ' + e.message); return; }
  var id = x.doi;
  check('DOI', (got.doi || '').toLowerCase() === want.doi.toLowerCase(), id + ' got ' + got.doi);
  // one source may carry the subtitle the other lacks
  var gt = norm(got.title), wt = norm(want.title);
  var gtc = gt.replace(/ /g, ''), wtc = wt.replace(/ /g, ''); // OpenAlex keeps a stray space around markup ("125 I")
  if (want.title) check('title', gtc === wtc || (gtc && wtc && (gtc.indexOf(wtc) === 0 || wtc.indexOf(gtc) === 0)), id + ' got "' + got.title + '" want "' + want.title + '"');
  // The year and the author count are compared exactly, except for the records below, each with its reason
  if (want.year) check('year', got.year === want.year || (want.years || []).indexOf(got.year) !== -1 || YEAR_OFF_BY_ONE[id] === Number(got.year) - Number(want.year), id + ' got ' + got.year + ' want ' + want.year + ' (' + (want.years || []).join('/') + ')');
  var wantPersons = want.authors.filter(function (a) { return !a.literal; });
  check('author count', got.authors.length === want.authors.length || (want.authors.length > 100 && got.authors.length >= 100) || AUTHOR_COUNT[id] === got.authors.length, id + ' got ' + got.authors.length + ' want ' + want.authors.length);
  var w0 = wantPersons[0] || want.authors[0], g0 = got.authors[0];
  if (w0 && g0) {
    // OpenAlex gives one display name; a compound or single-field Crossref family name may contain what we split off
    var g1 = got.authors[1], ALLOW = { '10.1049/cp:20060904': 'a Chinese name written both ways by the two sources' };
    var famMatch = function (g) { return g && (norm(g.family) === norm(w0.family) || norm(w0.family).indexOf(norm(g.family)) !== -1 || norm(g.family).indexOf(norm(w0.family)) !== -1 || norm(w0.family + ' ' + w0.given).indexOf(norm(g.family)) !== -1); };
    var famOk = famMatch(g0) || famMatch(g1) || !!ALLOW[id]; // OpenAlex may list an organisation first
    check('first author family', famOk, id + ' got "' + g0.family + '" want "' + w0.family + '"');
    if (famOk && !w0.literal && !g0.literal && w0.given && g0.given && norm(g0.family) === norm(w0.family)) check('first author initials', norm(w0.given).charAt(0) === norm(g0.given).charAt(0) || /universidad|university/i.test(w0.family), id + ' got "' + g0.given + '" want "' + w0.given + '"');
  }
  if (A.kind(want) === 'journal') {
    var RENAMED = { '10.1016/j.bbmt.2013.12.391': 1 }; // OpenAlex names the journal as it is called today
    var jn = function (s) { return norm(s).replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim(); }; // OpenAlex writes "&" as "and"
    if (want.container && !RENAMED[id]) check('journal', jn(got.container) === jn(want.container), id + ' got "' + got.container + '" want "' + want.container + '"');
    if (want.volume) check('volume', got.volume === want.volume, id + ' got ' + got.volume + ' want ' + want.volume);
    if (want.issue) check('issue', got.issue === want.issue, id + ' got ' + got.issue + ' want ' + want.issue);
    if (want.pages && !want.isArticleNumber) check('pages', norm(got.pages) === norm(want.pages) || norm(got.pages) === norm(want.pages.split(/[-–]/)[0]), id + ' got ' + got.pages + ' want ' + want.pages);
  }
  var oaLossy = x.work.type === 'other' || (x.work.type === 'article' && /^(journal-article|monograph)$/.test(want.type)) || (x.work.type === 'reference-entry' && /^(book-section|reference-book|other|reference-entry)$/.test(want.type)) || (x.work.type === 'conference-paper' && want.type === 'book-chapter') || (x.work.type === 'supplementary-materials');
  check('kind', A.kind(got) === A.kind(want) || A.kind(want) === 'generic' || (A.kind(want) === 'preprint' && A.kind(got) === 'journal') || oaLossy, id + ' got ' + A.kind(got) + ' (' + got.type + ') want ' + A.kind(want) + ' (' + want.type + ') oa=' + x.work.type);
  check('no leaked markup', !/<\/?[a-z]|&[a-z#]+;/i.test(got.title + got.container), id + ' ' + got.title);
});
Object.keys(problems).sort(function (a, b) { return problems[b].length - problems[a].length; }).forEach(function (rule) { console.log('FAIL ' + rule + '  (' + problems[rule].length + ')'); problems[rule].slice(0, verbose ? 40 : 3).forEach(function (s) { console.log('     ' + String(s).slice(0, 220)); }); });
console.log(works.length + ' OpenAlex works');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
