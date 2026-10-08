#!/usr/bin/env node
/* AutoDOI on the command line.  Node 18 or newer (it uses the built-in fetch).
 *
 *   autodoi 10.1038/nature12373                      the reference in APA
 *   autodoi 10.1038/nature12373 --style vancouver    any built-in style: apa, mla, chicago, harvard, vancouver, ieee, carnegie,
 *                                                    or an export: bibtex, ris, endnote; --style all prints every style of one record
 *   autodoi arXiv:1706.03762 PMID:23903748 978-0-19-853453-2   arXiv IDs, PubMed IDs and ISBNs work too
 *   autodoi --match < references.txt                 one reference per line, or one per paragraph when blank lines separate them
 *                                                    (a wrapped reference is one paragraph): each is matched at Crossref and graded
 *   autodoi --match --style ris < references.txt     the good matches as an RIS file (or bibtex, endnote, any style), printed as they arrive;
 *                                                    the rest are reported on stderr
 *   autodoi --match --json < references.txt          the records as JSON, with grade and DOI
 *   --email you@example.org                          Crossref's polite pool (faster); also read from AUTODOI_EMAIL
 *   --pages 45-47                                    the in-text citation with a page locator, printed after the reference (not with --match)
 *
 * Exit code: 0 done, 1 a lookup failed, 2 bad usage, 3 --match left a reference unmatched (its text is on stderr).
 * Only the identifiers or reference text given are sent, to api.crossref.org, doi.org, ebi.ac.uk (Europe PMC) and openlibrary.org. */
var path = require('path');
var A = require(path.join(__dirname, '..', 'citations.js'));
var UA = 'AutoDOI-cli/' + require(path.join(__dirname, '..', 'package.json')).version + ' (https://github.com/toldxls/AutoDOI)';
var TIMEOUT_MS = 30000; // a request that has not answered by then is abandoned and retried, so a hung connection cannot hang the run

function polite(url, email) { return email ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'mailto=' + encodeURIComponent(email) : url; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function pause(ms) { return module.exports.sleep(ms); } // through the export so a test can swap the clock out and run without the throttle
function timedOut(e) { return !!e && (e.name === 'TimeoutError' || e.name === 'AbortError'); } // what fetch throws for AbortSignal.timeout, by Node version
var lastCrossref = 0;
async function request(url, headers) { // one reply; a timeout, a 429 and a 5xx are retried three times with a growing pause
  var crossref = /api\.crossref\.org/.test(url), res;
  for (var attempt = 0; ; attempt++) {
    if (crossref) { var wait = lastCrossref + (/mailto=/.test(url) ? 350 : 1100) - Date.now(); if (wait > 0) await pause(wait); lastCrossref = Date.now(); } // Crossref's public pool takes about one request a second; the polite pool a few
    try { res = await fetch(url, { headers: Object.assign({ 'User-Agent': UA }, headers || {}), signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch (e) {
      if (!timedOut(e)) throw e;
      if (attempt < 3) { await pause(2000 * (attempt + 1)); continue; }
      throw new Error('No reply within ' + TIMEOUT_MS / 1000 + ' s from ' + url.split('?')[0]);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await pause(2000 * (attempt + 1)); continue; }
    return res;
  }
}
async function getJson(url, headers) {
  var res = await request(url, headers);
  if (res.ok) return res.json();
  var e = new Error('HTTP ' + res.status + ' from ' + url.split('?')[0]); e.status = res.status; throw e;
}
async function fetchRecord(doi, email) {
  try { return A.normalize((await getJson(polite('https://api.crossref.org/works/' + encodeURIComponent(doi), email))).message); }
  catch (e) { if (e.status !== 404) throw e; }
  var res = await request('https://doi.org/' + doi.split('/').map(encodeURIComponent).join('/'), { Accept: 'application/vnd.citationstyles.csl+json' });
  if (res.ok && /json/.test(res.headers.get('content-type') || '')) return A.normalize(await res.json());
  if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status + ' from doi.org for ' + doi + '; try again later');
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
  // the work search, as the page asks it: its fields (author_name, publisher, publish_place, first_publish_year) are what A.fromOpenLibrary reads
  var j = await getJson('https://openlibrary.org/search.json?isbn=' + isbn + '&fields=key,title,subtitle,author_name,publisher,first_publish_year,publish_year,publish_place,number_of_pages_median,isbn');
  var doc = j.docs && j.docs[0]; if (!doc) throw new Error('ISBN not found at Open Library: ' + isbn);
  var r = A.normalize(A.fromOpenLibrary(doc, isbn)); r.url = ''; return r; // as the page: an Open Library link is not part of a book reference
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
  var value = function (i) { if (i + 1 >= argv.length) o.error = 'Option ' + argv[i] + ' needs a value'; return argv[i + 1]; };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--style' || a === '-s') o.style = value(i++);
    else if (a === '--email') o.email = value(i++);
    else if (a === '--pages' || a === '-p') o.pages = value(i++);
    else if (a === '--match' || a === '-m') o.match = true;
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (/^-/.test(a)) o.error = o.error || 'Unknown option ' + a; // a misspelt flag must not be looked up as a reference
    else o.ids.push(a);
  }
  return o;
}
function usage() { // the comment block at the top of this file, up to its closing line
  var lines = require('fs').readFileSync(__filename, 'utf8').split('\n'), out = [];
  for (var i = 1; i < lines.length; i++) {
    out.push(lines[i].replace(/^\/\* ?/, '').replace(/ ?\*\/\s*$/, '').replace(/^ \* ?/, ''));
    if (/\*\/\s*$/.test(lines[i])) break;
  }
  return out.join('\n');
}
function stdinIsTty() { return !!process.stdin.isTTY; }
function readStdin() { return new Promise(function (resolve) { var d = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', function (c) { d += c; }); process.stdin.on('end', function () { resolve(d); }); }); }
function splitRefs(text) { // blank lines between references, or one per line (simpler than the page's splitter, which also cuts run-together lines)
  var t = text.replace(/\r\n?/g, '\n').trim(); if (!t) return [];
  return (/\n\s*\n/.test(t) ? t.split(/\n\s*\n+/).map(function (p) { return p.replace(/\s*\n\s*/g, ' '); }) : t.split('\n')).map(function (s) { return s.trim(); }).filter(Boolean);
}
async function run(argv, io) {
  io = io || { out: function (s) { process.stdout.write(s + '\n'); }, write: function (s) { process.stdout.write(s); }, err: function (s) { process.stderr.write(s + '\n'); }, stdin: readStdin, tty: stdinIsTty };
  var o = parseArgs(argv);
  if (o.error) { io.err(o.error + '. See autodoi --help.'); return 2; }
  if (o.help) { io.out(usage()); return 0; }
  if (!o.ids.length && !o.match) { io.err(usage()); return 2; } // nothing to do: the usage is the error message, so it goes where errors go
  var known = A.STYLES.map(function (s) { return s.id; }).concat(A.EXPORTS.map(function (x) { return x.id; }), ['all']);
  if (known.indexOf(o.style) === -1) { io.err('Unknown style "' + o.style + '". Styles: ' + known.join(', ')); return 2; }
  if (o.match && o.style === 'all') { io.err('--style all prints every style of one record; with --match choose one style or export. See autodoi --help.'); return 2; }
  if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) { io.err('--email (or AUTODOI_EMAIL) needs an address like you@example.org, not "' + o.email + '"'); return 2; } // Crossref would silently drop you from the polite pool
  if (o.match && o.pages) io.err('Note: --pages is ignored with --match; it applies to the in-text citation of a single reference.');
  var failed = 0;
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
  if (!o.ids.length && io.tty && io.tty()) { io.err('Nothing to match: pipe references on stdin or give them as arguments.'); return 2; } // else it would wait forever
  var refs = splitRefs(o.ids.length ? o.ids.join('\n') : await io.stdin());
  if (!refs.length) { io.err('Nothing to match: give references on stdin, one per line.'); return 2; }
  // Each row is printed as its lookup finishes: the good matches in the style or export asked for, on stdout, the rest on stderr
  // so nothing vanishes silently.  --json waits for the whole list, since it prints one array.
  var results = [], good = 0;
  var emit = function (x) {
    if (x.grade !== 'good') io.err((x.grade === 'none' ? 'no match' : x.grade === 'error' ? 'error: ' + x.error : x.grade + ' (' + (x.record && x.record.doi || 'no DOI') + ')') + '\t' + x.text);
    if (x.record && warnings(x.record)) io.err(warnings(x.record) + '\t' + x.text);
    if (x.grade !== 'good') return;
    if (o.style === 'ris') io.write(A.format(x.record, 'ris')); // a record ends with its own line break; records follow one another directly
    else if (o.style === 'endnote') io.write((good ? '\n' : '') + A.format(x.record, 'endnote')); // a blank line between records
    else if (o.style === 'bibtex') io.write((good ? '\n\n' : '') + A.format(x.record, 'bibtex')); // the entry has no final line break: the next one adds the blank line
    else io.out(A.format(x.record, o.style, good + 1)); // numbered styles count the good matches
    good++;
  };
  for (var k = 0; k < refs.length; k++) {
    var x;
    try { var m = await matchReference(refs[k], o.email); x = { text: refs[k], record: m.record, conf: m.conf, grade: m.record ? (m.via === 'doi' ? 'good' : grade(m.conf)) : 'none' }; }
    catch (e) { failed++; x = { text: refs[k], record: null, conf: 0, grade: 'error', error: e.message }; }
    results.push(x);
    if (o.json) { if (x.grade === 'good') good++; } else emit(x);
  }
  if (o.json) io.out(JSON.stringify(results, null, 2));
  else if (o.style === 'bibtex' && good) io.write('\n');
  return failed ? 1 : good < results.length ? 3 : 0;
}
module.exports = { run: run, matchReference: matchReference, resolveId: resolveId, splitRefs: splitRefs, parseArgs: parseArgs, usage: usage, sleep: sleep };
if (require.main === module) run(process.argv.slice(2)).then(function (code) { process.exitCode = code; }, function (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; });
