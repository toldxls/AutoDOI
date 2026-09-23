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

['citations.js', 'parsers.js', 'sentencecase.js', 'data/common-words.js', 'apps-script/Code.gs', 'apps-script/Citations.gs', 'tests/run.js']
  .forEach(function (rel) { parses(rel, read(rel)); });

// Every inline <script> block in index.html (the app code, plus the inlined libraries)
var html = read('index.html');
var re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g, m, n = 0;
while ((m = re.exec(html))) { if (m[1].trim()) parses('index.html inline script #' + (++n), m[1]); }
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

// Page metadata that is easy to lose in a big edit
check('index.html has a favicon', /<link rel="icon" href="data:image\/svg\+xml,/.test(html));
check('index.html has a description', /<meta name="description"/.test(html));
check('index.html has a Content-Security-Policy', /Content-Security-Policy/.test(html));
check('CSL styles are pinned to a commit, not master', /citation-style-language\/styles\/' \+ CSL_STYLES_COMMIT/.test(html) && /CSL_STYLES_COMMIT = '[0-9a-f]{40}'/.test(html));
check('CSL locale is pinned to a commit, not master', /CSL_LOCALES_COMMIT = '[0-9a-f]{40}'/.test(html));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
