#!/usr/bin/env python3
"""
Build data/common-words.js for AutoDOI's sentence-case converter.

The output is a single lowercase, space-separated string of English words
that are SAFE TO LOWERCASE inside an article title, i.e. words that have no
plausible proper-noun reading.  Anything not in this list is left capitalised
by sentencecase.js, so omissions are cheap (the user clicks a word to flip it)
while false inclusions (lowercasing "Turkey", "Cretaceous", "March") are what
we work hardest to avoid.

Recipe (deterministic; every choice below is data-driven or listed in this file):

  (a) /usr/share/dict/words (Webster's 2nd, "web2").  Keep entries that are
      letters-only, 2+ letters, and appear ONLY in lowercase form.  If the
      dictionary also has a capitalised variant ("March"/"march",
      "Turkey"/"turkey", "Cretaceous"/"cretaceous") a proper-noun reading
      exists and the word is excluded.
  (b) A frequency-ranked common-English list downloaded at build time
      (first20hours 20k list).  Every word in it that is also in (a) is
      ranked first when the size cap bites.  Names that appear lowercase in
      the frequency list ("john", "california") are excluded because their
      capitalised variant is in the dictionary.  If the URL does not respond
      we fall back to (a) only.
  (c) Optional: Norvig's count_1w.txt (Google Web 1T unigram counts) is used
      ONLY to order the remaining dictionary words when the file must be
      capped.  Without it the remaining words are ordered by length, then
      alphabetically (a much poorer ranking; a warning is printed).
  (d) Curated adjustments, all visible below:
        FUNCTION_WORDS  always included (articles, prepositions, ... "new").
        RESCUE          common words that web2 happens to list capitalised for
                        an obscure reason ("The", "Case", "State", "Fauna",
                        "Gene", "Fauna") and which we want back.
        SUPPLEMENT      modern scientific vocabulary that is missing from the
                        1934 web2 ("coronavirus", "genome", "dataset").
        EXCLUDE         words web2 lists only in lowercase but which are
                        overwhelmingly proper nouns in geoscience/biology
                        titles ("pacific", "arctic", "earth", "quaternary").
        Two-letter chemical element symbols are excluded unless they are
        function words ("in", "as", "at", "be", "no") so that "Ca", "Pb",
        "Sr" survive in a geochemistry title.

  Inflections are NOT stored: sentencecase.js strips regular -s/-es/-ies,
  -ing, -ed and -ly endings at lookup time and re-checks the stem, so
  "placentals" -> "placental", "scoping" -> "scope", "mammals" -> "mammal".

  Size cap: the whole .js file is kept at or under MAX_KB (about 300 KB).
  Words are admitted in rank order (function words + supplement first, then
  the frequency list, then dictionary words by web count) until the budget is
  spent, then written alphabetically so diffs are stable.

Usage:  python3 tools/build-common-words.py [--max-kb 300] [--offline]
"""
import argparse
import os
import re
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data', 'common-words.js')
DICT = '/usr/share/dict/words'
FREQ_URL = 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/20k.txt'
COUNT_URL = 'https://norvig.com/ngrams/count_1w.txt'

# Standard function words (the set requested for the converter) plus a few
# more closed-class words that web2 lacks ("has") or lists capitalised.
FUNCTION_WORDS = set("""
a an the of in on and or for with from to by at as but nor via vs versus into
onto over under between among within without during after before through
toward towards upon about across along around against is are was were be been
its their our this that these those new
has have had do does did not if than then when where how what which who whom
whose why it we you they us them can could should would will shall might must
so yet both either neither each every all any some such more most less least
very only also non per
""".split())

# Common words that web2 also lists with a capital for an obscure reason.
# Only applied when the lowercase form exists in web2.
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
""".split())

# Modern / scientific vocabulary absent from the 1934 web2 word list.
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
""".split())

# Words that web2 lists only in lowercase but which are overwhelmingly used
# as proper nouns in the target domain.
EXCLUDE = set("""
pacific arctic antarctic mediterranean quaternary tertiary earth gaussian
bayesian boolean cartesian euclidean newton darwin wallace mendel einstein
markov fourier laplace linnean linnaean smithsonian
bolivia brazil chad chile china finland gambia mali mozambique panama
zimbabwe berlin dover york hong titan
""".split())

# Two-letter chemical element symbols (lowercased). Excluded unless they are
# also function words so that "Ca", "Pb", "Sr" in a title stay capitalised.
ELEMENT_SYMBOLS = set("""
he li be ne na mg al si cl ar ca sc ti cr mn fe co ni cu zn ga ge as se br kr
rb sr zr nb mo tc ru rh pd ag cd in sn sb te xe cs ba la ce pr nd pm sm eu gd
tb dy ho er tm yb lu hf ta re os ir pt au hg tl pb bi po at rn fr ra ac th pa
np pu am cm bk cf es fm md no lr rf db sg bh hs mt ds rg cn nh fl mc lv ts og
""".split())

WORD_RE = re.compile(r'^[a-z]{2,}$')


def fetch(url, timeout=30):
    """Return the text at url, or None if it does not respond with 200.

    Tries urllib first; if that fails (python.org builds on macOS often lack
    root certificates) falls back to the system curl.
    """
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            if r.status == 200:
                return r.read().decode('utf-8', errors='replace')
    except Exception as e:  # noqa: BLE001 - any failure means "try curl"
        sys.stderr.write('note: urllib failed for %s (%s); trying curl\n' % (url, e.__class__.__name__))
    try:
        res = subprocess.run(['curl', '-sSL', '--fail', '--max-time', str(timeout), url],
                             capture_output=True, check=False)
        if res.returncode == 0 and res.stdout:
            return res.stdout.decode('utf-8', errors='replace')
        sys.stderr.write('warning: could not fetch %s (curl exit %d)\n' % (url, res.returncode))
    except Exception as e:  # noqa: BLE001
        sys.stderr.write('warning: could not fetch %s (%s)\n' % (url, e))
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-kb', type=int, default=300, help='cap on the output file size (KB, 1024 bytes)')
    ap.add_argument('--offline', action='store_true', help='do not download anything; dictionary only')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()

    # (a) dictionary
    with open(DICT, encoding='utf-8', errors='replace') as f:
        entries = [line.strip() for line in f]
    lower = set(w for w in entries if WORD_RE.match(w))
    capset = set(w.lower() for w in entries if w != w.lower())
    a = lower - capset
    n_excluded_by_cap = len(lower & capset)

    rescued = RESCUE - a
    a |= RESCUE
    a -= EXCLUDE
    a -= (ELEMENT_SYMBOLS - FUNCTION_WORDS)

    # (b) frequency list
    freq_rank = {}
    if not args.offline:
        text = fetch(FREQ_URL)
        if text:
            for i, w in enumerate(text.split()):
                if WORD_RE.match(w) and w not in freq_rank:
                    freq_rank[w] = i
        else:
            sys.stderr.write('warning: frequency list unavailable; using dictionary only\n')

    # (c) web counts for ordering the rest of the dictionary
    counts = {}
    if not args.offline:
        text = fetch(COUNT_URL)
        if text:
            for line in text.splitlines():
                parts = line.split('\t')
                if len(parts) == 2 and WORD_RE.match(parts[0]):
                    try:
                        counts[parts[0]] = int(parts[1])
                    except ValueError:
                        pass
        else:
            sys.stderr.write('warning: count list unavailable; ordering dictionary words by length\n')

    always = (FUNCTION_WORDS | SUPPLEMENT) - EXCLUDE
    # Frequency-list words are only admitted when the dictionary vouches for
    # them (they are in (a)); this is what drops "john", "california", "ebay".
    from_freq = [w for w in sorted(freq_rank, key=freq_rank.get) if w in a and w not in always]
    rest = [w for w in a if w not in always and w not in freq_rank]
    if counts:
        # words with no web count at all are too obscure to matter and are
        # dropped outright, which also drops many web2 typos/dialect forms.
        rest = [w for w in rest if counts.get(w, 0) > 0]
        rest.sort(key=lambda w: (-counts[w], w))
    else:
        rest.sort(key=lambda w: (len(w), w))

    ranked = sorted(always) + from_freq + rest

    header = (
        "/* AutoDOI common-words list: lowercase English words that are safe to lowercase\n"
        " * inside a title (no proper-noun reading). GENERATED by tools/build-common-words.py\n"
        " * from /usr/share/dict/words + a frequency list; do not edit by hand. */\n"
        "(function (root) {\n  'use strict';\n  var WORDS = '"
    )
    footer = (
        "';\n  if (typeof module !== 'undefined' && module.exports) module.exports = WORDS;\n"
        "  root.AutoDOI_COMMON_WORDS = WORDS;\n"
        "})(typeof globalThis !== 'undefined' ? globalThis : this);\n"
    )
    budget = args.max_kb * 1024 - len(header.encode()) - len(footer.encode())
    chosen = []
    used = 0
    for w in ranked:
        cost = len(w) + (1 if chosen else 0)
        if used + cost > budget:
            break
        chosen.append(w)
        used += cost
    chosen.sort()

    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(header + ' '.join(chosen) + footer)

    size = os.path.getsize(out_path)
    print('dictionary entries: %d  lowercase letters-only: %d  excluded (capitalised variant exists): %d  kept (a): %d'
          % (len(entries), len(lower), n_excluded_by_cap, len(a)))
    print('frequency list: %s words; %d admitted (in dictionary lowercase-only set)'
          % (len(freq_rank) if freq_rank else 'unavailable', len(from_freq)))
    print('web counts: %s' % ('%d words' % len(counts) if counts else 'unavailable (length ordering)'))
    print('rescued: %d  supplement: %d  excluded (curated): %d' % (len(rescued), len(SUPPLEMENT), len(EXCLUDE & lower)))
    print('candidates ranked: %d  written: %d words  file: %d bytes (%.1f KB, cap %d KB)  -> %s'
          % (len(ranked), len(chosen), size, size / 1024.0, args.max_kb, out_path))
    if len(chosen) < len(ranked):
        print('cap reached; last admitted dictionary word: %r' % chosen_last(ranked, len(chosen)))


def chosen_last(ranked, n):
    return ranked[n - 1] if n else None


if __name__ == '__main__':
    main()
