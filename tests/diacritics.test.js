// Diacritics between a pasted reference and its matched record, both ways: the row marks a name typed without them with
// the record's spelling, and a record that lacks them borrows them from the text. The helpers live in index.html.
var fs = require('fs'), path = require('path');
var ROOT = path.resolve(__dirname, '..');
var A = require(path.join(ROOT, 'citations.js'));
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var a = html.indexOf('    var DIFF_SKIP = '), b = html.indexOf('    function setRow(row, rec, level, via, src) {');
// a minimal DOM for markDifferences
function fakeEl() { var el = { textContent: '', children: [], appendChild: function (c) { el.children.push(c); return c; } }; return el; }
var doc = { createTextNode: function (t) { return { text: t }; }, createElement: function (tag) { return { tag: tag, textContent: '', title: '', className: '' }; } };
var H = new Function('A', 'document', html.slice(a, b) + '; return { adoptDiacritics: adoptDiacritics, markDifferences: markDifferences, hasAccent: hasAccent, stripAccents: stripAccents };')(A, doc);
var pass = 0, fail = 0;
function ok(label, cond, detail) { if (cond) pass++; else { fail++; console.log('FAIL ' + label + (detail ? '\n     ' + detail : '')); } }
var rec = A.normalize({ type: 'journal-article', title: ['Modraite, a new vesuvianite-group mineral from the Modra skarn, Malé Karpaty Mountains, Slovakia'], author: [{ family: 'Uher', given: 'Pavel' }, { family: 'Bačík', given: 'Peter' }, { family: 'Skřápková', given: 'Lenka' }, { family: 'Škoda', given: 'Radek' }, { family: 'Vaculovič', given: 'Tomáš' }], 'container-title': ['American Mineralogist'], issued: { 'date-parts': [[2026]] } });
// direction 1: the text lacks the diacritics, the record has them
var raw1 = 'Uher, P., Bacik, P., Skrapkova, L., Skoda, R., Vaculovic, T., 2026. Modraite, a new vesuvianite-group mineral from the Modra skarn, Male Karpaty Mountains, Slovakia. American Mineralogist.';
var el1 = fakeEl(); H.markDifferences(el1, raw1, rec);
var marks1 = el1.children.filter(function (c) { return c.tag === 'mark'; });
ok('names typed without diacritics are marked with the record\'s spelling', marks1.length >= 4 && marks1.every(function (m) { return m.className === 'accent'; }), JSON.stringify(marks1.map(function (m) { return m.textContent + ':' + m.title; })));
ok('Bacik -> Bačík', marks1.some(function (m) { return m.textContent === 'Bacik' && /Bačík/.test(m.title); }));
ok('Skrapkova -> Skřápková', marks1.some(function (m) { return m.textContent === 'Skrapkova' && /Skřápková/.test(m.title); }));
ok('Male -> Malé (a title word too)', marks1.some(function (m) { return m.textContent === 'Male' && /Malé/.test(m.title); }));
ok('nothing else is marked', marks1.every(function (m) { return /^(Bacik|Skrapkova|Skoda|Vaculovic|Male|Tomas)$/.test(m.textContent); }), JSON.stringify(marks1.map(function (m) { return m.textContent; })));
ok('the record is unchanged by direction 1', rec.authors[1].family === 'Bačík' && rec.authors[3].family === 'Škoda');
// direction 2: the text has the diacritics, the record lacks them
var flat = A.normalize({ type: 'journal-article', title: ['Modraite, a new mineral'], author: [{ family: 'Uher', given: 'Pavel' }, { family: 'Bacik', given: 'Peter' }, { family: 'Skrapkova', given: 'Lenka' }, { family: 'SKODA', given: 'Radek' }, { family: 'Vaculovic', given: 'Tomas' }], issued: { 'date-parts': [[2026]] } });
var raw2 = 'Uher, P., Bačík, P., Skřápková, L., Škoda, R., Vaculovič, T., 2026. Modraite, a new mineral. American Mineralogist.';
flat.authors[3].family = 'SKODA'; // normalize() title-cases a deposited all-caps name; the caps branch is tested on the raw form
var n = H.adoptDiacritics(flat, raw2);
ok('the record borrows the diacritics the text carries', flat.authors[1].family === 'Bačík' && flat.authors[2].family === 'Skřápková' && flat.authors[4].family === 'Vaculovič', JSON.stringify(flat.authors.map(function (p) { return p.family; })));
ok('the record\'s casing pattern is kept', flat.authors[3].family === 'ŠKODA', flat.authors[3].family);
ok('a name the text does not mention is untouched', flat.authors[0].family === 'Uher' && flat.authors[0].given === 'Pavel');
ok('given names without a match in the text stay', flat.authors[4].given === 'Tomas');
ok('the count reports the changes', n === 4, n);
ok('formatted output carries the borrowed diacritics', /Bačík, P\./.test(A.format(flat, 'apa')) && /Škoda/i.test(A.format(flat, 'apa')), A.format(flat, 'apa'));
var el2 = fakeEl(); H.markDifferences(el2, raw2, flat);
ok('after borrowing, no accent marks remain on the row', !el2.children.some(function (c) { return c.tag === 'mark' && c.className === 'accent'; }), JSON.stringify(el2.children.filter(function (c) { return c.tag === 'mark'; }).map(function (m) { return m.textContent; })));
// guards
var other = A.normalize({ type: 'journal-article', title: ['T'], author: [{ family: 'Novak', given: 'Jan' }], issued: { 'date-parts': [[2020]] } });
ok('a different name with accents is not borrowed', H.adoptDiacritics(other, 'Nováková, J. (2020) T.') === 0 && other.authors[0].family === 'Novak');
ok('ß, ł, đ and ø count as accents', H.hasAccent('Straße') && H.hasAccent('Łódź') && H.hasAccent('Đorđević') && H.hasAccent('Sørensen') && !H.hasAccent('Smith'));
// journal abbreviations and PDF line-break hyphens are not differences
var el3 = fakeEl(); H.markDifferences(el3, 'Uher P, Bacik P. Modraite, a new vesuvianite-group mineral from the Modra skarn. Am. Mineral. 2026.', rec);
var m3 = el3.children.filter(function (c) { return c.tag === 'mark'; }).map(function (m) { return m.className + ':' + m.textContent; });
ok('an abbreviated journal is not marked', m3.indexOf('Mineral') === -1 && !m3.some(function (x) { return /:Mineral$/.test(x); }), JSON.stringify(m3));
ok('the diacritic mark still shows beside the abbreviation', m3.indexOf('accent:Bacik') !== -1, JSON.stringify(m3));
var el4 = fakeEl(); H.markDifferences(el4, 'Uher, P., 2026. Modraite, a new vesuvianite-group min- eral from the Modra skarn, Malé Karpaty Moun- tains, Slovakia. American Mineralogist.', rec);
var m4 = el4.children.filter(function (c) { return c.tag === 'mark'; }).map(function (m) { return m.textContent; });
ok('a word broken by a line-break hyphen is not marked', m4.length === 0, JSON.stringify(m4));
var el5 = fakeEl(); H.markDifferences(el5, 'Uher, P., 2026. Modraite, a new mineral from the Modra skarn. Aerican Mineralogist.', rec);
var m5 = el5.children.filter(function (c) { return c.tag === 'mark'; }).map(function (m) { return m.textContent; });
ok('a real misspelling is still marked', m5.length === 1 && m5[0] === 'Aerican', JSON.stringify(m5));
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
