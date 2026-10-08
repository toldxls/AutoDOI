// Syntax and consistency checks that need no browser: every shipped script parses, the Apps Script copy is
// identical to the library, the inlined copies in index.html match the library files, and the version
// string is the same in package.json, index.html and CHANGELOG.md.  Usage: node tests/syntax.test.js
var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
var ROOT = path.join(__dirname, '..');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + String(detail).split('\n').slice(0, 6).join('\n     ') : '')); } }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// node --check accepts only .js/.mjs/.cjs names, so everything is checked from a temporary .js copy
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autodoi-syntax-'));
function parses(label, source) {
  var f = path.join(tmp, label.replace(/[^\w.-]+/g, '_') + '.js');
  fs.writeFileSync(f, source);
  var res = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  check(label + ' parses', res.status === 0, res.stderr);
}

['citations.js', 'parsers.js', 'sentencecase.js', 'data/common-words.js', 'apps-script/Code.gs', 'apps-script/Citations.gs', 'tests/run.js', 'sw.js', 'bin/autodoi.js']
  .forEach(function (rel) { parses(rel, read(rel)); });

// Every inline <script> block in index.html (the app code, plus the inlined libraries)
var html = read('index.html');
function scriptBlocks(h) { var re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g, m, out = []; while ((m = re.exec(h))) out.push(m[1]); return out; } // every inline block, whatever its attributes (type="module" too)
var blocks = scriptBlocks(html), n = 0;
blocks.forEach(function (src) { if (src.trim()) parses('index.html inline script #' + (++n), src); });
check('index.html has inline scripts', n >= 4, 'found ' + n);
check('index.html has no external <script src>', !/<script[^>]*\ssrc=/.test(html));

// Apps Script copy and inlined copies are current (CI also rebuilds and diffs; this catches it locally)
check('apps-script/Citations.gs is identical to citations.js', read('apps-script/Citations.gs') === read('citations.js'), 'run ./build.sh');
['citations.js', 'parsers.js', 'sentencecase.js'].forEach(function (name) {
  var block = html.match(new RegExp('<!-- ' + name.replace('.', '\\.') + ' [^\\n]*-->\\n<script>\\n([\\s\\S]*?)\\n</script>\\n<!-- /' + name.replace('.', '\\.') + ' -->'));
  check('index.html inlines the current ' + name, !!block && block[1] === read(name), 'run ./build.sh');
});

// One version string everywhere
var pkg = JSON.parse(read('package.json')).version;
var inPage = (html.match(/var APP_VERSION = '([^']+)'/) || [])[1];
var inLog = (read('CHANGELOG.md').match(/^## \[?v?(\d+\.\d+\.\d+)/m) || [])[1];
check('package.json version is semver', /^\d+\.\d+\.\d+$/.test(pkg), pkg);
check('index.html APP_VERSION matches package.json (' + pkg + ')', inPage === pkg, 'page says ' + inPage);
check('CHANGELOG.md top entry matches package.json (' + pkg + ')', inLog === pkg, 'changelog says ' + inLog);
var inLock = (function () { try { return JSON.parse(read('package-lock.json')).version; } catch (e) { return 'unreadable: ' + e.message; } })();
check('package-lock.json version matches package.json (' + pkg + ')', inLock === pkg, 'lock says ' + inLock);
// Every changelog heading carries a real date, none in the future, and they do not increase down the file
var heads = read('CHANGELOG.md').match(/^## .*$/gm) || [], today = new Date().toISOString().slice(0, 10), prev = null, dated = 0;
check('CHANGELOG.md has version headings', heads.length > 0);
heads.forEach(function (h) {
  var d = (h.match(/^## \[?v?\d+\.\d+\.\d+\]? - (\d{4}-\d{2}-\d{2})\s*$/) || [])[1];
  if (/unreleased/i.test(h)) return; // the open entry has no date
  check('CHANGELOG.md heading is "## x.y.z - YYYY-MM-DD": ' + h, !!d, h);
  if (!d) return;
  dated++;
  var t = new Date(d + 'T00:00:00Z');
  check('CHANGELOG.md date parses: ' + d, !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d, h);
  check('CHANGELOG.md date is not in the future: ' + d, d <= today, h + ' (today ' + today + ')');
  check('CHANGELOG.md dates do not increase down the file: ' + d, prev === null || d <= prev, h + ' after ' + prev);
  prev = d;
});
check('CHANGELOG.md has dated entries', dated > 0);
var inSw = (read('sw.js').match(/var VERSION = '([^']+)'/) || [])[1];
check('sw.js VERSION matches package.json (' + pkg + '), so an update replaces the old cache', inSw === pkg, 'sw.js says ' + inSw);
check('manifest.webmanifest is valid JSON with an icon', (function () { try { var mf = JSON.parse(read('manifest.webmanifest')); return mf.name === 'AutoDOI' && mf.icons.length > 0 && fs.existsSync(path.join(ROOT, mf.icons[0].src)); } catch (e) { return false; } })());

// Page metadata that is easy to lose in a big edit
check('index.html has a favicon', /<link rel="icon" href="data:image\/svg\+xml,/.test(html));
check('index.html has a description', /<meta name="description"/.test(html));
check('index.html has a Content-Security-Policy', /Content-Security-Policy/.test(html));
// script-src lists a hash for every inline script and nothing else that would let injected script run
var crypto = require('crypto');
var scriptSrc = (html.match(/Content-Security-Policy" content="[^"]*?script-src ([^;]*);/) || [])[1] || '';
var wantHashes = blocks.map(function (src) { return "'sha256-" + crypto.createHash('sha256').update(src, 'utf8').digest('base64') + "'"; }); // the same blocks the parse check saw, so a <script type="module"> is hashed too
check('CSP script-src has no unsafe-inline or unsafe-eval', !/unsafe-inline|unsafe-eval/.test(scriptSrc), scriptSrc);
check('CSP script-src hashes every inline script block (run ./build.sh)', wantHashes.length >= 4 && wantHashes.every(function (h) { return scriptSrc.indexOf(h) !== -1; }), scriptSrc);
var citeprocUrl = (html.match(/var CITEPROC = '([^']+)'/) || [])[1] || '';
check('CSP script-src allows only self, the hashes and the exact pinned citeproc URL (run ./build.sh)', /^https:\/\/cdn\.jsdelivr\.net\/npm\/citeproc@\d/.test(citeprocUrl) && scriptSrc.split(/\s+/).filter(Boolean).every(function (tok) { return tok === "'self'" || /^'sha256-[A-Za-z0-9+\/=]+'$/.test(tok) || tok === citeprocUrl; }) && scriptSrc.indexOf(citeprocUrl) !== -1, scriptSrc);
// connect-src names each host the page talks to and nothing wider: every https host literal in the page's own code (not the inlined
// libraries) is either a fetched host, named in connect-src, or one of the known link-only hosts listed here. A new host fails until it is
// placed in one list or the other
var connectSrc = (html.match(/Content-Security-Policy" content="[^"]*?connect-src ([^;]*);/) || [])[1] || '';
var connectHosts = connectSrc.split(/\s+/).filter(function (t) { return /^https:\/\//.test(t); }).map(function (t) { return t.replace(/^https:\/\//, '').replace(/\/.*$/, ''); });
check('CSP connect-src has no bare scheme, wildcard or unsafe source', connectSrc.split(/\s+/).filter(Boolean).every(function (tok) { return tok === "'self'" || /^https:\/\/[a-z0-9.-]+$/.test(tok); }), connectSrc);
var pageBlock = html.replace(/<!-- (citations|parsers|sentencecase)\.js \(inlined[\s\S]*?<!-- \/\1\.js -->/g, '') // the page's own code and markup
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replace(/<link [^>]*>/g, '').replace(/\shref="https:[^"]*"/g, ''); // not the policy itself, the font stylesheet (style-src) or plain links
var LINK_ONLY = ['github.com', 'toldxls.github.io', 'ezproxy.example.edu', 'cdn.jsdelivr.net']; // issue links, the page's own address in a status line, a Settings example, the script (script-src)
var pageHosts = {}; (pageBlock.match(/https:\/\/[a-z0-9.-]+\.[a-z]+/gi) || []).forEach(function (u) { pageHosts[u.replace(/^https:\/\//i, '').toLowerCase()] = 1; });
var unlisted = Object.keys(pageHosts).filter(function (hst) { return connectHosts.indexOf(hst) === -1 && LINK_ONLY.indexOf(hst) === -1; });
check('every https host named in the page code is in connect-src (or a known link-only host)', unlisted.length === 0, 'not in connect-src: ' + unlisted.join(', '));
var stale = connectHosts.filter(function (hst) { return !pageHosts[hst]; });
check('every connect-src host is one the page code names', stale.length === 0, 'no longer fetched: ' + stale.join(', '));
check('connect-src covers the services the README names', ['api.crossref.org', 'doi.org', 'api.openalex.org', 'api.unpaywall.org', 'www.ebi.ac.uk', 'openlibrary.org', 'eutils.ncbi.nlm.nih.gov', 'raw.githubusercontent.com'].every(function (hst) { return connectHosts.indexOf(hst) !== -1; }), connectSrc);
check('index.html has no inline event handlers', !/<[a-z][^>]*\son[a-z]+\s*=/i.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')));
check('CSL styles are pinned to a commit, not master', /citation-style-language\/styles\/' \+ CSL_STYLES_COMMIT/.test(html) && /CSL_STYLES_COMMIT = '[0-9a-f]{40}'/.test(html));
check('CSL locale is pinned to a commit, not master', /CSL_LOCALES_COMMIT = '[0-9a-f]{40}'/.test(html));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
