#!/bin/sh
# Moves the pinned Citation Style Language commits in index.html to the current upstream master and
# refreshes data/styles-index.json at the same time so the search list and the pinned styles move together.
# Usage: ./tools/bump-csl-pin.sh   (needs curl and python3; run the tests afterwards and commit)
set -e
cd "$(dirname "$0")/.."
latest() { curl -sSf -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/citation-style-language/$1/commits/master"; }
python3 - "$(latest styles)" "$(latest locales)" <<'PY'
import json, re, sys
styles, locales = json.loads(sys.argv[1]), json.loads(sys.argv[2])
html = open('index.html', encoding='utf-8').read()
def pin(html, var, repo, data):
    sha, date = data['sha'], data['commit']['committer']['date'][:10]
    new = "var %s = '%s'; // citation-style-language/%s, %s" % (var, sha, repo, date)
    html2, n = re.subn(r"var %s = '[0-9a-f]{40}'; // citation-style-language/%s, \d{4}-\d{2}-\d{2}" % (var, repo), new, html)
    if n != 1: sys.exit('could not find the %s pin in index.html' % var)
    print('%s -> %s (%s)' % (var, sha[:12], date)); return html2
html = pin(html, 'CSL_STYLES_COMMIT', 'styles', styles)
html = pin(html, 'CSL_LOCALES_COMMIT', 'locales', locales)
open('index.html', 'w', encoding='utf-8').write(html)
PY
echo "Rebuilding data/styles-index.json..."
python3 tools/build-style-index.py
echo "Done. Run 'npm test' and commit index.html and data/styles-index.json together."
