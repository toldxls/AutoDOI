// Invariant sweep: 600 real Crossref records of every work type (tests/fixtures/corpus.json, harvested with
// Crossref's ?sample= endpoint) go through every style, the in-text forms, the HTML renderer and the three
// export formats.  No expected strings: the checks are properties any correct output must have, so they
// need no right answer.  Also a round trip: format to RIS and BibTeX, parse back, compare the core fields.
// Usage: node tests/invariants.test.js [--verbose]
var fs = require('fs'), path = require('path');
var ROOT = path.resolve(__dirname, '..');
var A = require(path.join(ROOT, 'citations.js')), P = require(path.join(ROOT, 'parsers.js'));
var corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'corpus.json'), 'utf8'));
var verbose = process.argv.indexOf('--verbose') !== -1;
var pass = 0, fail = 0, problems = {}; // rule -> [examples]
function flag(rule, doi, sample) {
  fail++; (problems[rule] = problems[rule] || []).push(doi + '  ' + String(sample).replace(/\s+/g, ' ').slice(0, 160));
}
function ok(rule) { pass++; }
function check(rule, cond, doi, sample) { if (cond) ok(rule); else flag(rule, doi, sample); }

var STYLES = A.STYLES.map(function (s) { return s.id; }), IN_TEXT = A.STYLES.filter(function (s) { return s.inText; }).map(function (s) { return s.id; }); // only styles that define an in-text form
var TAG = /<\/?[a-z][a-z0-9:-]*(\s[^<>]*)?>/i, ENTITY = /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+|[a-z]{2,8});/i, PUA = /[-]/;
function plainInvariants(rule, s, doi) {
  var t = String(s);
  var u = t.replace(/\. \. \./g, '…'); // APA's spaced ellipsis for 21+ authors is legitimate
  check(rule + ': non-empty', t.trim().length > 0, doi, t);
  check(rule + ': no undefined/NaN/[object', !/\bundefined\b|\[object Object\]|(^|[\s(,.;:])NaN(?=[\s),.;:]|$)/.test(t), doi, t); // 'null' can be a real word in a title
  check(rule + ': no leaked markup', !TAG.test(t), doi, t);
  check(rule + ': no leaked entities', !ENTITY.test(t), doi, t);
  check(rule + ': no private-use characters', !PUA.test(t), doi, t);
  check(rule + ': no doubled terminal punctuation', !/(?<!\.)\.\.(?!\.)|[?!]\.(?!\.)|,\s*,|;\s*;|:\s*:|,\.|;\.|:\./.test(u), doi, t);
  check(rule + ': no empty brackets', !/\(\s*\)|\[\s*\]|\{\s*\}/.test(u), doi, t);
  check(rule + ': no space before punctuation', !/\s[,.;:](\s|$)/.test(u.replace(/\bet al\s\./g, '')), doi, t);
  check(rule + ': no double spaces', !/ {2,}/.test(u), doi, t);
  check(rule + ': no dangling separator at the end', !/[,;:(]\s*$/.test(u), doi, t);
  check(rule + ': no separator right after an opening bracket', !/[(\[]\s*[,;:]/.test(u), doi, t);
  check(rule + ': trimmed', t === t.trim(), doi, t);
}
function htmlInvariants(rule, h, doi) {
  var t = String(h);
  check(rule + ': only inline tags', !/<\/?(?!(i|b|em|strong|sub|sup|span|a)\b)[a-z][^>]*>/i.test(t), doi, t);
  check(rule + ': no scripts or handlers', !/<script|on\w+\s*=|javascript:/i.test(t), doi, t);
  var opens = (t.match(/<(i|b|em|strong|sub|sup|span|a)\b[^>]*>/gi) || []).length, closes = (t.match(/<\/(i|b|em|strong|sub|sup|span|a)>/gi) || []).length;
  check(rule + ': balanced tags', opens === closes, doi, t);
  check(rule + ': no private-use characters', !PUA.test(t), doi, t);
}
function risInvariants(s, doi) {
  var lines = s.replace(/\r/g, '').split('\n').filter(function (l) { return l.length; });
  check('ris: starts with TY', /^TY  - /.test(lines[0] || ''), doi, s);
  check('ris: ends with ER', /^ER  - ?$/.test(lines[lines.length - 1] || ''), doi, lines.slice(-2).join('|'));
  check('ris: every line is a tag line', lines.every(function (l) { return /^[A-Z][A-Z0-9]  - /.test(l); }), doi, lines.filter(function (l) { return !/^[A-Z][A-Z0-9]  - /.test(l); })[0]);
  check('ris: one record', lines.filter(function (l) { return /^TY  - /.test(l); }).length === 1, doi, s);
  check('ris: no leaked markup', !TAG.test(s), doi, s);
  check('ris: no private-use characters', !PUA.test(s), doi, s);
}
function enwInvariants(s, doi) {
  var lines = s.replace(/\r/g, '').split('\n').filter(function (l) { return l.length; });
  check('enw: starts with %0', /^%0 /.test(lines[0] || ''), doi, s);
  check('enw: every line is a tag line', lines.every(function (l) { return /^%[A-Za-z0-9!@#$&*+<>?^\[\]=~\-] /.test(l); }), doi, lines.filter(function (l) { return !/^%[A-Za-z0-9!@#$&*+<>?^\[\]=~\-] /.test(l); })[0]);
  check('enw: no leaked markup', !TAG.test(s), doi, s);
  check('enw: no private-use characters', !PUA.test(s), doi, s);
}
function bibInvariants(s, doi) {
  var m = s.match(/^@(\w+)\{([^,\s]+),\n/);
  check('bibtex: entry head "@type{key,"', !!m, doi, s.slice(0, 80));
  if (m) check('bibtex: key is plain ASCII', /^[A-Za-z0-9:_.\-]+$/.test(m[2]), doi, m[2]);
  var depth = 0, bad = false; for (var i = 0; i < s.length; i++) { if (s[i] === '{') depth++; else if (s[i] === '}') { depth--; if (depth < 0) bad = true; } }
  check('bibtex: braces balance', depth === 0 && !bad, doi, s);
  check('bibtex: ends with }', /\}\s*$/.test(s), doi, s.slice(-40));
  check('bibtex: field lines', s.split('\n').slice(1, -1).every(function (l) { return /^\s+[a-z]+\s*=\s*([{"]|\d|[a-z]{3},$)/.test(l) || /^\s*$/.test(l) || /^\s+[^=]*$/.test(l); }), doi, s); // month = feb is a BibTeX macro
  check('bibtex: no unescaped bare &, %, # outside braces', !/\n\s*[a-z]+\s*=\s*"[^"]*[%#]/.test(s), doi, s);
  check('bibtex: no private-use characters', !PUA.test(s), doi, s);
  check('bibtex: no leaked html', !/<\/?(i|b|sub|sup|jats|mml)[^>]*>/i.test(s), doi, s);
}
var SUBSUP = { '\u2080': '0', '\u2081': '1', '\u2082': '2', '\u2083': '3', '\u2084': '4', '\u2085': '5', '\u2086': '6', '\u2087': '7', '\u2088': '8', '\u2089': '9', '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3', '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7', '\u2078': '8', '\u2079': '9' };
function norm(s) { // words only: sub/superscript digits count as digits (exports use them), accents compared composed
  return A.stripTags(String(s || '')).normalize('NFC').replace(/[\u2080-\u2089\u2070\u00B9\u00B2\u00B3\u2074-\u2079]/g, function (c) { return SUBSUP[c]; }).toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/[^a-z0-9\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u4e00-\u9fff]+/g, ' ').trim();
}
function roundTrip(fmt, parse, r, doi) {
  var text = A.format(r, fmt), back;
  try { back = parse(text); } catch (e) { flag('roundtrip ' + fmt + ': parser threw', doi, e.message); return; }
  var recs = (Array.isArray(back) ? back : (back && back.records) || []).map(A.normalize); // parsers return Crossref-shaped records
  check('roundtrip ' + fmt + ': one record parses back', recs.length === 1, doi, recs.length + ' records');
  if (recs.length !== 1) return;
  var b = recs[0];
  if (r.title) check('roundtrip ' + fmt + ': title survives', norm(b.title) === norm(r.title) || norm(b.title).indexOf(norm(r.title)) === 0, doi, norm(b.title) + ' | ' + norm(r.title));
  if (r.year) check('roundtrip ' + fmt + ': year survives', String(b.year) === String(r.year), doi, b.year + ' | ' + r.year);
  if (r.doi) check('roundtrip ' + fmt + ': DOI survives', (b.doi || '').toLowerCase() === r.doi.toLowerCase(), doi, b.doi);
  if (r.authors.length && !r.authors[0].literal) check('roundtrip ' + fmt + ': first author family survives', norm(b.authors && b.authors[0] && b.authors[0].family) === norm(r.authors[0].family), doi, JSON.stringify(b.authors && b.authors[0]) + ' | ' + r.authors[0].family);
  if (A.kind(r) === 'journal' && r.container) check('roundtrip ' + fmt + ': journal survives', norm(b.container) === norm(r.container), doi, b.container + ' | ' + r.container);
  if (r.volume && A.kind(r) === 'journal') check('roundtrip ' + fmt + ': volume survives', String(b.volume) === String(r.volume), doi, b.volume + ' | ' + r.volume);
  if (r.pages && A.kind(r) === 'journal') check('roundtrip ' + fmt + ': pages survive', norm(b.pages) === norm(r.pages), doi, b.pages + ' | ' + r.pages);
}

var t0 = Date.now(), byType = {};
corpus.forEach(function (m) {
  var doi = m.DOI, r;
  byType[m.type] = (byType[m.type] || 0) + 1;
  try { r = A.normalize(m); } catch (e) { flag('normalize throws', doi, e.stack.split('\n').slice(0, 2).join(' ')); return; }
  check('normalize: keeps the DOI', (r.doi || '').toLowerCase() === doi.toLowerCase(), doi, r.doi);
  check('normalize: year is 4 digits or empty', !r.year || /^\d{4}[a-z]?$/.test(r.year), doi, r.year);
  check('normalize: authors are well formed', r.authors.every(function (p) { return p && typeof p.family === 'string' && p.family.trim() && typeof p.given === 'string'; }), doi, JSON.stringify(r.authors.filter(function (p) { return !p || !p.family || !p.family.trim(); })[0]));
  check('normalize: kind is known', ['journal', 'book', 'chapter', 'proceedings', 'thesis', 'preprint', 'report', 'web', 'dataset', 'software', 'generic', 'standard'].indexOf(A.kind(r)) !== -1, doi, A.kind(r));
  STYLES.forEach(function (st) {
    var out; try { out = A.format(r, st); } catch (e) { flag(st + ': format throws', doi, e.stack.split('\n').slice(0, 2).join(' ')); return; }
    plainInvariants(st, out, doi);
    if (r.title) check(st + ': title text present', norm(out).indexOf(norm(r.title).split(' ').slice(0, 4).join(' ')) !== -1, doi, out);
    if (r.year && st !== 'ieee') check(st + ': year present', out.indexOf(r.year.replace(/[a-z]$/, '')) !== -1, doi, out);
    var h; try { h = A.formatHtml(r, st); } catch (e) { flag(st + ': formatHtml throws', doi, e.message); return; }
    htmlInvariants(st + ' html', h, doi);
    check(st + ' html: same words as the plain form', norm(h) === norm(out), doi, norm(h).slice(0, 120) + ' | ' + norm(out).slice(0, 120));
  });
  IN_TEXT.forEach(function (st) {
    var it; try { it = A.inText(r, st); } catch (e) { flag(st + ' in-text: throws', doi, e.message); return; }
    plainInvariants(st + ' in-text', it, doi);
  });
  A.EXPORTS.forEach(function (x) {
    var out; try { out = A.format(r, x.id); } catch (e) { flag(x.id + ': format throws', doi, e.message); return; }
    check(x.id + ': no undefined', !/\bundefined\b|\[object Object\]/.test(out), doi, out);
    check(x.id + ': no private-use characters', !PUA.test(out), doi, out);
    if (x.id === 'ris') risInvariants(out, doi); else if (x.id === 'endnote') enwInvariants(out, doi); else bibInvariants(out, doi);
  });
  roundTrip('ris', P.parseRIS, r, doi);
  roundTrip('bibtex', P.parseBibTeX, r, doi);
  roundTrip('endnote', P.parseENW, r, doi);
});

var rules = Object.keys(problems).sort(function (a, b) { return problems[b].length - problems[a].length; });
rules.forEach(function (rule) {
  console.log('FAIL ' + rule + '  (' + problems[rule].length + ')');
  problems[rule].slice(0, verbose ? 50 : 3).forEach(function (x) { console.log('     ' + x); });
});
console.log('corpus: ' + corpus.length + ' records, ' + Object.keys(byType).length + ' work types, ' + (Date.now() - t0) + ' ms');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
