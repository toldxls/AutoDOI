// The Google Sheets script with every Apps Script service stubbed: menu registration, the export menu
// (Drive file, alert text, misses and empty selections), and the custom functions against a canned
// Crossref reply.  Usage: node tests/sheets-menu.test.js
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.resolve(__dirname, '..');
var work = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'w.json'), 'utf8')); // 10.1038/nature12373
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + String(detail).slice(0, 300) : '')); } }

// --- stubbed Apps Script services, recording what the script does with them ---
var state = { menuItems: [], alerts: [], files: [], selection: [[]], fetched: [], sleeps: 0, cache: {}, cacheFull: false }; // cacheFull: CacheService refusing a put, as it does over 100 KB
function response(code, body, type) { return { getResponseCode: function () { return code; }, getContentText: function () { return body; }, getHeaders: function () { return { 'Content-Type': type || 'application/json' }; } }; }
function fakeFetch(url) {
  state.fetched.push(url);
  if (/api\.crossref\.org\/works\/10\.1038%2Fnature12373/.test(url)) return response(200, JSON.stringify(work));
  if (/api\.crossref\.org\/works\/10\./.test(url)) return response(404, '{"status":"error"}');
  if (/api\.crossref\.org\/works\?/.test(url)) return response(200, JSON.stringify({ status: 'ok', message: { items: [work.message] } }));
  if (/doi\.org\//.test(url)) return response(404, 'DOI not found', 'text/html');
  return response(404, '{}');
}
var ctx = {
  console: console, Date: Date, JSON: JSON, Math: Math, String: String, Array: Array, Object: Object, RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
  CacheService: { getScriptCache: function () { return { get: function (k) { return state.cache[k] || null; }, put: function (k, v) { if (state.cacheFull) throw new Error('Argument too large: value'); state.cache[k] = v; } }; } }, // one cache across calls, as Apps Script's is
  Utilities: { sleep: function () { state.sleeps++; }, formatDate: function () { return '2026-09-23 1200'; }, base64Encode: function (s) { return Buffer.from(String(s)).toString('base64'); }, computeDigest: function (a, s) { return s; }, DigestAlgorithm: {}, Charset: {} },
  Session: { getScriptTimeZone: function () { return 'UTC'; } },
  UrlFetchApp: { fetch: fakeFetch, fetchAll: function (reqs) { return reqs.map(function (r) { return fakeFetch(r.url); }); } },
  DriveApp: { createFile: function (name, content, mime) { var f = { name: name, content: content, mime: mime, getUrl: function () { return 'https://drive.google.com/file/d/FAKE/view'; } }; state.files.push(f); return f; } },
  SpreadsheetApp: {
    getUi: function () {
      return {
        createMenu: function (title) { var menu = { title: title, items: [] }; return { addItem: function (label, fn) { menu.items.push([label, fn]); return this; }, addToUi: function () { state.menuItems = menu; } }; },
        alert: function (msg) { state.alerts.push(String(msg)); }
      };
    },
    getActiveRange: function () { return { getValues: function () { return state.selection; } }; }
  }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/Citations.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8'), ctx);

// Menu
ctx.onOpen();
check('onOpen adds an AutoDOI menu', state.menuItems.title === 'AutoDOI');
check('menu has the two export items', state.menuItems.items.length === 2 && /\.enw/.test(state.menuItems.items[0][0]) && /\.ris/.test(state.menuItems.items[1][0]), JSON.stringify(state.menuItems.items));
check('menu items point at existing functions', state.menuItems.items.every(function (it) { return typeof ctx[it[1]] === 'function'; }));

// Export selection: a DOI cell, a blank, a pasted reference that matches, and one that does not
state.selection = [['https://doi.org/10.1038/nature12373', ''], ['Kucsko G, Maurer PC, Yao NY, et al. Nanometre-scale thermometry in a living cell. Nature. 2013;500(7460):54-58.', 'Smith J. Some paper nobody wrote. Journal of Nothing. 1999;1:1-2.']];
ctx.exportSelectionEnw();
check('EndNote export writes one Drive file', state.files.length === 1 && /^AutoDOI export .*\.enw$/.test(state.files[0].name), state.files.map(function (f) { return f.name; }).join());
var enw = state.files[0] ? state.files[0].content : '';
check('EndNote file holds a journal article record for each match', (enw.match(/^%0 Journal Article/gm) || []).length === 2, enw.slice(0, 200));
check('EndNote file carries the title and DOI', /%T Nanometre-scale thermometry in a living cell/.test(enw) && /%R 10\.1038\/nature12373/.test(enw), enw.slice(0, 400));
check('alert reports the count, the file link and the miss', state.alerts.length === 1 && /2 record\(s\) written/.test(state.alerts[0]) && /drive\.google\.com/.test(state.alerts[0]) && /Not matched:\n.*Some paper nobody wrote/.test(state.alerts[0]), state.alerts[0]);
check('Crossref was paced between cells', state.sleeps === 3, state.sleeps);
check('the DOI cell was fetched by DOI, not searched', state.fetched.some(function (u) { return /works\/10\.1038%2Fnature12373/.test(u); }));

state.files = []; state.alerts = [];
ctx.exportSelectionRis();
var ris = state.files[0] ? state.files[0].content : '';
check('RIS export writes a .ris file', state.files.length === 1 && /\.ris$/.test(state.files[0].name) && state.files[0].mime === 'text/plain');
check('RIS file is well formed', /^TY  - JOUR\r?\n/.test(ris) && (ris.match(/^ER  - /gm) || []).length === 2 && /^DO  - 10\.1038\/nature12373/m.test(ris), ris.slice(0, 300));
check('RIS records are concatenated without blank lines between them', !/\n\n/.test(ris.replace(/\r/g, '')));

state.files = []; state.alerts = []; state.selection = [['', null], ['Smith J. Some paper nobody wrote. Journal of Nothing. 1999;1:1-2.']];
ctx.exportSelectionRis();
check('nothing matched: no file, one explanatory alert', state.files.length === 0 && state.alerts.length === 1 && /Nothing matched/.test(state.alerts[0]), state.alerts[0]);

// Custom functions against the same canned replies
var apa = ctx.DOI_CITE('10.1038/nature12373', 'apa');
check('DOI_CITE returns an APA reference', /^Kucsko, G\./.test(apa) && /\(2013\)/.test(apa) && /Nature/.test(apa), apa);
var col = ctx.DOI_CITE([['10.1038/nature12373'], [''], ['10.9999/nope']], 'vancouver');
check('DOI_CITE over a range keeps the shape and flags misses', Array.isArray(col) && col.length === 3 && /Kucsko G/.test(col[0][0]) && col[1][0] === '' && /not found|Not found|No /i.test(col[2][0]), JSON.stringify(col));
var found = ctx.FIND_DOI('Nanometre-scale thermometry in a living cell', 'Nature');
check('FIND_DOI returns the DOI', found === '10.1038/nature12373', found);
var details = ctx.FIND_DOI('Nanometre-scale thermometry in a living cell', 'Nature', true);
check('FIND_DOI details row: DOI, title, journal, year, confidence', Array.isArray(details) && details[0][0] === '10.1038/nature12373' && details[0][3] == 2013 && details[0][4] >= 0.6, JSON.stringify(details)); // title + journal alone score 0.7: no year or author to confirm
var risCell = ctx.REF_TO_RIS('Kucsko G, et al. Nanometre-scale thermometry in a living cell. Nature. 2013;500:54-58.');
check('REF_TO_RIS from a pasted reference', /^TY  - JOUR/.test(risCell) && /DO  - 10\.1038\/nature12373/.test(risCell), risCell.slice(0, 200));
check('REF_TO_DOI from a pasted reference', ctx.REF_TO_DOI('Kucsko G, et al. Nanometre-scale thermometry in a living cell. Nature. 2013;500:54-58.') === '10.1038/nature12373');

// FIND_DOI: Crossref always answers with its nearest record; one that scores below the floor resolve_ uses is not the paper asked for
var poor = ctx.FIND_DOI('Something else entirely', 'Journal of Nothing');
check('FIND_DOI below the confidence floor: No match', poor === 'No match', poor);
var poorDetails = ctx.FIND_DOI('Something else entirely', 'Journal of Nothing', true);
check('FIND_DOI details below the floor: a padded No match row', JSON.stringify(poorDetails) === JSON.stringify([['No match', '', '', '', '']]), JSON.stringify(poorDetails));
check('the floor is the one resolve_ uses', ctx.MIN_CONFIDENCE === 0.35 && ctx.REF_TO_DOI('Something else entirely. Journal of Nothing. 1999;1:1-2.') === 'No match');
var wide = ctx.FIND_DOI([['Nanometre-scale thermometry in a living cell', 'Nanometre-scale thermometry in a living cell']], 'Nature', true);
check('FIND_DOI details over a multi-column range: one cell saying to give a single column, not misaligned rows', JSON.stringify(wide) === JSON.stringify([['Give a single column of titles for the details form']]), JSON.stringify(wide));
var wideDois = ctx.FIND_DOI([['Nanometre-scale thermometry in a living cell', 'Nanometre-scale thermometry in a living cell']], 'Nature');
check('FIND_DOI over a multi-column range without details keeps the shape', Array.isArray(wideDois) && wideDois.length === 1 && wideDois[0].length === 2 && wideDois[0][1] === '10.1038/nature12373', JSON.stringify(wideDois));

// A DOI Crossref does not have (DataCite, mEDRA): the prefetch's 404 is remembered, so the cell's own fetch goes straight to doi.org
state.fetched = []; ctx.runCache_ = {};
var dc = ctx.DOI_CITE('10.5555/datacite');
var crossrefAsks = state.fetched.filter(function (u) { return /api\.crossref\.org\/works\/10\.5555%2Fdatacite/.test(u); }).length;
check('a non-Crossref DOI is asked of Crossref once, then doi.org', crossrefAsks === 1 && state.fetched.filter(function (u) { return /^https:\/\/doi\.org\/10\.5555\/datacite/.test(u); }).length === 1 && dc === 'DOI not found (404)', crossrefAsks + ' ' + JSON.stringify(state.fetched) + ' ' + dc);
state.fetched = []; ctx.runCache_ = {};
ctx.DOI_CITE('10.5555/datacite');
check('within the miss TTL the next recalculation skips Crossref for it', !state.fetched.some(function (u) { return /api\.crossref\.org\/works\/10\.5555/.test(u); }), JSON.stringify(state.fetched));

// A record too large for CacheService: the invocation's own map keeps it, so the cell's fetch reuses the prefetch
state.cache = {}; state.cacheFull = true; state.fetched = []; ctx.runCache_ = {};
var big = ctx.DOI_CITE('10.1038/nature12373', 'apa');
check('a record CacheService refuses is still fetched once per invocation', /^Kucsko, G\./.test(big) && state.fetched.filter(function (u) { return /works\/10\.1038%2Fnature12373/.test(u); }).length === 1, JSON.stringify(state.fetched));
state.cacheFull = false;

console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
