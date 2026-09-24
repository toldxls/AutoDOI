// Diacritics between a pasted reference and its matched record, both ways: the row marks a name typed without them with
// the record's spelling, and a record that lacks them borrows them from the text. The helpers live in index.html.
var fs = require('fs'), path = require('path');
var ROOT = path.resolve(__dirname, '..');
var A = require(path.join(ROOT, 'citations.js'));
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var a = html.indexOf('    var DIFF_SKIP = '), b = html.indexOf('    function setRow(row, rec, level, via, src) {');
var ma = html.indexOf('  // Text copied out of a PDF or an email sometimes arrives'), mb = html.indexOf('  // A paste from Word, Google Docs or a browser carries sub- and superscripts');
// a minimal DOM for markDifferences
function fakeEl() { var el = { textContent: '', children: [], appendChild: function (c) { el.children.push(c); return c; } }; return el; }
var doc = { createTextNode: function (t) { return { text: t }; }, createElement: function (tag) { return { tag: tag, textContent: '', title: '', className: '', attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; } }; } };
var H = new Function('A', 'document', 'el', 'button', 'yearConflict', 'build', html.slice(ma, mb) + '\n' + html.slice(a, b) + '; return { adoptDiacritics: adoptDiacritics, markDifferences: markDifferences, hasAccent: hasAccent, stripAccents: stripAccents, repairMojibake: repairMojibake };')(A, doc, null, null, null, null);
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
// initials: the first initial beside a matched surname must agree with the record's given name
function marksOf(raw, r) { var e = fakeEl(); H.markDifferences(e, raw, r); return e.children.filter(function (c) { return c.tag === 'mark'; }).map(function (m) { return (m.className || 'diff') + ':' + m.textContent + '|' + m.title; }); }
var mi = marksOf('Uher, R., Bačík, P., 2026. Modraite, a new vesuvianite-group mineral from the Modra skarn, Malé Karpaty Mountains, Slovakia. American Mineralogist.', rec);
ok('a wrong initial is marked with the record\'s given name', mi.length === 1 && /^diff:R\|.*Pavel/.test(mi[0]), JSON.stringify(mi));
ok('correct initials in every style are not marked', marksOf('Uher P, Bačík P. Modraite, a new vesuvianite-group mineral from the Modra skarn, Malé Karpaty Mountains, Slovakia. Am Mineral. 2026', rec).length === 0 && marksOf('P. Uher and P. Bačík (2026) Modraite, a new vesuvianite-group mineral from the Modra skarn, Malé Karpaty Mountains, Slovakia. American Mineralogist.', rec).length === 0, JSON.stringify(marksOf('P. Uher and P. Bačík (2026) Modraite, a new vesuvianite-group mineral from the Modra skarn, Malé Karpaty Mountains, Slovakia. American Mineralogist.', rec)));
ok('a wrong initial before the surname is marked too', marksOf('R. Uher (2026) Modraite, a new vesuvianite-group mineral from the Modra skarn, Malé Karpaty Mountains, Slovakia. American Mineralogist.', rec).some(function (x) { return /^diff:R\|/.test(x); }));
// a short surname (three letters) that the record lacks is marked; a correct one is not
var yao = A.normalize({ type: 'journal-article', title: ['Nanometre-scale thermometry in a living cell'], author: [{ family: 'Kucsko', given: 'G.' }, { family: 'Yao', given: 'N. Y.' }], 'container-title': ['Nature'], issued: { 'date-parts': [[2013]] }, volume: '500', page: '54-58' });
ok('a wrong short surname is marked', marksOf('Kucsko, G., Yeo, N. Y. (2013). Nanometre-scale thermometry in a living cell. Nature, 500, 54-58.', yao).some(function (x) { return /^diff:Yeo\|/.test(x); }), JSON.stringify(marksOf('Kucsko, G., Yeo, N. Y. (2013). Nanometre-scale thermometry in a living cell. Nature, 500, 54-58.', yao)));
ok('a correct short surname and an initial are not marked', marksOf('Kucsko, G., Yao, N. Y. (2013). Nanometre-scale thermometry in a living cell. Nature, 500, 54-58.', yao).length === 0, JSON.stringify(marksOf('Kucsko, G., Yao, N. Y. (2013). Nanometre-scale thermometry in a living cell. Nature, 500, 54-58.', yao)));
// wording: a year names both sides; anything else is neutral; every mark carries an aria-label
var my = marksOf('Kucsko, G., Yao, N. Y. (2014). Nanometre-scale thermometry in a living cell. Nature, 500, 54-58.', yao);
ok('a wrong year says what both sides say', my.length === 1 && /^diff:2014\|Your text says 2014; the record says 2013$/.test(my[0]), JSON.stringify(my));
var e6 = fakeEl(); H.markDifferences(e6, 'Kucsko, G. (2013). Nanometre-scale thermometery in a living cell. Nature, 500, 54-58.', yao);
var mk6 = e6.children.filter(function (c) { return c.tag === 'mark'; })[0];
ok('a near miss names the record\'s word and carries an aria-label', mk6 && /thermometry/.test(mk6.title) && mk6.attrs['aria-label'] === 'thermometery: ' + mk6.title, JSON.stringify(mk6));
// mojibake: UTF-8 read as Windows-1252 is turned back; real accented text is untouched
var CP = { 0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178 };
function garble(s) { return Array.from(Buffer.from(s, 'utf8')).map(function (b) { return String.fromCharCode(CP[b] || b); }).join(''); }
['Bačík, P., Škoda, R. – “quoted” Skřápková', 'Uher, P. (2026) Modraite – Malé Karpaty', 'São Paulo não é', 'Müller & Größe – Ångström'].forEach(function (s) { ok('mojibake repaired: ' + s.slice(0, 20), H.repairMojibake(garble(s)) === s, JSON.stringify(H.repairMojibake(garble(s)))); });
['Bačík and Škoda', 'São Paulo não é', 'Ångström Ã la carte', 'plain ascii text 2026', '日本語の参考文献'].forEach(function (s) { ok('left alone: ' + s.slice(0, 20), H.repairMojibake(s) === s, JSON.stringify(H.repairMojibake(s))); });
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
