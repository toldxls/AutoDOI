// Grading a found record against the pasted reference: the cases the matching bench (tests/browser/match-bench.js)
// showed being held back although right, and the guards that must stay.
var ROOT = require('path').resolve(__dirname, '..');
var A = require(require('path').join(ROOT, 'citations.js'));
var pass = 0, fail = 0;
function rec(o) { return A.normalize({ type: 'journal-article', title: [o.title], author: o.authors || [{ family: o.author || 'Smith', given: 'J.' }], issued: { 'date-parts': [[o.year || 2020]] }, 'container-title': [o.journal || 'Journal'] }); }
function ge(label, text, r, min) { var c = A.matchConfidence(text, r); if (c >= min) pass++; else { fail++; console.log('FAIL ' + label + ': ' + c.toFixed(2) + ' < ' + min); } }
function lt(label, text, r, max) { var c = A.matchConfidence(text, r); if (c < max) pass++; else { fail++; console.log('FAIL ' + label + ': ' + c.toFixed(2) + ' >= ' + max); } }
var GOOD = 0.8, WARN = 0.5;
// a reference that drops the record's subtitle
ge('subtitle dropped', 'König A., Mermin N.D. (1999) Screw rotations and glide mirrors. Proc Natl Acad Sci 96:3502-3506', rec({ title: 'Screw rotations and glide mirrors: Crystallography in Fourier space', author: 'König', year: 1999 }), GOOD);
lt('a two-word main title is not enough on its own', 'Smith J (2020) Deep learning for cats. J 1:1', rec({ title: 'Deep learning: methods and applications', year: 2020 }), WARN);
// British and American spelling, hyphenated compounds written solid
ge('spelling and compounds', 'Anderson AT, Gottfried D (1971) Contrasting behaviour of P, Ti and Nb in a differentiated high-alumina olivine tholeiite and a calcalkaline andesite suite. J Petrol 12:109', rec({ title: 'Contrasting Behavior of P, Ti, and Nb in a Differentiated High-Alumina Olivine Tholeiite and a Calc-Alkaline Andesite Suite', author: 'Anderson', year: 1971 }), GOOD);
ge('sulphide, palaeo, modelling, centre', 'Safina N.P. (2015) Banded sulphide-magnetite ores: palaeo-modelling at the centre. Geol 1:1', rec({ title: 'Banded sulfide–magnetite ores: paleo-modeling at the center', author: 'Safina', year: 2015 }), GOOD);
// ligatures dropped by a PDF ("fi" missing) and a typo in the author
ge('ligature typos', 'Korekina M.A. (2023) Formation conditions and sources of fuids of the frst quartz deposits. Minerals 13:1', rec({ title: 'Formation conditions and sources of fluids of the first quartz deposits', author: 'Korekina', year: 2023 }), GOOD);
ge('author typo', 'Safna N.P., Maslennikov V.V. (2015) Banded sulfide-magnetite ores of Mauk copper massive sulfide deposit. Geol Ore Dep 57:1', rec({ title: 'Banded sulfide-magnetite ores of Mauk copper massive sulfide deposit', author: 'Safina', year: 2015 }), GOOD);
// "(1964a)" is a year even with a page range beside it
ge('year with a letter suffix', 'Chayes F (1964a) A petrographic distinction between Cenozoic volcanics in and around the open oceans. J Geophys Res 69:1573–1588', rec({ title: 'A petrographic distinction between Cenozoic volcanics in and around the open oceans', author: 'Chayes', year: 1964 }), GOOD);
lt('a different year is never green (the page flags the year clash)', 'Chayes F (1975) A petrographic distinction between Cenozoic volcanics in and around the open oceans. J Geophys Res 69:1573', rec({ title: 'A petrographic distinction between Cenozoic volcanics in and around the open oceans', author: 'Chayes', year: 1964 }), GOOD);
// an organisation deposited as the first author: the first person is checked instead
ge('organisation first author', 'Noskevich V.V., Fedorova N.V. (2018) Using the ground penetrating radar method for research of the ancient Vorovskaya Yama copper mine. Geoarchaeology 1:1', rec({ title: 'Using the ground penetrating radar method for research of the ancient “Vorovskaya Yama” copper mine', authors: [{ name: 'Bulashevich Institute of Geophysics of the Ural Branch of RAS' }, { family: 'Noskevich', given: 'V. V.' }], year: 2018 }), GOOD);
// no year in the reference, but title and author are exact
ge('missing year, exact title and author', 'Kasatkin A.V., Kuznetsov A.M. Ore minerals of the Buranovskoe tungsten deposit (Southern Urals). Mineralogy 8(2):5-20', rec({ title: 'Ore minerals of the Buranovskoe tungsten deposit (Southern Urals)', author: 'Kasatkin', year: 2022 }), GOOD);
lt('missing year and wrong author stays amber', 'Ivanov P.Q. Ore minerals of the Buranovskoe tungsten deposit (Southern Urals). Mineralogy 8(2):5-20', rec({ title: 'Ore minerals of the Buranovskoe tungsten deposit (Southern Urals)', author: 'Kasatkin', year: 2022 }), GOOD);
// guards that must stay
lt('different title', 'Smith J (2020) Thermal conductivity of olivine at mantle pressures. J 1:1', rec({ title: 'Nanometre-scale thermometry in a living cell', year: 2020 }), WARN);
lt('a corrigendum is not the paper', 'Kucsko G (2013) Nanometre-scale thermometry in a living cell. Nature 500:54', rec({ title: 'Corrigendum: Nanometre-scale thermometry in a living cell', author: 'Kucsko', year: 2013 }), WARN);
ge('exact reference is 1', 'Kucsko G, Maurer PC (2013) Nanometre-scale thermometry in a living cell. Nature 500:54-58', rec({ title: 'Nanometre-scale thermometry in a living cell', author: 'Kucsko', year: 2013 }), 0.99);
lt('typo tolerance does not merge short different words', 'Smith J (2020) Iron ore in the deep. J 1:1', rec({ title: 'Icon core on the deer', year: 2020 }), WARN);
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
