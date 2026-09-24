// A database or platform name carried by an imported file (RIS DP/DB, EndNote %W), with its accession number
// (AN, %M): read, kept, printed where the style guides print it, and written back on export.
var ROOT = require('path').resolve(__dirname, '..');
var A = require(require('path').join(ROOT, 'citations.js')), P = require(require('path').join(ROOT, 'parsers.js'));
var pass = 0, fail = 0;
var eq = function (label, got, want) { if (got === want) pass++; else { fail++; console.log('FAIL', label, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); } };
var ok = function (label, cond, detail) { if (cond) pass++; else { fail++; console.log('FAIL', label, detail || ''); } };

var ris = 'TY  - JOUR\nAU  - Goldman, Anne\nTI  - Questions of Transport: Reading Primo Levi Reading Dante\nT2  - The Georgia Review\nVL  - 64\nIS  - 1\nSP  - 69\nEP  - 88\nPY  - 2010\nUR  - www.jstor.org/stable/41403188\nDP  - JSTOR\nAN  - 41403188\nER  - \n';
var r = A.normalize(P.parseRIS(ris)[0]);
eq('RIS DP -> database', r.database, 'JSTOR');
eq('RIS AN -> accession', r.accession, '41403188');
eq('RIS DB when there is no DP', A.normalize(P.parseRIS('TY  - JOUR\nTI  - T\nDB  - Academic Search Complete\nER  - \n')[0]).database, 'Academic Search Complete');
eq('RIS DP wins over DB', A.normalize(P.parseRIS('TY  - JOUR\nTI  - T\nDB  - Academic Search Complete\nDP  - EBSCOhost\nER  - \n')[0]).database, 'EBSCOhost');
var enw = A.normalize(P.parseENW('%0 Journal Article\n%A Hebert, B. T.\n%T The Island of Bolsö\n%J Sociological Review\n%V 17\n%N 4\n%P 307-313\n%D 1925\n%W EBSCOhost\n%M 12345\n')[0]);
eq('EndNote %W -> database', enw.database, 'EBSCOhost');
eq('EndNote %M -> accession', enw.accession, '12345');
eq('Crossref records have no database', A.normalize({ type: 'journal-article', title: ['T'], issued: { 'date-parts': [[2020]] } }).database, '');

// MLA: second container with the location (MLA Style Center example)
eq('MLA second container with URL', A.format(r, 'mla'), 'Goldman, Anne. “Questions of Transport: Reading Primo Levi Reading Dante.” The Georgia Review, vol. 64, no. 1, 2010, pp. 69–88. JSTOR, www.jstor.org/stable/41403188.');
var noUrl = JSON.parse(JSON.stringify(r)); noUrl.url = '';
eq('MLA second container without a location', A.format(noUrl, 'mla'), 'Goldman, Anne. “Questions of Transport: Reading Primo Levi Reading Dante.” The Georgia Review, vol. 64, no. 1, 2010, pp. 69–88. JSTOR.');
// Chicago: the database stands in for a URL; a DOI still wins (CMOS examples)
var ch = A.normalize(P.parseRIS('TY  - JOUR\nAU  - LaSalle, Peter\nTI  - Conundrum: A Story about Reading\nT2  - New England Review\nVL  - 38\nIS  - 1\nSP  - 95\nEP  - 109\nPY  - 2017\nUR  - https://muse.jhu.edu/article/650000\nDP  - Project MUSE\nER  - \n')[0]);
eq('Chicago database in place of the URL', A.format(ch, 'chicago'), 'LaSalle, Peter. “Conundrum: A Story about Reading.” New England Review 38, no. 1 (2017): 95–109. Project MUSE.');
var chDoi = JSON.parse(JSON.stringify(ch)); chDoi.doi = '10.1000/x'; chDoi.url = 'https://doi.org/10.1000/x';
eq('Chicago DOI wins over the database', A.format(chDoi, 'chicago'), 'LaSalle, Peter. “Conundrum: A Story about Reading.” New England Review 38, no. 1 (2017): 95–109. https://doi.org/10.1000/x.');
var th = A.normalize(P.parseRIS('TY  - THES\nAU  - Blajer de la Garza, Yuna\nTI  - A House Is Not a Home: Citizenship and Belonging in Contemporary Democracies\nPB  - University of Chicago\nPY  - 2019\nM3  - Ph.D.\nDP  - ProQuest\nAN  - 13865986\nER  - \n')[0]);
eq('Chicago dissertation with database and accession', A.format(th, 'chicago'), 'Blajer de la Garza, Yuna. “A House Is Not a Home: Citizenship and Belonging in Contemporary Democracies.” PhD diss., University of Chicago, 2019. ProQuest (13865986).');
eq('APA dissertation archive falls back to the database', A.format(th, 'apa'), 'Blajer de la Garza, Y. (2019). A House Is Not a Home: Citizenship and Belonging in Contemporary Democracies [Doctoral dissertation, University of Chicago]. ProQuest.');
// styles that do not print it are unchanged
['apa', 'harvard', 'vancouver', 'ieee', 'carnegie'].forEach(function (st) { ok(st + ' does not print the database', A.format(r, st).indexOf('JSTOR') === -1, A.format(r, st)); });
// exports keep it; a round trip returns it
var risOut = A.format(r, 'ris'), enwOut = A.format(r, 'endnote');
ok('RIS export writes DP and AN', /^DP  - JSTOR\r?$/m.test(risOut) && /^AN  - 41403188\r?$/m.test(risOut), risOut);
ok('RIS export writes DP once', (risOut.match(/^DP  - /gm) || []).length === 1 && (risOut.match(/^AN  - /gm) || []).length === 1, risOut);
ok('EndNote export writes %W and %M', /^%W JSTOR$/m.test(enwOut) && /^%M 41403188$/m.test(enwOut), enwOut);
eq('round trip through RIS', A.normalize(P.parseRIS(risOut)[0]).database, 'JSTOR');
eq('round trip through EndNote', A.normalize(P.parseENW(enwOut)[0]).accession, '41403188');
ok('BibTeX export is unaffected', A.format(r, 'bibtex').indexOf('JSTOR') === -1);
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
