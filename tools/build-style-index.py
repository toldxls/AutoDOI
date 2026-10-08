#!/usr/bin/env python3
"""Rebuild data/styles-index.json (every Citation Style Language style at the commit index.html pins,
CSL_STYLES_COMMIT, read from the repository tarball at that commit so the index is reproducible and
matches the styles the page can fetch) and data/endnote-shortlist.json (the subset whose titles match
the style files that ship in an EndNote installation's Styles folder).

    python3 tools/build-style-index.py [/path/to/EndNote/Styles] [--out DIR] [--dry-run]

--out writes the two files under DIR instead of data/; --dry-run writes nothing and reports how the
rebuilt index would differ from the committed one.
"""
import html, io, json, os, re, sys, tarfile, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARBALL = 'https://github.com/citation-style-language/styles/archive/%s.tar.gz'
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

def pinned_commit():
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    m = re.search(r"var CSL_STYLES_COMMIT = '([0-9a-f]{40})'", html)
    if not m: sys.exit('could not find CSL_STYLES_COMMIT in index.html')
    return m.group(1)

def download(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'AutoDOI-tools (https://github.com/toldxls/AutoDOI)'})
    try:
        with urllib.request.urlopen(req, timeout=120) as res: return res.read()
    except Exception as e:  # a Python without a CA bundle (python.org builds before "Install Certificates"): curl has the system's
        import subprocess
        print('urllib failed (%s); trying curl' % e, file=sys.stderr)
        return subprocess.run(['curl', '-sSfL', '--max-time', '120', '--retry', '3', '-A', 'AutoDOI-tools', url], check=True, stdout=subprocess.PIPE).stdout

def styles_at(sha):
    """[{name, title, dependent}] for every .csl file in the styles repository at `sha`, sorted by title then name
    (the page lists an empty search in index order, so titles are what the user should see sorted)."""
    data = download(TARBALL % sha)
    out = []
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
        for m in tar:
            parts = m.name.split('/')[1:]  # "styles-<sha>/dependent/x.csl" -> ["dependent", "x.csl"]
            if not m.isfile() or not parts or not parts[-1].endswith('.csl'): continue
            if len(parts) == 2 and parts[0] == 'dependent': dependent = 1
            elif len(parts) == 1: dependent = 0
            else: continue  # nothing else in the tree is a style the page can fetch
            xml = tar.extractfile(m).read().decode('utf-8')
            t = re.search(r'<title>(.*?)</title>', xml, re.S)  # the first <title> is the style's own, in <info>
            title = html.unescape(t.group(1)).strip() if t else parts[-1][:-4]  # entities decoded, inner spacing kept, as Zotero's styles.json has it
            out.append({'name': parts[-1][:-4], 'title': title, 'dependent': dependent})
    out.sort(key=lambda s: (s['title'].casefold(), s['name']))
    return out

def main():
    args = sys.argv[1:]
    dry = '--dry-run' in args
    out_dir = args[args.index('--out') + 1] if '--out' in args else os.path.join(ROOT, 'data')
    positional = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] != '--out')]
    sha = pinned_commit()
    styles = styles_at(sha)
    compact = [[s['name'], s['title'], s['dependent']] for s in styles]
    print(len(compact), 'styles at', sha[:12])
    committed = os.path.join(ROOT, 'data', 'styles-index.json')
    if os.path.exists(committed):
        old = {e[0]: e for e in json.load(open(committed, encoding='utf-8'))}
        new = {e[0]: e for e in compact}
        added, removed = sorted(set(new) - set(old)), sorted(set(old) - set(new))
        changed = sorted(k for k in set(old) & set(new) if old[k] != new[k])
        print('against the committed index: %d added, %d removed, %d changed' % (len(added), len(removed), len(changed)))
        for label, ids in (('added', added), ('removed', removed), ('changed', changed)):
            for k in ids[:20]: print('  %s %s%s' % (label, k, (': %r -> %r' % (old[k][1:], new[k][1:])) if label == 'changed' else ''))
            if len(ids) > 20: print('  ... %d more %s' % (len(ids) - 20, label))
    if dry: print('dry run: nothing written'); return
    write_json(os.path.join(out_dir, 'styles-index.json'), compact)
    print('wrote', os.path.join(out_dir, 'styles-index.json'))

    endnote_dir = positional[0] if positional else None
    if not endnote_dir:
        for cand in ['/Applications/EndNote 21/Styles', os.path.expanduser('~/Documents/EndNote/Styles')]:
            if os.path.isdir(cand): endnote_dir = cand; break
    if not endnote_dir:
        print('No EndNote Styles folder found; shortlist left unchanged'); return
    if not os.path.isdir(endnote_dir): sys.exit('not a folder: ' + endnote_dir)
    names = [f[:-4] for f in os.listdir(endnote_dir) if f.endswith('.ens')]
    by_key = {}
    for s in styles: by_key.setdefault(' '.join(toks(s['title'])), []).append(s)
    by_set = {}
    for s in styles: by_set.setdefault(frozenset(toks(s['title'])), []).append(s)
    matched = set()
    for n in names:
        cands = by_key.get(' '.join(toks(n))) or by_set.get(frozenset(toks(n)))
        if cands: matched.add(sorted(cands, key=lambda s: s['dependent'])[0]['name'])
    write_json(os.path.join(out_dir, 'endnote-shortlist.json'), sorted(matched))
    print(len(names), 'EndNote styles ->', len(matched), 'CSL matches')

if __name__ == '__main__':
    main()
