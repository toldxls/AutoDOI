var ROOT = require('path').resolve(__dirname, '..');
var FIX = require('path').join(__dirname, 'fixtures');
// Tests for sentencecase.js
var path = require('path');
var WORDS = require(path.join(ROOT, 'data', 'common-words.js'));
var C = require(path.join(ROOT, 'sentencecase.js'));

var pass = 0, fail = 0;
function eq(label, got, want) {
  if (got === want) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n         got:  ' + JSON.stringify(got) + '\n         want: ' + JSON.stringify(want)); }
}
function sc(title, opts) {
  var o = Object.assign({ words: WORDS }, opts || {});
  return C.toSentenceCase(title, o);
}
function tc(title, opts) {
  return C.toTitleCase(title, Object.assign({ words: WORDS }, opts || {})).text;
}

console.log('toSentenceCase (required cases)');
var required = [
  ['Nanometre-Scale Thermometry in a Living Cell', 'Nanometre-scale thermometry in a living cell'],
  ['A New Species of Tyrannosaurus From the Late Cretaceous Hell Creek Formation of Montana', 'A new species of Tyrannosaurus from the Late Cretaceous Hell Creek Formation of Montana'],
  ['Ecological Momentary Interventions for Mental Health: A Scoping Review', 'Ecological momentary interventions for mental health: A scoping review'],
  ['Array Programming With NumPy', 'Array programming with NumPy'],
  ['Clinical Features of Patients Infected With 2019 Novel Coronavirus in Wuhan, China', 'Clinical features of patients infected with 2019 novel coronavirus in Wuhan, China'],
  ['DNA Repair in Escherichia coli and Other Bacteria', 'DNA repair in Escherichia coli and other bacteria'],
  ['The Rise of Placental Mammals', 'The rise of placental mammals'],
  ['Deep Residual Learning for Image Recognition', 'Deep residual learning for image recognition'],
  ['Insectivoran-Grade Placentals', 'Insectivoran-grade placentals'],
  ['pH-Dependent Folding of mRNA', 'pH-dependent folding of mRNA']
];
required.forEach(function (c) { eq(c[0], sc(c[0]).text, c[1]); });

console.log('toSentenceCase (additional behaviour)');
eq('all-common run lowercased', sc('Effects Of The New').text, 'Effects of the new');
eq('Early-Middle Jurassic protected by unknown', sc('Early-Middle Jurassic Dinosaurs of Europe').text, 'Early-Middle Jurassic dinosaurs of Europe'); // APA fix: common noun lowercased
eq('Cross-Sectional lowercased', sc('A Cross-Sectional Study').text, 'A cross-sectional study');
eq('protect set keeps run', sc('Fossils From The Morrison Formation', { protect: new Set(['Morrison']) }).text, 'Fossils from the Morrison Formation');
eq('protect as string', sc('Study Of The Reading Basin', { protect: 'Reading' }).text, 'Study of the Reading Basin');
eq('without protect Reading Basin kept via X + Basin rule', sc('Study Of The Reading Basin').text, 'Study of the Reading Basin'); // APA fix
eq('genus species pair', sc('Growth Rates In Tyrannosaurus rex And Allosaurus fragilis').text, 'Growth rates in Tyrannosaurus rex and Allosaurus fragilis');
eq('New Zealand kept via run rule', sc('Birds Of New Zealand And Australia').text, 'Birds of New Zealand and Australia');
eq('all-caps and mixed-case kept', sc('NaCl And DNA Studies With USA Samples').text, 'NaCl and DNA studies with USA samples');
eq('digits kept', sc('The 3D Structure Of COVID-19 Proteins').text, 'The 3D structure of COVID-19 proteins');
eq('question mark subtitle', sc('Are Birds Dinosaurs? A Review').text, 'Are birds dinosaurs? A review');
eq('em dash subtitle', sc('Museum Collections — A Global Resource').text, 'Museum collections — A global resource');
eq('parenthesis start kept', sc('Fossil Insects (A Review) Of Amber').text, 'Fossil insects (a review) of amber'); // APA fix: ( is not a sentence start
eq('quoted text left alone', sc('Comment On "Deep Learning For Fossils"').text, 'Comment on "Deep Learning For Fossils"');
eq('lowercase first word capitalised', sc('a structure for deoxyribose nucleic acid').text, 'A structure for deoxyribose nucleic acid');
eq('already sentence case unchanged', sc('A new species of Tyrannosaurus from Montana').text, 'A new species of Tyrannosaurus from Montana');
eq('chemical symbol kept', sc('Isotopes Of Sr And Pb In Zircon').text, 'Isotopes of Sr and Pb in zircon');
eq('periods kept (Late Triassic)', sc('Vertebrates Of The Late Triassic').text, 'Vertebrates of the Late Triassic');
eq('month kept', sc('Storms In March And May').text, 'Storms in March and May');
eq('country kept', sc('Fossils From Turkey And China').text, 'Fossils from Turkey and China');
eq('first word does not anchor a run', sc('Ceratopsian Dinosaurs, Horns And Frills').text, 'Ceratopsian dinosaurs, horns and frills');
eq('comma breaks run', sc('Dinosaurs Of Montana, Horns And Frills').text, 'Dinosaurs of Montana, horns and frills');
eq('protected first word anchors run', sc('Morrison Formation Dinosaurs Of Wyoming', { protect: ['Morrison'] }).text, 'Morrison Formation dinosaurs of Wyoming'); // APA fix
eq('unprotected first word does not anchor', sc('Morrison Formation Dinosaurs Of Wyoming').text, 'Morrison Formation dinosaurs of Wyoming'); // APA fix: unknown first word anchors head noun
eq('hyphen parts in anchored run kept', sc('Upper-Lower Jurassic Boundary').text, 'Upper-Lower Jurassic boundary'); // APA fix
eq('non-avian', sc('Non-Avian Dinosaurs Of Asia').text, 'Non-avian dinosaurs of Asia');
eq('possessive', sc("Darwin's Finches And Their Beaks").text, "Darwin's finches and their beaks");
eq('empty string', sc('').text, '');

console.log('tokens');
var r = sc('Deep Residual Learning for Image Recognition');
eq('token count', r.tokens.length, 11);
eq('token kinds', r.tokens.map(function (t) { return t.kind; }).join(','), 'word,space,word,space,word,space,word,space,word,space,word');
eq('changed flags', r.tokens.filter(function (t) { return t.changed; }).map(function (t) { return t.text; }).join(' '), 'residual learning image recognition');
eq('tokens rejoin to text', r.tokens.map(function (t) { return t.text; }).join(''), r.text);
var r2 = sc('Mental Health: A Scoping Review');
eq('punct token', r2.tokens.filter(function (t) { return t.kind === 'punct'; }).map(function (t) { return t.text; }).join(''), ':');

console.log('toTitleCase');
eq('round trip 1', tc('Deep residual learning for image recognition'), 'Deep Residual Learning for Image Recognition');
eq('round trip 2', tc('a structure for deoxyribose nucleic acid'), 'A Structure for Deoxyribose Nucleic Acid');
eq('subtitle after colon', tc('mental health: a scoping review'), 'Mental Health: A Scoping Review');
eq('last word capitalised', tc('what are we waiting for'), 'What Are We Waiting For');
eq('hyphen both parts', tc('nanometre-scale thermometry in a living cell'), 'Nanometre-Scale Thermometry in a Living Cell');
eq('mixed case kept', tc('pH-dependent folding of mRNA'), 'PH-Dependent Folding of mRNA'.replace('PH-', 'pH-'));
// expectation updated: species epithets stay lowercase in headline style (APA/Chicago/MLA)
eq('all caps kept; species epithet lowercase', tc('DNA repair in Escherichia coli'), 'DNA Repair in Escherichia coli');
eq('protect untouched', tc('DNA repair in Escherichia coli', { protect: new Set(['coli']) }), 'DNA Repair in Escherichia Coli'.replace('Coli', 'coli'));
eq('capitalised small word lowered', tc('Deep Learning For Image Recognition'), 'Deep Learning for Image Recognition');
eq('verbs and pronouns capitalised (headline style)', tc('why is this new'), 'Why Is This New');

console.log('detectCase');
eq('title', C.detectCase('Deep Residual Learning for Image Recognition'), 'title');
eq('sentence', C.detectCase('Deep residual learning for image recognition'), 'sentence');
eq('upper', C.detectCase('DEEP RESIDUAL LEARNING'), 'upper');
eq('sentence with proper nouns (with word list)', C.detectCase('A new species of Tyrannosaurus from the Late Cretaceous Hell Creek Formation of Montana', { words: WORDS }), 'sentence'); // spec item 8
eq('title with proper nouns', C.detectCase('A New Species of Tyrannosaurus From the Late Cretaceous Hell Creek Formation of Montana', { words: WORDS }), 'title');
eq('short sentence', C.detectCase('Array programming with NumPy', { words: WORDS }), 'sentence');
eq('short title', C.detectCase('Array Programming With NumPy', { words: WORDS }), 'title');

console.log('wordsFrom');
var s1 = C.wordsFrom(WORDS), s2 = C.wordsFrom(WORDS);
eq('cached', s1 === s2, true);
eq('has word', s1.has('thermometry'), true);
eq('lacks Cretaceous', s1.has('cretaceous'), false);
eq('isCommon stems', C.isCommon('Placentals', WORDS) && C.isCommon('Scoping', WORDS) && C.isCommon('Mammals', WORDS), true);
eq('isCommon rejects unknown', C.isCommon('Tyrannosaurus', WORDS), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
