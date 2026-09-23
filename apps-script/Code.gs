/**
 * AutoDOI for Google Sheets.
 *
 * Install: Extensions > Apps Script, paste this file as Code.gs and citations.js as Citations.gs,
 * save, reload the sheet. Custom functions appear immediately; the AutoDOI menu appears on reload.
 *
 * Custom functions (all accept a single cell or a range):
 *   =DOI_CITE(A2, "apa")        APA 7 reference. Styles: apa, mla, chicago, harvard, vancouver, ieee, bibtex, ris, endnote
 *   =DOI_CITE(A2:A50, "vancouver")
 *   =FIND_DOI(B2, C2)           Best-matching DOI for a title (+ optional journal)
 *   =FIND_DOI(B2, C2, TRUE)     ...as a row: DOI, matched title, journal, year, confidence 0-1
 *   =REF_TO_DOI(D2)             DOI for a pasted reference in any style (uses the DOI if one is present)
 *   =REF_TO_ENW(D2)             EndNote tagged record for a pasted reference
 *   =REF_TO_RIS(D2)             RIS record for a pasted reference
 *
 * Menu: AutoDOI > Export selection as .enw / .ris — writes one file to Drive for the selected cells
 * (DOIs or references), because multi-line cell text is awkward to copy out of Sheets.
 */

var POLITE_EMAIL = ''; // optional: your email for Crossref's polite pool, e.g. 'you@example.org'

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
 * Formats a DOI as a reference.
 * @param {string|Array} doi A DOI, doi.org link, or range of them.
 * @param {string} style apa | mla | chicago | harvard | vancouver | ieee | bibtex | ris | endnote (default apa)
 * @return {string|Array} The formatted reference(s).
 * @customfunction
 */
function DOI_CITE(doi, style) {
  style = (style || 'apa').toString().toLowerCase();
  return map_(doi, function (v) {
    var d = AutoDOI.extractDoi(v);
    if (!d) return v ? 'No DOI found' : '';
    return AutoDOI.format(fetchRecord_(d), style);
  });
}

/**
 * Finds the DOI for a paper title (and optional journal).
 * @param {string|Array} title The paper title.
 * @param {string} journal Optional journal name.
 * @param {boolean} details TRUE to return DOI, matched title, journal, year, confidence as a row.
 * @return {string|Array} The DOI.
 * @customfunction
 */
function FIND_DOI(title, journal, details) {
  journal = journal || '';
  return map_(title, function (t) {
    if (!t) return '';
    var hits = search_({ 'query.bibliographic': t, 'query.container-title': journal }, 5);
    if (!hits.length) return 'No match';
    var r = hits[0], conf = -1;
    hits.forEach(function (h) { var c = AutoDOI.matchConfidence(t + ' ' + journal, h); if (c > conf) { conf = c; r = h; } });
    return details ? [r.doi, r.title, r.container || r.publisher, r.year, Math.round(conf * 100) / 100] : r.doi;
  }, !!details);
}

/**
 * Finds the DOI for a pasted reference in any style.
 * @param {string|Array} reference The reference text.
 * @return {string|Array} The DOI.
 * @customfunction
 */
function REF_TO_DOI(reference) {
  return map_(reference, function (t) { var r = resolve_(t); return r ? r.doi : 'No match'; });
}

/**
 * Converts a pasted reference to an EndNote tagged record.
 * @param {string|Array} reference The reference text.
 * @return {string|Array} EndNote tagged (.enw) text.
 * @customfunction
 */
function REF_TO_ENW(reference) {
  return map_(reference, function (t) { var r = resolve_(t); return r ? AutoDOI.format(r, 'endnote') : 'No match'; });
}

/**
 * Converts a pasted reference to an RIS record.
 * @param {string|Array} reference The reference text.
 * @return {string|Array} RIS text.
 * @customfunction
 */
function REF_TO_RIS(reference) {
  return map_(reference, function (t) { var r = resolve_(t); return r ? AutoDOI.format(r, 'ris') : 'No match'; });
}

/* ------------------------------------------------------------------ */
/* Menu actions                                                        */
/* ------------------------------------------------------------------ */

function exportSelectionEnw() { exportSelection_('endnote', 'enw'); }
function exportSelectionRis() { exportSelection_('ris', 'ris'); }

function exportSelection_(style, ext) {
  var ui = SpreadsheetApp.getUi();
  var values = SpreadsheetApp.getActiveRange().getValues();
  var out = [], missed = [];
  values.forEach(function (row) {
    row.forEach(function (v) {
      var t = String(v || '').trim();
      if (!t) return;
      try {
        var r = resolve_(t);
        if (r) out.push(AutoDOI.format(r, style)); else missed.push(t);
      } catch (e) { missed.push(t + ' (' + e.message + ')'); }
    });
  });
  if (!out.length) { ui.alert('Nothing matched in the selected cells.'); return; }
  var name = 'AutoDOI export ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm') + '.' + ext;
  var file = DriveApp.createFile(name, out.join(style === 'ris' ? '' : '\n'), 'text/plain');
  var msg = out.length + ' record(s) written to ' + name + '\n' + file.getUrl();
  if (missed.length) msg += '\n\nNot matched:\n' + missed.join('\n');
  ui.alert(msg);
}

/* ------------------------------------------------------------------ */
/* Crossref / doi.org                                                  */
/* ------------------------------------------------------------------ */

function polite_(url) {
  return POLITE_EMAIL ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'mailto=' + encodeURIComponent(POLITE_EMAIL) : url;
}

function cached_(key, producer) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var val = producer();
  try { cache.put(key, JSON.stringify(val), 21600); } catch (e) { /* too large for cache; fine */ }
  return val;
}

function fetchRecord_(doi) {
  return cached_('doi:' + doi.toLowerCase(), function () {
    var res = UrlFetchApp.fetch(polite_('https://api.crossref.org/works/' + encodeURIComponent(doi)), { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) return AutoDOI.normalize(JSON.parse(res.getContentText()).message);
    if (res.getResponseCode() !== 404) throw new Error('Crossref returned ' + res.getResponseCode());
    var alt = UrlFetchApp.fetch('https://doi.org/' + doi, {
      headers: { Accept: 'application/vnd.citationstyles.csl+json' }, followRedirects: true, muteHttpExceptions: true
    });
    if (alt.getResponseCode() !== 200) throw new Error('DOI not found (' + alt.getResponseCode() + ')');
    return AutoDOI.normalize(JSON.parse(alt.getContentText()));
  });
}

function search_(params, rows) {
  var url = 'https://api.crossref.org/works?rows=' + rows + '&select=' + SELECT_;
  Object.keys(params).forEach(function (k) { if (params[k]) url += '&' + k + '=' + encodeURIComponent(params[k]); });
  return cached_('q:' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url)), function () {
    var res = UrlFetchApp.fetch(polite_(url), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Crossref returned ' + res.getResponseCode());
    return JSON.parse(res.getContentText()).message.items.map(AutoDOI.normalize);
  });
}

// A reference in any style -> best record (or null). Uses the DOI directly when the text contains one.
function resolve_(text) {
  var doi = AutoDOI.extractDoi(text);
  if (doi) { try { return fetchRecord_(doi); } catch (e) { /* fall through */ } }
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

// Apply fn to a scalar or a 2-D range; errors become cell text instead of #ERROR.
function map_(input, fn, rowResult) {
  var one = function (v) {
    try { return fn(String(v === null || v === undefined ? '' : v).trim()); }
    catch (e) { return 'Error: ' + e.message; }
  };
  if (!Array.isArray(input)) return one(input);
  return input.map(function (row) {
    var cells = row.map(one);
    return rowResult ? cells[0] : cells;
  });
}
