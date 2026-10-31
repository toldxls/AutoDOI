// Writes small .docx files for the tests: a zip of stored parts, with the content types and relationships Word writes.
//   docx({ body: '<w:p>…</w:p>…', styles, numbering, footnotes, media: { 'word/media/image1.png': Buffer } })
// manuscript() is a manuscript laid out the ways Word lays one out: styles with bases, a numbered reference list (Word's own
// numbering, so the numbers are not in the text), numbered citations, a footnote, a table with a merged cell, a picture, hidden
// and deleted text, a page break Word recorded in the middle of a paragraph, and an A4 page.
var W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
var CRC = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) { // [{name, data}] stored
  var locals = [], dirs = [], offset = 0;
  files.forEach(function (f) {
    var name = Buffer.from(f.name), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8'), crc = crc32(data);
    var lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    var cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(lh, name, data); dirs.push(cd, name); offset += 30 + name.length + data.length;
  });
  var dir = Buffer.concat(dirs), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([dir, end]));
}
function docx(o) {
  var head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  var files = [
    { name: '[Content_Types].xml', data: head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', data: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: head + '<w:document ' + W + '><w:body>' + o.body + '</w:body></w:document>' }
  ];
  var rels = [];
  if (o.styles) { files.push({ name: 'word/styles.xml', data: head + '<w:styles ' + W + '>' + o.styles + '</w:styles>' }); rels.push('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'); }
  if (o.numbering) { files.push({ name: 'word/numbering.xml', data: head + '<w:numbering ' + W + '>' + o.numbering + '</w:numbering>' }); rels.push('<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'); }
  if (o.footnotes) { files.push({ name: 'word/footnotes.xml', data: head + '<w:footnotes ' + W + '><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' + o.footnotes + '</w:footnotes>' }); rels.push('<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'); }
  Object.keys(o.media || {}).forEach(function (path, i) { files.push({ name: path, data: o.media[path] }); rels.push('<Relationship Id="rId' + (9 + i) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + path.replace(/^word\//, '') + '"/>'); });
  files.push({ name: 'word/_rels/document.xml.rels', data: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '<Relationship Id="rId20" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/" TargetMode="External"/></Relationships>' });
  return zip(files);
}
var PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'); // one pixel
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function p(text, style, extra) { return '<w:p>' + (style || extra ? '<w:pPr>' + (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (extra || '') + '</w:pPr>' : '') + (text ? '<w:r><w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>' : '') + '</w:p>'; }
var REFS = [
  'Kucsko G, Maurer PC, Yao NY, et al. Nanometre-scale thermometry in a living cell. Nature. 2013;500:54-58.',
  'Vaswani A, Shazeer N, Parmar N. Attention is all you need. Adv Neural Inf Process Syst. 2017;30:5998-6008.',
  'Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.'
];
function manuscript() {
  var styles = '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="480" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Bibliography"><w:name w:val="Bibliography"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>';
  var numbering = '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
  var picture = '<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  var body = p('Nanoscale thermometry of the mineral kernite', 'Heading1') +
    '<w:p><w:r><w:t xml:space="preserve">Diamond thermometers reach sub-degree precision [1] and attention models changed translation [2–3].</w:t></w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:p>' +
    '<w:p><w:r><w:t>Kernite</w:t></w:r><w:r><w:tab/><w:t>is Na</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r><w:r><w:t xml:space="preserve">B</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>SECRET</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:hyperlink r:id="rId20"><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> borax</w:t></w:r></w:hyperlink></w:p>' +
    '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>' + p('Phase') + '</w:tc><w:tc>' + p('Kernite') + '</w:tc></w:tr>' +
    '<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>' + p('') + '</w:tc><w:tc>' + p('Borax') + '</w:tc></w:tr></w:tbl>' +
    '<w:p>' + picture + '</w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">The crystals were grown at 300 K and </w:t></w:r><w:r><w:lastRenderedPageBreak/><w:t>measured the next day.</w:t></w:r></w:p>' +
    p('References', 'Heading1') +
    REFS.map(function (r) { return p(r, 'Bibliography', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'); }).join('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>';
  var footnotes = '<w:footnote w:id="1"><w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Kernite is mined at Boron, California.</w:t></w:r></w:p></w:footnote>';
  return docx({ body: body, styles: styles, numbering: numbering, footnotes: footnotes, media: { 'word/media/image1.png': PNG } });
}
// tables(): a data table set with tab stops (a left stop and a right one) on paragraphs whose marks are subscript, as Word
// leaves them after a formula; a fixed table with a column too narrow for its number; and a landscape section after a portrait one
function tables() {
  var tabbed = function (label, value, mark) { return '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="3240"/><w:tab w:val="right" w:pos="9000"/></w:tabs><w:rPr><w:vertAlign w:val="' + mark + '"/></w:rPr></w:pPr><w:r><w:t>' + label + '</w:t></w:r><w:r><w:tab/><w:t>' + value + '</w:t></w:r><w:r><w:tab/><w:t>99.5</w:t></w:r></w:p>'; };
  var body = p('Table 3. Data collection details.') + tabbed('Temperature', '296 K', 'subscript') + tabbed('Structural formula', 'Cd2(SO4)', 'superscript') +
    '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:pPr></w:p>' +
    p('Table 4. A wide table on its own page.') +
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="400"/><w:gridCol w:w="12000"/></w:tblGrid>' +
    '<w:tr><w:tc>' + p('0.20') + '</w:tc><w:tc>' + p('wide') + '</w:tc></w:tr></w:tbl>' +
    '<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1418" w:right="1440" w:bottom="1418" w:left="1440"/></w:sectPr>';
  return docx({ body: body });
}
// cells(): a title whose mark is caps, highlighted and subscript, as Word leaves it after a formula; an empty highlighted
// paragraph; a table AutoFit to its contents whose rules are each cell's own, one cell centred; a reference list, and a figure
// caption after it that cites it
function cells() {
  var cell = function (t, sides, mid) { return '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:tcBorders>' + sides.map(function (s) { return '<w:' + s + ' w:val="single" w:sz="4" w:color="000000"/>'; }).join('') + '</w:tcBorders>' + (mid ? '<w:vAlign w:val="center"/>' : '') + '</w:tcPr>' + p(t) + '</w:tc>'; };
  var body = '<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:caps/><w:highlight w:val="green"/><w:vertAlign w:val="subscript"/></w:rPr></w:pPr><w:r><w:rPr><w:caps/></w:rPr><w:t xml:space="preserve">Title of the paper, </w:t></w:r><w:r><w:t>HAl(UO</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:rPr><w:highlight w:val="green"/></w:rPr></w:pPr></w:p>' + p('As shown by Abel (2001), the crystals are small.') +
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="300"/><w:gridCol w:w="300"/></w:tblGrid>' +
    '<w:tr>' + cell('Range', ['top', 'left', 'bottom', 'right']) + cell('Mean', ['top', 'bottom']) + '</w:tr>' +
    '<w:tr>' + cell('18.76\u201319.66 and more', ['left', 'bottom', 'right']) + cell('x', ['bottom'], true) + '</w:tr></w:tbl>' +
    p('References') + p('Abel, A. (2001) A first paper on the crystals. Journal of Things, 1, 1-2.') + p('Baker, B. (2002) A second paper on the crystals. Journal of Things, 2, 3-4.') +
    p('Figure 1. The crystal, as drawn after Baker (2002).');
  return docx({ body: body });
}
module.exports = { docx: docx, zip: zip, manuscript: manuscript, tables: tables, cells: cells, REFS: REFS, PNG: PNG };
