// Writes tests/fixtures/manuscript.docx, a minimal .docx (a zip of OOXML parts) with a manuscript: title, text, a References heading, two references, figure captions
// Usage: node tools/make-docx-fixture.js tests/fixtures/manuscript.docx
var zlib = require('zlib'), fs = require('fs');
function crc32(buf) { if (zlib.crc32) return zlib.crc32(buf) >>> 0; var c, crc = 0xFFFFFFFF; for (var n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xFF; for (var k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; }
function zip(files) { // [{name, data}]
  var parts = [], central = [], offset = 0;
  files.forEach(function (f) {
    var name = Buffer.from(f.name), data = Buffer.from(f.data), comp = zlib.deflateRawSync(data), crc = crc32(data);
    var lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    var ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name); offset += lh.length + name.length + comp.length;
  });
  var cd = Buffer.concat(central), eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat(parts.concat([cd, eocd]));
}
function p(text, opts) { opts = opts || {}; var runs = Array.isArray(text) ? text : [{ t: text }];
  return '<w:p>' + (opts.style ? '<w:pPr><w:pStyle w:val="' + opts.style + '"/></w:pPr>' : '') + runs.map(function (r) { return '<w:r>' + (r.sup ? '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>' : r.sub ? '<w:rPr><w:vertAlign w:val="subscript"/></w:rPr>' : r.i ? '<w:rPr><w:i/></w:rPr>' : '') + '<w:t xml:space="preserve">' + r.t.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</w:t></w:r>'; }).join('') + '</w:p>'; }
var body = [
  p('Nanoscale thermometry of the mineral kernite', { style: 'Title' }),
  p('Introduction', { style: 'Heading1' }),
  p('Diamond thermometers reach sub-degree precision in living cells (Kucsko et al. 2013) and attention models changed machine translation (Vaswani et al. 2017).'),
  p([{ t: 'The formula Na' }, { t: '2', sub: true }, { t: 'B' }, { t: '4', sub: true }, { t: 'O' }, { t: '7', sub: true }, { t: ' is kernite.' }]),
  p('References', { style: 'Heading1' }),
  p([{ t: 'Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., & Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. ' }, { t: 'Nature', i: true }, { t: ', 500(7460), 54-58.' }]),
  p('Vaswani A, Shazeer N, Parmar N. Attention is all you need. Advances in Neural Information Processing Systems. 2017;30:5998-6008.'),
  p('Figure captions', { style: 'Heading1' }),
  p('Figure 1. Temperature map of a kernite crystal at 300 K (2013 sample).')
].join('');
var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr/></w:body></w:document>';
var ct = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
var rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
var out = zip([{ name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: rels }, { name: 'word/document.xml', data: doc }]);
fs.writeFileSync(process.argv[2], out); console.log('wrote', out.length, 'bytes');
