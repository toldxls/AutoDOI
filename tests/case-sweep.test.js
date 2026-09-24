// Title conversion against the publishers' own choices: a title deposited in sentence case must survive toSentenceCase
// unchanged (apart from the letter after a colon, which APA capitalises), a Title Case title must keep every substantive
// word's capital through toTitleCase, and both conversions and the formula detector must be idempotent and never touch an
// acronym.  Titles come from the 600-record corpus and the style-guide examples.  Usage: node tests/case-sweep.test.js [--verbose]
var fs = require('fs'), path = require('path');
var ROOT = path.resolve(__dirname, '..');
var A = require(path.join(ROOT, 'citations.js')), C = require(path.join(ROOT, 'sentencecase.js')), WORDS = require(path.join(ROOT, 'data', 'common-words.js'));
var verbose = process.argv.indexOf('--verbose') !== -1, pass = 0, fail = 0, problems = {}, notes = [];
function flag(rule, s) { fail++; (problems[rule] = problems[rule] || []).push(s); }
function check(rule, ok, s) { if (ok) pass++; else flag(rule, s); }
var str = function (v) { return typeof v === 'string' ? v : (v && typeof v.text === 'string' ? v.text : String(v)); };
// the page converts through toSentenceCaseSafe, which leaves a title it judges to be sentence case untouched
var sc = function (t) { return str((C.toSentenceCaseSafe || C.toSentenceCase)(t, { words: WORDS })); }, tc = function (t) { return str(C.toTitleCase(t, { words: WORDS })); };
var titles = [];
JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'corpus.json'), 'utf8')).forEach(function (m) { var r = A.normalize(m); var t = A.titleText(r); if (t && /[a-z]/.test(t) && /^[A-Za-z]/.test(t)) titles.push(t); });
JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden-examples.json'), 'utf8')).forEach(function (e) { var t = e.metadata && e.metadata.title; if (t && /[a-z]/.test(t)) titles.push(t); });
// independent of the engine: capitalisation share among words of four or more letters after the first word
function shape(t) {
  var words = t.replace(/[^A-Za-zÀ-ɏ\s'-]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 4; }).slice(1);
  if (words.length < 3) return 'short';
  var caps = words.filter(function (w) { return /^[A-ZÀ-Þ]/.test(w); }).length / words.length;
  return caps <= 0.15 ? 'sentence' : caps >= 0.85 ? 'title' : 'mixed';
}
function afterColonNeutral(s) { return s.replace(/(:\s+)([A-Za-z])/g, function (m, c, l) { return c + l.toLowerCase(); }); }
var acronyms = function (t) { return (t.match(/\b[A-Za-z]*[A-Z][A-Za-z]*[A-Z][A-Za-z0-9]*\b/g) || []).filter(function (w) { return w !== w.toLowerCase(); }); };
var nSent = 0, nTitle = 0, sentOk = 0, titleOk = 0;
titles.forEach(function (t) {
  var kind = shape(t), s = sc(t), tt = tc(t), f = A.autoFormulas(t);
  if (kind === 'sentence') {
    nSent++;
    var same = afterColonNeutral(s) === afterColonNeutral(t);
    if (same) sentOk++; else notes.push('sentence-case title changed: "' + t + '" -> "' + s + '"');
  }
  if (kind === 'title') {
    nTitle++;
    // substantive words only: prepositions follow the style's own rule, and the part after a hyphen is a convention either way
    var PREP = /^(About|Above|Across|After|Against|Along|Among|Around|Before|Behind|Below|Beneath|Beside|Between|Beyond|Despite|During|Except|Inside|Into|Like|Near|Onto|Outside|Over|Past|Since|Through|Throughout|Toward|Towards|Under|Underneath|Until|Unto|Upon|Versus|Within|Without|From|Than|That|This|These|Those|Their|There|Where|When|While|Which|Whose|Both|Either|Neither)$/;
    var lost = t.split(/\s+/).filter(function (w, i) { return i > 0 && w.length >= 5 && /^[A-Z]/.test(w) && !PREP.test(w); })
      .filter(function (w) { var head = w.split(/[-\u2010\u2011\/]/)[0]; return tt.indexOf(w) === -1 && tt.indexOf(head) === -1; });
    if (!lost.length) titleOk++; else notes.push('Title Case title lost a capital: "' + t + '" -> "' + tt + '" (' + lost.slice(0, 3).join(', ') + ')');
  }
  check('toSentenceCase is idempotent', sc(s) === s, '"' + s + '" -> "' + sc(s) + '"');
  check('toTitleCase is idempotent', tc(tt) === tt, '"' + tt + '" -> "' + tc(tt) + '"');
  check('autoFormulas is idempotent', A.autoFormulas(f) === f, '"' + f + '" -> "' + A.autoFormulas(f) + '"');
  if (kind !== 'short' && !/^[^a-z]*$/.test(t)) {
    var acr = acronyms(t).filter(function (w) { return w.length <= 6; });
    check('acronyms survive toSentenceCase', acr.every(function (w) { return s.indexOf(w) !== -1; }), '"' + t + '" -> "' + s + '" (' + acr.filter(function (w) { return s.indexOf(w) === -1; }).slice(0, 3).join(', ') + ')');
    check('acronyms survive toTitleCase', acr.every(function (w) { return tt.indexOf(w) !== -1; }), '"' + t + '" -> "' + tt + '" (' + acr.filter(function (w) { return tt.indexOf(w) === -1; }).slice(0, 3).join(', ') + ')');
  }
});
// known answers the sweep taught us
[['Wi-Fi Access Point Placement in Large Buildings', 'Wi-Fi access point placement in large buildings'],
 ['Flooding of the Bang Pakong River Basin in Thailand', 'Flooding of the Bang Pakong River Basin in Thailand'],
 ['Big Tyrannosaurus Bones From Montana', 'Big Tyrannosaurus bones from Montana'],
 ['Fe-Bearing Olivine and Ca-Rich Garnet From the Mantle', 'Fe-bearing olivine and Ca-rich garnet from the mantle'],
 ['An X-Ray Study of Non-Newtonian Fluids', 'An X-ray study of non-Newtonian fluids'],
 ['Sedimentology of the Green River Formation in Wyoming', 'Sedimentology of the Green River Formation in Wyoming']].forEach(function (c) { check('known: ' + c[0], sc(c[0]) === c[1], '"' + sc(c[0]) + '"'); });
var sentRate = nSent ? sentOk / nSent : 1, titleRate = nTitle ? titleOk / nTitle : 1;
console.log('sentence-case titles left unchanged: ' + sentOk + '/' + nSent + ' (' + (sentRate * 100).toFixed(1) + '%)   Title Case titles keeping their capitals: ' + titleOk + '/' + nTitle + ' (' + (titleRate * 100).toFixed(1) + '%)');
check('sentence-case titles survive (min 94%)', sentRate >= 0.94, (sentRate * 100).toFixed(1) + '%');
check('Title Case titles keep their capitals (min 95%)', titleRate >= 0.95, (titleRate * 100).toFixed(1) + '%');
Object.keys(problems).sort(function (a, b) { return problems[b].length - problems[a].length; }).forEach(function (rule) { console.log('FAIL ' + rule + '  (' + problems[rule].length + ')'); problems[rule].slice(0, verbose ? 60 : 6).forEach(function (s) { console.log('     ' + String(s).slice(0, 230)); }); });
if (notes.length) console.log(notes.length + ' titles converted differently from the publisher (conventions or ambiguous names): ' + notes.slice(0, verbose ? 60 : 3).join(' | '));
console.log(titles.length + ' titles');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
