/*
 * AutoDOI — the reference list of a manuscript: a Word file (.docx) or a PDF.
 * Pure synchronous functions over the file's bytes (no DOM, no network, no library), so the same file runs in the page
 * and on the command line. ES5 syntax, as the other libraries.
 *
 * readDocx(bytes) and readPdf(bytes) return { refs: [text], heading, layout }: the paragraphs (Word) or lines (PDF) after
 * the last References heading, up to the next section. A PDF line that sits to the right of its column's left edge keeps
 * one leading space, so a hanging indent survives for the splitter; a wider gap than the column's line spacing is a blank
 * line. read(bytes, name) picks the reader by the file's first bytes. inflate() is the zlib/deflate decoder both use.
 */
(function (root) {
  'use strict';

  var A = typeof module !== 'undefined' && module.exports ? require('./citations.js') : root.AutoDOI; // A.toScript for sub- and superscripts
  var MAX_UNPACKED = 64 * 1024 * 1024; // a manuscript's text is a few MB; past this a file is not one

  function bytesOf(buf) { return buf instanceof Uint8Array ? buf : new Uint8Array(buf); }
  function latin(b, s, e) { // bytes as a string of char codes 0-255, chunked so a long run does not overflow the call stack
    var out = '', i;
    s = s || 0; e = e === undefined ? b.length : e;
    for (i = s; i < e; i += 8192) out += String.fromCharCode.apply(null, b.subarray(i, Math.min(e, i + 8192)));
    return out;
  }

  /* ---------- inflate (RFC 1950/1951) ----------
   * A table-driven decoder.  strict: a damaged stream throws; otherwise what was decoded before the damage is kept, as PDF
   * readers do with a truncated content stream.  max bounds the output, so a crafted stream cannot fill the memory. */
  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DEXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  function huffman(lens, n) { // {t: Int32Array of (symbol << 4 | length), bits}, indexed by the next `bits` input bits
    var count = [], code = 0, next = [], bits = 0, i, len;
    for (i = 0; i <= 15; i++) count[i] = 0;
    for (i = 0; i < n; i++) { count[lens[i]]++; if (lens[i] > bits) bits = lens[i]; }
    if (!bits) return { t: new Int32Array(2), bits: 1 };
    count[0] = 0;
    for (i = 1; i <= 15; i++) { code = (code + count[i - 1]) << 1; next[i] = code; }
    var t = new Int32Array(1 << bits);
    for (i = 0; i < n; i++) {
      len = lens[i]; if (!len) continue;
      var c = next[len]++, r = 0;
      for (var k = 0; k < len; k++) { r = (r << 1) | (c & 1); c >>= 1; } // the code's bits reversed: input arrives least significant first
      for (var j = r; j < t.length; j += 1 << len) t[j] = (i << 4) | len;
    }
    return { t: t, bits: bits };
  }
  var FIXED_L, FIXED_D;
  function inflate(src, opts) {
    opts = opts || {};
    src = bytesOf(src);
    var ip = opts.start || 0, end = opts.end === undefined ? src.length : opts.end, max = opts.max === undefined ? MAX_UNPACKED : opts.max, strict = !!opts.strict;
    if (opts.zlib !== false && end - ip >= 2 && (src[ip] & 0x0F) === 8 && ((src[ip] << 8) | src[ip + 1]) % 31 === 0) ip += 2 + (src[ip + 1] & 0x20 ? 4 : 0); // a zlib header (PDF's FlateDecode); a raw stream (zip) has none
    var out = new Uint8Array(Math.min(max, Math.max(4096, (end - ip) * 4))), op = 0, bb = 0, bc = 0, over = 0;
    function fail(msg) { var e = new Error(msg); e.inflate = true; throw e; }
    function grow(n) {
      if (op + n <= out.length) return;
      if (op + n > max) fail('unpacks to more than ' + Math.round(max / 1048576) + ' MB');
      var o2 = new Uint8Array(Math.min(max, Math.max(op + n, out.length * 2))); o2.set(out.subarray(0, op)); out = o2;
    }
    function need(n) { while (bc < n) { if (ip < end) bb |= src[ip] << bc; else if (++over > 4) fail('the stream ends early'); ip++; bc += 8; } }
    function bits(n) { need(n); var v = bb & ((1 << n) - 1); bb >>>= n; bc -= n; return v; }
    function sym(h) { need(h.bits); var e = h.t[bb & ((1 << h.bits) - 1)], l = e & 15; if (!l) fail('a bad code'); bb >>>= l; bc -= l; return e >> 4; }
    try {
      for (var last = 0; !last;) {
        last = bits(1);
        var type = bits(2), lt, dt;
        if (type === 0) {
          bb = 0; bc = 0; // to a byte boundary
          if (ip + 4 > end) fail('the stream ends early');
          var len = src[ip] | (src[ip + 1] << 8); ip += 4;
          if (ip + len > end) { len = end - ip; last = 1; if (strict) fail('the stream ends early'); }
          grow(len); out.set(src.subarray(ip, ip + len), op); op += len; ip += len; continue;
        }
        if (type === 1) {
          if (!FIXED_L) { var fl = []; for (var q = 0; q < 288; q++) fl[q] = q < 144 ? 8 : q < 256 ? 9 : q < 280 ? 7 : 8; FIXED_L = huffman(fl, 288); var fd = []; for (q = 0; q < 30; q++) fd[q] = 5; FIXED_D = huffman(fd, 30); }
          lt = FIXED_L; dt = FIXED_D;
        } else if (type === 2) {
          var hl = bits(5) + 257, hd = bits(5) + 1, hc = bits(4) + 4, cl = [], i;
          for (i = 0; i < 19; i++) cl[CLORDER[i]] = i < hc ? bits(3) : 0;
          var ch = huffman(cl, 19), lens = [];
          while (lens.length < hl + hd) {
            var s = sym(ch);
            if (s < 16) lens.push(s);
            else { var rep = s === 16 ? 3 + bits(2) : s === 17 ? 3 + bits(3) : 11 + bits(7), v = s === 16 ? lens[lens.length - 1] : 0; if (v === undefined) fail('a bad code'); while (rep--) lens.push(v); }
          }
          lt = huffman(lens.slice(0, hl), hl); dt = huffman(lens.slice(hl, hl + hd), hd);
        } else fail('a bad block');
        for (;;) {
          var c = sym(lt);
          if (c < 256) { grow(1); out[op++] = c; continue; }
          if (c === 256) break;
          c -= 257; if (c >= 29) fail('a bad length');
          var n = LBASE[c] + bits(LEXTRA[c]), d = sym(dt); if (d >= 30) fail('a bad distance');
          var dist = DBASE[d] + bits(DEXTRA[d]); if (dist > op) fail('a bad distance');
          grow(n); for (var k = 0; k < n; k++, op++) out[op] = out[op - dist];
        }
      }
      if (ip * 8 - bc > end * 8) fail('the stream ends early'); // its last codes were read from the padding past its end
    } catch (e) { if (strict || !e.inflate || /more than/.test(e.message)) throw e; } // damage: keep what came before it; a size past the limit is never kept
    return out.subarray(0, op);
  }

  /* ---------- a Word manuscript ----------
   * A .docx is a zip of XML parts; only word/document.xml and the footnotes and endnotes are inflated.  Runs set superscript or
   * subscript become Unicode, as a paste from Word does. */
  var DOCX_PARTS = ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'];
  var DOCX_MAX_ENTRIES = 10000;
  function zipEntries(buf, want) { // {name: Uint8Array} for the parts want(name) asks for (the DOCX_PARTS by default) that are stored or deflated
    want = want || function (name) { return DOCX_PARTS.indexOf(name) !== -1; };
    var b = bytesOf(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = b.length, eocd = -1;
    for (var i = n - 22; i >= Math.max(0, n - 65558); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip file');
    var count = dv.getUint16(eocd + 10, true), cd = dv.getUint32(eocd + 16, true), out = {}, unpacked = 0;
    if (count > DOCX_MAX_ENTRIES) throw new Error('the file holds more than ' + DOCX_MAX_ENTRIES.toLocaleString('en-US') + ' parts, which no manuscript does');
    if (cd + 22 > n) throw new Error('damaged or unsupported Word file');
    for (var k = 0, pos = cd; k < count; k++) {
      if (pos + 46 > n || dv.getUint32(pos, true) !== 0x02014b50) break;
      var method = dv.getUint16(pos + 10, true), csize = dv.getUint32(pos + 20, true), nlen = dv.getUint16(pos + 28, true), xlen = dv.getUint16(pos + 30, true), clen = dv.getUint16(pos + 32, true), off = dv.getUint32(pos + 42, true);
      var name = utf8(b.subarray(pos + 46, pos + 46 + nlen));
      unpacked += dv.getUint32(pos + 24, true); // the directory's own word for the unpacked size, checked before anything is inflated
      if (unpacked > MAX_UNPACKED) throw new Error('the file would unpack to more than ' + Math.round(MAX_UNPACKED / 1048576) + ' MB, which no manuscript does');
      if (!want(name)) { pos += 46 + nlen + xlen + clen; continue; } // images, fonts, anything else: never read
      if (off + 30 > n) throw new Error('damaged or unsupported Word file');
      var start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      var data = b.subarray(start, Math.min(n, start + csize));
      if (method === 8) { try { data = inflate(data, { zlib: false, strict: true }); } catch (e) { throw new Error(name + ' is damaged, or this is not a Word document'); } }
      else if (method !== 0) throw new Error('unsupported zip compression ' + method);
      out[name] = data; pos += 46 + nlen + xlen + clen;
    }
    return out;
  }
  function utf8(b) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(b);
    try { return decodeURIComponent(escape(latin(b))); } catch (e) { return latin(b); }
  }
  // Symbol and Wingdings set each character by its own code, often in Word's private range (U+F0xx): the character it stands for
  var SYMBOL_UP = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ', SYMBOL_LOW = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ';
  var SYMBOL = { 0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2A: '∗', 0x2D: '−', 0x40: '≅', 0x5C: '∴', 0x5E: '⊥', 0x7E: '∼', 0xA1: 'ϒ', 0xA2: '′', 0xA3: '≤', 0xA4: '⁄', 0xA5: '∞', 0xA6: 'ƒ',
    0xAB: '↔', 0xAC: '←', 0xAD: '↑', 0xAE: '→', 0xAF: '↓', 0xB0: '°', 0xB1: '±', 0xB2: '″', 0xB3: '≥', 0xB4: '×', 0xB5: '∝', 0xB6: '∂', 0xB7: '•', 0xB8: '÷', 0xB9: '≠', 0xBA: '≡',
    0xBB: '≈', 0xBC: '…', 0xC0: 'ℵ', 0xC4: '⊗', 0xC5: '⊕', 0xC6: '∅', 0xC7: '∩', 0xC8: '∪', 0xC9: '⊃', 0xCA: '⊇', 0xCB: '⊄', 0xCC: '⊂', 0xCD: '⊆', 0xCE: '∈', 0xCF: '∉', 0xD0: '∠',
    0xD1: '∇', 0xD2: '®', 0xD3: '©', 0xD4: '™', 0xD5: '∏', 0xD6: '√', 0xD7: '⋅', 0xD8: '¬', 0xD9: '∧', 0xDA: '∨', 0xDB: '⇔', 0xDC: '⇐', 0xDD: '⇑', 0xDE: '⇒', 0xDF: '⇓', 0xE0: '◊',
    0xE1: '〈', 0xE5: '∑', 0xF1: '〉', 0xF2: '∫' };
  var WINGDINGS = { 0x6C: '●', 0x6E: '■', 0x71: '❑', 0x75: '◆', 0x76: '❖', 0x9F: '•', 0xA7: '▪', 0xA8: '◻', 0xD8: '➢', 0xDF: '←', 0xE0: '→', 0xE1: '↑', 0xE2: '↓', 0xE8: '➔',
    0xEF: '⇦', 0xF0: '⇨', 0xF1: '⇧', 0xF2: '⇩', 0xFB: '✗', 0xFC: '✓', 0xFD: '☒', 0xFE: '☑' };
  var SYMBOLIC = /^(?:Symbol|Wingdings)/i;
  function symbolChars(t, font) {
    var wing = /^Wingdings/i.test(font);
    return String(t).replace(/[\s\S]/g, function (ch) {
      var c = ch.charCodeAt(0);
      if (c >= 0xF020 && c <= 0xF0FF) c -= 0xF000; else if (c > 0xFF) return ch;
      if (wing) return WINGDINGS[c] || ch;
      return c >= 65 && c <= 90 ? SYMBOL_UP.charAt(c - 65) : c >= 97 && c <= 122 ? SYMBOL_LOW.charAt(c - 97) : SYMBOL[c] || String.fromCharCode(c);
    });
  }
  function docxParagraphs(xml) { // [{text, style, table}] in document order; tabs and breaks become spaces; sub/superscript runs become Unicode
    var out = [], re = /<w:p[\s>][\s\S]*?<\/w:p>/g, m, tables = [], tr = /<(\/?)w:tbl[\s>]/g, t0, depth = 0, tm;
    while ((tm = tr.exec(xml))) { if (!tm[1]) { if (!depth++) t0 = tm.index; } else if (depth && !--depth) tables.push([t0, tm.index]); } // where the tables are: a cell's paragraph is no reference
    var inTable = function (at) { for (var i = 0; i < tables.length; i++) if (at > tables[i][0] && at < tables[i][1]) return true; return false; };
    var unesc = function (t) { return t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (x, d) { return String.fromCodePoint(Number(d)); }).replace(/&#x([0-9a-f]+);/gi, function (x, h) { return String.fromCodePoint(parseInt(h, 16)); }).replace(/&amp;/g, '&'); };
    while ((m = re.exec(xml))) {
      var para = m[0], style = (para.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '', text = '';
      var runRe = /<w:r[\s>][\s\S]*?<\/w:r>|<w:tab\/>|<w:br\/>|<w:cr\/>/g, r;
      while ((r = runRe.exec(para))) {
        if (r[0] === '<w:tab/>' || r[0] === '<w:br/>' || r[0] === '<w:cr/>') { text += ' '; continue; }
        var run = r[0], va = (run.match(/<w:vertAlign w:val="(superscript|subscript)"/) || [])[1], t = '', sym = (run.match(/<w:rFonts[^>]*w:(?:ascii|hAnsi)="((?:Symbol|Wingdings)[^"]*)"/) || [])[1];
        var tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:sym\b([^>]*)>/g, tm;
        while ((tm = tRe.exec(run))) {
          if (tm[2] !== undefined) { var sf = (tm[2].match(/w:font="([^"]*)"/) || [])[1] || '', sc = parseInt((tm[2].match(/w:char="([0-9a-fA-F]+)"/) || [])[1], 16); if (sc > 0) t += SYMBOLIC.test(sf) ? symbolChars(String.fromCharCode(sc), sf) : String.fromCharCode(sc >= 0xF000 ? sc - 0xF000 : sc); }
          else t += tm[1] === undefined ? ' ' : sym ? symbolChars(unesc(tm[1]), sym) : unesc(tm[1]);
        }
        if (/<w:vanish\/>|<w:del[\s>]/.test(run)) continue; // hidden or deleted text
        text += va && A && A.toScript ? A.toScript(t, va === 'superscript' ? 'sup' : 'sub') : t;
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (text) out.push({ text: text, style: style, table: tables.length > 0 && inTable(m.index) });
    }
    return out;
  }
  function readDocx(buf) {
    var parts = zipEntries(buf);
    if (!parts['word/document.xml']) throw new Error('no word/document.xml inside: not a Word document');
    var sec = referenceSection(docxParagraphs(utf8(parts['word/document.xml'])));
    if (!sec.refs.length) { // a notes style keeps its references in footnotes or endnotes
      ['word/footnotes.xml', 'word/endnotes.xml'].forEach(function (nm) { if (parts[nm]) sec.refs = sec.refs.concat(docxParagraphs(utf8(parts[nm])).map(function (p) { return p.text; }).filter(function (t) { return t.length >= 20; })); });
      if (sec.refs.length) sec.heading = 'notes';
    }
    sec.layout = 'lines'; // one paragraph per reference
    return sec;
  }

  /* ---------- XML: a small tree for the Word parts the viewer lays out ----------
   * {n: name, a: attributes, c: children (nodes, and text as strings)}.  Comments, processing instructions and doctypes are
   * dropped; a stray closing tag is ignored, as Word itself does. */
  function xmlText(t) {
    return t.indexOf('&') < 0 ? t : t.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, function (x, e) {
      if (e.charAt(0) !== '#') return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e];
      var cp = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : '';
    });
  }
  function xmlTree(src) {
    var root = { n: '', a: Object.create(null), c: [] }, stack = [root], m, am;
    var re = /<(\/?)([A-Za-z_][\w:.\-]*)((?:\s+[\w:.\-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!\-\-[\s\S]*?\-\->|<![^>]*>|([^<]+)/g;
    var attrRe = /([\w:.\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    while ((m = re.exec(src))) {
      var top = stack[stack.length - 1];
      if (m[6] !== undefined) { top.c.push(xmlText(m[6])); continue; }
      if (m[5] !== undefined) { top.c.push(m[5]); continue; }
      if (!m[2]) continue;
      if (m[1]) { for (var k = stack.length - 1; k > 0; k--) if (stack[k].n === m[2]) { stack.length = k; break; } continue; }
      var a = Object.create(null);
      attrRe.lastIndex = 0;
      while ((am = attrRe.exec(m[3]))) a[am[1]] = xmlText(am[2] !== undefined ? am[2] : am[3]);
      var node = { n: m[2], a: a, c: [] };
      top.c.push(node);
      if (!m[4]) { stack.push(node); if (stack.length > 512) throw new Error('the Word document is nested too deeply'); }
    }
    for (var i = 0; i < root.c.length; i++) if (typeof root.c[i] === 'object') return root.c[i];
    return root;
  }
  function xKid(node, name) { if (node) for (var i = 0; i < node.c.length; i++) if (node.c[i].n === name) return node.c[i]; return null; }
  function xKids(node, name) { var out = []; if (node) for (var i = 0; i < node.c.length; i++) if (node.c[i].n === name) out.push(node.c[i]); return out; }
  function xFind(node, name, depth) { // the first descendant of that name
    if (!node || typeof node !== 'object' || (depth = depth || 0) > 64) return null;
    for (var i = 0; i < node.c.length; i++) { var c = node.c[i]; if (typeof c !== 'object') continue; if (c.n === name) return c; var f = xFind(c, name, depth + 1); if (f) return f; }
    return null;
  }
  function xVal(node, key) { return node ? node.a['w:' + (key || 'val')] : undefined; }
  function xOn(node) { if (!node) return false; var v = node.a['w:val']; return v === undefined || !/^(?:false|0|off|none)$/i.test(v); }
  function xText(node) { var s = ''; for (var i = 0; i < node.c.length; i++) if (typeof node.c[i] === 'string') s += node.c[i]; return s; }

  /* ---------- a Word manuscript as it is laid out, for the document viewer ----------
   * docxLayout(bytes) gives the page's size and margins and the body as blocks: paragraphs with their indents, spacing, list
   * numbers and runs (bold, italic, underline, size, font, colour, sub- and superscript), tables, pictures, footnote marks and
   * page breaks, with the footnotes and endnotes in the order their marks appear.  Word records where it last broke the
   * pages (lastRenderedPageBreak); a file that has them is laid out on those pages (paged: true).  Each block names its
   * section (sec), whose page size and margins are in sections; page is the last's.  Headers, footers, text boxes and
   * columns are not laid out.  Sizes are in points. */
  var LAYOUT_PART = /^word\/(?:document|styles|numbering|footnotes|endnotes)\.xml$|^word\/_rels\/document\.xml\.rels$|^word\/theme\/theme1\.xml$|^word\/media\/[^\/]+\.(?:png|jpe?g|gif|bmp|svg)$/i;
  var MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' };
  var HIGHLIGHT = { yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF', blue: '#0000FF', red: '#FF0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000', white: '#FFFFFF' };
  function tw(v) { var n = parseFloat(v); return isFinite(n) ? n / 20 : undefined; } // twentieths of a point
  function own(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }
  function hex6(v) { return /^[0-9A-Fa-f]{6}$/.test(v || '') ? '#' + v.toUpperCase() : ''; }
  function readRPr(rPr, into) { // run properties onto into
    if (!rPr) return into;
    rPr.c.forEach(function (p) {
      if (typeof p !== 'object') return;
      var v = p.a['w:val'];
      switch (p.n) {
        case 'w:b': into.b = xOn(p); break;
        case 'w:i': into.i = xOn(p); break;
        case 'w:u': into.u = xOn(p); break;
        case 'w:strike': case 'w:dstrike': into.s = xOn(p); break;
        case 'w:caps': into.caps = xOn(p); break;
        case 'w:smallCaps': into.sc = xOn(p); break;
        case 'w:vanish': into.hide = xOn(p); break;
        case 'w:vertAlign': into.va = v === 'superscript' ? 'sup' : v === 'subscript' ? 'sub' : ''; break;
        case 'w:sz': if (isFinite(parseFloat(v)) && parseFloat(v) > 0) into.size = parseFloat(v) / 2; break;
        case 'w:color': into.color = v === 'auto' ? '' : hex6(v) || into.color; break;
        case 'w:highlight': into.hl = HIGHLIGHT[v] || ''; break;
        case 'w:shd': if (hex6(p.a['w:fill'])) into.shd = hex6(p.a['w:fill']); break;
        case 'w:rFonts': var f = p.a['w:ascii'] || p.a['w:hAnsi'] || (p.a['w:asciiTheme'] || p.a['w:hAnsiTheme'] ? '@' + (p.a['w:asciiTheme'] || p.a['w:hAnsiTheme']) : ''); if (f) into.font = f; break;
      }
    });
    return into;
  }
  function readPPr(pPr, into) { // paragraph properties onto into
    if (!pPr) return into;
    pPr.c.forEach(function (p) {
      if (typeof p !== 'object') return;
      var a = p.a;
      switch (p.n) {
        case 'w:jc': into.jc = a['w:val']; break;
        case 'w:ind':
          var l = a['w:left'] !== undefined ? a['w:left'] : a['w:start'], r = a['w:right'] !== undefined ? a['w:right'] : a['w:end'];
          if (tw(l) !== undefined) into.left = tw(l);
          if (tw(r) !== undefined) into.right = tw(r);
          if (tw(a['w:hanging']) !== undefined) into.first = -tw(a['w:hanging']); else if (tw(a['w:firstLine']) !== undefined) into.first = tw(a['w:firstLine']);
          break;
        case 'w:spacing':
          if (tw(a['w:before']) !== undefined) into.before = tw(a['w:before']);
          if (tw(a['w:after']) !== undefined) into.after = tw(a['w:after']);
          if (/^(?:1|true|on)$/.test(a['w:beforeAutospacing'] || '')) into.before = 14; // what Word gives "auto" spacing
          if (/^(?:1|true|on)$/.test(a['w:afterAutospacing'] || '')) into.after = 14;
          var line = parseFloat(a['w:line']), rule = a['w:lineRule'] || 'auto';
          if (isFinite(line) && line > 0) into.line = rule === 'auto' ? { mult: line / 240 } : { pt: line / 20, least: rule === 'atLeast' };
          break;
        case 'w:pageBreakBefore': into.pbb = xOn(p); break;
        case 'w:numPr':
          var il = xVal(xKid(p, 'w:ilvl')), ni = xVal(xKid(p, 'w:numId'));
          if (il !== undefined) into.ilvl = Number(il) || 0;
          if (ni !== undefined) into.numId = ni;
          break;
        case 'w:shd': if (hex6(a['w:fill'])) into.shd = hex6(a['w:fill']); break;
        case 'w:contextualSpacing': into.ctx = xOn(p); break;
        case 'w:tabs': // the style's stops, with the paragraph's added and its "clear"s taken away
          var stops = (into.tabs || []).slice();
          xKids(p, 'w:tab').forEach(function (t) {
            var pos = tw(t.a['w:pos']); if (pos === undefined) return;
            stops = stops.filter(function (x) { return Math.abs(x.pos - pos) > 0.5; });
            if (t.a['w:val'] !== 'clear') stops.push({ pos: pos, val: { right: 'right', end: 'right', center: 'center', decimal: 'decimal' }[t.a['w:val']] || 'left' });
          });
          into.tabs = stops.sort(function (a, b) { return a.pos - b.pos; });
          break;
      }
    });
    return into;
  }
  function docxStyles(xml) {
    var out = { r: {}, p: {}, byId: Object.create(null), para: '', table: '' };
    if (!xml) return out;
    var root = xmlTree(utf8(xml)), dd = xKid(root, 'w:docDefaults');
    if (dd) { readRPr(xKid(xKid(dd, 'w:rPrDefault'), 'w:rPr'), out.r); readPPr(xKid(xKid(dd, 'w:pPrDefault'), 'w:pPr'), out.p); }
    xKids(root, 'w:style').forEach(function (s) {
      var id = s.a['w:styleId']; if (!id) return;
      out.byId[id] = { type: s.a['w:type'], based: xVal(xKid(s, 'w:basedOn')), pPr: xKid(s, 'w:pPr'), rPr: xKid(s, 'w:rPr'), tblPr: xKid(s, 'w:tblPr') };
      if (/^(?:paragraph|table)$/.test(s.a['w:type']) && /^(?:1|true|on)$/.test(s.a['w:default'] || '')) out[s.a['w:type'] === 'table' ? 'table' : 'para'] = id;
    });
    return out;
  }
  // Borders: {top, bottom, left, right, insideH, insideV} each {w: points, color, style: a CSS line}, or null where a side is
  // drawn as none (which overrides what the table or its style draws there)
  var LINE = { single: 'solid', thick: 'solid', double: 'double', dotted: 'dotted', dashed: 'dashed', dashSmallGap: 'dashed', dotDash: 'dashed', dotDotDash: 'dotted', triple: 'double', wave: 'solid' };
  function readBorders(node, into) {
    if (!node) return into;
    node.c.forEach(function (b) {
      if (typeof b !== 'object') return;
      var side = { 'w:top': 'top', 'w:bottom': 'bottom', 'w:left': 'left', 'w:start': 'left', 'w:right': 'right', 'w:end': 'right', 'w:insideH': 'insideH', 'w:insideV': 'insideV' }[b.n];
      if (!side) return;
      var v = b.a['w:val'] || 'single';
      into[side] = /^(?:nil|none)$/.test(v) ? null : { w: Math.max(0.25, (parseFloat(b.a['w:sz']) || 4) / 8), color: hex6(b.a['w:color']) || '#000', style: LINE[v] || 'solid' };
    });
    return into;
  }
  function readMargins(node, into) { // a cell's margins, in points
    if (!node) return into;
    node.c.forEach(function (m) {
      if (typeof m !== 'object' || (m.a['w:type'] && m.a['w:type'] !== 'dxa')) return;
      var side = { 'w:top': 'top', 'w:bottom': 'bottom', 'w:left': 'left', 'w:start': 'left', 'w:right': 'right', 'w:end': 'right' }[m.n], v = tw(m.a['w:w']);
      if (side && v !== undefined && v >= 0 && v < 144) into[side] = v;
    });
    return into;
  }
  function styleChain(styles, id) { // the style and its bases, the most basic first
    var chain = [], seen = Object.create(null);
    while (id && styles.byId[id] && !seen[id] && chain.length < 32) { seen[id] = true; chain.unshift(styles.byId[id]); id = styles.byId[id].based; }
    return chain;
  }
  function docxNumbering(xml) {
    var out = { abs: Object.create(null), nums: Object.create(null) };
    if (!xml) return out;
    var root = xmlTree(utf8(xml));
    xKids(root, 'w:abstractNum').forEach(function (a) {
      var lv = [];
      xKids(a, 'w:lvl').forEach(function (l) {
        var s = parseInt(xVal(xKid(l, 'w:start')), 10);
        lv[Math.min(8, Number(l.a['w:ilvl']) || 0)] = { start: isFinite(s) ? s : 1, fmt: xVal(xKid(l, 'w:numFmt')) || 'decimal', text: xVal(xKid(l, 'w:lvlText')), suff: xVal(xKid(l, 'w:suff')) || 'tab', pPr: xKid(l, 'w:pPr'), rPr: xKid(l, 'w:rPr') };
      });
      out.abs[a.a['w:abstractNumId']] = lv;
    });
    xKids(root, 'w:num').forEach(function (nm) {
      var starts = {};
      xKids(nm, 'w:lvlOverride').forEach(function (ov) { var s = parseInt(xVal(xKid(ov, 'w:startOverride')), 10); if (isFinite(s)) starts[Number(ov.a['w:ilvl']) || 0] = s; });
      out.nums[nm.a['w:numId']] = { abs: xVal(xKid(nm, 'w:abstractNumId')), starts: starts, restart: Object.keys(starts).length > 0 };
    });
    return out;
  }
  function roman(n) { var v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1], s = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'], out = ''; for (var i = 0; i < v.length; i++) while (n >= v[i]) { out += s[i]; n -= v[i]; } return out; }
  function numText(fmt, n) {
    if (fmt === 'lowerLetter' || fmt === 'upperLetter') { var l = new Array(Math.floor((n - 1) / 26) + 2).join(String.fromCharCode(97 + (n - 1) % 26)); return fmt === 'upperLetter' ? l.toUpperCase() : l; } // a..z, aa..zz, as Word counts
    if (fmt === 'lowerRoman') return roman(n).toLowerCase();
    if (fmt === 'upperRoman') return roman(n);
    if (fmt === 'decimalZero') return (n < 10 ? '0' : '') + n;
    if (fmt === 'none') return '';
    return String(n);
  }
  function docxLayout(buf) {
    var parts = zipEntries(buf, function (name) { return LAYOUT_PART.test(name); });
    if (!parts['word/document.xml']) throw new Error('no word/document.xml inside: not a Word document');
    var styles = docxStyles(parts['word/styles.xml']), numbering = docxNumbering(parts['word/numbering.xml']), rels = Object.create(null), theme = { minor: '', major: '' };
    if (parts['word/_rels/document.xml.rels']) xKids(xmlTree(utf8(parts['word/_rels/document.xml.rels'])), 'Relationship').forEach(function (x) { if (x.a.TargetMode !== 'External') rels[x.a.Id] = x.a.Target; });
    if (parts['word/theme/theme1.xml']) {
      var th = utf8(parts['word/theme/theme1.xml']);
      theme.minor = (th.match(/<a:minorFont>[\s\S]*?<a:latin typeface="([^"]*)"/) || [])[1] || '';
      theme.major = (th.match(/<a:majorFont>[\s\S]*?<a:latin typeface="([^"]*)"/) || [])[1] || '';
    }
    var baseR = own(styles.r), baseP = own(styles.p), cache = Object.create(null), counters = Object.create(null);
    if (!baseR.size) baseR.size = 10; // Word's own default, for a file that names none
    if (!baseR.font) baseR.font = 'Times New Roman';
    var media = Object.create(null), noteRefs = { footnote: [], endnote: [] }, paged = false;
    var fontOf = function (f) { return f && f.charAt(0) === '@' ? (/major/i.test(f) ? theme.major : theme.minor) || '' : f || ''; };
    function paraStyle(id, tStyle) { // {p, r} of a paragraph style, its bases applied first, over the table style of a cell it is in
      id = id || styles.para;
      var key = id + '\u0000' + (tStyle || '');
      if (cache[key]) return cache[key];
      var p = own(baseP), r = own(baseR), read = function (s) { readPPr(s.pPr, p); readRPr(s.rPr, r); };
      if (tStyle) styleChain(styles, tStyle).forEach(read); // "Table Grid": no space after, single lines
      styleChain(styles, id).forEach(read);
      return (cache[key] = { p: p, r: r });
    }
    function label(numId, ilvl) { // a list item's number or bullet, counting on from the list's last item
      var nm = numbering.nums[numId], lv = nm && numbering.abs[nm.abs], L = lv && lv[ilvl];
      if (!L) return null;
      var key = nm.restart ? 'n' + numId : 'a' + nm.abs, c = counters[key] || (counters[key] = []);
      var startOf = function (k) { return nm.starts[k] !== undefined ? nm.starts[k] : lv[k] ? lv[k].start : 1; };
      for (var k = 0; k < ilvl; k++) if (c[k] === undefined) c[k] = startOf(k);
      c[ilvl] = (c[ilvl] === undefined ? startOf(ilvl) - 1 : c[ilvl]) + 1;
      c.length = ilvl + 1; // the levels below start again
      var text = String(L.text || '').replace(/%([1-9])/g, function (x, d) { var i = Number(d) - 1; return lv[i] && c[i] !== undefined ? numText(lv[i].fmt, c[i]) : ''; });
      if (L.fmt === 'bullet') text = text.replace(/[-]/g, function (ch) { return { '': '▪', '': '➢', '': '✓', '': '❖' }[ch] || '•'; }); // Symbol and Wingdings bullets, in their private codes
      return { text: text, suff: L.suff, rPr: L.rPr };
    }
    function picture(path, w, h, r) {
      var target = path && rels[path], file = target ? (target.charAt(0) === '/' ? target.slice(1) : 'word/' + target.replace(/^\.\//, '')) : '';
      if (file && parts[file] && !media[file]) media[file] = { mime: MIME[file.split('.').pop().toLowerCase()], bytes: parts[file] };
      return { img: file && parts[file] ? file : '', w: w || 0, h: h || 0, r: r };
    }
    function paragraph(pNode, out, ctx) {
      var pPr = xKid(pNode, 'w:pPr'), st = paraStyle(xVal(xKid(pPr, 'w:pStyle')), ctx.tStyle), p = own(st.p), direct = readPPr(pPr, p.tabs ? { tabs: p.tabs } : {}); // the paragraph's tab stops add to its style's
      var numId = direct.numId !== undefined ? direct.numId : p.numId, ilvl = direct.ilvl !== undefined ? direct.ilvl : p.ilvl || 0, lab = null;
      if (numId && numId !== '0') { lab = label(numId, Math.min(8, ilvl)); var nm = numbering.nums[numId], lv = nm && numbering.abs[nm.abs]; if (lv && lv[ilvl]) readPPr(lv[ilvl].pPr, p); }
      for (var k in direct) p[k] = direct[k];
      if (lab) { lab.r = readRPr(lab.rPr, own(st.r)); lab.r.font = fontOf(lab.r.font); }
      var markR = readRPr(xKid(pPr, 'w:rPr'), own(st.r)); markR.font = fontOf(markR.font); // a theme's font ("@minorHAnsi") by its name, as a run's
      if (p.pbb && !ctx.inCell && out.length) out.push({ t: 'break' });
      var cur = { t: 'p', p: p, runs: [], label: lab, mark: markR };
      var brk = function () { // a page ends here: the paragraph goes on on the next one
        if (ctx.inCell) return;
        if (cur.runs.length) { out.push(cur); cur = { t: 'p', p: p, runs: [], label: null, mark: markR, cont: true }; }
        out.push({ t: 'break' });
      };
      var text = function (t, r) { var last = cur.runs[cur.runs.length - 1]; if (last && last.r === r && last.text !== undefined) last.text += t; else cur.runs.push({ text: t, r: r }); };
      var items = function (list, r) { // what one run holds
        list.forEach(function (k) {
          if (typeof k !== 'object') return;
          switch (k.n) {
            case 'w:t': text(r.sym ? symbolChars(xText(k), r.sym) : xText(k), r); break;
            case 'w:tab': cur.runs.push({ tab: true, r: r }); break;
            case 'w:br': if (k.a['w:type'] === 'page') brk(); else cur.runs.push({ br: true, r: r }); break;
            case 'w:cr': cur.runs.push({ br: true, r: r }); break;
            case 'w:noBreakHyphen': text('‑', r); break;
            case 'w:sym':
              var ch = parseInt(k.a['w:char'], 16), sf = k.a['w:font'] || r.sym || r.font;
              if (isFinite(ch) && ch > 0) { var sr = own(r); sr.font = SYMBOLIC.test(sf) ? '' : sf; cur.runs.push({ text: SYMBOLIC.test(sf) ? symbolChars(String.fromCharCode(ch), sf) : String.fromCharCode(ch >= 0xF000 ? ch - 0xF000 : ch), r: sr }); }
              break;
            case 'w:lastRenderedPageBreak': paged = true; brk(); break;
            case 'w:footnoteReference': case 'w:endnoteReference':
              var kind = k.n === 'w:footnoteReference' ? 'footnote' : 'endnote', nr = own(r), n = noteRefs[kind].length + 1;
              if (!nr.va) nr.va = 'sup';
              noteRefs[kind].push({ id: k.a['w:id'], n: n });
              cur.runs.push({ text: String(n), r: nr, note: kind, n: n });
              break;
            case 'w:footnoteRef': case 'w:endnoteRef': var fr = own(r); if (!fr.va) fr.va = 'sup'; cur.runs.push({ text: String(ctx.n || ''), r: fr, noteMark: true }); break; // the note's own number, at its head
            case 'w:drawing':
              var ext = xFind(k, 'wp:extent'), blip = xFind(k, 'a:blip');
              cur.runs.push(picture(blip && (blip.a['r:embed'] || blip.a['r:link']), ext ? Number(ext.a.cx) / 12700 : 0, ext ? Number(ext.a.cy) / 12700 : 0, r));
              break;
            case 'w:pict': case 'w:object':
              var im = xFind(k, 'v:imagedata'), shape = xFind(k, 'v:shape'), css = shape && shape.a.style || '';
              var dim = function (nm) { var m = css.match(new RegExp('(?:^|;)\\s*' + nm + ':\\s*([\\d.]+)(pt|in|px)?')); return m ? Number(m[1]) * (m[2] === 'in' ? 72 : m[2] === 'px' ? 0.75 : 1) : 0; };
              if (im) cur.runs.push(picture(im.a['r:id'], dim('width'), dim('height'), r));
              break;
            case 'mc:AlternateContent': var alt = xKid(k, 'mc:Choice') || xKid(k, 'mc:Fallback'); if (alt) items(alt.c, r); break;
          }
        });
      };
      var walk = function (node) {
        node.c.forEach(function (c) {
          if (typeof c !== 'object') return;
          switch (c.n) {
            case 'w:r':
              var rPr = xKid(c, 'w:rPr'), r = own(st.r), rs = xVal(xKid(rPr, 'w:rStyle'));
              if (rs) styleChain(styles, rs).forEach(function (s) { readRPr(s.rPr, r); });
              readRPr(rPr, r);
              if (r.hide) return;
              r.font = fontOf(r.font);
              if (SYMBOLIC.test(r.font)) { r.sym = r.font; r.font = ''; } // its characters as Unicode, in the paragraph's font
              items(c.c, r);
              break;
            case 'w:hyperlink': case 'w:ins': case 'w:moveTo': case 'w:smartTag': case 'w:customXml': case 'w:fldSimple': case 'w:dir': case 'w:bdo': walk(c); break;
            case 'w:sdt': var sc = xKid(c, 'w:sdtContent'); if (sc) walk(sc); break;
            case 'm:oMathPara': case 'm:oMath':
              var mr = own(st.r), mt = ''; mr.i = true; mr.font = fontOf(mr.font);
              (function math(n, d) { n.c.forEach(function (x) { if (typeof x === 'object' && d < 32) { if (x.n === 'm:t') mt += xText(x); else math(x, d + 1); } }); })(c, 0);
              if (mt) text(mt, mr);
              break;
          }
        });
      };
      walk(pNode);
      if (!cur.cont || cur.runs.length) out.push(cur);
      var sect = xKid(pPr, 'w:sectPr');
      if (sect && !ctx.inCell) { endSection(sect, out); if (xVal(xKid(sect, 'w:type')) !== 'continuous') out.push({ t: 'break' }); } // a section ends with this paragraph
    }
    function table(tNode, out, ctx) {
      var tblPr = xKid(tNode, 'w:tblPr'), style = xVal(xKid(tblPr, 'w:tblStyle')) || styles.table; // a table with none has the default ("Normal Table")
      var cols = xKids(xKid(tNode, 'w:tblGrid'), 'w:gridCol').map(function (g) { return tw(g.a['w:w']) || 0; });
      var rules = {}; // the table style's borders ("Table Grid"), then the table's own
      styleChain(styles, style).forEach(function (st) { readBorders(xKid(st.tblPr, 'w:tblBorders'), rules); });
      readBorders(xKid(tblPr, 'w:tblBorders'), rules);
      var ruled = Object.keys(rules).some(function (k) { return rules[k]; });
      var pad = { top: 0, right: 5.4, bottom: 0, left: 5.4 }; // Word's own cell margins, 0.075 inch either side; the style's, then the table's
      styleChain(styles, style).forEach(function (st) { readMargins(xKid(st.tblPr, 'w:tblCellMar'), pad); });
      readMargins(xKid(tblPr, 'w:tblCellMar'), pad);
      var gap = tw((xKid(tblPr, 'w:tblCellSpacing') || { a: {} }).a['w:w']) || 0; // half the room between two cells, and between a cell and the table's edge
      var fixed = xVal(xKid(tblPr, 'w:tblLayout'), 'type') === 'fixed'; // otherwise Word's AutoFit: a column widens for a word that does not fit
      var make = function () { return { t: 'table', cols: cols, rows: [], heights: [], border: ruled, borders: rules, jc: xVal(xKid(tblPr, 'w:jc')) || '', fixed: fixed, pad: pad, gap: gap }; }, t = make();
      var autoCells = 0, sizedCells = 0, split = false;
      xKids(tNode, 'w:tr').forEach(function (tr) {
        if (!ctx.inCell && xFind(tr, 'w:lastRenderedPageBreak')) { paged = true; if (t.rows.length) { out.push(t); out.push({ t: 'break' }); t = make(); split = true; } } // a row that opens a page
        var row = [], trH = xKid(xKid(tr, 'w:trPr'), 'w:trHeight');
        t.heights[t.rows.length] = trH && tw(trH.a['w:val']) > 0 ? tw(trH.a['w:val']) : 0; // at least this tall (an "exact" row is taken as at least: its text is not cut off)
        xKids(tr, 'w:tc').forEach(function (tc) {
          var tcPr = xKid(tc, 'w:tcPr'), vm = xKid(tcPr, 'w:vMerge'), shd = xKid(tcPr, 'w:shd');
          var cell = { span: Math.max(1, Math.min(64, Number(xVal(xKid(tcPr, 'w:gridSpan'))) || 1)), vm: vm ? (vm.a['w:val'] === 'restart' ? 'restart' : 'continue') : '', fill: shd ? hex6(shd.a['w:fill']) : '', blocks: [],
            borders: readBorders(xKid(tcPr, 'w:tcBorders'), {}), valign: { center: 'middle', bottom: 'bottom' }[xVal(xKid(tcPr, 'w:vAlign'))] || 'top' };
          if (xKid(tcPr, 'w:tcMar')) cell.pad = readMargins(xKid(tcPr, 'w:tcMar'), { top: pad.top, right: pad.right, bottom: pad.bottom, left: pad.left });
          var tcw = xKid(tcPr, 'w:tcW'); if (!tcw || tcw.a['w:type'] === 'auto' || !(parseFloat(tcw.a['w:w']) > 0)) autoCells++; else sizedCells++;
          body(tc, cell.blocks, { inCell: true, n: ctx.n, tStyle: style });
          row.push(cell);
        });
        t.rows.push(row);
      });
      var tblW = xKid(tblPr, 'w:tblW');
      // AutoFit to contents: the grid's widths are only Word's cache; a table over two pages keeps the grid, so its halves agree
      t.fit = !fixed && !split && autoCells > sizedCells && (!tblW || tblW.a['w:type'] === 'auto' || !(parseFloat(tblW.a['w:w']) > 0));
      out.push(t);
    }
    function body(node, out, ctx) {
      node.c.forEach(function (c) {
        if (typeof c !== 'object') return;
        if (c.n === 'w:p') paragraph(c, out, ctx);
        else if (c.n === 'w:tbl') table(c, out, ctx);
        else if (c.n === 'w:sdt') { var sc = xKid(c, 'w:sdtContent'); if (sc) body(sc, out, ctx); }
        else if (c.n === 'w:customXml' || c.n === 'w:ins' || c.n === 'w:moveTo') body(c, out, ctx);
      });
    }
    // Sections: each has its page (a landscape table's, say); its properties close it, at its last paragraph or the body's end
    var sections = [], secFrom = 0;
    function pageOf(sect) {
      var sz = xKid(sect, 'w:pgSz'), mar = xKid(sect, 'w:pgMar');
      var pt = function (node, k, d) { var v = tw(xVal(node, k)); return v === undefined || v < 0 || v > 1440 ? d : v; }; // a size past 20 inches is a damaged file's
      var pg = { w: pt(sz, 'w', 612), h: pt(sz, 'h', 792), top: pt(mar, 'top', 72), right: pt(mar, 'right', 72), bottom: pt(mar, 'bottom', 72), left: pt(mar, 'left', 72) };
      if (pg.w < 72 || pg.h < 72) { pg.w = 612; pg.h = 792; }
      if (pg.left + pg.right > pg.w - 72) { pg.left = pg.right = 72; }
      return pg;
    }
    function endSection(sect, out) {
      sections.push(pageOf(sect));
      for (var i = secFrom; i < out.length; i++) out[i].sec = sections.length - 1;
      secFrom = out.length;
    }
    var bodyNode = xKid(xmlTree(utf8(parts['word/document.xml'])), 'w:body');
    if (!bodyNode) throw new Error('the Word document has no body');
    var blocks = []; body(bodyNode, blocks, {});
    endSection(xKid(bodyNode, 'w:sectPr'), blocks);
    var page = sections[sections.length - 1];
    var notes = { footnote: Object.create(null), endnote: Object.create(null) };
    ['footnote', 'endnote'].forEach(function (kind) { // the notes, numbered in the order their marks appear in the text
      var xml = parts['word/' + kind + 's.xml']; if (!xml || !noteRefs[kind].length) return;
      var byId = Object.create(null);
      xKids(xmlTree(utf8(xml)), 'w:' + kind).forEach(function (nd) { var ty = nd.a['w:type']; if (!ty || ty === 'normal') byId[nd.a['w:id']] = nd; });
      noteRefs[kind].forEach(function (ref) { var nd = byId[ref.id]; if (!nd) return; var bl = []; body(nd, bl, { inCell: true, n: ref.n }); notes[kind][ref.n] = bl; });
    });
    return { page: page, sections: sections, blocks: blocks, footnotes: notes.footnote, endnotes: notes.endnote, media: media, paged: paged };
  }

  /* ---------- the reference section of a document's paragraphs or lines ---------- */
  var REF_NAMES = ['references', 'reference', 'literature cited', 'bibliography', 'works cited', 'reference list', 'references cited', 'cited literature', 'cited references', 'sources', 'notes and references', 'references and notes', 'literature',
    'литература', 'список литературы', 'литература цитированная', 'literatur', 'literaturverzeichnis', 'références', 'références bibliographiques', 'bibliographie', 'bibliografia', 'bibliografía', 'referencias', 'referências', 'riferimenti bibliografici', 'literatuur', 'literatura', 'piśmiennictwo'];
  var REF_HEADING = new RegExp('^(?:\\d+\\.?\\s*|[IVX]+\\.\\s*)?(?:' + REF_NAMES.join('|') + ')\\s*[:.]?$', 'i');
  var NEXT_HEADING = /^(?:\d+\.?\s*|[IVX]+\.\s*)?(?:tables?|figures?|figure (?:captions|legends)|captions|legends|appendix|appendices|supplementary(?: material| information| data)?|supplemental(?: material| information)?|acknowledg?ements?|author contributions|funding|data availability|competing interests|conflicts? of interest|glossary|index|about the authors?)\s*[:.]?$/i;
  // what a publisher prints after the list: an article's notes and colophon (MDPI, Springer, Pleiades, AmMin, ResearchGate), AmMin's deposit footnote
  var AFTER_REFS = /^(?:[\u00B9\u00B2\u00B3*\u2020]?\s*deposit item\b|disclaimer\/publisher|publisher[\u2019']?s note|this (?:manuscript|paper|article) was (?:handled|edited)|manuscript (?:received|handled)|editorial handling|endnotes?:|view publication stats|translated by\b|received:? \d|\u00A9 \d{4}|copyright \u00A9)/i;
  var CAPTION = /^(?:table|fig\.?|figure)\s*S?\d{1,2}[a-z]?(?:[.:|]|\s+[A-Z(])/i; // "Table 2. Powder X-ray diffraction data", "FIG. 9 Pb3 coordination"
  var REF_OPENS = /^(?:\[\d{1,4}\]|\d{1,4}\.\s+[A-Z]|(?:(?:van|von|de|da|di|del|der|le|la)\s+)*[A-Z\u00C0-\u024F][\w\u00C0-\u024F'\u2019\-]+(?:\s[A-Z\u00C0-\u024F][\w\u00C0-\u024F'\u2019\-]+)?(?:,\s+(?:[A-Z]\.|[A-Z\u00C0-\u024F][a-z])|\s+[A-Z]{1,3}[\s,(]|\s+\(\d{4}))/; // "Smith, J.", "van der Berg, A.", "Smith JA,", "[12]", "12. Smith"
  function headingText(t) { // "R E F E R E N C E S", "rE f E r E n C E s" (letter-spaced or small capitals in a PDF) read as the heading they spell
    if (!/^(?:\S{1,3} ){3,}\S{1,3}$/.test(t) && !/^[A-Z] [A-Z]{3,}/.test(t)) return t;
    var tight = t.replace(/ /g, '').toLowerCase().replace(/[:.]$/, '');
    for (var i = 0; i < REF_NAMES.length; i++) if (REF_NAMES[i].replace(/ /g, '') === tight) return REF_NAMES[i].charAt(0).toUpperCase() + REF_NAMES[i].slice(1);
    return t;
  }
  // The References heading: the last line that reads as one and that a reference follows (a table's "Reference" column after the
  // list is followed by "Yang et al. (2018)" or "This study"), else the last that reads as one (an abstract's "References: 42" does not)
  function headingAt(texts) {
    var last = -1, followed = -1;
    for (var i = 0; i < texts.length; i++) {
      var h = headingText(texts[i].trim());
      if (texts[i].length > 40 || !REF_HEADING.test(h) || /^[a-z]/.test(h)) continue; // "…in the literature." ends a sentence
      var weak = /^(?:reference|sources|literature)\s*[:.]?$/i.test(h), opens = false; // a table's column, a memo's field: a heading only when a reference follows
      for (var j = i + 1; j < texts.length && j <= i + 3; j++) if (texts[j].trim()) { opens = fullRef(texts[j].trim()); break; }
      if (opens) followed = i;
      if (!weak || opens) last = i;
    }
    return followed >= 0 ? followed : last;
  }
  // The first line of a reference, whole: it opens with an author ("Smith, J.", "Smith JA", "Agilent Technologies. (2013)") and names
  // one year, where a table's row of sources ("Walitzi (1965) Miletich (1993) This study") names several
  function fullRef(t) {
    return t.length >= 30 && (REF_OPENS.test(t) || /^[A-Z\u00C0-\u024F][^()]{1,80}\(\s*(?:1[5-9]|20)\d{2}[a-z]?\s*\)/.test(t)) && (t.match(/\((?:1[5-9]|20)\d{2}[a-z]?\)/g) || []).length <= 1;
  }
  // A section after the list: a known name, or a short line in capitals ("AUTHORS' REMARKS", "CHAIRMAN'S REMARKS") with no digit or comma
  function nextSection(t) { return t.length <= 40 && (NEXT_HEADING.test(t) || /^[A-Z][A-Z\u2019' \-]{5,39}$/.test(t) && /[A-Z]{3}/.test(t)); }
  function referenceSection(paras) { // the paragraphs after a References heading up to the next section; or the year-bearing paragraphs when there is none
    var start = headingAt(paras.map(function (p) { return p.text; }));
    // no heading: the paragraphs that open like a reference and carry a year (a letter to the reviewers mentions years in every other line)
    if (start < 0) return { refs: paras.filter(function (p) { return /\b(?:1[5-9]|20)\d{2}\b/.test(p.text) && p.text.length >= 40 && REF_OPENS.test(p.text.trim()) && !/^(?:Figure|Fig\.|Table)\s*\d/i.test(p.text); }).map(function (p) { return p.text; }), heading: '' };
    var refs = [];
    for (var j = start + 1; j < paras.length; j++) {
      var p = paras[j], t = headingText(p.text.trim());
      if ((nextSection(t) || (t.length <= 40 && /^Heading/i.test(p.style)) || p.table || CAPTION.test(t) || AFTER_REFS.test(t)) && refs.some(function (r) { return r.trim(); })) break; // a Word list ends at the captions or tables that follow it
      if (p.table) continue;
      if (t.length <= 40 && /^Heading|^Title/i.test(p.style)) continue;
      refs.push(p.text);
    }
    while (refs.length && !refs[0].trim()) refs.shift();
    while (refs.length && !refs[refs.length - 1].trim()) refs.pop();
    return { refs: refs, heading: headingText(paras[start].text.trim()) };
  }

  /* ---------- the viewer: where each entry of the list is in a document's text, and which entries its text cites ----------
   * fold() keeps a string's letters and digits, lowercased and without accents, so two readers of one file (this one and
   * pdf.js, or the Word layout) agree on an entry however they spaced, hyphenated or ligatured it. */
  function foldChar(ch) {
    var c = ch.charCodeAt(0);
    if (c < 128) return (c >= 48 && c <= 57) || (c >= 97 && c <= 122) ? ch : c >= 65 && c <= 90 ? ch.toLowerCase() : '';
    var f = ch.normalize ? ch.normalize('NFKD') : ch;
    return f.replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function fold(s) { var out = ''; s = String(s || ''); for (var i = 0; i < s.length; i++) out += foldChar(s.charAt(i)); return out; }
  function foldMap(text, from, to) { // the folded text of text[from, to), and for each of its characters the index in text it came from
    var s = [], at = [];
    for (var i = from; i < to; i++) { var f = foldChar(text.charAt(i)); for (var k = 0; k < f.length; k++) { s.push(f.charAt(k)); at.push(i); } }
    return { s: s.join(''), at: at };
  }
  // locateEntries(entries, text, from): [{start, end}] in text for each entry, in the order the list gives them, or null where an
  // entry cannot be found.  An entry is found by its first letters; it ends where its letters run out, or where the next one starts.
  function locateEntries(entries, text, from) {
    text = String(text || '');
    var m = foldMap(text, from || 0, text.length), pos = 0, found = [];
    entries.forEach(function (e) {
      var k = fold(e), at = -1;
      if (k.length >= 8) {
        at = m.s.indexOf(k.slice(0, 40), pos);
        if (at < 0 && k.length > 30) at = m.s.indexOf(k.slice(0, 20), pos); // the two readers parted ways late in the first line
      }
      found.push(at < 0 ? null : { k: at, len: k.length });
      if (at >= 0) pos = at + Math.min(20, k.length);
    });
    var next = function (i) { for (var j = i + 1; j < found.length; j++) if (found[j]) return found[j].k; return m.s.length; };
    return found.map(function (f, i) {
      if (!f) return null;
      var last = Math.min(f.k + f.len, next(i), m.s.length) - 1, end = m.at[Math.max(f.k, last)] + 1, stop = next(i) < m.s.length ? m.at[next(i)] : text.length;
      while (end < stop && end - m.at[Math.max(f.k, last)] < 4 && /[.,;:)\]”'"]/.test(text.charAt(end))) end++; // its closing full stop or bracket, which is no letter
      return { start: m.at[f.k], end: end };
    });
  }
  var YEAR_IN = /\b(1[5-9]\d{2}|20\d{2})([a-z])?\b|\b(n\.\s?d\.)|\b(in press|forthcoming)\b/gi;
  function entryKeys(t) { // what an in-text citation can name an entry by: its number, its first author's surname, its year
    var s = String(t || '').replace(/^\s+/, ''), nm = s.match(/^\[(\d{1,4})\]\s*|^(\d{1,4})[.)]\s+/), num = nm ? Number(nm[1] || nm[2]) : 0;
    if (nm) s = s.slice(nm[0].length);
    YEAR_IN.lastIndex = 0;
    var y = YEAR_IN.exec(s), authors = y ? s.slice(0, y.index) : s.slice(0, 120);
    var head = authors.replace(/^[^A-Za-zÀ-ɏ]+/, '').split(/,|;|\s(?:and|&)\s|\(/)[0];
    var init = function (w) { return /^(?:[A-Z]\.?-?){1,3}\.?$/.test(w) || /^[A-Z]\.[A-Z]\.?$/.test(w); }, all = head.split(/\s+/).filter(Boolean), at = all.findIndex ? all.findIndex(init) : -1;
    var words = (at > 0 ? all.slice(0, at) : all).filter(function (w) { return !init(w); }); // the surname ends at its initials ("Ledeneva N.V. Mineralogy…"); initials before it are dropped ("J. A. Smith")
    var alt = fold(all.filter(function (w) { return !init(w); }).join(' ')); // every word but the initials: "Leticia M. Torres-Martinez" ends in its surname
    return { num: num, first: fold(words.join(' ')), alt: alt !== fold(words.join(' ')) ? alt : '', authors: fold(authors), year: y ? (y[1] || (y[3] ? 'nd' : 'inpress')) : '', suffix: y && y[2] ? y[2].toLowerCase() : '' };
  }
  var PARTICLE = '(?:\\b(?:[Vv]an|[Vv]on|[Dd]e|[Dd]el|[Dd]ella|[Dd]er|[Dd]en|[Dd]u|[Dd]a|[Dd]i|[Dd]os|[Ll]a|[Ll]e|[Tt]er|[Tt]en)\\s+)*'; // whole words: "after Brese" is no "ter Brese"; "Del Barco", "van der Berg"
  var SURNAME = PARTICLE + "[A-Z\\u00C0-\\u00DE\\u0100-\\u024F][\\w\\u00C0-\\u024F'\\u2019\\-]+";
  // "Smith", "Smith and Jones", "Smith, Jones and Lee", "Kravchenko, Pokrovsky" (commas alone), "Smith et al.", "Smith's", before the year
  var CITE_AUTHORS = new RegExp('(' + SURNAME + ')((?:\\s*,\\s*(' + SURNAME + '))*(?:,?\\s+(?:and|&)\\s+(' + SURNAME + '))?)(\\s+et\\s+al\\.?)?(?:[\\u2019\']s)?[\\s,(\\[]*$');
  var NOT_NAME = /^(?:See|Also|In|And|The|Table|Tables|Fig|Figs|Figure|Figures|Eq|Eqs|Equation|Section|Chapter|Appendix|Supplementary|January|February|March|April|May|June|July|August|September|October|November|December|Spring|Summer|Autumn|Fall|Winter|AD|BC|BCE|CE|Ma|Ka)$/;
  // findCitations(text, entries, opts): [{start, end, refs: [entry indexes]}] for each in-text citation in text that names
  // entries of the list: "(Smith 2019)", "Smith and Jones (2019a)", "(Smith et al., 2019; Lee, 2020)" one by one, "[3]",
  // "[2–4]", and, given opts.sups ([{start, end}] of superscript text), a superscript number.  A citation no entry answers
  // is not one.
  function findCitations(text, entries, opts) {
    text = String(text || ''); opts = opts || {};
    var keys = entries.map(entryKeys), out = [], numbered = keys.filter(function (k) { return k.num; }).length >= Math.max(2, keys.length / 2);
    var byNum = function (n) { if (numbered) { for (var i = 0; i < keys.length; i++) if (keys[i].num === n) return i; return -1; } return n >= 1 && n <= keys.length ? n - 1 : -1; };
    var nums = function (s) { // "2, 5–7" as entry indexes, or null when a number is not an entry
      var idx = [], ok = true;
      s.split(/\s*,\s*/).forEach(function (part) {
        var r = part.match(/^(\d{1,4})(?:\s*[–—\-]\s*(\d{1,4}))?$/);
        if (!r) { ok = false; return; }
        var a = Number(r[1]), b = r[2] ? Number(r[2]) : a;
        if (b < a || b - a > 50) { ok = false; return; }
        for (var n = a; n <= b; n++) { var i = byNum(n); if (i < 0) ok = false; else idx.push(i); }
      });
      return ok && idx.length ? idx : null;
    };
    var m, re = /\[(\d{1,4}(?:\s*[,–—\-]\s*\d{1,4})*)\]/g, numeric = [];
    while ((m = re.exec(text))) { var ix = nums(m[1]); if (ix) numeric.push({ start: m.index, end: m.index + m[0].length, refs: ix }); }
    (opts.sups || []).forEach(function (sp) {
      // a citation's superscript follows a word or its punctuation ("shown.³", "minerals³"); after a unit, a symbol, a number or a
      // bracket it is a power, a charge or a formula's count (Å³, cm², Fe³⁺, 10⁵, (UO₂)₂)
      var before = text.slice(Math.max(0, sp.start - 12), sp.start), word = (before.match(/[A-Za-z\u00C0-\u024F]+$/) || [''])[0];
      if (!(/[.,;:'"\u2019\u201D]$/.test(before) || (word.length >= 3 && /[a-z]$/.test(word) && !/^(?:mol|kbar|GPa|MPa|kPa|bar|ppm|cal|kcal|kJ|wt|apfu|hrs?|min|sec)$/.test(word)))) return;
      var t = text.slice(sp.start, sp.end), lead = t.length - t.replace(/^[\s(]+/, '').length;
      t = t.trim().replace(/^\(|\)$/g, '');
      if (!/^\d/.test(t)) return;
      var ix2 = nums(t.replace(/[\s,]+$/, '')); if (ix2) numeric.push({ start: sp.start + lead, end: sp.end, refs: ix2 });
    });
    // author and year: each year is read with the names written before it
    var prev = null;
    YEAR_IN.lastIndex = 0;
    var cited = function (who, year, suffix) { // the entries a citation's names and year answer: {refs, byOrg}
      var refs = [], byOrg = false;
      keys.forEach(function (k, i) {
        if (k.year !== year || (suffix && k.suffix !== suffix) || !k.first) return;
        var is = function (f) { return f && (f === who.first || (who.first.length >= 3 && f.length > who.first.length && f.slice(-who.first.length) === who.first)); };
        if (is(k.first) || is(k.alt)) refs.push(i); // "World Health Organization" cited as its last word, "de Silva" as "Silva"
      });
      if (!refs.length && who.org) keys.forEach(function (k, i) { // "Bruker AXS" cited whole, listed as "Bruker"
        if (k.year === year && (!suffix || k.suffix === suffix) && k.first.length >= 4 && who.org.indexOf(k.first) === 0) { refs.push(i); byOrg = true; }
      });
      if (refs.length > 1 && who.second) { var two = refs.filter(function (i) { return keys[i].authors.indexOf(who.second) >= 0; }); if (two.length) refs = two; }
      if (refs.length > 1 && !suffix) { var plain = refs.filter(function (i) { return !keys[i].suffix; }); if (plain.length) refs = plain; }
      return { refs: refs, byOrg: byOrg };
    };
    while ((m = YEAR_IN.exec(text))) {
      var yEnd = m.index + m[0].length, year = m[1] || (m[3] ? 'nd' : 'inpress'), suffix = m[2] ? m[2].toLowerCase() : '', who = null, start = m.index, hit = null;
      if (prev && /^[\s,]*$/.test(text.slice(prev.end, m.index)) && m.index - prev.end <= 4) { who = prev.who; hit = cited(who, year, suffix); } // "Smith 2019, 2020a": the same author again
      else {
        var w0 = Math.max(0, m.index - 160), win = text.slice(w0, m.index), cut = Math.max(win.lastIndexOf(';'), win.lastIndexOf('\n'));
        if (cut >= 0) { w0 += cut + 1; win = win.slice(cut + 1); }
        // the names before the year; when the first answers no entry, the next ("in Russia, Smith (2019)" is Smith's)
        for (var off = 0, tries = 0; tries < 4; tries++) {
          var a = CITE_AUTHORS.exec(win.slice(off));
          if (!a) break;
          var at = off + a.index;
          if (!NOT_NAME.test(a[1].replace(/^.*\s/, ''))) {
            var org = win.slice(0, at).match(/(?:^|[\s(\[;])((?:[A-Z][\w&'\u2019\-]*\s+){1,3})$/); // "Bruker AXS", "World Health": an organisation's words before the last
            var w = { first: fold(a[1].replace(/['\u2019]s$/, '')), org: org && !a[2] ? fold(org[1] + a[1]) : '', second: a[2] && !a[5] ? fold(a[4] || a[3] || '') : '' }; // "Smith's (2019)" is Smith's
            if (w.org === w.first) w.org = '';
            var h = w.first.length >= 2 ? cited(w, year, suffix) : { refs: [] };
            if (h.refs.length) { who = w; hit = h; start = w0 + (h.byOrg ? at - org[1].length : at); break; }
          }
          off = at + a[1].length;
        }
      }
      prev = null;
      if (!hit || !hit.refs.length) continue;
      var end = yEnd, close = text.slice(yEnd).match(/^\)/), open = text.slice(start, m.index).indexOf('(') >= 0;
      if (close && open) end++; // "Smith (2019)": the brackets with it
      out.push({ start: start, end: end, refs: hit.refs });
      prev = { end: yEnd, who: who };
    }
    // numbers cite a numbered list; beside an author-and-year list they are footnote marks, affiliations or chemistry ("[2]")
    if (numbered || !out.length) out = out.concat(numeric);
    out.sort(function (x, y) { return x.start - y.start || y.end - x.end; });
    var kept = [], upTo = -1;
    out.forEach(function (c) { if (c.start >= upTo) { kept.push(c); upTo = c.end; } }); // one citation per stretch of text
    return kept;
  }

  /* ---------- PDF: the objects ----------
   * The file is scanned for "n g obj" rather than trusting its cross-reference table, which is often wrong in files that have
   * been edited; a later definition of an object replaces an earlier one, as an incremental update does.  Objects packed in
   * object streams (PDF 1.5) are unpacked after the scan. */
  var WS = [], DELIM = [];
  (function () { var i; for (i = 0; i < 256; i++) { WS[i] = false; DELIM[i] = false; } [0, 9, 10, 12, 13, 32].forEach(function (c) { WS[c] = true; }); '()<>[]{}/%'.split('').forEach(function (c) { DELIM[c.charCodeAt(0)] = true; }); })();
  function Lexer(b, p) { this.b = b; this.p = p || 0; this.depth = 0; }
  Lexer.prototype.skip = function () {
    var b = this.b, n = b.length, p = this.p;
    for (;;) {
      while (p < n && WS[b[p]]) p++;
      if (p < n && b[p] === 37) { while (p < n && b[p] !== 10 && b[p] !== 13) p++; continue; } // % comment
      break;
    }
    this.p = p;
  };
  Lexer.prototype.word = function () { var b = this.b, n = b.length, s = this.p; while (this.p < n && !WS[b[this.p]] && !DELIM[b[this.p]]) this.p++; return latin(b, s, this.p); };
  // One object: a number, '/Name', {s: bytes as a string}, true/false/null, an array, a dict (Object.create(null)), {ref: n},
  // {op: 'keyword'}, or undefined at the end.  refs: read "n g R" as a reference (not in content streams, where R is no operator).
  Lexer.prototype.value = function (refs) {
    this.skip();
    var b = this.b, n = b.length, c = b[this.p];
    if (this.p >= n) return undefined;
    if (c === 47) { this.p++; return '/' + this.word().replace(/#([0-9A-Fa-f]{2})/g, function (x, h) { return String.fromCharCode(parseInt(h, 16)); }); }
    if (c === 40) return { s: this.literal() };
    if (c === 60 && b[this.p + 1] === 60) {
      this.p += 2; if (++this.depth > 100) throw new Error('nested too deeply');
      var d = Object.create(null);
      for (;;) {
        this.skip();
        if (this.p >= n) break;
        if (b[this.p] === 62 && b[this.p + 1] === 62) { this.p += 2; break; }
        var k = this.value(refs);
        if (typeof k !== 'string' || k.charAt(0) !== '/') { if (k === undefined) break; continue; } // a stray token: skip it
        d[k.slice(1)] = this.value(refs);
      }
      this.depth--; return d;
    }
    if (c === 60) { // <hex>
      var s = ++this.p, hex = '';
      while (this.p < n && b[this.p] !== 62) this.p++;
      hex = latin(b, s, this.p).replace(/[^0-9A-Fa-f]/g, ''); this.p++;
      if (hex.length % 2) hex += '0';
      var str = ''; for (var i = 0; i < hex.length; i += 2) str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      return { s: str };
    }
    if (c === 91) {
      this.p++; if (++this.depth > 100) throw new Error('nested too deeply');
      var arr = [];
      for (;;) { this.skip(); if (this.p >= n) break; if (b[this.p] === 93) { this.p++; break; } var v = this.value(refs); if (v === undefined) break; arr.push(v); }
      this.depth--; return arr;
    }
    if (c === 41 || c === 93 || c === 62 || c === 123 || c === 125) { this.p++; return { op: String.fromCharCode(c) }; } // stray delimiters
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
      var w = this.word(), num = parseFloat(w.replace(/^([+-])[+-]+/, '$1'));
      if (isNaN(num)) return { op: w };
      if (refs && /^\d+$/.test(w)) { // "12 0 R"
        var save = this.p; this.skip();
        var s2 = this.p; while (this.p < n && b[this.p] >= 48 && b[this.p] <= 57) this.p++;
        if (this.p > s2 && (this.skip(), b[this.p] === 82) && (this.p + 1 >= n || WS[b[this.p + 1]] || DELIM[b[this.p + 1]])) { this.p++; return { ref: num }; }
        this.p = save;
      }
      return num;
    }
    var kw = this.word();
    if (!kw) { this.p++; return { op: String.fromCharCode(c) }; }
    return kw === 'true' ? true : kw === 'false' ? false : kw === 'null' ? null : { op: kw };
  };
  Lexer.prototype.literal = function () { // (string) with balanced parentheses and escapes
    var b = this.b, n = b.length, depth = 1, out = [], p = this.p + 1;
    while (p < n) {
      var c = b[p++];
      if (c === 92) {
        var e = b[p++];
        if (e === 110) out.push(10); else if (e === 114) out.push(13); else if (e === 116) out.push(9); else if (e === 98) out.push(8); else if (e === 102) out.push(12);
        else if (e === 13) { if (b[p] === 10) p++; } else if (e === 10) { /* a line continuation */ }
        else if (e >= 48 && e <= 55) { var o = e - 48; for (var k = 0; k < 2 && b[p] >= 48 && b[p] <= 55; k++) o = o * 8 + b[p++] - 48; out.push(o & 255); }
        else if (e !== undefined) out.push(e);
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41 && !--depth) break;
      out.push(c);
    }
    this.p = p;
    var s = ''; for (var i = 0; i < out.length; i += 8192) s += String.fromCharCode.apply(null, out.slice(i, i + 8192));
    return s;
  };

  /* ---------- PDF: the standard security handler ----------
   * A publisher's PDF is often encrypted with an empty password, to set permissions: it opens without asking, and its key is
   * derived from the file itself (MD5, then RC4 or AES-128 on each stream; PDF 1.7 section 7.6).  A file that needs a password,
   * or uses AES-256 or another handler, is refused in words. */
  var MD5_K = [], MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (var mk = 0; mk < 64; mk++) MD5_K[mk] = Math.floor(Math.abs(Math.sin(mk + 1)) * 4294967296) | 0;
  function md5(bytes) {
    var n = bytes.length, len = Math.ceil((n + 9) / 64) * 64, m = new Uint8Array(len), h = [0x67452301, 0xEFCDAB89 | 0, 0x98BADCFE | 0, 0x10325476], i;
    m.set(bytes); m[n] = 0x80;
    for (i = 0; i < 4; i++) m[len - 8 + i] = ((n * 8) >>> (8 * i)) & 255;
    m[len - 4] = Math.floor(n / 0x20000000) & 255;
    for (var off = 0; off < len; off += 64) {
      var w = [], a = h[0], b = h[1], c = h[2], d = h[3];
      for (i = 0; i < 16; i++) w[i] = m[off + 4 * i] | (m[off + 4 * i + 1] << 8) | (m[off + 4 * i + 2] << 16) | (m[off + 4 * i + 3] << 24);
      for (i = 0; i < 64; i++) {
        var f, g, r = i >> 4;
        if (r === 0) { f = (b & c) | (~b & d); g = i; } else if (r === 1) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; } else if (r === 2) { f = b ^ c ^ d; g = (3 * i + 5) & 15; } else { f = c ^ (b | ~d); g = (7 * i) & 15; }
        var sh = MD5_S[r * 4 + (i & 3)], t = (a + f + MD5_K[i] + w[g]) | 0;
        a = d; d = c; c = b; b = (b + ((t << sh) | (t >>> (32 - sh)))) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    }
    var out = new Uint8Array(16);
    for (i = 0; i < 16; i++) out[i] = (h[i >> 2] >>> (8 * (i & 3))) & 255;
    return out;
  }
  function rc4(key, data) {
    var s = new Uint8Array(256), i, j = 0, t, out = new Uint8Array(data.length);
    for (i = 0; i < 256; i++) s[i] = i;
    for (i = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; t = s[i]; s[i] = s[j]; s[j] = t; }
    i = j = 0;
    for (var k = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; t = s[i]; s[i] = s[j]; s[j] = t; out[k] = data[k] ^ s[(s[i] + s[j]) & 255]; }
    return out;
  }
  var SBOX, INV_SBOX, MUL9, MUL11, MUL13, MUL14;
  function aesTables() {
    var xt = function (a) { return ((a << 1) ^ (a & 0x80 ? 0x1B : 0)) & 255; }, mul = function (a, b) { var r = 0; while (b) { if (b & 1) r ^= a; a = xt(a); b >>= 1; } return r; };
    var rotl = function (x, k) { return ((x << k) | (x >> (8 - k))) & 255; };
    SBOX = new Uint8Array(256); INV_SBOX = new Uint8Array(256); MUL9 = new Uint8Array(256); MUL11 = new Uint8Array(256); MUL13 = new Uint8Array(256); MUL14 = new Uint8Array(256);
    var p = 1, q = 1;
    do { // p runs over the field's units; q is its inverse
      p = p ^ xt(p);
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 255; if (q & 0x80) q ^= 0x09;
      SBOX[p] = q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 0x63;
    } while (p !== 1);
    SBOX[0] = 0x63;
    for (var i = 0; i < 256; i++) { INV_SBOX[SBOX[i]] = i; MUL9[i] = mul(i, 9); MUL11[i] = mul(i, 11); MUL13[i] = mul(i, 13); MUL14[i] = mul(i, 14); }
  }
  function aesDecrypt(key, data) { // AES-CBC with the IV in the first block and PKCS#5 padding, as a PDF stores a stream
    if (!SBOX) aesTables();
    var nk = key.length / 4, nr = nk + 6, w = new Uint8Array(16 * (nr + 1)), rcon = 1, t = [0, 0, 0, 0], i, k;
    w.set(key);
    for (i = nk; i < 4 * (nr + 1); i++) {
      for (k = 0; k < 4; k++) t[k] = w[4 * (i - 1) + k];
      if (i % nk === 0) { var t0 = t[0]; t[0] = SBOX[t[1]] ^ rcon; t[1] = SBOX[t[2]]; t[2] = SBOX[t[3]]; t[3] = SBOX[t0]; rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x1B : 0)) & 255; }
      else if (nk > 6 && i % nk === 4) for (k = 0; k < 4; k++) t[k] = SBOX[t[k]];
      for (k = 0; k < 4; k++) w[4 * i + k] = w[4 * (i - nk) + k] ^ t[k];
    }
    var blocks = Math.floor(data.length / 16) - 1;
    if (blocks < 1) return new Uint8Array(0);
    var out = new Uint8Array(blocks * 16), s = new Uint8Array(16), u = new Uint8Array(16);
    for (var bk = 0; bk < blocks; bk++) {
      var at = 16 + bk * 16;
      for (i = 0; i < 16; i++) s[i] = data[at + i] ^ w[16 * nr + i];
      for (var round = nr - 1; round >= 0; round--) {
        for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) u[r + 4 * ((c + r) & 3)] = INV_SBOX[s[r + 4 * c]]; // InvShiftRows and InvSubBytes
        for (i = 0; i < 16; i++) u[i] ^= w[16 * round + i];
        if (round) for (c = 0; c < 4; c++) {
          var a0 = u[4 * c], a1 = u[4 * c + 1], a2 = u[4 * c + 2], a3 = u[4 * c + 3];
          s[4 * c] = MUL14[a0] ^ MUL11[a1] ^ MUL13[a2] ^ MUL9[a3]; s[4 * c + 1] = MUL9[a0] ^ MUL14[a1] ^ MUL11[a2] ^ MUL13[a3];
          s[4 * c + 2] = MUL13[a0] ^ MUL9[a1] ^ MUL14[a2] ^ MUL11[a3]; s[4 * c + 3] = MUL11[a0] ^ MUL13[a1] ^ MUL9[a2] ^ MUL14[a3];
        } else s.set(u);
      }
      for (i = 0; i < 16; i++) out[bk * 16 + i] = s[i] ^ data[at - 16 + i];
    }
    var pad = out[out.length - 1];
    return pad >= 1 && pad <= 16 ? out.subarray(0, out.length - pad) : out;
  }
  var PASSWORD_PAD = [0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08, 0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A];
  function strBytes(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
  function concat(parts) { var n = 0, i; for (i = 0; i < parts.length; i++) n += parts[i].length; var out = new Uint8Array(n), o = 0; for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; } return out; }
  function security(enc, id, pdf) { // {key, method: 'rc4'|'aes'|'', meta} for the empty user password; throws when another is needed
    var V = pdf.get(enc.V) || 0, R = pdf.get(enc.R) || 0, O = pdf.get(enc.O), U = pdf.get(enc.U), P = pdf.get(enc.P);
    if (enc.Filter !== '/Standard') throw new Error('the PDF is locked with a certificate or a plug-in; open it in a PDF viewer and copy its reference list instead');
    if (V >= 5 || R >= 5) throw new Error('the PDF is encrypted with AES-256, which is not read here; open it in a PDF viewer and copy its reference list instead');
    if (!O || O.s === undefined || !U || U.s === undefined || typeof P !== 'number') throw new Error('the PDF\'s encryption dictionary is damaged');
    var n = V === 1 ? 5 : V === 4 ? 16 : Math.max(5, Math.min(16, (pdf.get(enc.Length) || 40) / 8)), meta = pdf.get(enc.EncryptMetadata) !== false, method = 'rc4';
    if (V === 4) {
      var cf = pdf.dict(pdf.dict(enc.CF) && pdf.dict(enc.CF)[String(pdf.get(enc.StmF) || '/Identity').slice(1)]), cfm = cf && pdf.get(cf.CFM);
      method = String(pdf.get(enc.StmF)) === '/Identity' || !cf || cfm === '/None' ? '' : cfm === '/AESV2' ? 'aes' : 'rc4';
    }
    var p32 = new Uint8Array([P & 255, (P >>> 8) & 255, (P >>> 16) & 255, (P >>> 24) & 255]), idb = strBytes(id);
    var h = md5(concat([new Uint8Array(PASSWORD_PAD), strBytes(O.s).subarray(0, 32), p32, idb, R >= 4 && !meta ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array(0)]));
    if (R >= 3) for (var i = 0; i < 50; i++) h = md5(h.subarray(0, n));
    var key = h.subarray(0, n), u = strBytes(U.s), check;
    if (R >= 3) {
      check = rc4(key, md5(concat([new Uint8Array(PASSWORD_PAD), idb])));
      for (i = 1; i <= 19; i++) { var k2 = new Uint8Array(n); for (var j = 0; j < n; j++) k2[j] = key[j] ^ i; check = rc4(k2, check); }
      check = check.subarray(0, 16); u = u.subarray(0, 16);
    } else { check = rc4(key, new Uint8Array(PASSWORD_PAD)); u = u.subarray(0, 32); }
    for (i = 0; i < check.length; i++) if (check[i] !== u[i]) throw new Error('the PDF needs a password to open; open it in a PDF viewer and copy its reference list instead');
    return { key: key, method: method, meta: meta };
  }
  function decrypt(c, data, num, gen) {
    var k = md5(concat([c.key, new Uint8Array([num & 255, (num >>> 8) & 255, (num >>> 16) & 255, gen & 255, (gen >>> 8) & 255]), c.method === 'aes' ? new Uint8Array([0x73, 0x41, 0x6C, 0x54]) : new Uint8Array(0)])).subarray(0, Math.min(16, c.key.length + 5));
    return c.method === 'aes' ? aesDecrypt(k, data) : rc4(k, data);
  }

  function Pdf(buf) {
    var b = this.b = bytesOf(buf);
    var head = latin(b, 0, Math.min(1024, b.length));
    if (head.indexOf('%PDF-') < 0) throw new Error('not a PDF file');
    this.budget = MAX_UNPACKED * 4; // every stream decoded for one file, together
    this.objs = Object.create(null); this.fonts = Object.create(null);
    var bin = latin(b), re = /(\d{1,10})\s+(\d{1,5})\s+obj\b/g, m, trailers = [], stms = [];
    while ((m = re.exec(bin))) {
      if (m.index && /[0-9]/.test(bin.charAt(m.index - 1))) continue;
      var lx = new Lexer(b, m.index + m[0].length), v;
      try { v = lx.value(true); } catch (e) { continue; }
      lx.skip();
      if (bin.substr(lx.p, 6) === 'stream' && v && typeof v === 'object') {
        var s = lx.p + 6; if (b[s] === 13) s++; if (b[s] === 10) s++;
        var len = typeof v.Length === 'number' ? v.Length : -1, e = -1;
        if (len >= 0 && s + len <= b.length && /^\s*endstream/.test(bin.substr(s + len, 20))) e = s + len;
        else { e = bin.indexOf('endstream', s); if (e < 0) e = b.length; while (e > s && (b[e - 1] === 10 || b[e - 1] === 13)) e--; }
        v = { stream: true, dict: v, start: s, end: e, num: Number(m[1]), gen: Number(m[2]) };
        re.lastIndex = Math.max(re.lastIndex, e + 9);
        if (v.dict.Type === '/ObjStm') stms.push({ v: v, off: m.index });
        if (v.dict.Type === '/XRef') trailers.push(v.dict);
      } else re.lastIndex = Math.max(re.lastIndex, lx.p);
      this.put(Number(m[1]), v, m.index);
    }
    var tre = /trailer\s*<</g;
    while ((m = tre.exec(bin))) { try { trailers.push(new Lexer(b, m.index + 7).value(true)); } catch (e2) { /* a damaged trailer */ } }
    var rootRef = null, enc = null, id = null, i;
    for (i = trailers.length - 1; i >= 0; i--) {
      var tr = trailers[i]; if (!tr) continue;
      if (!enc && tr.Encrypt) enc = this.dict(tr.Encrypt);
      if (!id && tr.ID) id = this.get(tr.ID); // a linearized file names its ID in the first page's trailer only
      if (!rootRef && tr.Root) rootRef = tr.Root;
    }
    if (enc) this.crypt = security(enc, Array.isArray(id) && id[0] && id[0].s !== undefined ? id[0].s : '', this);
    for (i = 0; i < stms.length; i++) this.unpack(stms[i].v, stms[i].off); // after the key is known: an object stream is encrypted like any other
    this.root = this.get(rootRef);
    if (!this.root || this.root.Type !== '/Catalog') for (var key in this.objs) { var o = this.objs[key].v; if (o && o.Type === '/Catalog') this.root = o; }
  }
  Pdf.prototype.put = function (num, v, off) { var had = this.objs[num]; if (!had || had.off <= off) this.objs[num] = { v: v, off: off }; };
  Pdf.prototype.unpack = function (stm, off) {
    var data = this.data(stm), n = stm.dict.N, first = stm.dict.First;
    if (!data || typeof n !== 'number' || typeof first !== 'number') return;
    var lx = new Lexer(data, 0), pairs = [];
    for (var i = 0; i < n && i < 1e6; i++) { var a = lx.value(false), c = lx.value(false); if (typeof a !== 'number' || typeof c !== 'number') break; pairs.push([a, c]); }
    for (i = 0; i < pairs.length; i++) { try { this.put(pairs[i][0], new Lexer(data, first + pairs[i][1]).value(true), off + 0.5); } catch (e) { /* skip it */ } }
  };
  Pdf.prototype.get = function (v) { for (var k = 0; v && typeof v === 'object' && v.ref !== undefined && k < 32; k++) { var o = this.objs[v.ref]; v = o ? o.v : null; } return v; };
  Pdf.prototype.dict = function (v) { v = this.get(v); return v && v.stream ? v.dict : v && typeof v === 'object' && !Array.isArray(v) && v.ref === undefined && v.s === undefined ? v : null; };
  Pdf.prototype.data = function (stm) { // a stream's decoded bytes, or null for an image or a filter not read here
    if (!stm || !stm.stream) return null;
    if (stm.decoded !== undefined) return stm.decoded;
    var f = this.get(stm.dict.Filter), data = this.b.subarray(stm.start, stm.end), c = this.crypt;
    f = !f ? [] : Array.isArray(f) ? f.map(this.get, this) : [f];
    if (c && c.method && stm.num !== undefined && stm.dict.Type !== '/XRef' && !(stm.dict.Type === '/Metadata' && !c.meta)) data = decrypt(c, data, stm.num, stm.gen);
    for (var i = 0; i < f.length && data; i++) {
      var name = f[i];
      if (name === '/FlateDecode' || name === '/Fl') {
        try { data = inflate(data, { max: Math.max(0, Math.min(MAX_UNPACKED, this.budget)) }); } catch (e) { throw new Error('a stream in the file unpacks to more than ' + Math.round(MAX_UNPACKED / 1048576) + ' MB, which no manuscript does'); }
        this.budget -= data.length;
      }
      else if (name === '/ASCIIHexDecode' || name === '/AHx') data = asciiHex(data);
      else if (name === '/ASCII85Decode' || name === '/A85') data = ascii85(data);
      else if (name === '/LZWDecode' || name === '/LZW') { data = lzw(data, this.get(Array.isArray(stm.dict.DecodeParms) ? stm.dict.DecodeParms[i] : stm.dict.DecodeParms)); this.budget -= data.length; }
      else if (name === '/RunLengthDecode' || name === '/RL') data = runLength(data);
      else if (name === '/Crypt') { /* decrypted above */ }
      else data = null; // images (DCT, JPX, CCITT, JBIG2) and anything else: never text
      if (this.budget < 0) throw new Error('the file would unpack to more than ' + Math.round(MAX_UNPACKED * 4 / 1048576) + ' MB of text and drawings, which no manuscript does');
    }
    var dp = this.dict(Array.isArray(stm.dict.DecodeParms) ? stm.dict.DecodeParms[f.length - 1] : stm.dict.DecodeParms);
    if (data && dp && dp.Predictor >= 10) data = pngPredictor(data, dp.Columns || 1, dp.Colors || 1, dp.BitsPerComponent || 8);
    stm.decoded = data;
    return data;
  };
  function asciiHex(d) { var s = latin(d).replace(/>[\s\S]*$/, '').replace(/[^0-9A-Fa-f]/g, ''), out = new Uint8Array(Math.ceil(s.length / 2)); for (var i = 0; i < s.length; i += 2) out[i / 2] = parseInt((s.substr(i, 2) + '0').slice(0, 2), 16); return out; }
  function ascii85(d) {
    var s = latin(d).replace(/^\s*<~/, '').replace(/~>[\s\S]*$/, '').replace(/\s+/g, ''), out = [], tup = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 122 && !tup.length) { out.push(0, 0, 0, 0); continue; }
      if (c < 33 || c > 117) continue;
      tup.push(c - 33);
      if (tup.length === 5) { var v = (((tup[0] * 85 + tup[1]) * 85 + tup[2]) * 85 + tup[3]) * 85 + tup[4]; out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); tup = []; }
    }
    if (tup.length > 1) { var k = tup.length; while (tup.length < 5) tup.push(84); var w = (((tup[0] * 85 + tup[1]) * 85 + tup[2]) * 85 + tup[3]) * 85 + tup[4]; for (var j = 0; j < k - 1; j++) out.push((w >>> (24 - 8 * j)) & 255); }
    return new Uint8Array(out);
  }
  function lzw(d, parms) {
    var early = parms && parms.EarlyChange === 0 ? 0 : 1, out = [], dict = [], bits = 9, buf = 0, nb = 0, prev = null, i;
    var reset = function () { dict = []; for (var k = 0; k < 256; k++) dict[k] = [k]; dict[256] = null; dict[257] = null; bits = 9; prev = null; };
    reset();
    for (i = 0; i < d.length; i++) {
      buf = ((buf << 8) | d[i]) >>> 0; nb += 8;
      while (nb >= bits) {
        var code = (buf >>> (nb - bits)) & ((1 << bits) - 1); nb -= bits;
        if (code === 256) { reset(); continue; }
        if (code === 257) return new Uint8Array(out);
        var entry = code < dict.length && dict[code] ? dict[code] : prev ? prev.concat([prev[0]]) : null;
        if (!entry) return new Uint8Array(out);
        for (var k = 0; k < entry.length; k++) out.push(entry[k]);
        if (out.length > MAX_UNPACKED) throw new Error('unpacks to more than ' + Math.round(MAX_UNPACKED / 1048576) + ' MB');
        if (prev) dict.push(prev.concat([entry[0]]));
        prev = entry;
        if (dict.length + early >= (1 << bits) && bits < 12) bits++;
      }
      buf &= (1 << nb) - 1;
    }
    return new Uint8Array(out);
  }
  function runLength(d) { var out = []; for (var i = 0; i < d.length;) { var n = d[i++]; if (n === 128) break; if (n < 128) { for (var k = 0; k <= n && i < d.length; k++) out.push(d[i++]); } else { for (k = 0; k < 257 - n; k++) out.push(d[i]); i++; } } return new Uint8Array(out); }
  function pngPredictor(d, cols, colors, bpc) { // rows prefixed by a filter byte, as in an xref or object stream
    var bpp = Math.max(1, Math.ceil(colors * bpc / 8)), row = Math.ceil(cols * colors * bpc / 8), out = new Uint8Array(Math.floor(d.length / (row + 1)) * row), prev = new Uint8Array(row);
    for (var r = 0, o = 0; (r + 1) * (row + 1) <= d.length; r++) {
      var t = d[r * (row + 1)], cur = d.subarray(r * (row + 1) + 1, (r + 1) * (row + 1)), line = new Uint8Array(row);
      for (var i = 0; i < row; i++) {
        var a = i >= bpp ? line[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0, x = cur[i];
        if (t === 1) x += a; else if (t === 2) x += up; else if (t === 3) x += (a + up) >> 1;
        else if (t === 4) { var p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); x += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
        line[i] = x & 255;
      }
      out.set(line, o); o += row; prev = line;
    }
    return out;
  }

  /* ---------- PDF: fonts ----------
   * Each code of a shown string becomes text through the font's ToUnicode map, else its encoding's glyph names; its width
   * moves the pen, which is how word gaps and line ends are found. */
  var STD_HI = { 0xA1: '¡', 0xA2: '¢', 0xA3: '£', 0xA4: '⁄', 0xA5: '¥', 0xA6: 'ƒ', 0xA7: '§', 0xA8: '¤', 0xA9: "'", 0xAA: '“', 0xAB: '«', 0xAC: '‹', 0xAD: '›', 0xAE: 'ﬁ', 0xAF: 'ﬂ', 0xB1: '–', 0xB2: '†', 0xB3: '‡', 0xB4: '·', 0xB6: '¶', 0xB7: '•', 0xB8: '‚', 0xB9: '„', 0xBA: '”', 0xBB: '»', 0xBC: '…', 0xBD: '‰', 0xBF: '¿', 0xC1: '`', 0xC2: '´', 0xC3: 'ˆ', 0xC4: '˜', 0xC5: '¯', 0xC6: '˘', 0xC7: '˙', 0xC8: '¨', 0xCA: '˚', 0xCB: '¸', 0xCD: '˝', 0xCE: '˛', 0xCF: 'ˇ', 0xD0: '—', 0xE1: 'Æ', 0xE3: 'ª', 0xE8: 'Ł', 0xE9: 'Ø', 0xEA: 'Œ', 0xEB: 'º', 0xF1: 'æ', 0xF5: 'ı', 0xF8: 'ł', 0xF9: 'ø', 0xFA: 'œ', 0xFB: 'ß' };
  var WIN_80 = '€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž��‘’“”•–—˜™š›œ�žŸ';
  var MAC_80 = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
  function baseEncoding(name) { // code -> text for a named encoding
    var t = [], i;
    for (i = 0; i < 256; i++) t[i] = i >= 32 && i < 127 ? String.fromCharCode(i) : '';
    if (name === '/MacRomanEncoding') { for (i = 128; i < 256; i++) t[i] = MAC_80.charAt(i - 128); t[39] = "'"; }
    else if (name === '/StandardEncoding') { t[39] = '’'; t[96] = '‘'; for (i = 128; i < 256; i++) t[i] = STD_HI[i] || ''; }
    else { for (i = 128; i < 160; i++) t[i] = WIN_80.charAt(i - 128).replace('�', ''); for (i = 160; i < 256; i++) t[i] = String.fromCharCode(i); t[160] = ' '; t[173] = '-'; }
    return t;
  }
  var GLYPHS = { space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '’', parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', quoteleft: '‘', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
    exclamdown: '¡', cent: '¢', sterling: '£', fraction: '⁄', yen: '¥', florin: 'ƒ', section: '§', currency: '¤', quotedblleft: '“', guillemotleft: '«', guilsinglleft: '‹', guilsinglright: '›', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', endash: '–', dagger: '†', daggerdbl: '‡', periodcentered: '·', paragraph: '¶', bullet: '•', quotesinglbase: '‚', quotedblbase: '„', quotedblright: '”', guillemotright: '»', ellipsis: '…', perthousand: '‰', questiondown: '¿', emdash: '—',
    AE: 'Æ', ae: 'æ', OE: 'Œ', oe: 'œ', Oslash: 'Ø', oslash: 'ø', Lslash: 'Ł', lslash: 'ł', dotlessi: 'ı', dotlessj: 'ȷ', germandbls: 'ß', Eth: 'Ð', eth: 'ð', Thorn: 'Þ', thorn: 'þ', ordfeminine: 'ª', ordmasculine: 'º',
    acute: '´', circumflex: 'ˆ', tilde: '˜', macron: '¯', breve: '˘', dotaccent: '˙', dieresis: '¨', ring: '˚', cedilla: '¸', hungarumlaut: '˝', ogonek: '˛', caron: 'ˇ',
    minus: '−', multiply: '×', divide: '÷', degree: '°', plusminus: '±', mu: 'μ', mu1: 'µ', registered: '®', copyright: '©', trademark: '™', onesuperior: '¹', twosuperior: '²', threesuperior: '³', onehalf: '½', onequarter: '¼', threequarters: '¾', logicalnot: '¬', brokenbar: '¦', nbspace: ' ', nonbreakingspace: ' ', sfthyphen: '-', softhyphen: '-', Euro: '€', prime: '′', minute: '′', second: '″', angstrom: 'Å', Angstrom: 'Å', approxequal: '≈', notequal: '≠', lessequal: '≤', greaterequal: '≥', infinity: '∞', arrowright: '→', arrowleft: '←', visiblespace: ' ', quotedblreversed: '‟' };
  'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho - Sigma Tau Upsilon Phi Chi Psi Omega'.split(' ').forEach(function (g, i) { if (g !== '-') { GLYPHS[g] = String.fromCharCode(0x391 + i); GLYPHS[g.toLowerCase()] = String.fromCharCode(0x3B1 + i); } });
  GLYPHS.sigma1 = 'ς'; GLYPHS.theta1 = 'ϑ'; GLYPHS.phi1 = 'ϕ'; GLYPHS.omega1 = 'ϖ'; GLYPHS.Ohm = 'Ω';
  var ACCENTS = { acute: '́', grave: '̀', circumflex: '̂', tilde: '̃', dieresis: '̈', ring: '̊', cedilla: '̧', caron: '̌', breve: '̆', macron: '̄', ogonek: '̨', dotaccent: '̇', hungarumlaut: '̋', commaaccent: '̦' };
  function glyphText(name) {
    name = String(name || '').replace(/^\//, '');
    if (GLYPHS[name] !== undefined) return GLYPHS[name];
    var m = name.match(/^uni((?:[0-9A-Fa-f]{4})+)$/);
    if (m) { var s = ''; for (var i = 0; i < m[1].length; i += 4) s += String.fromCharCode(parseInt(m[1].substr(i, 4), 16)); return s; }
    if ((m = name.match(/^u([0-9A-Fa-f]{4,6})$/))) { var cp = parseInt(m[1], 16); return cp <= 0x10FFFF ? String.fromCodePoint(cp) : ''; }
    if (/^[A-Za-z]$/.test(name)) return name;
    if ((m = name.match(/^([A-Za-z])(acute|grave|circumflex|tilde|dieresis|ring|cedilla|caron|breve|macron|ogonek|dotaccent|hungarumlaut|commaaccent)$/))) return (m[1] + ACCENTS[m[2]]).normalize ? (m[1] + ACCENTS[m[2]]).normalize('NFC') : m[1];
    if (name.indexOf('.') > 0) return glyphText(name.split('.')[0]); // "a.sc", "one.oldstyle"
    if (name.indexOf('_') > 0) return name.split('_').map(glyphText).join(''); // "f_f_i"
    return '';
  }
  function utf16(s) { // a ToUnicode destination: UTF-16BE bytes
    var out = '';
    for (var i = 0; i + 1 < s.length; i += 2) { var c = (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1); if (c) out += String.fromCharCode(c); }
    if (s.length % 2) out += String.fromCharCode(s.charCodeAt(s.length - 1));
    return out;
  }
  function codeOf(s) { var c = 0; for (var i = 0; i < s.length; i++) c = c * 256 + s.charCodeAt(i); return c; }
  Pdf.prototype.cmap = function (stm, font) { // a ToUnicode map fills font.uni; an embedded CMap's code space fills font.cs, when the target has those
    var data = this.data(this.get(stm)); if (!data) return;
    var lx = new Lexer(data, 0), args = [], v, k;
    for (var guard = 0; guard < 2e6; guard++) {
      try { v = lx.value(false); } catch (e) { break; }
      if (v === undefined) break;
      if (!v || v.op === undefined) { args.push(v); continue; }
      var op = v.op;
      if (op === 'endcodespacerange') {
        if (font.cs !== undefined) for (k = 0; k + 1 < args.length; k += 2) if (args[k] && args[k].s !== undefined && args[k + 1] && args[k + 1].s !== undefined) (font.cs = font.cs || []).push({ len: args[k].s.length, lo: args[k].s, hi: args[k + 1].s });
      } else if (op === 'endbfchar' && font.uni) {
        for (k = 0; k + 1 < args.length; k += 2) if (args[k] && args[k].s !== undefined) font.uni[codeOf(args[k].s)] = args[k + 1] && args[k + 1].s !== undefined ? utf16(args[k + 1].s) : typeof args[k + 1] === 'string' ? glyphText(args[k + 1]) : '';
      } else if (op === 'endbfrange' && font.uni) {
        for (k = 0; k + 2 < args.length; k += 3) {
          if (!args[k] || args[k].s === undefined || !args[k + 1] || args[k + 1].s === undefined) continue;
          var lo = codeOf(args[k].s), hi = codeOf(args[k + 1].s), dst = args[k + 2];
          if (hi < lo || hi - lo > 65535) continue;
          for (var c = lo; c <= hi; c++) {
            if (Array.isArray(dst)) { var d = dst[c - lo]; font.uni[c] = d && d.s !== undefined ? utf16(d.s) : ''; }
            else if (dst && dst.s !== undefined) { var u = utf16(dst.s); font.uni[c] = u ? u.slice(0, -1) + String.fromCharCode(u.charCodeAt(u.length - 1) + c - lo) : ''; } // the last character counts up
          }
        }
      }
      args = [];
    }
  };
  var STD_WIDTHS = { // the Times-Roman and Helvetica widths of ASCII 32-126, for a standard font shown without its own widths
    times: [250, 333, 408, 500, 500, 833, 778, 333, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541],
    helvetica: [278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 222, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
  };
  Pdf.prototype.font = function (ref) {
    var key = ref && ref.ref !== undefined ? 'r' + ref.ref : null;
    if (key && this.fonts[key]) return this.fonts[key];
    var fd = this.dict(ref) || Object.create(null), font = { uni: Object.create(null), cs: null, two: fd.Subtype === '/Type0', enc: null, w: Object.create(null), dw: 0, scale: 0.001, has: false };
    var base = String(fd.BaseFont || '').replace(/^\/([A-Z]{6}\+)?/, '');
    if (fd.ToUnicode) { this.cmap(fd.ToUnicode, { uni: font.uni }); font.has = Object.keys(font.uni).length > 0; } // its code space is not trusted: a simple font's codes are one byte whatever its map says
    if (font.two) {
      var enc = this.get(fd.Encoding), cs = { uni: null, cs: null };
      if (enc && enc.stream) this.cmap(enc, cs);
      font.cs = cs.cs && cs.cs.length ? cs.cs : [{ len: 2, lo: '\x00\x00', hi: '\xFF\xFF' }]; // Identity-H and the other predefined CMaps
      var desc = this.dict((this.get(fd.DescendantFonts) || [])[0]) || Object.create(null), W = this.get(desc.W) || [];
      font.dw = typeof desc.DW === 'number' ? desc.DW : 1000;
      for (var i = 0; i < W.length;) {
        var first = this.get(W[i]), nx = this.get(W[i + 1]);
        if (Array.isArray(nx)) { for (var j = 0; j < nx.length; j++) font.w[first + j] = this.get(nx[j]); i += 2; }
        else { var wv = this.get(W[i + 2]); for (var c2 = first; c2 <= nx && c2 - first < 65536; c2++) font.w[c2] = wv; i += 3; }
      }
    } else {
      var e = this.get(fd.Encoding), table, desc2 = this.dict(fd.FontDescriptor) || Object.create(null);
      var symbolic = /^(?:Symbol|ZapfDingbats)/.test(base) || (fd.Subtype !== '/TrueType' && (desc2.Flags & 4) && !(desc2.Flags & 32) && !e);
      if (typeof e === 'string') table = baseEncoding(e);
      else if (e && typeof e === 'object') {
        table = baseEncoding(this.get(e.BaseEncoding) || (fd.Subtype === '/TrueType' ? '/WinAnsiEncoding' : '/StandardEncoding'));
        var diff = this.get(e.Differences) || [], code = 0;
        for (var d = 0; d < diff.length; d++) { var x = this.get(diff[d]); if (typeof x === 'number') code = x; else if (typeof x === 'string') table[code++] = glyphText(x); }
      } else table = baseEncoding(fd.Subtype === '/TrueType' || !/^(Times|Helvetica|Courier|Arial)/.test(base) ? '/WinAnsiEncoding' : '/StandardEncoding');
      if (/^Symbol/.test(base) && !font.has) { table = []; for (var g = 0; g < 256; g++) table[g] = ''; 'alpha beta chi delta epsilon phi gamma eta iota phi1 kappa lambda mu nu omicron pi theta rho sigma tau upsilon omega1 omega xi psi zeta'.split(' ').forEach(function (n, k) { table[97 + k] = glyphText(n); table[65 + k] = glyphText(n.charAt(0).toUpperCase() + n.slice(1)); }); table[176] = '°'; table[177] = '±'; table[180] = '×'; table[45] = '−'; table[163] = '≤'; table[179] = '≥'; table[187] = '≈'; table[32] = ' '; table[40] = '('; table[41] = ')'; table[44] = ','; table[46] = '.'; table[47] = '/'; table[43] = '+'; table[61] = '='; table[60] = '<'; table[62] = '>'; for (var dg = 48; dg < 58; dg++) table[dg] = String.fromCharCode(dg); }
      else if (symbolic && !e && !font.has && /^ZapfDingbats/.test(base)) table = [];
      font.enc = table;
      var ws = this.get(fd.Widths), fc = this.get(fd.FirstChar) || 0;
      if (Array.isArray(ws)) for (var k = 0; k < ws.length; k++) font.w[fc + k] = this.get(ws[k]);
      else { var std = /Courier/.test(base) ? null : /Times|Roman|Serif/.test(base) ? STD_WIDTHS.times : STD_WIDTHS.helvetica; for (var q = 32; q < 127; q++) font.w[q] = std ? std[q - 32] : 600; }
      font.dw = typeof desc2.MissingWidth === 'number' && desc2.MissingWidth ? desc2.MissingWidth : 500;
      if (fd.Subtype === '/Type3') { var fm = this.get(fd.FontMatrix); font.scale = Array.isArray(fm) && typeof fm[0] === 'number' ? Math.abs(fm[0]) : 0.001; }
    }
    if (key) this.fonts[key] = font;
    return font;
  };
  function codes(font, s) { // a shown string's codes: one byte each in a simple font, the CMap's code space in a composite one
    var out = [], i = 0;
    if (!font.two) { for (; i < s.length; i++) out.push(s.charCodeAt(i)); return out; }
    var cs = font.cs;
    while (i < s.length) {
      var took = 0;
      for (var L = 1; L <= 4 && !took; L++) {
        for (var r = 0; r < cs.length; r++) {
          if (cs[r].len !== L || i + L > s.length) continue;
          var ok = true; for (var k = 0; k < L && ok; k++) { var c = s.charCodeAt(i + k); ok = c >= cs[r].lo.charCodeAt(k) && c <= cs[r].hi.charCodeAt(k); }
          if (ok) { took = L; break; }
        }
      }
      if (!took) took = Math.min(s.length - i, cs[0].len || 1);
      out.push(codeOf(s.substr(i, took))); out.len1 = out.len1 || took === 1; i += took;
    }
    return out;
  }
  function textOf(font, c) {
    if (font.uni[c] !== undefined) return font.uni[c];
    if (font.enc) return font.enc[c] || '';
    return ''; // a composite font with no ToUnicode map: its codes are glyph numbers, not characters
  }

  /* ---------- PDF: the text on a page ----------
   * The content stream is run with the text and graphics state that place glyphs (cm, q/Q, BT, Tf, Tm, Td, TJ...); each shown
   * string becomes a chunk with its start and end on the page and the direction it reads in.  Mirrored or skewed text is
   * left out. */
  function direction(t) { // which way a run of text reads on the page: 0 (left to right), 90 (upward), 180 (upside down), 270 (downward); -1 for none
    var a = t[0], b = t[1], c = t[2], d = t[3]; // a slanted fake italic shears c; a page scanned a degree off turns b
    if (Math.abs(b) <= 0.1 * Math.abs(a) && Math.abs(c) <= 0.4 * Math.abs(d)) return a > 0 && d > 0 ? 0 : a < 0 && d < 0 ? 180 : -1;
    if (Math.abs(a) <= 0.4 * Math.abs(b) && Math.abs(d) <= 0.1 * Math.abs(c)) return b > 0 && c < 0 ? 90 : b < 0 && c > 0 ? 270 : -1;
    return -1;
  }
  function mul(m, n) { return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]]; }
  Pdf.prototype.run = function (data, res, ctm, chunks, depth, clip) { // clip: [x0, y0, x1, y1] on the page; text outside it is not seen
    var self = this, lx = new Lexer(data, 0), args = [], st = { ctm: ctm, font: null, fs: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 }, stack = [], tm = [1, 0, 0, 1, 0, 0], tlm = tm;
    var fonts = this.dict(res && res.Font) || Object.create(null), xobjs = this.dict(res && res.XObject) || Object.create(null);
    var num = function (i) { var v = args[i]; return typeof v === 'number' ? v : 0; };
    var show = function (s) {
      var f = st.font; if (!f || typeof s !== 'string') return;
      var cs = codes(f, s), text = '', tx = 0, after = 0, from = 0, m0 = mul(tm, st.ctm), t0 = mul([st.fs * st.th, 0, 0, st.fs, 0, st.rise], m0);
      var size = Math.sqrt(t0[2] * t0[2] + t0[3] * t0[3]) * (f.scale * 1000), dir = direction(t0), space = (typeof f.w[32] === 'number' && f.w[32] > 0 ? f.w[32] * f.scale * 1000 : 250) * size / 1000;
      var emit = function (a, b, t) { // the text between two pen positions; its end is the last glyph's edge, as the spacing after a glyph is not ink and a negative one would open a false gap
        if (!t || !(size > 0.5) || dir < 0) return; // mirrored, skewed or degenerate
        var p = mul([1, 0, 0, 1, a, st.rise], m0), e = mul([1, 0, 0, 1, b, st.rise], m0);
        if (p[4] < clip[0] - 2 || p[4] > clip[2] + 2 || p[5] < clip[1] - 2 || p[5] > clip[3] + 2) return; // off the page, or outside a figure's box
        chunks.push({ x: p[4], y: p[5], ex: e[4], ey: e[5], dir: dir, size: size, text: t, space: space });
      };
      for (var i = 0; i < cs.length; i++) {
        var c = cs[i], w = f.w[c], u = textOf(f, c); if (typeof w !== 'number') w = f.dw;
        var adv = w * f.scale * st.fs * st.th, gap = (st.tc + (c === 32 && (!f.two || cs.len1) ? st.tw : 0)) * st.th;
        if (ACCENT[u]) { emit(from, tx - after, text); emit(tx, tx + adv, u); text = ''; from = tx + adv + gap; } // an accent set as a glyph of its own: placed by where it sits (linesOf)
        else text += u;
        tx += adv + gap; after = gap;
      }
      emit(from, tx - after, text);
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + tx * tm[0], tm[5] + tx * tm[1]];
    };
    for (var guard = 0; guard < 5e7; guard++) {
      var v;
      try { v = lx.value(false); } catch (e) { break; }
      if (v === undefined) break;
      if (v === null || typeof v !== 'object' || v.op === undefined) { args.push(v); if (args.length > 64) args.shift(); continue; }
      switch (v.op) {
        case 'q': stack.push({ ctm: st.ctm, font: st.font, fs: st.fs, tc: st.tc, tw: st.tw, th: st.th, tl: st.tl, rise: st.rise }); if (stack.length > 256) stack.shift(); break;
        case 'Q': if (stack.length) st = stack.pop(); break;
        case 'cm': if (args.length >= 6) st.ctm = mul([num(args.length - 6), num(args.length - 5), num(args.length - 4), num(args.length - 3), num(args.length - 2), num(args.length - 1)], st.ctm); break;
        case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; break;
        case 'Tf': if (args.length >= 2) { st.font = this.font(fonts[String(args[args.length - 2]).slice(1)]); st.fs = num(args.length - 1); } break;
        case 'Tc': st.tc = num(args.length - 1); break;
        case 'Tw': st.tw = num(args.length - 1); break;
        case 'Tz': st.th = num(args.length - 1) / 100; break;
        case 'TL': st.tl = num(args.length - 1); break;
        case 'Ts': st.rise = num(args.length - 1); break;
        case 'Td': case 'TD': if (args.length >= 2) { var dx = num(args.length - 2), dy = num(args.length - 1); if (v.op === 'TD') st.tl = -dy; tm = tlm = [tlm[0], tlm[1], tlm[2], tlm[3], dx * tlm[0] + dy * tlm[2] + tlm[4], dx * tlm[1] + dy * tlm[3] + tlm[5]]; } break;
        case 'Tm': if (args.length >= 6) tm = tlm = [num(args.length - 6), num(args.length - 5), num(args.length - 4), num(args.length - 3), num(args.length - 2), num(args.length - 1)]; break;
        case 'T*': tm = tlm = [tlm[0], tlm[1], tlm[2], tlm[3], -st.tl * tlm[2] + tlm[4], -st.tl * tlm[3] + tlm[5]]; break;
        case 'Tj': if (args.length) show(args[args.length - 1] && args[args.length - 1].s); break;
        case "'": case '"':
          if (v.op === '"' && args.length >= 3) { st.tw = num(args.length - 3); st.tc = num(args.length - 2); }
          tm = tlm = [tlm[0], tlm[1], tlm[2], tlm[3], -st.tl * tlm[2] + tlm[4], -st.tl * tlm[3] + tlm[5]];
          if (args.length) show(args[args.length - 1] && args[args.length - 1].s);
          break;
        case 'TJ':
          var arr = args[args.length - 1];
          if (Array.isArray(arr)) for (var i = 0; i < arr.length; i++) {
            if (typeof arr[i] === 'number') { var adj = -arr[i] / 1000 * st.fs * st.th; tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + adj * tm[0], tm[5] + adj * tm[1]]; }
            else if (arr[i] && arr[i].s !== undefined) show(arr[i].s);
          }
          break;
        case 'Do':
          var xo = this.get(xobjs[String(args[args.length - 1]).slice(1)]);
          if (xo && xo.stream && xo.dict.Subtype === '/Form' && depth < 12) {
            var fm = this.get(xo.dict.Matrix), m6 = Array.isArray(fm) && fm.length === 6 ? fm.map(function (x) { return Number(self.get(x)) || 0; }) : [1, 0, 0, 1, 0, 0];
            var fctm = mul(m6, st.ctm), bb = this.get(xo.dict.BBox), fclip = clip;
            if (Array.isArray(bb) && bb.length === 4) { // a figure drawn from another PDF's page keeps that page's text, hidden outside the figure's box
              var bx = bb.map(function (x) { return Number(self.get(x)) || 0; }), xs = [], ys = [];
              [[bx[0], bx[1]], [bx[2], bx[1]], [bx[0], bx[3]], [bx[2], bx[3]]].forEach(function (pt) { xs.push(pt[0] * fctm[0] + pt[1] * fctm[2] + fctm[4]); ys.push(pt[0] * fctm[1] + pt[1] * fctm[3] + fctm[5]); });
              fclip = [Math.max(clip[0], Math.min.apply(null, xs)), Math.max(clip[1], Math.min.apply(null, ys)), Math.min(clip[2], Math.max.apply(null, xs)), Math.min(clip[3], Math.max.apply(null, ys))];
            }
            var xd = this.data(xo); if (xd) this.run(xd, this.dict(xo.dict.Resources) || res, fctm, chunks, depth + 1, fclip);
          }
          break;
        case 'BI': // an inline image: its data runs to "EI"
          var b = lx.b, p = lx.p;
          while (p + 1 < b.length && !(WS[b[p - 1]] && b[p] === 73 && b[p + 1] === 68 && (p + 2 >= b.length || WS[b[p + 2]]))) p++;
          p += 3;
          while (p + 1 < b.length && !(WS[b[p - 1]] && b[p] === 69 && b[p + 1] === 73 && (p + 2 >= b.length || WS[b[p + 2]] || DELIM[b[p + 2]]))) p++;
          lx.p = p + 2;
          break;
      }
      args = [];
    }
  };
  Pdf.prototype.pages = function () { // [{dict, res, box}] in reading order
    var self = this, out = [], seen = Object.create(null);
    var walk = function (ref, inh, depth) {
      var node = self.dict(ref); if (!node || depth > 64) return;
      if (ref && ref.ref !== undefined) { if (seen[ref.ref]) return; seen[ref.ref] = true; }
      var here = { res: node.Resources !== undefined ? self.dict(node.Resources) : inh.res, box: self.get(node.CropBox) || self.get(node.MediaBox) || inh.box };
      var kids = self.get(node.Kids);
      if (Array.isArray(kids) && node.Type !== '/Page') { for (var i = 0; i < kids.length; i++) walk(kids[i], here, depth + 1); return; }
      out.push({ dict: node, res: here.res, box: here.box });
    };
    if (this.root) walk(this.root.Pages, { res: null, box: null }, 0);
    if (!out.length) { // no page tree: every page object, in file order
      Object.keys(this.objs).map(function (k) { return self.objs[k]; }).filter(function (o) { return o.v && o.v.Type === '/Page'; }).sort(function (a, b) { return a.off - b.off; })
        .forEach(function (o) { out.push({ dict: o.v, res: self.dict(o.v.Resources), box: self.get(o.v.MediaBox) }); });
    }
    return out;
  };
  Pdf.prototype.pageChunks = function (pg) {
    var box = Array.isArray(pg.box) && pg.box.length === 4 ? pg.box.map(function (x) { return Number(this.get(x)) || 0; }, this) : [0, 0, 612, 792];
    var w = Math.abs(box[2] - box[0]), h = Math.abs(box[3] - box[1]), x0 = Math.min(box[0], box[2]), y0 = Math.min(box[1], box[3]);
    var contents = this.get(pg.dict.Contents), parts = !contents ? [] : Array.isArray(contents) ? contents : [contents], datas = [], total = 0;
    for (var i = 0; i < parts.length; i++) { var d = this.data(this.get(parts[i])); if (d) { datas.push(d); total += d.length + 1; } }
    var all = new Uint8Array(total), o = 0;
    for (i = 0; i < datas.length; i++) { all.set(datas[i], o); o += datas[i].length; all[o++] = 10; } // the parts are one stream, split anywhere
    var chunks = [], weight = [0, 0, 0, 0];
    this.run(all, pg.res, [1, 0, 0, 1, -x0, -y0], chunks, 0, [0, 0, w, h]);
    // The page is read the way most of its text runs, whatever its /Rotate says (a page turned by mistake reads as well as a
    // landscape table); text running any other way is a stamp, a label or a watermark, and is left out.
    chunks.forEach(function (c) { weight[c.dir / 90] += c.text.length; });
    var dir = weight.indexOf(Math.max.apply(null, weight)) * 90;
    var turn = [function (x, y) { return [x, y]; }, function (x, y) { return [y, w - x]; }, function (x, y) { return [w - x, h - y]; }, function (x, y) { return [h - y, x]; }][dir / 90];
    chunks = chunks.filter(function (c) { return c.dir === dir; }).map(function (c) { var p = turn(c.x, c.y), e = turn(c.ex, c.ey); return { x: p[0], y: p[1], x1: e[0], size: c.size, text: c.text, space: c.space }; });
    return { chunks: chunks, height: dir === 90 || dir === 270 ? w : h };
  };

  /* ---------- PDF: lines ----------
   * Chunks join a line while they sit on its baseline; a gap wider than a fraction of a space is a space.  A smaller chunk
   * raised or lowered off the baseline is a superscript or subscript (Fe³⁺, ⁴⁰Ar), as a paste from Word gives it. */
  function clean(t) {
    return t.replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl').replace(/[ﬅﬆ]/g, 'st')
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F�-]/g, '').replace(/[\t  -  ]/g, ' ');
  }
  // TeX and some typesetters draw an accent as a glyph of its own over its letter, before or after it ("Zieli\u00B4nski", "Kra\u00A8mer"):
  // it becomes the combining mark on the letter it overlaps
  var ACCENT = { '\u00A8': '\u0308', '\u00B4': '\u0301', '`': '\u0300', '\u02C6': '\u0302', '\u02DC': '\u0303', '\u02C7': '\u030C', '\u02D8': '\u0306', '\u02DA': '\u030A', '\u00B8': '\u0327', '\u02DB': '\u0328', '\u02DD': '\u030B', '\u02D9': '\u0307', '\u00AF': '\u0304' };
  function linesOf(chunks) {
    var lines = [], cur = null, pending = null; // pending: an accent that sits over the next chunk's first letter
    var drop = function () { if (pending && cur) cur.text += pending.ch; pending = null; };
    for (var i = 0; i < chunks.length; i++) {
      var c = chunks[i], t = clean(c.text);
      if (!t.trim()) continue;
      if (cur && ACCENT[t] && Math.abs(c.y - cur.y) < 0.8 * Math.max(cur.size, c.size)) { // set higher or lower than the line, by its nature
        var cx = (c.x + c.x1) / 2;
        drop();
        if (cx <= cur.x1 + 0.05 * c.size && /[A-Za-z\u0131\u0237]$/.test(cur.text)) cur.text += ACCENT[t];
        else pending = { ch: t, mark: ACCENT[t], cx: cx };
        continue;
      }
      if (pending) {
        if (cur && c.x <= pending.cx && Math.abs(c.y - cur.y) < 0.6 * Math.max(cur.size, c.size) && /^[A-Za-z\u0131\u0237]/.test(t)) { t = t.charAt(0) + pending.mark + t.slice(1); pending = null; }
        else drop();
      }
      if (cur) {
        var dy = c.y - cur.y, big = Math.max(cur.size, c.size), gap = c.x - cur.x1;
        if (Math.abs(dy) < 0.6 * big && c.x > cur.lastX - 0.6 * big && gap < 4 * big) { // back as far as the last chunk's start: a subscript set under a superscript (Fe²⁺₂)
          if (t === cur.last && Math.abs(c.x - cur.lastX) < Math.min(0.1 * c.size, 0.5 * (c.x1 - c.x))) continue; // the same text struck twice, a hair apart, for a bold effect; not a doubled narrow letter ("Elliott", "Newsletter")
          var script = c.size < 0.85 * cur.size && Math.abs(dy) > 0.15 * cur.size && /^[\d+−\-=()a-zA-Z,.\s]{1,8}$/.test(t.trim()) ? (dy > 0 ? 'sup' : 'sub') : '';
          if (gap > Math.max(0.12 * big, 0.4 * Math.min(c.space || big * 0.25, big * 0.3)) && !/\s$/.test(cur.text) && !/^\s/.test(t) && !script) cur.text += ' ';
          cur.text += script && A && A.toScript ? A.toScript(t.trim(), script) : t;
          if (c.size > cur.size * 1.05 && !script) { cur.size = c.size; cur.y = c.y; }
          cur.x1 = Math.max(cur.x1, c.x1); cur.last = t; cur.lastX = c.x;
          continue;
        }
      }
      cur = { x: c.x + (t.length - t.replace(/^\s+/, '').length) * (c.space || c.size * 0.25), y: c.y, x1: c.x1, size: c.size, text: t, last: t, lastX: c.x };
      lines.push(cur);
    }
    drop();
    return lines.map(function (l) {
      l.text = l.text.replace(/\u0131(?=[\u0300-\u030C\u0326-\u0328])/g, 'i').replace(/\u0237(?=[\u0300-\u030C])/g, 'j').replace(/\s+/g, ' ').trim(); // a dotless i under its accent is an i
      if (l.text.normalize) l.text = l.text.normalize('NFC');
      return l;
    }).filter(function (l) { return l.text; });
  }
  function furniture(pages) { // running heads, footers and page numbers: a line near the top or foot of the page that recurs, its digits aside, on other pages
    var count = Object.create(null), key = function (l) { return l.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ''); };
    var edge = function (l, pg) { return l.y > pg.height * 0.9 || l.y < pg.height * 0.08; };
    pages.forEach(function (pg) { var seen = Object.create(null); pg.lines.forEach(function (l) { if (edge(l, pg)) { var k = key(l); if (!seen[k]) { seen[k] = true; count[k] = (count[k] || 0) + 1; } } }); });
    var many = Math.max(2, Math.min(3, Math.ceil(pages.length * 0.3)));
    pages.forEach(function (pg) { pg.lines = pg.lines.filter(function (l) { return !(edge(l, pg) && (count[key(l)] >= many || /^(?:\d{1,4}|[ivxlc]{1,6}|page \d+(?: of \d+)?|\d+ of \d+)$/i.test(l.text))); }); });
  }
  function layout(lines) { // text lines for the splitter: a leading space where a line starts right of its column's edge, a blank line at a wider gap
    var out = [], run = [];
    var flush = function () {
      if (!run.length) return;
      var left = Infinity, gaps = [];
      run.forEach(function (l, i) { if (l.x < left) left = l.x; if (i) gaps.push(run[i - 1].y - l.y); });
      var sorted = gaps.slice().sort(function (a, b) { return a - b; }), med = sorted[(sorted.length - 1) >> 1] || 0; // the lower middle: within an entry the lines are closer
      var inset = function (l) { return l.x - left > 0.6 * l.size; }, ins = run.filter(inset), flat = run.filter(function (l) { return !inset(l); });
      var opens = function (list) { return list.filter(function (l) { return REF_OPENS.test(l.text) || fullRef(l.text); }).length; };
      var firstLine = ins.length >= 2 && opens(ins) >= 0.6 * ins.length && opens(flat) <= 0.25 * flat.length; // each entry's first line set in, the rest flush: the reverse of a hanging indent
      run.forEach(function (l, i) {
        if (i && run.length >= 4 && med > 0 && gaps[i - 1] > 1.6 * med && gaps[i - 1] < 6 * med) out.push('');
        out.push((inset(l) !== firstLine ? ' ' : '') + l.text); // given to the splitter as a hanging indent either way
      });
      run = [];
    };
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], p = run[run.length - 1];
      if (l.page !== undefined && p && (l.page !== p.page || l.y > p.y + 0.6 * l.size || Math.abs(l.x - p.x) > 12 * l.size)) flush(); // a new page or column: the run's edge and spacing are its own
      run.push(l);
    }
    flush();
    return out;
  }
  function pdfPages(buf) { // [{lines: [{x, y, size, text}], height}] for every page; throws on an encrypted or unreadable file
    var pdf = new Pdf(buf);
    var pages = pdf.pages();
    if (!pages.length) throw new Error('no pages found: the PDF is damaged');
    return pages.map(function (pg, n) {
      var r; try { r = pdf.pageChunks(pg); } catch (e) { if (/more than/.test(e.message)) throw e; r = { chunks: [], height: 792 }; }
      var lines = linesOf(r.chunks), col = Object.create(null);
      lines.forEach(function (l) { l.page = n; if (/^\d{1,5}$/.test(l.text)) { var k = Math.round(l.x / 4); col[k] = (col[k] || 0) + 1; } });
      lines = lines.filter(function (l) { return !(/^\d{1,5}$/.test(l.text) && col[Math.round(l.x / 4)] >= 8); }); // a manuscript's line numbers: a column of bare numbers down the margin
      return { lines: lines, height: r.height };
    });
  }
  function readPdf(buf) {
    var pages = pdfPages(buf), all = [];
    if (!pages.some(function (p) { return p.lines.length; })) throw new Error('the PDF has no text to read; a scanned page is a picture of text');
    furniture(pages);
    pages.forEach(function (p) { all = all.concat(p.lines); });
    var start = -1, i;
    start = headingAt(all.map(function (l) { return l.text; }));
    if (start < 0 && !looksLikeList(layout(all))) throw new Error('no References heading, and the text does not read as a reference list');
    var body = all.map(function (l) { return l.size; }).sort(function (a, b) { return a - b; })[Math.floor(all.length / 2)] || 10;
    var heading = start < 0 ? '' : headingText(all[start].text), refs = [], float = false;
    for (i = start + 1; i < all.length; i++) { // to the next section heading: a known name, or a short line set larger than the text
      var t = headingText(all[i].text);
      if (refs.length && (nextSection(t) || (t.length <= 40 && all[i].size > body * 1.25 && !/\d{4}/.test(t)) || AFTER_REFS.test(t))) break;
      // a table or figure that floats onto a page of the list, or follows it: from its caption to the next line that opens like a reference
      if (CAPTION.test(t)) { float = true; continue; }
      if (float && !(REF_OPENS.test(t) && /\b(?:1[5-9]|20)\d{2}\b/.test(t + ' ' + (all[i + 1] ? all[i + 1].text : '')))) continue; // the list resumes with a reference and its year, not a table's "Rint, Completeness to θmax"
      float = false;
      refs.push(all[i]);
    }
    // A table or a figure caption that floats onto a page of references is set in another size: the list's own size is the
    // one most of its text is set in
    var bySize = Object.create(null), most = 0, size = 0;
    refs.forEach(function (l) { var k = Math.round(l.size * 4) / 4; bySize[k] = (bySize[k] || 0) + l.text.length; if (bySize[k] > most) { most = bySize[k]; size = k; } });
    refs = refs.filter(function (l) { return Math.abs(l.size - size) <= 0.08 * size; });
    return { refs: layout(refs), heading: heading, layout: 'auto', pages: pages.length };
  }

  function looksLikeList(lines) { // a PDF that is only a reference list: its entries open like references (a hanging indent's first lines, or a numbered list's)
    var L = lines.filter(function (l) { return l.trim(); }), num = /^(?:\[\d{1,4}\]|\d{1,4}\.)\s/;
    var numbered = L.filter(function (l) { return num.test(l.trim()); }).length >= 0.15 * L.length;
    var starts = numbered ? L.filter(function (l) { return num.test(l.trim()); }) : L.filter(function (l) { return !/^ /.test(l); });
    var author = /^(?:\[\d{1,4}\]|\d{1,4}\.)\s+(?:(?:[A-Z]\.[\s-]?){1,3}\s?[A-Z\u00C0-\u024F][\w\u00C0-\u024F'\u2019\-]+|[A-Z\u00C0-\u024F][\w\u00C0-\u024F'\u2019\-]+,?\s+(?:[A-Z]\.|[A-Z]{1,3}[\s,]|[A-Z][a-z]))/; // "1. Smith J,", "[3] J. A. Smith,": an agenda's "2. The proposal…" is not
    return L.length >= 2 && starts.length > 0 && (numbered ? starts.filter(function (l) { return author.test(l.trim()); }).length >= 0.5 * starts.length : starts.filter(function (l) { return REF_OPENS.test(l.trim()); }).length >= 0.5 * starts.length);
  }
  function read(buf, name) { // the reader the file's first bytes call for, else its name's; no error names the file, as errors travel in bug reports
    var b = bytesOf(buf);
    if (b[0] === 0x50 && b[1] === 0x4B) return readDocx(b);
    if (latin(b, 0, Math.min(1024, b.length)).indexOf('%PDF-') >= 0) return readPdf(b);
    if (/\.docx$/i.test(name || '')) return readDocx(b);
    if (/\.pdf$/i.test(name || '')) return readPdf(b);
    throw new Error('this is neither a Word document nor a PDF');
  }
  function isDocument(name) { return /\.(?:docx|pdf)$/i.test(String(name || '')); }

  var api = { read: read, readDocx: readDocx, readPdf: readPdf, pdfPages: pdfPages, Pdf: Pdf, referenceSection: referenceSection, inflate: inflate, isDocument: isDocument, MAX_UNPACKED: MAX_UNPACKED,
    docxLayout: docxLayout, xmlTree: xmlTree, locateEntries: locateEntries, findCitations: findCitations, entryKeys: entryKeys, fold: fold };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AutoDOIDocuments = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
