var ROOT = require('path').resolve(__dirname, '..');
var FIX = require('path').join(__dirname, 'fixtures');
const A = require(require('path').join(ROOT, 'citations.js'));
let pass = 0, fail = 0;
const eq = (label, got, exp) => { if (got === exp) pass++; else { fail++; console.log('FAIL', label, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(exp)); } };
const f = A.autoFormulas;
const same = (label, list) => list.forEach(t => eq(label + ': ' + t, f(t), t));
const conv = (label, pairs) => pairs.forEach(([a, b]) => eq(label + ': ' + a, f(a), b));

// A1 isotopes: one-letter elements whitelisted
same('A1 units', ['7B', '13B', '50K', '48V', '100W', '10C', '20N', 'Llama 2 7B and 13B models', 'Illumina 50K SNP chip', '48V mild hybrid', '100W LED', '10C fast charging', '20N latitude', '16S rRNA', '20S proteasome', '4K video', 'Tc-99m', 'Ti-6Al-4V']);
conv('A1 isotopes', [['99mTc-MIBI', '⁹⁹ᵐTc-MIBI'], ['18F-FDG PET', '¹⁸F-FDG PET'], ['177Lu-PSMA', '¹⁷⁷Lu-PSMA'], ['123I-MIBG', '¹²³I-MIBG'], ['90Y', '⁹⁰Y'],
  ['40K', '⁴⁰K'], ['14C dating', '¹⁴C dating'], ['2H and 18O', '²H and ¹⁸O'], ['235U/238U', '²³⁵U/²³⁸U'], ['182W', '¹⁸²W'], ['3He/4He', '³He/⁴He'],
  ['129Xe/132Xe', '¹²⁹Xe/¹³²Xe'], ['225Ac', '²²⁵Ac'], ['34S', '³⁴S'], ['10Be/9Be', '¹⁰Be/⁹Be']]);
const mk = A.normalize({ type: 'journal-article', title: ['99mTc imaging'], issued: { 'date-parts': [[2020]] } });
eq('A1 99mTc html', A.titleHtml(mk), '<sup>99m</sup>Tc imaging');

// A2 genes, proteins, cell lines
same('A2 bio', ['SH2', 'SHP2', 'HSP70', 'HSP90', 'C2C12', 'U2OS', 'B16F10', 'C3H', 'CaV1.2', 'H2B', 'NOS2', 'NOS3', 'SOCS3', 'CHK2', 'HNF4', 'SKOV3',
  'KCNH2', 'CK7', 'CK20', 'S100', 'B220', 'PS4', 'A320', 'BRCA1', 'TP53', 'NaV1.5', 'SARS-CoV2', 'SH2 domain binding', 'C2C12 myoblasts', 'HSP70/HSC70',
  'CaV3 T-type channel', 'H1N1 and H3N2', 'Vitamin B12', 'P53 and TP53 and IL6', 'PC12 cells', 'HN5', 'CHOP10', 'SHIP2']);
conv('A2 chem', [['H2O', 'H₂O'], ['CO2', 'CO₂'], ['CH4', 'CH₄'], ['NH3', 'NH₃'], ['N2O', 'N₂O'], ['SO4', 'SO₄'], ['PO4', 'PO₄'], ['O3 pollution', 'O₃ pollution'],
  ['H2S', 'H₂S'], ['HCO3', 'HCO₃'], ['H2O2', 'H₂O₂'], ['CS2', 'CS₂'], ['CCl4', 'CCl₄'], ['SF6', 'SF₆'], ['CF4', 'CF₄'], ['BF3', 'BF₃'], ['UF6', 'UF₆'],
  ['ClO4', 'ClO₄'], ['MnO4', 'MnO₄'], ['Cr2O7', 'Cr₂O₇'], ['C2H6', 'C₂H₆'], ['HNO3', 'HNO₃'], ['K2O', 'K₂O'], ['UO2', 'UO₂'], ['CH3OH', 'CH₃OH'],
  ['CH3COOH', 'CH₃COOH'], ['H2SO4', 'H₂SO₄'], ['C3N4', 'C₃N₄'], ['Ti6Al4V', 'Ti₆Al₄V'], ['Nb3Sn', 'Nb₃Sn'], ['MoS2', 'MoS₂'], ['YPO4', 'YPO₄'],
  ['NH2-terminal', 'NH₂-terminal'], ['Fe(CO)5', 'Fe(CO)₅'], ['(OH)4', '(OH)₄'], ['Ca2(Mg,Fe)5Si8O22(OH)2', 'Ca₂(Mg,Fe)₅Si₈O₂₂(OH)₂'], ['KNO3·H2O', 'KNO₃·H₂O']]);
same('A2 no digits', ['CoO', 'NiO', 'NaCl', 'KCN']);

// A3 charges
conv('A3 joiner', [['CO2- and H2O-bearing', 'CO₂- and H₂O-bearing'], ['SiO2- and Al2O3-rich', 'SiO₂- and Al₂O₃-rich'], ['(CO2+ H2O + NaCl)', '(CO₂+ H₂O + NaCl)'],
  ['CO2-, H2O-, and halogen-bearing melts', 'CO₂-, H₂O-, and halogen-bearing melts'], ['Ca2+- and Mg2+-rich', 'Ca²⁺- and Mg²⁺-rich'],
  ['NO3- and NH4+-N', 'NO₃⁻ and NH₄⁺-N'], ['Mg- and Fe-rich', 'Mg- and Fe-rich']]);
same('A3 not charges', ['HIV+', 'HPV+', 'O+', 'Rh+', 'CK7+', 'CK20−', 'HPV16+', 'HLA-B27+', 'S100+', 'B220+', 'K5+', 'CK7+/CK20− carcinoma', 'HIV+ patients',
  'O+ blood', 'Rh+ mothers', 'K14+ cells', 'B1+ mapping', 'C3+', 'C++ and B+ trees', 'CD4+ T cells', 'HCV+ and HBV+']);
conv('A3 ions', [['Fe3+', 'Fe³⁺'], ['Ca2+', 'Ca²⁺'], ['Na+', 'Na⁺'], ['K+', 'K⁺'], ['Cl−', 'Cl⁻'], ['O2−', 'O²⁻'], ['H+', 'H⁺'], ['NH4+', 'NH₄⁺'], ['SO42−', 'SO₄²⁻'],
  ['NO3−', 'NO₃⁻'], ['[Fe(CN)6]3−', '[Fe(CN)₆]³⁻'], ['[Si(OH)5]1−', '[Si(OH)₅]¹⁻'], ['H3O+', 'H₃O⁺'], ['C60+', 'C₆₀⁺'], ['H2+', 'H₂⁺'], ['N2+', 'N₂⁺'],
  ['OH−', 'OH⁻'], ['Cu(NH3)42+', 'Cu(NH₃)₄²⁺'], ['Cr2O72−', 'Cr₂O₇²⁻'], ['U6+', 'U⁶⁺'], ['Cr6+', 'Cr⁶⁺'], ['Fe++', 'Fe⁺⁺'], ['O22−', 'O₂²⁻'],
  ['Na+/K+-ATPase', 'Na⁺/K⁺-ATPase'], ['Ca2+, NH4+, SO42− and NO3− in rain', 'Ca²⁺, NH₄⁺, SO₄²⁻ and NO₃⁻ in rain'], ['Na+ K+', 'Na⁺ K⁺']]);

// A4 dashes, plus, @, hydrates, ratios, qualifiers
conv('A4', [['CaO–Al2O3–SiO2', 'CaO–Al₂O₃–SiO₂'], ['Na2O–MgO–Al2O3–SiO2–H2O', 'Na₂O–MgO–Al₂O₃–SiO₂–H₂O'], ['Fe2+–Fe3+', 'Fe²⁺–Fe³⁺'],
  ['40Ar–39Ar', '⁴⁰Ar–³⁹Ar'], ['40Ar-39Ar', '⁴⁰Ar-³⁹Ar'], ['CaCO3—CO2—H2O', 'CaCO₃—CO₂—H₂O'], ['H2O+CO2', 'H₂O+CO₂'], ['H2O/(H2O+CO2)', 'H₂O/(H₂O+CO₂)'],
  ['Fe3+/(Fe3++Fe2+)', 'Fe³⁺/(Fe³⁺+Fe²⁺)'], ['δ88/86Sr', 'δ⁸⁸/⁸⁶Sr'], ['δ238/235U', 'δ²³⁸/²³⁵U'], ['87Sr/86Sr(i)', '⁸⁷Sr/⁸⁶Sr(i)'],
  ['CaSO4·0.5H2O', 'CaSO₄·0.5H₂O'], ['Fe3O4@SiO2', 'Fe₃O₄@SiO₂'], ['TiO2(110)', 'TiO₂(110)'], ['δ13Corg', 'δ¹³Corg'], ['δ18Osw', 'δ¹⁸Osw'],
  ['δ34Spy', 'δ³⁴Spy'], ['δ15Nbulk', 'δ¹⁵Nbulk'], ['(87Sr/86Sr)i', '(⁸⁷Sr/⁸⁶Sr)i']]);
same('A4 plain', ['Si(111)', 'Au(111)', 'Fe(II)/Fe(III)', 'Mg/(Mg+Fe)', '(Y+REE)-phosphate', 'Na+K+-ATPase', 'U-Pb and U–Pb', 'Fe(0)', '5Hz', 'δD']);

// B markup
const T = (raw, extra) => A.normalize(Object.assign({ type: 'journal-article', title: [raw], author: [{ family: 'Smith', given: 'J' }], issued: { 'date-parts': [[2020]] }, 'container-title': ['J. Chem.'], volume: '1', page: '1-2', DOI: '10.1/x' }, extra || {}));
eq('B open', A.titleHtml(T('Fe<sub>2O3 films')), 'Fe<sub>2</sub>O<sub>3</sub> films');
eq('B close', A.titleHtml(T('Fe2</sub>O3 films')), 'Fe<sub>2</sub>O<sub>3</sub> films');
eq('B unbal i', A.titleHtml(T('<i>Homo sapiens bones')), 'Homo sapiens bones');
eq('B unbal i bibtex', A.format(T('Homo sapiens</i> bones'), 'bibtex').split('\n')[1], '  title = {Homo sapiens bones},');
eq('B nesting', A.titleHtml(T('<i>E. coli<sub>K</sub></i> strain')), '<i>E. coli<sub>K</sub></i> strain');
eq('B crossed', A.titleHtml(T('<i>a<sub>b</i>c</sub> d')), 'a<sub>bc</sub> d');
eq('B pua input', A.titleText(T('Title with x CO2')), 'Title with x CO₂');
eq('B pua entity', A.titleText(T('A &#57344;B&#57345; C')), 'A B C');
eq('B newline sub', A.titleText(T('Ab initio structure of MgSiO\n                    <sub>3</sub>\n                    ilmenite')), 'Ab initio structure of MgSiO₃ ilmenite');
eq('B newline sup iso', A.titleText(T('Influence of hydration on\n   <sup>23</sup>\n   Na,\n   <sup>27</sup>\n   Al, and\n   <sup>29</sup>\n   Si MAS-NMR')), 'Influence of hydration on ²³Na, ²⁷Al, and ²⁹Si MAS-NMR');
eq('B newline sup power', A.titleText(T('a 2 × 2 × 40 μm\n   <sup>3</sup>\n   crystal')), 'a 2 × 2 × 40 μm³ crystal');
eq('B newline plain', A.titleText(T('reform<sup>1</sup> now')), 'reform¹ now');
eq('B entities', A.titleText(T('&delta;18O and &Delta;17O and &epsilon;Nd and &alpha;-&beta; &gamma; &mu;m')), 'δ¹⁸O and Δ¹⁷O and εNd and α-β γ μm');
eq('B numeric', A.titleText(T('&#948;18O and &#x3B4;13C')), 'δ¹⁸O and δ¹³C');
eq('B double-encoded', A.titleText(T('&amp;delta;18O &amp;amp; more')), 'δ¹⁸O & more');
eq('B clean entity', A.normalize({ title: ['x'], 'container-title': ['Geochim. &delta; &#916;'] }).container, 'Geochim. δ Δ');
eq('B mprescripts', A.titleHtml(T('<mml:math><mml:mmultiscripts><mml:mi>C</mml:mi><mml:mprescripts/><mml:none/><mml:mn>13</mml:mn></mml:mmultiscripts></mml:math> NMR')), '<sup>13</sup>C NMR');
eq('B mml no prefix', A.titleText(T('<math><msub><mi>Fe</mi><mn>2</mn></msub></math> films')), 'Fe₂ films');
eq('B mml post+pre', A.titleHtml(T('<math><mmultiscripts><mi>U</mi><none/><mo>+</mo><mprescripts/><none/><mn>235</mn></mmultiscripts></math>')), '<sup>235</sup>U<sup>+</sup>');
eq('B mml nested', A.titleText(T('<mml:math><mml:msub><mml:msub><mml:mi>X</mml:mi><mml:mn>a</mml:mn></mml:msub><mml:mn>2</mml:mn></mml:msub></mml:math> test')), 'Xa₂ test');

// C transferMarks
const base = T('Growth of Fe<sub>2</sub>O<sub>3</sub> in <i>Escherichia coli</i> Cultures');
eq('C sentence', A.titleHtml(Object.assign({}, base, { title: 'Growth of fe2o3 in escherichia coli cultures' })), 'Growth of fe<sub>2</sub>o<sub>3</sub> in <i>escherichia coli</i> cultures');
eq('C different', A.titleHtml(Object.assign({}, base, { title: 'Growth of Fe2O3 in E. coli cultures' })), 'Growth of Fe<sub>2</sub>O<sub>3</sub> in E. coli cultures');
const b2 = T('Straße <i>Homo</i> CO<sub>2</sub>');
eq('C sharp s', A.titleHtml(Object.assign({}, b2, { title: 'STRASSE HOMO CO2' })), 'STRASSE <i>HOMO</i> CO<sub>2</sub>');
const b3 = T('İzmir <i>Homo</i> CO<sub>2</sub>');
eq('C dotted I', A.titleHtml(Object.assign({}, b3, { title: 'i̇zmir homo co2' })), 'i̇zmir <i>homo</i> co<sub>2</sub>');
eq('C dotted I plain i', A.titleHtml(Object.assign({}, b3, { title: 'izmir homo co2' })), 'izmir homo co2');

// D ISBN
eq('D phone+isbn', A.extractIsbn('Tel. 0 800 123 4567, ISBN 978-0-521-88068-8'), '9780521880688');
eq('D pages', A.extractIsbn('Geology 10 1042-1050'), null);
eq('D prefixed 10', A.extractIsbn('ISBN 0521387078'), '0521387078');
eq('D prefixed 13', A.extractIsbn('Cambridge UP. ISBN-13: 978-0-521-38707-1.'), '9780521387071');
eq('D bare 10 in text', A.extractIsbn('Cambridge University Press 0521387078 pages'), null);
eq('D bare 10 whole input', A.extractIsbn('0521387078'), '0521387078');
eq('D hyphenated 10', A.extractIsbn('Cambridge, 0-521-38707-8.'), '0521387078');
eq('D bare 13', A.extractIsbn('Cambridge 9780521880688'), '9780521880688');
eq('D pp. 13', A.extractIsbn('pp. 978-0-521-88068-8'), null);
eq('D bad checksum', A.extractIsbn('ISBN 978-0-521-88068-9'), null);
eq('D prefer prefix', A.extractIsbn('0-521-38707-8 or ISBN 978-0-521-88068-8'), '9780521880688');

// E splitName
const sn = (n) => JSON.stringify(A.splitName(n));
eq('E Y', sn('Wei-Ping Y Zhang'), JSON.stringify({ family: 'Zhang', given: 'Wei-Ping Y' }));
eq('E Jr', sn('Martin Luther King Jr.'), JSON.stringify({ family: 'King', given: 'Martin Luther', suffix: 'Jr.' }));
eq('E , Jr', sn('Martin Luther King, Jr.'), JSON.stringify({ family: 'King', given: 'Martin Luther', suffix: 'Jr.' }));
eq('E III', sn('John Smith III'), JSON.stringify({ family: 'Smith', given: 'John', suffix: 'III' }));
eq('E van', sn('Ludwig van Beethoven'), JSON.stringify({ family: 'van Beethoven', given: 'Ludwig' }));
eq('E De capital', sn('Juan De Cruz'), JSON.stringify({ family: 'Cruz', given: 'Juan De' }));
eq('E comma', sn('van der Walt, Stéfan'), JSON.stringify({ family: 'van der Walt', given: 'Stéfan' }));
const oa = A.normalize(A.fromOpenAlex({ type: 'article', title: 'X', authorships: [{ author: { display_name: 'Martin Luther King Jr.' } }], publication_year: 1960 }));
eq('E openalex suffix', A.format(oa, 'apa').slice(0, 22), 'King, M. L., Jr. (1960');
const ol = A.normalize(A.fromOpenLibrary({ title: 'Why', author_name: ['John Smith III'], first_publish_year: 1999, publisher: ['P'] }, '0521387078'));
eq('E openlibrary suffix', ol.authors[0].suffix, 'III');

// F robustness
const bad = A.normalize({ type: 'journal-article', title: ['T'], author: [{ family: 'A', given: 'B' }], issued: { 'date-parts': [[2020, 13, 40]] }, 'container-title': ['J'] });
eq('F month clamp', bad.month + '/' + bad.day, '0/0');
const bad2 = A.normalize({ type: 'journal-article', title: ['T'], issued: { 'date-parts': [[2020, 5, 40]] } });
eq('F day clamp', bad2.month + '/' + bad2.day, '5/0');
const raw13 = Object.assign({}, bad, { month: 13, day: 45 });
['apa', 'mla', 'chicago', 'harvard', 'vancouver', 'ieee', 'carnegie', 'bibtex', 'ris', 'endnote'].forEach(st => {
  let out; try { out = A.format(raw13, st); } catch (e) { out = 'THROW ' + e.message; }
  eq('F no undefined ' + st, /undefined|THROW/.test(out), false);
});
eq('F bibtex month', /month/.test(A.format(raw13, 'bibtex')), false);
eq('F ris DA', A.format(raw13, 'ris').split('\r\n').filter(l => /^DA/.test(l))[0], 'DA  - 2020///');
const web = A.normalize({ type: 'dataset', title: ['D'], issued: { 'date-parts': [[2020]] }, accessed: { 'date-parts': [[2021, 14, 3]] }, URL: 'http://x' });
eq('F carnegie accessed', A.format(web, 'carnegie'), '2020. D [cited 2021]. Available from http://x');
const nd = A.normalize({ type: 'journal-article', title: ['T'], author: [{ family: 'A', given: 'B' }], 'container-title': ['J'] });
eq('F carnegie n.d.', A.format(nd, 'carnegie'), 'A, B. n.d. T. J.');
const ch = A.normalize({ type: 'book-chapter', title: ['Chap'], author: [{ family: 'A', given: 'B' }], issued: { 'date-parts': [[2000]] }, publisher: 'Pub', page: '5-9' });
eq('F apa', A.format(ch, 'apa'), 'A, B. (2000). Chap. pp. 5–9. Pub.');
eq('F chicago', A.format(ch, 'chicago'), 'A, B. “Chap.” 5–9. Pub, 2000.');
eq('F harvard', A.format(ch, 'harvard'), 'A, B. (2000) ‘Chap’. Pub, pp. 5–9.');
eq('F ieee', A.format(ch, 'ieee'), 'B. A, “Chap,” Pub, 2000, pp. 5–9.');
eq('F mla', A.format(ch, 'mla'), 'A, B. “Chap.” Pub, 2000, pp. 5–9.');
eq('F vancouver', A.format(ch, 'vancouver'), 'A B. Chap. Pub; 2000. p. 5-9.');
eq('F carnegie', A.format(ch, 'carnegie'), 'A, B. 2000. Chap. Pp. 5-9. Pub.');
['apa', 'chicago', 'harvard', 'ieee', 'mla', 'vancouver', 'carnegie'].forEach(st => {
  const out = A.format(Object.assign({}, ch, { type: 'proceedings-article', pages: '' }), st);
  eq('F no "In ." ' + st, /\bIn:? ?\.|\bin \.|In ,/.test(out), false);
});
const withC = A.normalize({ type: 'book-chapter', title: ['Chap'], author: [{ family: 'A', given: 'B' }], issued: { 'date-parts': [[2000]] }, 'container-title': ['Book'], publisher: 'Pub', page: '5-9' });
eq('F apa with container', A.format(withC, 'apa'), 'A, B. (2000). Chap. In Book (pp. 5–9). Pub.');
eq('F ieee with container', A.format(withC, 'ieee'), 'B. A, “Chap,” in Book. Pub, 2000, pp. 5–9.');
const org = A.normalize({ type: 'software', title: ['The Turing Way'], author: [{ family: 'Community', given: 'The Turing Way' }], issued: { 'date-parts': [[2022]] }, publisher: 'Zenodo', DOI: '10.5281/zenodo.1' });
eq('F org apa', A.format(org, 'apa'), 'The Turing Way Community. (2022). The Turing Way [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.1');
eq('F org bibtex', A.format(org, 'bibtex').split('\n')[2], '  author = {{The Turing Way Community}},');
const org2 = A.normalize({ type: 'dataset', title: ['X'], author: [{ family: 'Collaboration', given: 'Planck' }], issued: { 'date-parts': [[2018]] } });
eq('F org collab', org2.authors[0].family + '|' + org2.authors[0].literal, 'Planck Collaboration|true');
const person = A.normalize({ type: 'dataset', title: ['X'], author: [{ family: 'Theron', given: 'Charlize' }], issued: { 'date-parts': [[2018]] } });
eq('F person untouched', person.authors[0].literal, false);

eq('a footnote number set in superscript after a DOI is not part of it', A.extractDoi('https://doi.org/10.1038/nature12373² and'), '10.1038/nature12373');
eq('a superscripted link is still a DOI', A.extractDoi('https://doi.org/10.1038/nature12373⁷⁸'), '10.1038/nature12373');
console.log(pass + ' passed, ' + fail + ' failed');
