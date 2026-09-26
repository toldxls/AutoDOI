#!/usr/bin/env node
/* AutoDOI on the command line.  Node 18 or newer (it uses the built-in fetch).
 *
 *   autodoi 10.1038/nature12373                      the reference in APA
 *   autodoi 10.1038/nature12373 --style vancouver    any built-in style: apa, mla, chicago, harvard, vancouver, ieee, carnegie,
 *                                                    or an export: bibtex, ris, endnote; --style all prints every style
 *   autodoi arXiv:1706.03762 PMID:23903748 978-0-19-853453-1   arXiv IDs, PubMed IDs and ISBNs work too
 *   autodoi --match < references.txt                 one reference per line: each is matched at Crossref and graded
 *   autodoi --match --style ris < references.txt     the good matches as an RIS file (or bibtex, endnote, any style)
 *   autodoi --match --json < references.txt          the records as JSON, with grade and DOI
 *   --email you@example.org                          Crossref's polite pool (faster); also read from AUTODOI_EMAIL
 *   --pages 45-47                                    the in-text citation with a page locator, printed after the reference
 *
 * Only the identifiers or reference text given are sent, to api.crossref.org, doi.org and openlibrary.org. */
var path = require('path');
var A = require(path.join(__dirname, '..', 'citations.js'));
var UA = 'AutoDOI-cli/' + require(path.join(__dirname, '..', 'package.json')).version + ' (https://github.com/toldxls/AutoDOI)';

function polite(url, email) { return email ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'mailto=' + encodeURIComponent(email) : url; }
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var lastCrossref = 0;
async function getJson(url, headers) { // Crossref's public pool takes about one request a second; the polite pool a few. 429 and 5xx are retried
  var crossref = /api\.crossref\.org/.test(url), res;
  for (var attempt = 0; ; attempt++) {
    if (crossref) { var wait = lastCrossref + (/mailto=/.test(url) ? 350 : 1100) - Date.now(); if (wait > 0) await sleep(wait); lastCrossref = Date.now(); }
    res = await fetch(url, { headers: Object.assign({ 'User-Agent': UA }, headers || {}) });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(2000 * (attempt + 1)); continue; }
    var e = new Error('HTTP ' + res.status + ' from ' + url.split('?')[0]); e.status = res.status; throw e;
  }
}
async function fetchRecord(doi, email) {
  try { return A.normalize((await getJson(polite('https://api.crossref.org/works/' + encodeURIComponent(doi), email))).message); }
  catch (e) { if (e.status !== 404) throw e; }
  var res = await fetch('https://doi.org/' + doi.split('/').map(encodeURIComponent).join('/'), { headers: { Accept: 'application/vnd.citationstyles.csl+json', 'User-Agent': UA } });
  if (res.ok && /json/.test(res.headers.get('content-type') || '')) return A.normalize(await res.json());
  throw new Error('DOI not found at Crossref or doi.org: ' + doi);
}
async function pmidToDoi(pm) {
  var q = pm.type === 'pmcid' ? 'PMCID:' + pm.id : 'EXT_ID:' + pm.id + ' AND SRC:MED'; // as the page asks Europe PMC
  var j = await getJson('https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=lite&query=' + encodeURIComponent(q));
  var hit = j.resultList && j.resultList.result && j.resultList.result[0];
  if (!hit || !hit.doi) throw new Error('No DOI known for ' + pm.id);
  return hit.doi;
}
async function fetchIsbn(isbn, email) {
  var j = await getJson('https://openlibrary.org/api/books?bibkeys=ISBN:' + isbn + '&format=json&jscmd=data');
  var doc = j['ISBN:' + isbn]; if (!doc) throw new Error('ISBN not found at Open Library: ' + isbn);
  return A.normalize(A.fromOpenLibrary(doc, isbn));
}
async function resolveId(text, email) { // a DOI, arXiv ID, PMID, PMC ID or ISBN, or text holding one
  var doi = A.toDoi(text); if (doi) return fetchRecord(doi, email);
  var pm = A.extractPmid(text); if (pm) return fetchRecord(await pmidToDoi(pm), email);
  var isbn = A.extractIsbn(text); if (isbn) return fetchIsbn(isbn, email);
  throw new Error('No DOI, arXiv ID, PubMed ID or ISBN in: ' + text);
}
var SELECT = 'DOI,URL,title,subtitle,original-title,author,editor,container-title,short-container-title,issued,published-print,published-online,volume,issue,page,article-number,type,publisher,publisher-location,ISSN,ISBN,score,event,relation,updated-by,update-to';
async function matchReference(text, email) { // as the page does: a DOI in the text is trusted, otherwise Crossref's best of three, graded 0..1
  var doi = A.toDoi(text);
  if (doi) { try { return { record: await fetchRecord(doi, email), conf: 1, via: 'doi' }; } catch (e) { /* search instead */ } }
  var j = await getJson(polite('https://api.crossref.org/works?rows=3&select=' + SELECT + '&query.bibliographic=' + encodeURIComponent(text), email));
  var best = null, bestConf = 0;
  (j.message.items || []).map(A.normalize).forEach(function (h) { var c = A.matchConfidence(text, h); if (!best || c > bestConf + 0.2) { best = h; bestConf = c; } });
  return { record: best, conf: bestConf, via: 'search' };
}
function grade(conf) { return conf >= 0.8 ? 'good' : conf >= 0.5 ? 'check' : 'weak'; }
function warnings(r) { return (r.updates || []).filter(function (u) { return u.kind === 'retraction'; }).length ? 'RETRACTED' + ((r.updates.filter(function (u) { return u.doi; })[0] || {}).doi ? ' (see ' + r.updates.filter(function (u) { return u.doi; })[0].doi + ')' : '') : ''; }
function render(r, style, pages) {
  if (style === 'all') return A.STYLES.map(function (s) { return s.label + ':\n  ' + A.format(r, s.id) + (s.inText ? '\n  in text: ' + s.inText(r, { pages: pages }) : ''); }).join('\n') + '\n' + A.EXPORTS.map(function (x) { return x.label + ':\n' + A.format(r, x.id); }).join('\n');
  var out = A.format(r, style);
  if (pages && A.STYLES.some(function (s) { return s.id === style; })) out += '\n' + A.inText(r, style, { pages: pages });
  return out;
}
function parseArgs(argv) {
  var o = { ids: [], style: 'apa', match: false, json: false, email: process.env.AUTODOI_EMAIL || '', pages: '', help: false };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--style' || a === '-s') o.style = argv[++i];
    else if (a === '--email') o.email = argv[++i];
    else if (a === '--pages' || a === '-p') o.pages = argv[++i];
    else if (a === '--match' || a === '-m') o.match = true;
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else o.ids.push(a);
  }
  return o;
}
function readStdin() { return new Promise(function (resolve) { var d = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', function (c) { d += c; }); process.stdin.on('end', function () { resolve(d); }); }); }
function splitRefs(text) { // blank lines between references, or one per line
  var t = text.replace(/\r\n?/g, '\n').trim(); if (!t) return [];
  return (/\n\s*\n/.test(t) ? t.split(/\n\s*\n+/).map(function (p) { return p.replace(/\s*\n\s*/g, ' '); }) : t.split('\n')).map(function (s) { return s.trim(); }).filter(Boolean);
}
async function run(argv, io) {
  io = io || { out: function (s) { process.stdout.write(s + '\n'); }, err: function (s) { process.stderr.write(s + '\n'); }, stdin: readStdin };
  var o = parseArgs(argv);
  var known = A.STYLES.map(function (s) { return s.id; }).concat(A.EXPORTS.map(function (x) { return x.id; }), ['all']);
  if (o.help || (!o.ids.length && !o.match)) { io.out(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 14).map(function (l) { return l.replace(/^ \* ?/, ''); }).join('\n')); return o.help ? 0 : 2; }
  if (known.indexOf(o.style) === -1) { io.err('Unknown style "' + o.style + '". Styles: ' + known.join(', ')); return 2; }
  var failed = 0, exportsOnly = A.EXPORTS.some(function (x) { return x.id === o.style; });
  if (!o.match) {
    var recs = [];
    for (var i = 0; i < o.ids.length; i++) {
      try { var r = await resolveId(o.ids[i], o.email); recs.push(r); var w = warnings(r); if (w) io.err(o.ids[i] + ': ' + w); }
      catch (e) { failed++; io.err(o.ids[i] + ': ' + e.message); }
    }
    if (o.json) io.out(JSON.stringify(recs, null, 2));
    else recs.forEach(function (r) { io.out(render(r, o.style, o.pages)); });
    return failed ? 1 : 0;
  }
  var refs = splitRefs(o.ids.length ? o.ids.join('\n') : await io.stdin());
  if (!refs.length) { io.err('Nothing to match: give references on stdin, one per line.'); return 2; }
  var results = [];
  for (var k = 0; k < refs.length; k++) {
    try { var m = await matchReference(refs[k], o.email); results.push({ text: refs[k], record: m.record, conf: m.conf, grade: m.record ? (m.via === 'doi' ? 'good' : grade(m.conf)) : 'none' }); }
    catch (e) { failed++; results.push({ text: refs[k], record: null, conf: 0, grade: 'error', error: e.message }); }
  }
  if (o.json) { io.out(JSON.stringify(results, null, 2)); return failed ? 1 : 0; }
  if (exportsOnly || o.style !== 'apa' || o.ids.length === 0) {
    // an export or a style: the good matches, in order; the rest reported on stderr so nothing vanishes silently
    var good = results.filter(function (x) { return x.grade === 'good'; });
    results.forEach(function (x) { if (x.grade !== 'good') io.err((x.grade === 'none' ? 'no match' : x.grade === 'error' ? 'error: ' + x.error : x.grade + ' (' + (x.record && x.record.doi || 'no DOI') + ')') + '\t' + x.text); if (x.record && warnings(x.record)) io.err(warnings(x.record) + '\t' + x.text); });
    if (o.style === 'ris' || o.style === 'endnote') io.out(good.map(function (x) { return A.format(x.record, o.style); }).join(o.style === 'ris' ? '' : '\n'));
    else if (o.style === 'bibtex') io.out(good.map(function (x) { return A.format(x.record, 'bibtex'); }).join('\n\n'));
    else good.forEach(function (x, i) { io.out(A.format(x.record, o.style, i + 1)); });
  }
  return failed ? 1 : 0;
}
module.exports = { run: run, matchReference: matchReference, resolveId: resolveId, splitRefs: splitRefs, parseArgs: parseArgs };
if (require.main === module) run(process.argv.slice(2)).then(function (code) { process.exitCode = code; }, function (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; });
