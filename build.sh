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
# Content Security Policy: every inline <script> block is allowed by its SHA-256 hash, so script-src needs no
# 'unsafe-inline' (an injected <script> or handler would not run).  Recomputed here because the inlined blocks change.
import hashlib, base64
blocks = re.findall(r'<script>(.*?)</script>', html, re.S)
hashes = ["'sha256-%s'" % base64.b64encode(hashlib.sha256(b.encode('utf-8')).digest()).decode() for b in blocks]
csp_re = re.compile(r"(<meta http-equiv=\"Content-Security-Policy\" content=\"[^\"]*?script-src )[^;]*(;)")
if not csp_re.search(html): sys.exit('index.html has no script-src directive in its Content-Security-Policy')
html = csp_re.sub(lambda m: m.group(1) + "'self' " + ' '.join(hashes) + ' https://cdn.jsdelivr.net' + m.group(2), html, count=1)
open('index.html', 'w', encoding='utf-8').write(html)
print('CSP: %d inline script hashes' % len(hashes))
PY
cp citations.js apps-script/Citations.gs
echo "index.html and apps-script/Citations.gs refreshed"
