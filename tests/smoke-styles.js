// Smoke check of the built-in styles on hand-built edge records (hyphenated initials, all-caps names, suffixes,
// a "?" in a book title, article numbers, chapters, preprints, MARC punctuation, a missing year).  Each output is
// checked for shape rather than against an expected string: non-empty, carries the title and the first author's
// family name (or the editor's, or the organisation's), and ends with a full stop or a link.  --verbose prints
// every line.  Usage: node tests/smoke-styles.js [--verbose]
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var A = require(path.join(ROOT, 'citations.js'));
var verbose = process.argv.indexOf('--verbose') !== -1, passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + String(detail).slice(0, 300) : '')); } }
var STYLE_IDS = A.STYLES.map(function (s) { return s.id; }), EXPORT_IDS = A.EXPORTS.map(function (x) { return x.id; });
function norm(s) { return A.stripTags(String(s || '')).normalize('NFC').toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, ' ').trim(); }
var j = function (o) { return Object.assign({ type: 'journal-article', title: ['A title'], author: [{ family: 'Doe', given: 'Jane' }], issued: { 'date-parts': [[2020]] }, 'container-title': ['Journal of Cats'], volume: '12', issue: '3', page: '45-67', DOI: '10.1/x' }, o); };
function show(label, rec, styles) {
  if (verbose) console.log('## ' + label);
  var r = A.normalize(rec), first = (r.authors[0] || r.editors[0] || {}).family || '';
  (styles || ['apa']).forEach(function (st) {
    var out; try { out = A.format(r, st); } catch (e) { check(label + ' [' + st + '] formats', false, e.stack); return; }
    if (verbose) console.log('  [' + st + '] ' + out);
    var name = label + ' [' + st + ']';
    check(name + ' is a non-empty string', typeof out === 'string' && out.trim().length > 0, out);
    check(name + ' has no undefined/[object', !/\bundefined\b|\[object Object\]|\bNaN\b/.test(out), out);
    var words = STYLE_IDS.indexOf(st) !== -1 ? 3 : 1; // an export may escape the title ("Back\\textbackslash{}slash"), so only its first word is looked for there
    check(name + ' names the title', norm(out).indexOf(norm(r.title).split(' ').slice(0, words).join(' ')) !== -1, out);
    if (first) check(name + ' names the first author', norm(out).indexOf(norm(first)) !== -1, out + ' | ' + first);
    if (STYLE_IDS.indexOf(st) !== -1) check(name + ' ends with a full stop or a link', /\.$|https?:\/\/\S+$/.test(out.trim()), out);
    else if (EXPORT_IDS.indexOf(st) !== -1) check(name + ' is a tagged export', st === 'bibtex' ? /^@\w+\{[^,]+,[\s\S]*\}\s*$/.test(out) : st === 'ris' ? /^TY  - [\s\S]*\nER  - ?$/.test(out.trim()) : /^%0 [\s\S]*\n%T /.test(out), out);
  });
}
show('J.-P. initials', j({ author: [{ family: 'Sartre', given: 'J.-P.' }, { family: 'Lee', given: 'Jean-Pierre' }] }), ['apa', 'harvard', 'ieee', 'carnegie', 'vancouver']);
show('caps names', j({ author: [{ family: 'LEE', given: 'IAN' }, { family: 'SMITH', given: 'JOHN' }, { family: 'Maurer', given: 'PC' }, { family: 'DOE', given: 'J.D.' }] }), ['apa', 'mla', 'chicago']);
show('suffix', j({ author: [{ family: 'King', given: 'Martin Luther', suffix: 'Jr.' }, { family: 'Doe', given: 'Jane' }] }), ['apa', 'mla', 'chicago', 'ieee']);
show('italic ? title book', j({ type: 'book', title: ['Who owns the future?'], 'container-title': undefined, volume: undefined, issue: undefined, page: undefined, publisher: 'Penguin', 'publisher-location': 'London' }), ['apa', 'mla', 'chicago', 'harvard', 'ieee', 'vancouver', 'carnegie']);
show('article-number == page', j({ page: '103208', 'article-number': '103208', volume: '95', issue: undefined }), ['apa', 'ieee']);
show('harvard chapter + apa single page', j({ type: 'book-chapter', 'container-title': ['The Big Book'], editor: [{ family: 'Ed', given: 'Alan' }, { family: 'Ed', given: 'Beth' }, { family: 'Ed', given: 'Carl' }], publisher: 'Springer', 'publisher-location': 'Berlin', page: '5', volume: undefined, issue: undefined }), ['apa', 'harvard', 'mla', 'vancouver', 'ieee', 'chicago']);
show('issue no volume', j({ volume: undefined }), ['harvard', 'apa']);
show('preprint host', j({ type: 'posted-content', 'container-title': undefined, volume: undefined, issue: undefined, page: undefined, publisher: 'openRxiv', institution: [{ name: 'bioRxiv' }] }), ['apa', 'mla', 'chicago', 'harvard', 'vancouver', 'ieee', 'carnegie']);
show('given only', j({ author: [{ given: 'Consortium' }] }), ['apa', 'mla']);
show('edited book no authors', j({ type: 'book', author: undefined, editor: [{ family: 'Ed', given: 'Alan' }], title: ['Handbook of Cats'], 'container-title': undefined, volume: undefined, issue: undefined, page: undefined, publisher: 'Wiley', edition: '3' }), ['apa', 'mla', 'chicago', 'harvard', 'carnegie', 'vancouver', 'ieee']);
show('no source', j({ 'container-title': undefined, volume: undefined, issue: undefined, page: undefined }), ['apa', 'chicago']);
show('springer chapter series', j({ type: 'book-chapter', 'container-title': ['Use R!', 'ggplot2'], volume: undefined, issue: undefined, page: '189-201', publisher: 'Springer', 'publisher-location': 'Cham', DOI: '10.1007/978-3-319-24277-4_9' }), ['apa', 'carnegie', 'bibtex', 'ris']);
show('literal author exports', j({ author: [{ name: 'World Health Organization' }] }), ['bibtex', 'ris', 'endnote', 'apa']);
show('bibtex escapes', j({ title: ['Back\\slash & 100% of #tags_here {braces} ~tilde ^caret'] }), ['bibtex']);
show('thesis/report', j({ type: 'dissertation', title: ['A thesis'], 'container-title': undefined, volume: undefined, issue: undefined, page: undefined, publisher: 'MIT', 'publisher-location': 'Cambridge, Massachusetts', degree: ['M.S.'] }), ['bibtex', 'carnegie', 'apa']);
show('marc punctuation', j({ type: 'book', title: ['On the origin of species /'], author: [{ family: 'Darwin', given: 'Charles' }], 'container-title': undefined, volume: undefined, issue: undefined, page: undefined, publisher: 'John Murray,', 'publisher-location': 'London :', abstract: '<jats:title>Abstract</jats:title><jats:p>Line one.</jats:p><jats:p>Line two.</jats:p>', 'number-of-pages': '502' }), ['vancouver', 'carnegie', 'ris']);
show('vancouver missing year', j({ issued: undefined }), ['vancouver', 'apa', 'harvard']);
show('carnegie series volume', j({ type: 'book-chapter', 'container-title': ['Bulletin of Carnegie Museum of Natural History', 'Fanfare for an Uncommon Paleontologist'], editor: [{ family: 'Dawson', given: 'Mary R.' }, { family: 'Lillegraven', given: 'Jason A.' }], volume: '36', page: '245-266', issue: undefined, publisher: 'Carnegie Museum of Natural History' }), ['carnegie']);
// every built-in style on one ordinary record: the shape every style must share
var plain = A.normalize(j({ author: [{ family: 'Doe', given: 'Jane' }, { family: 'Roe', given: 'Rick' }] }));
STYLE_IDS.forEach(function (st) {
  var out = A.format(plain, st), name = 'every style [' + st + ']';
  check(name + ' is a non-empty string with the title and first author', typeof out === 'string' && /A title/.test(out) && /Doe/.test(out), out);
  check(name + ' ends with a full stop or a link', /\.$|https?:\/\/\S+$/.test(out.trim()), out);
});
var conf = A.matchConfidence('Deep residual learning for image recognition', j({ title: ['Deep Residual Learning for Image Recognition'], author: [{ family: 'He', given: 'K' }], issued: { 'date-parts': [[2016]] } }), { titleOnly: true });
if (verbose) console.log('titleOnly conf:', conf);
check('titleOnly matchConfidence is a number in [0, 1]', typeof conf === 'number' && conf >= 0 && conf <= 1, conf);
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
