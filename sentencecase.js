/*
 * AutoDOI — title case <-> sentence case conversion with proper-noun protection.
 * Pure functions only (no DOM, no network) so the same file runs in the browser
 * page, in Node, and in Google Apps Script. ES5 syntax (no lookbehind, no \p{}).
 *
 * The converter is deliberately conservative: a capitalised word is lowercased
 * ONLY when it is known to be a common English word (the list in
 * data/common-words.js, built by tools/build-common-words.py) and nothing marks
 * it as part of a name. Names are recognised by:
 *   - unknown words (not in the list) and user-protected words, which stay as they are;
 *   - a curated list of multi-word proper names ("United States", "Gulf of Mexico",
 *     "Natural History Museum"), matched case-insensitively when the input
 *     capitalises the first word, and written in their canonical capitalisation;
 *   - name-forming head nouns (Formation, Basin, Sea, Museum, Island, ...) directly
 *     after a kept word ("Deccan Traps", "Morrison Formation", "Macquarie Island");
 *   - "X + head" pairs where X is capitalised in the input ("Mud Hill", "Red Sea");
 *   - name prefixes directly before a kept word ("Late Cretaceous", "Northern Qilian").
 * Other capitalised common words next to an unknown word are lowercased
 * ("Late Cretaceous Dinosaur Faunas" -> "Late Cretaceous dinosaur faunas").
 * Words the list does not know are still lowercased when their form marks them as
 * technical vocabulary (isTechWord: "Komatiites", "Petrogenesis", "Tholeiitic",
 * "Harpetid", "Metabasalts", "Tamoxifen"), unless the list marks them as a known
 * place or person ("^name") or they are eras, higher taxa (-idae, -oidea) or curated
 * proper adjectives. The list may also carry "!name" entries (surnames / places such
 * as "Potts", "Dolores" whose -s/-ed/-ing stem is a common word; never stemmed).
 * Anything the converter is unsure about is left as it was, so a UI can show each
 * token and let the user flip it.
 *
 *   AutoDOICase.fromAllCaps(title, words) -> an ALL-CAPS title in title case with
 *   acronyms, Roman numerals, units and chemical formulas restored (length preserved),
 *   ready for toSentenceCase / toTitleCase.
 *
 *   var res = AutoDOICase.toSentenceCase(title, { words: AutoDOI_COMMON_WORDS, protect: mySet });
 *   res.text    -> converted string
 *   res.tokens  -> [{ text, changed, kind: 'word' | 'punct' | 'space' }, ...]
 *   AutoDOICase.toSentenceCaseSafe(title, opts) -> same, but returns the title unchanged
 *                                                  when detectCase() says it is already sentence case
 */
(function (root) {
  'use strict';

  /* ---------- word classes ---------- */

  // Standard function words; always present in the common-words list.
  var FUNCTION_WORDS = 'a an the of in on and or for with from to by at as but nor via vs versus into onto over under between among within without during after before through toward towards upon about across along around against is are was were be been its their our this that these those new';

  // Words kept lowercase in headline (MLA/Chicago) style unless first, last or after a colon:
  // articles, coordinating conjunctions and prepositions. Verbs and pronouns ARE capitalised
  // in headline style, so they are not in this list.
  var BASE_SMALL = 'a an the of in on and or for with from to by at as but nor via vs versus into onto over under between among within without during after before through toward towards upon about across along around against';
  var SMALL_WORDS = BASE_SMALL + ' below near beyond despite except inside outside past since throughout until';

  // Words that in sentence case are always lowercased mid-title and that end a run of
  // capitalised words. "new" is deliberately absent ("New Zealand", "New South Wales").
  var BREAKERS = BASE_SMALL + ' is are was were be been its their our this that these those';

  // Name-forming head nouns: kept capitalised directly after a kept word (unknown,
  // protected, phrase or another kept head): "Deccan Traps", "Hell Creek Formation".
  var HEAD_WORDS = 'ocean oceans sea seas gulf bay river rivers lake lakes island islands isle islet archipelago ' +
    'mountain mountains range ranges basin basins plateau plain plains valley desert peninsula coast shelf trench ' +
    'ridge rift fault faults zone formation formations member group supergroup trap traps shale sandstone ' +
    'limestone mudstone siltstone dolomite chalk marl granite tuff gneiss schist quartzite conglomerate quarry ' +
    'creek canyon cave caves county state province park museum institute institution university college ' +
    'society survey station glacier current craton block terrane belt arc orogen complex suite pluton ' +
    'batholith dome hill hills peak peaks mount strait channel sound fjord lagoon reef atoll delta estuary ' +
    'falls springs well mine bed beds horizon stage series system epoch period seaway seamount monument ' +
    'forest reserve refuge award medal prize lecture republic kingdom territory district oscillation gyre ' +
    'shield platform massif arch embayment trough volcano caldera highlands lowlands fold thrust ' +
    'tongue spur depression furrow crater craters bluff bluffs ranch inlet volcanics intrusion dyke dike swarm press land ' +
    'ophiolite troctolite syncline anticline foredeep centre harbour harbor';
  // Heads that only follow a geological time name ("Jurassic System", "Cretaceous Period")
  // or a fault/rift ("Dead Sea Fault System").
  var TIME_HEADS = 'system series stage epoch period';
  // Heads allowed after a period name ("Cretaceous Sea Level" -> "Cretaceous sea level").
  var STRAT_HEADS = 'system series stage epoch period formation formations member group supergroup bed beds';
  // Geological time names (always unknown words) that restrict what may follow them.
  var GEO_TIME = 'cambrian ordovician silurian devonian carboniferous mississippian pennsylvanian permian triassic ' +
    'jurassic cretaceous paleogene palaeogene neogene quaternary tertiary paleocene palaeocene eocene oligocene ' +
    'miocene pliocene pleistocene holocene anthropocene precambrian archean archaean proterozoic phanerozoic ' +
    'paleozoic palaeozoic mesozoic cenozoic cainozoic ediacaran cryogenian tonian hadean neoproterozoic ' +
    'mesoproterozoic paleoproterozoic palaeoproterozoic neoarchean mesoarchean paleoarchean eoarchean';
  // "X + head" pairs kept as a name when X is a capitalised common word in the input
  // ("Mud Hill", "Red Sea", "Vale Formation", "Royal Society").
  var X_HEADS = 'shale sandstone limestone mudstone formation member basin island islands sea ocean gulf ' +
    'bay river lake mountain mountains plateau museum society university creek hill hills canyon glacier ' +
    'seamount islet park monument peninsula award medal prize county mine crater falls inlet quarry bluff bluffs ' +
    'strait straits forest depression reef city harbour harbor';
  // X_HEADS that stay a name even when a common word follows ("Mud Hill locality").
  var X_HEADS_FREE = 'museum society university creek hill hills islet seamount monument award medal prize ' +
    'county crater falls inlet quarry canyon bluffs city river rivers';
  // X words that never form such a name ("Large Sea surface", "Star Formation", "Crown Group").
  var X_STOP = 'large small big deep shallow open high low global local regional marine coastal inland modern ' +
    'ancient entire whole same other many several various different continental oceanic volcanic barrier heat ' +
    'urban sedimentary foreland forearc backarc rift intracratonic extensional structural drainage catchment ' +
    'closed endorheic tropical temperate polar subtropical subpolar equatorial upper lower inner outer major ' +
    'minor main isolated remote tiny coral desert glacial proglacial saline freshwater alpine braided meandering ' +
    'alluvial tidal human civil information risk research public private natural artificial virtual digital ' +
    'future past present early late middle young old hot cold warm cool dry wet wide narrow long short ' +
    'star planet galaxy pattern bone biofilm crown stem sister control age study working functional focus peer ' +
    'blood ethnic treatment support taxonomic end family team crew faculty black oil gas organic tight carbonate ' +
    'siliceous tidewater outlet piedmont cirque submarine theme car industrial science technology ' +
    'one two three four five six seven eight nine ten several few gravel sand bedrock mixed solar ' +
    'first second third final total single double multiple novel simple complex new impact boreal rain ' +
    'primary secondary deciduous evergreen montane cloud kelp mangrove patch fringing inner acid ' +
    'open slot mining abandoned active historic';
  // Name openers: the capitalised word after them is part of the name ("Mount Baker",
  // "Cape Cod", "Fort Union", "San Rafael", "Lac des Iles").
  var OPENER_WORDS = 'mount mt cape fort port saint san santa lac monte cerro isla sierra lago rio río loch ben lake point';
  // Openers that are also ordinary nouns ("Lake Sediments", "Point Sources"): the next word is
  // kept only when it is a known place epithet / surname ("Lake Superior", "Lake George").
  var OPENER_STRICT = 'lake point';
  var PLACE_EPITHETS = 'superior placid district constance eyre chad victoria mono pyramid crater salt bear slave ' +
    'clear pleasant hope grand grande louise moraine peak forest fork conception arena barrow reyes general';
  // Memorial / discussion lead-ins: the capitalised words after them are a personal name
  // ("Obituary: Peter Green", "Comments On Baker And White"). Longest match wins.
  var LEAD_INS = ['obituary', 'in memoriam', 'memorial', 'memorial to', 'tribute to', 'a tribute to', 'in memory of',
    'remembering', 'festschrift for', 'dedicated to', 'comments on', 'comment on', 'reply to', 'response to',
    'discussion of', 'review of', 'in honor of', 'in honour of'];
  // Common title words after a lead-in that rule out a personal name.
  var NAME_STOP = 'recent advances new the a an of in on and for with from to by at its their some further methods ' +
    'results data evidence studies study analysis review notes observations geology mineralogy chemistry biology ' +
    'structure structures origin history systematics taxonomy phylogeny evolution distribution occurrence ' +
    'occurrences description redescription revision paper papers article report';
  // Lowercase particles inside a personal name ("Ludwig van Beethoven", "Pierre de Fermat").
  var NAME_PARTICLES = 'de van von der den da di le la du del della dos das y af zu ter';
  // Frequent English surnames that are also common words: name-like after a lead-in.
  var SURNAMES = 'green brown white black smith baker miller taylor walker young king hall wood hill stone fox bell ' +
    'cook wright hunt price long short gray grey ford lane field marsh moore wells bishop knight page rose bird day may ' +
    'rice reed ward west north south east bridges brooks banks rivers wolf fisher hunter carter mason cooper turner ' +
    'parker palmer fowler shepherd chapman butler barber gardner farmer archer dyer weaver thatcher sawyer carpenter ' +
    'slater sherman spencer marshall steward stewart bailey chamberlain chancellor dean abbott monk priest pope bright ' +
    'sharp swift strong wise good best savage noble gentle hardy sterling golden silver love hope grace joy bliss frost ' +
    'snow winter summers spring flower bloom berry cherry plum apple olive holly heath moss fern reid read reading lord ' +
    'earl duke prince kaiser church temple cross chapel castle tower house holmes bond small little bigg sparrow crane ' +
    'crow hawk drake swan peacock finch martin robin starling lamb bull hart buck roe todd';
  // Words that make a two-letter symbol between "of"/"in" an element ("Diffusion Of He In Olivine").
  var CHEM_CONTEXT = 'isotope isotopes diffusion partitioning solubility mobility transport content contents ' +
    'concentration concentrations abundance abundances ratio ratios systematics geochemistry budget flux fluxes loss ' +
    'retention degassing enrichment depletion doping doped substitution incorporation adsorption sorption uptake ' +
    'release cycling speciation oxidation reduction valence coordination';
  // Adjective + head pairs that form a name head after a kept word ("McMurdo Volcanic
  // Group", "Sudbury Igneous Complex", "Powdermill Nature Reserve").
  var COMPOUND_HEADS = {
    volcanic: 'group complex field province suite arc zone', igneous: 'complex province suite',
    plutonic: 'complex suite', intrusive: 'complex suite', metamorphic: 'complex core', crystalline: 'complex',
    nature: 'reserve park', hydrothermal: 'field', greenstone: 'belt', fold: 'belt', shear: 'zone',
    suture: 'zone', granite: 'province suite', ophiolite: 'complex', ultramafic: 'complex', layered: 'intrusion',
    mining: 'district', provincial: 'park', wildlife: 'refuge reserve', marine: 'reserve park', gold: 'field'
  };
  // Institution heads that take "of" + a capitalised name ("Museum of Comparative Zoology").
  // Geographic heads that take "of" + a capitalised name ("Isle of Pines", "Sea of Cortez")
  var GEO_OF_WORDS = 'isle island islands gulf bay sea strait straits cape lake lakes valley';
  var INSTITUTION_WORDS = 'museum institute university academy society college school survey department ' +
    'ministry bureau council foundation commission association laboratory observatory center centre';
  // Words kept capitalised directly before a kept word ("Late Cretaceous", "Northern Qilian",
  // "Royal Tyrrell", "Mount Scott", "Upper-Lower Jurassic").
  var PREFIX_WORDS = 'late early middle upper lower north south east west northern southern eastern western ' +
    'northeast northwest southeast southwest northeastern northwestern southeastern southwestern central ' +
    'great little greater lesser grand royal national saint mount port fort cape lake isle inner outer united ' +
    'point far near holy';
  // Words after which a capital "A" is a label ("Vitamin A", "Type A", "Part A").
  var LABEL_NOUNS = 'vitamin type part hepatitis figure fig table appendix group class series section chapter ' +
    'phase plan model category grade zone unit site level layer member protein subtype influenza complex ' +
    'sample station case box panel experiment study form region annex supplement volume vol no number stage ' +
    'horizon bed trial cohort block area locality line strain clade lineage chain ring factor fraction ' +
    'component peak band mode option scenario tier plate sheet list';
  // Abbreviations whose full stop does not end a sentence.
  var ABBREVIATIONS = 'e eg i ie et al etc vs v cf ca c approx sp spp ssp subsp var gen nov n comb aff nr fam ' +
    'st mt ft pt no nos vol vols fig figs eq eqs ref refs ed eds dr mr mrs ms prof jr sr inc ltd co corp bros ' +
    'dept univ mus inst soc geol bull proc jan feb mar apr jun jul aug sep sept oct nov dec pl pp ser sect';
  // Two-letter chemical element symbols.
  var ELEMENTS = 'He Li Be Ne Na Mg Al Si Cl Ar Ca Sc Ti Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Zr Nb Mo ' +
    'Tc Ru Rh Pd Ag Cd In Sn Sb Te Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta Re Os Ir Pt Au ' +
    'Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa Np Pu Am Cm Bk Cf Es Fm Md No Lr';
  // Element symbols that are also English words: element only in a formula/list context.
  var AMBIG_ELEMENTS = 'He Be In As At No Am';
  // Units that must never anchor a run ("500 Ma old rocks").
  var UNITS = 'myr gyr kyr kya mya';
  // Hyphen prefixes that are lowercase-able when capitalised ("Re-Evaluation", "Bi-Copter").
  var HYPHEN_PREFIXES = 're bi co de un ex pre pro sub non mid tri uni semi anti multi post neo paleo palaeo meso proto meta ortho para';

  // Plural proper names whose -s/-es stripping would hit a common word
  // ("Andes" -> "and", "Paris" -> "pari", "Wales" -> "wale"). Never common.
  var PROPER_PLURALS = 'andes alps rockies appalachians himalayas himalaya pyrenees carpathians urals apennines ' +
    'hebrides bahamas philippines netherlands maldives seychelles azores canaries galapagos everglades ' +
    'americas moluccas andamans antilles cyclades balkans ardennes vosges cévennes alleghenies ozarks ' +
    'wales paris athens thebes mars ares hades hermes achilles cascades highlands lowlands midlands badlands ' +
    'holmes barnes hayes jones evans williams adams roberts edwards hughes harris lewis davies phillips ' +
    'rogers hawkins james charles peters simmons stevens richards reynolds matthews collins';
  // Plural words that are common nouns ("magnetic fields") but also surnames or regions:
  // treated as names only right after an unknown/protected word or an initial
  // ("Joseph Banks", "H. G. Wells", "Ethiopian Highlands").
  var AMBIG_PLURALS = 'waters banks fields brooks wells downs fens ' +
    'keys dolomites lakes rhodes sands woods hills';
  var NOT_GENUS = 'santa costa baja alta sierra serra bahia isla punta playa villa nueva nova terra tierra monte buena casa ' +
    'maria anna rita sofia julia laura lucia elena eva emma olga vera nina sara lisa diana gloria';

  // Multi-word proper names (canonical capitalisation), "|"-separated.
  var PHRASES = [
    // countries, regions, states, cities
    'United States|United States of America|United Kingdom|United Nations|United Arab Emirates|New Zealand|South Africa|' +
    'Black Forest|Black Hills|Blue Ridge|White Mountains|Green Mountains|Rocky Mountains|Great Dividing Range|Great Barrier Reef|Green River|White River|Red River|Snake River|Yellow River|Yellow Sea|Yellowstone National Park|Black Range|Blue Mountains|Iron Mountain|Copper Harbor|Silver City|Gold Coast|Ivory Coast|Grand Canyon|Great Salt Lake|Long Island|Long Valley|Death Valley|Mammoth Cave|Bay Area|' +
    'North America|South America|Central America|Latin America|North Korea|South Korea|Saudi Arabia|Sri Lanka|' +
    'Costa Rica|Puerto Rico|El Salvador|Czech Republic|Dominican Republic|Central African Republic|' +
    'Democratic Republic of the Congo|Republic of the Congo|Ivory Coast|Gold Coast|Sierra Leone|Burkina Faso|' +
    'Papua New Guinea|New Guinea|New Caledonia|New Hebrides|Solomon Islands|Marshall Islands|Faroe Islands|' +
    'Falkland Islands|Canary Islands|Cook Islands|Virgin Islands|Cayman Islands|Channel Islands|Aleutian Islands|' +
    'Galapagos Islands|Hawaiian Islands|Kuril Islands|British Isles|Isle of Man|Isle of Wight|Isle of Skye|' +
    'Hong Kong|New South Wales|Northern Territory|Western Australia|South Australia|Northern Ireland|' +
    'Great Britain|East Timor|Cape Verde|Cape Town|Cape Cod|Cape Horn|Cape of Good Hope|Horn of Africa|' +
    'Middle East|Near East|Far East|South Pole|North Pole|Arctic Circle|Antarctic Peninsula|East Antarctica|' +
    'West Antarctica|Tropic of Cancer|Tropic of Capricorn|New World|Old World|New England|New York|New York City|' +
    'New Jersey|New Mexico|New Hampshire|New Orleans|New Brunswick|New Madrid|New Delhi|New Albany|' +
    'North Carolina|South Carolina|North Dakota|South Dakota|West Virginia|Rhode Island|District of Columbia|' +
    'British Columbia|Nova Scotia|Prince Edward Island|Northwest Territories|Yukon Territory|Baja California|' +
    'Baja California Sur|Alta California|Santa Barbara|Santa Cruz|Santa Catarina|Santa Monica|Santa Rosa|' +
    'Santa Clara|Santa Maria|Santa Fe|Minas Gerais|Rio Grande|Rio Grande do Sul|Rio de Janeiro|Sierra Nevada|' +
    'Sierra Madre|Addis Ababa|Tierra del Fuego|Buenos Aires|Los Angeles|Los Angeles Basin|San Francisco|' +
    'San Francisco Bay|San Diego|San Juan|San Andreas|San Andreas Fault|Las Vegas|Salt Lake City|Kansas City|' +
    'Mexico City|Inner Mongolia|Emilia Romagna|Bahia Blanca|Costa Brava|Western Hemisphere|Eastern Hemisphere|' +
    'Northern Hemisphere|Southern Hemisphere|Pacific Northwest|Western Interior|Western Interior Seaway|' +
    'Western Interior Basin|Mid-Atlantic|Deep South|Midwest|Great Lakes|Great Plains|Great Basin|' +
    'Great Barrier Reef|Great Rift Valley|Great Divide Basin|Great Salt Lake|Great Smoky Mountains|' +
    'Great Wall|Great Oxidation Event|Great Dying|Dust Bowl|Silk Road|Panama Canal|Suez Canal|' +
    // oceans, seas, gulfs
    'Southern Ocean|Indian Ocean|Atlantic Ocean|Pacific Ocean|Arctic Ocean|North Atlantic|South Atlantic|' +
    'North Pacific|South Pacific|Western Pacific|Eastern Pacific|Equatorial Pacific|Red Sea|Dead Sea|' +
    'Black Sea|North Sea|North Sea Basin|Baltic Sea|Caspian Sea|Aral Sea|Irish Sea|Arabian Sea|Bering Sea|' +
    'Barents Sea|Weddell Sea|Ross Sea|Coral Sea|Tasman Sea|Yellow Sea|White Sea|South China Sea|East China Sea|' +
    'Sea of Japan|Sea of Okhotsk|Labrador Sea|Norwegian Sea|Greenland Sea|Sargasso Sea|Adriatic Sea|' +
    'Aegean Sea|Ionian Sea|Tyrrhenian Sea|Ligurian Sea|Mediterranean Sea|Gulf of Mexico|Gulf of California|' +
    'Gulf of Guinea|Gulf of Aden|Gulf of Alaska|Gulf of Maine|Gulf of Thailand|Gulf of Suez|Gulf of Aqaba|' +
    'Gulf of Bothnia|Gulf of Finland|Gulf of Carpentaria|Persian Gulf|Gulf Stream|Gulf Coast|' +
    'Gulf Coastal Plain|Atlantic Coastal Plain|Coastal Plain|Bay of Bengal|Bay of Biscay|Bay of Fundy|' +
    'Hudson Bay|Chesapeake Bay|Monterey Bay|Drake Passage|Bering Strait|Strait of Gibraltar|' +
    'English Channel|Mozambique Channel|' +
    // landforms and geology
    'Rocky Mountains|Rocky Mountain|Rocky Mountain Trench|Appalachian Mountains|Basin and Range|' +
    'Colorado Plateau|Tibetan Plateau|Deccan Traps|Siberian Traps|Death Valley|Grand Canyon|' +
    'Yellowstone National Park|Glacier National Park|Dinosaur National Monument|Dinosaur Provincial Park|' +
    'Hell Creek|Hell Creek Formation|Morrison Formation|Green River Formation|Two Medicine Formation|' +
    'Fort Union Formation|Old Red Sandstone|New Red Sandstone|Burgess Shale|Solnhofen Limestone|' +
    'Posidonia Shale|Mid-Atlantic Ridge|East Pacific Rise|Dead Sea Fault|Dead Sea Fault System|' +
    'Dead Sea Transform|Dead Sea Rift|Alpine Fault|North Anatolian Fault|East African Rift|' +
    'Pacific Plate|North American Plate|Ring of Fire|Canadian Shield|Baltic Shield|Canadian Arctic|' +
    'Canadian Arctic Archipelago|Greenland Ice Sheet|West Antarctic Ice Sheet|East Antarctic Ice Sheet|' +
    'Laurentide Ice Sheet|Cordilleran Ice Sheet|Valles Marineris|Proxima Centauri|Milky Way|' +
    'Snowball Earth|Big Bang|Dead Sea Scrolls|New Madrid Seismic Zone|San Andreas Fault Zone|' +
    // climate, events, eras
    'El Niño|La Niña|North Atlantic Oscillation|Pacific Decadal Oscillation|Southern Oscillation|' +
    'Atlantic Multidecadal Oscillation|Atlantic Meridional Overturning Circulation|' +
    'Antarctic Circumpolar Current|Kuroshio Current|Indian Ocean Dipole|Little Ice Age|Ice Age|' +
    'Last Glacial Maximum|Younger Dryas|Medieval Warm Period|Medieval Climate Anomaly|' +
    'Holocene Climatic Optimum|Iron Age|Bronze Age|Stone Age|Middle Ages|Industrial Revolution|' +
    'Scientific Revolution|Black Death|Cold War|World War I|World War II|First World War|Second World War|' +
    // institutions and programmes
    'Natural History Museum|Museum of Natural History|American Museum of Natural History|Field Museum|' +
    'Field Museum of Natural History|Carnegie Museum|Carnegie Museum of Natural History|' +
    'National Museum of Natural History|Smithsonian Institution|Royal Tyrrell Museum|British Museum|' +
    'Science Museum|Royal Society|Royal Society of London|Geological Society|Geological Society of America|' +
    'Geological Society of London|Paleontological Society|Palaeontological Association|' +
    'Society of Vertebrate Paleontology|American Geophysical Union|European Geosciences Union|' +
    'Mineralogical Society of America|American Chemical Society|Royal Society of Chemistry|' +
    'American Physical Society|National Science Foundation|National Academy of Sciences|' +
    'National Institutes of Health|Natural Environment Research Council|Geological Survey|' +
    'United States Geological Survey|British Geological Survey|Geological Survey of Canada|' +
    'World Health Organization|European Union|European Space Agency|International Space Station|' +
    'Hubble Space Telescope|James Webb Space Telescope|Deep Sea Drilling Project|Ocean Drilling Program|' +
    'Integrated Ocean Drilling Program|International Ocean Discovery Program|Paleobiology Database|' +
    'Penrose Medal|Nobel Prize|Open University|Museum of Comparative Zoology|Museum of Paleontology|' +
    'West Indies|British West Indies|Grand Cayman|Massif Central|Lost City|Petrified Forest|Swift Current|' +
    'Hot Springs|Fish Canyon|Canadian Cordillera|North American Cordillera|Lower Silesia|' +
    'Upper Silesia|Vaca Muerta|Sierra Madre Occidental|Sierra Madre Oriental|' +
    'International Commission on Zoological Nomenclature|International Code of Zoological Nomenclature|' +
    'International Commission on Stratigraphy|International Union of Geological Sciences|' +
    'International Mineralogical Association|International Code of Nomenclature|' +
    // Latin phrases written lowercase in sentence case
    'in situ|in vitro|in vivo|in silico|ex situ|ex vivo|de novo|a priori|a posteriori|per se|et al|' +
    'rare earth|rare earths|rare earth element|rare earth elements'
  ].join('');

  // Punctuation after which the next word starts a new "sentence" (APA subtitle rule).
  var SENTENCE_END = /[:?!]$/;                        // colon, ?, !
  var DASH_END = /[—–]$/;                   // em / en dash: only when spaced
  var OPENERS = /[(\[{"“‘'«]$/;       // opening bracket / quote
  var JOINERS = /[-\/‐‑]/;                 // split hyphenated words on these
  var JOINER_SPLIT = /([-\/‐‑])/;
  var TAG_RE = /^<\/?[A-Za-z][^<>]*>/;               // raw HTML tag -> punctuation
  var ENTITY_RE = /^&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;
  var GENUS_END = /(a|e|us|um|is|es|on|ops|ys|x|os|as|ites|ma|ium|oides|mys|don|pus|er)$/;
  var EPITHET_END = /(us|a|um|i|ae|is|ex)$/;
  // Capitalised epithet after a genus ("Drosophila Melanogaster"): also -oides, -orum, -aster
  // and the longer Latin -e endings (-ale, -are, -ense, -ile, -forme); bare -e is too name-like.
  var EPITHET_END_WIDE = /(us|a|um|i|ae|is|ex|oides|orum|aster|[a-z]{3,}(ale|are|ense|ile|forme|oide))$/;
  var GENUS_O = { homo: 1, vibrio: 1, danio: 1, bubo: 1, falco: 1, buteo: 1 };
  // family / order / superfamily names are capitalised even when a word list has them
  var HIGHER_TAXON_RE = /(idae|aceae|oidea|oidae|inae|formes|opoda|ineae|mycetes|phyceae|opsida)$/;

  /* ---------- tiny Set shim (Apps Script legacy runtime has no Set) ---------- */

  function makeSet() {
    if (typeof Set === 'function') return new Set();
    var o = {};
    return {
      has: function (k) { return Object.prototype.hasOwnProperty.call(o, k); },
      add: function (k) { o[k] = 1; return this; }
    };
  }

  function isSetLike(x) { return !!x && typeof x.has === 'function'; }

  // Turn a space-separated string (or array) of words into a Set; the last string is cached.
  var cacheStr = null, cacheSet = null;
  function wordsFrom(src) {
    if (isSetLike(src)) return src;
    if (src === null || src === undefined) return makeSet();
    if (typeof src === 'string' && src === cacheStr) return cacheSet;
    var list = typeof src === 'string' ? src.split(/\s+/) : src;
    var set = makeSet();
    if (list[0] === '~fc1') {
      // front-coded list (tools/build-common-words.py): each entry is <n><rest>, where the
      // digit/letter n (0-9, A-Z = 10-35) counts the characters shared with the previous word
      var prev = '';
      for (var f = 1; f < list.length; f++) {
        var e = list[f]; if (!e) continue;
        var n = parseInt(e.charAt(0), 36);
        prev = prev.slice(0, n) + e.slice(1);
        set.add(prev);
      }
    } else {
      for (var i = 0; i < list.length; i++) if (list[i]) set.add(String(list[i]).toLowerCase());
    }
    if (typeof src === 'string') { cacheStr = src; cacheSet = set; }
    return set;
  }
  function setOf(str, keepCase) {
    var list = str.split(/\s+/), set = makeSet();
    for (var i = 0; i < list.length; i++) if (list[i]) set.add(keepCase ? list[i] : list[i].toLowerCase());
    return set;
  }

  var FUNCTION_SET = setOf(FUNCTION_WORDS);
  var SMALL_SET = setOf(SMALL_WORDS);
  var BREAKER_SET = setOf(BREAKERS);
  var HEAD_SET = setOf(HEAD_WORDS);
  var TIME_HEAD_SET = setOf(TIME_HEADS);
  var STRAT_HEAD_SET = setOf(STRAT_HEADS);
  var GEO_TIME_SET = setOf(GEO_TIME);
  var X_HEAD_SET = setOf(X_HEADS);
  var X_FREE_SET = setOf(X_HEADS_FREE);
  var X_STOP_SET = setOf(X_STOP);
  var PREFIX_SET = setOf(PREFIX_WORDS);
  var LABEL_SET = setOf(LABEL_NOUNS);
  var ABBREV_SET = setOf(ABBREVIATIONS);
  var ELEMENT_SET = setOf(ELEMENTS, true);
  var AMBIG_EL_SET = setOf(AMBIG_ELEMENTS, true);
  var UNIT_SET = setOf(UNITS);
  var HPREFIX_SET = setOf(HYPHEN_PREFIXES);
  var PROPER_PLURAL_SET = setOf(PROPER_PLURALS);
  var AMBIG_PLURAL_SET = setOf(AMBIG_PLURALS);
  var NOT_GENUS_SET = setOf(NOT_GENUS);
  var OPENER_SET = setOf(OPENER_WORDS);
  var OPENER_STRICT_SET = setOf(OPENER_STRICT);
  var PLACE_EPITHET_SET = setOf(PLACE_EPITHETS);
  var NAME_STOP_SET = setOf(NAME_STOP);
  var NAME_PARTICLE_SET = setOf(NAME_PARTICLES);
  var SURNAME_SET = setOf(SURNAMES);
  var CHEM_SET = setOf(CHEM_CONTEXT);
  var LEAD_IN_LIST = (function () {
    var l = [];
    for (var i = 0; i < LEAD_INS.length; i++) l.push(LEAD_INS[i].split(' '));
    l.sort(function (a, b) { return b.length - a.length; });
    return l;
  })();
  var INSTITUTION_SET = setOf(INSTITUTION_WORDS);
  var GEO_OF_SET = setOf(GEO_OF_WORDS);
  var COMPOUND_SET = (function () {
    var o = {};
    for (var k in COMPOUND_HEADS) if (Object.prototype.hasOwnProperty.call(COMPOUND_HEADS, k)) o[k] = setOf(COMPOUND_HEADS[k]);
    return o;
  })();
  var LITHO_HEAD_SET = setOf('complex suite intrusion pluton batholith dyke dike sill swarm');
  function compoundHead(mod, head) {
    if (!mod || !head) return false;
    if (Object.prototype.hasOwnProperty.call(COMPOUND_SET, mod) && COMPOUND_SET[mod].has(singular(head))) return true;
    // rock name + intrusion head after a name ("Wajilitage Carbonatite Complex", "Skaergaard Layered Intrusion")
    return LITHO_HEAD_SET.has(singular(head)) && /(ite|ites|olite|gabbro|basalt|alkaline|ophiolite|granitoid|layered|anorthosite)$/.test(mod);
  }

  // phrase index: first word (lowercase) -> [{ low: [...], canon: [...] }], longest first
  var PHRASE_INDEX = (function () {
    var idx = {}, list = PHRASES.split('|');
    for (var i = 0; i < list.length; i++) {
      var canon = list[i].split(' '), low = [];
      for (var k = 0; k < canon.length; k++) low.push(canon[k].toLowerCase());
      var f = low[0];
      if (!Object.prototype.hasOwnProperty.call(idx, f)) idx[f] = [];
      idx[f].push({ low: low, canon: canon });
    }
    for (var key in idx) if (Object.prototype.hasOwnProperty.call(idx, key)) {
      idx[key].sort(function (a, b) { return b.low.length - a.low.length; });
    }
    return idx;
  })();

  function resolveWords(opts) {
    var src = opts && opts.words;
    if (src === undefined && typeof root.AutoDOI_COMMON_WORDS === 'string') src = root.AutoDOI_COMMON_WORDS;
    var set = wordsFrom(src);
    // the function words are always "common", whatever list the caller passed
    if (set.has('the')) return set;
    return { has: function (k) { return set.has(k) || FUNCTION_SET.has(k); } };
  }

  function hasWordList(opts) {
    var src = opts && opts.words;
    if (src === undefined && typeof root.AutoDOI_COMMON_WORDS === 'string') src = root.AutoDOI_COMMON_WORDS;
    return src !== undefined && src !== null;
  }

  function resolveProtect(opts) {
    var p = opts && opts.protect;
    if (!p) return null;
    if (isSetLike(p)) return p;
    var list = typeof p === 'string' ? p.split(/\s+/) : p, set = makeSet(); // exact case, no lowercasing
    for (var i = 0; i < list.length; i++) if (list[i]) set.add(String(list[i]));
    return set;
  }

  /* ---------- character helpers ---------- */

  function isSpace(c) { return /\s/.test(c); }
  function isDigit(c) { return c >= '0' && c <= '9'; }
  function isLetter(c) {
    if (c.toLowerCase() !== c.toUpperCase()) return true;               // cased letters (Latin, Greek, Cyrillic...)
    return /[ªºƻǀ-ǃʔ]/.test(c);            // a few caseless letters
  }
  function isWordChar(c) { return isLetter(c) || isDigit(c); }
  function isUpper(c) { return isLetter(c) && c === c.toUpperCase() && c !== c.toLowerCase(); }
  function hasUpper(s) { for (var i = 0; i < s.length; i++) if (isUpper(s.charAt(i))) return true; return false; }
  function hasLower(s) { for (var i = 0; i < s.length; i++) { var c = s.charAt(i); if (isLetter(c) && c === c.toLowerCase() && c !== c.toUpperCase()) return true; } return false; }
  function hasDigit(s) { return /\d/.test(s); }

  // Case mapping that never changes the string length: characters whose mapping is not a
  // single code unit (ß -> SS, ﬁ -> FI, İ -> i̇) or that are titlecase digraphs (ǅ) are kept.
  function mapChar(c, up) {
    var m = up ? c.toUpperCase() : c.toLowerCase();
    if (m.length !== c.length) return c;
    if (c !== c.toUpperCase() && c !== c.toLowerCase()) return c;    // titlecase letter (ǅ, ǈ, ǋ)
    return m;
  }
  function safeLower(s) { var o = ''; for (var i = 0; i < s.length; i++) o += mapChar(s.charAt(i), false); return o; }
  function capitalise(s) { return s ? mapChar(s.charAt(0), true) + s.slice(1) : s; }

  /* ---------- tokenizer ---------- */

  function markupAt(s, i) {
    var c = s.charAt(i), m;
    if (c === '<') { m = TAG_RE.exec(s.slice(i, i + 400)); return m ? m[0].length : 0; }
    if (c === '&') { m = ENTITY_RE.exec(s.slice(i, i + 40)); return m ? m[0].length : 0; }
    return 0;
  }

  // Splits a title into word / punct / space tokens. Hyphens, apostrophes, periods and
  // slashes stay inside a word only when a word character follows them ("Early-Middle",
  // "Darwin's", "U.S", "C/N"); everything else becomes a separate punct token. Raw HTML
  // tags ("<i>", "</sup>") and entities ("&amp;") are punct tokens and are never altered.
  function tokenize(title) {
    var s = String(title == null ? '' : title), n = s.length, toks = [], i = 0, j, c, L;
    while (i < n) {
      c = s.charAt(i);
      if (isSpace(c)) {
        j = i; while (j < n && isSpace(s.charAt(j))) j++;
        toks.push({ text: s.slice(i, j), changed: false, kind: 'space' });
      } else if (isWordChar(c)) {
        j = i;
        while (j < n) {
          var d = s.charAt(j);
          if (isWordChar(d)) { j++; continue; }
          if ((JOINERS.test(d) || d === "'" || d === '’' || d === '.') && j + 1 < n && isWordChar(s.charAt(j + 1))) { j++; continue; }
          break;
        }
        toks.push({ text: s.slice(i, j), changed: false, kind: 'word' });
      } else if ((L = markupAt(s, i))) {
        j = i + L;
        toks.push({ text: s.slice(i, j), changed: false, kind: 'punct' });
      } else {
        j = i + 1;
        while (j < n && !isSpace(s.charAt(j)) && !isWordChar(s.charAt(j)) && !markupAt(s, j)) j++;
        toks.push({ text: s.slice(i, j), changed: false, kind: 'punct' });
      }
      i = j;
    }
    return toks;
  }

  /* ---------- dictionary lookup ---------- */

  // Lowercase lookup key for one hyphen part: drops a possessive 's and inner periods.
  function lookupKey(part) {
    return part.toLowerCase().replace(/['’]s?$/, '').replace(/\./g, '');
  }

  // Is `key` (already lowercase) a common word? Falls back to stripping regular
  // -s/-es/-ies, -ing, -ed and -ly endings so that the stored list need not contain
  // inflections ("placentals" -> "placental", "scoping" -> "scope"). A stripped stem
  // must be a real content word: at least 3 letters ("maps" -> "map", "gases" -> "gas")
  // and never a function word ("Andes" is not "and" + "es"); curated plural names
  // ("Wales", "Paris", "Alps", "Holmes") are never common.
  function isCommon(key, words) {
    if (!key || !/^[a-zß-ÿĀ-ɏ]+$/.test(key)) return false;
    if (PROPER_PLURAL_SET.has(key)) return false;
    if (words.has(key)) return true;
    if (key.length < 4) return false;
    // "!potts", "!hans", "!dolores": a surname / place whose stem is a common word
    if (words.has('!' + key)) return false;
    var stems = [], b;
    if (key.length > 4 && /ies$/.test(key)) stems.push(key.slice(0, -3) + 'y');
    if (/[^s]s$/.test(key)) {
      if (key.length - 1 >= 3) stems.push(key.slice(0, -1));
      if (/es$/.test(key)) stems.push(key.slice(0, -2));
    }
    if (key.length > 5 && /ing$/.test(key)) {
      b = key.slice(0, -3); stems.push(b, b + 'e');
      if (/(.)\1$/.test(b)) stems.push(b.slice(0, -1));
    }
    if (key.length > 4 && /ed$/.test(key)) {
      b = key.slice(0, -2); stems.push(b, b + 'e');
      if (/ied$/.test(key)) stems.push(key.slice(0, -3) + 'y');
      if (/(.)\1$/.test(b)) stems.push(b.slice(0, -1));
    }
    if (key.length > 5 && /ly$/.test(key)) {
      stems.push(key.slice(0, -2));
      if (/ily$/.test(key)) stems.push(key.slice(0, -3) + 'y');
    }
    for (var i = 0; i < stems.length; i++) {
      var st = stems[i];
      if (st.length >= 3 && !FUNCTION_SET.has(st) && words.has(st)) return true;
    }
    return false;
  }

  /* ---------- technical vocabulary by morphology ---------- */

  // A word the list does not know is kept capitalised (it may be a name), unless its
  // form marks it as technical common vocabulary: mineral and rock names (-ite, -lith,
  // -cryst), process nouns (-genesis, -ism, -osis, -ation, -metry), adjectives (-ic,
  // -ical, -itic, -ous), taxon-derived common nouns (-id, -oid, -odont, -saur, -morph,
  // -iform), drugs and enzymes (-mab, -tinib, -azole, -ase), or a scientific prefix
  // before a common word ("Metabasalts", "Polymetamorphism", "Micromammals").
  // Known names (^marker in the word list, eras, curated proper adjectives) never are.
  var TECH_RE = new RegExp('(' + [
    'genesis', 'genetic', 'genic', 'isms?', 'olog(y|ies|ical|ic|ically)', 'osis', 'oses', 'itis',
    'ations?', 'i[sz]ations?', 'metry', 'metric', 'graph(y|ic|ical)', 'ivity', 'phytes?', 'cytes?',
    'blasts?', 'blastic', 'plasty', 'ectom(y|ies)', 'oids?', 'oidal', 'odonts?', 'saurs?', 'saurians?',
    'morphs?', 'morphic', 'iforms?', 'pterygians?', 'odontians?', 'ischians?', 'ichthyans?',
    'mabs?', 'nibs?', 'azoles?', 'o?xifen', 'mycins?', 'cillins?', 'statins?', 'olol', 'prils?',
    'sartans?', 'oxacins?', 'cyclines?', 'prazoles?', 'dipines?', 'platins?', 'rubicins?', 'profen',
    'amines?', 'amides?', 'oxamines?', 'ases', 'inases?', 'erases?', 'drases?', 'lases?', 'tases?',
    'onates?', 'ylates?', 'oates?', 'peptides?', 'capsids?', 'somes?', 'liths?', 'lithic', 'crysts?',
    'crystic', 'ites', 'ite', 'itic', 'otic', 'atic', 'ical', 'ic', 'ous', 'ids?', 'yls?',
    'less', 'ness', 'ities', 'ity', 'therap(y|ies)', 'azines?', 'idines?', 'osines?', 'yrins?', 'inols?', 'anols?', 'idates?',
    '(di|tri|tetra|penta|hexa|hepta|octa|oligo|poly|mono|iso|homo|hetero|dodeca)mers?'
  ].join('|') + ')$');
  // "-ic"/"-ite"/"-id"/"-ism" words that are proper (capitalised in APA)
  var PROPER_TECH = setOf('atlantic pacific arctic antarctic baltic adriatic asiatic semitic hamitic hellenic ' +
    'olympic arabic islamic celtic germanic nordic icelandic pontic balearic hispanic slavic gaelic coptic ' +
    'amharic turkic vedic cyrillic homeric socratic hippocratic hesperic aeolic doric ionic attic punic ' +
    'jurassic triassic liassic israelite canaanite mennonite luddite hittite jacobite moabite levite ' +
    'marguerite abbasid fatimid ayyubid safavid timurid perseid perseids leonid leonids geminid geminids ' +
    'orionid orionids quadrantid quadrantids lyrid lyrids taurid taurids draconid draconids ' +
    'darwinism lamarckism marxism buddhism hinduism judaism calvinism taoism confucianism catholicism ' +
    'protestantism lysenkoism stalinism maoism thatcherism victorian edwardian ' +
    'mosaic gothic byzantine betic subbetic penibetic taconic reunion laramide intertrappean');
  var TECH_PREFIX_RE = /^(anti|auto|bio|chemo|counter|cryo|electro|endo|epi|exo|extra|geo|hemi|hetero|hydro|hyper|hypo|immuno|inter|intra|iso|leuco|leuko|macro|magneto|mega|melano|meso|meta|micro|milli|mono|multi|nano|neo|non|ortho|palaeo|paleo|para|peri|petro|photo|pico|poly|post|pre|proto|pseudo|pyro|radio|semi|sub|super|supra|tetra|thermo|trans|tri|ultra|under|over|uni|de|re|un|nucleo|aza|di)(.+)$/;

  function techSuffixOk(key, suf, words) {
    if (/^(ness|less)$/.test(suf)) {                 // only on a common stem ("Encoderless")
      var st = key.slice(0, -4);
      return st.length >= 4 && (isCommon(st, words) || isCommon(st + 'e', words));
    }
    if (/^(ity|ities)$/.test(suf)) {                 // "Radiosensitivity", "Nonuniformity"
      var b = key.replace(/it(y|ies)$/, '');
      return b.length >= 5 && (isTechWord(b, words) || isTechWord(b + 'e', words));
    }
    if ((suf === 'ic' || suf === 'ous') && key.length < 7) return false;
    if (/^ids?$/.test(suf) && (key.length < 7 || (/[aeiou]{2}ids?$/.test(key) && !/(iid|eid)s?$/.test(key)))) return false;
    if (/^yls?$/.test(suf) && key.length < 8) return false;
    if (/^somes?$/.test(suf) && key.length < 9) return false;
    return true;
  }

  // key: lowercase part. True when the capitalised word is technical common vocabulary.
  function isTechWord(key, words) {
    if (!key || key.length < 6 || !/^[a-zß-ÿĀ-ɏ]+$/.test(key)) return false;
    if (words.has('^' + key) || words.has('!' + key) || PROPER_TECH.has(key) || PROPER_PLURAL_SET.has(key) ||
        GEO_TIME_SET.has(key) || NOT_GENUS_SET.has(key)) return false;
    if (/zoic$/.test(key) || /idae$/.test(key) || /inae$/.test(key) || /ini$/.test(key) || /oidea$/.test(key)) return false;
    if (/(vic|cic|zic|jic)$/.test(key)) return false;                  // Slavic surnames (Petrovic, Kovacic)
    var m = TECH_RE.exec(key);
    if (m && techSuffixOk(key, m[1], words)) return true;
    // scientific prefix + a common (or technical) word of 5+ letters
    var p = TECH_PREFIX_RE.exec(key);
    if (p && p[2].length >= 5 && !/(a|us|um|ia|is|ops|odon|saurus|ella|ina)$/.test(p[2])) {
      var rest = p[2];
      if (isCommon(rest, words) || (rest.charAt(0) === 'o' && isCommon(rest.slice(1), words))) return true;
      var p2 = TECH_PREFIX_RE.exec(rest);
      if (p2 && p2[2].length >= 5 && isCommon(p2[2], words)) return true;
    }
    return false;
  }

  function singular(key) { return key.length > 3 && /[^s]s$/.test(key) ? key.slice(0, -1) : key; }
  function inSet(set, key) { return set.has(key) || set.has(singular(key)); }

  /* ---------- classification ---------- */

  // Class of one hyphen part:
  //   protected  in opts.protect (exact match)            -> never touched, anchors a run
  //   fixed      digits, single letter, all-caps, inner capital, element symbols and
  //              other capitalised 2-letter non-words, units (DNA, NaCl, pH, Pb, Ma, Pg)
  //   lower      already all lowercase
  //   breaker    capitalised function word (Of, The, With) -> always lowercased mid-title
  //   candidate  capitalised common word                   -> lowercased unless part of a name
  //   unknown    capitalised word not in the list          -> kept, anchors its run
  function classifyPart(part, words, protect) {
    if (protect && protect.has(part)) return 'protected';
    if (hasDigit(part)) return 'fixed';
    var first = part.charAt(0), rest = part.slice(1);
    if (!isUpper(first)) return hasUpper(rest) ? 'fixed' : 'lower';
    if (part.length === 1) return 'fixed';
    if (hasUpper(rest)) return /^(Mc|Mac)[A-Z][a-z]/.test(part) || /^O['’][A-Z][a-z]/.test(part) ? 'unknown' : 'fixed';
    var key = lookupKey(part);
    if (BREAKER_SET.has(key)) return 'breaker';
    if (key.length >= 7 && HIGHER_TAXON_RE.test(key)) return 'unknown';       // Sphaeriidae, Trilliaceae, Tettigonoidea
    if (isCommon(key, words)) return 'candidate';
    if (part.length <= 2 || UNIT_SET.has(key)) return 'fixed';
    if (isTechWord(key, words)) return 'tech';
    return 'unknown';
  }

  // Splits a word token into parts + separators and classifies each part.
  function analyse(text, words, protect) {
    var pieces = text.split(JOINER_SPLIT), parts = [], cls = [], i;
    var tech = false;
    for (i = 0; i < pieces.length; i += 2) {
      parts.push(pieces[i]);
      var c = classifyPart(pieces[i], words, protect);
      if (c === 'tech') { c = 'candidate'; tech = true; }   // technical vocabulary: lowercased like a list word
      cls.push(c);
    }
    // "Re-Evaluation", "Bi-Copter": a short capitalised prefix before a real word part
    if (parts.length > 1 && (cls[0] === 'fixed' || cls[0] === 'unknown') && isUpper(parts[0].charAt(0)) && !hasUpper(parts[0].slice(1)) &&
        HPREFIX_SET.has(parts[0].toLowerCase()) && parts[1].length > 2 && (cls[1] === 'candidate' || cls[1] === 'unknown' || cls[1] === 'lower')) {
      cls[0] = 'candidate';
    }
    var info = { pieces: pieces, parts: parts, cls: cls, whole: 'neutral', tech: tech };
    wholeClass(info);
    return info;
  }

  function wholeClass(info) {
    var cls = info.cls, hasCand = false, hasBreak = false, hasAnchor = false;
    for (var i = 0; i < cls.length; i++) {
      if (cls[i] === 'candidate') hasCand = true;
      else if (cls[i] === 'breaker') hasBreak = true;
      else if (cls[i] === 'unknown' || cls[i] === 'protected' || cls[i] === 'phrase') hasAnchor = true;
    }
    if (hasAnchor) info.whole = 'anchor';
    else if (hasCand) info.whole = 'candidate';
    else if (hasBreak) info.whole = cls.length === 1 ? 'breaker' : 'candidate';
    else info.whole = 'neutral';
  }

  function isKeptCls(c) { return c === 'unknown' || c === 'protected' || c === 'phrase' || c === 'fixed'; }

  // Rebuilds the word text, lowercasing candidate/breaker parts (skipping the first part
  // when keepFirst is set, i.e. at a sentence start). For a kept token (anchor) only the
  // candidate parts that are not name parts are lowercased ("Insectivoran-Grade" ->
  // "Insectivoran-grade", "Mid-Cretaceous" -> "mid-Cretaceous", but "Early-Middle" and
  // "Hell-Creek"-style prefix/head parts stay).
  function lowerParts(info, keepFirst, anchorMode) {
    var out = '', k = 0, n = info.parts.length;
    for (var i = 0; i < info.pieces.length; i++) {
      if (i % 2 === 1) { out += info.pieces[i]; continue; }
      var c = info.cls[k], p = info.parts[k], idx = k; k++;
      if (c !== 'candidate' && c !== 'breaker') { out += p; continue; }
      if (keepFirst && idx === 0) { out += p; continue; }
      if (anchorMode) {
        var key = lookupKey(p), later = false, m;
        for (m = idx + 1; m < n; m++) if (info.cls[m] === 'unknown' || info.cls[m] === 'protected' || info.cls[m] === 'phrase') later = true;
        if (PREFIX_SET.has(key) && later) { out += p; continue; }
        if (idx > 0 && inSet(HEAD_SET, key) && (info.cls[idx - 1] === 'unknown' || info.cls[idx - 1] === 'protected' || info.cls[idx - 1] === 'phrase')) { out += p; continue; }
      }
      out += safeLower(p);
    }
    return out;
  }

  // Index of the previous / next non-space token, or -1.
  function prevSolid(toks, i) {
    for (var j = i - 1; j >= 0; j--) if (toks[j].kind !== 'space') return j;
    return -1;
  }
  function nextSolid(toks, i) {
    for (var j = i + 1; j < toks.length; j++) if (toks[j].kind !== 'space') return j;
    return -1;
  }

  // Does the full stop at toks[j] end a sentence? Not after abbreviations ("e.g.", "et al.",
  // "St.", "sp.", "n. gen."), initials ("J.") or dotted words ("U.S."), and only when a space
  // follows it.
  function isFullStop(toks, j, i) {
    var t = toks[j].text;
    if (t.charAt(t.length - 1) !== '.' || /\.\.$/.test(t)) return false;
    if (j >= i - 1) return false;                                   // must be followed by a space
    if (t.length > 1 && !/^[)\]"'”’]+\.$/.test(t)) return false;
    var w = j - 1;
    if (t.length > 1) { /* closing bracket before the stop: look at the word before it */ }
    if (w < 0 || toks[w].kind !== 'word') return t.length > 1;
    var word = toks[w].text;
    if (word.indexOf('.') >= 0) return false;                        // U.S, e.g
    if (word.length === 1 && isLetter(word)) return false;           // initial "J."
    if (ABBREV_SET.has(word.toLowerCase())) return false;
    return true;
  }

  // True when the word at toks[i] starts a sentence: first word, or after : ? ! , a spaced
  // dash, or a full stop. Opening brackets and quotes are neutral.
  function isSentenceStart(toks, i, seenWord) {
    if (!seenWord) return true;
    var j = prevSolid(toks, i);
    if (j < 0 || toks[j].kind !== 'punct') return false;
    var t = toks[j].text;
    if (SENTENCE_END.test(t)) return true;
    if (DASH_END.test(t)) return j < i - 1 || (j > 0 && toks[j - 1].kind === 'space');
    return isFullStop(toks, j, i);
  }

  function isDoubleQuote(t) { return /^["“”]+$/.test(t); }

  /* ---------- context helpers ---------- */

  // Chemical formula / element-ish token: "Pb", "CO2", "Fe3", "K", "NaCl", "H2O".
  function isFormulaTok(t) {
    if (!t || t.length > 14) return false;
    if (AMBIG_EL_SET.has(t)) return false;
    if (!/^([A-Z][a-z]?\d*)+[+\-]?$/.test(t)) return false;
    return t.length === 1 || ELEMENT_SET.has(t) || /\d/.test(t) || (t.match(/[A-Z]/g) || []).length >= 2;
  }

  // "As", "In", "He", "Be", "At", "No" as element symbols: in a list of symbols
  // ("Pb, As and Cd", "He, Ne, Ar", "As and Pb") or before an oxidation state ("As(III)").
  // An unambiguous chemistry token anywhere in the title: a two-letter element symbol that is
  // not a word ("Pb", "Sr"), an isotope ("40Ar", "3He") or a formula ("Fe2O3", "NaCl", "CO2").
  function isChemToken(t) {
    if (!t || t.length > 14 || AMBIG_EL_SET.has(t)) return false;
    if (ELEMENT_SET.has(t)) return true;
    var iso = /^\d+([A-Z][a-z]?)$/.exec(t);
    if (iso) return EL_BY_UPPER[iso[1].toUpperCase()] === iso[1];
    if (!/^([A-Z][a-z]?\d*){2,}$/.test(t) || !/[a-z\d]/.test(t)) return false;
    var segs = t.match(/[A-Z][a-z]?/g);
    for (var k = 0; k < segs.length; k++) if (EL_BY_UPPER[segs[k].toUpperCase()] !== segs[k]) return false;
    return true;
  }
  function titleHasChem(toks) {
    for (var k = 0; k < toks.length; k++) {
      if (toks[k].kind !== 'word') continue;
      var parts = toks[k].text.split(JOINER_SPLIT);
      for (var q = 0; q < parts.length; q += 2) if (isChemToken(parts[q])) return true;
    }
    return false;
  }

  function isElementContext(toks, i, chem) {
    var n = toks.length;
    if (i + 1 < n && toks[i + 1].kind === 'punct') {
      var nt = toks[i + 1].text;
      if (/^[+⁺⁻]/.test(nt) || /^[−-]$/.test(nt)) return true;
      if (nt === '(' && i + 2 < n && /^(I|II|III|IV|V|VI|VII|0)$/.test(toks[i + 2].text)) return true;
    }
    function sym(k) { return k >= 0 && toks[k].kind === 'word' && isFormulaTok(toks[k].text); }
    function link(k) {
      if (k < 0) return false;
      if (toks[k].kind === 'punct') return /^[,\/;(]$/.test(toks[k].text) || toks[k].text === ')' ;
      return /^(and|or|And|Or|AND|OR)$/.test(toks[k].text);
    }
    var p = prevSolid(toks, i);
    if (link(p) && toks[p].text !== ')' && sym(prevSolid(toks, p))) return true;
    var q = nextSolid(toks, i);
    if (q >= 0 && link(q) && toks[q].text !== '(' && sym(nextSolid(toks, q))) return true;
    // "Diffusion Of He In Olivine": after "of", "in", "with", "and", "or" or "/", and before "in",
    // "and", "or", a separator or a chemistry word (or anywhere chemical in a chemical title)
    var pv = p >= 0 && ((toks[p].kind === 'word' && p === i - 2 && /^(of|in|with|and|or)$/i.test(toks[p].text)) ||
      (toks[p].kind === 'punct' && toks[p].text === '/'));
    if (!pv || q < 0) return false;
    var qt = toks[q];
    if (qt.kind === 'punct') return /^[\/,\-–]/.test(qt.text);
    if (qt.kind !== 'word') return false;
    if (/^(in|and|or)$/i.test(qt.text) || CHEM_SET.has(lookupKey(qt.text))) return true;
    return !!chem;
  }

  // Phrase matching: returns an array phrase[i] = canonical part text for matched tokens.
  function matchPhrases(toks) {
    var res = [], i, wordIdx = [];
    for (i = 0; i < toks.length; i++) if (toks[i].kind === 'word') wordIdx.push(i);
    for (var w = 0; w < wordIdx.length; w++) {
      var ti = wordIdx[w], t = toks[ti].text;
      if (!isUpper(t.charAt(0)) || (t.length > 1 && !hasLower(t))) continue;
      var first = t.split(JOINER_SPLIT)[0].toLowerCase();
      var cands = PHRASE_INDEX[first];
      if (!cands || !Object.prototype.hasOwnProperty.call(PHRASE_INDEX, first)) continue;
      for (var c = 0; c < cands.length; c++) {
        var ph = cands[c], m = ph.low.length, ok = true, pos = [];
        for (var k = 0; k < m && ok; k++) {
          var wi = w + k;
          if (wi >= wordIdx.length) { ok = false; break; }
          var tk = wordIdx[wi];
          if (k > 0 && !(tk === wordIdx[wi - 1] + 2 && toks[tk - 1].kind === 'space' && toks[tk - 1].text === ' ')) { ok = false; break; }
          var txt = toks[tk].text, isLast = k === m - 1;
          var cmp = (isLast || k === 0) ? txt.split(JOINER_SPLIT)[0] : txt;
          if ((k === 0 && m > 1 && cmp !== txt) || (!isLast && k > 0 && cmp !== txt)) { ok = false; break; }
          if (cmp.toLowerCase() !== ph.low[k]) { ok = false; break; }
          if (cmp.length > 1 && !hasLower(cmp) && cmp !== ph.canon[k]) { ok = false; break; }            // all-caps: not ours to recase
          pos.push({ tok: tk, canon: ph.canon[k], partial: cmp !== txt });
        }
        if (ok && m > 1) {
          for (var p = 0; p < pos.length; p++) res[pos[p].tok] = pos[p];
          w += m - 1;
          break;
        }
      }
    }
    return res;
  }

  var YEAR_RE = /^(1[5-9]\d\d|20\d\d)[a-z]?$/;
  function isAuthorCitation(toks, i) {
    var a = nextSolid(toks, i);
    if (a < 0) return false;
    if (toks[a].text === ',' ) { var y = nextSolid(toks, a); return y >= 0 && YEAR_RE.test(toks[y].text); }
    if (/^(and|&|et)$/.test(toks[a].text)) {
      var b = nextSolid(toks, a);
      if (b < 0 || toks[b].kind !== 'word' || !isUpper(toks[b].text.charAt(0))) return false;
      var c = nextSolid(toks, b);
      if (c < 0 || toks[c].text !== ',') return false;
      var d = nextSolid(toks, c);
      return d >= 0 && YEAR_RE.test(toks[d].text);
    }
    return false;
  }
  var NUMBERED_LABELS = { part: 1, volume: 1, vol: 1, chapter: 1, section: 1, book: 1, appendix: 1, supplement: 1, number: 1 };
  function isNumberedLabel(toks, i) {
    if (!NUMBERED_LABELS[lookupKey(toks[i].text)]) return false;
    var a = nextSolid(toks, i);
    return a === i + 2 && toks[a].kind === 'word' && /^(\d+[A-Za-z]?|[IVXLC]+|[A-Z])$/.test(toks[a].text);
  }

  function isHeadKey(key) { return inSet(HEAD_SET, key); }
  function isGeoTime(key) { return GEO_TIME_SET.has(key); }

  // "Lake Superior", "Point Barrow": the word after a strict opener is a name when it is unknown
  // or a curated place epithet / surname; never a plural ("Lake Sediments").
  function openerNameOk(e) {
    if (e.anchor || e.phrase) return true;
    var key = e.key || '';
    return !!key && !/s$/.test(key) && (PLACE_EPITHET_SET.has(key) || SURNAME_SET.has(key));
  }

  // Sentence-start token i: does a lead-in phrase ("Obituary", "Comments On") start here? When it
  // does, the following run of 1-4 capitalised name-like words (unknown to the list or a frequent
  // surname, joined by "and", "&", initials and particles) is marked in `zone`. Any common
  // title word ("Recent", "Geology"), lowercase word or punctuation ends the name; a run that
  // contains a non-name common word is not a name at all ("Review Of Recent Advances").
  function markLeadInNames(toks, i, words, zone) {
    var j, m, w, best = 0;
    for (var L = 0; L < LEAD_IN_LIST.length && !best; L++) {
      var ph = LEAD_IN_LIST[L];
      for (j = i, m = 0; m < ph.length; m++) {
        if (j >= toks.length || toks[j].kind !== 'word' || toks[j].text.toLowerCase() !== ph[m]) break;
        if (m < ph.length - 1 && !(toks[j + 1] && toks[j + 1].text === ' ')) break;
        j += 2;
      }
      if (m === ph.length) best = j;
    }
    if (!best) return;
    j = best;
    if (j < toks.length && toks[j].kind === 'space') j++;
    if (j < toks.length && toks[j].kind === 'punct' && /^[:—–\-,]$/.test(toks[j].text)) j++;
    var names = [], count = 0, pending = [];
    for (; j < toks.length; j++) {
      var t = toks[j];
      if (t.kind === 'space') { if (t.text !== ' ') break; continue; }
      if (t.kind === 'punct') {
        if (t.text === '&' && count) { pending.push(j); continue; }
        if (t.text === '.' && names.length && toks[j - 1].kind === 'word' && toks[j - 1].text.length === 1) continue;   // initial "J."
        break;
      }
      w = t.text;
      if (!isUpper(w.charAt(0))) {
        if (count && (NAME_PARTICLE_SET.has(w) || w === 'and')) { pending.push(j); continue; }   // 'Baker and White'
        break;
      }
      if (w.length === 1) { if (toks[j + 1] && toks[j + 1].text === '.') { names.push(j); pending = []; continue; } break; }
      if (!hasLower(w) || hasUpper(w.slice(1)) || hasDigit(w) || JOINERS.test(w)) break;
      var key = lookupKey(w);
      if (BREAKER_SET.has(key)) { if (key === 'and' && count) { pending.push(j); continue; } break; }
      if (key === 'et' || key === 'al') break;
      if (NAME_STOP_SET.has(key)) return;
      if (isCommon(key, words) && !SURNAME_SET.has(key)) return;
      if (++count > 4) return;
      names.push(j); pending = [];
    }
    if (!count) return;
    for (m = 0; m < names.length; m++) zone[names[m]] = true;
  }

  /* ---------- sentence case ---------- */

  // The converter proper. Returns { toks, meta } where meta[i] (for word tokens) records
  // whether the token was eligible for detection and whether it was lowercased.
  function convert(title, opts) {
    var words = resolveWords(opts), protect = resolveProtect(opts);
    var toks = tokenize(title), infos = [], meta = [], i;
    var phrase = matchPhrases(toks);
    var run = [], seenWord = false, inQuote = false;
    var chemTitle = titleHasChem(toks);
    var nameZone = {};        // token index -> true: capitalised word of a personal name after a lead-in
    var instChain = 0;       // "Museum of Comparative Zoology": 1 = institution head seen, 2 = inside its "of" name

    function entryKey(e) { var ps = e.info.parts; return lookupKey(ps[ps.length - 1]); }

    // run: consecutive capitalised word tokens (candidates, anchors and the sentence-start
    // word). decide() works out which of them are parts of a name.
    function flush() {
      if (!run.length) return;
      var n = run.length, kept = [], via = [], r, e, changed = true, guard = 0;
      for (r = 0; r < n; r++) {
        e = run[r]; e.key = entryKey(e);
        kept[r] = !!(e.anchor || e.phrase || e.whole);
        via[r] = kept[r] ? 'a' : '';
      }
      function single(e) { return e.info.parts.length === 1; }
      // a run right after "the" or punctuation reads as a name ("the Hare Fiord Formation",
      // "(Heath Formation"); after "of", "in", "and" as a process ("of ... Reaction Rim Formation")
      var pth = prevSolid(toks, run[0].i), afterThe = pth < 0 || toks[pth].kind !== 'word' || /^the$/i.test(toks[pth].text);
      function allPrefix(e) {
        for (var k = 0; k < e.info.parts.length; k++) {
          if (e.info.cls[k] !== 'candidate' || !PREFIX_SET.has(lookupKey(e.info.parts[k]))) return false;
        }
        return true;
      }
      function headAllowed(prev, e) {
        var pk = prev.key || '';
        if (isGeoTime(pk)) return inSet(STRAT_HEAD_SET, e.key);
        if (TIME_HEAD_SET.has(e.key)) {
          return (prev.anchor && /ian$/.test(pk)) || pk === 'fault' || pk === 'rift' || pk === 'faults';
        }
        return true;
      }
      while (changed && guard++ < 20) {
        changed = false;
        for (r = 0; r < n; r++) {
          if (kept[r]) continue;
          e = run[r];
          var k = e.key;
          // A: head noun after a kept word
          if (r > 0 && k && isHeadKey(k) && kept[r - 1] && headAllowed(run[r - 1], e)) { kept[r] = true; via[r] = 'h'; changed = true; continue; }
          // A2: adjective + head after a kept word ("McMurdo Volcanic Group", "Sudbury Igneous Complex")
          if (r > 0 && r + 1 < n && kept[r - 1] && !isGeoTime(run[r - 1].key || '') && single(e) && single(run[r + 1]) && compoundHead(k, run[r + 1].key)) {
            kept[r] = true; via[r] = 'h';
            if (!kept[r + 1]) { kept[r + 1] = true; via[r + 1] = 'h'; }
            changed = true; continue;
          }
          // B: name prefix before a kept word ("Late Cretaceous", "Early-Middle Jurassic")
          if (r + 1 < n && kept[r + 1] && allPrefix(e)) { kept[r] = true; via[r] = 'p'; changed = true; continue; }
          // "Gulf of Guinea", "University of Utah": head + of + name
          if (r === n - 1 && k && e.ofName && (inSet(X_HEAD_SET, k) || INSTITUTION_SET.has(k))) { kept[r] = true; via[r] = 'h'; changed = true; continue; }
          // D: name opener + the capitalised word after it ("Mount Baker", "Cape Cod", "Lac Des Iles")
          if (r + 1 < n && single(e) && k && OPENER_SET.has(k) && single(run[r + 1]) && run[r + 1].info.cls[0] !== 'breaker' &&
              (!OPENER_STRICT_SET.has(k) || openerNameOk(run[r + 1]))) {
            kept[r] = true; via[r] = 'p';
            if (!kept[r + 1]) { kept[r + 1] = true; via[r + 1] = 'h'; }
            changed = true; continue;
          }
          if (e.start || !single(e) || !k || X_STOP_SET.has(k)) continue;
          // C: capitalised X + name head ("Mud Hill", "Red Sea", "Vale Formation"); a
          // stratigraphic head only when nothing lowercased precedes X in the run
          // ("Ocean Island Basalt Formation" is basalt formation, not a named unit)
          if (r + 1 < n && !isHeadKey(k) && single(run[r + 1]) && inSet(X_HEAD_SET, run[r + 1].key || '') &&
              !(/^(formation|formations|member|members)$/.test(run[r + 1].key) && (
                (r > 0 && !kept[r - 1] && run[r - 1].key && isHeadKey(run[r - 1].key)) ||
                /(ite|ites|oid|oids|basalt|basalts|gabbro)$/.test(k) ||
                !(afterThe || (r > 0 && (kept[r - 1] || PREFIX_SET.has(run[r - 1].key || '')))) ))) {
            var hk = run[r + 1].key, freeOk = inSet(X_FREE_SET, hk);
            if (!freeOk) {
              var nx = r + 2 < n ? run[r + 2] : null;
              freeOk = !nx || nx.anchor || nx.phrase || (nx.key && isHeadKey(nx.key));
            }
            if (freeOk) {
              kept[r] = true; via[r] = 'x';
              if (!kept[r + 1]) { kept[r + 1] = true; via[r + 1] = 'h'; }
              changed = true; continue;
            }
          }
          // chain: one more capitalised word before an X ("Dinosaur National Monument")
          if (r + 1 < n && via[r + 1] === 'x' && !isHeadKey(k) && !(r + 2 < n && via[r + 2] === 'c')) {
            kept[r] = true; via[r] = 'c'; changed = true; continue;
          }
        }
      }
      // species epithet after an unknown genus: "Tyrannosaurus Rex" -> "Tyrannosaurus rex"
      for (r = 0; r + 1 < n; r++) {
        var g = run[r], s = run[r + 1];
        if ((g.anchor || (g.key === 'homo' && single(g))) && !g.phrase && s.anchor && !s.phrase && single(g) && single(s) && (g.key === 'homo' || looksLikeGenus(g.info.parts[0], g.info.cls[0], words)) &&
            looksLikeEpithet(s.info.parts[0], s.info.cls[0], words) && !(r + 2 < n && run[r + 2].key && isHeadKey(run[r + 2].key))) {
          s.epithet = true;
          if (!kept[r]) { kept[r] = true; via[r] = 'g'; }
        }
      }
      for (r = 0; r < n; r++) {
        e = run[r];
        var t = toks[e.i], txt;
        if (e.whole) txt = t.text;
        else if (e.epithet) txt = safeLower(t.text);
        else if (kept[r]) txt = e.anchor ? lowerParts(e.info, e.start, true) : t.text;
        else txt = lowerParts(e.info, e.start, false);
        if (e.capFirst) txt = capitalise(txt);
        if (txt !== t.text) { t.text = txt; t.changed = true; }
      }
      run = [];
    }

    for (i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (tok.kind === 'space') continue;
      if (tok.kind === 'punct') {
        flush();
        instChain = 0;
        if (isDoubleQuote(tok.text)) inQuote = !inQuote;   // text inside double quotes is left alone
        continue;
      }
      var start = isSentenceStart(toks, i, seenWord);
      seenWord = true;
      var orig = tok.text;
      meta[i] = { start: start, orig: orig, eligible: false };

      if (inQuote) { flush(); continue; }

      // a user-protected token is never touched and anchors its run
      if (protect && protect.has(tok.text)) {
        if (start) flush();
        infos[i] = { pieces: [tok.text], parts: [tok.text], cls: ['protected'], whole: 'anchor' };
        run.push({ i: i, info: infos[i], anchor: true, whole: true, start: start });
        continue;
      }

      var info = analyse(tok.text, words, protect);
      // a lowercase first word is capitalised first and then classified like any
      // capitalised word, so a second pass sees exactly the same thing
      if (start && info.cls[0] === 'lower' && !(protect && protect.has(info.parts[0])) && !isGreek(tok.text.charAt(0))) {
        var cap0 = capitalise(tok.text);
        if (cap0 !== tok.text) { tok.text = cap0; tok.changed = true; info = analyse(tok.text, words, protect); }
      }
      // a geological period / epoch written lowercase ("Ordovician/silurian boundary")
      {
        var gtFix = false;
        for (var gq = 0; gq < info.parts.length; gq++) {
          var gp = info.parts[gq];
          if (info.cls[gq] === 'lower' && GEO_TIME_SET.has(gp) && gp !== 'tertiary' && gp !== 'quaternary') gtFix = true;
        }
        if (gtFix) {
          var gpcs = tok.text.split(JOINER_SPLIT);
          for (var gz = 0; gz < gpcs.length; gz += 2) {
            if (GEO_TIME_SET.has(gpcs[gz]) && gpcs[gz] !== 'tertiary' && gpcs[gz] !== 'quaternary') gpcs[gz] = capitalise(gpcs[gz]);
          }
          var gtxt = gpcs.join('');
          if (gtxt !== tok.text && gtxt.length === tok.text.length) { tok.text = gtxt; tok.changed = true; info = analyse(tok.text, words, protect); }
        }
      }
      infos[i] = info;
      // "Obituary: Peter Green", "Comments On Baker And White": the capitalised words after a
      // memorial / discussion lead-in are a personal name and keep their capitals
      if (start) markLeadInNames(toks, i, words, nameZone);
      if (nameZone[i] && info.parts.length === 1 && info.cls[0] === 'candidate') { info.cls[0] = 'unknown'; wholeClass(info); }
      var ph = phrase[i];
      // words of an institution's "of" name keep their capitals ("Museum of Comparative Zoology")
      if (instChain === 2) {
        if (isUpper(tok.text.charAt(0)) && hasLower(tok.text) && !BREAKER_SET.has(lookupKey(tok.text))) {
          for (var ic = 0; ic < info.cls.length; ic++) if (info.cls[ic] === 'candidate') info.cls[ic] = 'unknown';
          wholeClass(info);
        } else if (!/^(of|and|the|for|&)$/i.test(tok.text)) instChain = 0;
      }
      if (instChain === 1) instChain = /^of$/i.test(tok.text) ? 2 : 0;
      // "St. Helens", "Mt. Everest": abbreviated name prefixes stay as they are
      if (info.parts.length === 1 && info.cls[0] === 'candidate' && i + 1 < toks.length && toks[i + 1].text === '.' &&
          ABBREV_SET.has(lookupKey(tok.text)) && tok.text.length <= 4) {
        info = { pieces: [tok.text], parts: [tok.text], cls: ['fixed'], whole: 'neutral' };
        infos[i] = info;
      }

      // element symbols that are also words: "Pb, As and Cd", "As(III)"
      if (!ph && AMBIG_EL_SET.has(tok.text) && isElementContext(toks, i, chemTitle)) {
        info = { pieces: [tok.text], parts: [tok.text], cls: ['fixed'], whole: 'neutral' };
        infos[i] = info;
      }
      // "Be-Doped", "He-Rich", "In-Bearing": a symbol joined to a chemistry word after "of"/"in"/"with"
      if (!ph && !start && info.parts.length > 1 && AMBIG_EL_SET.has(info.parts[0]) && info.cls[0] !== 'fixed' &&
          (CHEM_SET.has(lookupKey(info.parts[1])) || /^(rich|bearing|free|based|containing|poor)$/i.test(info.parts[1]))) {
        var ep = prevSolid(toks, i);
        if (ep >= 0 && ep === i - 2 && toks[ep].kind === 'word' && /^(of|in|with|and|or)$/i.test(toks[ep].text)) { info.cls[0] = 'fixed'; wholeClass(info); }
      }
      // capital "A" mid-title: the article, unless it is a label ("Vitamin A", "Part A:")
      if (tok.text === 'A' && !start) {
        var nx = nextSolid(toks, i), pv = prevSolid(toks, i);
        var label = nx < 0 || (toks[nx].kind === 'punct' && !OPENERS.test(toks[nx].text.charAt(0)) && !/^</.test(toks[nx].text)) ||
          (pv >= 0 && pv === i - 2 && toks[pv].kind === 'word' && LABEL_SET.has(lookupKey(toks[pv].text)));
        if (!label) info = { pieces: ['A'], parts: ['A'], cls: ['breaker'], whole: 'breaker' };
        infos[i] = info;
      }
      // "(Cope, 1864)", "Marsh, 1890", "Marsh and Cope, 1877": an author citation keeps its capital;
      // "Part 2", "Volume III": a numbered label keeps its capital
      if (info.parts.length === 1 && info.cls[0] === 'candidate' && (isAuthorCitation(toks, i) || isNumberedLabel(toks, i))) {
        info.cls[0] = LABEL_SET.has(lookupKey(info.parts[0])) ? 'fixed' : 'unknown';
        wholeClass(info);
      }
      // "Homo erectus": the genus Homo is also a common word
      // any common-looking Latin word before a lowercase epithet is a genus ("Aconaemys fuscus")
      if (info.parts.length === 1 && info.cls[0] === 'candidate' && i + 2 < toks.length &&
          toks[i + 1].text === ' ' && toks[i + 2].kind === 'word' && EPITHET_END.test(toks[i + 2].text) &&
          !isUpper(toks[i + 2].text.charAt(0)) && /^[a-z]+$/.test(toks[i + 2].text) &&
          (lookupKey(tok.text) === 'homo' || (GENUS_END.test(lookupKey(tok.text)) && tok.text.length >= 5 &&
           !isCommon(toks[i + 2].text, words) && toks[i + 2].text.length >= 4 && !BREAKER_SET.has(toks[i + 2].text)))) {
        info.cls[0] = 'unknown'; wholeClass(info);
      }
      // a capitalised word right after an initial is a surname: "J. Smith", "H. G. Wells";
      // after "St." / "Mt." / "Ft." it is a name: "St. Just", "Mt. Shasta"
      var pw = prevSolid(toks, i);
      if (info.parts.length === 1 && info.cls[0] === 'candidate' && pw >= 0 && pw === i - 2 && toks[pw].text === '.' &&
          pw > 0 && toks[pw - 1].kind === 'word' && /^(St|Mt|Ft|Pt|Ste)$/.test(toks[pw - 1].text)) {
        info.cls[0] = 'unknown'; wholeClass(info);
      }
      if (info.parts.length === 1 && info.cls[0] === 'candidate' && pw >= 0 && pw === i - 2 && toks[pw].text === '.' &&
          pw > 0 && toks[pw - 1].kind === 'word' && toks[pw - 1].text.length === 1 && isUpper(toks[pw - 1].text)) {
        info.cls[0] = 'unknown'; wholeClass(info);
      }
      // plural that is also a surname / region: a name only after another name
      if (info.parts.length === 1 && info.cls[0] === 'candidate' && AMBIG_PLURAL_SET.has(lookupKey(info.parts[0]))) {
        if (pw >= 0 && pw === i - 2 && toks[pw].kind === 'word' && infos[pw] &&
                 (infos[pw].whole === 'anchor' || (phrase[pw] && !/^[a-z]/.test(phrase[pw].canon)))) info.cls[0] = 'unknown';
        wholeClass(info);
      }
      // curated multi-word names: canonical capitalisation, always kept
      var isPhrase = false;
      if (ph) {
        if (/^[a-z]/.test(ph.canon)) {                                   // "of", "and", "the", "de" inside a name
          flush();
          var lowTxt = ph.partial ? ph.canon + tok.text.slice(ph.canon.length) : ph.canon;
          if (lowTxt.length === tok.text.length && lowTxt !== tok.text && !start) { tok.text = lowTxt; tok.changed = true; }
          continue;
        }
        var newTxt = ph.partial ? ph.canon + tok.text.slice(ph.canon.length) : ph.canon;
        if (newTxt.length === tok.text.length && newTxt !== tok.text) { tok.text = newTxt; tok.changed = true; }
        info = analyse(tok.text, words, protect);
        info.cls[0] = 'phrase';
        wholeClass(info);
        infos[i] = info;
        isPhrase = true;
      }

      // "Gulf of Guinea": head followed by "of" + a name
      var ofName = false;
      var o1 = nextSolid(toks, i);
      if (o1 === i + 2 && toks[o1].kind === 'word' && /^of$/i.test(toks[o1].text)) {
        var o2 = nextSolid(toks, o1);
        if (o2 === o1 + 2 && toks[o2].kind === 'word') {
          var oc = classifyPart(toks[o2].text.split(JOINER_SPLIT)[0], words, protect);
          ofName = oc === 'unknown' || oc === 'protected' || !!phrase[o2];
          var ik = lookupKey(tok.text);
          if ((INSTITUTION_SET.has(ik) || GEO_OF_SET.has(ik)) && info.parts.length === 1 && isUpper(tok.text.charAt(0)) && hasLower(tok.text) &&
              isUpper(toks[o2].text.charAt(0)) && hasLower(toks[o2].text) && !BREAKER_SET.has(lookupKey(toks[o2].text))) {
            ofName = true; instChain = 1;
          }
        }
      }

      if (start) {
        flush();
        // The first word stays capitalised (and a plain lowercase first word is capitalised).
        // An unknown/protected/phrase first word anchors the name heads after it
        // ("Macquarie Island mapping"); a common first word does not ("Morrison formation").
        var capFirst = false;
        var isAnchor = isPhrase || info.cls[0] === 'unknown' || info.cls[0] === 'protected' || info.whole === 'anchor';
        if (info.whole !== 'neutral' && info.whole !== 'breaker') {
          run.push({ i: i, info: info, start: true, anchor: isAnchor, phrase: isPhrase, capFirst: capFirst, ofName: ofName });
        } else if (capFirst) {
          var ct = capitalise(tok.text);
          if (ct !== tok.text) { tok.text = ct; tok.changed = true; }
        }
        continue;
      }

      meta[i].eligible = true;
      if (info.whole === 'anchor') run.push({ i: i, info: info, anchor: true, phrase: isPhrase, ofName: ofName });
      else if (info.whole === 'candidate') run.push({ i: i, info: info, ofName: ofName });
      else if (info.whole === 'breaker') {
        flush();
        var low = safeLower(tok.text);
        if (low !== tok.text) { tok.text = low; tok.changed = true; }
      } else { flush(); } // neutral: lowercase / fixed words end a run and stay as they are
    }
    flush();
    return { toks: toks, meta: meta };
  }

  // A capitalised unknown word that may be a Latin genus / species epithet. Known places
  // and people (^name in the word list: "Patagonia", "Vaca", "Puga") are neither.
  function looksLikeGenus(word, cls, words) {
    if (cls !== 'unknown') return false;
    var key = word.toLowerCase();
    if (word.length < 4 || !/^[A-Z][a-z]+$/.test(word)) return false;
    if (isGeoTime(key) || NOT_GENUS_SET.has(key) || isHeadKey(key) || PROPER_PLURAL_SET.has(key)) return false;
    if (words && words.has('^' + key)) return false;
    return GENUS_END.test(key) || !!GENUS_O[key];
  }
  function looksLikeEpithet(word, cls, words) {
    if (cls !== 'unknown') return false;
    var key = word.toLowerCase();
    if (word.length < 3 || !/^[A-Z][a-z]+$/.test(word)) return false;
    if (isGeoTime(key) || isHeadKey(key) || PROPER_PLURAL_SET.has(key)) return false;
    if (words && words.has('^' + key)) return false;
    if (HIGHER_TAXON_RE.test(key) || /(ales|ida|oda|ia|acea|phyta|zoa|morpha)$/.test(key)) return false;   // Sphaeriidae, Mammalia
    return EPITHET_END_WIDE.test(key);
  }

  function toSentenceCase(title, opts) {
    var res = convert(title, opts);
    return { text: joinTokens(res.toks), tokens: res.toks };
  }

  // Like toSentenceCase, but leaves a title that detectCase() judges to be sentence case
  // already exactly as it is (so correct capitals such as "Southern Thailand" survive).
  function toSentenceCaseSafe(title, opts) {
    var s = String(title == null ? '' : title);
    if (detectCase(s, opts) === 'sentence') return { text: s, tokens: tokenize(s), skipped: true };
    var r = toSentenceCase(s, opts);
    r.skipped = false;
    return r;
  }

  /* ---------- title case (MLA / Chicago headline style) ---------- */

  // Latin phrases kept lowercase in headline style ("in situ", "in vitro", "et al.")
  var LATIN_PAIRS = { 'in situ': 1, 'in vitro': 1, 'in vivo': 1, 'in silico': 1, 'ex situ': 1, 'ex vivo': 1,
    'de novo': 1, 'a priori': 1, 'a posteriori': 1, 'per se': 1, 'et al': 1, 'in utero': 1, 'in ovo': 1 };
  // taxonomic abbreviations that stay lowercase before their full stop ("n. sp.", "gen. nov.")
  var TAXON_ABBREV = setOf('sp spp ssp subsp var gen nov n comb cf aff nr fam sensu');
  function isGreek(c) { return /[Ͱ-Ͽἀ-῿]/.test(c); }

  function toTitleCase(title, opts) {
    var protect = resolveProtect(opts);
    var small = opts && opts.small ? wordsFrom(opts.small) : SMALL_SET;
    var hasList = hasWordList(opts), words = hasList ? resolveWords(opts) : null;
    var toks = tokenize(title), i, lastWord = -1, seenWord = false, inQuote = false;
    for (i = toks.length - 1; i >= 0; i--) if (toks[i].kind === 'word') { lastWord = i; break; }
    function wordAt(j) { return j >= 0 && j < toks.length && toks[j].kind === 'word' ? toks[j].text : null; }
    function nextWordIdx(j) { var q = nextSolid(toks, j); return q === j + 2 && toks[j + 1].text === ' ' && toks[q].kind === 'word' ? q : -1; }
    function prevWordIdx(j) { var q = prevSolid(toks, j); return q >= 0 && q === j - 2 && toks[j - 1].text === ' ' && toks[q].kind === 'word' ? q : -1; }
    var keepLow = [];                         // token index -> leave exactly as it is

    for (i = 0; i < toks.length; i++) {
      if (toks[i].kind !== 'word') continue;
      var t = toks[i].text, lk = t.toLowerCase(), nw = nextWordIdx(i), pw = prevWordIdx(i);
      // Latin phrases: "in situ", "in-situ"
      if (nw >= 0 && LATIN_PAIRS[lk + ' ' + toks[nw].text.toLowerCase()] && !hasUpper(toks[nw].text)) { keepLow[i] = 'first'; keepLow[nw] = true; }
      if (/^[a-z]+-[a-z]+$/.test(t) && LATIN_PAIRS[t.replace('-', ' ')]) keepLow[i] = 'first';
      // species epithet after a genus: "Escherichia coli", "Tyrannosaurus rex", "Homo sapiens"
      if (pw >= 0 && /^[a-z]{3,}$/.test(t) && !small.has(t) && /^[A-Z][a-z]{2,}$/.test(toks[pw].text)) {
        var gk = toks[pw].text.toLowerCase();
        // the genus: a capitalised Latin-looking word that is not a known place / person;
        // a common word ("Virus", "Data") only counts when capitalised mid-sentence
        var genusLike = !small.has(gk) && !BREAKER_SET.has(gk) && !FUNCTION_SET.has(gk) && (!!GENUS_O[gk] || (GENUS_END.test(gk) && !(words && words.has('^' + gk)) && !isGeoTime(gk) &&
          !NOT_GENUS_SET.has(gk) && !isHeadKey(gk) && (!words || !isCommon(gk, words) || !isSentenceStart(toks, pw, pw > 0 && prevSolid(toks, pw) >= 0))));
        var epithetLike = !isHeadKey(t) && (/(i|ii|ae|ensis|oides|us|um|ex)$/.test(t) || (GENUS_O[gk] && EPITHET_END.test(t + '')) ||
          (GENUS_O[gk] && /(ens|is|a)$/.test(t)) ||
          (/(a|is|ans|ens|er)$/.test(t) && (!words || !isCommon(t, words))));
        if (genusLike && epithetLike) keepLow[i] = true;
      }
      // "n. sp.", "gen. nov.", "var."
      if (/^[a-z]+$/.test(t) && TAXON_ABBREV.has(t) && i + 1 < toks.length && toks[i + 1].text.charAt(0) === '.' && seenWord) keepLow[i] = true;
      // "dI/dt", "C/N", "and/or": a ratio or pairing with a short part is left alone
      if (t.indexOf('/') > 0) {
        var sp = t.split('/');
        for (var q = 0; q < sp.length; q++) if (sp[q].length <= 2) { keepLow[i] = true; break; }
      }
      seenWord = true;
    }
    seenWord = false;

    for (i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (tok.kind === 'space') continue;
      if (tok.kind === 'punct') { if (isDoubleQuote(tok.text)) inQuote = !inQuote; continue; }
      var start = isSentenceStart(toks, i, seenWord);
      seenWord = true;
      if (inQuote) continue;
      if (protect && protect.has(tok.text)) continue;
      if (keepLow[i] === true) continue;

      var pieces = tok.text.split(JOINER_SPLIT), out = '', k = 0;
      var nextTxt = wordAt(nextWordIdx(i));
      for (var p = 0; p < pieces.length; p++) {
        if (p % 2 === 1) { out += pieces[p]; continue; }
        var part = pieces[p], firstPart = (k === 0); k++;
        if (!part || (protect && protect.has(part)) || hasDigit(part) || hasUpper(part.slice(1))) { out += part; continue; }
        var key = lookupKey(part);
        var edge = start || i === lastWord;
        if (keepLow[i] === 'first' && !(start && firstPart)) { out += part; continue; }
        if (isGreek(part.charAt(0))) { out += part; continue; }            // "ε-Iron", not "Ε-Iron"
        // an initial before a full stop ("M. A. Geyh") is not the article
        if (part.length === 1 && pieces.length === 1 && i + 1 < toks.length && toks[i + 1].text.charAt(0) === '.') { out += capitalise(part); continue; }
        // "up to" is a compound preposition
        if (key === 'up' && pieces.length === 1 && nextTxt && nextTxt.toLowerCase() === 'to' && !edge) { out += safeLower(part); continue; }
        if (small.has(key) && !(edge && firstPart)) out += safeLower(part);
        else out += capitalise(part);
      }
      if (out !== tok.text) { tok.text = out; tok.changed = true; }
    }
    return { text: joinTokens(toks), tokens: toks };
  }

  /* ---------- detection ---------- */

  // 'upper'    : no lowercase letters at all
  // 'title'    : (almost) every eligible mid-title word is capitalised
  // 'sentence' : (almost) none is
  // 'mixed'    : anything in between
  // With a word list (opts.words or the global list) the decision uses the converter
  // itself: eligible words are mid-title common words; a capitalised one counts only when
  // the converter would lowercase it, so capitals that belong to names ("Southern
  // Thailand", "Hell Creek Formation", "Late Cretaceous") do not make a sentence-case
  // title look like title case. Without a list every eligible word is counted.
  // An all-caps title may still contain a few mixed-case chemical symbols, units or
  // acronyms ("U Pb", "Fe-Ti", "Ti4+", "MnV2O6", "IgG", "mRNA"). Words with digits and
  // short (<= 4 letters) mixed-case words are ignored; the rest must be upper case,
  // allowing one short lowercase word per eight upper-case words ("et", "in").
  function isMostlyUpper(s) {
    var toks = tokenize(s), up = 0, low = 0, lowLong = 0;
    for (var i = 0; i < toks.length; i++) {
      if (toks[i].kind !== 'word') continue;
      var parts = toks[i].text.split(JOINER_SPLIT);
      for (var k = 0; k < parts.length; k += 2) {
        var p = parts[k].replace(/['’.]/g, '');
        if (!p || hasDigit(p)) continue;
        var letters = 0;
        for (var c = 0; c < p.length; c++) if (isLetter(p.charAt(c))) letters++;
        if (letters < 2) continue;
        var hl = hasLower(p), hu = hasUpper(p);
        if (!hl) { up++; continue; }
        if (hu && p.length <= 4) continue;                  // Pb, IgG, mRNA, Ma
        low++;
        if (p.length > 3 || hu) lowLong++;
      }
    }
    return up >= 3 && lowLong === 0 && low * 8 <= up;
  }

  function detectCase(title, opts) {
    var s = String(title == null ? '' : title);
    var bare = s.replace(/<\/?[A-Za-z][^<>]*>|&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, ' ');
    if (/[A-Z]/.test(bare) && !/[a-z]/.test(bare)) return 'upper';
    if (isMostlyUpper(bare)) return 'upper';
    var cap = 0, low = 0, i;
    if (hasWordList(opts)) {
      var words = resolveWords(opts);
      var res = convert(s, opts);
      for (i = 0; i < res.toks.length; i++) {
        var m = res.meta[i];
        if (!m || !m.eligible) continue;
        var part = m.orig.split(JOINER_SPLIT)[0];
        if (!part || part.length < 2 || hasDigit(part) || hasUpper(part.slice(1))) continue;
        var key = lookupKey(part);
        // a capitalised function word the converter lowercases ("of The Society") is a
        // title-case signal; a lowercase one says nothing (headline style lowercases it too)
        if (BREAKER_SET.has(key)) { if (isUpper(part.charAt(0)) && res.toks[i].text !== m.orig) cap++; continue; }
        if (key === 'new' || !(isCommon(key, words) || isTechWord(key, words))) continue;
        if (isUpper(part.charAt(0))) {
          var now = res.toks[i].text.split(JOINER_SPLIT)[0];
          if (now !== part) cap++;           // the converter lowercases it: a title-case capital
        } else if (isLetter(part.charAt(0))) low++;
      }
    } else {
      var toks = tokenize(s), seenWord = false;
      for (i = 0; i < toks.length; i++) {
        var tok = toks[i];
        if (tok.kind !== 'word') continue;
        var start = isSentenceStart(toks, i, seenWord);
        seenWord = true;
        if (start) continue;
        var p0 = tok.text.split(JOINER_SPLIT)[0];
        if (!p0 || p0.length < 2 || hasDigit(p0) || hasUpper(p0.slice(1))) continue;
        var k0 = lookupKey(p0);
        if (BREAKER_SET.has(k0) || k0 === 'new') continue;
        if (isUpper(p0.charAt(0))) cap++; else if (isLetter(p0.charAt(0))) low++;
      }
    }
    var total = cap + low;
    if (cap === 0) return 'sentence';
    if (low === 0) return 'title';
    var share = cap / total;
    if (share >= 0.75) return 'title';
    if (share < 0.4) return 'sentence';
    return 'mixed';
  }

  /* ---------- all-caps pre-pass ---------- */

  var ALL_ELEMENTS = 'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se ' +
    'Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu ' +
    'Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr';
  var EL_BY_UPPER = (function () {
    var o = {}, l = ALL_ELEMENTS.split(' ');
    for (var i = 0; i < l.length; i++) o[l[i].toUpperCase()] = l[i];
    return o;
  })();
  // two-letter symbols that are unlikely readings when a lighter parse exists (CO2 is C + O2)
  var RARE_EL = setOf('No Co Ho Po Cs Sc Os Hf Np Pa Er Pm Cd Es Am Cf Bk Fm Md Lr Tc Pr Tm Tb Dy Ac Fr Ra Rn At', true);
  // common geochemical elements: no-digit oxides / salts ("MGO", "NACL", "FEOOH") and
  // element chains ("FE-TI") are restored only from these
  var GEOCHEM_EL = setOf('Mg Si Al Fe Mn Ca Na Cl Ti Cr Ni Cu Zn Pb Sr Ba Zr Rb Nd Sm Hf Lu Au Ag Pt Pd Hg Sn Sb ' +
    'Mo Nb Ta Li Ce La Eu Yb Gd Ar He Ne Kr Xe Ga Ge Se Te Br Bi Cs Th Re Os Be', true);
  // a lone two-letter symbol ("U PB DATING", "FE AND MG")
  var OXIDE_EL = setOf('Mg Fe Ca Mn Ni Zn Cu Pb Sn Ba Sr Cr Ti Na', true);          // MGO, FEOOH, NACL
  var LONE_EL = setOf('FE MG MN PB ZN CU SR ND RB SM TI ZR NB CR NI AU AG PT LI SI AL YB EU CE LU HF NA', true);
  // units after a number ("3.5 GA", "25 GPA", "100 MYR") and other fixed spellings
  var UNIT_CASE = { GA: 'Ga', MA: 'Ma', KA: 'ka', GPA: 'GPa', MPA: 'MPa', KPA: 'kPa', KBAR: 'kbar', MYR: 'Myr',
    GYR: 'Gyr', KYR: 'kyr', NM: 'nm', KM: 'km', CM: 'cm', MM: 'mm', KEV: 'keV', MEV: 'MeV', GEV: 'GeV', HZ: 'Hz',
    KHZ: 'kHz', MHZ: 'MHz', GHZ: 'GHz', KDA: 'kDa', MG: 'mg', ML: 'mL', KG: 'kg', MOL: 'mol', MMOL: 'mmol', KV: 'kV',
    MW: 'MW', KW: 'kW', PPM: 'ppm', PPB: 'ppb', WT: 'wt' };
  var FIXED_CASE = { PH: 'pH', MRNA: 'mRNA', TRNA: 'tRNA', RRNA: 'rRNA', MTDNA: 'mtDNA', CDNA: 'cDNA', SIRNA: 'siRNA',
    MIRNA: 'miRNA', IGG: 'IgG', IGM: 'IgM', IGE: 'IgE', IGA: 'IgA' };
  // acronyms kept upper case (besides vowel-less and unpronounceable tokens)
  var ACRONYMS = setOf('DNA RNA USA USGS NASA NOAA IPCC XANES EXAFS SEM TEM EPMA ICP MS IOCG REE HREE LREE MREE ' +
    'MORB OIB UHP HP LT HT UHT MAR EPR PGE PGM IMA MSA GSA CMS AAPG SEPM NMR XRD XRF SIMS TIMS ICPMS SHRIMP EBSD ' +
    'HRTEM FTIR IR UV NIR ESR EELS AFM STM CT MRI PET HIV AIDS HTLV HPV COVID SARS MERS USSR UK UN NE NW SE SW ' +
    'GPS GIS AMNH CMNH FMNH USNM NHMUK MNHN IODP ODP DSDP LIDAR CRISPR IUCN UNEP ICZN NSF NERC BGS GSC CNRS MOR ' +
    'UCMP YPM NMNH BMNH IVPP ZPAL MCZ UALVP TMP LIP LIPS TTG MASH AFC EMP IDA ISBN ESA JAXA CSIRO NIH BMJ ' +
    'HER2 BRCA TNF HLA IGG IGM IGE ACE AMP ATP ADP GTP NADH NADPH PCR ELISA NASA SEDEX VMS MVT BIF BIFS OH ' +
    'LA-ICPMS LA-MC-ICP-MS', true);
  // short words that are ordinary words or names, never acronyms
  var SHORT_WORDS = setOf('os rex gen nov sp spp ssp var cf aff et al de du la le von van der den nad pod ole tim');
  // name particles and Latin words written lowercase mid-title ("Domasov nad Bystrici", "os palatinum")
  var SHORT_LOWER = setOf('nad pod de du von van der den del della dos das di os rex');
  var MED_FORMULA_BLOCK = /^(CD\d+|CA\d+|PM\d+(\.\d+)?|HBA1C|HER\d|BRCA\d|IL\d+|H\dN\d|ACE\d|COX\d|P\d+|B\d+|K\d+|T\d+)$/;
  var ROMAN_RE = /^(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
  var PAIR_OK = /^(HN|CZ|SZ|LC|RZ|ZH|KH|TZ|DZ|ST|SH|CH|TH|TR|PR|BR|CR|GR|FR|DR|BL|CL|FL|GL|PL|SL|SP|SC|SK|SM|SN|SW|ND|NT|NG|NK|MP|LL|SS|RT|RD|RN|RM|RS|RK|RG|RL|RC|RB|RP|RV|LD|LT|LK|LM|LP|LS|LV|CK|CT|PT|FT|WH|WR|PH|GH|KN|TT|PP|MM|NN|RR|FF|DD|GG|ZZ|CC|BB|NS|NC|NZ|MB|MS|TS|DS|PS|KS|GS|BS|LF|WN|WL|WS|WT|WK|XT|TZ|SQ|TL|DG)$/;

  // "SIO2" -> "SiO2", "40AR" -> "40Ar", "0.5H2O" -> "0.5H2O", "MNV2O6" -> "MnV2O6"; null if no parse.
  // Fewest symbols wins; a rare two-letter reading costs extra, so "CO2" is C + O2.
  function parseFormula(p) {
    var m = /^([\d.]*)([A-Z0-9.]*)$/.exec(p);
    if (!m || !m[2] || !/^[A-Z]/.test(m[2])) return null;
    var s = m[2], n = s.length, best = [];
    best[n] = { score: 0, text: '', segs: 0, two: 0, rare: 0, els: [] };
    for (var i = n - 1; i >= 0; i--) {
      best[i] = null;
      for (var L = 1; L <= 2; L++) {
        if (i + L > n || !/^[A-Z]+$/.test(s.slice(i, i + L))) break;
        var sym = EL_BY_UPPER[s.slice(i, i + L)];
        if (!sym) continue;
        var j = i + L;
        while (j < n && /[\d.]/.test(s.charAt(j))) j++;
        var rest = best[j];
        if (!rest) continue;
        var rare = RARE_EL.has(sym) ? 1 : 0;
        var sc = rest.score + 10 + rare * 15 - (L === 2 ? 1 : 0);
        if (!best[i] || sc < best[i].score) {
          best[i] = { score: sc, text: sym + s.slice(i + L, j) + rest.text, segs: rest.segs + 1,
            two: rest.two + (L === 2 ? 1 : 0), rare: rest.rare + rare, els: [sym].concat(rest.els) };
        }
      }
    }
    if (!best[0]) return null;
    var r = best[0];
    return { text: m[1] + r.text, segs: r.segs, two: r.two, rare: r.rare, els: r.els, digits: /\d/.test(s) };
  }
  function allGeochem(els) {
    for (var i = 0; i < els.length; i++) if (els[i].length === 2 && !GEOCHEM_EL.has(els[i])) return false;
    return true;
  }
  // Could an upper-case letter string be read as a word? ("ALTAI" yes; "MORB", "IOCG", "HREE" no)
  function pronounceable(w) {
    var u = w.replace(/Y/g, 'I'), runs = u.split(/[AEIOU]+/);
    if (!/[AEIOU]/.test(u)) return false;
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      if (i === runs.length - 1 && r.length >= 2 && /S$/.test(r) && (r.length === 2 || PAIR_OK.test(r.slice(0, -1)) || /^(LP|RM|LM|RK|MB|MP)$/.test(r.slice(0, -1)))) continue;
      if (r.length >= 3 && !/^(STR|SCH|SPR|SPL|SCR|THR|CHR|PHR|SHR|NCH|RCH|LCH|TCH|NST|NGS|NDS|NTS|RST|RTH|NTH|MPT|NGL|RTS|RDS|LDS|NKS|MPS|CKS)$/.test(r)) return false;
      if (r.length === 2 && !PAIR_OK.test(r)) return false;
      if (i === 0 && r.length === 2 && /^(NG|NK|NT|ND|MP|CK|LL|SS|RT|RD|RN|RM|RS|LD|LT|FT|PT|CT|NS|NC|MS|TS|DS|PS|KS|GS|BS)$/.test(r)) return false;
    }
    return true;
  }
  // "WORD" -> "Word"; "O'NEIL" -> "O'Neil"; "DARWIN'S" -> "Darwin's"; "MCMURDO" -> "McMurdo"
  function titleWord(p) {
    var out = mapChar(p.charAt(0), true), up = false;
    for (var i = 1; i < p.length; i++) {
      var c = p.charAt(i);
      if (up) { out += mapChar(c, true); up = false; continue; }
      out += mapChar(c, false);
      if ((c === "'" || c === '’') && i === 1 && i + 2 < p.length) up = true;
    }
    if (/^MC[B-DF-HJ-NP-TV-Z][A-Z]/.test(p)) out = 'Mc' + mapChar(p.charAt(2), true) + out.slice(3);
    return out.length === p.length ? out : p;
  }
  function isShortName(core) {        // CVC / VCV three-letter words: TIM, NAD, OLE, SUR, ITU, MAY
    return core.length === 3 && /^([^AEIOU][AEIOU][^AEIOU]|[AEIOU][^AEIOU][AEIOU])$/.test(core);
  }

  // One upper-case part of an all-caps word -> { text, kind }.
  function capsPart(p, ctx, words) {
    var core = p.replace(/['’]S$/, '').replace(/['’.]/g, ''), key = core.toLowerCase(), f;
    if (!/[A-Z]/.test(p) || /[a-zß-ÿ]/.test(p)) return { text: p, kind: 'other' };       // Pb, IgG: already cased
    if (ctx.afterNumber && Object.prototype.hasOwnProperty.call(UNIT_CASE, p)) return { text: UNIT_CASE[p], kind: 'unit' };
    if (Object.prototype.hasOwnProperty.call(FIXED_CASE, p)) return { text: FIXED_CASE[p], kind: 'fixed' };
    if (ctx.chain) return { text: ctx.chainText, kind: 'formula' };
    if (hasDigit(p)) {
      f = /^[A-Z0-9.]+$/.test(p) && !MED_FORMULA_BLOCK.test(p) && !ACRONYMS.has(p) ? parseFormula(p) : null;
      if (f && (f.segs > 1 || f.els[0].length === 1 || GEOCHEM_EL.has(f.els[0]))) return { text: f.text, kind: 'formula' };
      return { text: p, kind: 'code' };
    }
    if (p.length >= 2 && ROMAN_RE.test(p)) return { text: p, kind: 'roman' };
    if (ctx.prefix && HPREFIX_SET.has(key)) return { text: titleWord(p), kind: 'word' };          // RE-ASSESSMENT
    if (SHORT_LOWER.has(key) && !ctx.start) return { text: safeLower(p), kind: 'word' };
    if (ACRONYMS.has(p)) return { text: p, kind: 'acronym' };
    if (ctx.dot && !ctx.start && (TAXON_ABBREV.has(key) || ABBREV_SET.has(key))) {
      return { text: TAXON_ABBREV.has(key) ? safeLower(p) : titleWord(p), kind: 'abbrev' };   // "GEN. NOV." -> "gen. nov."
    }
    if (ctx.quoted && !ctx.start && (isCommon(key, words) || isTechWord(key, words))) return { text: safeLower(p), kind: 'word' };
    if (SHORT_WORDS.has(key) || isCommon(key, words) || isTechWord(key, words) || PROPER_PLURAL_SET.has(key) ||
        words.has('^' + key)) return { text: titleWord(p), kind: 'word' };
    if (p.length === 2 && LONE_EL.has(p)) return { text: EL_BY_UPPER[p], kind: 'formula' };
    if (/^[A-Z]{3,5}$/.test(p)) {                                                // MGO, NACL, FEOOH
      f = parseFormula(p);
      if (f && f.rare === 0 && OXIDE_EL.has(f.els[0]) && (/^[A-Z][a-z](O|OH|OOH|Cl)$/.test(f.text))) {
        return { text: f.text, kind: 'formula' };
      }
    }
    if (/^[A-Z]+$/.test(core)) {
      if (core.length <= 2) return { text: p, kind: 'acronym' };
      if (core.length === 3 && !isShortName(core)) return { text: p, kind: 'acronym' };
      if (core.length >= 4 && core.length <= 5 && !pronounceable(core)) return { text: p, kind: 'acronym' };
      if (core.length > 5 && !/[AEIOUY]/.test(core)) return { text: p, kind: 'acronym' };
    }
    return { text: titleWord(p), kind: 'word' };
  }

  // Title-cases an ALL-CAPS title so that the sentence-case converter can work on it:
  // ordinary words become "Word"; acronyms (DNA, USGS, MORB, XANES, LA-ICP-MS), Roman
  // numerals (II, VIII, XXII) and chemical formulas (SiO2, MgO-SiO2, Fe-Ti, 40Ar/39Ar,
  // WO3·0.5H2O, Na2O) are restored; short names and Latin words are ordinary words (Ole,
  // Tim, Nad, Os, Rex, "gen. nov."); a species epithet after a genus is lowercased
  // ("SENSUITROCHUS FERRERI" -> "Sensuitrochus ferreri"). The length never changes, and
  // tokens that already contain lowercase letters (Pb, IgG) are left alone.
  function fromAllCaps(title, wordsSrc) {
    var s = String(title == null ? '' : title);
    var words = resolveWords({ words: wordsSrc });
    var toks = tokenize(s), i, k, info = [], seen = false, quoted = false, qStart = false;
    for (i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (tok.kind === 'punct' && /["“”]/.test(tok.text)) {
        // a quoted title inside an all-caps title is written in sentence case directly, because
        // the converter leaves quoted text alone
        var opens = /[“]/.test(tok.text) || (/"/.test(tok.text) && !quoted);
        if (/[”]/.test(tok.text) || (/"/.test(tok.text) && quoted)) quoted = false; else if (opens) { quoted = true; qStart = true; }
        continue;
      }
      if (tok.kind !== 'word') continue;
      var start = isSentenceStart(toks, i, seen) || qStart; seen = true; qStart = false;
      var pv = prevSolid(toks, i), afterNumber = pv >= 0 && pv === i - 2 && /^[\d.,]+$/.test(toks[pv].text);
      if (ACRONYMS.has(tok.text)) continue;                                      // LA-ICP-MS
      var pieces = tok.text.split(JOINER_SPLIT), parts = [];
      for (k = 0; k < pieces.length; k += 2) parts.push(pieces[k]);
      // element / formula chain: FE-TI, PB-ZN, U-TH-PB, MGO-SIO2, 40AR/39AR
      var chain = parts.length > 1, ftext = [], nform = 0;
      for (k = 0; k < parts.length && chain; k++) {
        var pk = parts[k];
        if (/[a-zß-ÿ]/.test(pk)) { var fz = parseFormula(pk.toUpperCase()); if (fz && fz.text === pk) { ftext.push(pk); nform++; continue; } chain = false; break; }
        if (/^[\d.]+$/.test(pk)) { ftext.push(pk); continue; }
        var f = /^[A-Z0-9.]+$/.test(pk) && !ACRONYMS.has(pk) && !MED_FORMULA_BLOCK.test(pk) ? parseFormula(pk) : null;
        if (!f || f.segs > 4 || f.rare > 0 && !f.digits || !allGeochem(f.els) || (!f.digits && f.segs > 1 && f.els[0].length === 1 && f.two === 0) ||
            (!f.digits && f.segs > 2)) { chain = false; break; }
        ftext.push(f.text); nform++;
      }
      if (chain && nform < 2) chain = false;
      var dot = i + 1 < toks.length && toks[i + 1].text.charAt(0) === '.';
      var outParts = [];
      for (k = 0; k < parts.length; k++) {
        var r = capsPart(parts[k], { chain: chain, chainText: chain ? ftext[k] : null, dot: dot && k === parts.length - 1,
          start: start && k === 0, prefix: k === 0 && parts.length > 1, quoted: quoted, afterNumber: afterNumber && k === 0 }, words);
        if (r.text.length !== parts[k].length) r = { text: parts[k], kind: 'other' };
        outParts.push(r);
      }
      var txt = '';
      for (k = 0; k < pieces.length; k++) txt += k % 2 ? pieces[k] : outParts[k / 2].text;
      if (txt.length === tok.text.length && txt !== tok.text) { tok.text = txt; tok.changed = true; }
      info[i] = outParts;
    }
    // species epithet after a genus: "SENSUITROCHUS FERRERI" -> "Sensuitrochus ferreri"
    for (i = 0; i < toks.length; i++) {
      if (!info[i] || info[i].length !== 1) continue;
      var j = nextSolid(toks, i);
      if (j !== i + 2 || toks[i + 1].text !== ' ' || !info[j] || info[j].length !== 1) continue;
      var g = toks[i].text, e = toks[j].text;
      if (!/^[A-Z][a-z]{3,}$/.test(g) || !/^[A-Z][a-z]{2,}$/.test(e)) continue;
      var gk = g.toLowerCase(), ek = e.toLowerCase();
      if (isCommon(gk, words) || isTechWord(gk, words) || isCommon(ek, words) || isTechWord(ek, words)) continue;
      if (!looksLikeGenus(g, 'unknown', words) || !looksLikeEpithet(e, 'unknown', words)) continue;
      var h = nextSolid(toks, j);
      if (h === j + 2 && toks[h].kind === 'word' && isHeadKey(lookupKey(toks[h].text))) continue;
      var le = safeLower(e);
      if (le.length === e.length) { toks[j].text = le; toks[j].changed = true; }
    }
    return joinTokens(toks);
  }

  /* ---------- misc ---------- */

  function joinTokens(toks) {
    var out = '';
    for (var i = 0; i < toks.length; i++) out += toks[i].text;
    return out;
  }

  // Heuristic: does `word` look like a capitalised Latin genus name (unknown to the word
  // list, Latin-looking ending)? Useful for UIs that want to italicise or protect taxa.
  function isLikelyTaxon(word, words) {
    var w = String(word == null ? '' : word);
    if (!/^[A-Z][a-z]+$/.test(w)) return false;
    var set = resolveWords({ words: words });
    if (isCommon(lookupKey(w), set)) return false;
    return looksLikeGenus(w, 'unknown', set);
  }

  var api = {
    toSentenceCase: toSentenceCase,
    toSentenceCaseSafe: toSentenceCaseSafe,
    toTitleCase: toTitleCase,
    detectCase: detectCase,
    fromAllCaps: fromAllCaps,
    wordsFrom: wordsFrom,
    tokenize: tokenize,
    isCommon: function (word, words) { return isCommon(lookupKey(String(word)), resolveWords({ words: words })); },
    isLikelyTaxon: isLikelyTaxon,
    FUNCTION_WORDS: FUNCTION_WORDS,
    SMALL_WORDS: SMALL_WORDS,
    PHRASES: PHRASES
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AutoDOICase = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
