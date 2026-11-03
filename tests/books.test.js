// A book looked up by ISBN: Open Library's edition record read by A.fromOpenLibraryEdition, and Crossref's and Open Library's
// records merged by A.bookRecord.  The page and the command line both read their answers through these two.
// Usage: node tests/books.test.js
var path = require('path');
var A = require(path.join(path.resolve(__dirname, '..'), 'citations.js'));
var pass = 0, fail = 0;
function eq(label, got, want) { var g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) pass++; else { fail++; console.log('FAIL ' + label + '\n   got  ' + g + '\n   want ' + w); } }
var fams = function (list) { return (list || []).map(function (p) { return p.family || p.name; }); };

// an edition record as openlibrary.org/isbn/<isbn>.json gives it
var hardy = { title: 'An introduction to the theory of numbers', publish_date: 'March 5, 1979', edition_name: '5th ed.', number_of_pages: 426, publishers: ['Clarendon Press'], publish_places: ['Oxford'],
  by_statement: 'by G. H. Hardy and E. M. Wright.', series: ['Oxford science publications'], authors: [{ key: '/authors/OL1A' }] };
var m = A.fromOpenLibraryEdition(hardy, '9780198531715');
eq('the "by" statement gives the authors', fams(m.author), ['Hardy', 'Wright']);
eq('year, edition, pages, publisher, place and series from the edition', [m.issued['date-parts'][0][0], m.edition, m['number-of-pages'], m.publisher, m['publisher-location'], m['collection-title']], [1979, '5th', '426', 'Clarendon Press', 'Oxford', 'Oxford science publications']);
eq('the ISBN asked for', m.ISBN, ['9780198531715']);
eq('names that the statement gives are not in doubt', !!m.namesUnsure, false);
eq('a subtitle joins the title', A.fromOpenLibraryEdition({ title: 'Igneous petrology', subtitle: 'a primer' }, '1').title[0], 'Igneous petrology: a primer');
eq('no title, no record', A.fromOpenLibraryEdition({ publish_date: '2001' }, '1'), null);
eq('no record, no record', A.fromOpenLibraryEdition(null, '1'), null);

var ed = A.fromOpenLibraryEdition({ title: 'Sulfide mineralogy', by_statement: 'edited by P. H. Ribbe; J. Smith & K. Jones', publish_date: '1974' }, '1');
eq('"edited by": editors, and no authors', [fams(ed.editor), ed.author], [['Ribbe', 'Smith', 'Jones'], undefined]);
eq('a comma list with "and"', fams(A.fromOpenLibraryEdition({ title: 'X', by_statement: 'Anne Abel, Bea Baker, and Cy Cole' }, '1').author), ['Abel', 'Baker', 'Cole']);

// a statement that names only an illustrator or translator says nothing of the authors: the caller asks for more
var ill = { title: 'The wind in the willows', by_statement: 'illustrated by E. H. Shepard.', authors: [{ key: '/authors/OL2A' }] };
var bare = A.fromOpenLibraryEdition(ill, '1');
eq('an illustrator is not the author, and no names means no author field', [bare.author, bare.editor], [undefined, undefined]);
eq('the edition\'s author records stand in', fams(A.fromOpenLibraryEdition(ill, '1', { authorNames: ['Kenneth Grahame'] }).author), ['Grahame']);
eq('empty author records: the work search\'s names, marked unsure', (function () { var r = A.fromOpenLibraryEdition(ill, '1', { authorNames: ['', ''], searchNames: ['Kenneth Grahame'] }); return [fams(r.author), r.namesUnsure]; })(), [['Grahame'], true]);
eq('an empty "by" statement is no names', A.fromOpenLibraryEdition({ title: 'X', by_statement: 'by .' }, '1').author, undefined);

// merging
var crBook = { type: 'book', DOI: '10.1093/oso/9780198531715.001.0001', title: ['An Introduction to the Theory of Numbers'], publisher: 'Oxford University Press', issued: { 'date-parts': [[1979]] },
  author: [{ given: 'G. H.', family: 'Hardy' }, { given: 'E. M.', family: 'Wright' }] };
var article = { type: 'journal-article', DOI: '10.1/review', title: ['A review of the theory of numbers'], author: [{ family: 'Smith', given: 'J.' }], issued: { 'date-parts': [[1980]] } };
var r = A.bookRecord([article, crBook], m, '9780198531715');
eq('Crossref\'s book is the record (it has the DOI); a journal article in the same search is not the book', r.doi, '10.1093/oso/9780198531715.001.0001');
eq('Open Library fills the place, pages and edition Crossref lacks', [r.place, r.numPages, r.edition], ['Oxford', '426', '5th']);
eq('Crossref\'s own fields stand', r.publisher, 'Oxford University Press');
var nameless = JSON.parse(JSON.stringify(crBook)); delete nameless.author; delete nameless.issued;
var r2 = A.bookRecord([nameless], A.fromOpenLibraryEdition(ill, '1', { searchNames: ['Kenneth Grahame'] }), '1');
eq('a Crossref book with no names or year takes Open Library\'s, doubt and all', [r2.authors.map(function (p) { return p.family; }), r2.namesUnsure, r2.doi], [['Grahame'], true, '10.1093/oso/9780198531715.001.0001']);
var r3 = A.bookRecord([], m, '9780198531715');
eq('no Crossref book: Open Library\'s record, with no Open Library link', [r3.title, r3.url, r3.isbn, r3.edition], ['An introduction to the theory of numbers', '', '9780198531715', '5th']);
eq('the work search\'s record (A.fromOpenLibrary) merges too', A.bookRecord([], Object.assign(A.fromOpenLibrary({ key: '/works/OL1W', title: 'X', author_name: ['Ann Abel'], first_publish_year: 1990 }, '2'), { namesUnsure: true }), '2').namesUnsure, true);
eq('neither has it: null', A.bookRecord([article], null, '1'), null);
eq('the merged record in APA: the DOI from Crossref, the edition from Open Library', A.format(r, 'apa'), 'Hardy, G. H., & Wright, E. M. (1979). An Introduction to the Theory of Numbers (5th ed.). Oxford University Press. https://doi.org/10.1093/oso/9780198531715.001.0001');

console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
