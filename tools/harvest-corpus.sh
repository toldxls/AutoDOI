#!/bin/sh
# Rebuilds tests/fixtures/corpus.json: a random sample of real Crossref records of every work type, reduced to
# the fields the library reads, for the invariant sweep (tests/invariants.test.js) and the fuzz suite.
# The sample is random, so the file is committed; rerun only when you want fresh records, and rerun the tests.
# Usage: ./tools/harvest-corpus.sh
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
UA="AutoDOI-tests (https://github.com/toldxls/AutoDOI)"
for spec in journal-article:100 journal-article:100 book:40 book-chapter:40 proceedings-article:40 posted-content:40 dataset:30 dissertation:30 report:30 \
            monograph:20 edited-book:20 reference-entry:20 standard:20 other:20 peer-review:10 component:10 book-section:10 journal-issue:5 reference-book:10 report-component:5; do
  t=${spec%%:*}; n=${spec##*:}
  i=$((${i:-0}+1)); curl -sS -A "$UA" -o "$tmp/$i-$t-$n.json" "https://api.crossref.org/works?sample=$n&filter=type:$t"
  sleep 1
done
python3 - "$tmp" <<'PY'
import json, glob, os, sys
KEEP = {'type','DOI','URL','title','subtitle','original-title','short-title','author','editor','translator','chair','container-title','short-container-title',
        'issued','published','published-print','published-online','posted','accepted','approved','volume','issue','page','article-number','publisher',
        'publisher-location','institution','degree','ISSN','ISBN','issn-type','isbn-type','edition-number','number-of-pages','event','subtype','group-title',
        'relation','language','standards-body','series-title','part-number','description','subject','update-to'}
seen, out, stats = set(), [], {}
for f in sorted(glob.glob(sys.argv[1] + '/*.json')):
    for it in json.load(open(f))['message']['items']:
        doi = (it.get('DOI') or '').lower()
        if not doi or doi in seen: continue
        seen.add(doi)
        rec = {k: v for k, v in it.items() if k in KEEP}
        for who in ('author', 'editor', 'translator', 'chair'):
            if who in rec:
                for p in rec[who]:
                    for k in ('affiliation', 'ORCID', 'authenticated-orcid'): p.pop(k, None)
                if len(rec[who]) > 80: rec['_truncated_' + who] = len(rec[who]); rec[who] = rec[who][:80]
        out.append(rec); stats[rec.get('type')] = stats.get(rec.get('type'), 0) + 1
out.sort(key=lambda r: (r.get('type', ''), r['DOI']))
json.dump(out, open('tests/fixtures/corpus.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'records,', os.path.getsize('tests/fixtures/corpus.json'), 'bytes'); print(stats)
PY
rm -rf "$tmp"
echo "Now run: node tests/invariants.test.js && node tests/fuzz.test.js"
