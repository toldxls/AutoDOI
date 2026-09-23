/*
 * AutoDOI — reference-manager import parsers: RIS, EndNote tagged (.enw), BibTeX.
 * Pure ES5 functions (no DOM, no network) so the file runs in the browser page and
 * in Google Apps Script. Output records are Crossref "message"-like objects that
 * AutoDOI.normalize() accepts; each carries `source` ('ris'|'enw'|'bibtex') and
 * `raw` (the tags/fields as read, for debugging).
 */
(function (root) {
  'use strict';

  var DOI_RE = /10\.\d{4,9}\/[^\s"'<>]+/i;
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var SUFFIX_RE = /^(jr|sr|[ivx]{1,4}|2nd|3rd|\d+th)\.?$/i;

  /* ---------- helpers ---------- */

  function trim(s) { return String(s === undefined || s === null ? '' : s).replace(/^\s+|\s+$/g, ''); }
  function doiOf(s) { var m = String(s || '').match(DOI_RE); return m ? m[0].replace(/[.,;:]+$/, '') : ''; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function monthNum(s) {
    s = trim(s).toLowerCase();
    if (/^\d{1,2}$/.test(s)) return Number(s) >= 1 && Number(s) <= 12 ? Number(s) : 0;
    for (var i = 0; i < 12; i++) if (s.indexOf(MONTHS[i]) === 0) return i + 1;
    return 0;
  }

  // "2019", "2019/03/15/", "2019///", "2019-03", "March 15", "15 Mar 2019" -> {y, m, d} (0 when absent)
  function parseDate(s) {
    s = trim(s);
    var out = { y: 0, m: 0, d: 0 };
    if (!s) return out;
    var m = s.match(/^(\d{4})(?:[\/\-.](\d{1,2})?)?(?:[\/\-.](\d{1,2})?)?/);
    if (m) { out.y = Number(m[1]); out.m = Number(m[2] || 0); out.d = out.m ? Number(m[3] || 0) : 0; return out; }
    var y = s.match(/\b(1[5-9]\d{2}|20\d{2})\b/), rest = y ? s.replace(y[0], ' ') : s;
    var mw = rest.match(/[A-Za-z]{3,}/), dw = rest.match(/\b(\d{1,2})\b/);
    out.y = y ? Number(y[1]) : 0; out.m = mw ? monthNum(mw[0]) : 0; out.d = out.m && dw ? Number(dw[1]) : 0;
    return out;
  }
  function dateParts(d) { var p = [d.y]; if (d.m) { p.push(d.m); if (d.d) p.push(d.d); } return { 'date-parts': [p] }; }
  // the most complete of several date strings (RIS: DA over PY over Y1)
  function bestDate(list) {
    var best = { y: 0, m: 0, d: 0 };
    for (var i = 0; i < list.length; i++) {
      var d = parseDate(list[i]);
      if (d.y && (!best.y || (d.m && !best.m) || (d.d && !best.d))) best = d;
    }
    return best;
  }

  /* ---------- names ---------- */

  // "Given Family"; lowercase particles belong to the family ("Ludwig van Beethoven"); "Smith" alone
  function nameFromNatural(s) {
    var toks = trim(s).split(/\s+/);
    if (toks.length === 1) return { family: toks[0] };
    var i = toks.length - 1;
    while (i > 1 && /^[a-z]/.test(toks[i - 1])) i--;
    return { family: toks.slice(i).join(' '), given: toks.slice(0, i).join(' ') };
  }
  // RIS / EndNote: "Family, Given, Suffix" | "Family, Given" | "Organisation," (trailing comma = single field)
  function nameFromTagged(s) {
    s = trim(s);
    if (!s) return null;
    if (/,\s*$/.test(s)) return { name: trim(s.replace(/,\s*$/, '')) };
    var parts = s.split(',').map(trim);
    if (parts.length === 1) return nameFromNatural(s);
    var p = { family: parts[0], given: parts[1] };
    if (parts.length > 2) p.suffix = parts.slice(2).join(', ');
    return p;
  }

  /* ---------- ISSN / ISBN ---------- */

  function idNumbers(vals, f) {
    vals.forEach(function (v) {
      v = trim(v);
      var issn = v.match(/\b\d{4}-\d{3}[\dXx]\b/g);
      if (issn) issn.forEach(function (x) { f.issn.push(x.toUpperCase()); });
      else if (/\d/.test(v)) f.isbn.push(trim(v.replace(/\s*\([^)]*\)/g, '')));
    });
  }

  /* ---------- record assembly ---------- */

  function blank(source, raw) { return { source: source, raw: raw, type: 'other', authors: [], editors: [], issn: [], isbn: [] }; }

  // flat intermediate -> Crossref-message-like object
  function message(f) {
    var isPart = /chapter|proceedings/.test(f.type);
    var m = { type: f.type || 'other', source: f.source, raw: f.raw };
    var set = function (k, v) { if (v && (!Array.isArray(v) || v.length)) m[k] = v; };
    set('title', f.title ? [f.title] : null);
    set('subtitle', f.subtitle ? [f.subtitle] : null);
    set('author', f.authors.filter(Boolean)); set('editor', f.editors.filter(Boolean));
    if (isPart && f.container && f.series) m['container-title'] = [f.series, f.container]; // Crossref order: series first, book last
    else { set('container-title', f.container ? [f.container] : null); set('collection-title', f.series ? [f.series] : null); }
    set('short-container-title', f.shortContainer ? [f.shortContainer] : null);
    set('short-title', f.shortTitle ? [f.shortTitle] : null);
    set('volume', f.volume); set('issue', f.issue); set('page', f.pages); set('article-number', f.articleNumber);
    if (f.date && f.date.y) m.issued = dateParts(f.date);
    if (f.accessed && f.accessed.y) m.accessed = dateParts(f.accessed);
    set('publisher', f.publisher); set('publisher-location', f.place);
    set('ISSN', f.issn); set('ISBN', f.isbn);
    set('DOI', f.doi); set('URL', f.url || (f.doi ? 'https://doi.org/' + f.doi : ''));
    set('abstract', f.abstract); set('language', f.language); set('edition', f.edition); set('genre', f.genre);
    set('number-of-pages', f.numPages);
    if (f.institution) m.institution = [{ name: f.institution }];
    if (f.event) m.event = { name: f.event };
    return m;
  }

  // Shared by RIS and EndNote: tags is {TAG: [values]}
  function taggedLines(text, tagRe, onTag, onBlank) {
    var lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
    var state = { tags: null, last: null };
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], m = line.match(tagRe);
      if (m) { onTag(state, m[1], trim(m[2])); }
      else if (!trim(line)) { if (onBlank) onBlank(state); }
      else if (state.tags && state.last) { // continuation line
        var arr = state.tags[state.last];
        arr[arr.length - 1] = trim(arr[arr.length - 1] + ' ' + trim(line));
      }
    }
    return state;
  }
  function pushTag(state, tag, val) { (state.tags[tag] = state.tags[tag] || []).push(val); state.last = tag; }

  /* ---------- RIS ---------- */

  var RIS_TYPES = { JOUR: 'journal-article', EJOUR: 'journal-article', MGZN: 'journal-article', NEWS: 'journal-article',
    CHAP: 'book-chapter', ECHAP: 'book-chapter', BOOK: 'book', EBOOK: 'book', EDBOOK: 'book',
    CONF: 'proceedings-article', CPAPER: 'proceedings-article', UNPB: 'posted-content', DATA: 'dataset',
    COMP: 'software', THES: 'dissertation', RPRT: 'report' };

  function parseRIS(text) {
    var recs = [];
    var flush = function (st) { if (st.tags) recs.push(risRecord(st.tags)); st.tags = null; st.last = null; };
    var st = taggedLines(text, /^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/, function (st, tag, val) {
      if (tag === 'TY') flush(st);
      if (tag === 'ER') { flush(st); return; }
      if (!st.tags) st.tags = {};
      pushTag(st, tag, val);
    });
    flush(st);
    return recs;
  }

  function risRecord(tags) {
    var g = function (t) { return tags[t] ? tags[t][0] : ''; }, all = function (t) { return tags[t] || []; };
    var ty = g('TY').toUpperCase();
    var f = blank('ris', tags);
    f.type = RIS_TYPES[ty] || 'other';
    f.authors = all('AU').concat(all('A1')).map(nameFromTagged);
    var a2 = /^(CHAP|ECHAP|BOOK|EBOOK|EDBOOK|CONF|CPAPER)$/.test(ty) ? all('A2') : []; // secondary authors = editors
    f.editors = all('ED').concat(a2).map(nameFromTagged);
    f.title = g('TI') || g('T1') || g('CT') || (ty === 'BOOK' ? g('BT') : '');
    var full = g('T2') || g('JF'), shortc = g('JO') || g('JA');
    f.container = full || shortc;
    if (full && shortc && shortc !== full) f.shortContainer = shortc;
    f.series = g('T3');
    if (f.type === 'book' && f.container && !f.series) { f.series = f.container; f.container = ''; } // EndNote: a book's T2 is its series
    f.volume = g('VL'); f.issue = g('IS');
    var sp = g('SP'), ep = g('EP');
    f.pages = sp && ep && ep !== sp ? sp + '-' + ep : (sp || ep);
    f.date = bestDate([g('DA'), g('PY'), g('Y1')]);
    f.accessed = parseDate(g('Y2'));
    f.publisher = g('PB'); f.place = g('CY') || g('PP');
    idNumbers(all('SN'), f);
    f.doi = doiOf(all('DO').join(' ')) || doiOf(all('UR').join(' ')) || doiOf(g('L3'));
    f.url = g('UR');
    f.abstract = g('AB') || g('N2');
    f.language = g('LA'); f.edition = g('ET'); f.genre = g('M3');
    return message(f);
  }

  /* ---------- EndNote tagged ---------- */

  var ENW_TYPES = { 'journal article': 'journal-article', 'electronic article': 'journal-article',
    'magazine article': 'journal-article', 'newspaper article': 'journal-article', 'book section': 'book-chapter',
    'book': 'book', 'edited book': 'book', 'electronic book': 'book', 'conference paper': 'proceedings-article',
    'conference proceedings': 'proceedings-article', 'unpublished work': 'posted-content', 'manuscript': 'posted-content',
    'preprint': 'posted-content', 'dataset': 'dataset', 'computer program': 'software', 'thesis': 'dissertation', 'report': 'report' };

  function parseENW(text) {
    var recs = [];
    var flush = function (st) { if (st.tags) recs.push(enwRecord(st.tags)); st.tags = null; st.last = null; };
    var st = taggedLines(text, /^%(\S)\s?(.*)$/, function (st, tag, val) {
      if (tag === '0' && st.tags && st.tags['0']) flush(st); // a new %0 without a blank line
      if (!st.tags) st.tags = {};
      pushTag(st, tag, val);
    }, flush);
    flush(st);
    return recs;
  }

  function enwRecord(tags) {
    var g = function (t) { return tags[t] ? tags[t][0] : ''; }, all = function (t) { return tags[t] || []; };
    var f = blank('enw', tags);
    f.type = ENW_TYPES[g('0').toLowerCase()] || 'other';
    f.authors = all('A').map(nameFromTagged); f.editors = all('E').map(nameFromTagged);
    f.title = g('T'); f.container = g('J') || g('B'); f.series = g('S');
    if (f.type === 'book' && !g('J') && f.container && !f.series) { f.series = f.container; f.container = ''; } // Book: %B is the series
    f.shortTitle = g('!');
    f.volume = g('V'); f.issue = g('N'); f.pages = g('P').replace(/\s*[-–—]+\s*/g, '-');
    var d8 = parseDate(g('8')), dy = parseDate(g('D'));
    f.date = { y: d8.y || dy.y, m: d8.m || dy.m, d: d8.d || dy.d };
    f.accessed = parseDate(g('['));
    f.publisher = g('I'); f.place = g('C');
    idNumbers(all('@'), f);
    f.doi = doiOf(all('R').join(' ')) || doiOf(all('U').join(' '));
    f.url = g('U');
    f.abstract = g('X'); f.language = g('G'); f.edition = g('7'); f.genre = g('9');
    return message(f);
  }

  /* ---------- LaTeX -> Unicode ---------- */

  var ACCENTS = { '`': '̀', "'": '́', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇',
    u: '̆', v: '̌', H: '̋', c: '̧', d: '̣', b: '̱', k: '̨', r: '̊' };
  var LETTERS = { ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', o: 'ø', O: 'Ø',
    l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ', dh: 'ð', DH: 'Ð', th: 'þ', TH: 'Þ', ng: 'ŋ', NG: 'Ŋ' };
  var SYMBOLS = { ldots: '…', dots: '…', textendash: '–', textemdash: '—', textquotedblleft: '“',
    textquotedblright: '”', textquoteleft: '‘', textquoteright: '’', copyright: '©', textregistered: '®',
    texttrademark: '™', textdegree: '°', degree: '°', S: '§', P: '¶', pounds: '£', textsterling: '£',
    euro: '€', texteuro: '€', textbackslash: '\u0001', textasciitilde: '\u0002', textasciicircum: '\u0003',
    textbraceleft: '\u0004', textbraceright: '\u0005' };
  var FORMAT_CMDS = /\\(emph|textit|textbf|textsc|texttt|textrm|textsf|textnormal|textup|textsuperscript|textsubscript|mkbibemph|mkbibquote|mkbibitalic|mkbibbold|url|enquote|MakeUppercase|MakeLowercase|uppercase|lowercase)\s*\{/g;

  function deLatex(s) {
    if (s === undefined || s === null) return '';
    var t = String(s);
    var acc = function (m, a, b, c) { return (b || c).replace(/^\\/, '') + ACCENTS[a]; };
    t = t.replace(/\\([`'^"~=.])(?:\{(\\[ij]|[a-zA-Z])\}|(\\[ij]|[a-zA-Z]))/g, acc);       // \'e  \'{e}  {\'e}  \'{\i}
    t = t.replace(/\\([uvHcdbkr])(?:\{(\\[ij]|[a-zA-Z])\}|\s+(\\[ij]|[a-zA-Z]))/g, acc);   // \c{c}  \v s  \H{o}
    t = t.replace(/\\([a-zA-Z]{1,2})(?![a-zA-Z])(?:\{\}|\s+)?/g, function (m, w) { return has(LETTERS, w) ? LETTERS[w] : m; }); // \ss \o{} \aa
    t = t.replace(/\\([a-zA-Z]+)(?:\{\})?/g, function (m, w) { return has(SYMBOLS, w) ? SYMBOLS[w] : m; });
    t = t.replace(FORMAT_CMDS, '{');                                    // \emph{x} -> {x}; braces are stripped below
    t = t.replace(/\\([&%$#_])/g, '$1').replace(/\\\{/g, '\u0004').replace(/\\\}/g, '\u0005');
    t = t.replace(/\\[,;: ]/g, ' ').replace(/\\[\-\/]/g, '').replace(/\\\\/g, ' ');
    t = t.replace(/---/g, '—').replace(/--/g, '–').replace(/``/g, '“').replace(/''/g, '”');
    t = t.replace(/~/g, ' ');
    t = t.replace(/\\[a-zA-Z]+\s*/g, '').replace(/\\(.)/g, '$1');          // unknown commands, stray escapes
    t = t.replace(/[{}]/g, '');                                          // case-protection braces: {NASA} -> NASA
    t = t.replace(/\u0001/g, '\\').replace(/\u0002/g, '~').replace(/\u0003/g, '^').replace(/\u0004/g, '{').replace(/\u0005/g, '}');
    if (typeof t.normalize === 'function') t = t.normalize('NFC');
    return trim(t.replace(/\s+/g, ' '));
  }

  /* ---------- BibTeX ---------- */

  var BIB_TYPES = { article: 'journal-article', book: 'book', booklet: 'book', proceedings: 'book', incollection: 'book-chapter',
    inbook: 'book-chapter', inproceedings: 'proceedings-article', conference: 'proceedings-article', phdthesis: 'dissertation',
    mastersthesis: 'dissertation', thesis: 'dissertation', techreport: 'report', report: 'report', unpublished: 'posted-content',
    software: 'software', dataset: 'dataset', misc: 'other', online: 'other', electronic: 'other', manual: 'other' };
  var BIB_GENRE = { phdthesis: 'PhD thesis', mastersthesis: "Master's thesis" };

  function matchBrace(s, i) { // index of the '}' closing the '{' at i (end of string if unbalanced)
    var depth = 0;
    for (var j = i; j < s.length; j++) {
      var c = s.charAt(j);
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return j;
    }
    return s.length - 1;
  }
  function splitDepth0(s, sepRe) { // split on a separator regex only at brace depth 0
    var out = [], depth = 0, start = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (depth === 0) {
        var m = s.slice(i).match(sepRe);
        if (m) { out.push(s.slice(start, i)); i += m[0].length - 1; start = i + 1; }
      }
    }
    out.push(s.slice(start));
    return out.map(trim).filter(Boolean);
  }

  // "Family, Given" | "Family, Jr., Given" | "Family, Given, Jr." | "Given Family" | "{Organisation}"
  function nameFromBib(s) {
    s = trim(s);
    if (!s || /^others$/i.test(s)) return null;
    if (s.charAt(0) === '{' && matchBrace(s, 0) === s.length - 1) return { name: deLatex(s) };
    var parts = splitDepth0(s, /^,/).map(deLatex);
    if (parts.length === 1) return nameFromNatural(parts[0]);
    var p = { family: parts[0] };
    if (parts.length === 2) p.given = parts[1];
    else if (SUFFIX_RE.test(parts[1]) && !SUFFIX_RE.test(parts[2])) { p.suffix = parts[1]; p.given = parts.slice(2).join(', '); }
    else { p.given = parts[1]; p.suffix = parts.slice(2).join(', '); }
    return p;
  }
  function bibNames(s) { return s ? splitDepth0(String(s), /^\s+and\s+/i).map(nameFromBib).filter(Boolean) : []; }
  function urlClean(s) { return trim(String(s || '').replace(/\\url\{([^}]*)\}/g, '$1').replace(/\\([%_&#$~^])/g, '$1').replace(/[{}]/g, '')); }

  function parseBibTeX(text) {
    var src = String(text).replace(/^﻿/, ''), n = src.length, pos = 0, recs = [], macros = {};
    for (var i = 0; i < 12; i++) macros[MONTHS[i]] = MONTHS[i];
    var ws = function () { while (pos < n && /\s/.test(src.charAt(pos))) pos++; };
    var ident = function () { var m = src.slice(pos, pos + 256).match(/^[^\s"#%'(),={}]+/); if (!m) return ''; pos += m[0].length; return m[0]; };
    var readValue = function () { // {..} | ".." | number | macro, concatenated with #
      var out = '';
      for (;;) {
        ws();
        var c = src.charAt(pos);
        if (c === '{') { var end = matchBrace(src, pos); out += src.slice(pos + 1, end); pos = end + 1; }
        else if (c === '"') {
          var q = pos + 1, depth = 0;
          while (q < n && (src.charAt(q) !== '"' || depth > 0)) { if (src.charAt(q) === '{') depth++; else if (src.charAt(q) === '}') depth--; q++; }
          out += src.slice(pos + 1, q); pos = q + 1;
        } else { var id = ident(); if (!id) break; out += has(macros, id.toLowerCase()) && !/^\d+$/.test(id) ? macros[id.toLowerCase()] : id; }
        ws();
        if (src.charAt(pos) === '#') { pos++; continue; }
        break;
      }
      return out;
    };
    while (pos < n) {
      var at = src.indexOf('@', pos);
      if (at < 0) break;
      pos = at + 1;
      var type = ident().toLowerCase(); ws();
      var open = src.charAt(pos);
      if (!type || (open !== '{' && open !== '(')) continue;
      var close = open === '{' ? '}' : ')';
      if (type === 'comment' || type === 'preamble') { pos = open === '{' ? matchBrace(src, pos) + 1 : src.indexOf(')', pos) + 1; if (pos <= 0) break; continue; }
      pos++;
      var fields = {}, key = '';
      if (type !== 'string') {
        ws();
        var ks = pos;
        while (pos < n && src.charAt(pos) !== ',' && src.charAt(pos) !== close) pos++;
        key = trim(src.slice(ks, pos));
        if (key.indexOf('=') !== -1) { pos = ks; key = ''; } else if (src.charAt(pos) === ',') pos++; // "@misc{title = ..." has no key
      }
      for (;;) {
        ws();
        var c = src.charAt(pos);
        if (!c || c === close) { pos++; break; }
        if (c === ',') { pos++; continue; }
        var name = ident().toLowerCase(); ws();
        if (src.charAt(pos) !== '=') { while (pos < n && src.charAt(pos) !== ',' && src.charAt(pos) !== close) pos++; continue; }
        pos++;
        var val = readValue();
        if (name) fields[name] = val;
      }
      if (type === 'string') { for (var k in fields) if (has(fields, k)) macros[k.toLowerCase()] = fields[k]; continue; }
      recs.push(bibRecord(type, key, fields));
    }
    return recs;
  }

  function bibRecord(type, key, fields) {
    var g = function (k) { return has(fields, k) ? deLatex(fields[k]) : ''; };
    var f = blank('bibtex', { entrytype: type, key: key, fields: fields });
    f.type = BIB_TYPES[type] || 'other';
    var note = g('note');
    if (f.type === 'other' && /^(preprint|dataset|software)$/i.test(note)) f.type = { preprint: 'posted-content', dataset: 'dataset', software: 'software' }[note.toLowerCase()];
    f.authors = bibNames(fields.author); f.editors = bibNames(fields.editor);
    f.title = g('title'); f.subtitle = g('subtitle');
    var how = g('howpublished'), howUrl = /^(\\url\{)?https?:\/\//i.test(trim(fields.howpublished || ''));
    f.container = g('journal') || g('journaltitle') || (f.type !== 'book' ? g('booktitle') : '') || (!howUrl ? how : '');
    f.shortContainer = g('shortjournal'); f.series = g('series');
    f.volume = g('volume'); f.issue = g('number') || g('issue');
    f.pages = g('pages').replace(/\s*[-–—]+\s*/g, '-'); f.articleNumber = g('eid') || g('articleno');
    var dt = parseDate(g('date')), ym = g('year').match(/\d{4}/), ms = g('month'), dm = /[a-z]/i.test(ms) ? ms.match(/\b(\d{1,2})\b/) : null;
    f.date = { y: dt.y || (ym ? Number(ym[0]) : 0), m: dt.m || monthNum(ms), d: dt.d || Number(g('day') || (dm ? dm[1] : 0)) };
    f.publisher = g('publisher') || g('school') || g('institution') || g('organization');
    f.place = g('address') || g('location');
    if (fields.issn) idNumbers([g('issn')], f);
    if (fields.isbn) f.isbn.push(g('isbn'));
    f.url = urlClean(fields.url) || (howUrl ? urlClean(fields.howpublished) : '');
    f.doi = doiOf(g('doi')) || doiOf(f.url);
    f.abstract = g('abstract'); f.language = g('language') || g('langid'); f.edition = g('edition');
    f.genre = g('type') || BIB_GENRE[type] || ''; f.numPages = g('pagetotal');
    var eprint = trim(fields.eprint || ''), etype = trim(fields.eprinttype || fields.archiveprefix || '').toLowerCase();
    var arxivId = eprint.replace(/^arxiv:/i, '');
    if (arxivId && (etype === 'arxiv' || (!etype && /^\d{4}\.\d{4,5}(v\d+)?$/.test(arxivId))) && /^(other|posted-content)$/.test(f.type)) {
      f.type = 'posted-content'; f.institution = 'arXiv';
      if (!f.doi) f.doi = '10.48550/arXiv.' + arxivId.replace(/v\d+$/, '');
      if (!f.url) f.url = 'https://arxiv.org/abs/' + arxivId;
    }
    return message(f);
  }

  /* ---------- detection ---------- */

  function detect(text) {
    var t = String(text || '').replace(/^﻿/, '');
    if (/^TY\s{1,2}-/m.test(t)) return 'ris';
    if (/^%0\s/m.test(t)) return 'enw';
    if (/^\s*@[A-Za-z]+\s*[{(]/m.test(t)) return 'bibtex';
    return null;
  }

  function parse(text) {
    var format = detect(text);
    var fn = { ris: parseRIS, enw: parseENW, bibtex: parseBibTeX }[format];
    return { format: format, records: fn ? fn(text) : [] };
  }

  var api = { detect: detect, parse: parse, parseRIS: parseRIS, parseENW: parseENW, parseBibTeX: parseBibTeX,
    deLatex: deLatex, parseBibName: nameFromBib, parseTaggedName: nameFromTagged, parseDate: parseDate };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AutoDOIParsers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
