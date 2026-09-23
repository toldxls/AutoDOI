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
 * Anything the converter is unsure about is left as it was, so a UI can show each
 * token and let the user flip it.
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
  var SMALL_WORDS = 'a an the of in on and or for with from to by at as but nor via vs versus into onto over under between among within without during after before through toward towards upon about across along around against';

  // Words that in sentence case are always lowercased mid-title and that end a run of
  // capitalised words. "new" is deliberately absent ("New Zealand", "New South Wales").
  var BREAKERS = SMALL_WORDS + ' is are was were be been its their our this that these those';

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
    'shield platform massif arch embayment trough volcano caldera highlands lowlands fold thrust';
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
  var X_HEADS = 'shale sandstone limestone mudstone formation member group basin island islands sea ocean gulf ' +
    'bay river lake mountain mountains plateau museum society university creek hill hills canyon glacier ' +
    'seamount islet park monument peninsula award medal prize';
  // X_HEADS that stay a name even when a common word follows ("Mud Hill locality").
  var X_HEADS_FREE = 'museum society university creek hill hills islet seamount monument award medal prize';
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
    'siliceous tidewater outlet piedmont cirque submarine wind theme car industrial science technology ' +
    'first second third final total single double multiple novel simple complex new';
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
  var HYPHEN_PREFIXES = 're bi co de un ex pre pro sub non mid tri uni semi anti multi post';

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
  var NOT_GENUS = 'santa costa baja alta sierra serra bahia isla punta playa villa nueva nova terra tierra ' +
    'maria anna rita sofia julia laura lucia elena eva emma olga vera nina sara lisa diana gloria';

  // Multi-word proper names (canonical capitalisation), "|"-separated.
  var PHRASES = [
    // countries, regions, states, cities
    'United States|United States of America|United Kingdom|United Nations|United Arab Emirates|New Zealand|South Africa|' +
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
    'Penrose Medal|Nobel Prize|Open University|' +
    // Latin phrases written lowercase in sentence case
    'in situ|in vitro|in vivo|in silico|ex situ|ex vivo|de novo|a priori|a posteriori|per se|et al'
  ].join('');

  // Punctuation after which the next word starts a new "sentence" (APA subtitle rule).
  var SENTENCE_END = /[:?!]$/;                        // colon, ?, !
  var DASH_END = /[—–]$/;                   // em / en dash: only when spaced
  var OPENERS = /[(\[{"“‘'«]$/;       // opening bracket / quote
  var JOINERS = /[-\/‐‑]/;                 // split hyphenated words on these
  var JOINER_SPLIT = /([-\/‐‑])/;
  var TAG_RE = /^<\/?[A-Za-z][^<>]*>/;               // raw HTML tag -> punctuation
  var ENTITY_RE = /^&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;
  var GENUS_END = /(a|e|us|um|is|es|on|an|ops|ys|x|os|as|ites|ma|ium|oides|mys|don|pus|er)$/;
  var EPITHET_END = /(us|a|um|i|ae|is|ex)$/;
  var GENUS_O = { homo: 1, vibrio: 1, danio: 1, bubo: 1, falco: 1, buteo: 1 };

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
    for (var i = 0; i < list.length; i++) if (list[i]) set.add(String(list[i]).toLowerCase());
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
    if (isCommon(key, words)) return 'candidate';
    if (part.length <= 2 || UNIT_SET.has(key)) return 'fixed';
    return 'unknown';
  }

  // Splits a word token into parts + separators and classifies each part.
  function analyse(text, words, protect) {
    var pieces = text.split(JOINER_SPLIT), parts = [], cls = [], i;
    for (i = 0; i < pieces.length; i += 2) {
      parts.push(pieces[i]);
      cls.push(classifyPart(pieces[i], words, protect));
    }
    // "Re-Evaluation", "Bi-Copter": a short capitalised prefix before a real word part
    if (parts.length > 1 && cls[0] === 'fixed' && isUpper(parts[0].charAt(0)) && !hasUpper(parts[0].slice(1)) &&
        HPREFIX_SET.has(parts[0].toLowerCase()) && parts[1].length > 2 && (cls[1] === 'candidate' || cls[1] === 'unknown' || cls[1] === 'lower')) {
      cls[0] = 'candidate';
    }
    var info = { pieces: pieces, parts: parts, cls: cls, whole: 'neutral' };
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
  function isElementContext(toks, i) {
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
    return false;
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

  /* ---------- sentence case ---------- */

  // The converter proper. Returns { toks, meta } where meta[i] (for word tokens) records
  // whether the token was eligible for detection and whether it was lowercased.
  function convert(title, opts) {
    var words = resolveWords(opts), protect = resolveProtect(opts);
    var toks = tokenize(title), infos = [], meta = [], i;
    var phrase = matchPhrases(toks);
    var run = [], seenWord = false, inQuote = false;

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
          // B: name prefix before a kept word ("Late Cretaceous", "Early-Middle Jurassic")
          if (r + 1 < n && kept[r + 1] && allPrefix(e)) { kept[r] = true; via[r] = 'p'; changed = true; continue; }
          // "Gulf of Guinea", "University of Utah": head + of + name
          if (r === n - 1 && k && e.ofName && inSet(X_HEAD_SET, k)) { kept[r] = true; via[r] = 'h'; changed = true; continue; }
          if (e.start || !single(e) || !k || X_STOP_SET.has(k)) continue;
          // C: capitalised X + name head ("Mud Hill", "Red Sea", "Vale Formation")
          if (r + 1 < n && !isHeadKey(k) && single(run[r + 1]) && inSet(X_HEAD_SET, run[r + 1].key || '')) {
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
        if ((g.anchor || (g.key === 'homo' && single(g))) && !g.phrase && s.anchor && !s.phrase && single(g) && single(s) && (g.key === 'homo' || looksLikeGenus(g.info.parts[0], g.info.cls[0])) &&
            looksLikeEpithet(s.info.parts[0], s.info.cls[0]) && !(r + 2 < n && run[r + 2].key && isHeadKey(run[r + 2].key))) {
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
      if (start && info.cls[0] === 'lower' && !(protect && protect.has(info.parts[0]))) {
        var cap0 = capitalise(tok.text);
        if (cap0 !== tok.text) { tok.text = cap0; tok.changed = true; info = analyse(tok.text, words, protect); }
      }
      infos[i] = info;
      var ph = phrase[i];
      // "St. Helens", "Mt. Everest": abbreviated name prefixes stay as they are
      if (info.parts.length === 1 && info.cls[0] === 'candidate' && i + 1 < toks.length && toks[i + 1].text === '.' &&
          ABBREV_SET.has(lookupKey(tok.text)) && tok.text.length <= 4) {
        info = { pieces: [tok.text], parts: [tok.text], cls: ['fixed'], whole: 'neutral' };
        infos[i] = info;
      }

      // element symbols that are also words: "Pb, As and Cd", "As(III)"
      if (!ph && AMBIG_EL_SET.has(tok.text) && isElementContext(toks, i)) {
        info = { pieces: [tok.text], parts: [tok.text], cls: ['fixed'], whole: 'neutral' };
        infos[i] = info;
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
      if (info.parts.length === 1 && info.cls[0] === 'candidate' && lookupKey(tok.text) === 'homo' && i + 2 < toks.length &&
          toks[i + 1].text === ' ' && toks[i + 2].kind === 'word' && EPITHET_END.test(toks[i + 2].text) &&
          !isUpper(toks[i + 2].text.charAt(0))) {
        info.cls[0] = 'unknown'; wholeClass(info);
      }
      // a capitalised word right after an initial is a surname: "J. Smith", "H. G. Wells"
      var pw = prevSolid(toks, i);
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

  function looksLikeGenus(word, cls) {
    if (cls !== 'unknown') return false;
    var key = word.toLowerCase();
    if (word.length < 4 || !/^[A-Z][a-z]+$/.test(word)) return false;
    if (isGeoTime(key) || NOT_GENUS_SET.has(key) || isHeadKey(key) || PROPER_PLURAL_SET.has(key)) return false;
    return GENUS_END.test(key) || !!GENUS_O[key];
  }
  function looksLikeEpithet(word, cls) {
    if (cls !== 'unknown') return false;
    var key = word.toLowerCase();
    if (word.length < 3 || !/^[A-Z][a-z]+$/.test(word)) return false;
    if (isGeoTime(key) || isHeadKey(key) || PROPER_PLURAL_SET.has(key)) return false;
    return EPITHET_END.test(key);
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

  function toTitleCase(title, opts) {
    var protect = resolveProtect(opts);
    var small = opts && opts.small ? wordsFrom(opts.small) : SMALL_SET;
    var toks = tokenize(title), i, lastWord = -1, seenWord = false, inQuote = false;
    for (i = toks.length - 1; i >= 0; i--) if (toks[i].kind === 'word') { lastWord = i; break; }

    for (i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (tok.kind === 'space') continue;
      if (tok.kind === 'punct') { if (isDoubleQuote(tok.text)) inQuote = !inQuote; continue; }
      var start = isSentenceStart(toks, i, seenWord);
      seenWord = true;
      if (inQuote) continue;
      if (protect && protect.has(tok.text)) continue;

      var pieces = tok.text.split(JOINER_SPLIT), out = '', k = 0;
      for (var p = 0; p < pieces.length; p++) {
        if (p % 2 === 1) { out += pieces[p]; continue; }
        var part = pieces[p], firstPart = (k === 0); k++;
        if (!part || (protect && protect.has(part)) || hasDigit(part) || hasUpper(part.slice(1))) { out += part; continue; }
        var key = lookupKey(part);
        var edge = start || i === lastWord;
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
  function detectCase(title, opts) {
    var s = String(title == null ? '' : title);
    var bare = s.replace(/<\/?[A-Za-z][^<>]*>|&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, ' ');
    if (/[A-Z]/.test(bare) && !/[a-z]/.test(bare)) return 'upper';
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
        if (key === 'new' || !isCommon(key, words)) continue;
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
    return looksLikeGenus(w, 'unknown');
  }

  var api = {
    toSentenceCase: toSentenceCase,
    toSentenceCaseSafe: toSentenceCaseSafe,
    toTitleCase: toTitleCase,
    detectCase: detectCase,
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
