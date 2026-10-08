// Exercise map_/cellAt_/flatten_/idToDoi_ shape logic with stubbed Apps Script services.  Each call is checked
// for the shape the sheet needs (a scalar in gives a scalar out, a range in gives a range of the same height
// and the asked width); --verbose prints every value.  Usage: node tests/smoke-sheets.js [--verbose]
var ROOT = require('path').resolve(__dirname, '..');
var FIX = require('path').join(__dirname, 'fixtures');
const fs = require('fs'); const vm = require('vm');
var verbose = process.argv.indexOf('--verbose') !== -1, passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + String(detail).slice(0, 300) : '')); } }
const ctx = { console, Date, JSON, Math, String, Array, Object, RegExp, Error, encodeURIComponent };
ctx.globalThis = ctx;
ctx.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {} }) };
ctx.Utilities = { base64Encode: s => Buffer.from(String(s)).toString('base64'), computeDigest: (a, s) => s, DigestAlgorithm: {}, Charset: {} };
ctx.UrlFetchApp = { fetch: () => { throw new Error('network disabled in test'); }, fetchAll: () => { throw new Error('network disabled'); } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(ROOT, 'apps-script/Citations.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(require('path').join(ROOT, 'apps-script/Code.gs'), 'utf8'), ctx);
// t(label, value, test): the value is printed under --verbose and must satisfy the test
const t = (label, v, test) => { if (verbose) console.log(label, JSON.stringify(v)); check(label, test(v), JSON.stringify(v)); };
const isRange = (v, rows, cols) => Array.isArray(v) && v.length === rows && v.every(row => Array.isArray(row) && row.length === cols && row.every(c => typeof c === 'string' || typeof c === 'number'));
t('map scalar', ctx.map_('x', s => s + '!'), v => v === 'x!');
t('map range', ctx.map_([['a', ''], [2, 'b']], (s, r, c, n) => s + r + c + (n ? 'N' : '')), v => isRange(v, 2, 2) && v[0][0] === 'a00' && v[1][1] === 'b11');
t('map width5 scalar', ctx.map_('x', s => [s, 'T'], 5), v => isRange(v, 1, 5) && v[0][0] === 'x' && v[0][1] === 'T' && v[0][4] === '');
t('map width5 range mixed', ctx.map_([['a'], ['']], (s) => s ? [s, 'T', 'J', '2020', 0.9] : '', 5), v => isRange(v, 2, 5) && v[0][4] === 0.9 && v[1].every(c => c === ''));
t('cellAt scalar', ctx.cellAt_('Nature', 3, 0), v => v === 'Nature');
t('cellAt range', [ctx.cellAt_([['Nature'], ['Science']], 1, 0), ctx.cellAt_([['Nature'], ['Science']], 7, 0)], v => v[0] === 'Science' && v[1] === 'Science'); // past the end: the last row carries on
t('idToDoi number', ctx.idToDoi_('2019', true), v => v === null || v === '');
t('idToDoi bare digits', ctx.idToDoi_('23903748', false), v => v === null || v === ''); // a PMID needs the network, which is off
t('idToDoi doi', ctx.idToDoi_('https://doi.org/10.1038/nature12373', false), v => v === '10.1038/nature12373');
t('doiOrgUrl', ctx.doiOrgUrl_('10.1002/(SICI)1097-4571(199501)46:1<21::AID-ASI3>3.0.CO;2-Z'), v => typeof v === 'string' && /^https:\/\/doi\.org\/10\.1002\//.test(v) && !/[<>;]/.test(v) && /%3C21%3A%3AAID-ASI3%3E/.test(v));
t('DOI_CITE empty/none', ctx.DOI_CITE([[''], ['hello']], 'apa'), v => isRange(v, 2, 1) && v[0][0] === '' && /No DOI/i.test(v[1][0]));
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
