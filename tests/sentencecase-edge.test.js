var ROOT = require('path').resolve(__dirname, '..');
var FIX = require('path').join(__dirname, 'fixtures');
// Tests for the sentencecase.js bug fixes (items 1-10). Run: node fix-case-test.js
var path = require('path');
var WORDS = require(path.join(ROOT, 'data', 'common-words.js'));
var C = require(path.join(ROOT, 'sentencecase.js'));
var pass = 0, fail = 0;
function eq(label, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.log('  FAIL ' + label + '\n         got:  ' + JSON.stringify(got) + '\n         want: ' + JSON.stringify(want)); }
}
function sc(t, o) { return C.toSentenceCase(t, Object.assign({ words: WORDS }, o || {})).text; }
function S(t, want, o) { var r = sc(t, o); eq(t, r, want); eq('idempotent: ' + t, sc(r, o), r); }
function tc(t, o) { return C.toTitleCase(t, Object.assign({ words: WORDS }, o || {})).text; }
function det(t) { return C.detectCase(t, { words: WORDS }); }

console.log('1. plural stripping / proper plurals');
S('The Andes Uplift', 'The Andes uplift');
S('Fossils From Paris And Wales', 'Fossils from Paris and Wales');
S('Glaciers Of The Alps', 'Glaciers of the Alps');
S('The Pyrenees And The Cascades', 'The Pyrenees and the Cascades');
S('Studies Of The Rockies And Highlands', 'Studies of the Rockies and Highlands');
S('Sherlock Holmes And Science', 'Sherlock Holmes and science');
S('Barnes And Hayes On Rocks', 'Barnes and Hayes on rocks');
S('Joseph Banks And The Endeavour', 'Joseph Banks and the Endeavour');
S('H. G. Wells On Evolution', 'H. G. Wells on evolution');
S('Magnetic Fields In Coastal Waters', 'Magnetic fields in coastal waters');   // ambiguous plurals stay common
S('Noble Gases And Glasses', 'Noble gases and glasses');                         // -es stems still work
eq('isCommon Andes', C.isCommon('Andes', WORDS), false);
eq('isCommon Paris', C.isCommon('Paris', WORDS), false);
eq('isCommon Wales', C.isCommon('Wales', WORDS), false);
eq('isCommon maps', C.isCommon('Maps', WORDS), true);
eq('isCommon gases', C.isCommon('Gases', WORDS), true);

console.log('2. unknown first word anchors name heads; head-noun logic; phrases');
S('Pacific Ocean Circulation', 'Pacific Ocean circulation');
S('Deccan Traps Volcanism', 'Deccan Traps volcanism');
S('Morrison Formation Sauropods', 'Morrison Formation sauropods');
S('Macquarie Island Mapping', 'Macquarie Island mapping');
S('Insectivoran-Grade Placentals', 'Insectivoran-grade placentals');
S('Late Cretaceous Dinosaur Faunas', 'Late Cretaceous dinosaur faunas');
S('Early Jurassic Ammonites Of Europe', 'Early Jurassic ammonites of Europe');
S('Reefs Of The Upper Devonian', 'Reefs of the Upper Devonian');
S('Cretaceous Sea Level Change', 'Cretaceous sea level change');
S('Crustal Shortening Along The Dead Sea Fault System', 'Crustal shortening along the Dead Sea Fault System');
S('Sediments Of The Gulf Of Guinea', 'Sediments of the Gulf of Guinea');
S('Wind Extremes In The North Sea Basin', 'Wind extremes in the North Sea Basin');
S('Rodents From The Great Divide Basin', 'Rodents from the Great Divide Basin');
S('Visitors To The Natural History Museum', 'Visitors to the Natural History Museum');
S('Bulletin Of Carnegie Museum Of Natural History', 'Bulletin of Carnegie Museum of Natural History');
// an "of" name ends after its name word ("Utah", "Mexico"), unless a head or institution word carries it on
S('Gulf Of Mexico Oil Spill Effects On Fish Populations', 'Gulf of Mexico oil spill effects on fish populations');
S('University Of Utah Students Protest Climate Policy', 'University of Utah students protest climate policy');
S('Sea Of Japan Deep Water Formation Rates', 'Sea of Japan deep water formation rates');
S('University Of Utah Press Releases', 'University of Utah Press releases');
S('Museum Of Natural History Specimens', 'Museum of Natural History specimens');
S('Visitors To The Museum Of Comparative Anatomy', 'Visitors to the Museum of Comparative Anatomy');   // no name word: the name runs on
S('Minutes Of The Paleontological Society Council', 'Minutes of the Paleontological Society council');
S('Sharks Of The Western Interior Seaway', 'Sharks of the Western Interior Seaway');
S('Fossils Of The Burgess Shale', 'Fossils of the Burgess Shale');
S('Soils Of The United States', 'Soils of the United States');
S('Images From The Hubble Space Telescope', 'Images from the Hubble Space Telescope');
S('Faunas Of The Mud Hill Locality', 'Faunas of the Mud Hill locality');
S('Dinosaurs Of The Hell Creek Formation', 'Dinosaurs of the Hell Creek Formation');
S('Rifting In The Red Sea', 'Rifting in the Red Sea');
S('Fishes Of The Vale Formation', 'Fishes of the Vale Formation');
S('Fossils From Dinosaur National Monument', 'Fossils from Dinosaur National Monument');
S('Methods For Large Sea Surface Generation', 'Methods for large sea surface generation');
S('Effects Of Rising Sea Levels', 'Effects of rising sea levels');
S('Galactic Star Formation Rates', 'Galactic star formation rates');
S('The Great Plains And The Colorado Plateau', 'The Great Plains and the Colorado Plateau');
S('Mapping The soils of north sea basin', 'Mapping the soils of north sea basin');  // lowercase input is not recased
S('Birds Of New Zealand And South Africa', 'Birds of New Zealand and South Africa');
S('The Upper Jurassic Morrison Formation Of Utah', 'The Upper Jurassic Morrison Formation of Utah');
S('Fossils From The Northern Qilian Mountains', 'Fossils from the Northern Qilian Mountains');
S('Stratigraphy Of The Jurassic System', 'Stratigraphy of the Jurassic System');
S('World War II Geology', 'World War II geology');
S('In Situ Hybridization Of Cells', 'In situ hybridization of cells');

console.log('3. capital article "A"');
S('Towards A Unified Theory', 'Towards a unified theory');
S('Is There A Link?', 'Is there a link?');
S('Vitamin A Deficiency', 'Vitamin A deficiency');
S('Effects Of Type A Personality', 'Effects of type A personality');
S('Part A: The Data', 'Part A: The data');
S('Hepatitis A Virus', 'Hepatitis A virus');
S('As Shown In Figure A', 'As shown in figure A');
S('A Review Of Rocks', 'A review of rocks');

console.log('4. element symbols and units');
S('Pb, As And Cd In Soils', 'Pb, As and Cd in soils');
S('The Role Of As(III) In Arsenic Cycling', 'The role of As(III) in arsenic cycling');
S('Soils With As And Pb', 'Soils with As and Pb');
S('Mo Isotopes As A Redox Proxy', 'Mo isotopes as a redox proxy');
S('Ti In Zircon Thermometry', 'Ti in zircon thermometry');
S('The Pb Isotope Record', 'The Pb isotope record');
S('The Si Cycle', 'The Si cycle');
S('The K-Pg Boundary', 'The K-Pg boundary');
S('Dating 500 Ma Old Rocks', 'Dating 500 Ma old rocks');
S('Noble Gases (He, Ne, Ar) In Basalts', 'Noble gases (He, Ne, Ar) in basalts');
S('There Is No Evidence', 'There is no evidence');

console.log('5. sentence boundaries and brackets');
S('A Review. Part 2. The Results', 'A review. Part 2. The results');
S('Notes On Genera. New Species', 'Notes on genera. New species');
S('Rocks, e.g. Granite And Basalt', 'Rocks, e.g. granite and basalt');
S('Smith et al. Revisited', 'Smith et al. revisited');
S('Mount St. Helens Eruption', 'Mount St. Helens eruption');
S('Dr. Smith And Prof. Brown On Mrs. Green', 'Dr. Smith and Prof. Brown on Mrs. Green');   // honorifics protect the name after them
S('Dr Smith And Mrs Green On Rocks', 'Dr Smith and Mrs Green on rocks');
S('Sir Isaac Newton And The Apple', 'Sir Isaac Newton and the apple');
S('The Work Of J. Smith', 'The work of J. Smith');
S('Effects Of E. Coli And S. Aureus On Growth', 'Effects of E. coli and S. aureus on growth');   // an abbreviated genus is not an initial
S('The Work Of H. G. Wells', 'The work of H. G. Wells');                                         // after a second initial it is a surname
S('Studies By J. Costa And M. Rossi', 'Studies by J. Costa and M. Rossi');
S('Description Of A New Genus, n. gen. Of Crabs', 'Description of a new genus, n. gen. of crabs');
S('Aus Sp. Nov. From Montana', 'Aus sp. nov. from Montana');                    // taxonomic abbreviations are written lowercase
S('Aus Gen. Et Sp. Nov.', 'Aus gen. et sp. nov.');
S('Aus N. Sp. From Texas', 'Aus n. sp. from Texas');
S('Aus Sp. Nov., From Montana', 'Aus sp. nov., from Montana');                  // the stop shares its token with a comma
S('Description Of Aus Comb. Nov. From Spain', 'Description of Aus comb. nov. from Spain');
S('Storms In Nov. And Dec.', 'Storms in Nov. and Dec.');                        // the month keeps its capital
S('Late Triassic Bivalvia (chiefly Halobiidae)', 'Late Triassic Bivalvia (chiefly Halobiidae)');
S('Faults (northeastern Tibetan Plateau) Revisited', 'Faults (northeastern Tibetan Plateau) revisited');
S('Fossil Insects (A Review) Of Amber', 'Fossil insects (a review) of amber');
S('Carbon–Nitrogen Bonds', 'Carbon–nitrogen bonds');                   // unspaced dash is not a subtitle
S('Museum Collections — A Global Resource', 'Museum collections — A global resource');
S('Norops Crassulus (Cope, 1864) Revisited', 'Norops crassulus (Cope, 1864) revisited');
S('Specimens Of Barosaurus Marsh, 1890', 'Specimens of Barosaurus Marsh, 1890');
S('Gastropods Of Nevada, Part 2', 'Gastropods of Nevada, Part 2');

console.log('6. hyphenated / protected first word, idempotence');
S('Fish-Like Vertebrates', 'Fish-Like vertebrates', { protect: ['Fish-Like'] });
S('Fish-Like Vertebrates', 'Fish-like vertebrates');
S('e-Learning Platforms', 'E-learning platforms');
S('Re-Evaluation Of Taxa', 'Re-evaluation of taxa');
S('Studies Of Mid-Cretaceous Oceans', 'Studies of mid-Cretaceous oceans');
S('Non-Avian Dinosaurs', 'Non-avian dinosaurs');

console.log('7. length-preserving case mapping; HTML untouched');
eq('ligature not capitalised', sc('ﬁsh Fossils'), 'ﬁsh fossils');
eq('title case ligature/ß/tags', tc('ﬁsh straße <i>and</i> &amp; sea'), 'ﬁsh Straße <i>and</i> &amp; Sea');
eq('title case keeps tag names', tc('<sup>18</sup>o record <scp>in</scp> the sea'), '<sup>18</sup>O Record <scp>in</scp> the Sea');
eq('İ not lowercased to two chars', sc('Studies Of İzmir').length, 'Studies Of İzmir'.length);
var NFC = 'Étude Des Régions Côtières Et Des Forêts';
eq('NFD input converts like NFC', sc(NFC.normalize('NFD')), sc(NFC));                       // combining marks would split the word
eq('NFD input: régions lowercased', sc(NFC.normalize('NFD')).indexOf('des régions') > 0, true);
eq('CJK word before a Latin word is not a sentence end', sc('日本 And The Geology'), '日本 and the geology');
eq('CJK word is a word token', C.tokenize('日本の地質学 and').map(function (t) { return t.kind; }).join(','), 'word,space,word');
eq('title case after a CJK word', tc('日本の地質学 and the geology'), '日本の地質学 and the Geology');
eq('CJK words do not read as upper case', det('日本 地質 学会 研究 報告 a'), 'sentence');
eq('sentence case keeps tags', sc('A <i>Homo Erectus</i> Skull'), 'A <i>Homo erectus</i> skull');
eq('tokens: tag is punct', C.tokenize('a<i>b</i>').map(function (t) { return t.kind; }).join(','), 'word,punct,word,punct');
eq('tokens: entity is punct', C.tokenize('A &amp; B').map(function (t) { return t.kind; }).join(','), 'word,space,punct,space,word');
eq('upper title with entity', det('FRIEDRICH &amp; DIMMOCK, INC.'), 'upper');

console.log('8. detectCase');
eq('Southern Thailand sentence', det('Daily rainfall δ18O suggests Southern Thailand speleothem records'), 'sentence');
eq('Hell Creek sentence', det('A new species of Tyrannosaurus from the Late Cretaceous Hell Creek Formation of Montana'), 'sentence');
eq('Macquarie sentence', det('Macquarie Island mapping reveals three tectonic phases'), 'sentence');
eq('Dead Sea sentence', det('Crustal shortening in the Palmyride Fold Belt, Syria, and implications for movement along the Dead Sea Fault System'), 'sentence');
eq('title', det('A New Species of Tyrannosaurus From the Late Cretaceous Hell Creek Formation of Montana'), 'title');
eq('capital The mid-title is title', det('Presentation of the Strimple Award of The Paleontological Society to Ernest Hammon'), 'title');
eq('upper', det('STATUS OF LATE CENOZOIC BOUNDARIES'), 'upper');

console.log('9. species epithets; word list');
S('Tyrannosaurus Rex From The Hell Creek Formation', 'Tyrannosaurus rex from the Hell Creek Formation');
S('Emiliania Huxleyi Blooms', 'Emiliania huxleyi blooms');
S('<i>Tyrannosaurus Rex</i> Revisited', '<i>Tyrannosaurus rex</i> revisited');
S('Frogs Of Costa Rica And Baja California', 'Frogs of Costa Rica and Baja California');
eq('isLikelyTaxon Tyrannosaurus', C.isLikelyTaxon('Tyrannosaurus', WORDS), true);
eq('isLikelyTaxon Montana? (-a genus-like; heuristic)', typeof C.isLikelyTaxon('Montana', WORDS), 'boolean');
eq('isLikelyTaxon Rock', C.isLikelyTaxon('Rock', WORDS), false);
var W = C.wordsFrom(WORDS);
eq('list has school', W.has('school'), true);
eq('list has internet', W.has('internet'), true);
eq('list lacks hubble', W.has('hubble'), false);
eq('list lacks earth', W.has('earth'), false);
// cap raised from 310 KB: the lazy-loaded list may now be about 600 KB (front-coded)
eq('word list size <= 620 KB', require('fs').statSync(path.join(ROOT, 'data', 'common-words.js')).size <= 620 * 1024, true);

console.log('10. toSentenceCaseSafe');
function safe(t) { return C.toSentenceCaseSafe(t, { words: WORDS }).text; }
eq('keeps sentence title', safe('Daily rainfall δ18O suggests Southern Thailand speleothem records'), 'Daily rainfall δ18O suggests Southern Thailand speleothem records');
var T42 = 'North Atlantic Oscillation signatures in the atmospheric concentrations of persistent organic pollutants: An analysis using Integrated Atmospheric Deposition Network–Great Lakes monitoring data';
eq('keeps Integrated...Network (real title)', safe(T42), T42);
eq('converts title case', safe('Deep Residual Learning for Image Recognition'), 'Deep residual learning for image recognition');
eq('skipped flag', C.toSentenceCaseSafe('Deep residual learning', { words: WORDS }).skipped, true);

console.log('11. fromAllCaps: US, EU, DOE and agency acronyms');
function fa(t) { return C.fromAllCaps(t, WORDS); }
eq('THE US DEPARTMENT', fa('THE US DEPARTMENT OF ENERGY'), 'The US Department Of Energy');
eq('US EPA', fa('US EPA GUIDELINES'), 'US EPA Guidelines');
eq('THE US GEOLOGICAL SURVEY', fa('THE US GEOLOGICAL SURVEY'), 'The US Geological Survey');
eq('U.S.', fa('THE U.S. GEOLOGICAL SURVEY'), 'The U.S. Geological Survey');
eq('TELL US at the end', fa('WHAT THE ROCKS TELL US'), 'What The Rocks Tell Us');
eq('TELL US ABOUT', fa('WHAT FOSSILS TELL US ABOUT CLIMATE'), 'What Fossils Tell Us About Climate');
eq('OF US HOSPITALS', fa('A STUDY OF US HOSPITALS'), 'A Study Of US Hospitals');
eq('agencies', fa('USGS NASA NOAA NIH CDC FDA UN UK EPA REPORT'), 'USGS NASA NOAA NIH CDC FDA UN UK EPA Report');
eq('THE DOE', fa('THE DOE OFFICE OF SCIENCE'), 'The DOE Office Of Science');
eq('JOHN DOE', fa('JOHN DOE AND THE FAWN'), 'John Doe And The Fawn');
eq('EU MEMBER STATES', fa('EU MEMBER STATES'), 'EU Member States');
eq('THE EU AND THE US', fa('THE EU AND THE US'), 'The EU And The US');
eq('Eu the element', fa('FE AND EU IN GARNET'), 'Fe And Eu In Garnet');
eq('EU-DOPED', fa('EU-DOPED PHOSPHORS'), 'Eu-Doped Phosphors');
eq('sentence case after fromAllCaps', sc(fa('THE US GEOLOGICAL SURVEY AND THE EPA')), 'The US Geological Survey and the EPA');

console.log('deterministic fuzz (idempotence, length, markup)');
var pieces = ['The','the','A','a','Of','New','York','Darwin\'s','Rock','rock','-','–','—',':','?','!','(',')','\'','"','.',' ','Fe3+','CO2','DNA','pH','Early-Middle','non-Avian','i','<i>','</i>','St.','U.S.','Ice','Age','Sea','Dead','Red','Formation','Hell','Creek','Basin','North','Gulf','of','Mexico','As','In','Pb',',','and','Part','2.','Vitamin','Late','Cretaceous','Dinosaur','Tyrannosaurus','Rex','Homo','Erectus','Andes','Wales','Fields','Banks','Joseph','e-Learning','Fish-Like','ﬁ','ß','İ','ǅ','&amp;','Cope,','1864','Island','Mud','Hill','Star','United','States','Ma','K-Pg','Using','Situ'];
var seed = 12345; function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
var bad = { idem: 0, len: 0, tag: 0, safeIdem: 0 }, ex = [];
for (var k = 0; k < 60000; k++) {
  var n = 1 + Math.floor(rnd() * 9), t = '';
  for (var q = 0; q < n; q++) { t += pieces[Math.floor(rnd() * pieces.length)]; if (rnd() < 0.6) t += ' '; }
  var s1 = sc(t), s2 = sc(s1), t1 = tc(t);
  if (s1 !== s2) { bad.idem++; if (ex.length < 5) ex.push([t, s1, s2]); }
  if (s1.length !== t.length || t1.length !== t.length) bad.len++;
  if ((t.match(/<\/?i>|&amp;/g) || []).join() !== (s1.match(/<\/?i>|&amp;/g) || []).join()) bad.tag++;
  var f1 = safe(t); if (safe(f1) !== f1 && sc(f1) !== f1) bad.safeIdem++;
}
eq('fuzz idempotence failures', bad.idem, 0); eq('fuzz length changes', bad.len, 0); eq('fuzz tag changes', bad.tag, 0);
if (ex.length) console.log(JSON.stringify(ex, null, 1));

console.log('real titles (hunt-case)');
// real Crossref titles snapshot (fixtures/case-titles.json)
var all = require(path.join(FIX, 'case-titles.json')), G = require(path.join(FIX, 'case-gold.js'));
var idem = 0, damaged = 0;
all.forEach(function (r) { var a = sc(r.t); if (sc(a) !== a) idem++; });
G.SENT.forEach(function (k) { if (safe(all[k].t) !== all[k].t) damaged++; });
eq('258 real titles idempotent', idem, 0);
eq('already-sentence titles damaged by toSentenceCaseSafe', damaged, 0);
// "X of Y Z W" names, both directions
G.OF_NAMES.forEach(function (p) {
  eq('of-name to sentence case: ' + p[0], sc(p[0]), p[1]);
  eq('of-name to title case: ' + p[1], tc(p[1]), p[0]);
  eq('of-name sentence case idempotent: ' + p[1], sc(p[1]), p[1]);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
