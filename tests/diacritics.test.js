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
// adversarial review: styles that put initials first or write full given names, months, abbreviations, access dates, links
var kuc = A.normalize({ type: 'journal-article', DOI: '10.1038/nature12373', title: ['Nanometre-scale thermometry in a living cell'], author: [{ family: 'Kucsko', given: 'G.' }, { family: 'Maurer', given: 'P. C.' }, { family: 'Yao', given: 'N. Y.' }, { family: 'Kubo', given: 'M.' }, { family: 'Noh', given: 'H. J.' }, { family: 'Lo', given: 'P. K.' }, { family: 'Park', given: 'H.' }, { family: 'Lukin', given: 'M. D.' }], 'container-title': ['Nature'], issued: { 'date-parts': [[2013, 8, 1]] }, volume: '500', issue: '7460', page: '54-58' });
var kucFull = A.normalize({ type: 'journal-article', title: ['Nanometre-scale thermometry in a living cell'], author: [{ family: 'Kucsko', given: 'Georg' }, { family: 'Maurer', given: 'Peter C.' }, { family: 'Yao', given: 'Norman Y.' }, { family: 'Kubo', given: 'Mikhail' }, { family: 'Noh', given: 'Hyun J.' }, { family: 'Lo', given: 'Po K.' }, { family: 'Park', given: 'Hongkun' }, { family: 'Lukin', given: 'Mikhail D.' }], 'container-title': ['Nature'], issued: { 'date-parts': [[2013]] }, volume: '500', issue: '7460', page: '54-58' });
var pnas = A.normalize({ type: 'journal-article', title: ['A title of some paper about things'], author: [{ family: 'Smith', given: 'J. A.' }], 'container-title': ['Proceedings of the National Academy of Sciences'], issued: { 'date-parts': [[2013]] }, volume: '110', page: '1234-1240' });
var litvin = A.normalize({ type: 'journal-article', title: ['A title of some paper about things'], author: [{ family: 'Litvin', given: 'Yu. A.' }], 'container-title': ['Proceedings of the National Academy of Sciences'], issued: { 'date-parts': [[2013]] }, volume: '110', page: '1234-1240' });
[['IEEE, initials first', 'G. Kucsko, P. C. Maurer, N. Y. Yao, M. Kubo, H. J. Noh, P. K. Lo, H. Park, and M. D. Lukin, “Nanometre-scale thermometry in a living cell,” Nature, vol. 500, no. 7460, pp. 54–58, 2013.', kuc],
 ['RSC, initials first', 'G. Kucsko, P. C. Maurer, N. Y. Yao and M. D. Lukin, Nature, 2013, 500, 54–58.', kuc],
 ['Chicago, full given names', 'Kucsko, Georg, Peter C. Maurer, Norman Y. Yao, Mikhail Kubo, Hyun J. Noh, Po K. Lo, Hongkun Park, and Mikhail D. Lukin. 2013. “Nanometre-Scale Thermometry in a Living Cell.” Nature 500 (7460): 54–58.', kucFull],
 ['Vancouver month', 'Kucsko G, Maurer PC, Yao NY, Kubo M, Noh HJ, Lo PK, Park H, Lukin MD. Nanometre-scale thermometry in a living cell. Nature. 2013 Aug 1;500(7460):54-8.', kuc],
 ['Chicago month', 'Kucsko, G., et al. “Nanometre-scale thermometry in a living cell.” Nature 500, no. 7460 (August 2013): 54–58.', kuc],
 ['three-letter journal abbreviations', 'Smith JA (2013) A title of some paper about things. Proc Natl Acad Sci USA 110:1234–1240.', pnas],
 ['abbreviations with periods', 'Smith, J. A. (2013). A title of some paper about things. Proc. Natl. Acad. Sci. U.S.A., 110, 1234–1240.', pnas],
 ['two-letter initials run together', 'Litvin YuA (2013) A title of some paper about things. Proc Natl Acad Sci 110:1234', litvin],
 ['year suffix', 'Kucsko, G. et al. (2013a) Nanometre-scale thermometry in a living cell. Nature 500, 54–58.', kuc],
 ['and others', 'Kucsko G, Maurer PC, and others. Nanometre-scale thermometry in a living cell. Nature. 2013;500:54-58.', kuc],
 ['words of a link', 'Kucsko G, Maurer PC. Nanometre-scale thermometry in a living cell. Nature. 2013;500:54-58. https://www.nature.com/articles/nature12373', kuc],
 ['Vancouver web with a cited date', 'Kucsko G, Maurer PC. Nanometre-scale thermometry in a living cell. Nature [Internet]. 2013 [cited 2024 Jan 5];500:54-58.', kuc],
 ['APA retrieval date', 'Kucsko, G., & Maurer, P. C. (2013). Nanometre-scale thermometry in a living cell. Nature, 500, 54–58. Retrieved March 3, 2024, from https://www.nature.com/articles/nature12373', kuc],
 ['Suppl.', 'Kucsko G, Maurer PC. Nanometre-scale thermometry in a living cell. Nature. 2013;500(Suppl. 3):54-58.', kuc],
 ['decomposed (NFD) text', 'Kucsko, G., Maurer, P. C. (2013). Nanometre-scale thermometry in a living cell. Nature, 500, 54–58.'.normalize('NFD'), kuc]
].forEach(function (c) { var mm = marksOf(c[1], c[2]); ok('no false mark: ' + c[0], mm.length === 0, JSON.stringify(mm)); });
var m54 = marksOf('Kucsko G, Maurer PC. Nanometre-scale thermometry in a living cell. Nature. 2013;500:54–58.', A.normalize({ type: 'journal-article', title: ['Nanometre-scale thermometry in a living cell'], author: [{ family: 'Kucsko', given: 'G.' }, { family: 'Maurer', given: 'P. C.' }], 'container-title': ['Nature'], issued: { 'date-parts': [[2013]] }, volume: '500', page: '54-8' }));
ok('an abbreviated page range in the record is the full one in the text', m54.length === 0, JSON.stringify(m54));
var mqc = marksOf('Kucsko G, Maurer QC, Yao NY. Nanometre-scale thermometry in a living cell. Nature. 2013;500(7460):54-58.', kuc);
ok('a wrong two-letter initial before a comma is marked', mqc.length === 1 && /^diff:QC\|.*P\. C\./.test(mqc[0]), JSON.stringify(mqc));
var mdoi = marksOf('Kucsko G, Maurer PC. Nanometre-scale thermometry in a living cell. Nature. 2013;500:54-58. https://doi.org/10.1038/nature99999', kuc);
ok('a DOI other than the record\'s is marked as one item', mdoi.length === 1 && /^diff:https:\/\/doi\.org\/10\.1038\/nature99999\|.*10\.1038\/nature12373/.test(mdoi[0]), JSON.stringify(mdoi));
var mnfd = marksOf('Bacik, P., Uher, P. (2026). Modraite, a new vesuvianite-group mineral from the Modra skarn, Malé Karpaty Mountains, Slovakia. American Mineralogist.'.normalize('NFD'), rec);
ok('decomposed text still gets the diacritic mark, on the whole word', mnfd.length === 1 && /^accent:Bacik\|/.test(mnfd[0]), JSON.stringify(mnfd));
// lending: casing letter by letter, no lend when the text also writes the plain form or the word belongs to the title
function lend(auth, raw, title) { var r = A.normalize({ type: 'journal-article', title: [title || 'T'], author: auth, issued: { 'date-parts': [[2020]] } }); H.adoptDiacritics(r, raw); return r.authors.map(function (p) { return p.family + '/' + p.given; }).join(','); }
ok('inner capitals survive a lend', lend([{ family: 'McDonald', given: 'A.' }], 'McDónald, A. (2020). T.') === 'McDónald/A.', lend([{ family: 'McDonald', given: 'A.' }], 'McDónald, A. (2020). T.'));
ok('two people, one with the accent: nothing lent', lend([{ family: 'Muller', given: 'A.' }, { family: 'Muller', given: 'B.' }], 'Müller, A., Muller, B. (2020). X.') === 'Muller/A.,Muller/B.');
ok('a title word is not lent to a name', lend([{ family: 'Male', given: 'J.' }], 'Male, J. (2020). Geology of the Malé Karpaty. J.', 'Geology of the Malé Karpaty') === 'Male/J.');
ok('a given name is not lent to another author\'s family name', lend([{ family: 'Garcia', given: 'Angel' }, { family: 'Angel', given: 'B.' }], 'García, Ángel, Angel, B. (2020). T.') === 'García/Angel,Angel/B.', lend([{ family: 'Garcia', given: 'Angel' }, { family: 'Angel', given: 'B.' }], 'García, Ángel, Angel, B. (2020). T.'));
var nfdRec = A.normalize({ type: 'journal-article', title: ['T'], author: [{ family: 'Bacik', given: 'P.' }], issued: { 'date-parts': [[2026]] } });
ok('decomposed text lends its diacritics', H.adoptDiacritics(nfdRec, 'Bačík, P. (2026). T.'.normalize('NFD')) === 1 && nfdRec.authors[0].family === 'Bačík', nfdRec.authors[0].family);
// mojibake: real Latin-1 text that happens to look like a garbled pair is kept; garbled lines beside clean ones, twice-garbled text and three-byte sequences are repaired
['Smith J (2020) Unit-cell volume of 1234.5 Å³ in garnet. Am Mineral 105:1-10.', '20 Å²', 'Gauß’s law revisited', 'Strauß’ Vorlesungen', 'LE PASSÉ : UNE HISTOIRE', 'Grid of 10 × 10 cells', 'Groß–Klein', 'Ø 5 mm', 'Contribution à la géologie'].forEach(function (s) { ok('real text kept: ' + s, H.repairMojibake(s) === s, JSON.stringify(H.repairMojibake(s))); });
[[garble('Bačík, P. (2026). X.') + '\nŠkoda, R. (2020). Y.', 'Bačík, P. (2026). X.\nŠkoda, R. (2020). Y.'], [garble(garble('Bačík')), 'Bačík'], ['Price â‚¬100', 'Price €100'], ['Fe â†’ Mg', 'Fe → Mg'], ['x â‰¤ 5 â„¢', 'x ≤ 5 ™'],
 [garble('日本語の参考文献'), '日本語の参考文献'], [garble('王明 (2020) 中国'), '王明 (2020) 中国'], [garble('😀 ok'), '😀 ok'], [garble('Contribution à la géologie'), 'Contribution à la géologie'], [garble('α-quartz at 25 °C'), 'α-quartz at 25 °C'], [garble('Пароникян А.В.'), 'Пароникян А.В.']
].forEach(function (c) { ok('repaired: ' + c[1], H.repairMojibake(c[0]) === c[1], JSON.stringify(H.repairMojibake(c[0]))); });
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
