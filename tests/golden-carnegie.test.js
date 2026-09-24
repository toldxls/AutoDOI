// Oracle: the example references printed in the CMNH Publications Authors' Guide (6 January 2010),
// "Literature Cited" section, reproduced exactly from their metadata.  These are the journal's own
// examples, not this project's reading of the rules.  Usage: node tests/golden-carnegie.test.js
var ROOT = require('path').resolve(__dirname, '..');
var A = require(require('path').join(ROOT, 'citations.js'));
var pass = 0, fail = 0;
function eq(label, got, want) { if (got === want) pass++; else { fail++; console.log('FAIL ' + label + '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want)); } }
function person(family, given, suffix) { return { family: family, given: given, suffix: suffix || '', literal: false }; }
function rec(o) { // a normalized record with every default, then the example's fields on top (titles carry their subtitle after ': ', as normalize() produces)
  var r = A.normalize({ type: o.type || 'journal-article', title: [o.title || 'T'], issued: { 'date-parts': [[o.year || 2000]] } });
  Object.keys(o).forEach(function (k) { r[k] = o[k]; });
  return r;
}
var G = 'carnegie';

// Article that is part of a regular journal series
eq('guide: journal article, one author',
  A.format(rec({ authors: [person('Wahlert', 'J. H.')], year: '1977', title: 'Cranial foramina and relationships of Eutypomys (Rodentia, Eutypomyidae)', container: 'American Museum Novitates', volume: '2626', pages: '1-8' }), G),
  'Wahlert, J.H. 1977. Cranial foramina and relationships of Eutypomys (Rodentia, Eutypomyidae). American Museum Novitates, 2626:1-8.');
eq('guide: journal article, two authors',
  A.format(rec({ authors: [person('Soltis', 'D. E.'), person('Soltis', 'P. S.')], year: '1992', title: 'The distribution of selfing rates in homosporous ferns', container: 'American Journal of Botany', volume: '79', pages: '97-100' }), G),
  'Soltis, D.E., and P.S. Soltis. 1992. The distribution of selfing rates in homosporous ferns. American Journal of Botany, 79:97-100.');
eq('guide: edited work in a periodical series (editors as authors, edition)',
  A.format(rec({ authors: [], editors: [person('Holmgren', 'P. K.'), person('Holmgren', 'N. H.'), person('Barnett', 'L. C.')], year: '1990', title: 'Index Herbariorum, Part I', edition: '8', container: 'Regnum Vegetabile', volume: '120', pages: '1-693' }), G),
  'Holmgren, P.K., N.H. Holmgren, and L.C. Barnett (eds.). 1990. Index Herbariorum, Part I, Eighth Edition. Regnum Vegetabile, 120:1-693.');

// Book
eq('guide: book with page count',
  A.format(rec({ type: 'book', authors: [person('Samways', 'M. J.')], year: '1994', title: 'Insect Conservation Biology', publisher: 'Chapman and Hall', place: 'London', numPages: '380' }), G),
  'Samways, M.J. 1994. Insect Conservation Biology. Chapman and Hall, London. 380 pp.');

// New edition of a book
eq('guide: book, third edition',
  A.format(rec({ type: 'book', authors: [person('Ostle', 'B.'), person('Mensing', 'R. W.')], year: '1975', title: 'Statistics in Research', edition: '3', publisher: 'Iowa State University Press', place: 'Ames, Iowa' }), G),
  'Ostle, B., and R.W. Mensing. 1975. Statistics in Research, Third Edition. Iowa State University Press, Ames, Iowa.');
eq('guide: edited book, second edition, subtitle',
  A.format(rec({ type: 'edited-book', authors: [], editors: [person('Wilson', 'D. E.'), person('Reeder', 'D. M.')], year: '1993', title: 'Mammal Species of the World: A Taxonomic and Geographic Reference', edition: '2', publisher: 'Smithsonian Institution Press', place: 'Washington, D.C.' }), G),
  'Wilson, D.E., and D.M. Reeder (eds.). 1993. Mammal Species of the World: A Taxonomic and Geographic Reference, Second Edition. Smithsonian Institution Press, Washington, D.C.');
eq('guide: book, second edition, publisher with initials',
  A.format(rec({ type: 'book', authors: [person('Sokal', 'R. R.'), person('Rohlf', 'F. J.')], year: '1981', title: 'Biometry', edition: '2', publisher: 'W.H. Freeman and Company', place: 'New York' }), G),
  'Sokal, R.R., and F.J. Rohlf. 1981. Biometry, Second Edition. W.H. Freeman and Company, New York.');

// Chapter or paper in an edited volume
eq('guide: chapter in an edited book',
  A.format(rec({ type: 'book-chapter', authors: [person('Asher', 'R. J.')], year: '2005', title: 'Insectivoran-grade placentals', container: 'The Rise of Placental Mammals', editors: [person('Rose', 'K. D.'), person('Archibald', 'J. D.')], pages: '50-70', publisher: 'The Johns Hopkins University Press', place: 'Baltimore' }), G),
  'Asher, R.J. 2005. Insectivoran-grade placentals. Pp. 50-70, in The Rise of Placental Mammals (K.D. Rose and J.D. Archibald, eds.). The Johns Hopkins University Press, Baltimore.');
eq('guide: paper in an edited volume that is a numbered series issue',
  A.format(rec({ type: 'book-chapter', authors: [person('Rougier', 'G. W.'), person('Wible', 'J. R.'), person('Novacek', 'M. J.')], year: '2004', title: 'New specimen of Deltatheroides cretacicus (Metatheria, Deltatheriididae) from the Late Cretaceous of Mongolia', container: 'Fanfare for an Uncommon Paleontologist: Papers in Honor of Malcolm C. McKenna', editors: [person('Dawson', 'M. R.'), person('Lillegraven', 'J. A.')], series: 'Bulletin of Carnegie Museum of Natural History', volume: '36', pages: '245-266' }), G),
  'Rougier, G.W., J.R. Wible, and M.J. Novacek. 2004. New specimen of Deltatheroides cretacicus (Metatheria, Deltatheriididae) from the Late Cretaceous of Mongolia. In Fanfare for an Uncommon Paleontologist: Papers in Honor of Malcolm C. McKenna (M.R. Dawson and J.A. Lillegraven, eds.). Bulletin of Carnegie Museum of Natural History, 36:245-266.');

// Reference to a dissertation
eq('guide: dissertation',
  A.format(rec({ type: 'dissertation', authors: [person('Rasmussen', 'D. L.')], year: '1977', title: 'Geology and mammalian paleontology of the Oligocene-Miocene Cabbage Patch Formation, central-western Montana', genre: 'Ph.D.', institution: 'University of Kansas', place: 'Lawrence, Kansas' }), G),
  'Rasmussen, D.L. 1977. Geology and mammalian paleontology of the Oligocene-Miocene Cabbage Patch Formation, central-western Montana. Unpublished Ph.D. Dissertation, University of Kansas, Lawrence, Kansas.');

// Reference to a web site
eq('guide: web site with access date and a Jr.',
  A.format(rec({ type: 'webpage', authors: [person('Fetzner', 'J. W.', 'Jr.')], year: '2008', title: 'Biodiversity Services Facility, Collection and Identification Services', accessed: { year: 2008, month: 7, day: 16 }, url: 'http://iz.carnegiemnh.org/CMIC/Default.org' }), G),
  'Fetzner, J.W., Jr. 2008. Biodiversity Services Facility, Collection and Identification Services [cited 16 July 2008]. Available from http://iz.carnegiemnh.org/CMIC/Default.org');

// In-text forms given in the guide
eq('guide: in-text one author', A.inText(rec({ authors: [person('Wible', 'J. R.')], year: '2000' }), G), '(Wible 2000)');
eq('guide: in-text two authors', A.inText(rec({ authors: [person('Wible', 'J. R.'), person('Rawlins', 'J. E.')], year: '2001' }), G), '(Wible and Rawlins 2001)');
eq('guide: in-text three or more', A.inText(rec({ authors: [person('Wible', 'J. R.'), person('Rougier', 'G. W.'), person('Novacek', 'M. J.')], year: '2002' }), G), '(Wible et al. 2002)');

// Conventions stated as rules in the guide
eq('rule 3: every author named, no et al.',
  A.format(rec({ authors: 'ABCDEFGHIJKL'.split('').map(function (c) { return person(c + 'ee', 'X.'); }), year: '2001', title: 'T', container: 'J', volume: '1', pages: '1-2' }), G).indexOf('et al') === -1, true);
eq('rule 2/6/7: issue in parentheses, comma before volume, no space after colon',
  A.format(rec({ authors: [person('Ash', 'A.')], year: '2001', title: 'T', container: 'J', volume: '12', issue: '3', pages: '10-20' }), G), 'Ash, A. 2001. T. J, 12(3):10-20.');

console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
