#!/bin/sh
# Inlines the library files into index.html (between marker comments) and refreshes the Apps Script copy,
# so index.html works as a single downloaded file. Run after editing citations.js, parsers.js or sentencecase.js.
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
import re, sys
html = open('index.html', encoding='utf-8').read()
for name in ('citations.js', 'parsers.js', 'sentencecase.js'):
    try:
        lib = open(name, encoding='utf-8').read()
    except FileNotFoundError:
        continue
    for bad in ('</script', '<!--', '-->'):
        if bad in lib:
            sys.exit('%s contains "%s", which would break index.html when inlined' % (name, bad))
    block = '<!-- %s (inlined by build.sh; edit %s, not this block) -->\n<script>\n%s\n</script>\n<!-- /%s -->' % (name, name, lib, name)
    pattern = re.compile(r'<!-- %s .*?<!-- /%s -->' % (re.escape(name), re.escape(name)), re.S)
    if pattern.search(html):
        html = pattern.sub(lambda m: block, html, count=1)
    elif '<script src="%s"></script>' % name in html:
        html = html.replace('<script src="%s"></script>' % name, block)
    else:
        # first inclusion: place it right after the citations.js block
        anchor = '<!-- /citations.js -->'
        if anchor not in html: sys.exit('index.html has no citations.js marker block')
        html = html.replace(anchor, anchor + '\n' + block, 1)
open('index.html', 'w', encoding='utf-8').write(html)
PY
cp citations.js apps-script/Citations.gs
echo "index.html and apps-script/Citations.gs refreshed"
