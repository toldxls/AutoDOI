var ROOT = require('path').resolve(__dirname, '..');
// Tests for the 2026-09-23 review fixes in sentencecase.js: memorial / discussion lead-ins
// followed by a personal name, leading name openers ("Lake Superior"), the capitalised
// binomial rule ("Drosophila Melanogaster") and ambiguous element symbols in a chemical
// context ("Diffusion Of He In Olivine"). Run: node tests/sentencecase-review.test.js
var path = require('path');
var WORDS = require(path.join(ROOT, 'data', 'common-words.js'));
var C = require(path.join(ROOT, 'sentencecase.js'));
var pass = 0, fail = 0;
function eq(label, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.log('  FAIL ' + label + '\n         got:  ' + JSON.stringify(got) + '\n         want: ' + JSON.stringify(want)); }
}
function sc(t, o) { return C.toSentenceCase(t, Object.assign({ words: WORDS }, o || {})).text; }
function safe(t) { return C.toSentenceCaseSafe(t, { words: WORDS }).text; }
// S: converts to `want` and is idempotent (a second pass leaves the result alone)
function S(t, want, o) { var r = sc(t, o); eq(t, r, want); eq('idempotent: ' + t, sc(r, o), r); }

console.log('1. personal names after a memorial / discussion lead-in');
S('Obituary: Peter Green', 'Obituary: Peter Green');
S('In Memoriam: John Smith', 'In Memoriam: John Smith');
S('A Tribute To Robert Brown', 'A tribute to Robert Brown');
S('Comments On Baker And White', 'Comments on Baker and White');
S('Remembering John Smith', 'Remembering John Smith');
S('Dedicated To Charles Darwin', 'Dedicated to Charles Darwin');
S('Festschrift For Hans Ramberg', 'Festschrift for Hans Ramberg');
S('Reply To J. A. Smith And R. Brown', 'Reply to J. A. Smith and R. Brown');
S('Reply To Smith Et Al.', 'Reply to Smith et al.');
S('In Memory Of Ludwig van Beethoven', 'In memory of Ludwig van Beethoven');
S('Obituary — Mary Anning', 'Obituary — Mary Anning');
S('In Memoriam: John Smith (1920-2001)', 'In Memoriam: John Smith (1920-2001)');
S('A Tribute To Robert Brown: Pioneer Of Botany', 'A tribute to Robert Brown: Pioneer of botany');
S('Comments On Baker And White On Rocks', 'Comments on Baker and White on rocks');   // the name ends at a breaker
S('Obituary: Peter Green, Geologist', 'Obituary: Peter Green, geologist');           // a comma ends the name
eq('safe: tribute', safe('A Tribute To Robert Brown'), 'A tribute to Robert Brown');
eq('safe: obituary', safe('Obituary: Peter Green'), 'Obituary: Peter Green');

console.log('1b. negative controls: lead-ins followed by ordinary words');
S('Comments On The Geology Of Ohio', 'Comments on the geology of Ohio');
S('Review Of Recent Advances In Mineralogy', 'Review of recent advances in mineralogy');
S('Review Of Green Chemistry', 'Review of green chemistry');                  // stop word after a surname
S('Review Of Green Energy Storage', 'Review of green energy storage');        // common non-surname word in the run
S('Review Of Fossils', 'Review of fossils');
S('Response To Climate Change', 'Response to climate change');
S('Remembering The Past', 'Remembering the past');
S('Obituary Of A Species', 'Obituary of a species');
S('In Memory Of The Green Revolution', 'In memory of the green revolution');
S('The Green Revolution In Agriculture', 'The green revolution in agriculture');
S('Comment On "Deep Learning For Fossils"', 'Comment on "Deep Learning For Fossils"');
eq('already sentence case untouched', sc('A tribute to Robert Brown'), 'A tribute to Robert Brown');
eq('lowercase input not recased', sc('Obituary: peter green'), 'Obituary: Peter green');
eq('comments on the geology (sentence input)', sc('Comments on the geology of Ohio'), 'Comments on the geology of Ohio');

console.log('2. leading name openers');
S('Lake Superior Sediments', 'Lake Superior sediments');
S('Sediments Of Lake Superior', 'Sediments of Lake Superior');
S('Lake George Sediments', 'Lake George sediments');
S('Lake Victoria Fishes', 'Lake Victoria fishes');
S('Loch Ness Sediments', 'Loch Ness sediments');
S('Rio Negro Fishes', 'Rio Negro fishes');
S('Lago Titicaca Sediments', 'Lago Titicaca sediments');
S('Point Barrow Weather', 'Point Barrow weather');
S('Mount Baker Eruptions', 'Mount Baker eruptions');
S('Cape Cod Sediments', 'Cape Cod sediments');
S('Sediments Of The Gulf Of Guinea', 'Sediments of the Gulf of Guinea');
console.log('2b. negative controls: "Lake" / "Point" as ordinary nouns');
S('A Lake In Ohio', 'A lake in Ohio');
S('Lake Sediments Of Ohio', 'Lake sediments of Ohio');
S('Lake Sediment Geochemistry In Ohio', 'Lake sediment geochemistry in Ohio');
S('Lake Level Changes', 'Lake level changes');
S('Point Sources Of Pollution', 'Point sources of pollution');
S('Sea Level Rise', 'Sea level rise');
eq('lowercase lake untouched', sc('A lake in Ohio'), 'A lake in Ohio');

console.log('3. capitalised binomials');
S('Hox Genes In Drosophila Melanogaster', 'Hox genes in Drosophila melanogaster');
S('Sequence Of Drosophila Simulans', 'Sequence of Drosophila simulans');
S('Arabidopsis Thaliana Genome', 'Arabidopsis thaliana genome');
S('Ostrea Edulis Beds', 'Ostrea edulis beds');
S('Fucus Vesiculosus Ecology', 'Fucus vesiculosus ecology');
S('Tyrannosaurus Rex From The Hell Creek Formation', 'Tyrannosaurus rex from the Hell Creek Formation');
S('Homo Sapiens Origins', 'Homo sapiens origins');
console.log('3b. negative controls: names that end in -e are not epithets');
S('Pierre Dale Revisited', 'Pierre Dale revisited');
S('Chris Dale On Rocks', 'Chris Dale on rocks');
S('Fossils Of Clare Formation', 'Fossils of Clare Formation');
eq('Hox kept', sc('Hox Genes In Mice').slice(0, 3), 'Hox');

console.log('4. ambiguous element symbols in a chemical context');
S('Diffusion Of He In Olivine', 'Diffusion of He in olivine');
S('Solubility Of Be In Quartz', 'Solubility of Be in quartz');
S('The Role Of As In Soils', 'The role of As in soils');
S('Diffusion Of He And Ne In Quartz', 'Diffusion of He and Ne in quartz');
S('U–Pb Ages And He Diffusion', 'U–Pb ages and He diffusion');
S('40Ar/39Ar Dating Of He Bearing Minerals', '40Ar/39Ar dating of He bearing minerals');   // chemical title relaxes the follow rule
S('3He/4He Ratios Of He In Basalt', '3He/4He ratios of He in basalt');
S('Effects Of Am In Radioactive Waste', 'Effects of Am in radioactive waste');
S('Properties Of Be-Doped Silicon', 'Properties of Be-doped silicon');
S('Studies Of Be-Rich Pegmatites', 'Studies of Be-rich pegmatites');
S('Isotopes Of Sr And Pb In Zircon', 'Isotopes of Sr and Pb in zircon');       // existing behaviour kept
S('Pb, As And Cd In Soils', 'Pb, As and Cd in soils');
eq('safe: He in olivine', safe('Diffusion Of He In Olivine'), 'Diffusion of He in olivine');
console.log('4b. negative controls: ordinary prose');
S('He Went In', 'He went in');
S('A Study In Which He Went In', 'A study in which he went in');
S('Studies Of No Interest', 'Studies of no interest');
S('Effects Of In Utero Exposure', 'Effects of in utero exposure');
S('Effects Of At Home Care', 'Effects of at home care');
S('Life Of No Regrets In Retirement', 'Life of no regrets in retirement');
S('The Song Of He Who Walks', 'The song of he who walks');
S('Mo Isotopes As A Redox Proxy', 'Mo isotopes as a redox proxy');
S('A Story Of In-Laws', 'A story of in-laws');
S('Reading At Home And In School', 'Reading at home and in school');
eq('sentence input untouched', sc('He went in'), 'He went in');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
