var ROOT = require('path').resolve(__dirname, '..');
var FIX = require('path').join(__dirname, 'fixtures');
const A = require(require('path').join(ROOT, 'citations.js'));
let pass = 0, fail = 0;
const eq = (label, got, exp) => { if (got === exp) pass++; else { fail++; console.log('FAIL', label, '\n   got ', got, '\n   want', exp); } };
const f = A.autoFormulas;
// must convert
eq('olivine', f('Numerical modelling of dislocation core properties in olivine (Mg2SiO4)'), 'Numerical modelling of dislocation core properties in olivine (Mg₂SiO₄)');
eq('calcite', f('Replacement of Calcite (CaCO3) by Cerussite (PbCO3)'), 'Replacement of Calcite (CaCO₃) by Cerussite (PbCO₃)');
eq('Fe3+', f('Fe3+ Distribution and Fe3+/ΣFe-Oxygen Fugacity Variations'), 'Fe³⁺ Distribution and Fe³⁺/ΣFe-Oxygen Fugacity Variations');
eq('kimzeyite', f('The [4]Fe3+-O distance in synthetic kimzeyite garnet, Ca3Zr2[Fe2SiO12]'), 'The [⁴]Fe³⁺-O distance in synthetic kimzeyite garnet, Ca₃Zr₂[Fe₂SiO₁₂]');
eq('ArAr', f('40Ar/39Ar Dating of the Late Cretaceous'), '⁴⁰Ar/³⁹Ar Dating of the Late Cretaceous');
eq('SrSr', f('Intra- and Intertree Variability of the 87Sr/86Sr Ratio'), 'Intra- and Intertree Variability of the ⁸⁷Sr/⁸⁶Sr Ratio');
eq('delta', f('Daily rainfall δ18O suggests speleothem 18O records'), 'Daily rainfall δ¹⁸O suggests speleothem ¹⁸O records');
eq('perovskite space', f('A New Evidence of the Stability of (Mg, Fe)SiO3 Perovskite'), 'A New Evidence of the Stability of (Mg, Fe)SiO₃ Perovskite');
eq('perovskite hyphen', f('(Mg,Fe)SiO3-Perovskite Stability'), '(Mg,Fe)SiO₃-Perovskite Stability');
eq('water', f('H2O and CO2 in nominally anhydrous minerals'), 'H₂O and CO₂ in nominally anhydrous minerals');
eq('ions', f('Ca2+, NH4+, SO42− and NO3− in rain'), 'Ca²⁺, NH₄⁺, SO₄²⁻ and NO₃⁻ in rain');
eq('hydrate', f('Gypsum CaSO4·2H2O dehydration'), 'Gypsum CaSO₄·2H₂O dehydration');
eq('solid solution', f('Mg0.9Fe0.1SiO3 at high pressure'), 'Mg₀.₉Fe₀.₁SiO₃ at high pressure');
eq('Fe2+-bearing', f('Fe2+-bearing and SiO2-rich melts'), 'Fe²⁺-bearing and SiO₂-rich melts');
eq('oxide ion', f('O2- diffusion'), 'O²⁻ diffusion');
eq('alloy', f('Ti6Al4V fatigue'), 'Ti₆Al₄V fatigue');
eq('He', f('3He/4He in mantle xenoliths and 10Be ages'), '³He/⁴He in mantle xenoliths and ¹⁰Be ages');
eq('sulfur', f('δ34S of pyrite'), 'δ³⁴S of pyrite');
eq('ratio spaces', f('errors in 40Ar / 39Ar Dating'), 'errors in ⁴⁰Ar / ³⁹Ar Dating');
// must NOT convert
const same = ['H1N1 and H3N2 influenza', 'Vitamin B12 deficiency', '16S rRNA and 40S subunits', '4K video and 3D models', 'Mg- and Fe-rich pyroxenes',
  'IPCC5 and W3C and ISO9001', 'HIV-1 and COVID-19 in 2020', 'CD4+ T cells', 'C++ and B+ trees', 'The Fe(III) oxidation state', 'U-Pb and U–Pb zircon ages',
  'km2 and cm3 per year', 'NASA and USGS and NOAA', 'Part II, Chapter 3', 'P53 and TP53 and IL6', 'The 2016 IEEE Conference (CVPR)', 'Sentinel-2 and Landsat 8',
  'https://doi.org/10.1016/S0016-7037(02)01188-X', 'Nature Science Cell', 'A Structure for Deoxyribose Nucleic Acid'];
same.forEach(t => eq('same: ' + t, f(t), t));
// deposited markup, MathML, italics, sentence-case transfer
const dep = A.normalize({ type: 'journal-article', title: ['Basalt Dissolution under P<sub>CO2</sub> in <i>Tyrannosaurus rex</i> Bone?'], author: [{ family: 'A', given: 'B' }], issued: { 'date-parts': [[2024]] }, 'container-title': ['Goldschmidt'], DOI: '10.1/x' });
eq('deposited plain', A.format(dep, 'apa'), 'A, B. (2024). Basalt Dissolution under PCO₂ in Tyrannosaurus rex Bone? Goldschmidt. https://doi.org/10.1/x');
eq('deposited html', A.formatHtml(dep, 'apa'), 'A, B. (2024). Basalt Dissolution under P<sub>CO2</sub> in <i>Tyrannosaurus rex</i> Bone? <i>Goldschmidt</i>. https://doi.org/10.1/x');
const cased = Object.assign({}, dep, { title: 'Basalt dissolution under PCO2 in Tyrannosaurus rex bone?' });
eq('cased transfer', A.formatHtml(cased, 'apa').slice(0, 94), 'A, B. (2024). Basalt dissolution under P<sub>CO2</sub> in <i>Tyrannosaurus rex</i> bone? <i>Go');
const mml = A.normalize({ type: 'journal-article', title: ['Growth of <mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML"><mml:msub><mml:mi>Fe</mml:mi><mml:mn>2</mml:mn></mml:msub><mml:msub><mml:mi mathvariant="normal">O</mml:mi><mml:mn>3</mml:mn></mml:msub></mml:math> films'], issued: { 'date-parts': [[2020]] } });
eq('mathml', A.titleText(mml), 'Growth of Fe₂O₃ films');
const book = A.normalize({ type: 'book', title: ['Carbonates CaCO3 of the World?'], author: [{ family: 'A', given: 'B' }], issued: { 'date-parts': [[2000]] }, publisher: 'P' });
eq('italic book title', A.formatHtml(book, 'apa'), 'A, B. (2000). <i>Carbonates CaCO<sub>3</sub> of the World?</i> P.');
const jr = A.normalize({ type: 'journal-article', title: ['Fe3+ in garnet'], author: [{ family: 'A', given: 'B' }], issued: { 'date-parts': [[2000]] }, 'container-title': ['American Mineralogist'], volume: '85', page: '1-2' });
eq('bibtex', A.format(jr, 'bibtex').split('\n')[1], '  title = {Fe\\textsuperscript{3+} in garnet},');
eq('ris', A.format(jr, 'ris').split('\r\n')[2], 'TI  - Fe³⁺ in garnet');
eq('carnegie', A.format(jr, 'carnegie'), 'A, B. 2000. Fe³⁺ in garnet. American Mineralogist, 85:1-2.');
A.options.formulas = false; eq('option off', A.format(jr, 'carnegie'), 'A, B. 2000. Fe3+ in garnet. American Mineralogist, 85:1-2.'); A.options.formulas = true;
eq('match ignores', A.matchConfidence('A B 2000 Fe3+ in garnet', jr, { titleOnly: true }), 1);
eq('placeholder dot', f('Zn4Si2O7(OH)2·H2O'), 'Zn₄Si₂O₇(OH)₂·H₂O');
eq('in-formula charge', f('Fe3+2(H2O)4[O(SO4)2]'), 'Fe³⁺₂(H₂O)₄[O(SO₄)₂]');
eq('almandine', f('Almandine Fe2+3Al2Si3O12'), 'Almandine Fe²⁺₃Al₂Si₃O₁₂');
['C3+C4 photosynthesis', 'H2+H2O mixtures', 'Ca2+Mg2+ ratio', 'CD4+CD25+ T cells'].forEach(t => eq('same: ' + t, f(t), t));
eq('middle dot placeholder', A.titleText(A.normalize({ title: ['Zn4Si2O7(OH)2{middle dot}H2O'] })), 'Zn₄Si₂O₇(OH)₂·H₂O');
// IMA-style mineral formulas: an oxidation state right before the next element, not a sum
[['Ca19Fe2+Al4(Al7Fe2+)(SiO4)10(Si2O7)4O(OH)9', 'Ca₁₉Fe²⁺Al₄(Al₇Fe²⁺)(SiO₄)₁₀(Si₂O₇)₄O(OH)₉'], ['KFe2+Fe3+(SO4)2', 'KFe²⁺Fe³⁺(SO₄)₂'], ['Mn2+Fe3+2O4', 'Mn²⁺Fe³⁺₂O₄'], ['Fe2+Mn2+Mg2+ occupancy', 'Fe2+Mn2+Mg2+ occupancy'], ['Fe2+Al3+Si4+', 'Fe2+Al3+Si4+'], ['Ca2+Mg2+Fe2+ site', 'Ca2+Mg2+Fe2+ site'], ['Ca2+Mg2+ ratio', 'Ca2+Mg2+ ratio'], ['Na+K feldspar', 'Na+K feldspar'],
 ['CO2+H2O', 'CO₂+H₂O'], ['(CO2+ H2O + NaCl)', '(CO₂+ H₂O + NaCl)'], ['Fe2+-bearing olivine', 'Fe²⁺-bearing olivine']].forEach(function (c) {
  var got = A.autoFormulas(c[0]); if (got === c[1]) pass++; else { fail++; console.log('FAIL ima charge ' + c[0] + '\n   got  ' + got + '\n   want ' + c[1]); }
});
console.log(pass + ' passed, ' + fail + ' failed');
