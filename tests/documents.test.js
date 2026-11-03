var ROOT = require('path').resolve(__dirname, '..');
// documents.js: the inflate both readers use, checked against zlib; the PDF reader on files written the ways real ones are
// (tests/pdf-writer.js: compressed, packed in object streams, composite fonts, encrypted as publishers do); the Word reader on
// the manuscript fixture.  Run: node tests/documents.test.js
var fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
var D = require(path.join(ROOT, 'documents.js')), W = require('./pdf-writer.js');
let pass = 0, fail = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) pass++; else { fail++; console.log('FAIL', label, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(exp)); } };
const throws = (label, fn, re) => { try { fn(); fail++; console.log('FAIL', label, '(no error)'); } catch (e) { if (re.test(e.message)) pass++; else { fail++; console.log('FAIL', label, '\n   got error', e.message); } } };

// ---------- inflate: every block type, every level, against zlib ----------
var rnd = crypto.createHash('sha256'), seed = 1;
function bytes(n, kind) { // text-like, random, or long runs: each drives the encoder to other block types
  var b = Buffer.alloc(n);
  for (var i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) >>> 0; b[i] = kind === 'random' ? seed >>> 24 : kind === 'runs' ? (i >> 9) & 7 : 'the quick brown fox jumps over the lazy dog 0123456789 '.charCodeAt((seed >>> 16) % 55); }
  return b;
}
var same = 0, cases = 0;
['text', 'random', 'runs'].forEach(function (kind) {
  [0, 1, 100, 5000, 70000, 300000].forEach(function (n) {
    var src = bytes(n, kind);
    [0, 1, 6, 9].forEach(function (level) {
      [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FIXED, zlib.constants.Z_HUFFMAN_ONLY, zlib.constants.Z_RLE].forEach(function (strategy) {
        cases++;
        var raw = zlib.deflateRawSync(src, { level: level, strategy: strategy }), wrapped = zlib.deflateSync(src, { level: level, strategy: strategy });
        if (Buffer.from(D.inflate(raw, { zlib: false, strict: true })).equals(src) && Buffer.from(D.inflate(wrapped, { strict: true })).equals(src)) same++;
        else console.log('   inflate differs:', kind, n, 'level', level, 'strategy', strategy);
      });
    });
  });
});
eq('inflate gives zlib\'s bytes for every level and strategy, raw and with the zlib header (' + cases + ' cases)', same, cases);
var long = bytes(200000, 'text'), packed = zlib.deflateSync(long), cut = packed.subarray(0, packed.length >> 1);
var part = D.inflate(cut);
var zpart = zlib.inflateSync(cut, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
eq('a truncated stream keeps what was decoded before the cut, as zlib does', zpart.length > 1000 && part.length >= zpart.length && Buffer.from(part.subarray(0, zpart.length)).equals(zpart), true);
throws('a truncated stream throws when strict', function () { D.inflate(cut, { strict: true }); }, /ends early/);
throws('a stream past its limit throws, kept or not', function () { D.inflate(zlib.deflateSync(Buffer.alloc(5000)), { max: 4096 }); }, /more than/);
throws('garbage throws when strict', function () { D.inflate(Buffer.from('not a deflate stream at all, honestly'), { zlib: false, strict: true }); }, /bad|ends early/);

// ---------- a PDF manuscript, however it is written ----------
var LIST = ['Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., and Lukin,', ' M. D. (2013) Nanometre-scale thermometry in a living cell. Nature, 500, 54–58.',
  'Vaswani, A., Shazeer, N. and Parmar, N. (2017) Attention is all you need. Advances in', ' Neural Information Processing Systems, 30, 5998–6008.'];
[['plain', {}], ['compressed', { compress: true }], ['in an object stream with an xref stream', { compress: true, objstm: true }], ['in a composite font with a ToUnicode map', { compress: true, font: 'F2' }],
 ['encrypted with RC4 40-bit', { encrypt: 'rc4' }], ['encrypted with AES-128', { compress: true, encrypt: 'aes' }], ['encrypted with AES-128, objects packed', { compress: true, objstm: true, encrypt: 'aes' }]].forEach(function (c) {
  var r = D.readPdf(W.manuscript(c[1]));
  eq('PDF ' + c[0] + ': the list after References, continuation lines indented, without the running head, page number or caption', [r.heading, r.layout, r.refs], ['References', 'auto', LIST]);
});
eq('read() knows a PDF by its first bytes', D.read(W.manuscript({}), 'x.bin').refs, LIST);
// every filter a PDF may use for text, written by tests/pdf-writer.js's own encoders (checked against pdf.js in tests/pdf-oracle.test.js)
[['LZW'], ['A85'], ['AHx'], ['RL'], ['A85', 'Fl'], ['AHx', 'LZW']].forEach(function (f) {
  [false, true].forEach(function (pred) {
    var label = 'PDF with ' + f.join(' over ') + (pred ? ', PNG row predictors' : '');
    eq(label + ': the list as from a plain file', D.readPdf(W.manuscript({ filters: f, predictor: pred })).refs, LIST);
    eq(label + ', objects packed: the same', D.readPdf(W.manuscript({ filters: f, predictor: pred, objstm: true })).refs, LIST);
  });
});
eq('PDF with Flate and PNG row predictors, encrypted with RC4: the same', D.readPdf(W.manuscript({ compress: true, predictor: true, encrypt: 'rc4' })).refs, LIST);
// a long page: LZW codes widen to 12 bits and the table is cleared and begun again mid-stream
var longLines = []; for (var li = 0; li < 90; li++) longLines.push({ x: 72, y: 780 - li * 8, size: 7, text: (li ? '' : 'References ') + 'Abel, A. (' + (1900 + li) + ') A title about kernite number ' + (li * 7919 % 1000) + '. J Chem ' + li + ', ' + li + '.' });
var longPlain = D.readPdf(W.pdf({ pages: [{ lines: longLines }] })), longLzw = D.readPdf(W.pdf({ pages: [{ lines: longLines }], filters: ['LZW'], predictor: true }));
eq('a long LZW stream through a table reset reads as the plain one', [longLzw.refs.length > 80, longLzw.refs], [true, longPlain.refs]);


// Encryption that needs a password, or that is not read here, is refused in words
var locked = W.manuscript({ encrypt: 'rc4' }).toString('latin1').replace(/\/U <([0-9a-f]+)>/, function (m, h) { return '/U <' + h.replace(/./g, '0') + '>'; });
throws('a PDF that needs a password is refused', function () { D.readPdf(Buffer.from(locked, 'latin1')); }, /needs a password/);
var aes256 = W.manuscript({ encrypt: 'aes' }).toString('latin1').replace('/V 4 /R 4', '/V 5 /R 6');
throws('AES-256 is refused by name', function () { D.readPdf(Buffer.from(aes256, 'latin1')); }, /AES-256/);
throws('a certificate handler is refused', function () { D.readPdf(Buffer.from(W.manuscript({ encrypt: 'rc4' }).toString('latin1').replace('/Filter /Standard', '/Filter /Adobe.PubSec'), 'latin1')); }, /certificate/);
throws('not a PDF', function () { D.readPdf(Buffer.from('hello')); }, /not a PDF/);
throws('neither a zip nor a PDF', function () { D.read(Buffer.from('hello'), 'notes.txt'); }, /^this is neither a Word document nor a PDF$/);
throws('a .docx that is not a zip says so, and no error names the file', function () { D.read(Buffer.from('hello'), 'secret-draft.docx'); }, /^not a zip file$/);
throws('a .pdf that is not a PDF says so', function () { D.read(Buffer.from('hello'), 'secret-draft.pdf'); }, /^not a PDF file$/);

// No text, no heading
var line = function (y, text, o) { return Object.assign({ x: 72, y: y, size: 9, text: text }, o || {}); };
throws('a scanned page has no text to read', function () { D.readPdf(W.pdf({ pages: [{ lines: [], raw: 'q 100 0 0 100 0 0 cm 0 0 1 1 re f Q' }] })); }, /no text to read/);
throws('prose with no References heading is refused', function () { D.readPdf(W.pdf({ pages: [{ lines: [line(700, 'Diamond thermometers reach sub-degree precision in living cells,'), line(689, 'as Kucsko et al. (2013) showed, and attention models changed'), line(678, 'machine translation (Vaswani et al. 2017) in a few years.')] }] })); }, /no References heading, and the text does not read as a reference list/);
var bare = D.readPdf(W.pdf({ pages: [{ lines: [line(700, 'Kucsko, G. and Lukin, M. D. (2013) Nanometre-scale thermometry'), line(689, 'in a living cell. Nature, 500, 54-58.', { x: 81 }), line(678, 'Vaswani, A. and Shazeer, N. (2017) Attention is all you need.'), line(667, 'NeurIPS, 30, 5998-6008.', { x: 81 })] }] }));
eq('a PDF that is only a list, with a hanging indent, is read whole', [bare.heading, bare.refs.length], ['', 4]);

// Layout: two columns, each with its own left edge; a gap wider than the line spacing is a blank line
var cols = D.readPdf(W.pdf({ pages: [{ lines: [line(720, 'References'), line(700, 'Abel, A. (2001) First title that runs'), line(689, 'onto a second line. J 1, 1.', { x: 81 }), line(678, 'Baker, B. (2002) Second. J 2, 2.'),
  line(720, 'Cole, C. (2003) Third title that runs', { x: 320 }), line(709, 'onto its own second line. J 3, 3.', { x: 329 }), line(698, 'Dunn, D. (2004) Fourth. J 4, 4.', { x: 320 })] }] }));
eq('two columns: each column\'s hanging indent is read from its own edge', cols.refs, ['Abel, A. (2001) First title that runs', ' onto a second line. J 1, 1.', 'Baker, B. (2002) Second. J 2, 2.', 'Cole, C. (2003) Third title that runs', ' onto its own second line. J 3, 3.', 'Dunn, D. (2004) Fourth. J 4, 4.']);
var spaced = D.readPdf(W.pdf({ pages: [{ lines: [line(720, 'References'), line(700, 'Abel, A. (2001) First title. J 1, 1.'), line(689, 'Its second line. 2001.'), line(670, 'Baker, B. (2002) Second. J 2, 2.'), line(659, 'Its second line too. 2002.'), line(640, 'Cole, C. (2003) Third. J 3, 3.')] }] }));
eq('entries set apart by space, not indent: a blank line between them', spaced.refs, ['Abel, A. (2001) First title. J 1, 1.', 'Its second line. 2001.', '', 'Baker, B. (2002) Second. J 2, 2.', 'Its second line too. 2002.', '', 'Cole, C. (2003) Third. J 3, 3.']);
var perLine = D.readPdf(W.pdf({ pages: [{ lines: [line(720, 'References'), line(700, 'Abel, A. (2001) First. J Chem 1, 1.'), line(689, 'Baker, B. (2002) Second. J Chem 2, 2.'), line(678, 'Cole, C. (2003) Third. J Chem 3, 3.'),
  line(652, 'Dunn, D. (2004) Fourth. J Chem 4, 4.'), line(641, 'Ernst, E. (2005) Fifth. J Chem 5, 5.')] }] }));
eq('one entry per line, flush: a wider gap between two of them is no blank line (it would join the lines either side)', perLine.refs, ['Abel, A. (2001) First. J Chem 1, 1.', 'Baker, B. (2002) Second. J Chem 2, 2.', 'Cole, C. (2003) Third. J Chem 3, 3.', 'Dunn, D. (2004) Fourth. J Chem 4, 4.', 'Ernst, E. (2005) Fifth. J Chem 5, 5.']);

// The section's end, and what floats into it
var ends = D.readPdf(W.pdf({ pages: [{ lines: [line(720, 'References'), line(700, 'Abel, A. (2001) First. J 1, 1.'), line(689, 'Table 1. Unit-cell parameters of kernite'), line(678, 'a [Å] 15.6 b [Å] 9.1'), line(667, 'Baker, B. (2002) Second. J 2, 2.'),
  line(656, 'A line in another size: a label from a figure, 2001', { size: 12 }), line(645, 'Cole, C. (2003) Third. J 3, 3.'), line(625, 'This manuscript was handled by Associate Editor A. Editor.'), line(614, 'Dunn, D. (2004) Not a reference of this paper. J 4, 4.')] }] }));
eq('a table floating into the list is skipped to the next reference; a line in another size is dropped; the editor\'s note ends the list', ends.refs, ['Abel, A. (2001) First. J 1, 1.', 'Baker, B. (2002) Second. J 2, 2.', 'Cole, C. (2003) Third. J 3, 3.']);
var next = D.readPdf(W.pdf({ pages: [{ lines: [line(720, 'References'), line(700, 'Abel, A. (2001) First. J 1, 1.'), line(680, 'Appendix', { size: 12 }), line(660, 'Further text of the appendix, 2020.')] }] }));
eq('the next section heading ends the list', next.refs, ['Abel, A. (2001) First. J 1, 1.']);
[['letter-spaced', 'R E F E R E N C E S'], ['small capitals read apart', 'rE f E r E n C E s'], ['numbered', '7. References'], ['Russian', 'Литература'], ['German', 'Literaturverzeichnis'], ['spaced "References cited"', 're F e re n c e s c i t e D']].forEach(function (h) {
  var r = D.readPdf(W.pdf({ pages: [{ lines: [line(720, 'Body text that cites Abel (2001) in passing, at length.'), line(700, h[1], { font: 'F2' }), line(680, 'Abel, A. (2001) First. J 1, 1.')] }] }));
  eq('a heading ' + h[0] + ' starts the list', r.refs, ['Abel, A. (2001) First. J 1, 1.']);
});

// Pages and text that run another way, and text a figure hides
var turned = D.readPdf(W.pdf({ pages: [{ rotate: 180, lines: [line(720, 'References'), line(700, 'Abel, A. (2001) First. J 1, 1.')] }] }));
eq('a page with /Rotate 180 over upright text is read the way its text runs', turned.refs, ['Abel, A. (2001) First. J 1, 1.']);
var stamp = D.readPdf(W.pdf({ pages: [{ lines: [line(720, 'References'), line(700, 'Abel, A. (2001) First. J 1, 1.')], raw: 'BT /F1 8 Tf 0 1 -1 0 590 100 Tm (Downloaded 2024) Tj ET' }] }));
eq('a sideways download stamp in the margin is not read', stamp.refs, ['Abel, A. (2001) First. J 1, 1.']);
var fig = D.readPdf(W.pdf({ pages: [{ lines: [line(720, 'References'), line(700, 'Abel, A. (2001) First. J 1, 1.')], forms: [{ bbox: [0, 0, 612, 300], lines: [line(500, 'Baker, B. (2002) Text of the figure\'s source page, outside its box. J 2, 2.'), line(200, 'Cole, C. (2003) Text inside the figure. J 3, 3.')] }] }] }));
eq('a figure drawn from another PDF\'s page shows only what is inside its box', fig.refs, ['Abel, A. (2001) First. J 1, 1.', 'Cole, C. (2003) Text inside the figure. J 3, 3.']);

// Glyph-level detail: spacing, scripts, accents set as glyphs of their own, ligatures, bold struck twice
var raw = function (ops) { return D.pdfPages(W.pdf({ pages: [{ lines: [], raw: ops }] }))[0].lines.map(function (l) { return l.text; }); };
eq('a gap wider than a fraction of a space is a space; kerning is not', raw('BT /F1 10 Tf 72 700 Td [(Ker) 30 (ning) -400 (gap)] TJ ET'), ['Kerning gap']);
eq('a raised smaller run is a superscript, a lowered one a subscript', raw('BT /F1 10 Tf 72 700 Td (Fe) Tj ET BT /F1 6 Tf 82 704 Td (3+) Tj ET BT /F1 10 Tf 90 700 Td ( and SiO) Tj ET BT /F1 6 Tf 135 697 Td (2) Tj ET'), ['Fe³⁺ and SiO₂']);
eq('a subscript set under a superscript stays on the line (Fe²⁺₂)', raw('BT /F1 10 Tf 72 700 Td (Fe) Tj ET BT /F1 6 Tf 82 704 Td (2+) Tj ET BT /F1 6 Tf 82 697 Td (2) Tj ET BT /F1 10 Tf 89 700 Td (Al) Tj ET'), ['Fe²⁺₂Al']);
eq('an accent drawn after its letter joins it (Krämer)', raw('BT /F1 10 Tf 72 700 Td (Kra) Tj ET BT /F1 10 Tf 82 700 Td (\\250) Tj ET BT /F1 10 Tf 87 700 Td (mer, V.) Tj ET'), ['Krämer, V.']);
eq('an accent drawn before its letter joins the next one (Zieliński)', raw('BT /F1 10 Tf 72 700 Td (Zieli) Tj ET BT /F1 10 Tf 97 700 Td (\\264) Tj ET BT /F1 10 Tf 97 700 Td (nski, G.) Tj ET'), ['Zieliński, G.']);
eq('a ligature glyph is its letters', D.pdfPages(W.pdf({ pages: [{ lines: [line(700, '\uFB01eld work', { font: 'F2' })] }] }))[0].lines[0].text, 'field work');
eq('bold faked by striking the text twice is read once', raw('BT /F1 10 Tf 72 700 Td (Bold) Tj ET BT /F1 10 Tf 72.2 700 Td (Bold) Tj ET BT /F1 10 Tf 95 700 Td (text) Tj ET'), ['Bold text']);
eq('a doubled narrow letter set glyph by glyph, closer than the font\'s width, is two letters, not bold', raw('BT /F1 12 Tf 72 700 Td (El) Tj ET BT /F1 12 Tf 81.5 700 Td (l) Tj ET BT /F1 12 Tf 85 700 Td (iott) Tj ET'), ['Elliott']);
eq('negative character spacing before an explicit move opens no false gap (small capitals)', raw('BT /F1 10 Tf -0.3 Tc 72 700 Td (A) Tj 5 0 Td (T) Tj 5 0 Td (O) Tj ET'), ['ATO']);

// A damaged file never hangs or throws anything but an Error with words
var good = W.manuscript({ compress: true, objstm: true }), errs = 0, t0 = Date.now();
for (var k = 0; k < 300; k++) {
  var bad = Buffer.from(good);
  seed = (seed * 1103515245 + 12345) >>> 0;
  if (k % 3 === 0) bad = bad.subarray(0, seed % bad.length); // truncated
  else for (var j = 0; j < 1 + (k % 7); j++) { seed = (seed * 1103515245 + 12345) >>> 0; bad[seed % bad.length] = seed >>> 24; } // bytes overwritten
  try { D.readPdf(bad); } catch (e) { if (!(e instanceof Error) || !e.message) errs++; }
}
eq('300 damaged copies: each is read or refused in words, in good time', [errs, Date.now() - t0 < 20000], [0, true]);
var z = zlib.deflateSync(Buffer.alloc(70 * 1024 * 1024, 32)); // 70 MB of spaces, 70 kB packed
var bomb = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Filter /FlateDecode /Length ' + z.length + ' >>\nstream\n', 'latin1'), z, Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1')]);
throws('a stream that would unpack past 64 MB is refused', function () { D.readPdf(bomb); }, /unpacks to more than 64 MB, which no manuscript does/);

// ---------- a Word manuscript ----------
var docx = fs.readFileSync(path.join(__dirname, 'fixtures', 'manuscript.docx'));
var wr = D.read(docx, 'manuscript.docx');
eq('the Word manuscript gives up the two paragraphs after References, one reference each', [wr.heading, wr.layout, wr.refs.length, /^Kucsko, G\., Maurer/.test(wr.refs[0]) && /^Vaswani A/.test(wr.refs[1])], ['References', 'lines', 2, true]);
throws('a file that is not a zip', function () { D.readDocx(Buffer.from(zlib.deflateRawSync(Buffer.alloc(0)))); }, /not a zip file/);
eq('isDocument knows the two kinds by name', ['a.pdf', 'b.DOCX', 'c.doc', 'd.ris'].map(D.isDocument), [true, true, false, false]);
eq('with no heading, only paragraphs that open like a reference are taken, not a letter\'s prose that mentions a year', D.referenceSection(['Reviewer: Dr A. Example, Associate Editor, 3 March 2026', 'Lines 40-41: probably "collected DURING 1990-1995"', 'The mineral was approved in 2004 and described only in a poster in 2008.', 'Abel, A. and Baker, B. (2008) A new sulfate. Abstract, Conference 2008, 1-2.', 'Smith JA, Jones B. A title. Journal. 2001;3:4-5.'].map(function (t) { return { text: t, style: '' }; })).refs.map(function (t) { return t.slice(0, 7); }), ['Abel, A', 'Smith J']);
eq('referenceSection reads a numbered or Roman heading', ['3. References', 'IV. Literature cited'].map(function (h) { return D.referenceSection([{ text: h, style: '' }, { text: 'Abel, A. (2001) First. J 1, 1.', style: '' }]).refs.length; }), [1, 1]);

// A proposal's list ends at a section in capitals, and a table's "Reference" column after it is not the list's heading
var prop = W.pdf({ pages: [{ lines: [{ x: 72, y: 700, size: 10, text: 'Measured as before (Abel 2001).' }, { x: 72, y: 680, size: 10, text: 'REFERENCES' },
  { x: 72, y: 666, size: 10, text: 'Abel, A. (2001) First paper. Journal, 1, 1-2.' }, { x: 72, y: 652, size: 10, text: 'Baker, B. (2002) Second paper. Journal, 2, 3-4.' },
  { x: 72, y: 624, size: 10, text: "AUTHORS' REMARKS" }, { x: 72, y: 610, size: 10, text: 'Nil.' }] },
  { lines: [{ x: 72, y: 700, size: 10, text: 'Table 9. Comparison' }, { x: 72, y: 686, size: 10, text: 'Reference' }, { x: 72, y: 672, size: 10, text: 'Yang et al. (2018)' }, { x: 72, y: 658, size: 10, text: 'This study' }] }] });
var pr = D.readPdf(prop);
eq('the heading a reference follows wins over a table\'s Reference column, and the list stops at AUTHORS\' REMARKS', [pr.heading, pr.refs], ['REFERENCES', ['Abel, A. (2001) First paper. Journal, 1, 1-2.', 'Baker, B. (2002) Second paper. Journal, 2, 3-4.']]);

// ---------- the viewer: a Word manuscript laid out (tests/docx-writer.js writes one the ways Word does) ----------
var X = require('./docx-writer.js'), rich = X.manuscript(), L = D.docxLayout(rich);
var runText = function (b) { return (b.runs || []).map(function (r) { return r.text !== undefined ? r.text : r.tab ? '\t' : r.img !== undefined ? '[img]' : ''; }).join(''); };
var paras = L.blocks.filter(function (b) { return b.t === 'p'; });
eq('the page is the section\'s A4 with its margins, in points', [L.page.w, L.page.h, L.page.left, L.page.top], [595.3, 841.9, 56.7, 56.7]);
eq('a style takes its base\'s properties and adds its own (Heading1 on Normal on the defaults)', [paras[0].runs[0].r.b, paras[0].runs[0].r.size, paras[0].runs[0].r.font, paras[0].p.before, paras[0].p.line], [true, 14, 'Times New Roman', 12, { mult: 2 }]);
eq('a run keeps its italics and subscript; hidden and deleted text are left out', runText(paras[2]) + '|' + paras[2].runs.filter(function (r) { return r.r && (r.r.i || r.r.va); }).map(function (r) { return r.text + ':' + (r.r.i ? 'i' : r.r.va); }).join(','), 'Kernite\tis Na2B borax|2:sub, borax:i');
eq('a footnote mark is numbered in the text\'s order, and its note is kept by that number', [paras[1].runs[1].note, paras[1].runs[1].n, paras[1].runs[1].r.va, runText(L.footnotes[1][0])], ['footnote', 1, 'sup', '1 Kernite is mined at Boron, California.']);
eq('the reference list carries Word\'s numbers as labels, in a hanging indent, outside the text', paras.slice(-3).map(function (b, i) { return [b.label.text, b.p.left, b.p.first, runText(b) === X.REFS[i]]; }), [['1.', 36, -18, true], ['2.', 36, -18, true], ['3.', 36, -18, true]]);
var tbl = L.blocks.filter(function (b) { return b.t === 'table'; })[0];
eq('a table keeps its grid, its rules and a cell merged down', [tbl.cols, tbl.border, tbl.rows.map(function (r) { return r.map(function (c) { return c.vm + ':' + runText(c.blocks[0]); }).join(' | '); })], [[100, 150], true, ['restart:Phase | :Kernite', 'continue: | :Borax']]);
var img = paras.filter(function (b) { return b.runs.some(function (r) { return r.img !== undefined; }); })[0].runs[0];
eq('a picture is its part in the file, with its size in points', [img.img, img.w, img.h, L.media[img.img].mime, L.media[img.img].bytes.length], ['word/media/image1.png', 72, 36, 'image/png', X.PNG.length]);
var bi = L.blocks.map(function (b) { return b.t; }).indexOf('break');
eq('where Word last broke the page, the paragraph is split and goes on, without its indent, on the next', [L.paged, runText(L.blocks[bi - 1]), runText(L.blocks[bi + 1]), !!L.blocks[bi + 1].cont], [true, 'The crystals were grown at 300 K and ', 'measured the next day.', true]);
var plain = D.docxLayout(docx);
eq('a file with no styles gets Word\'s own defaults and is not paged', [plain.paged, plain.page.w, plain.blocks[0].runs[0].r.size, plain.blocks[0].runs[0].r.font], [false, 612, 10, 'Times New Roman']);
var lists = D.docxLayout(X.docx({ body: [['0', '1'], ['1', '1'], ['1', '1'], ['0', '1'], ['0', '2']].map(function (x) { return '<w:p><w:pPr><w:numPr><w:ilvl w:val="' + x[0] + '"/><w:numId w:val="' + x[1] + '"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>'; }).join(''),
  numbering: '<w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="8"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val=""/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="7"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="8"/></w:num>' }));
eq('list numbers count by level, a deeper level starts again, and a Symbol bullet is a bullet', lists.blocks.map(function (b) { return b.label.text; }), ['I.', 'I.a)', 'I.b)', 'II.', '•']);
var TL = D.docxLayout(X.tables()), tp = TL.blocks.filter(function (b) { return b.t === 'p'; }), tt = TL.blocks.filter(function (b) { return b.t === 'table'; })[0];
eq('each section keeps its own page, and each block names its section (a landscape table after portrait text)', [TL.sections.map(function (s) { return [s.w, s.h]; }), tp[1].sec, tt.sec, TL.page.w], [[[612, 792], [792, 612]], 0, 1, 792]);
eq('a paragraph\'s tab stops, in points, with their alignment', tp[1].p.tabs, [{ pos: 162, val: 'left' }, { pos: 450, val: 'right' }]);
eq('a style\'s tab stops are kept, a paragraph\'s added, and a "clear" removes one', D.docxLayout(X.docx({ styles: '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="center" w:pos="1440"/></w:tabs></w:pPr></w:style>', body: '<w:p><w:pPr><w:tabs><w:tab w:val="clear" w:pos="720"/><w:tab w:val="decimal" w:pos="2880"/></w:tabs></w:pPr><w:r><w:t>x</w:t></w:r></w:p>' })).blocks[0].p.tabs, [{ pos: 72, val: 'center' }, { pos: 144, val: 'decimal' }]);
eq('a fixed table says so, and keeps Word\'s cell margins', [tt.fixed, tt.pad, tt.cols], [true, { top: 0, right: 5.4, bottom: 0, left: 5.4 }, [20, 600]]);
var sized = D.docxLayout(X.docx({ styles: '<w:style w:type="table" w:styleId="Grid"><w:tblPr><w:tblCellMar><w:left w:w="144" w:type="dxa"/><w:right w:w="72" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>',
  body: '<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblCellSpacing w:w="15" w:type="dxa"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
    '<w:tr><w:trPr><w:trHeight w:val="567" w:hRule="exact"/></w:trPr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcMar><w:left w:w="0" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' })).blocks[0];
var mc = function (t, pr) { return '<w:tc><w:tcPr>' + (pr || '') + '</w:tcPr><w:p><w:r>' + (t ? '<w:t>' + t + '</w:t>' : '<w:lastRenderedPageBreak/>') + '</w:r></w:p></w:tc>'; };
var merged = D.docxLayout(X.docx({ body: '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>' + mc('Merged', '<w:vMerge w:val="restart"/>') + mc('A1') + '</w:tr><w:tr>' + mc('A2', '<w:vMerge/>') + mc('A3') + '</w:tr>' +
  '<w:tr>' + mc('', '<w:vMerge/>') + mc('B1') + '</w:tr><w:tr>' + mc('B3', '<w:vMerge/>') + mc('B2') + '</w:tr></w:tbl><w:p/>' })).blocks.filter(function (b) { return b.t === 'table'; });
eq('a merged cell carried over a page break Word recorded starts again on the next page, so the row\'s other cells keep their columns', merged.map(function (t) { return t.rows.map(function (r) { return r.map(function (c) { return c.vm; }); }); }), [[['restart', ''], ['continue', '']], [['restart', ''], ['continue', '']]]);
eq('a row\'s height; cell margins from the table style, the table and the cell; the spacing between cells', [sized.heights, sized.pad, sized.rows[1][0].pad, sized.gap], [[28.35, 0], { top: 2, right: 3.6, bottom: 3, left: 7.2 }, { top: 2, right: 3.6, bottom: 3, left: 0 }, 0.75]);
var tstyled = D.docxLayout(X.docx({ styles: '<w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="278" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:rPr><w:sz w:val="18"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>',
  body: '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:r><w:t>c</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>d</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' })).blocks;
var symRun = '<w:r><w:t xml:space="preserve">Mean </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr><w:t>\uF073 \uF0B1 m</w:t></w:r><w:r><w:t xml:space="preserve"> and B</w:t></w:r><w:r><w:sym w:font="Wingdings" w:char="F0E0"/></w:r><w:r><w:t>A</w:t></w:r>';
var symL = D.docxLayout(X.docx({ body: '<w:p>' + symRun + '</w:p>' })).blocks[0];
eq('Symbol and Wingdings characters are the ones they stand for (σ ± μ, an arrow), set in the paragraph\'s font', [symL.runs.map(function (r) { return r.text; }).join(''), symL.runs[1].r.font], ['Mean σ ± μ and B→A', '']);
eq('the reference reader decodes them too', D.read(X.docx({ body: '<w:p><w:r><w:t>References</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Smith, J. (2020) A study of the </w:t></w:r>' + symRun.replace('Mean ', '') + '<w:r><w:t xml:space="preserve"> phase. Journal, 1, 2.</w:t></w:r></w:p>' }), 'x.docx').refs, ['Smith, J. (2020) A study of the σ ± μ and B→A phase. Journal, 1, 2.']);
var cellP = function (t, k) { return t.rows[0][0].blocks[k]; };
eq('a table style\'s spacing is its cells\' (not the body\'s), a paragraph style\'s own wins over it, and a table with no style has the default\'s', [cellP(tstyled[0], 0).p.after, cellP(tstyled[0], 0).p.line, cellP(tstyled[0], 1).p.after, tstyled[1].p.after, tstyled[1].runs[0].r.size, cellP(tstyled[2], 0).runs[0].r.size], [0, { mult: 1 }, 6, 8, 10, 9]);
var CL = D.docxLayout(X.cells()), ct = CL.blocks.filter(function (b) { return b.t === 'table'; })[0], one = { w: 0.5, color: '#000000', style: 'solid' };
eq('a cell\'s own rules, its centring, and a table AutoFit to its contents (its grid only a cache)', [ct.fit, ct.rows[0][1].borders, ct.rows[1][1].borders, ct.rows[1][1].valign, ct.rows[0][0].valign], [true, { top: one, bottom: one }, { bottom: one }, 'middle', 'top']);
var styled = D.docxLayout(X.docx({ styles: '<w:style w:type="table" w:styleId="TableGrid"><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:insideH w:val="dashed" w:sz="12" w:color="FF0000"/></w:tblBorders></w:tblPr></w:style>',
  body: '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblBorders><w:top w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' })).blocks[0];
eq('a table style\'s rules, a table\'s own "nil" overriding one, and sized cells keep the grid', [styled.borders, styled.fit], [{ top: null, insideH: { w: 1.5, color: '#FF0000', style: 'dashed' } }, false]);
eq('a table that runs over two pages keeps its grid, so its halves agree', D.docxLayout(X.docx({ body: '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:lastRenderedPageBreak/><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' })).blocks.filter(function (b) { return b.t === 'table'; }).map(function (t) { return !!t.fit; }), [false, false]);
eq('XML: entities, CDATA and a stray closing tag', (function () { var t = D.xmlTree('<a x="1&amp;2"><b>&lt;&#233;&#x4E2D;</b></c><![CDATA[<raw>]]></a>'); return [t.a.x, t.c[0].c[0], t.c[1]]; })(), ['1&2', '<é中', '<raw>']);
throws('a Word file with no document part', function () { D.docxLayout(X.zip([{ name: 'word/other.xml', data: '<x/>' }])); }, /no word\/document\.xml/);

// ---------- the viewer: each entry of the list found in the page's text, and the citations that name them ----------
var ents = ['Smith, J. (2019a). The first finding. Journal, 1, 1–2.', 'Smith, J. (2019b). The second. Journal, 2, 3.', 'Lee, A., & Kim, B. (2020). Joint work. Other Journal, 3, 4.', 'van der Berg, C. (2018). A Dutch name. J, 4, 5.', 'World Health Organization. (2021). Report on things. Geneva.'];
var page = 'Body text here.\nReferences\nSmith, J. (2019a). The ﬁrst find-\ning. Journal, 1, 1–2.\nSmith, J. (2019b). The second. Journal, 2, 3.\nLee, A., & Kim, B. (2020). Joint work. Other Journal, 3, 4.\nWorld Health Organization. (2021). Report on things. Geneva.\n';
var at = D.locateEntries(ents, page, 0);
eq('an entry is found however the page spaces, hyphenates or ligatures it, and keeps its closing full stop', page.slice(at[0].start, at[0].end), 'Smith, J. (2019a). The ﬁrst find-\ning. Journal, 1, 1–2.');
eq('an entry the page does not hold is null; the others are still found, each ending where the next starts', [at.map(function (x) { return !!x; }), at[2].end <= at[4].start, page.slice(at[4].start, at[4].end)], [[true, true, true, false, true], true, 'World Health Organization. (2021). Report on things. Geneva.']);
eq('an entry\'s keys: number, first surname without its initials, year and letter', [D.entryKeys('[12] J. A. Smith, Title, J. 2001.'), D.entryKeys('Vaswani A, Shazeer N. Attention. 2017;30:1.').first, D.entryKeys('van der Berg, C. (2018a). X.').first + ' ' + D.entryKeys('van der Berg, C. (2018a). X.').suffix, D.entryKeys('Smith, J. (n.d.). Undated.').year],
  [{ num: 12, first: 'smith', alt: '', authors: 'jasmithtitlej', year: '2001', suffix: '' }, 'vaswani', 'vanderberg a', 'nd']);
var cites = function (text) { return D.findCitations(text, ents).map(function (c) { return text.slice(c.start, c.end) + '=' + c.refs.join(','); }); };
eq('author and year: parenthetical, narrative, a list split at its semicolons, and the same author again', cites('As Smith (2019a) showed (Lee & Kim, 2020; Smith 2019a, 2019b), and van der Berg (2018) agreed.'), ['Smith (2019a)=0', 'Lee & Kim, 2020=2', 'Smith 2019a=0', '2019b=1', 'van der Berg (2018)=3']);
eq('"et al.", a possessive, an organisation cited by its last word, and "Smith 2019" naming both of that year', cites('Lee et al. (2020) and Smith\'s (2019) view; see the Organization (2021).'), ['Lee et al. (2020)=2', 'Smith\'s (2019)=0,1', 'Organization (2021)=4']);
var ment = ['Brese, N.E. and O\u2019Keeffe, M. (1991) Bond-valence parameters.', 'Kravchenko S.M., Pokrovsky B.G. (1995) A title.', 'Bruker AXS (2022) APEX4. Madison.', 'Ledeneva N.V. Mineralogy of a deposit. Moscow, 2004.'];
var mt = 'parameters after Brese and O\u2019Keeffe (1991), as found (Kravchenko, Pokrovsky, 1995) with (Bruker AXS, 2022) and (Ledeneva, 2004).';
eq('authors after a word ending like a particle ("after Brese"), joined by commas alone, an organisation in two words, and a surname before its initials', D.findCitations(mt, ment).map(function (c) { return mt.slice(c.start, c.end) + '=' + c.refs.join(','); }), ['Brese and O\u2019Keeffe (1991)=0', 'Kravchenko, Pokrovsky, 1995=1', 'Bruker AXS, 2022=2', 'Ledeneva, 2004=3']);
eq('a capitalised particle is part of the second author\'s name ("Dutta and Del Barco 1988")', D.findCitations('rings (Dutta and Del Barco 1988; Dutta et al. 1991)', ['Dutta, P.K. and Del Barco, B. (1988) Raman spectroscopy of zeolites. J Phys Chem, 92, 354.', 'Dutta, P.K., Shieh, D.C. and Puri, M. (1991) Zeolites. J Phys Chem, 95, 1.']).map(function (c) { return c.refs.join(','); }), ['0', '1']);
eq('an entry written given name first is cited by its surname ("Leticia M. Torres-Martinez")', D.findCitations('as shown (Torres-Martinez et al., 1984).', ['Leticia M. Torres-Martinez, J. Smith and K. Lee (1984) A title. Journal, 1, 2.']).map(function (c) { return c.refs.join(','); }), ['0']);
eq('a place before the author is not an author ("in Russia, Smith (2019a)")', cites('as found in Russia, Smith (2019a) and Lee (2020) agreed'), ['Smith (2019a)=0', 'Lee (2020)=2']);
eq('no citation: a year no entry has, a name no entry has, a table or a month', cites('In 2020 we (Jones, 2019) used Table 2019 and May 2019 data.'), []);
var nent = ['1. Abel A. First. 2001.', '2. Baker B. Second. 2002.', '3. Cole C. Third. 2003.', '4. Dean D. Fourth. 2004.'];
var nt = 'As shown [1], and later [2–4] and [1, 3]; superscripts too.1,2 and Fe3+ stays [9].';
eq('numbers cite a numbered list: one, a range and a list in brackets, a superscript, and never a number past the list', D.findCitations(nt, nent, { sups: [{ start: nt.indexOf('1,2'), end: nt.indexOf('1,2') + 3 }] }).map(function (c) { return nt.slice(c.start, c.end) + '=' + c.refs.join(','); }), ['[1]=0', '[2–4]=1,2,3', '[1, 3]=0,2', '1,2=0,1']);
eq('beside an author-and-year list, a lone bracketed number is not a citation', D.findCitations('Smith (2019a) and the complex [2] and [3].', ents).map(function (c) { return c.refs.join(','); }), ['0']);
var st = 'The cell is 1234.5 Å3 and Fe3 and (UO2)2 but the result is precise3 and known.4';
var supAt = function (w) { var i = st.indexOf(w) + w.length - 1; return { start: i, end: i + 1 }; };
eq('a superscript number cites after a word or its full stop, never after a unit, a symbol or a bracket (Å³, Fe³, (UO₂)₂)', D.findCitations(st, nent, { sups: [supAt('Å3'), supAt('Fe3'), supAt('(UO2)2'), supAt('precise3'), supAt('known.4')] }).map(function (c) { return st.slice(c.start, c.end) + '=' + c.refs.join(','); }), ['3=2', '4=3']);
eq('an unnumbered list is cited by its order when the text cites by number', D.findCitations('Thermometry [1] and attention [2–3].', X.REFS).map(function (c) { return c.refs.join(','); }), ['0', '1,2']);

console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
