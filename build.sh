#!/bin/sh
# Inlines citations.js into index.html (between the marker comments) and refreshes the Apps Script copy,
# so index.html works as a single downloaded file. Run after editing citations.js.
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
import re, sys
html = open('index.html', encoding='utf-8').read()
lib = open('citations.js', encoding='utf-8').read()
for bad in ('</script', '<!--', '-->'):
    if bad in lib:
        sys.exit('citations.js contains "%s", which would break index.html when inlined' % bad)
block = '<!-- citations.js (inlined by build.sh; edit citations.js, not this block) -->\n<script>\n' + lib + '\n</script>\n<!-- /citations.js -->'
pattern = re.compile(r'<!-- citations\.js .*?<!-- /citations\.js -->', re.S)
if pattern.search(html):
    html = pattern.sub(lambda m: block, html, count=1)
elif '<script src="citations.js"></script>' in html:
    html = html.replace('<script src="citations.js"></script>', block)
else:
    sys.exit('index.html has no citations.js marker block to replace')
open('index.html', 'w', encoding='utf-8').write(html)
PY
cp citations.js apps-script/Citations.gs
echo "index.html and apps-script/Citations.gs refreshed"
