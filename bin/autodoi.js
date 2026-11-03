#!/usr/bin/env node
/* AutoDOI on the command line.  Node 18 or newer (it uses the built-in fetch).
 *
 *   autodoi 10.1038/nature12373                      the reference in APA
 *   autodoi 10.1038/nature12373 --style vancouver    any built-in style: apa, mla, chicago, harvard, vancouver, ieee, carnegie,
 *                                                    or an export: bibtex, ris, endnote; --style all prints every style of one record
 *   autodoi arXiv:1706.03762 PMID:23903748 978-0-19-853453-2   arXiv IDs, PubMed IDs and ISBNs work too
 *   autodoi --match < references.txt                 the list split as the page splits it (one per line, per paragraph, per number,
 *                                                    wrapped lines joined, run-together references cut apart); each is matched at
 *                                                    Crossref, with OpenAlex as a second opinion, and graded
 *   --split lines|blank|numbered                     split one per line, at blank lines, or at the list's numbers instead
 *   autodoi --match --style ris < references.txt     the good matches as an RIS file (or bibtex, endnote, any style), printed as they arrive;
 *                                                    the rest are reported on stderr
 *   autodoi --match --json < references.txt          the records as JSON, with grade and DOI
 *   autodoi --match paper.pdf                        the reference list of a Word (.docx) or PDF manuscript, read after its References heading
 *   --email you@example.org                          Crossref's polite pool (faster); also read from AUTODOI_EMAIL
 *   --pages 45-47                                    the in-text citation with a page locator, printed after the reference (not with --match)
 *
 * Exit code: 0 done, 1 a lookup failed, 2 bad usage, 3 --match left a reference unmatched (its text is on stderr).
 * Only the identifiers or reference text given are sent, to api.crossref.org, api.openalex.org, doi.org, ebi.ac.uk (Europe PMC)
 * and openlibrary.org. */
var path = require('path');
var A = require(path.join(__dirname, '..', 'citations.js'));
var DOCS = require(path.join(__dirname, '..', 'documents.js'));
var SPLIT = require(path.join(__dirname, '..', 'splitter.js')); // the page's splitter
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
var OL_SEARCH_FIELDS = 'key,title,subtitle,author_name,publisher,first_publish_year,publish_year,publish_place,number_of_pages_median,isbn'; // what A.fromOpenLibrary reads
async function fetchIsbn(isbn, email) { // as the page asks: Crossref for the book's DOI, Open Library's edition record, its author records,
  // then the work search; A.fromOpenLibraryEdition and A.bookRecord read the answers, as on the page
  var items = [], ol = null, ed = null;
  try { items = (await getJson(polite('https://api.crossref.org/works?rows=5&filter=isbn:' + isbn + '&select=' + SELECT, email))).message.items || []; } catch (e) { /* try Open Library */ }
  try { ed = await getJson('https://openlibrary.org/isbn/' + isbn + '.json'); ol = A.fromOpenLibraryEdition(ed, isbn); } catch (e) { /* try the work search */ }
  if (ol && !ol.author && !ol.editor && ed.authors && ed.authors.length) {
    var names = [];
    for (var i = 0; i < Math.min(ed.authors.length, 12); i++) { try { var p = await getJson('https://openlibrary.org' + ed.authors[i].key + '.json'); names.push(p.name || p.personal_name || ''); } catch (e) { /* that name is lost */ } }
    ol = A.fromOpenLibraryEdition(ed, isbn, { authorNames: names });
  }
  if (ol && !ol.author && !ol.editor) { // names from the work record as a last resort
    try { var d = await getJson('https://openlibrary.org/search.json?isbn=' + isbn + '&fields=author_name'); ol = A.fromOpenLibraryEdition(ed, isbn, { searchNames: d.docs && d.docs[0] && d.docs[0].author_name }); } catch (e) { /* no names */ }
  }
  if (!ol) {
    try { var d2 = await getJson('https://openlibrary.org/search.json?isbn=' + isbn + '&fields=' + OL_SEARCH_FIELDS); if (d2.docs && d2.docs.length) { ol = A.fromOpenLibrary(d2.docs[0], isbn); ol.namesUnsure = true; } } catch (e) { /* nothing */ }
  }
  var r = A.bookRecord(items, ol, isbn);
  if (!r) throw new Error('No book found for ISBN ' + isbn + ' at Crossref or Open Library');
  return r;
}
async function resolveId(text, email) { // a DOI, arXiv ID, PMID, PMC ID or ISBN, or text holding one
  var doi = A.toDoi(text); if (doi) return fetchRecord(doi, email);
  var pm = A.extractPmid(text); if (pm) return fetchRecord(await pmidToDoi(pm), email);
  var isbn = A.extractIsbn(text); if (isbn) return fetchIsbn(isbn, email);
  throw new Error('No DOI, arXiv ID, PubMed ID or ISBN in: ' + text);
}
var SELECT = 'DOI,URL,title,subtitle,original-title,author,editor,container-title,short-container-title,issued,published-print,published-online,volume,issue,page,article-number,type,publisher,publisher-location,ISSN,ISBN,score,event,relation,updated-by,update-to';
var OA_SELECT = 'id,doi,title,display_name,authorships,publication_year,publication_date,biblio,primary_location,type,ids,is_retracted'; // as the page asks
var oaOff = ''; // set once OpenAlex refuses (its free allowance spent, or a pause asked for): the rest of the run asks Crossref alone
async function openAlexSearch(text, email) { // the second opinion, best effort: one try, no retries, so a spent allowance costs no waiting
  if (oaOff) throw new Error(oaOff);
  var res;
  try { res = await fetch(polite('https://api.openalex.org/works?per-page=3&select=' + OA_SELECT + '&search=' + encodeURIComponent(String(text).slice(0, 300)), email), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch (e) { if (timedOut(e)) oaOff = 'OpenAlex did not answer within ' + TIMEOUT_MS / 1000 + ' s'; throw e; } // a hung service is not waited on again for every reference
  if (res.status === 429) { oaOff = 'OpenAlex is refusing requests (HTTP 429)'; throw new Error(oaOff); }
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from OpenAlex');
  return ((await res.json()).results || []).map(function (w) { return A.normalize(A.fromOpenAlex(w)); });
}
async function matchReference(text, email) { // as the page does: a DOI or ISBN in the text is trusted, otherwise Crossref's best of three with
  // OpenAlex as a second opinion, chosen by A.matchPicker (shared with the page and the Sheets functions) and graded 0..1
  var doi = A.toDoi(text);
  if (doi) { try { return { record: await fetchRecord(doi, email), conf: 1, via: 'doi' }; } catch (e) { /* search instead */ } }
  var isbn = A.extractIsbn(String(text).replace(/10\.\d{4,9}\/\S+/g, ' ')); // an ISBN inside a chapter DOI (10.1007/978-…) is not the book being cited
  if (isbn) { try { return { record: await fetchIsbn(isbn, email), conf: 1, via: 'isbn' }; } catch (e) { /* search instead */ } }
  var pk = A.matchPicker(text), via = 'search', crossrefError = null;
  try { pk.add(((await getJson(polite('https://api.crossref.org/works?rows=3&select=' + SELECT + '&query.bibliographic=' + encodeURIComponent(text), email))).message.items || []).map(A.normalize)); }
  catch (e) { crossrefError = e; }
  var year = A.citedYear(text);
  if (year && (!pk.best || pk.conf < 0.8)) { // nothing good: Crossref again, held to the year the reference gives
    try { pk.add(((await getJson(polite('https://api.crossref.org/works?rows=3&select=' + SELECT + '&filter=from-pub-date:' + (year - 1) + ',until-pub-date:' + (year + 1) + '&query.bibliographic=' + encodeURIComponent(text), email))).message.items || []).map(A.normalize)); crossrefError = null; }
    catch (e) { /* the first answer stands */ }
  }
  if (!pk.best || pk.conf < 0.5) {
    try {
      var before = pk.eff;
      pk.add(await openAlexSearch(text, email));
      if (pk.best && pk.eff > before && pk.best.source === 'openalex') {
        via = 'openalex';
        // Crossref's record for the DOI, graded afresh: an OpenAlex work merged under another paper's DOI must not pass as that paper
        if (pk.best.doi) { try { pk.best = await fetchRecord(pk.best.doi, email); pk.conf = A.matchConfidence(text, pk.best); } catch (e) { /* keep the OpenAlex record */ } }
      }
    } catch (e) { /* Crossref's answer stands */ }
  }
  if (!pk.best && crossrefError) throw crossrefError; // a failed lookup, not "no match": exit 1, so the run can be repeated
  return { record: pk.best, conf: pk.conf, via: via, alt: pk.runnerUp() };
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
  var o = { ids: [], style: 'apa', match: false, json: false, email: process.env.AUTODOI_EMAIL || '', pages: '', split: '', help: false };
  var value = function (i) { if (i + 1 >= argv.length) o.error = 'Option ' + argv[i] + ' needs a value'; return argv[i + 1]; };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--style' || a === '-s') o.style = value(i++);
    else if (a === '--email') o.email = value(i++);
    else if (a === '--pages' || a === '-p') o.pages = value(i++);
    else if (a === '--split') o.split = value(i++);
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
var SPLIT_MODES = ['auto', 'lines', 'blank', 'numbered']; // the page's "References are" menu
function splitRefs(text, mode) { return SPLIT.splitReferences(text, mode || 'auto'); }
function readDocument(file, mode) { // the reference list of a .docx or .pdf, split as the page splits a dropped file: a Word paragraph
  // is one reference; a PDF's lines, a hanging indent kept as a leading space, go through the automatic layout
  var sec = DOCS.read(require('fs').readFileSync(file), path.basename(file));
  if (!sec.refs.length) throw new Error('no References heading, and no paragraph that reads as a reference');
  return splitRefs(sec.refs.join('\n'), mode || (sec.layout === 'lines' ? 'lines' : 'auto'));
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
  if (o.split && SPLIT_MODES.indexOf(o.split) === -1) { io.err('--split takes one of ' + SPLIT_MODES.join(', ') + ', not "' + o.split + '"'); return 2; }
  if (o.split && !o.match) io.err('Note: --split applies only to --match.');
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
  var fs = require('fs'), docs = o.ids.filter(function (a) { return DOCS.isDocument(a) && fs.existsSync(a); }), refs;
  var missing = o.ids.filter(function (a) { return DOCS.isDocument(a) && !/\s/.test(a) && !fs.existsSync(a); }); // a mistyped file name, not a reference to send to Crossref
  if (missing.length) { io.err('No such file: ' + missing[0]); return 2; }
  if (docs.length) {
    if (docs.length < o.ids.length) { io.err('Give either manuscripts (.docx, .pdf) or references to --match, not both.'); return 2; }
    var at = 0; // each file split on its own: one file's blank lines must not change how another's lines are joined
    try { refs = []; for (; at < docs.length; at++) refs = refs.concat(readDocument(docs[at], o.split)); } catch (e) { io.err('Could not read ' + docs[at] + ': ' + e.message); return 2; }
  } else refs = splitRefs(o.ids.length ? o.ids.join('\n') : await io.stdin(), o.split);
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
    try { var m = await matchReference(refs[k], o.email); x = { text: refs[k], record: m.record, conf: m.conf, grade: m.record ? (m.via === 'doi' || m.via === 'isbn' ? 'good' : grade(m.conf)) : 'none' };
      if (m.alt) x.alt = { record: m.alt.record, conf: m.alt.conf }; // the close second the page offers under "Not this one?"
    }
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
