/**
 * AutoDOI for Google Sheets.
 *
 * Install: Extensions > Apps Script. Replace Code.gs with this file, add a file "Citations" containing
 * citations.js, and (Project Settings > Show appsscript.json) paste apps-script/appsscript.json.
 * Save and reload the sheet. Custom functions work at once; the AutoDOI menu asks for Drive
 * permission the first time you use it.
 *
 * Custom functions (all accept a single cell or a range):
 *   =DOI_CITE(A2, "apa")        APA 7 reference. Styles: apa, mla, chicago, harvard, vancouver, ieee, carnegie
 *                               (Annals of Carnegie Museum), bibtex, ris, endnote.
 *                               Also accepts arXiv IDs and "PMID: 123" / "PMC123" identifiers.
 *   =DOI_CITE(A2:A50, "vancouver")
 *   =FIND_DOI(B2, C2)           Best-matching DOI for a title (+ optional journal, cell or range)
 *   =FIND_DOI(B2, C2, TRUE)     ...as a row: DOI, matched title, journal, year, confidence 0-1
 *   =REF_TO_DOI(D2)             DOI for a pasted reference in any style (uses the DOI if one is present)
 *   =REF_TO_ENW(D2)             EndNote tagged record for a pasted reference
 *   =REF_TO_RIS(D2)             RIS record for a pasted reference
 *
 * Custom functions must finish within 30 seconds. Uncached DOIs are fetched in parallel, and when a
 * large range still runs out of time the remaining cells read "Retry" — recalculate (or edit a cell)
 * and they fill from the cache built so far.
 *
 * Menu: AutoDOI > Export selection as .enw / .ris — writes one file to Drive for the selected cells.
 */

var POLITE_EMAIL = ''; // optional: your email for Crossref's polite pool, e.g. 'you@example.org'
var TIME_BUDGET_MS = 24000; // stay under the 30 s custom-function limit
var CACHE_SECONDS = 21600;  // 6 h, the CacheService maximum

var SELECT_ = 'DOI,URL,title,subtitle,author,editor,container-title,short-container-title,issued,published-print,' +
  'published-online,volume,issue,page,article-number,type,publisher,publisher-location,ISSN,ISBN,score,event';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('AutoDOI')
    .addItem('Export selection as EndNote (.enw)', 'exportSelectionEnw')
    .addItem('Export selection as RIS (.ris)', 'exportSelectionRis')
    .addToUi();
}

/* ------------------------------------------------------------------ */
/* Custom functions                                                    */
/* ------------------------------------------------------------------ */

/**
 * Formats a DOI (or arXiv / PubMed identifier) as a reference.
 * @param {string|Array} doi A DOI, doi.org link, or range of them.
 * @param {string} style apa | mla | chicago | harvard | vancouver | ieee | carnegie | bibtex | ris | endnote (default apa)
 * @return {string|Array} The formatted reference(s).
 * @customfunction
 */
function DOI_CITE(doi, style) {
  style = (style || 'apa').toString().toLowerCase();
  var deadline = Date.now() + TIME_BUDGET_MS;
  // Resolve identifiers first, then fetch every uncached DOI in one parallel batch.
  var cells = flatten_(doi);
  var dois = [];
  cells.forEach(function (c) { var d = null; try { d = c.text ? idToDoi_(c.text, c.isNumber) : null; } catch (e) { /* reported per cell below */ } c.doi = d; if (d) dois.push(d); });
  prefetchRecords_(dois, deadline);
  return map_(doi, function (t, r, c, isNumber) {
    if (!t) return '';
    var d = idToDoi_(t, isNumber);
    if (!d) return 'No DOI found';
    if (Date.now() > deadline && cacheGet_('doi:' + d.toLowerCase()) === undefined) return 'Retry';
    var rec = fetchRecord_(d);
    if (rec.notFound) return 'DOI not found (' + rec.status + ')';
    return AutoDOI.format(rec, style);
  });
}

/**
 * Finds the DOI for a paper title (and optional journal).
 * @param {string|Array} title The paper title, or a range of titles.
 * @param {string|Array} journal Optional journal name, a cell or a range aligned with the titles.
 * @param {boolean} details TRUE to return DOI, matched title, journal, year, confidence as a row.
 * @return {string|Array} The DOI.
 * @customfunction
 */
function FIND_DOI(title, journal, details) {
  var deadline = Date.now() + TIME_BUDGET_MS;
  return map_(title, function (t, r, c) {
    if (!t) return '';
    if (Date.now() > deadline) return 'Retry';
    var j = cellAt_(journal, r, c);
    var hits = search_({ 'query.bibliographic': t, 'query.container-title': j }, 5);
    if (!hits.length) return 'No match';
    var best = hits[0], conf = -1;
    hits.forEach(function (h) { var s = AutoDOI.matchConfidence(t + ' ' + j, h); if (s > conf) { conf = s; best = h; } });
    return details ? [best.doi, best.title, best.container || best.publisher, best.year, Math.round(conf * 100) / 100] : best.doi;
  }, details ? 5 : 0);
}

/**
 * Finds the DOI for a pasted reference in any style.
 * @param {string|Array} reference The reference text.
 * @return {string|Array} The DOI.
 * @customfunction
 */
function REF_TO_DOI(reference) { return refFunction_(reference, function (rec) { return rec.doi; }); }

/**
 * Converts a pasted reference to an EndNote tagged record.
 * @param {string|Array} reference The reference text.
 * @return {string|Array} EndNote tagged (.enw) text.
 * @customfunction
 */
function REF_TO_ENW(reference) { return refFunction_(reference, function (rec) { return AutoDOI.format(rec, 'endnote'); }); }

/**
 * Converts a pasted reference to an RIS record.
 * @param {string|Array} reference The reference text.
 * @return {string|Array} RIS text.
 * @customfunction
 */
function REF_TO_RIS(reference) { return refFunction_(reference, function (rec) { return AutoDOI.format(rec, 'ris'); }); }

function refFunction_(reference, out) {
  var deadline = Date.now() + TIME_BUDGET_MS;
  return map_(reference, function (t, r, c, isNumber) {
    if (!t) return '';
    if (Date.now() > deadline) return 'Retry';
    var rec = resolve_(t, isNumber);
    return rec ? out(rec) : 'No match';
  });
}

/* ------------------------------------------------------------------ */
/* Menu actions                                                        */
/* ------------------------------------------------------------------ */

function exportSelectionEnw() { exportSelection_('endnote', 'enw'); }
function exportSelectionRis() { exportSelection_('ris', 'ris'); }

function exportSelection_(style, ext) {
  var ui = SpreadsheetApp.getUi();
  var values = SpreadsheetApp.getActiveRange().getValues();
  var out = [], missed = [], skipped = 0;
  var deadline = Date.now() + 5 * 60 * 1000; // stay under the 6-minute limit and still write the file
  values.forEach(function (row) {
    row.forEach(function (v) {
      var t = String(v === null || v === undefined ? '' : v).trim();
      if (!t) return;
      if (Date.now() > deadline) { skipped++; return; }
      Utilities.sleep(POLITE_EMAIL ? 150 : 600); // pace Crossref
      try {
        var rec = resolve_(t, typeof v === 'number');
        if (rec) out.push(AutoDOI.format(rec, style)); else missed.push(t);
      } catch (e) { missed.push(t + ' (' + e.message + ')'); }
    });
  });
  if (!out.length) { ui.alert('Nothing matched in the selected cells.'); return; }
  var name = 'AutoDOI export ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm') + '.' + ext;
  var file = DriveApp.createFile(name, out.join(style === 'ris' ? '' : '\n'), 'text/plain');
  var msg = out.length + ' record(s) written to ' + name + '\n' + file.getUrl();
  if (missed.length) msg += '\n\nNot matched:\n' + missed.join('\n');
  if (skipped) msg += '\n\n' + skipped + ' cell(s) were not processed before the time limit; select them and export again.';
  ui.alert(msg);
}

/* ------------------------------------------------------------------ */
/* Crossref / doi.org / Europe PMC                                     */
/* ------------------------------------------------------------------ */

function polite_(url) {
  return POLITE_EMAIL ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'mailto=' + encodeURIComponent(POLITE_EMAIL) : url;
}

// Cache keys must be <= 250 characters: hash everything.
function cacheKey_(s) {
  return 'ad2:' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8));
}
// Values are wrapped so that a cached null ("no DOI for this PMID") counts as a hit; undefined means not cached.
function cacheGet_(s) {
  try { var hit = CacheService.getScriptCache().get(cacheKey_(s)); if (!hit) return undefined; var w = JSON.parse(hit); return (w && typeof w === 'object' && 'v' in w) ? w.v : undefined; } catch (e) { return undefined; }
}
function cachePut_(s, val) {
  try { CacheService.getScriptCache().put(cacheKey_(s), JSON.stringify({ v: val }), CACHE_SECONDS); } catch (e) { /* too large; fine */ }
}
function cached_(s, producer) {
  var hit = cacheGet_(s);
  if (hit !== undefined) return hit;
  var val = producer();
  cachePut_(s, val);
  return val;
}

function isJson_(res) {
  var ct = (res.getHeaders()['Content-Type'] || res.getHeaders()['content-type'] || '').toLowerCase();
  return ct.indexOf('json') !== -1;
}
function crossrefUrl_(doi) { return polite_('https://api.crossref.org/works/' + encodeURIComponent(doi)); }
function doiOrgUrl_(doi) { return 'https://doi.org/' + doi.split('/').map(encodeURIComponent).join('/'); }

// Turn a Crossref response into a cached record, or a cached "not found" marker.
function recordFromCrossref_(doi, res) {
  var code = res.getResponseCode();
  if (code === 200 && isJson_(res)) return AutoDOI.normalize(JSON.parse(res.getContentText()).message);
  if (code === 404) return null; // caller tries doi.org
  throw new Error(code === 200 ? 'Crossref returned an unexpected reply (not JSON)' : 'Crossref returned ' + code);
}

// Fetch many DOIs in parallel (UrlFetchApp.fetchAll), filling the cache; misses fall back one by one later.
function prefetchRecords_(dois, deadline) {
  var todo = []; var seen = {};
  dois.forEach(function (d) { var k = d.toLowerCase(); if (!seen[k] && cacheGet_('doi:' + k) === undefined) { seen[k] = true; todo.push(d); } });
  // Crossref's public pool allows only a few concurrent requests: fetch in small parallel groups, pausing between them
  for (var i = 0; i < todo.length && Date.now() < deadline; i += 4) {
    if (i) Utilities.sleep(POLITE_EMAIL ? 250 : 1000);
    var chunk = todo.slice(i, i + 4);
    var responses;
    try { responses = UrlFetchApp.fetchAll(chunk.map(function (d) { return { url: crossrefUrl_(d), muteHttpExceptions: true }; })); }
    catch (e) { continue; } // transient failure of this group: the next group still runs; misses are fetched one by one later
    responses.forEach(function (res, j) {
      try { var rec = recordFromCrossref_(chunk[j], res); if (rec) cachePut_('doi:' + chunk[j].toLowerCase(), rec); }
      catch (e) { /* leave uncached; fetchRecord_ reports it */ }
    });
  }
}

function fetchRecord_(doi) {
  return cached_('doi:' + doi.toLowerCase(), function () {
    var res = UrlFetchApp.fetch(crossrefUrl_(doi), { muteHttpExceptions: true });
    var rec = recordFromCrossref_(doi, res);
    if (rec) return rec;
    // Not a Crossref DOI (DataCite, mEDRA, ...): ask doi.org for CSL JSON
    var alt = UrlFetchApp.fetch(doiOrgUrl_(doi), {
      headers: { Accept: 'application/vnd.citationstyles.csl+json' }, followRedirects: true, muteHttpExceptions: true
    });
    if (alt.getResponseCode() === 200 && isJson_(alt)) return AutoDOI.normalize(JSON.parse(alt.getContentText()));
    var code = alt.getResponseCode();
    if (code !== 200 && code !== 404) throw new Error('doi.org returned ' + code + '; try again later'); // transient: never cached
    return { notFound: true, status: code === 200 ? 'no metadata' : code };
  });
}

function search_(params, rows) {
  var url = 'https://api.crossref.org/works?rows=' + rows + '&select=' + SELECT_;
  Object.keys(params).forEach(function (k) { if (params[k]) url += '&' + k + '=' + encodeURIComponent(params[k]); });
  return cached_('q:' + url, function () {
    var res = UrlFetchApp.fetch(polite_(url), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200 || !isJson_(res)) throw new Error('Crossref returned ' + res.getResponseCode());
    return JSON.parse(res.getContentText()).message.items.map(AutoDOI.normalize);
  });
}

// DOI, arXiv ID, or "PMID: n" / "PMCn" (resolved through Europe PMC) -> DOI or null.
// A bare number is never treated as a PubMed ID here: in a sheet it is far more likely to be a year.
function idToDoi_(text, isNumber) {
  var doi = AutoDOI.toDoi(text);
  if (doi) return doi;
  if (isNumber || /^\d+$/.test(String(text).trim())) return null;
  var pm = AutoDOI.extractPmid(text);
  if (!pm) return null;
  var q = pm.type === 'pmcid' ? 'PMCID:' + pm.id : 'EXT_ID:' + pm.id + ' AND SRC:MED';
  return cached_('pm:' + pm.type + ':' + pm.id, function () {
    var res = UrlFetchApp.fetch('https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=lite&query=' +
      encodeURIComponent(q), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200 || !isJson_(res)) throw new Error('Europe PMC returned ' + res.getResponseCode());
    var hits = JSON.parse(res.getContentText()).resultList.result;
    return (hits.length && hits[0].doi) ? hits[0].doi : null;
  });
}

// A reference in any style -> best record (or null). Uses the DOI directly when the text contains one.
function resolve_(text, isNumber) {
  var doi = idToDoi_(text, isNumber);
  if (doi) { var rec = fetchRecord_(doi); if (!rec.notFound) return rec; }
  var hits = search_({ 'query.bibliographic': text }, 3);
  if (!hits.length) return null;
  var best = hits[0], bestConf = AutoDOI.matchConfidence(text, hits[0]);
  for (var i = 1; i < hits.length; i++) {
    var c = AutoDOI.matchConfidence(text, hits[i]);
    if (c > bestConf + 0.2) { best = hits[i]; bestConf = c; }
  }
  return bestConf >= 0.35 ? best : null;
}

/* ------------------------------------------------------------------ */
/* Range helpers                                                       */
/* ------------------------------------------------------------------ */

function cellText_(v) { return String(v === null || v === undefined ? '' : v).trim(); }

// The value of `input` aligned with row r, column c of the main range (a scalar applies to every row).
function cellAt_(input, r, c) {
  if (!Array.isArray(input)) return cellText_(input);
  var row = input[Math.min(r, input.length - 1)] || [];
  return cellText_(row.length > c ? row[c] : row[0]);
}

function flatten_(input) {
  var out = [];
  var push = function (v) { out.push({ text: cellText_(v), isNumber: typeof v === 'number' }); };
  if (!Array.isArray(input)) push(input); else input.forEach(function (row) { row.forEach(push); });
  return out;
}

// Apply fn(text, row, col, isNumber) to a scalar or a 2-D range; errors become cell text instead of #ERROR!.
// When `width` > 0 each result is a row of that many columns (padded), so the output is never ragged.
function map_(input, fn, width) {
  var one = function (v, r, c) {
    var res;
    try { res = fn(cellText_(v), r, c, typeof v === 'number'); }
    catch (e) { res = 'Error: ' + e.message; }
    if (!width) return res;
    var row = Array.isArray(res) ? res.slice(0, width) : [res];
    while (row.length < width) row.push('');
    return row;
  };
  if (!Array.isArray(input)) { var single = one(input, 0, 0); return width ? [single] : single; }
  var rows = [];
  input.forEach(function (row, r) {
    row.forEach(function (v, c) {
      var res = one(v, r, c);
      if (width) rows.push(res); else { if (!rows[r]) rows[r] = []; rows[r][c] = res; }
    });
  });
  return rows;
}
