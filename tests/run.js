// Runs every test suite and smoke check; exits non-zero if anything fails.  Usage: node tests/run.js
// A suite passes only when it exits 0 AND its last "N passed, M failed" line says 0 failed and N > 0: a suite
// that crashes before counting, or that counts nothing, is a failure, not a pass.
var path = require('path'), fs = require('fs'), cp = require('child_process');
var dir = __dirname, failed = 0, total = 0;
var files = fs.readdirSync(dir).filter(function (f) { return /\.test\.js$/.test(f) || /^smoke-.*\.js$/.test(f); }).sort();
files.forEach(function (f) {
  var t0 = Date.now(), res = cp.spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  var out = (res.stdout || '') + (res.stderr || '');
  var all = out.match(/(\d+) passed, (\d+) failed\s*$/gm), m = all && all[all.length - 1].match(/(\d+) passed, (\d+) failed/); // the last count line is the suite total
  var why = res.status !== 0 ? 'exit ' + res.status : !m ? 'no count line' : m[2] !== '0' ? m[2] + ' failed' : Number(m[1]) === 0 ? '0 passed' : '';
  var ok = !why;
  if (m) total += Number(m[1]) + Number(m[2]);
  console.log((ok ? 'ok   ' : 'FAIL ') + f + (m ? '  ' + m[1] + ' passed, ' + m[2] + ' failed' : '') + (ok ? '' : '  [' + why + ']') + '  (' + (Date.now() - t0) + ' ms)');
  if (!ok) { failed++; console.log(out.split('\n').filter(function (l) { return /FAIL|Error|at /.test(l); }).slice(0, 25).join('\n')); }
});
console.log('\n' + (failed ? failed + ' suite(s) failed' : 'all ' + files.length + ' suites passed') + ' (' + total + ' checks)');
process.exitCode = failed ? 1 : 0;
