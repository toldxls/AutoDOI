#!/usr/bin/env python3
"""
Build data/common-words.js for AutoDOI's sentence-case converter.

The output is one string of lowercase words that are SAFE TO LOWERCASE inside an
article title (no plausible proper-noun reading), plus two small marker sets:

    word      a common word (lowercased mid-title when capitalised)
    !word     never common: a proper name whose regular -s/-ed/-ing stripping
              would reach a common word ("potts" -> "pott", "hans" -> "han",
              "dolores" -> "dolor"); sentencecase.js does not stem it
    ^word     a known place / person name that is not in the list; the converter
              never lowercases it by morphology ("-ite", "-ism") and never takes it
              for a Latin genus or species epithet ("Encarnacion Puga", "Vaca Muerta")

The string is front-coded to fit more words in the size budget: words are sorted
and each entry is written as <n><rest>, where n (one character, '0'-'9' then
'A'-'Z' for 10-35) is the number of leading characters shared with the previous
entry. The string starts with the marker "~fc1 ". sentencecase.js (wordsFrom)
decodes it; a plain space-separated list is still accepted there.

Anything not in the list is left capitalised by sentencecase.js unless its
morphology marks it as technical vocabulary, so omissions are cheap (the user
clicks a word to flip it) while false inclusions (lowercasing "Turkey",
"Tibet", "Pascual") are what we work hardest to avoid.

Sources (all downloaded at build time and cached; see --cache):

  (a) /usr/share/dict/words (Webster's 2nd, "web2"): entries that appear ONLY in
      lowercase.  A capitalised variant ("March", "Turkey", "Cretaceous") means a
      proper-noun reading exists and the word is excluded (curated RESCUE aside).
  (b) SCOWL 2020.12.07 (wordlist.aspell.net): lowercase words up to size 70 are
      common vocabulary ("core" = size <= 50); its *-upper and *-proper-names
      lists are proper-noun evidence.
  (c) Minerals: every IMA-approved mineral name from the Wikipedia lists
      "List of minerals recognized by the International Mineralogical
      Association (A ... Y-Z)" (mineral names are common nouns in English).
  (d) Medical vocabulary: glutanimate/wordlist-medicalterms-en (lowercase entries
      are common; capitalised entries are proper evidence: eponyms, brands).
  (e) Case evidence from real sentence-case titles: titles of ~55 geoscience,
      palaeontology, zoology and biomedical journals from the Crossref API.  In
      titles that are clearly in sentence case, a word written lowercase mid-title
      is common ("felsic", "magmatism", "hindlimb", "temnospondyl") and one written
      capitalised is a name ("Bushveld", "Tibet", "Vesuvius").  This is the main
      source of domain vocabulary and the main filter against place names that
      the dictionaries list lowercase.
  (f) Name lists used only as filters: US Census 2000 surnames (fivethirtyeight
      copy), smashew/NameDatabases surnames and first names, GeoNames
      cities1000 + admin1 + country names.  A word that is only moderately
      common (not SCOWL core, no lowercase title evidence) and is also a name
      is excluded ("cox", "pascual", "puna", "cayman").
  (g) Frequency: first20hours 20k list and Norvig's count_1w (Google Web 1T)
      order words for the size cap.
  (h) Curated adjustments below: FUNCTION_WORDS, RESCUE, SUPPLEMENT, EXCLUDE,
      PROPER_EXTRA; element symbols are excluded (except function words).

Inflections are NOT stored: sentencecase.js strips regular -s/-es/-ies, -ing,
-ed and -ly endings at lookup time and re-checks the stem.

Usage:  python3 tools/build-common-words.py [--max-kb 600] [--offline] [--cache DIR]
                                            [--exclude-dois FILE] [--plain]

The first run downloads about 60 MB (Crossref: ~280 requests, several minutes) into the
cache directory; later runs reuse it (--offline uses only the cache).  Crossref content
grows over time, so a rebuild months later may differ slightly.  --exclude-dois keeps
an evaluation corpus out of the case evidence.
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data', 'common-words.js')
DICT = '/usr/share/dict/words'
FREQ_URL = 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/20k.txt'
COUNT_URL = 'https://norvig.com/ngrams/count_1w.txt'
SCOWL_URL = 'https://downloads.sourceforge.net/project/wordlist/SCOWL/2020.12.07/scowl-2020.12.07.tar.gz'
MED_URL = 'https://raw.githubusercontent.com/glutanimate/wordlist-medicalterms-en/master/wordlist.txt'
GEONAMES = 'https://download.geonames.org/export/dump/'
SURNAMES_URL = 'https://raw.githubusercontent.com/fivethirtyeight/data/master/most-common-name/surnames.csv'
NAMEDB = 'https://raw.githubusercontent.com/smashew/NameDatabases/master/NamesDatabases/'
IMA_PAGES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
             'P–Q', 'R', 'S', 'T', 'U–V', 'W–X', 'Y–Z']
IMA_TITLE = 'List of minerals recognized by the International Mineralogical Association (%s)'
MAILTO = os.environ.get('CROSSREF_MAILTO', '')  # your address, for Crossref's polite pool; optional
UA = 'AutoDOI-wordlist-builder/2.0 (https://github.com/toldxls/AutoDOI' + ('; mailto:' + MAILTO if MAILTO else '') + ')'

# Crossref journals (ISSN) whose sentence-case titles provide case evidence.
CROSSREF_ISSNS = """
0003-004X 0016-7037 0010-7999 0026-461X 0008-4476 0091-7613 0024-4937 0009-2541 0012-821X
0301-9268 0935-1221 0026-4598 0169-1368 0361-0128 0016-7606 0016-7649 0040-1951 0342-1791
0009-8604 0377-0273 0037-0746 0037-0738 0022-3360 0272-4634 0031-0239 0031-0182 0195-6671
1477-2019 0567-7920 0094-8373 0024-1164 0891-2963 0883-1351 0047-2484 1932-8486 0362-2525
0024-4082 0097-4463 0307-6970 0140-6736 0959-8138 0021-9258 0022-2623 0007-0920 0167-8140
0007-0963 0021-9746 0014-2999 1385-8947 0885-8993 1932-6203 2045-2322 0022-1376 0012-8252
0264-3707
""".split()
CROSSREF_PAGES = 5          # x 1000 titles per journal

# Standard function words plus a few more closed-class words.
FUNCTION_WORDS = set("""
a an the of in on and or for with from to by at as but nor via vs versus into
onto over under between among within without during after before through
toward towards upon about across along around against is are was were be been
its their our this that these those new
has have had do does did not if than then when where how what which who whom
whose why it we you they us them can could should would will shall might must
so yet both either neither each every all any some such more most less least
very only also non per
no he she him her his am using
""".split())

# Common words that web2 also lists with a capital for an obscure reason.
RESCUE = set("""
the for as will no page price list state part real those case per think media
art old job net major star space lot miles kids came tech lead leads win anti
trying modern academic pop fan cat skip wind stone root mass urban rich plastic
snow gene carry vice ray tape judge beta delta revised dot shape wave acts poll
pilot spy romance empire chip tab ran fiber shadow gulf odds clay wolf rugby
axis median pace atlas dawn ban sigma slave mono salmon pole bee bride scientist
bare therapeutic medieval renaissance bat delicious trio zen alpine maritime
penny male female lesbian spring son vote kit grant guy hunter fauna flora marsh
cliff herb mole mosquito cactus citrus tuna cannabis aerosol anemia tolerant
mosaic spike gill peg chin fur gum serpent sedan husky sanity cola triumph
advent rotary stern rogue demon boxer graves piper muse nanny natal
sergeant mister shrine cadet aides allies angles scripture utopia odyssey
zipper attic gothic italic wealthy fahrenheit doppler heroin rand mercury
south eastern red
""".split())

# Modern / scientific vocabulary that may be missing from every source.
SUPPLEMENT = set("""
coronavirus coronaviruses nanometre nanometres nanometer nanometers nanoscale
nanoparticle nanoparticles nanotube nanotubes genome genomes genomic genomics
proteome proteomic proteomics transcriptome transcriptomic transcriptomics
metagenomic metagenomics microbiome microbiomes biodiversity ecosystem
ecosystems phylogenomic phylogenomics phylogenetic phylogenetics
paleobiology palaeobiology paleoecology palaeoecology paleoclimate
palaeoclimate paleoenvironment palaeoenvironment paleogenomics
biostratigraphic chemostratigraphy chemostratigraphic magnetostratigraphy
geochronologic geochronological radiometric radiocarbon isotope isotopes
isotopic biomarker biomarkers dataset datasets database databases software
hardware algorithm algorithms computational bioinformatics bioinformatic
neuroscience neuroscientific nanotechnology biotechnology biotechnological
graphene photonic photonics optoelectronic superconductivity superconducting
semiconductor semiconductors metamaterial metamaterials plasmonic
morphometric morphometrics geometric cladistic cladistics taphonomy taphonomic
sedimentology sedimentological palaeontology palaeontological paleontological
ammonite ammonites foraminifera foraminiferal microfossil microfossils
macrofossil macrofossils ichnofossil ichnofossils trackway trackways
tetrapod tetrapods theropod theropods sauropod sauropods ornithopod
ornithopods ceratopsian ceratopsians hadrosaur hadrosaurs ankylosaur
ankylosaurs pterosaur pterosaurs plesiosaur plesiosaurs ichthyosaur
ichthyosaurs mosasaur mosasaurs synapsid synapsids therapsid therapsids
archosaur archosaurs dinosaurian avian nonavian crocodylian crocodylians
squamate squamates lissamphibian eutherian eutherians metatherian
metatherians multituberculate multituberculates insectivore insectivores
herbivore herbivores carnivore carnivores omnivore omnivores predator
predators pollinator pollinators biogeography biogeographic phylogeography
phylogeographic macroevolution macroevolutionary microevolution
microevolutionary speciation extinction extinctions diversification
radiations paleogeography palaeogeography paleogeographic palaeogeographic
geospatial geodatabase lidar photogrammetry photogrammetric tomography
tomographic synchrotron ultrastructure ultrastructural histology histological
osteohistology osteohistological ontogenetic heterochrony allometry allometric
scaling holotype holotypes paratype paratypes neotype lectotype systematics
taxonomic taxonomically nomenclatural biostratigraphy chronostratigraphy
lithostratigraphy lithostratigraphic chronostratigraphic sequence
sequencing sequenced mitochondrial mitogenome mitogenomes nuclear ancient
premolar premolars molar molars dentition dentitions vertebra vertebrae
vertebral cranial postcranial postcranium braincase endocast endocasts
osteoderm osteoderms integument integumentary feather feathers feathered
plumage melanosome melanosomes pigmentation coloration colouration
school schools internet online email website blog smartphone app healthcare
interoperability cybersecurity blockchain microplastic multitask wideband
heterojunction bifunctional electrocatalyst electrocatalytic photocatalytic
chemoselective nonadiabatic spaceflight backscatter seawater geoscience
groundwater karst hydroclimate nanowire phospholipid baseline checklist
decapod echinoderm brachiopod bryozoan gastropod crinoid ammonoid conodont
graptolite radiolarian ostracod nautiloid belemnite echinoid ophiuroid
blastoid rodent ungulate teleost lungfish coelacanth wasp millipede annelid
mollusc gymnosperm foraminifer coccolith archaea anglerfish elytron taxa
osteology nonmarine
magmatism felsic mafic ultramafic intraplate komatiite komatiitic tholeiite
tholeiitic carbonatite xenolith xenocryst phenocryst megacryst orthogneiss
paragneiss migmatite granulite eclogite amphibolite metabasalt metabasite
metabasic metasediment metasomatism metasomatic petrogenesis petrogenetic
fugacity pegmatite pegmatitic lamprophyre kimberlite lamproite nephelinite
basanite peridotite pyroxenite wehrlite lherzolite harzburgite dunite
websterite troctolite norite anorthosite gabbronorite leucogranite granitoid
tonalite trondhjemite adakite adakitic calc siliciclastic hindlimb forelimb
temnospondyl temnospondyls postcrania dendrolite stromatolite thrombolite
subducted subduction obduction orogenic orogeny cratonic lithospheric
asthenospheric asthenosphere prograde retrograde aureole anatexis isograd
greenschist blueschist tamoxifen radiosensitivity dermatomyositis mastalgia
""".split())

# Words some source lists lowercase but which are overwhelmingly proper nouns
# in the target domain, plus names learned wrong from all-caps or title-case noise.
EXCLUDE = set("""
pacific arctic antarctic mediterranean quaternary tertiary earth gaussian
bayesian boolean cartesian euclidean newton darwin wallace mendel einstein
markov fourier laplace linnean linnaean smithsonian
bolivia brazil chad chile china finland gambia mali mozambique panama
zimbabwe berlin dover york hong titan hubble python java
tibet vesuvius bushveld silesia puna cayman pascual cox el potts scadding
dolores hans puga storer maria amir matt ken em mes ally norm mart garret endeavour
""".split())

# Geological time names, eras and other capitalised terms that must never be
# common even if a source lists them lowercase.
PROPER_EXTRA = set("""
cambrian ordovician silurian devonian carboniferous mississippian pennsylvanian permian
triassic jurassic cretaceous paleogene palaeogene neogene quaternary tertiary paleocene
palaeocene eocene oligocene miocene pliocene pleistocene holocene anthropocene precambrian
archean archaean proterozoic phanerozoic paleozoic palaeozoic mesozoic cenozoic cainozoic
ediacaran cryogenian tonian hadean neoproterozoic mesoproterozoic paleoproterozoic
palaeoproterozoic neoarchean mesoarchean paleoarchean eoarchean
maastrichtian campanian santonian coniacian turonian cenomanian albian aptian barremian
hauterivian valanginian berriasian tithonian kimmeridgian oxfordian callovian bathonian
bajocian aalenian toarcian pliensbachian sinemurian hettangian rhaetian norian carnian
ladinian anisian olenekian induan changhsingian wuchiapingian capitanian wordian roadian
kungurian artinskian sakmarian asselian gzhelian kasimovian moscovian bashkirian
serpukhovian visean tournaisian famennian frasnian givetian eifelian emsian pragian
lochkovian pridoli pridolian ludlow wenlock llandovery hirnantian katian sandbian
darriwilian dapingian floian tremadocian furongian danian selandian thanetian ypresian
lutetian bartonian priabonian rupelian chattian aquitanian burdigalian langhian
serravallian tortonian messinian zanclean piacenzian gelasian calabrian chibanian
tarantian greenlandian northgrippian meghalayan lias dogger malm
caradoc ashgill llanvirn arenig tremadoc llandeilo keuper muschelkalk buntsandstein zechstein
rotliegend rotliegendes lettenkohle beagle jun laramide variscan caledonian alleghanian acadian grenvillian
taconic betic subbetic intertrappean
""".split())

# Regions and palaeocontinents with Latin-looking names, marked ^name so that the
# converter never takes them for a genus or species epithet ("Patagonia Argentina").
PLACE_EXTRA = set("""
patagonia siberia amazonia scandinavia anatolia laurentia gondwana gondwanaland laurasia baltica avalonia
pangaea pangea rodinia columbia nuna tethys arabia mesopotamia arcadia cimmeria iberia moesia pannonia
bohemia moravia silesia galicia lusitania transylvania cantabria tasmania oceania micronesia melanesia
polynesia beringia laramidia appalachia cascadia zealandia sundaland sahul wallacea macaronesia
amazonas araucania dalmatia carinthia styria lombardia liguria calabria sardinia sicilia apulia
""".split())

# Two-letter chemical element symbols (lowercased).
ELEMENT_SYMBOLS = set("""
he li be ne na mg al si cl ar ca sc ti cr mn fe co ni cu zn ga ge as se br kr
rb sr zr nb mo tc ru rh pd ag cd in sn sb te xe cs ba la ce pr nd pm sm eu gd
tb dy ho er tm yb lu hf ta re os ir pt au hg tl pb bi po at rn fr ra ac th pa
np pu am cm bk cf es fm md no lr rf db sg bh hs mt ds rg cn nh fl mc lv ts og
""".split())

WORD_RE = re.compile(r'^[a-z]{2,}$')
# Latin genus / higher-taxon endings: such words from the medical list need other evidence
LATIN_TAXON_END = re.compile(r'(us|um|ys|mys|ops|ella|idae|aceae|inae|oidea|ales|aria|ium|odon|ites|opsis)$')
WORD_ANY_RE = re.compile(u'^[a-zß-ÿĀ-ɏ]{2,}$')
# endings that the converter's genus / epithet / morphology heuristics look at:
# a name with one of them is written as ^name so the heuristics leave it alone
HEURISTIC_END = re.compile(r'(us|a|um|i|ae|is|ex|ites?|ism|ic|ous|oids?|ids?|osis|itis|genesis|ology|ase)$')


# ---------------------------------------------------------------- downloads

def fetch(url, timeout=60, binary=False):
    """Return the body at url (bytes if binary), or None. urllib, then curl."""
    data = None
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if r.status == 200:
                data = r.read()
    except Exception as e:  # noqa: BLE001 - any failure means "try curl"
        sys.stderr.write('note: urllib failed for %s (%s); trying curl\n' % (url, e.__class__.__name__))
    if data is None:
        try:
            res = subprocess.run(['curl', '-sSL', '--fail', '-A', UA, '--max-time', str(timeout), url],
                                 capture_output=True, check=False)
            if res.returncode == 0 and res.stdout:
                data = res.stdout
            else:
                sys.stderr.write('warning: could not fetch %s (curl exit %d)\n' % (url, res.returncode))
        except Exception as e:  # noqa: BLE001
            sys.stderr.write('warning: could not fetch %s (%s)\n' % (url, e))
    if data is None:
        return None
    return data if binary else data.decode('utf-8', errors='replace')


def cached(cache, name, url, offline, binary=False, check=None, timeout=120):
    """Download url into cache/name once; return its content (or None)."""
    path = os.path.join(cache, name)
    if os.path.exists(path):
        with open(path, 'rb') as f:
            data = f.read()
        return data if binary else data.decode('utf-8', errors='replace')
    if offline:
        return None
    for attempt in range(4):
        data = fetch(url, timeout=timeout, binary=True)
        if data is not None and (check is None or check(data)):
            with open(path, 'wb') as f:
                f.write(data)
            return data if binary else data.decode('utf-8', errors='replace')
        time.sleep(3 + 3 * attempt)
    sys.stderr.write('warning: giving up on %s\n' % url)
    return None


# ---------------------------------------------------------------- sources

def load_scowl(cache, offline):
    """-> (lower, proper, pnames) {word: min size} from SCOWL final lists: lowercase words,
    capitalised words (upper + proper-names lists) and proper names only."""
    lower, proper, pnames = {}, {}, {}
    data = cached(cache, 'scowl.tgz', SCOWL_URL, offline, binary=True, check=lambda d: d[:2] == b'\x1f\x8b')
    if not data:
        sys.stderr.write('warning: SCOWL unavailable\n')
        return lower, proper, pnames
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
        for m in tar.getmembers():
            mm = re.search(r'/final/([a-z_0-9]+)-(words|upper|proper-names)\.(\d+)$', m.name)
            if not mm or int(mm.group(3)) > 70:
                continue
            kind, size = mm.group(2), int(mm.group(3))
            text = tar.extractfile(m).read().decode('latin-1')
            for w in text.split():
                w = re.sub(r"'s$", '', w)
                if kind == 'words' and WORD_RE.match(w):
                    lower[w] = min(lower.get(w, 99), size)
                elif kind != 'words' and re.match(r'^[A-Z][a-z]+$', w):
                    k = w.lower()
                    proper[k] = min(proper.get(k, 99), size)
                    if kind == 'proper-names':
                        pnames[k] = min(pnames.get(k, 99), size)
    return lower, proper, pnames


def load_minerals(cache, offline):
    names = set()
    for letter in IMA_PAGES:
        title = IMA_TITLE % letter
        url = 'https://en.wikipedia.org/w/index.php?title=%s&action=raw' % urllib.parse.quote(title.replace(' ', '_'))
        text = cached(cache, 'ima-%s.txt' % letter, url, offline,
                      check=lambda d: b'Wikimedia Error' not in d[:3000] and len(d) > 5000)
        time.sleep(0 if text else 1)
        if not text:
            continue
        for m in re.finditer(r'^[#|]\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]', text, re.M):
            n = re.sub(r'-\([^)]*\)$', '', m.group(1).strip()).lower()
            n = re.sub(r'\s*\(mineral\)$', '', n)
            if WORD_ANY_RE.match(n):
                names.add(n)
    return names


def load_medical(cache, offline):
    text = cached(cache, 'medical-wordlist.txt', MED_URL, offline)
    low, cap = set(), set()
    if not text:
        sys.stderr.write('warning: medical word list unavailable\n')
        return low, cap
    for w in text.split('\n'):
        w = w.strip()
        if WORD_RE.match(w):
            low.add(w)
        elif re.match(r'^[A-Z][a-z]+$', w):
            cap.add(w.lower())
    return low - cap, cap


def load_names(cache, offline):
    """-> (names: set of lowercase person/place names, rank: {name: surname rank},
           major: names of countries, first-level divisions and cities over 50,000)"""
    names, rank, major = set(), {}, set()
    text = cached(cache, 'surnames2000.csv', SURNAMES_URL, offline)
    if text:
        for line in text.split('\n')[1:]:
            p = line.split(',')
            if len(p) > 2 and p[1].isdigit() and int(p[1]) <= 60000 and re.match(r'^[A-Z]+$', p[0]):
                k = p[0].lower()
                names.add(k)
                rank[k] = int(p[1])
    for fn, path in (('surnames-us.txt', 'surnames/us.txt'), ('surnames-all.txt', 'surnames/all.txt'),
                     ('firstnames-all.txt', 'first%20names/all.txt'), ('firstnames-us.txt', 'first%20names/us.txt')):
        text = cached(cache, fn, NAMEDB + path, offline)
        if text:
            for w in text.split('\n'):
                w = w.strip()
                if re.match(u'^[A-ZÀ-Þ][a-zß-ÿ]+$', w):
                    names.add(w.lower())
    data = cached(cache, 'cities1000.zip', GEONAMES + 'cities1000.zip', offline, binary=True,
                  check=lambda d: d[:2] == b'PK', timeout=300)
    if data:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            text = z.read('cities1000.txt').decode('utf-8', errors='replace')
        for line in text.split('\n'):
            p = line.split('\t')
            if len(p) < 15:
                continue
            big = p[14].isdigit() and int(p[14]) >= 50000
            for nm in (p[1], p[2]):
                for w in re.split(r"[\s\-'/]+", nm):
                    if re.match(u'^[A-ZÀ-Þ][a-zß-ÿ]+$', w):
                        names.add(w.lower())
                        if big:
                            major.add(w.lower())
    for fn in ('admin1CodesASCII.txt', 'countryInfo.txt'):
        text = cached(cache, fn, GEONAMES + fn, offline)
        if not text:
            continue
        for line in text.split('\n'):
            if line.startswith('#'):
                continue
            p = line.split('\t')
            fields = p[1:3] if fn.startswith('admin') else p[4:5]
            for nm in fields:
                for w in re.split(r"[\s\-'/]+", nm):
                    if re.match(u'^[A-ZÀ-Þ][a-zß-ÿ]+$', w):
                        names.add(w.lower())
                        major.add(w.lower())
    return names, rank, major


def load_crossref(cache, offline, exclude):
    titles = []
    for issn in CROSSREF_ISSNS:
        path = os.path.join(cache, 'cr-%s.json' % issn)
        if not os.path.exists(path):
            if offline:
                continue
            got, cursor = [], '*'
            for page in range(CROSSREF_PAGES):
                q = {'select': 'DOI,title', 'rows': '1000', 'cursor': cursor}
                if MAILTO: q['mailto'] = MAILTO
                text = fetch('https://api.crossref.org/journals/%s/works?%s' % (issn, urllib.parse.urlencode(q)), timeout=120)
                try:
                    msg = json.loads(text)['message'] if text else None
                except ValueError:
                    msg = None
                if not msg:
                    break
                for it in msg.get('items', []):
                    if it.get('title'):
                        got.append([it['DOI'], it['title'][0]])
                cursor = msg.get('next-cursor')
                if not msg.get('items') or not cursor:
                    break
                time.sleep(0.5)
            with open(path, 'w') as f:
                json.dump(got, f)
        with open(path) as f:
            for doi, t in json.load(f):
                if doi.lower() not in exclude:
                    titles.append(t)
    return titles


TAG_RE = re.compile(r'<[^>]+>|&[#a-zA-Z0-9]+;')
TOKEN_RE = re.compile(u"[A-Za-zÀ-ɏ]+(?:['’][A-Za-z]+)?|[^\\sA-Za-zÀ-ɏ]+")


def case_evidence(titles, known_lower):
    """Count, over titles that are clearly in sentence case, how often each word
    appears lowercase vs capitalised mid-sentence. -> (low, cap) dicts."""
    low, cap = {}, {}
    used = 0
    for t in titles:
        t = TAG_RE.sub(' ', t)
        toks = TOKEN_RE.findall(t)
        words = []           # (word, sentence_start)
        start = True
        for tk in toks:
            if re.match(u'^[A-Za-zÀ-ɏ]', tk):
                words.append((tk, start))
                start = False
            elif re.search(r'[:?!.—–(\[]', tk) or '"' in tk or '“' in tk:
                start = True if re.search(r'[:?!.—–]', tk) else start
        if len(words) < 5 or not words[0][0][0].isupper():
            continue                     # all-lowercase titles say nothing about case
        mid = [w for w, s in words if not s]
        test = [w for w in mid if len(w) >= 4 and w.lower() in known_lower and not w.isupper()]
        if len(test) < 3:
            continue
        ncap = sum(1 for w in test if w[0].isupper())
        if ncap * 10 > len(test):
            continue
        used += 1
        for w in mid:
            if len(w) < 2 or w.isupper() or not w[1:].islower():
                continue
            k = w.lower()
            if w[0].isupper():
                cap[k] = cap.get(k, 0) + 1
            else:
                low[k] = low.get(k, 0) + 1
    return low, cap, used


# ------------------------------------------------------- stemming (mirror of isCommon)

def stems(key):
    out = []
    if len(key) < 4:
        return out
    if len(key) > 4 and key.endswith('ies'):
        out.append(key[:-3] + 'y')
    if re.search(r'[^s]s$', key):
        out.append(key[:-1])
        if key.endswith('es'):
            out.append(key[:-2])
    if len(key) > 5 and key.endswith('ing'):
        b = key[:-3]
        out += [b, b + 'e']
        if re.search(r'(.)\1$', b):
            out.append(b[:-1])
    if len(key) > 4 and key.endswith('ed'):
        b = key[:-2]
        out += [b, b + 'e']
        if key.endswith('ied'):
            out.append(key[:-3] + 'y')
        if re.search(r'(.)\1$', b):
            out.append(b[:-1])
    if len(key) > 5 and key.endswith('ly'):
        out.append(key[:-2])
        if key.endswith('ily'):
            out.append(key[:-3] + 'y')
    return [s for s in out if len(s) >= 3 and s not in FUNCTION_WORDS]


# ---------------------------------------------------------------- output

def front_code(words):
    """Sorted words -> '~fc1 ' + entries '<n><suffix>' (n = shared prefix length)."""
    digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    out, prev = [], ''
    for w in words:
        n = 0
        m = min(len(prev), len(w), 35)
        while n < m and prev[n] == w[n]:
            n += 1
        out.append(digits[n] + w[n:])
        prev = w
    return '~fc1 ' + ' '.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-kb', type=int, default=600, help='cap on the output file size (KB, 1024 bytes)')
    ap.add_argument('--offline', action='store_true', help='use only the cache and the local dictionary')
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'autodoi-wordlist-cache'))
    ap.add_argument('--exclude-dois', help='file of DOIs whose titles must not be used as case evidence')
    ap.add_argument('--plain', action='store_true', help='write a plain space-separated list (no front coding)')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    off = args.offline

    # (a) web2
    with open(DICT, encoding='utf-8', errors='replace') as f:
        entries = [line.strip() for line in f]
    web2_lower = set(w for w in entries if WORD_RE.match(w))
    web2_cap = set(w.lower() for w in entries if w != w.lower())
    web2 = web2_lower - web2_cap

    # (b) SCOWL, (c) minerals, (d) medical, (f) names
    scowl, scowl_proper, scowl_pnames = load_scowl(args.cache, off)
    minerals = load_minerals(args.cache, off)
    med, med_cap = load_medical(args.cache, off)
    names, surname_rank, major_places = load_names(args.cache, off)

    # (g) frequency
    freq_rank, counts = {}, {}
    text = cached(args.cache, '20k.txt', FREQ_URL, off)
    if text:
        for i, w in enumerate(text.split()):
            if WORD_RE.match(w) and w not in freq_rank:
                freq_rank[w] = i
    text = cached(args.cache, 'count_1w.txt', COUNT_URL, off, timeout=300)
    if text:
        for line in text.splitlines():
            p = line.split('\t')
            if len(p) == 2 and WORD_RE.match(p[0]):
                try:
                    counts[p[0]] = int(p[1])
                except ValueError:
                    pass

    # (e) case evidence from sentence-case titles
    exclude = set()
    if args.exclude_dois:
        with open(args.exclude_dois) as f:
            exclude = set(l.strip().lower() for l in f if l.strip())
    titles = load_crossref(args.cache, off, exclude)
    known = web2 | set(scowl)
    cr_low, cr_cap, cr_used = case_evidence(titles, known)

    def cr_common(w):
        lo, ca = cr_low.get(w, 0), cr_cap.get(w, 0)
        return lo >= 2 and ca * 5 <= lo

    def cr_proper(w):
        lo, ca = cr_low.get(w, 0), cr_cap.get(w, 0)
        return ca >= 2 and ca >= 2 * lo

    core = set(w for w, s in scowl.items() if s <= 50)
    proper_dict = web2_cap | set(w for w, s in scowl_proper.items() if s <= 70) | med_cap
    namey = names | proper_dict

    always = (FUNCTION_WORDS | SUPPLEMENT | RESCUE) - EXCLUDE - PROPER_EXTRA
    pool = web2 | set(w for w, s in scowl.items() if s <= 70) | med | minerals | \
        set(w for w in cr_low if cr_common(w) and WORD_ANY_RE.match(w))
    def web2_cap_ok(w):
        # a capitalised web2 variant is overridden only by clear evidence: an everyday word
        # with no everyday proper reading ("rind"), a mineral or a word always lowercase in
        # titles ("ionic", "muscovite", "gold"), or lowercase-dominant with no proper-name
        # reading in SCOWL ("palladium"); never "May", "Guinea", "Mark", "Lee"
        lo, ca = cr_low.get(w, 0), cr_cap.get(w, 0)
        if scowl.get(w, 99) <= 35 and scowl_proper.get(w, 99) > 70 and w not in major_places and \
                surname_rank.get(w, 10 ** 9) > 5000:
            return True
        if w in major_places:
            return False
        if ca == 0 and lo >= 20:
            return True
        if w in minerals and cr_common(w):
            return True
        return cr_common(w) and lo >= 5 and scowl_proper.get(w, 99) > 60
    admitted, reasons = set(), {}
    rescued_core = set()
    for w in pool:
        if w in always:
            continue
        if w in EXCLUDE or w in PROPER_EXTRA or (w in ELEMENT_SYMBOLS and w not in FUNCTION_WORDS):
            continue
        if not WORD_ANY_RE.match(w):
            continue
        if w in web2_cap and not web2_cap_ok(w):
            continue                        # "March", "Turkey", "May": proper reading in the dictionary
        if w in scowl_proper and scowl_proper[w] <= 50 and w not in core and not cr_common(w):
            continue
        if cr_proper(w) and w not in core:
            reasons[w] = 'cr-proper'
            continue                        # "Bushveld", "Tibet", "Vesuvius"
        strong = w in core or cr_common(w) or w in minerals
        if w in namey and not strong:
            reasons[w] = 'name'
            continue                        # "cox", "pascual", "puna"
        if w in med and not (w in web2 or w in scowl or cr_common(w) or w in minerals) and \
                LATIN_TAXON_END.search(w) and counts.get(w, 0) < 100000:
            reasons[w] = 'taxon'
            continue                        # "artibeus", "aethomys": Latin genus names in the medical list
        if w in minerals or cr_common(w) or w in web2 or w in med or w in scowl:
            admitted.add(w)
            if w in web2_cap:
                rescued_core.add(w)
    admitted |= always

    # ranking for the size cap: domain evidence and minerals first, then frequency
    def rank_key(w):
        if w in always:
            return (0, 0, w)
        if cr_common(w):
            return (1, -cr_low.get(w, 0), w)
        if w in minerals:
            return (2, 0, w)
        if w in freq_rank:
            return (3, freq_rank[w], w)
        if w in core:
            return (4, -counts.get(w, 0), w)
        if counts.get(w, 0) > 0:
            return (5, -counts[w], w)
        if w in med:
            return (6, len(w), w)
        return (7, len(w), w)
    ranked = sorted(admitted, key=rank_key)
    # tier 7 (web2-only words with no web count) are mostly obsolete forms: drop them,
    # unless the counts are unavailable (then the dictionary is all we have)
    if counts:
        ranked = [w for w in ranked if rank_key(w)[0] < 7]
    else:
        sys.stderr.write('warning: web counts unavailable; ordering the rest by length\n')

    # !name: proper names whose stems are common; ^name: names the heuristics must respect
    adm_set = set(ranked)
    blocked, markers = set(), set()
    proper_all = (namey | PLACE_EXTRA | EXCLUDE | PROPER_EXTRA | set(w for w in cr_cap if cr_proper(w))) - adm_set
    for n in proper_all:
        if not WORD_ANY_RE.match(n) or len(n) < 4:
            continue
        strong_name = n in proper_dict or cr_proper(n) or surname_rank.get(n, 10 ** 9) <= 20000 or n in names or \
            n in EXCLUDE or n in PROPER_EXTRA
        if not strong_name:
            continue
        if any(s in adm_set for s in stems(n)):
            blocked.add(n)
        elif HEURISTIC_END.search(n) and (n in major_places or n in PLACE_EXTRA or surname_rank.get(n, 10 ** 9) <= 8000 or
                                          (scowl_pnames.get(n, 99) <= 60 and n in names)):
            # places and people only: a Latin genus written capitalised in titles
            # ("Tyrannosaurus") is exactly what the genus heuristic is for
            markers.add(n)
    for n in list(markers):
        if n in adm_set:
            markers.discard(n)

    header = (
        "/* AutoDOI common-words list: lowercase English words that are safe to lowercase\n"
        " * inside a title (no proper-noun reading), plus !never-common and ^proper-name\n"
        " * markers; front-coded (decoded by sentencecase.js wordsFrom). GENERATED by\n"
        " * tools/build-common-words.py; do not edit by hand. */\n"
        "(function (root) {\n  'use strict';\n  var WORDS = '"
    )
    footer = (
        "';\n  if (typeof module !== 'undefined' && module.exports) module.exports = WORDS;\n"
        "  root.AutoDOI_COMMON_WORDS = WORDS;\n"
        "})(typeof globalThis !== 'undefined' ? globalThis : this);\n"
    )
    budget = args.max_kb * 1024 - len(header.encode()) - len(footer.encode())
    extra = sorted('!' + w for w in blocked) + sorted('^' + w for w in markers)

    def encode(ws):
        allw = sorted(ws + extra)
        return (' '.join(allw) if args.plain else front_code(allw)).encode('utf-8')

    # binary search on the number of ranked words that fit
    lo, hi = 0, len(ranked)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if len(encode(ranked[:mid])) <= budget:
            lo = mid
        else:
            hi = mid - 1
    chosen = ranked[:lo]
    body = encode(chosen).decode('utf-8')
    body = body.replace('\\', '\\\\').replace("'", "\\'")

    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(header + body + footer)

    size = os.path.getsize(out_path)
    print('web2 lowercase-only: %d   SCOWL lower<=70: %d (core<=50: %d)   minerals: %d   medical: %d'
          % (len(web2), sum(1 for s in scowl.values() if s <= 70), len(core), len(minerals), len(med)))
    print('names/places (filter): %d   crossref titles: %d (sentence case used: %d)   words with lowercase evidence: %d'
          % (len(names), len(titles), cr_used, sum(1 for w in cr_low if cr_common(w))))
    print('words kept despite a capitalised web2 variant: %d (e.g. %s)'
          % (len(rescued_core), ' '.join(sorted(rescued_core)[:80])))
    print('excluded as names: %d (title evidence) + %d (name lists)'
          % (sum(1 for r in reasons.values() if r == 'cr-proper'), sum(1 for r in reasons.values() if r == 'name')))
    print('admitted: %d   ranked: %d   written: %d words + %d !blocked + %d ^names   file: %d bytes (%.1f KB, cap %d KB) -> %s'
          % (len(admitted), len(ranked), len(chosen), len(blocked), len(markers), size, size / 1024.0, args.max_kb, out_path))
    if len(chosen) < len(ranked):
        print('cap reached; last admitted word: %r (tier %d)' % (chosen[-1], rank_key(chosen[-1])[0]))


if __name__ == '__main__':
    main()
