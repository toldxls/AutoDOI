// tests/pdf-writer.js checked against pdf.js (the copy the page serves, in vendor/): every way the writer can set a file down
// (each filter and filter chain, PNG row predictors, object streams, encryption, a composite font) must read in pdf.js as the plain
// file does.  The reader's tests in tests/documents.test.js stand on the writer, so this is what keeps them from testing documents.js
// against its own mistakes: a doubled LZW clear code, which documents.js tolerates and pdf.js does not, was found this way.
// pdf.js 6 needs Node 22 (Promise.withResolvers); on an older Node the suite says so and checks nothing else.
// Usage: node tests/pdf-oracle.test.js
var path = require('path'), fs = require('fs'), url = require('url');
var ROOT = path.resolve(__dirname, '..'), W = require('./pdf-writer.js');
var pass = 0, fail = 0;
function check(label, ok, detail) { if (ok) pass++; else { fail++; console.log('FAIL ' + label + (detail ? '\n   ' + String(detail).slice(0, 300) : '')); } }
var major = Number(process.versions.node.split('.')[0]);
var dir = fs.readdirSync(path.join(ROOT, 'vendor')).filter(function (d) { return /^pdfjs-/.test(d); })[0];

(async function () {
  if (major < 22) { console.log('note: pdf.js needs Node 22 or newer; this is Node ' + process.versions.node + ', so the writer is not checked here'); check('an old Node is the only reason to skip', true); return finish(); }
  var warn = console.warn, log = console.log, quiet = function () { console.warn = function () {}; console.log = function (s) { if (!/^Warning:/.test(String(s))) log.apply(console, arguments); }; }, loud = function () { console.warn = warn; console.log = log; };
  quiet(); // pdf.js warns, in Node, that it cannot draw: only text is read here
  try {
    var pdfjs = await import(url.pathToFileURL(path.join(ROOT, 'vendor', dir, 'pdf.min.mjs')).href);
    pdfjs.GlobalWorkerOptions.workerSrc = url.pathToFileURL(path.join(ROOT, 'vendor', dir, 'pdf.worker.min.mjs')).href;
  } finally { loud(); }
  async function text(bytes) {
    quiet();
    var task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false });
    try {
      var doc = await task.promise, out = [];
      for (var p = 1; p <= doc.numPages; p++) (await (await doc.getPage(p)).getTextContent()).items.forEach(function (i) { if (i.str.trim()) out.push(i.str.trim()); });
      return out.join(' ').replace(/\s+/g, ' ');
    } finally { await task.destroy(); loud(); }
  }
  var lines = []; for (var i = 0; i < 90; i++) lines.push({ x: 72, y: 780 - i * 8, size: 7, text: 'Abel, A. (' + (1900 + i) + ') A title about kernite number ' + (i * 7919 % 1000) + '. J Chem ' + i + ', ' + i + '.' });
  var long = function (o) { return W.pdf(Object.assign({ pages: [{ lines: lines }] }, o)); }; // long enough for LZW to reach 12-bit codes and clear its table
  var plain = await text(long({})), plainMs = await text(W.manuscript({}));
  check('pdf.js reads the plain file', /Abel, A\. \(1989\)/.test(plain) && /Nanometre-scale thermometry/.test(plainMs), plain.slice(0, 100));
  var chains = [['Fl'], ['LZW'], ['A85'], ['AHx'], ['RL'], ['A85', 'Fl'], ['AHx', 'LZW']];
  for (var c = 0; c < chains.length; c++) for (var pr = 0; pr < 2; pr++) {
    var label = chains[c].join(' over ') + (pr ? ', PNG row predictors' : '');
    check('pdf.js reads ' + label + ' as the plain file', (await text(long({ filters: chains[c], predictor: !!pr }))) === plain, label);
    check('pdf.js reads a manuscript in ' + label + ', objects packed, as the plain one', (await text(W.manuscript({ filters: chains[c], predictor: !!pr, objstm: true }))) === plainMs, label);
  }
  var others = [['RC4 40-bit', { encrypt: 'rc4' }], ['AES-128', { compress: true, encrypt: 'aes' }], ['AES-128, objects packed', { compress: true, objstm: true, encrypt: 'aes' }], ['a composite font', { compress: true, font: 'F2' }]];
  for (var k = 0; k < others.length; k++) check('pdf.js reads a manuscript in ' + others[k][0] + ' as the plain one', (await text(W.manuscript(others[k][1]))) === plainMs, others[k][0]);
  finish();
})().catch(function (e) { fail++; console.log('FAIL ' + (e.stack || e.message)); finish(); });
function finish() { console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0; }
