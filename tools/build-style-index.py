#!/usr/bin/env python3
"""Rebuild data/styles-index.json (all Citation Style Language styles, from Zotero's style
repository index) and data/endnote-shortlist.json (the subset whose titles match the style
files that ship in an EndNote installation's Styles folder).

    python3 tools/build-style-index.py [/path/to/EndNote/Styles]
"""
import json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STYLES_JSON = 'https://www.zotero.org/styles-files/styles.json'
ABBR = {'amer': 'american', 'j': 'journal', 'adv': 'advances', 'res': 'research', 'rev': 'review', 'sci': 'science',
        'soc': 'society', 'intl': 'international', 'int': 'international', 'natl': 'national', 'biol': 'biology',
        'chem': 'chemistry', 'phys': 'physics', 'med': 'medicine', 'env': 'environmental', 'enviro': 'environmental',
        'ecol': 'ecology', 'geol': 'geology', 'psych': 'psychology', 'assoc': 'association', 'proc': 'proceedings',
        'trans': 'transactions', 'eng': 'engineering', 'educ': 'education', 'mgmt': 'management', 'tech': 'technology',
        'sys': 'systems', 'agri': 'agricultural', 'anal': 'analytical', 'appl': 'applied', 'comm': 'communications',
        'comp': 'computer', 'clin': 'clinical', 'exp': 'experimental', 'geochem': 'geochemistry', 'mineral': 'mineralogy',
        'anthro': 'anthropology', 'biochem': 'biochemistry', 'microbiol': 'microbiology', 'pharm': 'pharmaceutical',
        'surg': 'surgery', 'vet': 'veterinary', 'ann': 'annals', 'bull': 'bulletin', 'brit': 'british', 'can': 'canadian',
        'austral': 'australian', 'eur': 'european', 'geog': 'geography', 'hist': 'history', 'lett': 'letters',
        'mat': 'materials', 'mater': 'materials', 'nutr': 'nutrition', 'phil': 'philosophical', 'stat': 'statistical',
        'zool': 'zoology', 'oceanogr': 'oceanography', 'ecosys': 'ecosystems'}
STOP = {'the', 'of', 'and', 'for', 'in', 'on', 'a', 'an', 'journal', 'style', 'guide', 'edition'}

def toks(s):
    s = re.sub(r'\b\d+(st|nd|rd|th)\b', ' ', s.lower())
    return [ABBR.get(t, t) for t in re.sub(r'[^a-z0-9]+', ' ', s).split() if ABBR.get(t, t) not in STOP]

def write_json(path, data):
    # write to a temp file first so a failure keeps the previous index intact
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'), ensure_ascii=False)
    os.replace(tmp, path)

def main():
    styles = json.load(urllib.request.urlopen(STYLES_JSON, timeout=60))
    compact = [[s['name'], s['title'], 1 if s.get('dependent') else 0] for s in styles]
    write_json(os.path.join(ROOT, 'data', 'styles-index.json'), compact)
    print(len(compact), 'styles indexed')

    endnote_dir = sys.argv[1] if len(sys.argv) > 1 else None
    if not endnote_dir:
        for cand in ['/Applications/EndNote 21/Styles', os.path.expanduser('~/Documents/EndNote/Styles')]:
            if os.path.isdir(cand): endnote_dir = cand; break
    if not endnote_dir:
        print('No EndNote Styles folder found; shortlist left unchanged'); return
    names = [f[:-4] for f in os.listdir(endnote_dir) if f.endswith('.ens')]
    by_key = {}
    for s in styles: by_key.setdefault(' '.join(toks(s['title'])), []).append(s)
    by_set = {}
    for s in styles: by_set.setdefault(frozenset(toks(s['title'])), []).append(s)
    matched = set()
    for n in names:
        cands = by_key.get(' '.join(toks(n))) or by_set.get(frozenset(toks(n)))
        if cands: matched.add(sorted(cands, key=lambda s: s.get('dependent', 0))[0]['name'])
    write_json(os.path.join(ROOT, 'data', 'endnote-shortlist.json'), sorted(matched))
    print(len(names), 'EndNote styles ->', len(matched), 'CSL matches')

if __name__ == '__main__':
    main()
