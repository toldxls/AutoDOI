// Regression tests for the review fixes (tag stripping, DOI extraction, matching, export round trips, name and DOI hygiene).
var ROOT = require('path').resolve(__dirname, '..');
var A = require(require('path').join(ROOT, 'citations.js'));
var P = require(require('path').join(ROOT, 'parsers.js'));
var pass = 0, fail = 0;
function eq(label, got, exp) { if (got === exp) pass++; else { fail++; console.log('FAIL', label, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(exp)); } }
function J(extra) { return Object.assign({ type: 'journal-article', title: ['T'], author: [{ family: 'A', given: 'B' }], issued: { 'date-parts': [[2020]] }, 'container-title': ['J'] }, extra || {}); }
function lines(txt, re) { return txt.split(/\r?\n/).filter(function (l) { return re.test(l); }); }

// 1 cleanText strips real tags only
eq('1 less-than in text', A.normalize({ title: ['CD4 <200 cells/µL and viral load >1000 copies'] }).title, 'CD4 <200 cells/µL and viral load >1000 copies');
eq('1 x < y', A.normalize({ title: ['a < b and c > d'] }).title, 'a < b and c > d');
eq('1 real tags, comments, namespaced', A.normalize({ title: ['x <i>y</i> <!-- note --> <mml:math><mml:mi>a</mml:mi></mml:math> z<br/>w <a href="u">v</a>'] }).title, 'x y a zw v');
eq('1 sub kept, < kept', A.titleHtml(A.normalize(J({ title: ['Fe<sub>2</sub>O<sub>3</sub> at T <300 K'] }))), 'Fe<sub>2</sub>O<sub>3</sub> at T &lt;300 K');
eq('1 apa plain', A.format(J({ title: ['Fe<sub>2</sub>O<sub>3</sub> at T <300 K'] }), 'apa'), 'A, B. (2020). Fe₂O₃ at T <300 K. J.');
eq('1 stripTags keeps text <', A.stripTags('<i>J</i> &lt;300 K <200 cells'), 'J <300 K <200 cells');

// 2 extractDoi is linear on long runs of closing brackets
var t0 = Date.now(), long = A.extractDoi('10.1000/' + new Array(50001).join(')'));
eq('2 50k parens: nothing after prefix', long, null);
eq('2 50k parens < 50 ms', Date.now() - t0 < 50, true);
t0 = Date.now(); A.extractDoi('10.1000/abc' + new Array(50001).join('.'));
eq('2 50k dots < 50 ms', Date.now() - t0 < 50, true);
eq('2 one unbalanced paren', A.extractDoi('10.1000/abc))'), '10.1000/abc');

// 3 DOIs from URLs and sentence punctuation
var sici = '10.1002/(SICI)1097-0258(19980430)17:8<857::AID-SIM777>3.0.CO;2-E';
eq('3 query stripped', A.extractDoi('http://dx.doi.org/10.1000/abc?utm_source=x'), '10.1000/abc');
eq('3 fragment stripped', A.extractDoi('https://doi.org/10.1000/abc#section'), '10.1000/abc');
eq('3 percent-decoded', A.extractDoi('https://doi.org/10.1002/(SICI)1097-4636(199808)41:2%3C192::AID-JBM4%3E3.0.CO;2-K'), '10.1002/(SICI)1097-4636(199808)41:2<192::AID-JBM4>3.0.CO;2-K');
eq('3 bare SICI kept', A.extractDoi(sici), sici);
eq('3 SICI in sentence', A.extractDoi('(doi: ' + sici + ').'), sici);
eq('3 balanced parens kept', A.extractDoi('10.1016/S0016-7037(02)01188-X)'), '10.1016/S0016-7037(02)01188-X');
eq('3 open paren kept', A.extractDoi('10.1000/ab(c'), '10.1000/ab(c');
eq('3 curly double quotes', A.extractDoi('“10.1000/abc”'), '10.1000/abc');
eq('3 curly single quotes', A.extractDoi('‘10.1000/abc’'), '10.1000/abc');
eq('3 possessive', A.extractDoi('10.1000/abc’s'), '10.1000/abc');
eq('3 (see …abc.)', A.extractDoi('(see 10.1000/abc.)'), '10.1000/abc');
eq('3 .).', A.extractDoi('10.1000/abc.).'), '10.1000/abc');
eq('3 unbalanced >', A.extractDoi('10.1000/abc>.'), '10.1000/abc');
eq('3 closing tag', A.extractDoi('10.1000/abc</a>'), '10.1000/abc');
eq('3 br tag', A.extractDoi('10.1000/abc<br/>next'), '10.1000/abc');
eq('3 landing suffix with jsessionid', A.extractDoi('https://onlinelibrary.wiley.com/doi/10.1111/jbi.13456/abstract;jsessionid=ABC'), '10.1111/jbi.13456');
eq('3 plain query char not in URL kept', A.extractDoi('10.1000/abc?x'), '10.1000/abc?x');
eq('3 arxiv html', A.toDoi('https://arxiv.org/html/2301.00001v2'), A.toDoi('https://arxiv.org/abs/2301.00001v2'));
eq('3 arxiv html value', A.toDoi('https://arxiv.org/html/2301.00001v2'), '10.48550/arXiv.2301.00001');
eq('3 arxiv bare trailing period', A.toDoi('2301.00001.'), '10.48550/arXiv.2301.00001');

// 4 matchConfidence: diacritics, scripts, notice titles
function rec(t, fam, type) { return { title: [t], issued: { 'date-parts': [[2010]] }, author: [{ family: fam, given: 'A.' }], type: type || 'journal-article' }; }
var ref = 'Smith A. 2010. Nanometre-scale thermometry in a living cell. Nature 500:54.';
eq('4 diacritics folded', A.matchConfidence('García A. 2010. Schrödinger cats and Müller waves. Nature 1:1.', rec('Schrodinger cats and Muller waves', 'Garcia')), 1);
eq('4 diacritics folded other way', A.matchConfidence('Garcia A. 2010. Schrodinger cats. Nature 1:1.', rec('Schrödinger cats', 'García')), 1);
eq('4 unicode subscripts vs <sub>', A.matchConfidence('Smith A. 2010. Fe₂O₃ nanoparticles in cells. Nature 500:54.', rec('Fe<sub>2</sub>O<sub>3</sub> nanoparticles in cells', 'Smith')), 1);
eq('4 superscript ions', A.matchConfidence('Smith A. 2010. Fe³⁺ uptake in cells. Nature 500:54.', rec('Fe<sup>3+</sup> uptake in cells', 'Smith')), 1);
eq('4 original still 1', A.matchConfidence(ref, rec('Nanometre-scale thermometry in a living cell', 'Smith')), 1);
['Expression of concern: ', "Authors' reply to ", 'Author’s reply to ', 'Reply to ', 'Response to ', 'Supplementary material to ', 'Supplementary Information for ', 'Supplemental data: ', 'Retraction: ', 'Retracted: ', 'Comment on ', 'Commentary on ', 'Editorial: '].forEach(function (pre) {
  eq('4 notice ' + pre, A.matchConfidence(ref, rec(pre + 'Nanometre-scale thermometry in a living cell', 'Smith')) <= 0.5, true);
});
eq('4 notice word mid-title is not a notice', A.matchConfidence('Smith A. 2010. Immune response to thermometry in a living cell. Nature 500:54.', rec('Immune response to thermometry in a living cell', 'Smith')), 1);

// 5 exports round trip through parsers.js
var an = J({ volume: '5', 'article-number': '100140', DOI: '10.1000/x', issued: { 'date-parts': [[2024]] } });
var bibAn = A.format(an, 'bibtex');
eq('5a bibtex eid', lines(bibAn, /^  eid = /)[0], '  eid = {100140},');
eq('5a bibtex pages kept', lines(bibAn, /^  pages = /)[0], '  pages = {100140},');
eq('5a bibtex round trip is an article number', A.normalize(P.parse(bibAn).records[0]).isArticleNumber, true);
eq('5a apa after round trip', A.format(P.parse(bibAn).records[0], 'apa'), A.format(an, 'apa'));
eq('5a no eid for page range', /eid/.test(A.format(J({ page: '1-9' }), 'bibtex')), false);
var pre = { type: 'posted-content', title: ['T'], author: [{ family: 'A', given: 'B' }], issued: { 'date-parts': [[2020]] }, institution: [{ name: 'medRxiv' }], publisher: 'Cold Spring Harbor Laboratory', DOI: '10.1101/2020.1' };
eq('5b ris PB', lines(A.format(pre, 'ris'), /^PB/)[0], 'PB  - medRxiv');
eq('5b enw %I', lines(A.format(pre, 'endnote'), /^%I/)[0], '%I medRxiv');
eq('5b bibtex publisher', lines(A.format(pre, 'bibtex'), /^  publisher/)[0], '  publisher = {medRxiv},');
['ris', 'endnote', 'bibtex'].forEach(function (f) { eq('5b ' + f + ' apa after round trip', A.format(P.parse(A.format(pre, f)).records[0], 'apa'), A.format(pre, 'apa')); });
eq('5b journal publisher untouched', lines(A.format(J({ publisher: 'Wiley', institution: [{ name: 'Inst' }] }), 'ris'), /^PB/)[0], 'PB  - Wiley');
var ch = { type: 'book-chapter', title: ['C'], author: [{ family: 'A', given: 'B' }], issued: { 'date-parts': [[2015]] }, 'container-title': ['Book'], ISBN: ['9783319242750'], ISSN: ['1234-5678'], publisher: 'P', abstract: '<jats:p>Abs {x} 100%</jats:p>' };
eq('5c ris SN both', lines(A.format(ch, 'ris'), /^SN/).join('|'), 'SN  - 9783319242750|SN  - 1234-5678');
eq('5c enw %@ both', lines(A.format(ch, 'endnote'), /^%@/).join('|'), '%@ 9783319242750|%@ 1234-5678');
['ris', 'endnote', 'bibtex'].forEach(function (f) {
  var back = A.normalize(P.parse(A.format(ch, f)).records[0]);
  eq('5c ' + f + ' isbn back', back.isbn, '9783319242750');
  eq('5c ' + f + ' issn back', back.issn, '1234-5678');
});
eq('5c book isbn only', lines(A.format({ type: 'book', title: ['B'], ISBN: ['9783319242750'], issued: { 'date-parts': [[2015]] } }, 'ris'), /^SN/).join('|'), 'SN  - 9783319242750');
eq('5d bibtex abstract escaped', lines(A.format(ch, 'bibtex'), /^  abstract/)[0], '  abstract = {Abs \\{x\\} 100\\%}');
eq('5d bibtex abstract round trip', A.normalize(P.parse(A.format(ch, 'bibtex')).records[0]).abstract, 'Abs {x} 100%');
eq('5d no abstract line without one', /abstract/.test(A.format(J(), 'bibtex')), false);

// 6 normalize survives bad author / editor shapes
eq('6 author [null]', A.normalize({ title: ['T'], author: [null] }).authors.length, 0);
eq('6 author [null, person]', A.normalize({ title: ['T'], author: [null, { family: 'A', given: 'B' }, 'x', 3] }).authors.length, 1);
eq('6 author string', A.normalize({ title: ['T'], author: 'Smith' }).authors.length, 0);
eq('6 editor object', A.normalize({ title: ['T'], editor: {} }).editors.length, 0);
eq('6 editor number', A.normalize({ title: ['T'], editor: 7 }).editors.length, 0);

// 7 Harvard: no double space when the initials are empty
eq('7 harvard nickname only', A.format(J({ author: [{ family: 'Smith', given: '(Bob)' }] }), 'harvard'), 'Smith (2020) ‘T’, J.');
eq('7 harvard normal', A.format(J({ author: [{ family: 'Smith', given: 'John P.' }] }), 'harvard'), 'Smith, J.P. (2020) ‘T’, J.');

// 8 r.doi cleaned
eq('8 trailing period', A.normalize({ title: ['T'], DOI: '10.1000/abc.' }).doi, '10.1000/abc');
eq('8 trailing ;, and spaces', A.normalize({ title: ['T'], DOI: ' 10.1000/abc;, ' }).doi, '10.1000/abc');
eq('8 url from cleaned doi', A.normalize({ title: ['T'], DOI: '10.1000/abc.' }).url, 'https://doi.org/10.1000/abc');
eq('8 array', A.normalize({ title: ['T'], DOI: ['10.1000/x'] }).doi, '10.1000/x');
eq('8 blank', A.normalize({ title: ['T'], DOI: ' ' }).doi, '');
eq('8 blank url', A.normalize({ title: ['T'], DOI: ' ' }).url, '');
eq('8 object', A.normalize({ title: ['T'], DOI: {} }).doi, '');
eq('8 number', A.normalize({ title: ['T'], DOI: 5 }).doi, '');
eq('8 lower-case key', A.normalize({ title: ['T'], doi: '10.1000/y,' }).doi, '10.1000/y');

// 9 misc
eq('9 bibtex pages all dashes', lines(A.format(J({ page: '1–2–3' }), 'bibtex'), /^  pages/)[0], '  pages = {1--2--3},');
eq('9 enw pages all dashes', lines(A.format(J({ page: '1–2–3' }), 'endnote'), /^%P/)[0], '%P 1-2-3');
eq('9 initials skip &', A.format(J({ author: [{ family: 'OBrien', given: 'J & K' }] }), 'apa'), 'OBrien, J. K. (2020). T. J.');
eq('9 initials skip and', A.format(J({ author: [{ family: 'OBrien', given: 'John and Kate' }] }), 'apa'), 'OBrien, J. K. (2020). T. J.');
var andBib = A.format(J({ author: [{ family: 'Smith and Jones', given: 'C' }, { family: 'King', given: 'M' }] }), 'bibtex');
eq('9 bibtex family with and braced', lines(andBib, /^  author/)[0], '  author = {{Smith and Jones}, C and King, M},');
eq('9 bibtex family with and reparsed', P.parse(andBib).records[0].author.map(function (a) { return a.family; }).join('|'), 'Smith and Jones|King');
eq('9 openlibrary empty publish_year', A.fromOpenLibrary({ title: 'X', publish_year: [] }).issued['date-parts'][0].length, 0);
eq('9 openlibrary publish_year min', A.fromOpenLibrary({ title: 'X', publish_year: [2001, 1999] }).issued['date-parts'][0][0], 1999);
eq('9 openlibrary missing title', A.fromOpenLibrary({ publish_year: [] }).title[0], '');
eq('9 openlibrary no undefined', /undefined|Infinity/.test(A.format(A.fromOpenLibrary({ publish_year: [] }), 'apa')), false);
var sn = function (n) { return JSON.stringify(A.splitName(n)); };
eq('9 de la Cruz', sn('de la Cruz'), JSON.stringify({ family: 'de la Cruz', given: '' }));
eq('9 van Beethoven', sn('van Beethoven'), JSON.stringify({ family: 'van Beethoven', given: '' }));
eq('9 Ludwig van Beethoven', sn('Ludwig van Beethoven'), JSON.stringify({ family: 'van Beethoven', given: 'Ludwig' }));
eq('9 Juan De Cruz (capital particle is a given name)', sn('Juan De Cruz'), JSON.stringify({ family: 'Cruz', given: 'Juan De' }));

// 10 doiLink encodes only what breaks a URL
var siciRec = J({ DOI: sici, issued: { 'date-parts': [[2000]] } });
var siciLink = 'https://doi.org/10.1002/(SICI)1097-0258(19980430)17:8%3C857::AID-SIM777%3E3.0.CO;2-E';
eq('10 apa link', A.format(siciRec, 'apa'), 'A, B. (2000). T. J. ' + siciLink);
eq('10 apa html link', A.formatHtml(siciRec, 'apa'), 'A, B. (2000). T. <i>J</i>. ' + siciLink);
eq('10 harvard link', A.format(siciRec, 'harvard').slice(-siciLink.length - 1), siciLink + '.');
eq('10 special chars', A.format({ title: ['T'], type: 'journal-article', DOI: '10.1000/ab c%d#e?f%20x日[y]' }, 'apa'), 'T. (n.d.). https://doi.org/10.1000/ab%20c%25d%23e%3Ff%20x%E6%97%A5%5By%5D');
eq('10 plain doi untouched', A.format(J({ DOI: '10.1016/S0016-7037(02)01188-X' }), 'apa'), 'A, B. (2020). T. J. https://doi.org/10.1016/S0016-7037(02)01188-X');
var siciBib = A.format(siciRec, 'bibtex');
eq('10 bibtex doi raw', lines(siciBib, /^  doi/)[0], '  doi = {' + sici + '},');
eq('10 bibtex url encoded', lines(siciBib, /^  url/)[0], '  url = {' + siciLink + '}');
eq('10 ris UR encoded, DO raw', lines(A.format(siciRec, 'ris'), /^(UR|DO)/).join('|'), 'DO  - ' + sici + '|UR  - ' + siciLink);
eq('10 ieee bare doi raw', /doi: 10\.1002\/\(SICI\)1097-0258\(19980430\)17:8<857::AID-SIM777>3\.0\.CO;2-E\.$/.test(A.format(siciRec, 'ieee')), true);
['ris', 'bibtex', 'endnote'].forEach(function (f) { eq('10 ' + f + ' doi survives round trip', P.parse(A.format(siciRec, f)).records[0].DOI, sici); });

console.log(pass + ' passed, ' + fail + ' failed');
