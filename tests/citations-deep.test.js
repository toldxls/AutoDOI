var ROOT = require('path').resolve(__dirname, '..');
var FIX = require('path').join(__dirname, 'fixtures');
// Tests for the deep-review fixes in citations.js (items 1-35). Run: node fix-deep-citations-test.js
const A = require(require('path').join(ROOT, 'citations.js'));
let pass = 0, fail = 0;
const eq = (label, got, exp) => {
  if (got === exp) pass++;
  else { fail++; console.log('FAIL', label, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(exp)); }
};
const N = A.normalize, F = A.format, f = A.autoFormulas;
const jr = o => Object.assign({ type: 'journal-article', 'container-title': ['J'], volume: '1', page: '1-2', issued: { 'date-parts': [[2020]] } }, o);
const line = (s, re) => (s.split(/\r?\n/).filter(l => re.test(l)));
const T = t => A.titleText(N({ type: 'journal-article', title: [t] }));
const H = t => A.titleHtml(N({ type: 'journal-article', title: [t] }));

/* 1. entity-encoded markup, <tex-math>, <inline-formula> */
const tvt = 'Physical Layer Security Over &lt;inline-formula&gt;\n                     &lt;tex-math notation="LaTeX"&gt;$\\alpha$&lt;/tex-math&gt;\n                  &lt;/inline-formula&gt;-&lt;inline-formula&gt;\n                     &lt;tex-math notation="LaTeX"&gt;$\\kappa$&lt;/tex-math&gt;\n                  &lt;/inline-formula&gt;-&lt;inline-formula&gt;\n                     &lt;tex-math notation="LaTeX"&gt;$\\mu$&lt;/tex-math&gt;\n                  &lt;/inline-formula&gt; and &lt;inline-formula&gt;\n                     &lt;tex-math notation="LaTeX"&gt;$\\alpha$&lt;/tex-math&gt;\n                  &lt;/inline-formula&gt;-&lt;inline-formula&gt;\n                     &lt;tex-math notation="LaTeX"&gt;$\\eta$&lt;/tex-math&gt;\n                  &lt;/inline-formula&gt;-&lt;inline-formula&gt;\n                     &lt;tex-math notation="LaTeX"&gt;$\\mu$&lt;/tex-math&gt;\n                  &lt;/inline-formula&gt; Fading Channels';
const tvtR = jr({ title: [tvt], DOI: '10.1109/tvt.2018.2884832' });
eq('1 tvt title', A.titleText(N(tvtR)), 'Physical Layer Security Over α-κ-μ and α-η-μ Fading Channels');
eq('1 tvt ris', line(F(tvtR, 'ris'), /^TI/)[0], 'TI  - Physical Layer Security Over α-κ-μ and α-η-μ Fading Channels');
eq('1 tvt no tags in bibtex', /inline-formula|tex-math|&lt;/.test(F(tvtR, 'bibtex')), false);
eq('1 tex scripts', H('<tex-math>$\\mathrm{Fe}_{2}\\mathrm{O}_3^{2+}$</tex-math> phase'), 'Fe<sub>2</sub>O<sub>3</sub><sup>2+</sup> phase');
eq('1 tex degree', T('at 25<inline-formula><tex-math>$^\\circ$</tex-math></inline-formula>C'), 'at 25°C');
eq('1 alternatives keep MathML', T('<inline-formula><alternatives><mml:math><mml:msub><mml:mi>x</mml:mi><mml:mn>2</mml:mn></mml:msub></mml:math><tex-math>$x_2$</tex-math></alternatives></inline-formula> y'), 'x₂ y');
eq('1 encoded italics', H('A &lt;i&gt;Homo&lt;/i&gt; skull'), 'A <i>Homo</i> skull');
eq('1 text < > kept', T('x &lt; y and &lt;z&gt; tags'), 'x < y and <z> tags');
eq('1 container encoded tag', N(jr({ title: ['T'], 'container-title': ['A &lt;i&gt;B&lt;/i&gt; &lt; C'] })).container, 'A B < C');

/* 2. empty authors dropped */
const e2 = jr({ title: ['T'], author: [{ sequence: 'additional' }, { given: 'Judith', family: 'Case' }, { family: '  ', given: ' ' }] });
eq('2 authors', N(e2).authors.length, 1);
eq('2 apa', F(e2, 'apa'), 'Case, J. (2020). T. J, 1, 1–2.');
eq('2 ris AU', line(F(e2, 'ris'), /^AU/).join('|'), 'AU  - Case, Judith');
eq('2 bibtex author', line(F(e2, 'bibtex'), /author/)[0], '  author = {Case, Judith},');

/* 3. BibTeX brace protection */
const b3 = t => line(F(jr({ title: [t] }), 'bibtex'), /^  title/)[0];
eq('3 title case', b3('The Structure of DNA in E. coli: A Review'), '  title = {The {Structure} of {DNA} in {E.} coli: {A} {Review}},');
eq('3 first word acronym', b3('mRNA vaccines and SARS-CoV-2'), '  title = {{mRNA} vaccines and {SARS-CoV-2}},');
eq('3 formula words', b3('Garnet with Fe2O3 and 40Ar/39Ar ages'), '  title = {Garnet with {Fe\\textsubscript{2}O\\textsubscript{3}} and {{\\textsuperscript{40}Ar/\\textsuperscript{39}Ar}} ages},');
eq('3 first word formula unchanged', b3('Fe3+ in garnet'), '  title = {Fe\\textsuperscript{3+} in garnet},');
eq('3 journal unprotected', line(F(jr({ title: ['x'], 'container-title': ['Journal of Geology'] }), 'bibtex'), /journal/)[0], '  journal = {Journal of Geology},');

/* 4. BibTeX suffix position */
eq('4 bib Jr', line(F(jr({ title: ['T'], author: [{ given: 'Martin Luther', family: 'King', suffix: 'Jr.' }] }), 'bibtex'), /author/)[0], '  author = {King, Jr., Martin Luther},');
eq('4 ris Jr', line(F(jr({ title: ['T'], author: [{ given: 'Martin Luther', family: 'King', suffix: 'Jr.' }] }), 'ris'), /^AU/)[0], 'AU  - King, Martin Luther, Jr.');

/* 5. title fallbacks */
eq('5 original-title', N({ type: 'journal-article', title: [''], 'original-title': ['根の研究会'] }).title, '根の研究会');
eq('5 short-title', N({ type: 'journal-article', title: [''], 'short-title': ['Short'] }).title, 'Short');
eq('5 subtitle only', N({ type: 'journal-article', title: [], subtitle: ['Sub'] }).title, 'Sub');
eq('5 second title entry', N({ type: 'journal-article', title: ['', 'Second'] }).title, 'Second');

/* 6. edition "0" / "None" ignored */
const b6 = { type: 'book', title: ['Politics?'], author: [{ given: 'A', family: 'B' }], 'edition-number': '0', publisher: 'Springer', 'publisher-location': 'Dordrecht', issued: { 'date-parts': [[2001]] } };
eq('6 normalized', N(b6).edition, '');
eq('6 None', N(Object.assign({}, b6, { edition: 'None' })).edition, '');
eq('6 chicago', F(b6, 'chicago'), 'B, A. Politics? Dordrecht: Springer, 2001.');
eq('6 harvard', F(b6, 'harvard'), 'B, A. (2001) Politics? Dordrecht: Springer.');
eq('6 ris ET', /\nET/.test(F(b6, 'ris')), false);
eq('6 enw %7', /%7/.test(F(b6, 'endnote')), false);
eq('6 bibtex edition', /edition/.test(F(b6, 'bibtex')), false);
const pre6 = Object.assign({}, N(b6), { edition: '0' });            // pre-normalized record with a stale "0"
eq('6 prenormalized apa', F(pre6, 'apa'), 'B, A. (2001). Politics? Springer.');
eq('6 prenormalized ris', /ET  -/.test(F(pre6, 'ris')), false);
eq('6 real edition kept', F(Object.assign({}, b6, { 'edition-number': '2' }), 'chicago'), 'B, A. Politics? 2nd ed. Dordrecht: Springer, 2001.');

/* 7. @book series */
const b7 = { type: 'book', title: ['Book'], 'container-title': ['Lecture Notes in Physics'], publisher: 'Springer', issued: { 'date-parts': [[2001]] } };
eq('7 series', line(F(b7, 'bibtex'), /series|howpublished/).join('|'), '  series = {Lecture Notes in Physics},');
eq('7 ris T3', line(F(b7, 'ris'), /^T[23]/).join('|'), 'T3  - Lecture Notes in Physics');

/* 8. doubled punctuation */
const ch8 = { type: 'book-chapter', title: ['Chapter'], author: [{ given: 'A', family: 'B' }], 'container-title': ['What Is Politics?'], publisher: 'Springer', 'publisher-location': 'Dordrecht', issued: { 'date-parts': [[2001]] } };
eq('8 harvard chapter', F(ch8, 'harvard'), 'B, A. (2001) ‘Chapter’, in What Is Politics? Dordrecht: Springer.');
eq('8 ieee chapter', F(ch8, 'ieee'), 'A. B, “Chapter,” in What Is Politics? Dordrecht: Springer, 2001.');
const ds8 = { type: 'dataset', title: ['Data'], author: [{ given: 'A', family: 'B' }], publisher: 'Wiley, Inc.', DOI: '10.5061/x', issued: { 'date-parts': [[2001]] } };
eq('8 harvard dataset', F(ds8, 'harvard'), 'B, A. (2001) ‘Data’, Wiley, Inc. Available at: https://doi.org/10.5061/x.');
eq('8 chicago book ?', F(Object.assign({}, b6, { 'edition-number': '3', title: ['Intentions?'] }), 'chicago'), 'B, A. Intentions? 3rd ed. Dordrecht: Springer, 2001.');
eq('8 harvard book ?', F(Object.assign({}, b6, { 'edition-number': '3', title: ['Intentions?'] }), 'harvard'), 'B, A. (2001) Intentions? 3rd ed. Dordrecht: Springer.');
eq('8 harvard journal pub dot', F(jr({ title: ['T'], 'container-title': ['Colleges.'], volume: '', page: '' }), 'harvard'), '(2020) ‘T’, Colleges.');

/* 9. organisation names with commas (EndNote convention: trailing comma, internal commas doubled) */
const o9 = jr({ title: ['T'], author: [{ name: 'USDOE, Washington, DC (United States)' }] });
eq('9 ris', line(F(o9, 'ris'), /^AU/)[0], 'AU  - USDOE,, Washington,, DC (United States),');
eq('9 enw', line(F(o9, 'endnote'), /^%A/)[0], '%A USDOE,, Washington,, DC (United States),');
eq('9 import undoubles', N(jr({ title: ['T'], author: [{ name: 'USDOE,, Washington,, DC (United States)' }] })).authors[0].family, 'USDOE, Washington, DC (United States)');

/* 10. single-field names without a given name */
const p10 = jr({ title: ['T'], author: [{ family: 'The pandas development team' }] });
eq('10 literal', N(p10).authors[0].literal, true);
eq('10 ris', line(F(p10, 'ris'), /^AU/)[0], 'AU  - The pandas development team,');
eq('10 enw', line(F(p10, 'endnote'), /^%A/)[0], '%A The pandas development team,');
eq('10 bibtex', line(F(p10, 'bibtex'), /author/)[0], '  author = {{The pandas development team}},');
eq('10 caps org kept', N(jr({ title: ['T'], author: [{ family: 'NASA' }] })).authors[0].family, 'NASA');

/* 11. kind() */
eq('11 article-journal', A.kind(N({ type: 'article-journal', title: ['T'], 'container-title': ['J'] })), 'journal');
const aj = { type: 'article-journal', title: ['T'], author: [{ name: 'X' }], issued: { 'date-parts': [[2024]] }, DOI: '10.1/x' };
eq('11 article-journal no container vancouver', F(aj, 'vancouver'), 'X. T. 2024. doi:10.1/x');
eq('11 article-journal no container carnegie', F(aj, 'carnegie'), 'X. 2024. T.');
eq('11 article with container', A.kind(N({ type: 'article', title: ['T'], 'container-title': ['J'] })), 'journal');
eq('11 article no container', A.kind(N({ type: 'article', title: ['T'] })), 'preprint');
eq('11 standard', A.kind(N({ type: 'standard', title: ['T'] })), 'standard');
eq('11 standard RIS', line(F({ type: 'standard', title: ['T'] }, 'ris'), /^TY/)[0], 'TY  - STAND');
eq('11 standard ENW', line(F({ type: 'standard', title: ['T'] }, 'endnote'), /^%0/)[0], '%0 Standard');
const re11 = { type: 'reference-entry', title: ['Entry'], author: [{ given: 'A', family: 'B' }], 'container-title': ['Encyclopedia of Things'], issued: { 'date-parts': [[2001]] } };
eq('11 reference-entry kind', A.kind(N(re11)), 'chapter');
eq('11 reference-entry RIS', line(F(re11, 'ris'), /^TY/)[0], 'TY  - ENCYC');
eq('11 reference-entry ENW', line(F(re11, 'endnote'), /^%0/)[0], '%0 Encyclopedia');
eq('11 reference-entry apa', F(re11, 'apa'), 'B, A. (2001). Entry. In Encyclopedia of Things.');
eq('11 report-component', A.kind(N({ type: 'report-component', title: ['T'] })), 'report');

/* 12. bibKey transliteration and empty authors */
const key = r => F(r, 'bibtex').match(/^@\w+\{([^,]+),/)[1];
eq('12 Celik', key(jr({ title: ['Über Strukturen'], author: [{ given: 'A', family: 'Çelik' }] })), 'Celik2020Uber');
eq('12 Bartok', key(jr({ title: ['Music'], author: [{ given: 'B', family: 'Bartók' }] })), 'Bartok2020Music');
eq('12 Oster', key(jr({ title: ['Rocks'], author: [{ given: 'B', family: 'Østergaard' }] })), 'Ostergaard2020Rocks');
eq('12 no author', key(jr({ title: ['The Geology of Mars'] })), 'Geology2020Mars');
eq('12 nothing', key(jr({ title: ['T'] })), 'ref2020');

/* 13. nicknames are not initials */
eq('13 parens', F(jr({ title: ['T'], author: [{ given: 'Aswathi (Asha)', family: 'Jacob' }] }), 'apa').split(' (')[0], 'Jacob, A.');
eq('13 quoted', F(jr({ title: ['T'], author: [{ given: 'Robert "Bob" J.', family: 'Smith' }] }), 'apa').split(' (')[0], 'Smith, R. J.');
eq('13 apostrophe name kept', F(jr({ title: ['T'], author: [{ given: "D'Arcy", family: 'Thompson' }] }), 'apa').split(' (')[0], 'Thompson, D.');

/* 14. single-page ranges */
eq('14 263-263', N(jr({ title: ['T'], page: '263-263' })).pages, '263');
eq('14 ris', line(F(jr({ title: ['T'], page: '263-263' }), 'ris'), /^[SE]P/).join('|'), 'SP  - 263');
eq('14 real range', N(jr({ title: ['T'], page: '263-264' })).pages, '263-264');

/* 15. double hyphen / dashes between formulas are separators */
eq('15 --', f('KAlSiO4--Mg2SiO4--SiO2--H2O system'), 'KAlSiO₄--Mg₂SiO₄--SiO₂--H₂O system');
eq('15 en dash', f('NaAlSi3O8–CaAl2Si2O8 plagioclase'), 'NaAlSi₃O₈–CaAl₂Si₂O₈ plagioclase');
eq('15 minus sign', f('Al2O3−SiO2 join'), 'Al₂O₃−SiO₂ join');

/* 16. oxidation states in site lists and IMA order */
eq('16 olivine', f('(Mg,Fe2+)2SiO4 olivine'), '(Mg,Fe²⁺)₂SiO₄ olivine');
eq('16 corundum ss', f('(Fe3+,Al)2O3 solid solution'), '(Fe³⁺,Al)₂O₃ solid solution');
eq('16 cpx', f('Ca(Mg,Fe2+)Si2O6'), 'Ca(Mg,Fe²⁺)Si₂O₆');
eq('16 arsenate', f('Na6(Ca,Na)(Mg,Fe3+)3Al(AsO4)6'), 'Na₆(Ca,Na)(Mg,Fe³⁺)₃Al(AsO₄)₆');
eq('16 charge then count', f('PbFe2+2V3+2(PO4)3(OH)3'), 'PbFe²⁺₂V³⁺₂(PO₄)₃(OH)₃');
eq('16 IMA count then charge', f('PbFe22+V23+(PO4)3(OH)3'), 'PbFe₂²⁺V₂³⁺(PO₄)₃(OH)₃');
['C3+C4 photosynthesis', 'H2+H2O mixtures', 'Ca2+Mg2+ ratio', 'CD4+CD25+ T cells'].forEach(t => eq('16 same: ' + t, f(t), t));

/* 17. solid-solution variables */
eq('17 pyrrhotite', f('Fe1−xS pyrrhotite'), 'Fe₁₋ₓS pyrrhotite');
eq('17 pyrrhotite hyphen', f('Fe1-xS pyrrhotite'), 'Fe₁₋ₓS pyrrhotite');
eq('17 wustite en dash', f('Fe1–xO wüstite'), 'Fe₁₋ₓO wüstite');
eq('17 ferropericlase', f('(Mg1−xFex)O ferropericlase'), '(Mg₁₋ₓFeₓ)O ferropericlase');
eq('17 bridgmanite', f('MgxFe1-xSiO3 bridgmanite'), 'MgₓFe₁₋ₓSiO₃ bridgmanite');
eq('17 bronze', f('(NH4)xWO3 bronze'), '(NH₄)ₓWO₃ bronze');
eq('17 y html', A.titleHtml(N({ title: ['Mg1-yFeyO'] })), 'Mg<sub>1−y</sub>Fe<sub>y</sub>O');
eq('17 y text', f('Mg1-yFeyO'), 'Mg₁₋yFeyO');
eq('17 delta', f('YBa2Cu3O7−δ superconductor'), 'YBa₂Cu₃O₇₋δ superconductor');
['NOx and SOx and CHx and COx', 'The sixth Six', 'Tmax'].forEach(t => eq('17 same: ' + t, f(t), t));
eq('17 max stays plain', A.toScript('max', 'sub'), 'max');

/* 18. vacancy */
eq('18 vacancy', f('□Ca2Mg5Si8O22(OH)2 amphibole'), '□Ca₂Mg₅Si₈O₂₂(OH)₂ amphibole');
eq('18 vacancy site', f('(□,Na)Ca2Mg5Si8O22(OH)2'), '(□,Na)Ca₂Mg₅Si₈O₂₂(OH)₂');

/* 19. prefixed parameters and diatomic gases */
eq('19 params', f('fO2 and log fO2 and pCO2 and XCO2 and aH2O and fH2O'), 'fO₂ and log fO₂ and pCO₂ and XCO₂ and aH₂O and fH₂O');
eq('19 gases context', f('the H2 fluid and O2 fugacity and N2 gas'), 'the H₂ fluid and O₂ fugacity and N₂ gas');
eq('19 gas with formula', f('H2O and O2 in melts'), 'H₂O and O₂ in melts');
['F2 hybrids of maize', 'H2 receptor antagonists', 'pS6 kinase', 'pH 7', 'XRD and fMRI'].forEach(t => eq('19 same: ' + t, f(t), t));

/* 20. radiogenic Pb*, reference standards, Greek after hyphen, initial ratios, labelled ions */
eq('20 Pb*', f('207Pb*/206Pb* ages'), '²⁰⁷Pb*/²⁰⁶Pb* ages');
eq('20 VSMOW', f('δ18OVSMOW and δ13CPDB values'), 'δ¹⁸OVSMOW and δ¹³CPDB values');
eq('20 high-δ', f('low-δ18O and high-δ18O magmas'), 'low-δ¹⁸O and high-δ¹⁸O magmas');
eq('20 Sri', f('87Sr/86Sri ratios'), '⁸⁷Sr/⁸⁶Srᵢ ratios');
eq('20 TcO4', f('99TcO4− sorption'), '⁹⁹TcO₄⁻ sorption');
eq('20 13CO2', f('13CO2 labelling'), '¹³CO₂ labelling');
['2H2O', '20Na2O–80SiO2 glass', '16S rRNA'].forEach(t => eq('20 same: ' + t, f(t), t));

/* 21. pretty-printed JATS whitespace */
eq('21 Fe3S', T('Fe\n  <sub>3</sub>\n  S at high pressure'), 'Fe₃S at high pressure');
eq('21 word after sub', T('H\n  <sub>2</sub>\n  and CO\n  <sub>2</sub>\n  In situ'), 'H₂ and CO₂ In situ');
eq('21 sup isotope', T('on\n  <sup>23</sup>\n  Na and'), 'on ²³Na and');
eq('21 site list', T('(Mg,Fe)\n  <sub>2</sub>\n  (OH)\n  <sub>2</sub>'), '(Mg,Fe)₂(OH)₂');
eq('21 plain spaces kept', T('CO<sub>2</sub> and H<sub>2</sub>O'), 'CO₂ and H₂O');

/* 22. spaces around deposited italics */
eq('22 italics', H('Borings of<i>Trypanites</i>in hardgrounds'), 'Borings of <i>Trypanites</i> in hardgrounds');
eq('22 colon before', T('the late Cenozoic:<i>Capisocysta</i> Warny'), 'the late Cenozoic: Capisocysta Warny');
eq('22 paren after', T('coiled <i>Valvata</i>(Gastropoda) from'), 'coiled Valvata (Gastropoda) from');
eq('22 notation kept', H('p<i>K</i><sub>a</sub> values'), 'p<i>K</i><sub>a</sub> values');
eq('22 hyphen kept', H('<i>cis</i>-isomer'), '<i>cis</i>-isomer');
eq('22 crossed tags', H('<i>a<sub>b</i>c</sub> d'), 'a<sub>bc</sub> d');

/* 23. private-use glyphs */
eq('23 PUA stripped', T('A  glyph'), 'A glyph');
eq('23 PUA entity', T('A &#xE5F8;glyph'), 'A glyph');
eq('23 author PUA', N(jr({ title: ['T'], author: [{ given: 'A', family: 'B' }] })).authors[0].given, 'A');

/* 24. Carnegie: no invented "[cited <today>]"; reports like books */
const mcs = { type: 'report', title: ['Mineral commodity summaries 2023'], author: [{ name: 'U.S. Geological Survey' }], publisher: 'U.S. Geological Survey', 'publisher-location': 'Reston, Virginia', 'number-of-pages': '210', issued: { 'date-parts': [[2023]] }, DOI: '10.3133/mcs2023' };
eq('24 report', F(mcs, 'carnegie'), 'U.S. Geological Survey. 2023. Mineral commodity summaries 2023. U.S. Geological Survey, Reston, Virginia. 210 pp.');
const ofr = { type: 'report-component', title: ['Mapping groundwater'], author: [{ given: 'Allen M.', family: 'Shapiro' }], 'container-title': ['U.S. Geological Survey Open-File Report'], number: '2022-1093', publisher: 'U.S. Geological Survey', issued: { 'date-parts': [[2022]] } };
eq('24 series + number', F(ofr, 'carnegie'), 'Shapiro, A.M. 2022. Mapping groundwater. U.S. Geological Survey Open-File Report 2022-1093. U.S. Geological Survey.');
eq('24 web with accessed', F({ type: 'webpage', title: ['Page'], author: [{ given: 'J. W.', family: 'Fetzner', suffix: 'Jr.' }], URL: 'http://iz.carnegiemnh.org/CMIC/Default.org', accessed: { 'date-parts': [[2008, 7, 16]] }, issued: { 'date-parts': [[2008]] } }, 'carnegie'),
  'Fetzner, J.W., Jr. 2008. Page [cited 16 July 2008]. Available from http://iz.carnegiemnh.org/CMIC/Default.org');
eq('24 dataset without accessed', F({ type: 'dataset', title: ['Data'], author: [{ given: 'J.', family: 'F' }], DOI: '10.5061/x', publisher: 'Dryad', issued: { 'date-parts': [[2008]] } }, 'carnegie'), 'F, J. 2008. Data. Dryad. Available from https://doi.org/10.5061/x');
eq('24 no cited anywhere', A.STYLES.some(s => /\[cited/.test(F(mcs, s.id))), false);

/* 25. bioRxiv / medRxiv versions */
eq('25 v3', A.extractDoi('https://www.biorxiv.org/content/10.1101/2020.03.24.20042937v3'), '10.1101/2020.03.24.20042937');
eq('25 v3.full', A.toDoi('https://www.medrxiv.org/content/10.1101/2020.03.24.20042937v3.full'), '10.1101/2020.03.24.20042937');
eq('25 v1.full.pdf', A.extractDoi('https://www.biorxiv.org/content/10.1101/2020.03.24.20042937v1.full.pdf'), '10.1101/2020.03.24.20042937');
eq('25 old style', A.extractDoi('https://www.biorxiv.org/content/10.1101/064824v2.abstract'), '10.1101/064824');
eq('25 other prefix untouched', A.extractDoi('10.1234/abcv2'), '10.1234/abcv2');

/* 26. glued given names and misplaced suffixes */
const n26 = (g, fam) => N(jr({ title: ['T'], author: [{ given: g, family: fam || 'X' }] })).authors[0];
eq('26 StephanieM.', n26('StephanieM.').given, 'Stephanie M.');
eq('26 GeorgeR.', n26('GeorgeR.').given, 'George R.');
eq('26 Jr in given', JSON.stringify([n26('R., Jr.', 'Brown').given, n26('R., Jr.', 'Brown').suffix]), '["R.","Jr."]');
eq('26 Jr apa', F(jr({ title: ['T'], author: [{ given: 'R. Jr.', family: 'Brown' }] }), 'apa').split(' (')[0], 'Brown, R., Jr.');
eq('26 McDonald untouched', n26('MaryAnn').given, 'MaryAnn');

/* 27. volume equal to the year */
const fi = N({ type: 'journal-article', title: ['A Paleopopulation of Coryphodon'], 'container-title': ['Fieldiana Geology'], volume: '2010', issue: '52', page: '1', issued: { 'date-parts': [[2010, 1, 8]] } });
eq('27 fieldiana', [fi.volume, fi.issue].join('|'), '52|');
eq('27 no issue', N(jr({ title: ['T'], volume: '2020', issue: '' })).volume, '');
eq('27 other year kept', N(jr({ title: ['T'], volume: '1999' })).volume, '1999');

/* 28. pass-through of imported RIS / EndNote tags */
const risRec = { type: 'journal-article', title: ['T'], source: 'ris', URL: 'https://example.org/paper', DOI: '10.1/x',
  raw: { TY: ['JOUR'], TI: ['T'], KW: ['rocks', 'minerals'], N1: ['a note'], AN: ['12345'], UR: ['https://example.org/paper', 'https://mirror.org/p'], L1: ['file.pdf'], Y2: ['2020/01/02'], M3: ['Article'], DB: ['Scopus'], CN: ['QE1'] } };
const risOut = F(risRec, 'ris');
eq('28 ris UR kept', line(risOut, /^UR/).join('|'), 'UR  - https://example.org/paper|UR  - https://mirror.org/p');
eq('28 ris extra', line(risOut, /^(KW|N1|AN|L1|Y2|M3|DB|CN)/).join('|'), 'KW  - rocks|KW  - minerals|N1  - a note|AN  - 12345|L1  - file.pdf|Y2  - 2020/01/02|M3  - Article|DB  - Scopus|CN  - QE1');
eq('28 enw from ris keywords', line(F(risRec, 'endnote'), /^%[KZ]/).join('|'), '%K rocks|%K minerals|%Z a note');
const enwRec = { type: 'journal-article', title: ['T'], source: 'enw', raw: { '0': ['Journal Article'], K: ['k1'], Z: ['n1'], M: ['acc'], U: ['https://x.org'] } };
eq('28 enw extra', line(F(enwRec, 'endnote'), /^%[KZMU]/).join('|'), '%U https://x.org|%K k1|%Z n1|%M acc');
eq('28 crossref record no raw', line(F(jr({ title: ['T'], DOI: '10.1/y' }), 'ris'), /^UR/).join('|'), 'UR  - https://doi.org/10.1/y');
eq('28 ELEC kind', A.kind(N({ type: 'other', title: ['T'], source: 'ris', raw: { TY: ['ELEC'] } })), 'web');
eq('28 ELEC round trip', line(F({ type: 'other', title: ['T'], source: 'ris', raw: { TY: ['ELEC'] } }, 'ris'), /^TY/)[0], 'TY  - ELEC');

/* 29. EarthArXiv */
const ea = { type: 'posted-content', title: ['Intelligent National Map'], author: [{ given: 'A', family: 'B' }], publisher: 'California Digital Library (CDL)', 'group-title': 'Physical Sciences and Mathematics', DOI: '10.31223/X5W163', issued: { 'date-parts': [[2025]] } };
eq('29 institution', N(ea).institution, 'EarthArXiv');
eq('29 apa', F(ea, 'apa'), 'B, A. (2025). Intelligent National Map [Preprint]. EarthArXiv. https://doi.org/10.31223/X5W163');
eq('29 OSF group-title', N({ type: 'posted-content', title: ['T'], publisher: 'Center for Open Science', 'group-title': 'PsyArXiv', DOI: '10.31234/osf.io/abc' }).institution, 'PsyArXiv');

/* 30. " : " in titles */
eq('30 colon', N({ type: 'book', title: ['Dakota and Nebraska : Including the Black Hills'] }).title, 'Dakota and Nebraska: Including the Black Hills');
eq('30 ratio kept', N({ type: 'book', title: ['Ratios 1:2 and 3 :4'] }).title, 'Ratios 1:2 and 3 :4');

/* 31. container final full stop, bracketed places */
eq('31 container', F(jr({ title: ['T'], author: [{ given: 'A', family: 'B' }], 'container-title': ['Proceedings of the Linnean Society of New South Wales.'], volume: '7' }), 'carnegie'), 'B, A. 2020. T. Proceedings of the Linnean Society of New South Wales, 7:1-2.');
eq('31 abbreviation kept', N(jr({ title: ['T'], 'container-title': ['J. Geol.'] })).container, 'J. Geol.');
eq('31 place brackets', N({ type: 'book', title: ['T'], 'publisher-location': '[Chicago] :' }).place, 'Chicago');
eq('31 s.l.', N({ type: 'book', title: ['T'], 'publisher-location': '[S.l.]' }).place, '');

/* 32-34. linear time on adversarial input (100 KB) */
// Guards against quadratic or worse blow-ups (previously up to 72 s on these inputs), not exact speed: CI machines are slower
const LIMIT = Number(process.env.AUTODOI_TIME_LIMIT_MS || 1000);
const timed = (label, fn) => { const t = Date.now(); fn(); const ms = Date.now() - t; eq(label + ' < ' + LIMIT + ' ms (' + ms + ' ms)', ms < LIMIT, true); };
const K = 100000, rep = (p) => p.repeat(Math.ceil(K / p.length)).slice(0, K);
timed('32 newline runs + sub', () => N({ title: [rep(' \n') + '<sub>2</sub>'] }));
timed('32 newline runs + sup', () => N({ title: [rep(' \n') + '<sup>2</sup>\n'] }));
timed('32 many subs', () => N({ title: [rep('Fe\n <sub>3</sub>\n ')] }));
timed('32 encoded tags', () => N({ title: [rep('&lt;i ')] }));
timed('32 inline-formula', () => N({ title: [rep('<inline-formula>') + '</inline-formula>'] }));
timed('32 tex-math', () => N({ title: [rep('<tex-math>$\\alpha^{') + '</tex-math>'] }));
timed('33 braces', () => f(rep('{')));
timed('33 parens', () => f(rep('(')));
timed('33 brackets word', () => f(rep('[Fe2O3')));
timed('33 comma runs (trimPunct)', () => N(jr({ title: [rep(', ') + 'x.'], 'container-title': [rep(', ') + 'x.'], 'publisher-location': rep('/ ') + '!' })));
timed('33 unclosed subs (balanceMarks)', () => N({ title: [rep('<sub>') + '!'] }));
timed('34 lt', () => N({ title: [rep('<')] }));
timed('34 lt a', () => N({ title: [rep('<a ')] }));
timed('34 format all', () => { const r = N(jr({ title: [rep('a ')] })); A.STYLES.concat(A.EXPORTS).forEach(s => F(r, s.id)); });

/* 35. bidi and zero-width characters */
eq('35 zero-width/bidi', N(jr({ title: ['Ro​ck‮ s⁦a⁩lt﻿'] })).title, 'Rock salt');
eq('35 author', N(jr({ title: ['T'], author: [{ given: 'A‏', family: '‪B' }] })).authors[0].family, 'B');
eq('35 ZWNJ kept (Persian)', N(jr({ title: ['می‌خواهم'] })).title, 'می‌خواهم');

console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
