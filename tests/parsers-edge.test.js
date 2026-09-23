var ROOT = require('path').resolve(__dirname, '..');
var FIX = require('path').join(__dirname, 'fixtures');
// Tests for the parsers.js fixes (items 1-14 of the bug list)
var P = require(require('path').join(ROOT, 'parsers.js'));
var C = require(require('path').join(ROOT, 'citations.js'));
var pass = 0, fail = 0, failures = [];
function eq(a, e, label) {
  var sa = JSON.stringify(a), se = JSON.stringify(e);
  if (sa === se) { pass++; return; }
  fail++; failures.push(label + '\n    expected: ' + se + '\n    actual:   ' + sa);
}
function titles(recs) { return recs.map(function (r) { return r.title ? r.title[0] : null; }); }
function one(text) { return P.parse(text).records[0]; }
function timed(fn) { var t = Date.now(); fn(); return Date.now() - t; }

/* 1. mixed pastes */
var mix = 'Smith J. 2020. Plain ref one. Nature 1:2.\n\n@article{a, title={Bib A}, year=2020}\nJones 2019. Plain two.\n\n' +
  'TY  - JOUR\nTI  - Ris B\nER  - \n\n%0 Journal Article\n%T Enw C\n\nDoe 2018. Plain three.';
var m = P.parseMixed(mix);
eq(titles(m.records), ['Bib A', 'Ris B', 'Enw C'], '1 mixed records');
eq(m.plain, ['Smith J. 2020. Plain ref one. Nature 1:2.', 'Jones 2019. Plain two.', 'Doe 2018. Plain three.'], '1 mixed plain');
eq(m.formats, ['bibtex', 'ris', 'enw'], '1 mixed formats');
eq(m.order, [{ kind: 'plain', index: 0 }, { kind: 'record', index: 0 }, { kind: 'plain', index: 1 }, { kind: 'record', index: 1 },
  { kind: 'record', index: 2 }, { kind: 'plain', index: 2 }], '1 mixed order');
var files = '\uFEFFTY  - JOUR\r\nTI  - R1\r\nER  - \r\n\uFEFFTY  - BOOK\r\nTI  - R2\r\nER  - \r\n' +
  '\uFEFF@article{x, title={B1}}\n@book{y, title={B2}}\n\uFEFF%0 Book\n%T E1\n\n%0 Journal Article\n%T E2\n';
m = P.parseMixed(files);
eq(titles(m.records), ['R1', 'R2', 'B1', 'B2', 'E1', 'E2'], '1 concatenated files with BOMs');
eq(m.plain, [], '1 concatenated files: no plain');
eq(P.parse(files).format, 'ris', '1 parse() format = first found');
eq(P.parse(files).records.length, 6, '1 parse() returns all records');
m = P.parseMixed('Just a reference. 2020.');
eq([m.records.length, m.plain, m.formats, m.order], [0, ['Just a reference. 2020.'], [], [{ kind: 'plain', index: 0 }]], '1 plain only');
m = P.parseMixed('@article{a,title={A}} @article{b,title={B}}');
eq(titles(m.records), ['A', 'B'], '1 two bib entries on one line');

/* strict detect */
eq(P.detect('Follow us:\n@nature (2020) Twitter\nSmith J. 2020. A paper.'), null, 'detect @nature (2020)');
eq(P.detect('%0 of patients responded (Smith 2020)\nJones 2019. Title.'), null, 'detect %0 of patients');
eq(P.detect('Tyler, K. 2019. Title. J 3:4.\nTY - something\n'), null, 'detect TY - prose');
eq(P.detect('Contact: j.smith@example.org (corresponding)\nDoe A. 2019.'), null, 'detect email');
eq(P.detect('In the text we write\n@article{key, ...} is BibTeX syntax.'), null, 'detect @article{key, ...} prose');
eq(P.parseMixed('Follow us:\n@nature (2020) Twitter').plain, ['Follow us:\n@nature (2020) Twitter'], 'undetected lines stay plain');
eq(P.detect('TY  - JOUR\nER  - '), 'ris', 'detect TY+ER (2 tags)');
eq(P.detect('@misc{k, note={x}, year={2020}}'), 'bibtex', 'detect 2 bib fields');

/* 2. BOM anywhere, indentation */
eq(titles(P.parse('TY  - JOUR\nTI  - A\uFEFFB\nER  - ').records), ['AB'], '2 BOM inside value');
eq(titles(P.parse('  TY  - JOUR\n  TI  - Indented\n  AU  - Smith, J.\n  ER  - \n').records), ['Indented'], '2 indented RIS');
eq(titles(P.parse('  %0 Journal Article\n  %T Indented ENW\n').records), ['Indented ENW'], '2 indented ENW');

/* 3. math / sub / sup */
eq(P.deLatex('CO$_2$'), 'CO2', '3 CO$_2$');
eq(P.deLatex('$\\alpha$-helix'), 'α-helix', '3 alpha');
eq(P.deLatex('$^{13}$C'), '13C', '3 ^{13}');
eq(P.deLatex('$\\Sigma^0$'), 'Σ0', '3 Sigma^0');
eq(P.deLatex('\\(\\beta_{12}\\) and 5\\% \\$10'), 'β12 and 5% $10', '3 \\( \\) and escaped $');
eq(P.deLatex('CO$_2$ \\& A<B', true), 'CO<sub>2</sub> &amp; A&lt;B', '3 html mode');
eq(P.deLatex('H\\textsubscript{2}O x\\textsuperscript{+}', true), 'H<sub>2</sub>O x<sup>+</sup>', '3 textsubscript html');
eq(P.deLatex('\\alpha \\beta \\gamma \\delta \\Delta \\epsilon \\varepsilon \\mu \\nu \\sigma \\Sigma \\lambda \\pi \\omega \\Omega \\theta \\phi \\chi \\rho \\tau \\eta \\kappa \\xi \\zeta \\psi'),
  'α β γ δ Δ ϵ ε μ ν σ Σ λ π ω Ω θ ϕ χ ρ τ η κ ξ ζ ψ', '3 Greek');
var tr = one('@article{k, title={CO$_2$ uptake of $^{13}$C \\& H\\textsubscript{2}O}, journal={J}, year=2020}');
eq(tr.title, ['CO<sub>2</sub> uptake of <sup>13</sup>C &amp; H<sub>2</sub>O'], '3 bib title emitted with <sub>/<sup>');
var trn = C.normalize(tr);
eq(trn.title, 'CO2 uptake of 13C & H2O', '3 normalize plain title');
eq(C.format(trn, 'apa').indexOf('CO₂ uptake of ¹³C & H₂O') === 0, true, '3 APA renders sub/sup');
eq(/CO<sub>2<\/sub> uptake of <sup>13<\/sup>C &amp; H<sub>2<\/sub>O/.test(C.formatHtml(trn, 'apa')), true, '3 formatHtml renders tags');
var back = C.normalize(one(C.format(trn, 'bibtex')));
eq([back.title, back.titleMarked === trn.titleMarked], ['CO2 uptake of 13C & H2O', true], '3 BibTeX export round trip keeps marks');
eq(one('@article{k, title={<scp>ggtree</scp>: an R package}, year=2017}').title, ['<scp>ggtree</scp>: an R package'], '3 existing HTML tags kept');
eq(one('@article{k, title={Plain \\& simple}, year=2017}').title, ['Plain & simple'], '3 plain title not escaped');

/* 4. and others */
var ao = one('@article{k, title={T}, author={Smith, J. and others}, editor={Doe, A. and others}, year=2020}');
eq([ao.author, ao['author-others'], ao['editor-others']], [[{ family: 'Smith', given: 'J.' }], true, true], '4 author-others flag');
eq(one('@article{k, title={T}, author={Smith, J.}, year=2020}')['author-others'], undefined, '4 no flag without others');

/* 5. SICI DOIs */
var sici = '10.1175/1520-0477(1996)077<0437:TNYRP>2.0.CO;2';
eq(one('TY  - JOUR\nTI  - T\nDO  - ' + sici + '\nER  - ').DOI, sici, '5 RIS DO SICI');
eq(one('@article{k, title={T}, doi={' + sici + '}}').DOI, sici, '5 BibTeX doi SICI');
eq(one('%0 Journal Article\n%T T\n%R ' + sici + '\n').DOI, sici, '5 ENW %R SICI');
eq(one('TY  - JOUR\nTI  - T\nUR  - http://dx.doi.org/' + sici + '\nER  - ').DOI, sici, '5 UR SICI');
eq(one('@article{k, title={T}, doi={10.1000/a\\_b--c\\%d}}').DOI, '10.1000/a_b--c%d', '5 bib doi keeps --, unescapes \\_ \\%');
eq(one('TY  - JOUR\nTI  - T\nUR  - <https://doi.org/10.1000/xyz>\nER  - ').DOI, '10.1000/xyz', '5 unbalanced > not part of DOI');

/* 6. ISBN vs ISSN */
eq(one('TY  - BOOK\nTI  - T\nSN  - 978-1-4020-6754-9\nER  - ').ISBN, ['978-1-4020-6754-9'], '6 ISBN-13 hyphenated');
var sn = one('TY  - BOOK\nTI  - T\nSN  - 1-4020-6754-X; 0-8218-1234-5\nER  - ');
eq([sn.ISBN, sn.ISSN], [['1-4020-6754-X', '0-8218-1234-5'], undefined], '6 ISBN-10 hyphenated not ISSN');
var ss = one('TY  - JOUR\nTI  - T\nSN  - 0028-0836 (Print) 1476-4687 (Electronic)\nER  - ');
eq([ss.ISSN, ss.ISBN], [['0028-0836', '1476-4687'], undefined], '6 ISSNs with qualifiers, whitespace split');
eq(one('%0 Book\n%T T\n%@ 9781402067549, 1234-567X\n').ISBN.concat(one('%0 Book\n%T T\n%@ 9781402067549, 1234-567X\n').ISSN), ['9781402067549', '1234-567X'], '6 mixed list');

/* 7. dates */
eq(P.parseDate('2019-13-45'), { y: 2019, m: 0, d: 0 }, '7 invalid month');
eq(P.parseDate('2019-02-30'), { y: 2019, m: 2, d: 0 }, '7 invalid day');
eq(P.parseDate('2019-21'), { y: 2019, m: 0, d: 0 }, '7 season 21');
eq(P.parseDate('2019-24'), { y: 2019, m: 0, d: 0 }, '7 season 24');
eq(one('@article{k, title={T}, date={2020-22}}').issued, { 'date-parts': [[2020]] }, '7 bib season dropped');
eq(one('@article{k, title={T}, year=2020, month=13, day=40}').issued, { 'date-parts': [[2020]] }, '7 bib month 13 dropped');

/* 8. performance */
var big = 'TY  - JOUR\nTI  - x\n' + 'Smith J. 2020. Some reference title here.\n'.repeat(40000);
var ms = timed(function () { P.parse(big); });
eq(ms < 1000, true, '8 1.6MB continuation parses < 1s (' + ms + 'ms)');
ms = timed(function () { P.parse('%0 Journal Article\n%T x\n' + 'continuation line of an abstract\n'.repeat(50000)); });
eq(ms < 1000, true, '8 ENW continuation < 1s (' + ms + 'ms)');
ms = timed(function () { P.parse('@article{a, author={x' + ' '.repeat(200000) + 'y}, title={T}}'); });
eq(ms < 500, true, '8 author with 200k spaces < 0.5s (' + ms + 'ms)');
eq(one('TY  - JOUR\nTI  - Nanometre-scale\n   thermometry\nER  - ').title, ['Nanometre-scale thermometry'], '8 continuation joined');

/* 9. crossref / xdata / set */
var cr = P.parse('@inproceedings{p, title={Paper}, author={A, B}, crossref={conf}}\n' +
  '@proceedings{conf, title={Proc of Conf}, year=2006, publisher={ACM}, editor={Ed, Itor}, address={NY}, series={LNCS}, volume={7}}').records;
eq([cr[0]['container-title'], cr[0].issued, cr[0].publisher, cr[0].editor, cr[0]['publisher-location'], cr[0].volume],
  [['LNCS', 'Proc of Conf'], { 'date-parts': [[2006]] }, 'ACM', [{ family: 'Ed', given: 'Itor' }], 'NY', '7'], '9 crossref inheritance (parent after child)');
eq(P.parse('@proceedings{conf, booktitle={BT}, title={Proc}, year=2001}\n@inproceedings{p, title={Paper}, crossref={CONF}, year=2002}').records[1]['container-title'], ['BT'], '9 parent booktitle, case-insensitive key, child year kept');
eq(P.parse('@inproceedings{p, title={Paper}, crossref={conf}, year=2002}\n@proceedings{conf, title={Proc}, year=2001}').records[0].issued, { 'date-parts': [[2002]] }, '9 child field wins');
var xs = P.parse('@set{s, entryset={a,b}}\n@xdata{x, publisher={P}, address={Q}}\n@book{a, title={A}, year=2020, xdata={x}}');
eq([titles(xs.records), xs.records[0].publisher, xs.records[0]['publisher-location']], [['A'], 'P', 'Q'], '9 @set skipped, @xdata merged');

/* 10. deLatex commands */
eq(P.deLatex("\\textquotesingle \\textquotedbl \\textasciigrave D\\textquotesingle{}Aspremont"), "' \" ` D'Aspremont", '10 quote commands');
eq(P.deLatex('\\href{http://x}{Link text}'), 'Link text', '10 href');
eq(P.deLatex('a\\~{}b c\\~ d'), 'a~b c~ d', '10 \\~{} and bare \\~ are tildes');
eq(P.deLatex('J.~P. Smith'), 'J. P. Smith', '10 bare ~ is a space');
eq(P.deLatex('\\noopsort{a}Zeta'), 'Zeta', '10 noopsort removed');
eq(P.deLatex('\\url{https://x.org/a%20b~c}'), 'https://x.org/a%20b~c', '10 url keeps ~ %');

/* 11. ENW blank lines */
var en = P.parse('%0 Journal Article\n%T Title\n%A Smith, J\n%X First para.\n\nSecond para.\n%D 2019\n%J Nature\n').records;
eq([en.length, en[0].abstract, en[0]['container-title']], [1, 'First para. Second para.', ['Nature']], '11 blank line inside %X');
en = P.parseMixed('%0 Journal Article\n%0 Book\n%T B\n%D 2002\n');
eq([titles(en.records), en.plain], [['B'], []], '11 empty %0 record ignored');

/* 12. RIS details */
var rn = one('TY  - JOUR\nTI  - T\nAU  - Smith JA\nAU  - J.A. Smith\nAU  - van der Berg K\nER  - ').author;
eq(rn, [{ family: 'Smith', given: 'J. A.' }, { family: 'Smith', given: 'J.A.' }, { family: 'van der Berg', given: 'K.' }], '12 Vancouver names');
eq(one('TY  - EJOUR\nTI  - T\nPY  - 2015\nDA  - 2020/03/05\nER  - ').issued, { 'date-parts': [[2015]] }, '12 DA other year ignored');
eq(one('TY  - JOUR\nTI  - T\nPY  - 2015\nDA  - 2015/03/05\nER  - ').issued, { 'date-parts': [[2015, 3, 5]] }, '12 DA same year adds month/day');
eq(one('TY  - CHAP\nTI  - Chapter\nBT  - The Book\nER  - ')['container-title'], ['The Book'], '12 BT for CHAP');
eq(one('TY  - CONF\nT1  - Paper\nBT  - Proc of X\nER  - ')['container-title'], ['Proc of X'], '12 BT for CONF');
eq(one('TY  - JOUR\nTI  - T\nSP  - 123-145\nEP  - 145\nER  - ').page, '123-145', '12 SP range + EP');
eq(one('TY  - JOUR\nTI  - T\nSP  - 123\nEP  - 145\nER  - ').page, '123-145', '12 SP + EP');
eq(one('TY  - JOUR\nTI  - T\nM1  - 7\nER  - ').issue, '7', '12 M1 as issue');
eq(one('TY  - JOUR\nTI  - T\nIS  - 3\nM1  - 7\nER  - ').issue, '3', '12 IS wins over M1');
eq(one('TY  - JOUR\nTI  - T\nM1  - Times cited: 5\nER  - ').issue, undefined, '12 long M1 ignored');

/* 13. BibTeX robustness */
var bc = P.parseMixed('% @article{fake, title={Fake}}\n@article{real, title={Real}, year=2020}');
eq([titles(bc.records), bc.plain], [['Real'], []], '13 %-comment line not imported, not plain');
eq(titles(P.parse('@article{a, title={A}, year=2020}\nContact: someone@example.org (preferred)\n@article{b, title={B}, year=2021}').records), ['A', 'B'], '13 email between entries');
eq(titles(P.parse('@article{a, title={A}, year=2020,\n\n@article{b, title={B}, year=2021}').records), ['A', 'B'], '13 missing closing brace');
eq(titles(P.parse('@article{a, title={Broken {T}, year=2020}\n@article{b, title={B}, year=2021}\n@article{c, title={C}}').records), ['Broken T, year=2020', 'B', 'C'], '13 unbalanced value stops at next entry');
eq(one('@article{k, title={First}, title={Second}, year=2001}').title, ['First'], '13 duplicate field first wins');
eq(P.parseBibName('Martin Luther King Jr.'), { family: 'King', given: 'Martin Luther', suffix: 'Jr.' }, '13 natural-order Jr.');
eq(P.parseBibName('Martin Luther King, Jr.'), { family: 'King', given: 'Martin Luther', suffix: 'Jr.' }, '13 "Given Family, Jr."');
eq(one('@online{o, title={W}, url={http://x}, urldate={2024-01-02}}').accessed, { 'date-parts': [[2024, 1, 2]] }, '13 urldate -> accessed');

/* 14. decodeBytes */
var ris = 'TY  - JOUR\r\nTI  - Héllo\r\nER  - \r\n';
var le = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(ris, 'utf16le')]);
var be = Buffer.from(ris, 'utf16le'); be.swap16(); be = Buffer.concat([Buffer.from([0xFE, 0xFF]), be]);
var ab = function (b) { return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
eq(P.decodeBytes(ab(le)), ris, '14 UTF-16LE BOM');
eq(P.decodeBytes(ab(be)), ris, '14 UTF-16BE BOM');
eq(P.decodeBytes(ab(Buffer.from(ris, 'utf16le'))), ris, '14 UTF-16LE no BOM (NUL heuristic)');
eq(P.decodeBytes(ab(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(ris, 'utf8')]))), ris, '14 UTF-8 BOM');
eq(P.decodeBytes(new Uint8Array(Buffer.from(ris, 'utf8'))), ris, '14 UTF-8 Uint8Array');
eq(P.decodeBytes(ab(Buffer.from([0x48, 0xE9, 0x6C]))), 'Hél', '14 invalid UTF-8 -> Windows-1252');
eq(one(P.decodeBytes(ab(le))).title, ['Héllo'], '14 decoded UTF-16 parses');

/* untitled flag */
var ut = P.parse('TY  - JOUR\nAU  - Smith, J.\nPY  - 2020\nER  - ').records[0];
eq([ut.untitled, one('TY  - JOUR\nTI  - T\nER  - ').untitled], [true, undefined], 'untitled flag');

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
