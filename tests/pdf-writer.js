// Writes small PDFs for the tests, built the ways real ones are: text in a simple font (WinAnsi, every glyph 500/1000 em wide) or a
// composite one (Identity-H glyph numbers with a ToUnicode map), streams compressed or not, objects packed in an object stream with an
// xref stream, form XObjects, /Rotate, and encryption as publishers set it (RC4 40-bit or AES-128, empty user password).  The
// encryption uses Node's MD5 and AES and its own RC4, not documents.js, so a test of the reader is not a test of itself.
//   pdf({ pages: [{ lines: [{ x, y, size, text, font: 'F1' | 'F2' }], raw: 'extra content', rotate, forms: [...] }], compress, objstm, encrypt: 'rc4' | 'aes',
//         filters: ['A85', 'Fl'], predictor: true })
// filters names a stream's /Filter chain in the order a reader undoes it (compress is ['Fl']); each encoder is written here, from the
// PDF reference, not taken from documents.js.  predictor runs the PNG row filters (all five, row by row) before Flate or LZW.
var zlib = require('zlib'), crypto = require('crypto');
var FILTER_NAMES = { Fl: '/FlateDecode', LZW: '/LZWDecode', A85: '/ASCII85Decode', AHx: '/ASCIIHexDecode', RL: '/RunLengthDecode' };
function hexEncode(b) { return Buffer.from(b.toString('hex').toUpperCase().replace(/(.{64})/g, '$1\n') + '>', 'latin1'); } // a line break every 32 bytes, as real files have
function a85Encode(b) {
  var out = '', i, group = function (bytes, keep) { var v = bytes.readUInt32BE(0), c = ''; for (var k = 0; k < 5; k++) { c = String.fromCharCode(33 + v % 85) + c; v = Math.floor(v / 85); } return c.slice(0, keep); };
  for (i = 0; i + 4 <= b.length; i += 4) out += b.readUInt32BE(i) === 0 ? 'z' : group(b.subarray(i, i + 4), 5);
  if (i < b.length) { var t = Buffer.alloc(4); b.copy(t, 0, i); out += group(t, b.length - i + 1); }
  return Buffer.from(out.replace(/(.{75})/g, '$1\n') + '~>', 'latin1');
}
function rlEncode(b) { // runs of two or more equal bytes as (257 - n) and the byte, the rest as (n - 1) and n literal bytes, then 128
  var out = [], i = 0;
  while (i < b.length) {
    var j = i; while (j + 1 < b.length && b[j + 1] === b[i] && j - i < 127) j++;
    if (j > i) { out.push(257 - (j - i + 1), b[i]); i = j + 1; continue; }
    var start = i; while (i < b.length && i - start < 128 && !(i + 1 < b.length && b[i + 1] === b[i])) i++;
    out.push(i - start - 1); for (var k = start; k < i; k++) out.push(b[k]);
  }
  out.push(128); return Buffer.from(out);
}
function lzwEncode(b) { // 9 to 12 bit codes, a clear code first and whenever the table fills, EarlyChange 1 (a code wider one code early)
  var out = [], acc = 0, nb = 0, bits = 9, dict, next;
  var emit = function (code) { acc = (acc * (1 << bits)) + code; nb += bits; while (nb >= 8) { nb -= 8; out.push(Math.floor(acc / Math.pow(2, nb)) & 255); acc %= Math.pow(2, nb); } };
  var reset = function () { dict = new Map(); for (var k = 0; k < 256; k++) dict.set(String.fromCharCode(k), k); next = 258; bits = 9; };
  emit(256); reset();
  var w = '';
  for (var i = 0; i < b.length; i++) {
    var c = String.fromCharCode(b[i]), wc = w + c;
    if (dict.has(wc)) { w = wc; continue; }
    emit(dict.get(w)); dict.set(wc, next++);
    if (next >= 4095) { emit(256); reset(); } // the clear code goes out at the current width, before the table is full
    else if (next >= (1 << bits) && bits < 12) bits++; // the reader widens after its table (one entry behind the writer's) reaches 2^bits - 1
    w = c;
  }
  if (w) emit(dict.get(w));
  emit(257); if (nb) out.push((acc * Math.pow(2, 8 - nb)) & 255);
  return Buffer.from(out);
}
function pngRows(b, cols) { // PNG row filters 0-4 in turn, each row tagged with its type; the data padded with spaces to whole rows
  var n = Math.ceil(b.length / cols), data = Buffer.alloc(n * cols, 0x20), out = [], prev = Buffer.alloc(cols);
  b.copy(data);
  for (var r = 0; r < n; r++) {
    var row = data.subarray(r * cols, (r + 1) * cols), t = r % 5; out.push(t);
    for (var i = 0; i < cols; i++) {
      var a = i ? row[i - 1] : 0, up = prev[i], c = i ? prev[i - 1] : 0, pred = 0;
      if (t === 1) pred = a; else if (t === 2) pred = up; else if (t === 3) pred = (a + up) >> 1;
      else if (t === 4) { var p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out.push((row[i] - pred) & 255);
    }
    prev = row;
  }
  return Buffer.from(out);
}
var ENCODE = { Fl: function (b) { return zlib.deflateSync(b); }, LZW: lzwEncode, A85: a85Encode, AHx: hexEncode, RL: rlEncode };
var PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
function md5(b) { return crypto.createHash('md5').update(b).digest(); }
function rc4(key, data) {
  var s = [], j = 0, i, t, out = Buffer.alloc(data.length);
  for (i = 0; i < 256; i++) s[i] = i;
  for (i = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; t = s[i]; s[i] = s[j]; s[j] = t; }
  i = j = 0;
  for (var k = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; t = s[i]; s[i] = s[j]; s[j] = t; out[k] = data[k] ^ s[(s[i] + s[j]) & 255]; }
  return out;
}
var WIN = { '\u2013': 0x96, '\u2014': 0x97, '\u2018': 0x91, '\u2019': 0x92, '\u201C': 0x93, '\u201D': 0x94, '\u2022': 0x95, '\u2026': 0x85 }; // WinAnsi beyond Latin-1
function literal(s) { return '(' + Array.from(s).map(function (ch) { return WIN[ch] ? String.fromCharCode(WIN[ch]) : ch; }).join('').replace(/[\\()]/g, '\\$&') + ')'; }
function pdf(opts) {
  var objs = [], id = crypto.randomBytes(16);
  var add = function (o) { objs.push(o); return objs.length; }; // o: { body } or { dict, data } (a stream)
  var widths = []; for (var c = 32; c < 256; c++) widths.push(500);
  var f1 = add({ body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 /Widths [' + widths.join(' ') + '] >>' });
  // the composite font: one glyph number per character used, mapped back to Unicode
  var chars = [];
  opts.pages.forEach(function (p) { (p.lines || []).concat([].concat.apply([], (p.forms || []).map(function (f) { return f.lines; }))).forEach(function (l) { if (l.font === 'F2') Array.from(l.text).forEach(function (ch) { if (chars.indexOf(ch) === -1) chars.push(ch); }); }); });
  var hex4 = function (n) { return ('0000' + n.toString(16).toUpperCase()).slice(-4); };
  var utf16 = function (ch) { return Buffer.from(ch, 'utf16le').swap16().toString('hex').toUpperCase(); };
  var cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def /CMapType 2 def\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
    chars.length + ' beginbfchar\n' + chars.map(function (ch, i) { return '<' + hex4(i + 1) + '> <' + utf16(ch) + '>'; }).join('\n') + '\nendbfchar\nendcmap CMapName currentdict /CMap defineresource pop end end';
  var tu = add({ dict: '', data: Buffer.from(cmap, 'latin1') });
  var desc = add({ body: '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /CIDToGIDMap /Identity /FontDescriptor << /Type /FontDescriptor /FontName /Test /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >> /DW 1000 /W [1 [' + chars.map(function () { return 500; }).join(' ') + ']] >>' });
  var f2 = add({ body: '<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H /DescendantFonts [' + desc + ' 0 R] /ToUnicode ' + tu + ' 0 R >>' });
  var show = function (l) {
    var s = l.font === 'F2' ? '<' + Array.from(l.text).map(function (ch) { return hex4(chars.indexOf(ch) + 1); }).join('') + '>' : literal(l.text);
    return 'BT /' + (l.font || 'F1') + ' ' + l.size + ' Tf ' + l.x + ' ' + l.y + ' Td ' + s + ' Tj ET';
  };
  var pagesNum = objs.length + 1; objs.push(null); // the page tree, filled in below
  var kids = [];
  opts.pages.forEach(function (p) {
    var xo = (p.forms || []).map(function (f, i) {
      var n = add({ dict: '/Type /XObject /Subtype /Form /BBox [' + f.bbox.join(' ') + '] /Matrix [' + (f.matrix || [1, 0, 0, 1, 0, 0]).join(' ') + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >> >>', data: Buffer.from(f.lines.map(show).join('\n'), 'latin1') });
      return '/Fm' + i + ' ' + n + ' 0 R';
    });
    var content = (p.lines || []).map(show).concat((p.forms || []).map(function (f, i) { return 'q /Fm' + i + ' Do Q'; })).join('\n') + (p.raw ? '\n' + p.raw : '');
    var cn = add({ dict: '', data: Buffer.from(content, 'latin1') });
    kids.push(add({ body: '<< /Type /Page /Parent ' + pagesNum + ' 0 R /MediaBox [0 0 612 792]' + (p.rotate ? ' /Rotate ' + p.rotate : '') + ' /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >>' + (xo.length ? ' /XObject << ' + xo.join(' ') + ' >>' : '') + ' >> /Contents ' + cn + ' 0 R >>' }));
  });
  objs[pagesNum - 1] = { body: '<< /Type /Pages /Kids [' + kids.map(function (k) { return k + ' 0 R'; }).join(' ') + '] /Count ' + kids.length + ' >>' };
  var catalog = add({ body: '<< /Type /Catalog /Pages ' + pagesNum + ' 0 R >>' });
  // encryption: the key from the empty password (PDF 1.7, algorithms 2, 4 and 5)
  var key = null, encNum = null, aes = opts.encrypt === 'aes';
  if (opts.encrypt) {
    var O = crypto.randomBytes(32), P = -4, Pb = Buffer.alloc(4); Pb.writeInt32LE(P);
    var n = aes ? 16 : 5, h = md5(Buffer.concat([PAD, O, Pb, id]));
    if (aes) for (var r = 0; r < 50; r++) h = md5(h.subarray(0, n));
    key = h.subarray(0, n);
    var U;
    if (aes) { U = rc4(key, md5(Buffer.concat([PAD, id]))); for (r = 1; r <= 19; r++) U = rc4(Buffer.from(key.map(function (b) { return b ^ r; })), U); U = Buffer.concat([U, Buffer.alloc(16)]); }
    else U = rc4(key, PAD);
    encNum = add({ body: aes ? '<< /Filter /Standard /V 4 /R 4 /Length 128 /CF << /StdCF << /CFM /AESV2 /AuthEvent /DocOpen /Length 16 >> >> /StmF /StdCF /StrF /StdCF /O <' + O.toString('hex') + '> /U <' + U.toString('hex') + '> /P ' + P + ' >>'
      : '<< /Filter /Standard /V 1 /R 2 /O <' + O.toString('hex') + '> /U <' + U.toString('hex') + '> /P ' + P + ' >>' });
  }
  var seal = function (num, data) {
    if (!key) return data;
    var k = md5(Buffer.concat([key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0]), aes ? Buffer.from('sAlT') : Buffer.alloc(0)])).subarray(0, Math.min(16, key.length + 5));
    if (!aes) return rc4(k, data);
    var iv = crypto.randomBytes(16), c = crypto.createCipheriv('aes-128-cbc', k, iv);
    return Buffer.concat([iv, c.update(data), c.final()]);
  };
  var chain = opts.filters || (opts.compress ? ['Fl'] : []), COLS = 13;
  var streamOf = function (num, o) {
    var data = Buffer.from(o.data), last = chain[chain.length - 1];
    if (opts.predictor && (last === 'Fl' || last === 'LZW')) data = pngRows(data, COLS);
    for (var i = chain.length - 1; i >= 0; i--) data = ENCODE[chain[i]](data); // the last filter a reader undoes is the first applied
    data = seal(num, data);
    var filt = chain.length ? ' /Filter ' + (chain.length === 1 ? FILTER_NAMES[chain[0]] : '[' + chain.map(function (f) { return FILTER_NAMES[f]; }).join(' ') + ']') : '';
    var parms = opts.predictor && (last === 'Fl' || last === 'LZW') ? ' /DecodeParms ' + (chain.length === 1 ? '' : '[' + chain.slice(0, -1).map(function () { return 'null'; }).join(' ') + ' ') + '<< /Predictor 12 /Columns ' + COLS + ' >>' + (chain.length === 1 ? '' : ']') : '';
    return Buffer.concat([Buffer.from(num + ' 0 obj\n<< ' + o.dict + filt + parms + ' /Length ' + data.length + ' >>\nstream\n', 'latin1'), data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
  };
  var parts = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')], offsets = [], at = function () { return parts.reduce(function (s, b) { return s + b.length; }, 0); };
  var packed = [];
  objs.forEach(function (o, i) {
    var num = i + 1;
    if (o.data) { offsets[num] = { type: 1, off: at() }; parts.push(streamOf(num, o)); return; }
    if (opts.objstm && num !== encNum) { packed.push(num); return; } // the encryption dictionary is never packed
    offsets[num] = { type: 1, off: at() }; parts.push(Buffer.from(num + ' 0 obj\n' + o.body + '\nendobj\n', 'latin1'));
  });
  var size = objs.length + 1;
  if (opts.objstm) {
    var head = [], body = '', stmNum = size++;
    packed.forEach(function (num, k) { head.push(num + ' ' + body.length); body += objs[num - 1].body + '\n'; offsets[num] = { type: 2, stm: stmNum, idx: k }; });
    var hs = head.join(' ') + '\n';
    offsets[stmNum] = { type: 1, off: at() };
    parts.push(streamOf(stmNum, { dict: '/Type /ObjStm /N ' + packed.length + ' /First ' + hs.length, data: Buffer.from(hs + body, 'latin1') }));
    var xrefNum = size++, rows = [Buffer.from([0, 0, 0, 0, 0, 255, 255])];
    offsets[xrefNum] = { type: 1, off: at() };
    for (var q = 1; q < size; q++) { var e = offsets[q], b = Buffer.alloc(7); b[0] = e.type; if (e.type === 1) { b.writeUInt32BE(e.off, 1); } else { b.writeUInt32BE(e.stm, 1); b.writeUInt16BE(e.idx, 5); } rows.push(b); }
    var xd = Buffer.concat(rows);
    parts.push(Buffer.from(xrefNum + ' 0 obj\n<< /Type /XRef /Size ' + size + ' /W [1 4 2] /Root ' + catalog + ' 0 R /ID [<' + id.toString('hex') + '><' + id.toString('hex') + '>]' + (encNum ? ' /Encrypt ' + encNum + ' 0 R' : '') + ' /Length ' + xd.length + ' >>\nstream\n', 'latin1'), xd, Buffer.from('\nendstream\nendobj\nstartxref\n' + offsets[xrefNum].off + '\n%%EOF\n', 'latin1'));
  } else {
    var xref = at(), lines = ['xref', '0 ' + size, '0000000000 65535 f '];
    for (q = 1; q < size; q++) lines.push(('0000000000' + offsets[q].off).slice(-10) + ' 00000 n ');
    parts.push(Buffer.from(lines.join('\n') + '\ntrailer\n<< /Size ' + size + ' /Root ' + catalog + ' 0 R /ID [<' + id.toString('hex') + '><' + id.toString('hex') + '>]' + (encNum ? ' /Encrypt ' + encNum + ' 0 R' : '') + ' >>\nstartxref\n' + xref + '\n%%EOF\n', 'latin1'));
  }
  return Buffer.concat(parts);
}
// A manuscript's reference list as a journal sets it: a References heading, entries with a hanging indent, a running head and page number
// on every page, and a figure caption after the list
function manuscript(opts) {
  opts = opts || {};
  var refs = [
    ['Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., and Lukin,', 'M. D. (2013) Nanometre-scale thermometry in a living cell. Nature, 500, 54–58.'],
    ['Vaswani, A., Shazeer, N. and Parmar, N. (2017) Attention is all you need. Advances in', 'Neural Information Processing Systems, 30, 5998–6008.']
  ];
  var head = function (n) { return [{ x: 72, y: 750, size: 8, text: 'SMITH ET AL.: THERMOMETRY OF KERNITE' }, { x: 520, y: 750, size: 8, text: String(n) }]; };
  var y = 700, page1 = head(1).concat([{ x: 72, y: 720, size: 14, text: 'Nanoscale thermometry of the mineral kernite' }, { x: 72, y: y, size: 10, text: 'Diamond thermometers reach sub-degree precision (Kucsko et al. 2013).' }]);
  var page2 = head(2).concat([{ x: 72, y: 700, size: 10, text: 'References' }]);
  y = 684;
  refs.forEach(function (r) { page2.push({ x: 72, y: y, size: 9, text: r[0], font: opts.font }); page2.push({ x: 81, y: y - 11, size: 9, text: r[1], font: opts.font }); y -= 26; });
  page2.push({ x: 72, y: y - 20, size: 9, text: 'Figure 1. Temperature map of a kernite crystal at 300 K (2013 sample).' });
  return pdf({ pages: [{ lines: page1 }, { lines: page2 }], compress: opts.compress, objstm: opts.objstm, encrypt: opts.encrypt, filters: opts.filters, predictor: opts.predictor });
}
module.exports = { pdf: pdf, manuscript: manuscript, rc4: rc4 };
