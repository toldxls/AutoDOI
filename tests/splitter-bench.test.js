// Splitter accuracy on real data. Fails if accuracy drops below the recorded thresholds.
//  - three samples of 25 Crossref records formatted in seven styles and ten layouts (exact counts expected)
//  - 85 real papers' printed reference lists (fixtures/real-references.json), per-layout minimum accuracy
var path = require('path'), fs = require('fs');
var ROOT = path.resolve(__dirname, '..'), FIX = path.join(__dirname, 'fixtures');
var A = require(path.join(ROOT, 'citations.js'));
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var a = html.indexOf('  // Lines that are nothing but an identifier'), b = html.indexOf('  async function resolve(refText)');
var split = new Function('A', html.slice(a, b) + '; return splitReferences;')(require(require('path').join(ROOT, 'citations.js')));
var pass = 0, fail = 0;
function check(label, ok, detail) { if (ok) pass++; else { fail++; console.log('FAIL', label, detail || ''); } }
function wrap(t, w, indent) {
  var ws = t.split(' '), lines = [], cur = '';
  ws.forEach(function (x) { if ((cur + ' ' + x).trim().length > w) { lines.push(cur); cur = x; } else cur = (cur ? cur + ' ' : '') + x; });
  if (cur) lines.push(cur);
  return lines.map(function (l, i) { return i && indent ? indent + l : l; }).join('\n');
}
function stripDoi(t) {
  var s = t.replace(/[\s,]*(Available at:\s*|doi:\s*)?https?:\/\/doi\.org\/\S+$/, '').replace(/[,:;]$/, '');
  return /[.]$/.test(s) ? s : s + '.';
}
// Crossref records with an empty author name produce unsplittable text; they are excluded from the exact checks
function usable(i) { return i.author && i.author.length && i.title && i.author.every(function (p) { return (p.family || p.name || '').trim(); }); }
[['bench.json', ['apa']], ['bench2.json', ['apa', 'harvard', 'chicago', 'mla', 'carnegie', 'vancouver', 'ieee']], ['bench3.json', ['apa', 'harvard', 'chicago', 'mla', 'carnegie', 'vancouver', 'ieee']]].forEach(function (set) {
  var recs = JSON.parse(fs.readFileSync(path.join(FIX, set[0]))).message.items.filter(usable).slice(0, 25).map(A.normalize);
  var N = recs.length;
  set[1].forEach(function (sty) {
    var refs = recs.map(function (r) { return A.format(r, sty); });
    var layouts = {
      'one per line': refs.join('\n'), 'wrap80': refs.map(function (t) { return wrap(t, 80); }).join('\n'),
      'wrap80 no DOI': refs.map(stripDoi).map(function (t) { return wrap(t, 80); }).join('\n'),
      'wrap80 blank': refs.map(function (t) { return wrap(t, 80); }).join('\n\n'), 'wrap60': refs.map(function (t) { return wrap(t, 60); }).join('\n'),
      'wrap60 blank': refs.map(function (t) { return wrap(t, 60); }).join('\n\n'), 'hanging 4sp': refs.map(function (t) { return wrap(t, 80, '    '); }).join('\n'),
      'hanging tab': refs.map(function (t) { return wrap(t, 70, '\t'); }).join('\n'), 'wrap45': refs.map(function (t) { return wrap(t, 45); }).join('\n')
    };
    Object.keys(layouts).forEach(function (k) { var n = split(layouts[k]).length; check(set[0] + ' ' + sty + ' ' + k, n === N, n + '/' + N); });
  });
});
// Real printed reference lists: accuracy = share of reference boundaries found
var papers = require(path.join(FIX, 'real-references.json'));
var clean = function (s) { return s.replace(/\s+/g, ' ').trim(); };
// Three papers' lists hold entries that are themselves two or three citations ("… 52; S. Askenazy, Physica B 216 (1996) 221.",
// "(a) … (b) …", a footnote number between two references): the splitter is right to separate those, so each such entry
// counts for as many references as it holds.  Every other entry is a single reference and must never be split.
var MULTI = { '10.1016/s0921-4526(98)00026-x': 1, '10.1016/j.cattod.2013.07.006': 1, '10.1136/bmj.296.6614.25': 1 };
var wronglySplit = [];
papers.forEach(function (p) { if (!MULTI[p.doi]) p.refs.forEach(function (r) { if (split(clean(r), 'lines').length > 1) wronglySplit.push(clean(r).slice(0, 100)); }); });
check('no single real reference is split in two (' + wronglySplit.length + ')', wronglySplit.length === 0, wronglySplit.slice(0, 5).join(' | '));
function accuracy(layoutFn, mode) {
  var exact = 0;
  papers.forEach(function (p) {
    var refs = p.refs.map(clean).filter(function (r) { return r.length > 8; });
    var want = MULTI[p.doi] ? refs.reduce(function (n, r) { return n + split(r, 'lines').length; }, 0) : refs.length;
    if (split(layoutFn(refs), mode).length === want) exact++;
  });
  return exact / papers.length;
}
var real = [
  ['auto: numbered', function (r) { return r.map(function (x, i) { return wrap((i + 1) + '. ' + x, 80); }).join('\n'); }, 'auto', 0.99],
  ['auto: hanging indent', function (r) { return r.map(function (x) { return wrap(x, 80, '    '); }).join('\n'); }, 'auto', 0.95],
  ['auto: blank lines', function (r) { return r.map(function (x) { return wrap(x, 80); }).join('\n\n'); }, 'auto', 0.93],
  ['auto: one per line', function (r) { return r.join('\n'); }, 'auto', 0.70],
  ['layout blank', function (r) { return r.map(function (x) { return wrap(x, 80); }).join('\n\n'); }, 'blank', 1.0],
  ['layout numbered', function (r) { return r.map(function (x, i) { return wrap((i + 1) + '. ' + x, 80); }).join('\n'); }, 'numbered', 1.0],
  ['layout one per line', function (r) { return r.join('\n'); }, 'lines', 0.97]
];
real.forEach(function (c) { var acc = accuracy(c[1], c[2]); console.log('  real papers, ' + c[0] + ': ' + (acc * 100).toFixed(1) + '% exact (min ' + c[3] * 100 + '%)'); check('real ' + c[0], acc >= c[3], (acc * 100).toFixed(1) + '%'); });
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
