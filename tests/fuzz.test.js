// Fuzz: mutated RIS, EndNote and BibTeX files, mutated reference lists, and records with hostile field values.
// The contract is narrow and absolute: no parser, splitter or formatter may throw, hang, or leak private-use
// characters or markup, and intact records must not disappear when garbage is added around them.
// Deterministic (seeded), so a failure reproduces.  Usage: node tests/fuzz.test.js [seed]
var fs = require('fs'), path = require('path');
var ROOT = path.resolve(__dirname, '..');
var A = require(path.join(ROOT, 'citations.js')), P = require(path.join(ROOT, 'parsers.js')), S = require(path.join(ROOT, 'sentencecase.js'));
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var a0 = html.indexOf('  // Lines that are nothing but an identifier'), b0 = html.indexOf('  async function resolve(refText)');
var splitReferences = new Function(html.slice(a0, b0) + '; return splitReferences;')();
var corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'corpus.json'), 'utf8'));
var real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'real-references.json'), 'utf8'));
var seed = Number(process.argv[2]) || 20260924, pass = 0, fail = 0, problems = {};
function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function flag(rule, sample) { fail++; (problems[rule] = problems[rule] || []).push(String(sample).replace(/\s+/g, ' ').slice(0, 200)); }
function check(rule, cond, sample) { if (cond) pass++; else flag(rule, sample); }
var PUA = /[-]/, TAG = /<\/?[a-z][a-z0-9:-]*(\s[^<>]*)?>/i;

// --- byte and structure mutations ---
var JUNK = ['\u0000', '\u0007', '\u001b[31m', '\r', '\r\n', '\t', '%', '%%', '{', '}', '{{', '}}', '<', '>', '&', '&amp;', '&#0;', '<i>', '</sub>', '<script>', '\\', '\\\\', '\\"', '"', "'", '`', '​', '‮', '﻿', '', '😀', '中文', 'الع', 'é', '́', 'TY  - ', 'ER  - ', '%0 ', '@article{', '10.1000/', 'https://', '\n\n\n', ' '.repeat(200), 'A'.repeat(5000)];
function mutate(text) {
  var kind = Math.floor(rnd() * 12), n = text.length, i = Math.floor(rnd() * n), j = Math.min(n, i + Math.floor(rnd() * 40));
  switch (kind) {
    case 0: return text.slice(0, i);                                   // truncated
    case 1: return text.slice(0, i) + text.slice(j);                   // span deleted
    case 2: return text.slice(0, i) + pick(JUNK) + text.slice(i);      // junk inserted
    case 3: return text.split('\n').map(function (l) { return rnd() < 0.1 ? l + pick(JUNK) : l; }).join('\n');
    case 4: var ls = text.split('\n'); for (var k = ls.length - 1; k > 0; k--) { var m = Math.floor(rnd() * (k + 1)); var t = ls[k]; ls[k] = ls[m]; ls[m] = t; } return ls.join('\n');
    case 5: return text.replace(/\n/g, rnd() < 0.5 ? '\r\n' : '\r');
    case 6: return text.replace(/\n/g, ' ');                           // all on one line
    case 7: return text + text;                                        // doubled
    case 8: return text.split('\n').map(function (l) { return rnd() < 0.2 ? l.toLowerCase() : l; }).join('\n');
    case 9: return text.replace(/[{}]/g, function (c) { return rnd() < 0.3 ? '' : c; });
    case 10: return text.replace(/  - /g, function () { return rnd() < 0.3 ? ' - ' : '  - '; });
    default: return Array.from(text).map(function (c) { return rnd() < 0.02 ? pick(JUNK) : c; }).join('');
  }
}
function timed(label, fn, limitMs) {
  var t0 = Date.now(), out, err = null;
  try { out = fn(); } catch (e) { err = e; }
  var ms = Date.now() - t0;
  check(label + ': does not throw', !err, err && (err.stack || err.message));
  check(label + ': finishes in time', ms <= (limitMs || 1000), ms + ' ms');
  return out;
}

// 1. Export files from real records, mutated, back through the parsers
var recs = corpus.filter(function (m, i) { return i % 10 === 0; }).map(A.normalize); // 60 records
var files = [];
recs.forEach(function (r) { files.push(['ris', A.format(r, 'ris')]); files.push(['endnote', A.format(r, 'endnote')]); files.push(['bibtex', A.format(r, 'bibtex')]); });
var parsers = { ris: P.parseRIS, endnote: P.parseENW, bibtex: P.parseBibTeX };
for (var round = 0; round < 6; round++) {
  files.forEach(function (f) {
    var bad = mutate(f[1]), label = 'parse ' + f[0] + ' (mutated)';
    var out = timed(label, function () { return parsers[f[0]](bad); }, 500);
    check(label + ': returns an array', Array.isArray(out), typeof out);
    timed('detect (mutated ' + f[0] + ')', function () { return P.detect(bad); }, 200);
    var mixed = timed('parseMixed (mutated ' + f[0] + ')', function () { return P.parseMixed(bad); }, 500);
    if (Array.isArray(out)) out.forEach(function (rec) {
      var n; try { n = A.normalize(rec); } catch (e) { flag('normalize(parsed mutated record): throws', e.message); return; }
      pass++;
      A.STYLES.forEach(function (st) {
        var s; try { s = A.format(n, st.id); } catch (e) { flag(st.id + ': throws on parsed mutated record', e.message); return; }
        check(st.id + ': no private-use leak', !PUA.test(s), s); check(st.id + ': no markup leak', !TAG.test(s), s);
      });
    });
  });
}
// 1b. Intact records survive garbage around and between them
files.forEach(function (f) {
  var one = parsers[f[0]](f[1]).length; if (one !== 1) return;
  var junkLine = pick(['garbage line with no tag', '%', '{', 'TY', '  - ', '\u0000\u0000', 'ER', '@', '<b>bold</b>']);
  var two = f[1] + '\n' + junkLine + '\n' + f[1] + '\n' + junkLine + '\n';
  var n = parsers[f[0]](two).length;
  check(f[0] + ': two intact records with junk between still parse as two', n === 2, n + ' records; junk=' + JSON.stringify(junkLine));
  var mixed = P.parseMixed('Some pasted reference. Journal, 1(2):3-4.\n\n' + f[1] + '\n\nAnother pasted line.');
  check(f[0] + ': parseMixed keeps the file record among pasted text', JSON.stringify(mixed).indexOf(f[0] === 'endnote' ? 'enw' : f[0]) !== -1 || (mixed && mixed.records && mixed.records.length), JSON.stringify(mixed).slice(0, 200));
});

// 2. The splitter on mutated real reference lists
var lists = real.map(function (x) { return x.refs.join('\n'); });
for (var r2 = 0; r2 < 4; r2++) {
  lists.forEach(function (text, idx) {
    var bad = mutate(text), label = 'split (mutated list ' + idx + ')';
    var out = timed(label, function () { return splitReferences(bad); }, 1000);
    if (!Array.isArray(out)) { flag(label + ': returns an array', typeof out); return; }
    pass++;
    check(label + ': no empty pieces', out.every(function (p) { return typeof p === 'string' && p.trim(); }), out.filter(function (p) { return !p || !p.trim(); }).length + ' empty');
    var inLen = bad.replace(/\s+/g, '').length, outLen = out.join('').replace(/\s+/g, '').length;
    check(label + ': keeps the text (numbering aside)', inLen === 0 || outLen >= 0.85 * inLen, outLen + ' of ' + inLen + ' chars');
    check(label + ': no piece is a mile long', out.every(function (p) { return p.length <= Math.max(2000, bad.length); }), 'longest ' + Math.max.apply(null, out.map(function (p) { return p.length; })));
  });
}
// 2b. Pathological inputs
[['empty', ''], ['spaces', '   \n\n  \t '], ['one char', 'a'], ['nulls', '\u0000'.repeat(100)], ['one long line', 'word '.repeat(20000)], ['many blank lines', '\n'.repeat(5000)],
 ['numbering only', Array.from({ length: 400 }, function (_, i) { return (i + 1) + '.'; }).join('\n')], ['dots', '.'.repeat(10000)], ['years', '(2020) '.repeat(3000)],
 ['particles', 'de la '.repeat(3000) + 'Smith, J. (2020). T.'], ['brackets', '['.repeat(3000) + ']'.repeat(3000)], ['emoji list', '1. 😀 A.\n2. 😀 B.\n3. 😀 C.'],
 ['rtl', 'العربية، ج. (2020). عنوان. مجلة، 1(2)، 3-4.\nעברית, י. (2019). כותרת. כתב עת, 5, 6-7.'], ['cjk', '张三. (2020). 标题. 期刊, 1(2), 3-4.\n李四. (2019). 标题二. 期刊二, 5, 6-7.']].forEach(function (c) {
  var out = timed('split ' + c[0], function () { return splitReferences(c[1]); }, 1500);
  check('split ' + c[0] + ': array', Array.isArray(out), typeof out);
  ['ris', 'endnote', 'bibtex'].forEach(function (k) { var o = timed('parse ' + k + ' ' + c[0], function () { return parsers[k](c[1]); }, 500); check('parse ' + k + ' ' + c[0] + ': array', Array.isArray(o), typeof o); });
  timed('detect ' + c[0], function () { return P.detect(c[1]); }, 500);
  timed('parseMixed ' + c[0], function () { return P.parseMixed(c[1]); }, 1500);
  timed('toDoi ' + c[0], function () { return A.toDoi(c[1]); }, 500);
  timed('extractPmid ' + c[0], function () { return A.extractPmid(c[1]); }, 500);
  timed('sentence case ' + c[0], function () { return S.toSentenceCase(c[1]); }, 1500);
  timed('title case ' + c[0], function () { return S.toTitleCase(c[1]); }, 1500);
  timed('formulas ' + c[0], function () { return A.autoFormulas(c[1]); }, 1500);
});

// 3. Records with hostile field values through every style and export
var HOSTILE = ['', null, undefined, 0, 1e21, -1, NaN, true, [], {}, ['a', 'b'], { a: 1 }, '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '&lt;i&gt;x&lt;/i&gt;', '', '\u0000', '‮evil', 'A'.repeat(10000), '  ', '\n\n', '..', ',,', '&&', '%s%s%n', '{}', '${x}', '<mml:math><mml:mi>x</mml:mi></mml:math>', '10.1000/<b>x</b>', 'javascript:alert(1)', '“”‘’', '(', ')', '[', '];', '1-', '-2', 'e5', '2020-13-45', '99999'];
var FIELDS = ['title', 'subtitle', 'container', 'shortContainer', 'series', 'number', 'institution', 'edition', 'numPages', 'genre', 'year', 'month', 'day', 'volume', 'issue', 'pages', 'articleNumber', 'publisher', 'place', 'issn', 'isbn', 'doi', 'url', 'language', 'event', 'type'];
var base = A.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'w.json'), 'utf8')).message);
for (var k = 0; k < 400; k++) {
  var r = JSON.parse(JSON.stringify(base)), n = 1 + Math.floor(rnd() * 4);
  for (var q = 0; q < n; q++) r[pick(FIELDS)] = pick(HOSTILE);
  if (rnd() < 0.3) r.authors = [{ family: pick(HOSTILE), given: pick(HOSTILE), suffix: pick(HOSTILE), literal: rnd() < 0.5 }];
  if (rnd() < 0.2) r.authors = pick([[], null, undefined, 'Smith', [null], [{}], [{ family: 'A', given: 'B', suffix: '', literal: false }]]);
  if (rnd() < 0.2) r.editors = pick([[], null, [{ family: '<i>', given: '', suffix: '', literal: true }]]);
  if (rnd() < 0.2) r.accessed = pick([null, {}, { year: 'x' }, { year: 2020, month: 99, day: -1 }]);
  var what = JSON.stringify(r).slice(0, 160);
  A.STYLES.forEach(function (st) {
    var s; try { s = A.format(r, st.id); } catch (e) { flag(st.id + ': throws on hostile record', e.message + '  ' + what); return; }
    check(st.id + ': string out', typeof s === 'string', typeof s);
    check(st.id + ': no private-use leak', !PUA.test(s), s);
    var h; try { h = A.formatHtml(r, st.id); } catch (e) { flag(st.id + ' html: throws on hostile record', e.message + '  ' + what); return; }
    check(st.id + ' html: no live script or handler', !/<script|<[a-z][^>]*\son\w+\s*=|href\s*=\s*["']?javascript:/i.test(h), h); // as text (escaped) they are harmless
    check(st.id + ' html: only inline tags', !/<\/?(?!(i|b|em|strong|sub|sup|span|a)\b)[a-z][^>]*>/i.test(h), h);
    if (st.inText) { try { A.inText(r, st.id); pass++; } catch (e) { flag(st.id + ' in-text: throws on hostile record', e.message); } }
  });
  A.EXPORTS.forEach(function (x) {
    var s; try { s = A.format(r, x.id); } catch (e) { flag(x.id + ': throws on hostile record', e.message + '  ' + what); return; }
    check(x.id + ': string out', typeof s === 'string', typeof s);
    check(x.id + ': no private-use leak', !PUA.test(s), s);
  });
  try { A.kind(r); A.matchConfidence('Smith 2020 title', r); pass++; } catch (e) { flag('kind/matchConfidence: throws on hostile record', e.message + '  ' + what); }
}

var rules = Object.keys(problems).sort(function (a, b) { return problems[b].length - problems[a].length; });
rules.forEach(function (rule) { console.log('FAIL ' + rule + '  (' + problems[rule].length + ')'); problems[rule].slice(0, 3).forEach(function (x) { console.log('     ' + x); }); });
console.log('seed ' + (Number(process.argv[2]) || 20260924));
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
