var ROOT = require('path').resolve(__dirname, '..');
var FIX = require('path').join(__dirname, 'fixtures');
// Round-trip and unit tests for parsers.js
var A = require(require('path').join(ROOT, 'citations.js'));
var P = require(require('path').join(ROOT, 'parsers.js'));

var pass = 0, fail = 0, failures = [];
function eq(actual, expected, label) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return true; }
  fail++; failures.push(label + '\n    expected: ' + e + '\n    actual:   ' + a); return false;
}
function ok(cond, label) { eq(!!cond, true, label); }

/* ---------- hand-written Crossref-like records ---------- */
var RECORDS = {
  journal: { type: 'journal-article', DOI: '10.1103/PhysRevLett.123.040401', URL: 'https://doi.org/10.1103/PhysRevLett.123.040401',
    title: ['Quantum supremacy & programmable processors'], subtitle: ['A new era'],
    author: [{ family: 'Arute', given: 'Frank' }, { family: 'Martinis', given: 'John M.' }],
    'container-title': ['Physical Review Letters'], 'short-container-title': ['Phys. Rev. Lett.'],
    volume: '123', issue: '4', page: '505-510', issued: { 'date-parts': [[2019, 7, 22]] },
    publisher: 'American Physical Society', ISSN: ['0031-9007'], language: 'en', abstract: 'We report on a 53-qubit device.' },
  articleNumber: { type: 'journal-article', DOI: '10.1371/journal.pone.0248152',
    title: ['Sleep and cognition in older adults'], author: [{ family: 'Nguyen', given: 'Thi-Lan' }],
    'container-title': ['PLOS ONE'], volume: '16', issue: '3', 'article-number': 'e0248152',
    issued: { 'date-parts': [[2021, 3]] }, publisher: 'Public Library of Science', ISSN: ['1932-6203'] },
  chapter: { type: 'book-chapter', DOI: '10.1007/978-3-319-24277-4_2',
    title: ['Data Visualisation'], author: [{ family: 'Wickham', given: 'Hadley' }],
    editor: [{ family: 'Gentleman', given: 'Robert' }, { family: 'Hornik', given: 'Kurt' }],
    'container-title': ['Use R!', 'ggplot2: Elegant Graphics for Data Analysis'],
    page: '11-31', publisher: 'Springer', 'publisher-location': 'New York, NY', issued: { 'date-parts': [[2016]] },
    ISBN: ['978-3-319-24277-4'] },
  book: { type: 'book', title: ['The Elements of Statistical Learning'],
    author: [{ family: 'Hastie', given: 'Trevor' }, { family: 'Tibshirani', given: 'Robert' }, { family: 'Friedman', given: 'Jerome' }],
    edition: '2', 'collection-title': ['Springer Series in Statistics'], publisher: 'Springer', 'publisher-location': 'New York',
    issued: { 'date-parts': [[2009]] }, ISBN: ['978-0-387-84857-0'], DOI: '10.1007/978-0-387-84858-7' },
  thesis: { type: 'dissertation', title: ['Learning representations of speech'],
    author: [{ family: "O'Connor", given: 'Siobhán' }], publisher: 'Massachusetts Institute of Technology',
    'publisher-location': 'Cambridge, MA', issued: { 'date-parts': [[2015, 5]] }, URL: 'https://hdl.handle.net/1721.1/12345' },
  preprint: { type: 'posted-content', DOI: '10.1101/2020.03.15.123456', title: ['Rapid detection of SARS-CoV-2'],
    author: [{ family: 'Müller', given: 'Jürgen' }, { family: 'García-Pérez', given: 'José Ángel' }, { family: 'Øst', given: 'Åse' }],
    'container-title': ['bioRxiv'], issued: { 'date-parts': [[2020, 3, 15]] } },
  organisation: { type: 'report', title: ['Global tuberculosis report 2021'],
    author: [{ name: 'World Health Organization' }], publisher: 'World Health Organization', 'publisher-location': 'Geneva',
    issued: { 'date-parts': [[2021]] }, ISBN: ['978-92-4-003702-1'], URL: 'https://www.who.int/publications/i/item/9789240037021' },
  proceedings: { type: 'proceedings-article', DOI: '10.1145/3313831.3376218', title: ['Designing for trust'],
    author: [{ family: 'King', given: 'Martin Luther', suffix: 'Jr.' }, { name: 'IEEE Computer Society' }],
    editor: [{ family: 'de la Cruz', given: 'Ana' }],
    'container-title': ['Lecture Notes in Computer Science', 'Proceedings of the 2019 CHI Conference'],
    volume: '11', page: '1-10', publisher: 'ACM', 'publisher-location': 'Glasgow', issued: { 'date-parts': [[2019, 6]] } }
};

function people(list) { return list.map(function (p) { return [p.family, p.given, p.suffix, p.literal].join('|'); }); }
function snapshot(r, fmt) {
  var s = { kind: A.kind(r), title: r.title, authors: people(r.authors), editors: people(r.editors), container: r.container,
    series: r.series, volume: r.volume, issue: r.issue, pages: r.pages, year: r.year, month: r.month, doi: r.doi,
    publisher: r.publisher, place: r.place, edition: r.edition, issn: r.issn, isbn: r.isbn, url: r.url };
  if (fmt === 'ris') s.shortContainer = r.shortContainer;
  if (fmt !== 'bibtex') { s.day = r.day; s.language = r.language; s.abstract = r.abstract; } // the BibTeX exporter writes none of these
  return s;
}

/* ---------- round trips: normalize -> format -> parse -> normalize ---------- */
var FORMATS = [['ris', 'ris'], ['endnote', 'enw'], ['bibtex', 'bibtex']];
Object.keys(RECORDS).forEach(function (name) {
  var r = A.normalize(RECORDS[name]);
  FORMATS.forEach(function (fp) {
    var text = A.format(r, fp[0]);
    var out = P.parse(text);
    eq(out.format, fp[1], name + '/' + fp[0] + ' detect');
    eq(out.records.length, 1, name + '/' + fp[0] + ' one record');
    var rec = out.records[0];
    eq(rec.source, fp[1], name + '/' + fp[0] + ' source');
    ok(rec.raw && typeof rec.raw === 'object', name + '/' + fp[0] + ' raw kept');
    var r2 = A.normalize(rec);
    eq(snapshot(r2, fp[1]), snapshot(r, fp[1]), name + '/' + fp[0] + ' round trip');
  });
});

// several records in one file, all three formats
FORMATS.forEach(function (fp) {
  var text = Object.keys(RECORDS).map(function (k) { return A.format(A.normalize(RECORDS[k]), fp[0]); }).join('\n\n');
  eq(P.parse(text).records.length, Object.keys(RECORDS).length, 'multi-record ' + fp[0]);
});

/* ---------- detect ---------- */
eq(P.detect('TY  - JOUR\nER  - '), 'ris', 'detect ris');
eq(P.detect('﻿TY - JOUR\r\nER -\r\n'), 'ris', 'detect ris BOM/CRLF/single space');
eq(P.detect('%0 Journal Article\n%T x\n'), 'enw', 'detect enw');
eq(P.detect('@article{key,\n title={x}}'), 'bibtex', 'detect bibtex');
eq(P.detect('@Book(key, title="x")'), 'bibtex', 'detect bibtex parens');
eq(P.detect('Just some text about 10.1000/xyz'), null, 'detect none');
eq(P.parse('nothing').records.length, 0, 'parse unknown returns no records');

/* ---------- realistic EndNote RIS export (CRLF, tag variants, continuation, trailing-comma organisation) ---------- */
var RIS = [
  'TY  - JOUR', 'AU  - Kucsko, G.', 'AU  - Maurer, P. C.', 'AU  - Centers for Disease Control and Prevention,',
  'A2  - Lukin, M. D.', 'TI  - Nanometre-scale thermometry in a living', '   cell', 'T2  - Nature', 'JO  - Nature',
  'JA  - Nat.', 'VL  - 500', 'IS  - 7460', 'SP  - 54', 'EP  - 58', 'PY  - 2013', 'DA  - 2013/08/01/', 'PB  - Nature Publishing Group',
  'CY  - London', 'SN  - 0028-0836 (Print)', 'SN  - 1476-4687', 'DO  - https://doi.org/10.1038/nature12373',
  'UR  - https://www.nature.com/articles/nature12373', 'KW  - thermometry', 'KW  - diamond', 'LA  - eng', 'AB  - Sensitive probing of temperature variations on nanometre',
  'scales is an outstanding challenge.', 'N1  - Times cited: 12', 'ER  - ', '',
  'TY - CHAP', 'AU - van der Berg, Jan', 'A2 - Smith, John, III', 'A2 - World Health Organization,', 'TI -Cells and tissues',
  'T2 - Handbook of Biology', 'T3 - Springer Handbooks', 'ET - 3rd', 'SP - 100-120', 'PY - 2019///', 'PB - Springer', 'CY - Berlin',
  'SN - 978-3-540-12345-6', 'UR - http://dx.doi.org/10.1007/978-3-540-12345-6_4', 'ER -',
  'TY  - THES', 'AU  - Doe, Jane', 'TI  - A thesis', 'PY  - 2020/05', 'PB  - Stanford University', 'M3  - Ph.D.', 'ER  - ',
  'TY  - BOOK', 'AU  - Anonymous', 'TI  - Old book', 'T2  - Great Series', 'Y1  - 1999///', 'ER  - ',
  'TY  - UNPB', 'AU  - Roe, Richard', 'T1  - Preprint title', 'T2  - arXiv', 'DA  - 2022/01/02/', 'ER  - ',
  'TY  - CONF', 'AU  - Poe, Edgar', 'TI  - Conf paper', 'T2  - Proc. of Things', 'T3  - LNCS', 'ER  - ',
  'TY  - DATA', 'TI  - Dataset', 'ER  - ', 'TY  - COMP', 'TI  - Software', 'ER  - ', 'TY  - RPRT', 'TI  - Report', 'ER  - ',
  'TY  - ELEC', 'TI  - Web', 'ER  - ', 'TY  - GEN', 'TI  - Gen', 'ER  - ', 'TY  - EJOUR', 'TI  - Ejour', 'ER  - ', 'TY  - CPAPER', 'TI  - Cp', 'ER  - '
].join('\r\n');
var risOut = P.parse(RIS);
eq(risOut.format, 'ris', 'ris export detect');
eq(risOut.records.length, 13, 'ris export record count');
var j = risOut.records[0], jn = A.normalize(j);
eq(j.type, 'journal-article', 'ris JOUR type');
eq(j.title, ['Nanometre-scale thermometry in a living cell'], 'ris continuation line joins title');
eq(j.author, [{ family: 'Kucsko', given: 'G.' }, { family: 'Maurer', given: 'P. C.' }, { name: 'Centers for Disease Control and Prevention' }], 'ris authors incl. trailing-comma organisation');
eq(j.editor, undefined, 'ris A2 not editors for JOUR');
eq(j['container-title'], ['Nature'], 'ris T2 container');
eq(j['short-container-title'], undefined, 'ris JO equal to T2 is not a short title');
eq(j.volume + '/' + j.issue + '/' + j.page, '500/7460/54-58', 'ris VL/IS/SP-EP');
eq(j.issued, { 'date-parts': [[2013, 8, 1]] }, 'ris DA over PY');
eq(j.ISSN, ['0028-0836', '1476-4687'], 'ris SN issn (qualifier ignored)');
eq(j.DOI, '10.1038/nature12373', 'ris DO with doi.org prefix');
eq(j.URL, 'https://www.nature.com/articles/nature12373', 'ris UR');
eq(j.language, 'eng', 'ris LA');
ok(/Sensitive probing.*scales is an outstanding challenge\./.test(j.abstract), 'ris AB with continuation');
eq(j.raw.KW, ['thermometry', 'diamond'], 'ris raw keeps KW');
eq(j.raw.N1, ['Times cited: 12'], 'ris raw keeps N1');
eq(jn.publisher + '|' + jn.place, 'Nature Publishing Group|London', 'ris PB/CY');
eq(jn.authors[2].literal, true, 'ris organisation normalizes as literal');
var c = risOut.records[1];
eq(c.type, 'book-chapter', 'ris CHAP');
eq(c.title, ['Cells and tissues'], 'ris tag missing trailing space');
eq(c.author, [{ family: 'van der Berg', given: 'Jan' }], 'ris single-space tags author');
eq(c.editor, [{ family: 'Smith', given: 'John', suffix: 'III' }, { name: 'World Health Organization' }], 'ris A2 editors for CHAP with suffix and organisation');
eq(c['container-title'], ['Springer Handbooks', 'Handbook of Biology'], 'ris series first, book last');
eq(A.normalize(c).container + '|' + A.normalize(c).series, 'Handbook of Biology|Springer Handbooks', 'ris chapter normalizes container/series');
eq(c.page, '100-120', 'ris SP alone with range');
eq(c.edition, '3rd', 'ris ET');
eq(c.issued, { 'date-parts': [[2019]] }, 'ris PY 2019///');
eq(c.ISBN, ['978-3-540-12345-6'], 'ris SN isbn');
eq(c.DOI, '10.1007/978-3-540-12345-6_4', 'ris DOI from UR dx.doi.org');
var t = risOut.records[2];
eq(t.type + '|' + t.genre + '|' + t.publisher, 'dissertation|Ph.D.|Stanford University', 'ris THES');
eq(t.issued, { 'date-parts': [[2020, 5]] }, 'ris PY 2020/05');
var b = risOut.records[3];
eq(b.author, [{ family: 'Anonymous' }], 'ris single-word author');
eq(b['collection-title'], ['Great Series'], 'ris BOOK T2 becomes series');
eq(b['container-title'], undefined, 'ris BOOK has no container');
eq(b.issued, { 'date-parts': [[1999]] }, 'ris Y1 fallback');
eq(risOut.records[4].type + '|' + risOut.records[4].title[0], 'posted-content|Preprint title', 'ris UNPB and T1');
eq(risOut.records[5]['container-title'], ['LNCS', 'Proc. of Things'], 'ris CONF series+container');
eq(risOut.records.slice(6).map(function (r) { return r.type; }), ['dataset', 'software', 'report', 'other', 'other', 'journal-article', 'proceedings-article'], 'ris other TY types');

// short container is kept when JO differs from T2
var rs = P.parseRIS('TY  - JOUR\nTI  - X\nT2  - Physical Review Letters\nJO  - Phys. Rev. Lett.\nER  -\n')[0];
eq(rs['short-container-title'], ['Phys. Rev. Lett.'], 'ris JO short container');
// no ER at end, no TY at start
eq(P.parseRIS('TI  - Lonely\nAU  - Smith, J.').length, 1, 'ris record without TY/ER');
eq(P.parseRIS('TY  - JOUR\nTI  - One\nTY  - JOUR\nTI  - Two\n').length, 2, 'ris TY without ER splits records');

/* ---------- EndNote tagged export ---------- */
var ENW = [
  '%0 Journal Article', '%A Kucsko, G.', '%A Maurer, P. C.', '%A Centers for Disease Control and Prevention,', '%T Nanometre-scale thermometry',
  'in a living cell', '%J Nature', '%V 500', '%N 7460', '%P 54-58', '%D 2013', '%8 August 1', '%I Nature Publishing Group', '%C London',
  '%@ 0028-0836', '%R 10.1038/nature12373', '%U https://doi.org/10.1038/nature12373', '%X Sensitive probing.', '%G eng', '%! Nanometre thermometry', '%K diamond', '',
  '%0 Book Section', '%A Wickham, Hadley', '%E Gentleman, Robert', '%E Hornik, Kurt', '%T Data Visualisation', '%B ggplot2', '%S Use R!', '%P 11-31', '%D 2016',
  '%8 2016-03-15', '%I Springer', '%C New York', '%@ 978-3-319-24277-4', '%7 2nd', '', '',
  '%0 Book', '%A Hastie, Trevor', '%T ESL', '%B Springer Series in Statistics', '%D 2009',
  '%0 Thesis', '%A Doe, Jane', '%T Thesis', '%9 Doctoral dissertation', '%I MIT', '%D 2015', '',
  '%0 Conference Proceedings', '%T Cp', '', '%0 Conference Paper', '%T Cp2', '', '%0 Unpublished Work', '%T U', '', '%0 Manuscript', '%T M', '',
  '%0 Dataset', '%T D', '', '%0 Computer Program', '%T S', '', '%0 Report', '%T R', '', '%0 Web Page', '%T W', '', '%0 Generic', '%T G', '',
  '%0 Electronic Article', '%T E', ''
].join('\n');
var enwOut = P.parse(ENW);
eq(enwOut.format, 'enw', 'enw detect');
eq(enwOut.records.length, 14, 'enw record count (blank-line and %0 separation)');
var e = enwOut.records[0];
eq(e.type, 'journal-article', 'enw type');
eq(e.title, ['Nanometre-scale thermometry in a living cell'], 'enw continuation');
eq(e.author[2], { name: 'Centers for Disease Control and Prevention' }, 'enw trailing comma organisation');
eq(e['container-title'], ['Nature'], 'enw %J');
eq(e.volume + '/' + e.issue + '/' + e.page, '500/7460/54-58', 'enw %V %N %P');
eq(e.issued, { 'date-parts': [[2013, 8, 1]] }, 'enw %D + %8 "August 1"');
eq(e.ISSN, ['0028-0836'], 'enw %@ issn');
eq(e.DOI, '10.1038/nature12373', 'enw %R');
eq(e['short-title'], ['Nanometre thermometry'], 'enw %! short title');
eq(e.language + '|' + e.abstract, 'eng|Sensitive probing.', 'enw %G %X');
eq(e.raw.K, ['diamond'], 'enw raw keeps %K');
var ch = enwOut.records[1];
eq(ch.type, 'book-chapter', 'enw Book Section');
eq(ch['container-title'], ['Use R!', 'ggplot2'], 'enw %B/%S ordering');
eq(ch.editor, [{ family: 'Gentleman', given: 'Robert' }, { family: 'Hornik', given: 'Kurt' }], 'enw %E');
eq(ch.issued, { 'date-parts': [[2016, 3, 15]] }, 'enw %8 ISO date');
eq(ch.ISBN, ['978-3-319-24277-4'], 'enw %@ isbn');
eq(ch.edition + '|' + ch.publisher + '|' + ch['publisher-location'], '2nd|Springer|New York', 'enw %7 %I %C');
var bk = enwOut.records[2];
eq(bk.type, 'book', 'enw Book');
eq(bk['collection-title'], ['Springer Series in Statistics'], 'enw Book %B is series');
var th = enwOut.records[3];
eq(th.type + '|' + th.genre + '|' + th.publisher, 'dissertation|Doctoral dissertation|MIT', 'enw Thesis %9');
eq(enwOut.records.slice(4).map(function (r) { return r.type; }),
  ['proceedings-article', 'proceedings-article', 'posted-content', 'posted-content', 'dataset', 'software', 'report', 'other', 'other', 'journal-article'], 'enw other types');

/* ---------- LaTeX de-escaping ---------- */
var L = [
  ["Caf{\\'e} \\'e {\\\"o} \\^a \\`a \\~n \\c{c} \\c c \\v{s} \\H{o} \\u{a} \\r{a} \\k{a} \\.{z} \\={a} \\'{\\i}", 'Café é ö â à ñ ç ç š ő ă å ą ż ā í'],
  ['\\ss{} {\\ae} \\AE{} \\oe{} \\o{} \\O{} \\aa{} \\AA{} \\l{} \\L{} Bj\\o rn Stra\\ss e', 'ß æ Æ œ ø Ø å Å ł Ł Bjørn Straße'],
  ['pages 1--10 and 1---10', 'pages 1–10 and 1—10'],
  ['A \\& B, 100\\%, a\\_b, \\#1, \\$5, \\{x\\}', 'A & B, 100%, a_b, #1, $5, {x}'],
  ['back\\textbackslash{}slash \\textasciitilde{}x \\textasciicircum{}y', 'back\\slash ~x ^y'],
  ['{NASA} and the {ISS}', 'NASA and the ISS'],
  ['J.~P. Smith', 'J. P. Smith'],
  ['\\emph{On} \\textit{Growth} \\textbf{Bold}', 'On Growth Bold'],
  ['``Quoted\'\' \\ldots done', '“Quoted” … done'],
  ['{{Double}} braces', 'Double braces'],
  ['Zotero: {\\"O}zt{\\"u}rk and Gr{\\"u}n', 'Zotero: Öztürk and Grün'],
  ['\\relax Weird \\unknowncmd{arg}', 'Weird arg']
];
L.forEach(function (pair) { eq(P.deLatex(pair[0]), pair[1], 'deLatex ' + JSON.stringify(pair[0])); });

/* ---------- BibTeX names ---------- */
eq(P.parseBibName('King, Jr., Martin Luther'), { family: 'King', suffix: 'Jr.', given: 'Martin Luther' }, 'bib name Family, Suffix, Given');
eq(P.parseBibName('King, Martin Luther, Jr.'), { family: 'King', given: 'Martin Luther', suffix: 'Jr.' }, 'bib name Family, Given, Suffix');
eq(P.parseBibName('Martin Luther King'), { family: 'King', given: 'Martin Luther' }, 'bib name Given Family');
eq(P.parseBibName('Ludwig van Beethoven'), { family: 'van Beethoven', given: 'Ludwig' }, 'bib name particle');
eq(P.parseBibName('{World Health Organization}'), { name: 'World Health Organization' }, 'bib braced organisation');
eq(P.parseBibName("{\\'E}mile Zola"), { family: 'Zola', given: 'Émile' }, 'bib accented natural');
eq(P.parseBibName('others'), null, 'bib "others" dropped');
eq(P.parseTaggedName('Smith, John, Jr.'), { family: 'Smith', given: 'John', suffix: 'Jr.' }, 'tagged three-part');
eq(P.parseTaggedName('WHO,'), { name: 'WHO' }, 'tagged trailing comma');

/* ---------- dates ---------- */
eq(P.parseDate('2019/03/15/'), { y: 2019, m: 3, d: 15 }, 'date ris full');
eq(P.parseDate('2019///'), { y: 2019, m: 0, d: 0 }, 'date ris year only');
eq(P.parseDate('2019/03'), { y: 2019, m: 3, d: 0 }, 'date year/month');
eq(P.parseDate('March 15'), { y: 0, m: 3, d: 15 }, 'date enw month day');
eq(P.parseDate('15 Mar 2019'), { y: 2019, m: 3, d: 15 }, 'date day month year');
eq(P.parseDate('Sept 2019'), { y: 2019, m: 9, d: 0 }, 'date Sept');

/* ---------- Zotero-style BibTeX export ---------- */
var BIB = [
  '@comment{Exported from Zotero}',
  '@string{prl = "Physical Review Letters"}',
  '@STRING{ apsloc = {Ridge, NY} }',
  '',
  '@article{kucsko_nanometre-scale_2013,',
  '  title = {Nanometre-scale thermometry in a living cell},',
  '  volume = {500},',
  '  issn = {0028-0836, 1476-4687},',
  '  url = {https://www.nature.com/articles/nature12373},',
  '  doi = {10.1038/nature12373},',
  '  number = {7460},',
  '  journal = {Nature},',
  '  shortjournal = {Nature},',
  "  author = {Kucsko, G. and Maurer, P. C. and Kubo, Y. and {\\\"O}zt{\\\"u}rk, Ali and others},",
  '  month = aug,',
  '  year = {2013},',
  '  pages = {54--58},',
  '  keywords = {diamond, thermometry},',
  '}',
  '',
  '@incollection{wickham_data_2016,',
  "  address = {New York, NY},",
  '  series = {Use {R}!},',
  '  title = {{Data} Visualisation: {A} Grammar},',
  '  isbn = {978-3-319-24277-4},',
  '  booktitle = {ggplot2: {Elegant} Graphics for Data Analysis},',
  '  publisher = {Springer},',
  "  author = {Wickham, Hadley and Gr{\\\"u}n, Bettina and Zola, {\\'{E}}mile},",
  '  editor = {Gentleman, Robert and Hornik, Kurt},',
  '  year = 2016,',
  '  pages = {11-31},',
  '  edition = {2},',
  '  doi = {10.1007/978-3-319-24277-4\\_2}',
  '}',
  '',
  '@article{concat, title = "Title with " # prl # " inside", journal = prl, address = apsloc, year = "1999", month = {March}, pages = {e0248152}}',
  '@inproceedings{p1, title={Conf}, booktitle={Proc. CHI}, series={LNCS}, author={King, Jr., Martin Luther and {IEEE Computer Society}}, year={2019}, month=3}',
  '@phdthesis{t1, title={Thesis}, author={Doe, Jane}, school={MIT}, address={Cambridge, MA}, year={2015}, type={PhD dissertation}}',
  '@mastersthesis{t2, title={MSc}, author={Roe, R.}, school={ETH}, year={2016}}',
  '@techreport{r1, title={Report}, institution={World Bank}, number={42}, year={2020}}',
  '@misc{arx, title={Preprint}, author={Ng, Andrew}, eprinttype={arxiv}, eprint={2301.01234v2}, year={2023}}',
  '@misc{arx2, title={Preprint two}, archivePrefix = {arXiv}, eprint = {1706.03762}, primaryClass={cs.CL}, year={2017}}',
  '@unpublished{u1, title={Unpub}, note={Preprint}, howpublished={bioRxiv}, year={2020}}',
  '@online{o1, title={Web}, url={https://example.org/a\\_b?x=1\\&y=2}, urldate={2024-01-02}}',
  '@software{s1, title={Tool}, version={1.0}, year={2022}}',
  '@dataset{d1, title={Data}, publisher={Zenodo}, doi={https://doi.org/10.5281/zenodo.123}, date={2021-06-30}}',
  '@Book(paren, title = "Paren Book", author = "Smith, John", publisher = "Pub", location = {Berlin}, journaltitle = {}, year = 2001)',
  '@misc{nokey_test, howpublished = {\\url{https://example.com/page}}, title = {How}}',
  '@article{, title={No key}, author={A. B. Cee and Dee, E.}, journaltitle={J. Test}, date={2019-03}, pagetotal={10}, language={english}}'
].join('\n');
var bibOut = P.parse(BIB);
eq(bibOut.format, 'bibtex', 'bib detect');
eq(bibOut.records.length, 16, 'bib record count (comment and @string skipped)');
var k = bibOut.records[0];
eq(k.type, 'journal-article', 'bib @article');
eq(k.title, ['Nanometre-scale thermometry in a living cell'], 'bib title');
eq(k.author, [{ family: 'Kucsko', given: 'G.' }, { family: 'Maurer', given: 'P. C.' }, { family: 'Kubo', given: 'Y.' }, { family: 'Öztürk', given: 'Ali' }], 'bib authors with {\\"o} and others dropped');
eq(k['container-title'], ['Nature'], 'bib journal');
eq(k['short-container-title'], ['Nature'], 'bib shortjournal');
eq(k.volume + '/' + k.issue + '/' + k.page, '500/7460/54-58', 'bib volume/number/pages --');
eq(k.issued, { 'date-parts': [[2013, 8]] }, 'bib month = aug macro');
eq(k.ISSN, ['0028-0836', '1476-4687'], 'bib multi issn');
eq(k.DOI + '|' + k.URL, '10.1038/nature12373|https://www.nature.com/articles/nature12373', 'bib doi/url');
eq(k.raw.key, 'kucsko_nanometre-scale_2013', 'bib raw key');
eq(k.raw.fields.keywords, 'diamond, thermometry', 'bib raw fields');
var w = bibOut.records[1];
eq(w.type, 'book-chapter', 'bib @incollection');
eq(w.title, ['Data Visualisation: A Grammar'], 'bib case-protection braces removed');
eq(w['container-title'], ['Use R!', 'ggplot2: Elegant Graphics for Data Analysis'], 'bib series + booktitle');
eq(w.author, [{ family: 'Wickham', given: 'Hadley' }, { family: 'Grün', given: 'Bettina' }, { family: 'Zola', given: 'Émile' }], "bib {\\'{E}} names");
eq(w.editor.length, 2, 'bib editors');
eq(w.issued, { 'date-parts': [[2016]] }, 'bib bare year');
eq(w.page + '|' + w.edition + '|' + w['publisher-location'] + '|' + w.ISBN[0], '11-31|2|New York, NY|978-3-319-24277-4', 'bib pages/edition/address/isbn');
eq(w.DOI, '10.1007/978-3-319-24277-4_2', 'bib doi with \\_');
var cc = bibOut.records[2];
eq(cc.title, ['Title with Physical Review Letters inside'], 'bib # concatenation with @string');
eq(cc['container-title'], ['Physical Review Letters'], 'bib journal macro');
eq(cc['publisher-location'], 'Ridge, NY', 'bib @STRING case-insensitive macro');
eq(cc.issued, { 'date-parts': [[1999, 3]] }, 'bib month = {March}');
eq(cc.page, 'e0248152', 'bib article-number page');
eq(A.normalize(cc).isArticleNumber, true, 'bib e-page normalizes as article number');
var pr = bibOut.records[3];
eq(pr.type, 'proceedings-article', 'bib @inproceedings');
eq(pr.author, [{ family: 'King', suffix: 'Jr.', given: 'Martin Luther' }, { name: 'IEEE Computer Society' }], 'bib Jr. and braced org');
eq(pr['container-title'], ['LNCS', 'Proc. CHI'], 'bib series/booktitle for proceedings');
eq(pr.issued, { 'date-parts': [[2019, 3]] }, 'bib month = 3');
var t1 = bibOut.records[4];
eq(t1.type + '|' + t1.genre + '|' + t1.publisher + '|' + t1['publisher-location'], 'dissertation|PhD dissertation|MIT|Cambridge, MA', 'bib @phdthesis school');
eq(bibOut.records[5].genre, "Master's thesis", 'bib @mastersthesis default genre');
var r1 = bibOut.records[6];
eq(r1.type + '|' + r1.publisher + '|' + r1.issue, 'report|World Bank|42', 'bib @techreport institution');
var ax = bibOut.records[7];
eq(ax.type, 'posted-content', 'bib arXiv eprinttype');
eq(ax.institution, [{ name: 'arXiv' }], 'bib arXiv institution');
eq(ax.DOI + '|' + ax.URL, '10.48550/arXiv.2301.01234|https://arxiv.org/abs/2301.01234v2', 'bib arXiv DOI/URL');
eq(bibOut.records[8].type + '|' + bibOut.records[8].institution[0].name, 'posted-content|arXiv', 'bib archivePrefix');
var u1 = bibOut.records[9];
eq(u1.type + '|' + u1['container-title'][0], 'posted-content|bioRxiv', 'bib @unpublished howpublished container');
eq(bibOut.records[10].URL, 'https://example.org/a_b?x=1&y=2', 'bib url unescaped, ~ preserved');
eq(bibOut.records[10].type, 'other', 'bib @online');
eq(bibOut.records[11].type, 'software', 'bib @software');
var d1 = bibOut.records[12];
eq(d1.type + '|' + d1.DOI, 'dataset|10.5281/zenodo.123', 'bib @dataset doi from URL form');
eq(d1.issued, { 'date-parts': [[2021, 6, 30]] }, 'bib biblatex date');
var pb = bibOut.records[13];
eq(pb.type + '|' + pb.title[0] + '|' + pb.author[0].family + '|' + pb['publisher-location'], 'book|Paren Book|Smith|Berlin', 'bib parenthesised entry, quoted values, location');
eq(pb['container-title'], undefined, 'bib empty journaltitle ignored');
eq(bibOut.records[14].URL, 'https://example.com/page', 'bib howpublished \\url');
var nk = bibOut.records[15];
eq(nk.raw.key, '', 'bib empty key');
eq(nk.author, [{ family: 'Cee', given: 'A. B.' }, { family: 'Dee', given: 'E.' }], 'bib Given Family + Family, Given');
eq(nk['container-title'] + '|' + nk.language + '|' + nk['number-of-pages'], 'J. Test|english|10', 'bib journaltitle/language/pagetotal');
eq(nk.issued, { 'date-parts': [[2019, 3]] }, 'bib date year-month');

// a normalized BibTeX chapter reproduces container/series for the formatter
var wn = A.normalize(w);
eq(wn.container + '|' + wn.series + '|' + wn.authors[1].family, 'ggplot2: Elegant Graphics for Data Analysis|Use R!|Grün', 'bib chapter normalizes');
ok(/Grün, B\./.test(A.format(wn, 'apa')), 'bib -> APA keeps umlaut');

/* ---------- summary ---------- */
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
