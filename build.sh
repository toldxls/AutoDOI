#!/bin/sh
# Inlines citations.js into index.html (between the marker comments) and refreshes the Apps Script copy,
# so index.html works as a single downloaded file. Run after editing citations.js.
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
import re
html = open('index.html').read()
lib = open('citations.js').read()
block = '<!-- citations.js (inlined by build.sh; edit citations.js, not this block) -->\n<script>\n' + lib + '\n</script>\n<!-- /citations.js -->'
pattern = re.compile(r'<!-- citations\.js .*?<!-- /citations\.js -->', re.S)
if pattern.search(html):
    html = pattern.sub(lambda m: block, html)
else:
    html = html.replace('<script src="citations.js"></script>', block)
open('index.html', 'w').write(html)
PY
cp citations.js apps-script/Citations.gs
echo "index.html and apps-script/Citations.gs refreshed"
