/*
 * AutoDOI — reference-manager import parsers: RIS, EndNote tagged (.enw), BibTeX.
 * Pure ES5 functions (no DOM, no network) so the file runs in the browser page and
 * in Google Apps Script. Output records are Crossref "message"-like objects that
 * AutoDOI.normalize() accepts; each carries `source` ('ris'|'enw'|'bibtex') and
 * `raw` (the tags/fields as read, for debugging).
 *
 * parseMixed(text) splits a paste that mixes plain references with any number of RIS,
 * EndNote and BibTeX blocks (several concatenated files, BOMs anywhere) into records and
 * the leftover plain-text chunks, in order. parse()/detect() are built on it.
 * decodeBytes(arrayBuffer) turns a file's bytes into text (UTF-8, UTF-16 LE/BE, Windows-1252).
 */
(function (root) {
  'use strict';

  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var SUFFIX_RE = /^(jr|sr|[ivx]{1,4}|2nd|3rd|\d+th)\.?$/i;

  /* ---------- helpers ---------- */

  function trim(s) { return String(s === undefined || s === null ? '' : s).trim(); } // ES5; /\s+$/ is quadratic on long blank runs
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // DOI in a string; SICI DOIs keep balanced <...> ("10.1175/1520-0477(1996)077<0437:TNYRP>2.0.CO;2")
  function doiOf(s) {
    var m = String(s || '').match(/10\.\d{4,9}\/[^\s"']+/);
    if (!m) return '';
    var d = m[0], open = -1, cut = d.length;
    for (var i = 0; i < d.length; i++) {
      var c = d.charAt(i);
      if (c === '<') { if (open < 0) open = i; else { cut = i; break; } }
      else if (c === '>') { if (open < 0) { cut = i; break; } open = -1; }
    }
    if (cut === d.length && open >= 0) cut = open; // unclosed '<'
    return d.slice(0, cut).replace(/[.,;:]+$/, '');
  }

  function monthNum(s) {
    s = trim(s).toLowerCase();
    if (/^\d{1,2}$/.test(s)) return Number(s) >= 1 && Number(s) <= 12 ? Number(s) : 0;
    for (var i = 0; i < 12; i++) if (s.indexOf(MONTHS[i]) === 0) return i + 1;
    return 0;
  }

  function validDate(out) {
    if (!(out.m >= 1 && out.m <= 12)) { out.m = 0; out.d = 0; } // also drops biblatex seasons 21-24
    if (!(out.d >= 1 && out.d <= (out.m ? MONTH_DAYS[out.m - 1] : 0))) out.d = 0;
    return out;
  }
  // "2019", "2019/03/15/", "2019///", "2019-03", "March 15", "15 Mar 2019" -> {y, m, d} (0 when absent or invalid)
  function parseDate(s) {
    s = trim(s);
    var out = { y: 0, m: 0, d: 0 };
    if (!s) return out;
    var m = s.match(/^(\d{4})(?:[\/\-.](\d{1,2})?)?(?:[\/\-.](\d{1,2})?)?/);
    if (m) { out.y = Number(m[1]); out.m = Number(m[2] || 0); out.d = out.m ? Number(m[3] || 0) : 0; return validDate(out); }
    var y = s.match(/\b(1[5-9]\d{2}|20\d{2})\b/), rest = y ? s.replace(y[0], ' ') : s;
    var mw = rest.match(/[A-Za-z]{3,}/), dw = rest.match(/\b(\d{1,2})\b/);
    out.y = y ? Number(y[1]) : 0; out.m = mw ? monthNum(mw[0]) : 0; out.d = out.m && dw ? Number(dw[1]) : 0;
    return validDate(out);
  }
  function dateParts(d) { var p = [d.y]; if (d.m) { p.push(d.m); if (d.d) p.push(d.d); } return { 'date-parts': [p] }; }

  /* ---------- names ---------- */

  // "Given Family"; lowercase particles belong to the family ("Ludwig van Beethoven"); "Smith" alone;
  // "Martin Luther King Jr." -> suffix
  function nameFromNatural(s) {
    var toks = trim(s).split(/\s+/), suffix = '';
    if (toks.length > 2 && SUFFIX_RE.test(toks[toks.length - 1])) suffix = toks.pop();
    if (toks.length === 1) return suffix ? { family: toks[0], suffix: suffix } : { family: toks[0] };
    var i = toks.length - 1;
    while (i > 1 && /^[a-z]/.test(toks[i - 1])) i--;
    var p = { family: toks.slice(i).join(' '), given: toks.slice(0, i).join(' ') };
    if (suffix) p.suffix = suffix;
    return p;
  }
  // RIS / EndNote: "Family, Given, Suffix" | "Family, Given" | "Organisation," (trailing comma = single field)
  // | "Smith JA" (Vancouver: family + initials) | "J.A. Smith"
  // Words that make an author an organisation even without EndNote's trailing comma ("U.S. Geological Survey")
  var ORG_WORDS = /\b(Survey|Museum|Society|Institute|Institution|University|College|Academy|Association|Organi[sz]ation|Commission|Committee|Council|Agency|Department|Ministry|Office|Bureau|Service|Center|Centre|Laboratory|Foundation|Consortium|Collaboration|Group|Team|Project|Program(me)?|Database|Network|Board|Authority|Corporation|Company|Inc|Ltd|GmbH|Press)\b/;
  function nameFromTagged(s) {
    s = trim(s);
    if (!s) return null;
    if (/,\s*$/.test(s)) return { name: trim(s.replace(/,\s*$/, '')) };
    if (ORG_WORDS.test(s) && (s.indexOf(',') === -1 || ORG_WORDS.test(s.split(',')[0]))) return { name: s }; // "History, C.M. of N." never
    var parts = s.split(',').map(trim);
    if (parts.length === 1) {
      var toks = s.split(/\s+/), ini = toks[toks.length - 1], fam = toks.slice(0, -1).join(' ');
      if (toks.length > 1 && /^[A-Z]{1,3}$/.test(ini) && /[a-z]/.test(fam)) return { family: fam, given: ini.split('').join('. ') + '.' };
      return nameFromNatural(s);
    }
    var p = { family: parts[0], given: parts[1] };
    if (parts.length > 2) p.suffix = parts.slice(2).join(', ');
    return p;
  }

  /* ---------- ISSN / ISBN ---------- */

  function idNumbers(vals, f) {
    var addIsbn = function (x) { if (f.isbn.indexOf(x) === -1) f.isbn.push(x); };
    var addIssn = function (x) { x = x.toUpperCase(); if (x.length === 8) x = x.slice(0, 4) + '-' + x.slice(4); if (f.issn.indexOf(x) === -1) f.issn.push(x); };
    vals.forEach(function (v) {
      v = String(v || '').replace(/\([^)]*\)/g, ' ').replace(/\b(e-?|p-?)?(ISSN|ISBN)(-1[03])?:?/gi, ' ');
      v.split(/[;,]/).forEach(function (part) {
        part = trim(part);
        if (!part) return;
        var compact = part.replace(/[\s\-‐‑–]/g, '');
        if (/^(97[89]\d{9}[\dXx]|\d{9}[\dXx])$/.test(compact) && !/^\d{4}-\d{3}[\dXx]$/.test(part)) { addIsbn(part.replace(/\s+/g, '-')); return; }
        part.split(/\s+/).forEach(function (tok) {
          tok = tok.replace(/^[^\dXx]+|[^\dXx]+$/g, '');
          if (/^\d{4}-\d{3}[\dXx]$/.test(tok) || /^\d{7}[\dXx]$/.test(tok)) addIssn(tok);
          else if (/^(97[89]\d{9}[\dXx]|\d{9}[\dXx])$/.test(tok.replace(/-/g, ''))) addIsbn(tok);
        });
      });
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
    if (f.authorOthers) m['author-others'] = true;
    if (f.editorOthers) m['editor-others'] = true;
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
    set('database', f.database); set('accession', f.accession);
    if (f.institution) m.institution = [{ name: f.institution }];
    if (f.protectWords && f.protectWords.length) m['protect-words'] = f.protectWords;
    if (f.event) m.event = { name: f.event };
    if (!trim(String(f.title || '').replace(/<[^>]*>/g, ''))) m.untitled = true;
    return m;
  }

  /* ---------- RIS / EndNote line scanning ---------- */

  var RIS_START = /^\s*TY\s{1,2}-/;
  var RIS_TAG = /^\s*([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/;
  var ENW_START = /^\s*%0(?:\s|$)/;
  var ENW_TAG = /^\s*%(\S)\s?(.*)$/;
  var BIB_LINE = /^\s*@[A-Za-z][\w-]*\s*[{(]/;
  var RIS_KNOWN = {};
  ('TY ER AU A1 A2 A3 A4 ED TI T1 T2 T3 CT BT JO JF JA J1 J2 VL IS SP EP PY Y1 Y2 DA PB CY PP SN DO UR L1 L2 L3 L4 AB N1 N2 ' +
   'KW LA ET M1 M2 M3 ID AN DB DP ST C1 C2 C3 C4 C5 C6 C7 C8 CA CN LB NV OP RI RN SE TA TT U1 U2 U3 U4 U5 AD').split(' ')
    .forEach(function (t) { RIS_KNOWN[t] = 1; });
  var ENW_KNOWN = {};
  '0 A B C D E F G H I J K L M N P Q R S T U V W X Y Z 1 2 3 4 5 6 7 8 9 ! @ # $ ] & ( ) * + ^ > < [ ? ~'.split(' ')
    .forEach(function (t) { ENW_KNOWN[t] = 1; });

  // Scan one RIS (TY..ER) or EndNote (%0..) record starting at lines[i].
  // Blank lines do not end a record when a tag line follows; text after a blank line with no
  // later tag line is left for the caller as plain text.
  function scanTagged(fmt, lines, i) {
    var tagRe = fmt === 'ris' ? RIS_TAG : ENW_TAG;
    var tags = {}, last = null, known = {}, nKnown = 0, lastGood = i, sawBlank = false, pending = [], ownStart = false;
    var push = function (tag, val) {
      (tags[tag] = tags[tag] || []).push([trim(val)]); last = tag;
      var ok = fmt === 'ris' ? has(RIS_KNOWN, tag) : has(ENW_KNOWN, tag);
      if (ok && !known[tag]) { known[tag] = 1; nKnown++; }
    };
    var cont = function (line) { if (last) { var a = tags[last]; a[a.length - 1].push(trim(line)); } };
    var m0 = lines[i].match(tagRe);
    push(m0[1], m0[2]);
    for (var j = i + 1; j < lines.length; j++) {
      var line = lines[j];
      if (!/\S/.test(line)) { sawBlank = true; continue; }
      if (RIS_START.test(line) || ENW_START.test(line) || BIB_LINE.test(line)) {
        ownStart = fmt === 'ris' ? RIS_START.test(line) : ENW_START.test(line);
        break;
      }
      var m = line.match(tagRe);
      if (m && !(fmt === 'ris' && m[1] === 'ER' && /\s/.test(trim(m[2])))) { // "ER  - is a word" is text
        for (var k = 0; k < pending.length; k++) cont(lines[pending[k]]);
        pending = []; sawBlank = false; lastGood = j;
        if (fmt === 'ris' && m[1] === 'ER') { if (!known.ER) { known.ER = 1; nKnown++; } break; }
        push(m[1], m[2]);
        continue;
      }
      if (sawBlank) pending.push(j);
      else { cont(line); lastGood = j; }
    }
    var out = {};
    for (var t in tags) if (has(tags, t)) out[t] = tags[t].map(function (parts) { return trim(parts.join(' ')); });
    var onlyStart = nKnown <= 1 && lastGood === i;
    return { tags: out, nKnown: nKnown, end: lastGood, emptyBeforeStart: onlyStart && ownStart };
  }

  /* ---------- RIS ---------- */

  var RIS_TYPES = { JOUR: 'journal-article', EJOUR: 'journal-article', MGZN: 'journal-article', NEWS: 'journal-article',
    CHAP: 'book-chapter', ECHAP: 'book-chapter', BOOK: 'book', EBOOK: 'book', EDBOOK: 'book',
    CONF: 'proceedings-article', CPAPER: 'proceedings-article', UNPB: 'posted-content', DATA: 'dataset',
    COMP: 'software', THES: 'dissertation', RPRT: 'report' };

  function risRecord(tags) {
    var g = function (t) { return tags[t] ? tags[t][0] : ''; }, all = function (t) { return tags[t] || []; };
    var ty = g('TY').toUpperCase();
    var f = blank('ris', tags);
    f.type = RIS_TYPES[ty] || 'other';
    var isPart = /^(CHAP|ECHAP|CONF|CPAPER)$/.test(ty);
    f.authors = all('AU').concat(all('A1')).map(nameFromTagged);
    var a2 = /^(CHAP|ECHAP|BOOK|EBOOK|EDBOOK|CONF|CPAPER)$/.test(ty) ? all('A2') : []; // secondary authors = editors
    f.editors = all('ED').concat(a2).map(nameFromTagged);
    f.title = g('TI') || g('T1') || g('CT') || (/^(BOOK|EBOOK|EDBOOK)$/.test(ty) ? g('BT') : '');
    var full = g('T2') || g('JF') || (isPart ? g('BT') : ''), shortc = g('JO') || g('JA');
    f.container = full || shortc;
    if (full && shortc && shortc !== full) f.shortContainer = shortc;
    f.series = g('T3');
    if (f.type === 'book' && f.container && !f.series) { f.series = f.container; f.container = ''; } // EndNote: a book's T2 is its series
    f.volume = g('VL'); f.issue = g('IS');
    var m1 = g('M1');
    if (!f.issue && f.type === 'journal-article' && m1.length <= 6 && /^[A-Za-z]?\d+[A-Za-z]?([-–\/]\d+)?$/.test(m1)) f.issue = m1;
    var sp = g('SP').replace(/\s*[-–—]+\s*/g, '-'), ep = g('EP');
    if (/^(BOOK|EBOOK|EDBOOK|THES|RPRT)$/.test(ty) && /^\d+(\s*pp?\.?)?$/.test(sp) && !ep) { f.numPages = sp.replace(/\D/g, ''); sp = ''; } // "SP - 237" on a book = 237 pages
    f.pages = sp && ep && ep !== sp && !/\d-\S/.test(sp) ? sp + '-' + ep : (sp || ep);
    var py = parseDate(g('PY')), da = parseDate(g('DA'));
    if (!py.y) f.date = da.y ? da : parseDate(g('Y1')); // Y1 is deprecated: DA wins over it
    else { // a DA with another year is usually an access date; DA/Y1 add month and day only in PY's year
      var y1 = parseDate(g('Y1'));
      f.date = da.y === py.y && da.m && (!py.m || da.m === py.m) ? da : y1.y === py.y && y1.m && (!py.m || y1.m === py.m) ? y1 : py;
    }
    f.accessed = parseDate(g('Y2'));
    f.publisher = g('PB'); f.place = g('CY') || g('PP');
    idNumbers(all('SN'), f);
    f.doi = doiOf(all('DO').join(' ')) || doiOf(all('UR').join(' ')) || doiOf(g('L3'));
    f.url = g('UR');
    f.abstract = g('AB') || g('N2');
    f.language = g('LA'); f.edition = g('ET'); f.genre = g('M3');
    f.database = g('DP') || g('DB'); f.accession = g('AN'); // JSTOR, EBSCOhost, ProQuest: MLA's second container, Chicago's stand-in for a URL
    return message(f);
  }

  /* ---------- EndNote tagged ---------- */

  var ENW_TYPES = { 'journal article': 'journal-article', 'electronic article': 'journal-article',
    'magazine article': 'journal-article', 'newspaper article': 'journal-article', 'book section': 'book-chapter',
    'book': 'book', 'edited book': 'book', 'electronic book': 'book', 'conference paper': 'proceedings-article',
    'conference proceedings': 'proceedings-article', 'unpublished work': 'posted-content', 'manuscript': 'posted-content',
    'preprint': 'posted-content', 'dataset': 'dataset', 'computer program': 'software', 'thesis': 'dissertation', 'report': 'report' };

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
    f.database = g('W'); f.accession = g('M'); // %W database provider, %M accession number
    return message(f);
  }

  /* ---------- LaTeX -> Unicode ---------- */

  var ACCENTS = { '`': '̀', "'": '́', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇',
    u: '̆', v: '̌', H: '̋', c: '̧', d: '̣', b: '̱', k: '̨', r: '̊' };
  var LETTERS = { ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', o: 'ø', O: 'Ø',
    l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ', dh: 'ð', DH: 'Ð', th: 'þ', TH: 'Þ', ng: 'ŋ', NG: 'Ŋ' };
  // Placeholders (control characters, stripped from input first) protect characters from later steps
  var PH = { bs: '\u0001', tilde: '\u0002', caret: '\u0003', lb: '\u0004', rb: '\u0005', dollar: '\u0006',
    apos: '\u0007', quot: '\u0008', grave: '\u0012', ltilde: '\u0013' };
  var SUBO = '\u000E', SUBC = '\u000F', SUPO = '\u0010', SUPC = '\u0011';
  var SYMBOLS = { ldots: '…', dots: '…', textendash: '–', textemdash: '—', textquotedblleft: '“',
    textquotedblright: '”', textquoteleft: '‘', textquoteright: '’', copyright: '©', textregistered: '®',
    texttrademark: '™', textdegree: '°', degree: '°', S: '§', P: '¶', pounds: '£', textsterling: '£',
    euro: '€', texteuro: '€', textbackslash: PH.bs, textasciitilde: PH.tilde, textasciicircum: PH.caret,
    textbraceleft: PH.lb, textbraceright: PH.rb, textquotesingle: PH.apos, textquotedbl: PH.quot, textasciigrave: PH.grave,
    times: '×', cdot: '·', pm: '±', mp: '∓', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
    sim: '∼', infty: '∞', rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔', prime: '′', circ: '∘',
    textmu: 'µ', textperthousand: '‰', textpm: '±', texttimes: '×' };
  var GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
    sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
  for (var gk in GREEK) if (has(GREEK, gk)) SYMBOLS[gk] = GREEK[gk];
  var FORMAT_CMDS = /\\(emph|textit|textbf|textsc|texttt|textrm|textsf|textnormal|textup|mkbibemph|mkbibquote|mkbibitalic|mkbibbold|url|enquote|MakeUppercase|MakeLowercase|uppercase|lowercase|mathrm|mathit|mathbf|mathsf|mathtt|mathnormal|text|mbox|ensuremath)\s*\{/g;

  function matchBrace(s, i) { // index of the '}' closing the '{' at i (end of string if unbalanced)
    var depth = 0;
    for (var j = i; j < s.length; j++) {
      var c = s.charAt(j);
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return j;
    }
    return s.length - 1;
  }

  // inside $...$ or \(...\): Greek letters, x_2, x_{12}, x^+, x^{13}
  function mathToMarks(x) {
    x = x.replace(/\\([a-zA-Z]+)\s*/g, function (m, w) { return has(GREEK, w) ? GREEK[w] : m; });
    return x.replace(/([_^])\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|(\\[a-zA-Z]+|[^\s{}\\]))/g, function (m, op, grp, one) {
      return (op === '_' ? SUBO : SUPO) + (grp !== undefined ? grp : one) + (op === '_' ? SUBC : SUPC);
    });
  }
  function textSubSup(t) { // \textsubscript{x} / \textsuperscript{x} -> markers
    var re = /\\text(sub|super)script\s*\{/g, out = '', last = 0, m;
    while ((m = re.exec(t))) {
      var open = m.index + m[0].length - 1, end = matchBrace(t, open), sub = m[1] === 'sub';
      out += t.slice(last, m.index) + (sub ? SUBO : SUPO) + textSubSup(t.slice(open + 1, end)) + (sub ? SUBC : SUPC);
      last = end + 1; re.lastIndex = end + 1;
    }
    return last ? out + t.slice(last) : t;
  }

  // LaTeX -> plain Unicode text. With html=true, sub/superscripts become <sub>/<sup> (and & < > are
  // escaped) when present, which AutoDOI's title markup() understands.
  function deLatex(s, html) {
    if (s === undefined || s === null) return '';
    var t = String(s).replace(/[\u0001-\u0008\u000E-\u001F﻿]/g, '');
    var acc = function (m, a, b, c) { return (b || c).replace(/^\\/, '') + ACCENTS[a]; };
    t = t.replace(/\\\$/g, PH.dollar);
    t = t.replace(/\\url\s*\{([^{}]*)\}/g, function (m, u) { return '{' + u.replace(/~/g, PH.ltilde) + '}'; });
    t = t.replace(/\\href\s*\{[^{}]*\}\s*\{/g, '{');
    t = t.replace(/\\noopsort\s*\{[^{}]*\}/g, '');
    t = t.replace(/\\\(([\s\S]*?)\\\)/g, function (m, x) { return mathToMarks(x); });
    t = t.replace(/\$([^$]*)\$/g, function (m, x) { return mathToMarks(x); });
    t = textSubSup(t);
    t = t.replace(/\\([`'^"~=.])(?:\{(\\[ij]|[a-zA-Z])\}|(\\[ij]|[a-zA-Z]))/g, acc);       // \'e  \'{e}  {\'e}  \'{\i}
    t = t.replace(/\\([uvHcdbkr])(?:\{(\\[ij]|[a-zA-Z])\}|\s+(\\[ij]|[a-zA-Z]))/g, acc);   // \c{c}  \v s  \H{o}
    t = t.replace(/\\~(?:\{\})?/g, PH.ltilde).replace(/\\\^(?:\{\})?/g, PH.caret);         // \~{} is a tilde
    t = t.replace(/\\([a-zA-Z]{1,2})(?![a-zA-Z])(?:\{\}|\s+)?/g, function (m, w) { return has(LETTERS, w) ? LETTERS[w] : m; }); // \ss \o{} \aa
    t = t.replace(/\\([a-zA-Z]+)(?:\{\})?/g, function (m, w) { return has(SYMBOLS, w) ? SYMBOLS[w] : m; });
    t = t.replace(FORMAT_CMDS, '{');                                    // \emph{x} -> {x}; braces are stripped below
    t = t.replace(/\\([&%#_])/g, '$1').replace(/\\\{/g, PH.lb).replace(/\\\}/g, PH.rb);
    t = t.replace(/\\[,;: ]/g, ' ').replace(/\\[\-\/]/g, '').replace(/\\\\/g, ' ');
    t = t.replace(/---/g, '—').replace(/--/g, '–').replace(/``/g, '“').replace(/''/g, '”');
    t = t.replace(/~/g, ' ');
    t = t.replace(/\\[a-zA-Z]+\s*/g, '').replace(/\\(.)/g, '$1');          // unknown commands, stray escapes
    t = t.replace(/[{}$]/g, '');                                         // case-protection braces: {NASA} -> NASA; math $
    t = t.replace(/\u0001/g, '\\').replace(/\u0002/g, '~').replace(/\u0003/g, '^').replace(/\u0004/g, '{').replace(/\u0005/g, '}')
      .replace(/\u0006/g, '$').replace(/\u0007/g, "'").replace(/\u0008/g, '"').replace(/\u0012/g, '`').replace(/\u0013/g, '~');
    if (typeof t.normalize === 'function') t = t.normalize('NFC');
    t = trim(t.replace(/\s+/g, ' ')).replace(/\u000E\u000F|\u0010\u0011/g, '');
    if (html && /[\u000E-\u0011<]/.test(t)) { // escape text, keep HTML tags already in the field (Crossref's <scp>, <i>)
      var TAG = /<\/?[a-zA-Z][\w:-]*(?:\s[^<>]*)?\/?>/g, esc = function (x) {
        return x.replace(/&(?!(#\d+|#x[\da-fA-F]+|[a-zA-Z]\w*);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      };
      var o = '', last = 0, tm;
      while ((tm = TAG.exec(t))) { o += esc(t.slice(last, tm.index)) + tm[0]; last = TAG.lastIndex; }
      return (o + esc(t.slice(last))).replace(/\u000E/g, '<sub>').replace(/\u000F/g, '</sub>').replace(/\u0010/g, '<sup>').replace(/\u0011/g, '</sup>');
    }
    return t.replace(/[\u000E-\u0011]/g, '');
  }

  /* ---------- BibTeX ---------- */

  var BIB_TYPES = { article: 'journal-article', book: 'book', booklet: 'book', proceedings: 'book', incollection: 'book-chapter',
    inbook: 'book-chapter', inproceedings: 'proceedings-article', conference: 'proceedings-article', phdthesis: 'dissertation',
    mastersthesis: 'dissertation', thesis: 'dissertation', techreport: 'report', report: 'report', unpublished: 'posted-content',
    software: 'software', dataset: 'dataset', misc: 'other', online: 'other', electronic: 'other', manual: 'other' };
  var BIB_GENRE = { phdthesis: 'PhD thesis', mastersthesis: "Master's thesis" };
  var BIB_KNOWN = {};
  ('article book booklet proceedings incollection inbook inproceedings conference phdthesis mastersthesis thesis techreport ' +
   'report unpublished software dataset misc online electronic manual collection mvbook mvcollection mvproceedings ' +
   'mvreference periodical suppbook suppcollection suppperiodical reference inreference patent standard artwork audio ' +
   'video music performance letter movie image bibnote review jurisdiction legislation legal www webpage ' +
   'string comment preamble set xdata').split(' ').forEach(function (t) { BIB_KNOWN[t] = 1; });
  var BIB_INHERIT = ['year', 'date', 'month', 'publisher', 'editor', 'address', 'location', 'series', 'volume',
    'organization', 'isbn', 'journal', 'journaltitle', 'school', 'institution', 'eventtitle', 'venue'];

  function splitDepth0(s, sep) { // split on ',' or on whitespace+"and"+whitespace, only at brace depth 0 (linear)
    var out = [], depth = 0, start = 0, n = s.length;
    for (var i = 0; i < n; i++) {
      var c = s.charAt(i);
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (depth === 0) {
        if (sep === ',') { if (c === ',') { out.push(s.slice(start, i)); start = i + 1; } }
        else if (/\s/.test(c)) {
          var k = i + 1;
          while (k < n && /\s/.test(s.charAt(k))) k++;
          if (s.substr(k, 3).toLowerCase() === 'and' && k + 3 < n && /\s/.test(s.charAt(k + 3))) {
            out.push(s.slice(start, i));
            k += 3;
            while (k < n && /\s/.test(s.charAt(k))) k++;
            start = k;
          }
          i = k - 1;
        }
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
    var parts = splitDepth0(s, ',').map(function (x) { return deLatex(x); });
    if (parts.length === 1) return nameFromNatural(parts[0]);
    var p = { family: parts[0] };
    if (parts.length === 2) {
      if (SUFFIX_RE.test(parts[1]) && /\s/.test(parts[0])) { p = nameFromNatural(parts[0]); p.suffix = parts[1]; } // "Martin Luther King, Jr."
      else p.given = parts[1];
    }
    else if (SUFFIX_RE.test(parts[1]) && !SUFFIX_RE.test(parts[2])) { p.suffix = parts[1]; p.given = parts.slice(2).join(', '); }
    else { p.given = parts[1]; p.suffix = parts.slice(2).join(', '); }
    return p;
  }
  function bibNameList(s) { return s ? splitDepth0(String(s), 'and') : []; }
  function bibNames(s) { return bibNameList(s).map(nameFromBib).filter(Boolean); }
  function bibOthers(s) { var l = bibNameList(s); return l.length > 0 && /^others$/i.test(l[l.length - 1]); }
  function urlClean(s) { return trim(String(s || '').replace(/\\url\{([^}]*)\}/g, '$1').replace(/\\([%_&#$~^])/g, '$1').replace(/[{}]/g, '')); }
  // DOI field: only \_ \% \& \# \~ \{ \} are unescaped; no dash or tilde conversion
  function idClean(s) {
    return trim(String(s || '').replace(/\\url\s*\{([^{}]*)\}/g, '$1').replace(/\\([_%&#~])/g, '$1')
      .replace(/\\\{/g, '\u0004').replace(/\\\}/g, '\u0005').replace(/[{}]/g, '')
      .replace(/\u0004/g, '{').replace(/\u0005/g, '}'));
  }

  // true when src[nl] is a newline followed by (indent and) "@knowntype{" — the start of another entry
  function atEntryLine(src, nl) {
    var k = nl + 1;
    while (src.charAt(k) === ' ' || src.charAt(k) === '\t' || src.charAt(k) === '\r') k++;
    if (src.charAt(k) !== '@') return false;
    var m = src.slice(k + 1, k + 48).match(/^([A-Za-z]+)\s*[{(]/);
    return !!(m && has(BIB_KNOWN, m[1].toLowerCase()));
  }

  // Parse one BibTeX entry whose '@' is at src[at]. Returns null when it is not an entry.
  function bibEntryAt(src, at, macros) {
    var n = src.length, pos = at + 1;
    var tm = src.slice(pos, pos + 80).match(/^([A-Za-z][\w-]*)\s*([{(])/);
    if (!tm) return null;
    var type = tm[1].toLowerCase(), open = tm[2], close = open === '{' ? '}' : ')';
    pos += tm[0].length;
    if (!has(BIB_KNOWN, type)) {
      var la = src.slice(pos, pos + 300);
      if (!/^\s*[^\s,{}()="#%']+\s*,/.test(la) && !/^\s*[A-Za-z][\w:.\-]*\s*=/.test(la)) return null;
    }
    var ws = function () { // skips whitespace; returns the index of the last newline crossed (or -1)
      var nl = -1;
      while (pos < n) { var c = src.charAt(pos); if (c === '\n') nl = pos; else if (!/\s/.test(c)) break; pos++; }
      return nl;
    };
    var ident = function () { var m = src.slice(pos, pos + 256).match(/^[^\s"#%'(),={}]+/); if (!m) return ''; pos += m[0].length; return m[0]; };
    var readValue = function () { // {..} | ".." | number | macro, concatenated with #; stops at a new entry line
      var out = '';
      for (;;) {
        ws();
        var c = src.charAt(pos);
        if (c === '{' || c === '"') {
          var q = pos + 1, depth = c === '{' ? 1 : 0, cut = -1;
          for (; q < n; q++) {
            var ch = src.charAt(q);
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (c === '{' && depth === 0) break; }
            else if (ch === '"' && c === '"' && depth <= 0) break;
            else if (ch === '\n' && atEntryLine(src, q)) { cut = q; break; }
          }
          out += src.slice(pos + 1, q);
          if (cut >= 0) { pos = cut; return out; }
          pos = q + 1;
        } else { var id = ident(); if (!id) break; out += has(macros, id.toLowerCase()) && !/^\d+$/.test(id) ? macros[id.toLowerCase()] : id; }
        var before = pos;
        ws();
        if (src.charAt(pos) === '#') { pos++; continue; }
        pos = before; // leave the newline for the entry-start check
        break;
      }
      return out;
    };
    if (type === 'comment' || type === 'preamble') {
      if (open === '{') {
        var e = matchBrace(src, pos - 1);
        if (src.charAt(e) !== '}') { // unbalanced: stop at the next entry line
          for (var q = pos; q < n; q++) if (src.charAt(q) === '\n' && atEntryLine(src, q)) break;
          e = q - 1;
        }
        pos = e + 1;
      } else {
        if (type === 'preamble') { readValue(); ws(); if (src.charAt(pos) === ')') pos++; }
        else { var cp = src.indexOf(')', pos); pos = cp < 0 ? n : cp + 1; }
      }
      return { kind: 'meta', type: type, start: at, end: pos };
    }
    var fields = {}, key = '', nFields = 0;
    if (type !== 'string') {
      var km = src.slice(pos, pos + 512).match(/^\s*([^\s,={}"#()]*)\s*/);
      var after = src.charAt(pos + km[0].length);
      if (after !== '=') { key = km[1]; pos += km[0].length; if (after === ',') pos++; }
    }
    var end = -1;
    for (;;) {
      var nl = ws();
      var c = src.charAt(pos);
      if (!c) { end = n; break; }
      if (c === '@' && nl >= 0 && atEntryLine(src, nl)) { end = nl; break; } // missing closing brace
      if (c === close) { pos++; end = pos; break; }
      if (c === ',') { pos++; continue; }
      var name = ident().toLowerCase(), nl2 = ws();
      if (src.charAt(pos) === '@' && nl2 >= 0 && atEntryLine(src, nl2)) { end = nl2; break; }
      if (src.charAt(pos) !== '=') {
        while (pos < n && src.charAt(pos) !== ',' && src.charAt(pos) !== close && !(src.charAt(pos) === '\n' && atEntryLine(src, pos))) pos++;
        continue;
      }
      pos++;
      var val = readValue();
      if (name && !has(fields, name)) { fields[name] = val; if (trim(val)) nFields++; } // duplicate fields: first wins
    }
    pos = end;
    if (type === 'string') { for (var k in fields) if (has(fields, k)) macros[k.toLowerCase()] = fields[k]; return { kind: 'meta', type: type, start: at, end: end }; }
    return { kind: type === 'set' || type === 'xdata' ? 'meta' : 'entry', type: type, key: key, fields: fields, nFields: nFields, start: at, end: end };
  }

  // biblatex xdata= and BibTeX crossref= inheritance (parents may appear after the child)
  function resolveBib(entries) {
    var byKey = {};
    entries.forEach(function (e) { var k = String(e.key || '').toLowerCase(); if (k && !has(byKey, k)) byKey[k] = e; });
    var withXdata = function (e, depth) {
      var f = {}, k;
      for (k in e.fields) if (has(e.fields, k)) f[k] = e.fields[k];
      if (f.xdata && depth < 4) {
        f.xdata.split(',').forEach(function (x) {
          var p = byKey[trim(x).toLowerCase()];
          if (!p || p === e) return;
          var pf = withXdata(p, depth + 1);
          for (var j in pf) if (has(pf, j) && !has(f, j) && j !== 'xdata') f[j] = pf[j];
        });
      }
      return f;
    };
    var resolved = function (e, depth) {
      var f = withXdata(e, 0), p = f.crossref && depth < 4 ? byKey[trim(f.crossref).toLowerCase()] : null;
      if (p && p !== e) {
        var pf = resolved(p, depth + 1);
        if (!trim(f.booktitle || '') && (trim(pf.booktitle || '') || trim(pf.title || ''))) f.booktitle = trim(pf.booktitle || '') ? pf.booktitle : pf.title;
        BIB_INHERIT.forEach(function (k) { if (has(pf, k) && !trim(f[k] || '')) f[k] = pf[k]; });
      }
      return f;
    };
    entries.forEach(function (e) { if (e.kind === 'entry') e.merged = resolved(e, 0); });
  }

  function bibRecord(type, key, fields, merged) {
    var fl = merged || fields;
    var g = function (k) { return has(fl, k) ? deLatex(fl[k]) : ''; };
    var gh = function (k) { return has(fl, k) ? deLatex(fl[k], true) : ''; };
    var f = blank('bibtex', { entrytype: type, key: key, fields: fields });
    f.type = BIB_TYPES[type] || 'other';
    var note = g('note');
    if (f.type === 'other' && /^(preprint|dataset|software)$/i.test(note)) f.type = { preprint: 'posted-content', dataset: 'dataset', software: 'software' }[note.toLowerCase()];
    f.authors = bibNames(fl.author); f.editors = bibNames(fl.editor);
    f.authorOthers = bibOthers(fl.author); f.editorOthers = bibOthers(fl.editor);
    f.title = gh('title'); f.subtitle = gh('subtitle');
    f.protectWords = (String(fl.title || '').match(/\{([^{}\\$]+)\}/g) || []).map(function (w) { return deLatex(w.slice(1, -1)); })
      .join(' ').split(/\s+/).filter(function (w) { return /[A-Z]/.test(w); });
    var how = g('howpublished'), howUrl = /^(\\url\{)?https?:\/\//i.test(trim(fl.howpublished || ''));
    f.container = g('journal') || g('journaltitle') || (f.type !== 'book' ? g('booktitle') : '') || (!howUrl ? how : '');
    f.shortContainer = g('shortjournal'); f.series = g('series');
    f.volume = g('volume'); f.issue = g('number') || g('issue');
    f.pages = g('pages').replace(/\s*[-–—]+\s*/g, '-'); f.articleNumber = g('eid') || g('articleno');
    var dt = parseDate(g('date')), ym = g('year').match(/\d{4}/), ms = g('month'), dm = /[a-z]/i.test(ms) ? ms.match(/\b(\d{1,2})\b/) : null;
    f.date = validDate({ y: dt.y || (ym ? Number(ym[0]) : 0), m: dt.m || monthNum(ms), d: dt.d || Number(g('day') || (dm ? dm[1] : 0)) });
    f.accessed = parseDate(g('urldate'));
    f.publisher = g('publisher') || g('school') || g('institution') || g('organization');
    f.place = g('address') || g('location');
    if (fl.issn) idNumbers([g('issn')], f);
    if (fl.isbn) idNumbers([g('isbn')], f);
    f.url = urlClean(fl.url) || (howUrl ? urlClean(fl.howpublished) : '');
    f.doi = doiOf(idClean(fl.doi)) || doiOf(f.url);
    f.abstract = g('abstract'); f.language = g('language') || g('langid'); f.edition = g('edition');
    f.genre = g('type') || BIB_GENRE[type] || ''; f.numPages = g('pagetotal');
    var eprint = trim(fl.eprint || ''), etype = trim(fl.eprinttype || fl.archiveprefix || '').toLowerCase();
    var arxivId = eprint.replace(/^arxiv:/i, '');
    if (arxivId && (etype === 'arxiv' || (!etype && /^\d{4}\.\d{4,5}(v\d+)?$/.test(arxivId))) && /^(other|posted-content)$/.test(f.type)) {
      f.type = 'posted-content'; f.institution = 'arXiv';
      if (!f.doi) f.doi = '10.48550/arXiv.' + arxivId.replace(/v\d+$/, '');
      if (!f.url) f.url = 'https://arxiv.org/abs/' + arxivId;
    }
    return message(f);
  }

  /* ---------- mixed pastes ---------- */

  // -> { records, plain, formats, order: [{kind:'record'|'plain', index}] }
  function parseMixed(text) {
    var src = String(text === undefined || text === null ? '' : text).replace(/﻿/g, '').replace(/\r\n?/g, '\n');
    var lines = src.split('\n'), starts = [], off = 0, i;
    for (i = 0; i < lines.length; i++) { starts.push(off); off += lines[i].length + 1; }
    var segs = [], bibEntries = [], macros = {};
    for (i = 0; i < 12; i++) macros[MONTHS[i]] = MONTHS[i];
    var lineOf = function (p) { // index of the line containing offset p (binary search)
      var lo = 0, hi = starts.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (starts[mid] <= p) lo = mid; else hi = mid - 1; }
      return lo;
    };
    i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var fmt = RIS_START.test(line) ? 'ris' : ENW_START.test(line) ? 'enw' : '', rt;
      if (!fmt && (rt = line.match(RIS_TAG)) && rt[1] !== 'ER' && has(RIS_KNOWN, rt[1])) fmt = 'ris'; // RIS record without TY
      if (fmt) {
        var sc = scanTagged(fmt, lines, i);
        var seg = { fmt: fmt, start: starts[i], end: starts[sc.end] + lines[sc.end].length };
        if (sc.emptyBeforeStart) { seg.meta = true; segs.push(seg); }
        else {
          seg.record = fmt === 'ris' ? risRecord(sc.tags) : enwRecord(sc.tags);
          if (!seg.record.untitled || sc.nKnown >= 2) segs.push(seg);
        }
        i = sc.end + 1;
        continue;
      }
      var at = line.search(/\S/);
      if (at >= 0 && line.charAt(at) === '@') {
        var p = starts[i] + at, lastEnd = -1;
        for (;;) {
          var e = bibEntryAt(src, p, macros);
          if (!e) break;
          e.fmt = 'bibtex';
          if (e.kind === 'meta') e.meta = true;
          segs.push(e); bibEntries.push(e); lastEnd = e.end;
          p = e.end;
          while (p < src.length && (src.charAt(p) === ' ' || src.charAt(p) === '\t')) p++;
          if (src.charAt(p) !== '@') break;
        }
        if (lastEnd >= 0) { i = lineOf(Math.max(lastEnd - 1, starts[i])) + 1; continue; }
      }
      i++;
    }
    // BibTeX records are built last so crossref/xdata parents may follow their children
    resolveBib(bibEntries);
    segs = segs.filter(function (s) {
      if (s.fmt !== 'bibtex' || s.kind !== 'entry') return true;
      s.record = bibRecord(s.type, s.key, s.fields, s.merged);
      return !s.record.untitled || s.nFields >= 2;
    });
    var out = { records: [], plain: [], formats: [], order: [] };
    var addPlain = function (from, to, prevSeg, nextSeg) {
      var chunk = trim(src.slice(from, to));
      if (!chunk) return;
      var nearBib = (prevSeg && prevSeg.fmt === 'bibtex') || (nextSeg && nextSeg.fmt === 'bibtex');
      if (nearBib && /^(\s*%[^\n]*(\n|$))+$/.test(chunk)) return; // .bib comment lines
      out.order.push({ kind: 'plain', index: out.plain.length });
      out.plain.push(chunk);
    };
    var pos = 0, prev = null;
    segs.forEach(function (s) {
      addPlain(pos, s.start, prev, s);
      if (s.record) {
        out.order.push({ kind: 'record', index: out.records.length });
        out.records.push(s.record);
        if (out.formats.indexOf(s.fmt) === -1) out.formats.push(s.fmt);
      }
      pos = s.end; prev = s;
    });
    addPlain(pos, src.length, prev, null);
    return out;
  }

  function only(fmt) { return function (text) { return parseMixed(text).records.filter(function (r) { return r.source === fmt; }); }; }

  /* ---------- detection ---------- */

  // Strict: a format is reported only when it yields a record with a title or at least 2 recognised tags/fields
  function detect(text) { return parseMixed(text).formats[0] || null; }

  function parse(text) {
    var m = parseMixed(text);
    return { format: m.formats[0] || null, records: m.records };
  }

  /* ---------- bytes -> text ---------- */

  // ArrayBuffer | Uint8Array -> string. Honours UTF-8 / UTF-16LE / UTF-16BE BOMs, guesses BOM-less UTF-16
  // from NUL bytes, and falls back to Windows-1252 when the bytes are not valid UTF-8.
  function decodeBytes(buf) {
    var b = buf instanceof Uint8Array ? buf : new Uint8Array(buf && buf.buffer && !(buf instanceof ArrayBuffer) ? buf.buffer : buf);
    var enc = 'utf-8', skip = 0;
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) { enc = 'utf-16le'; skip = 2; }
    else if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) { enc = 'utf-16be'; skip = 2; }
    else if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) skip = 3;
    else {
      var lim = Math.min(b.length, 4096), even = 0, odd = 0;
      for (var i = 0; i < lim; i++) if (b[i] === 0) { if (i % 2) odd++; else even++; }
      if ((even + odd) > lim / 4) enc = odd >= even ? 'utf-16le' : 'utf-16be';
    }
    var body = b.subarray(skip);
    if (typeof TextDecoder !== 'undefined') {
      if (enc !== 'utf-8') return new TextDecoder(enc).decode(body).replace(/﻿/g, '');
      try { return new TextDecoder('utf-8', { fatal: true }).decode(body).replace(/﻿/g, ''); }
      catch (err) { try { return new TextDecoder('windows-1252').decode(body); } catch (err2) { return new TextDecoder('utf-8').decode(body); } }
    }
    var out = [], j, chunk = [];
    var flush = function () { out.push(String.fromCharCode.apply(null, chunk)); chunk = []; };
    if (enc !== 'utf-8') {
      var le = enc === 'utf-16le';
      for (j = 0; j + 1 < body.length; j += 2) { chunk.push(le ? body[j] | (body[j + 1] << 8) : (body[j] << 8) | body[j + 1]); if (chunk.length >= 8192) flush(); }
    } else {
      for (j = 0; j < body.length;) { // minimal UTF-8 decoder (invalid bytes read as Latin-1)
        var c = body[j], cp = c, len = 1;
        if (c >= 0xC2 && c < 0xE0 && (body[j + 1] & 0xC0) === 0x80) { cp = ((c & 31) << 6) | (body[j + 1] & 63); len = 2; }
        else if (c >= 0xE0 && c < 0xF0 && (body[j + 1] & 0xC0) === 0x80 && (body[j + 2] & 0xC0) === 0x80) { cp = ((c & 15) << 12) | ((body[j + 1] & 63) << 6) | (body[j + 2] & 63); len = 3; }
        else if (c >= 0xF0 && c < 0xF5 && (body[j + 1] & 0xC0) === 0x80 && (body[j + 2] & 0xC0) === 0x80 && (body[j + 3] & 0xC0) === 0x80) {
          cp = ((c & 7) << 18) | ((body[j + 1] & 63) << 12) | ((body[j + 2] & 63) << 6) | (body[j + 3] & 63); len = 4;
        }
        if (cp > 0xFFFF) { cp -= 0x10000; chunk.push(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023)); } else chunk.push(cp);
        j += len;
        if (chunk.length >= 8192) flush();
      }
    }
    flush();
    return out.join('').replace(/﻿/g, '');
  }

  var api = { detect: detect, parse: parse, parseMixed: parseMixed, decodeBytes: decodeBytes,
    parseRIS: only('ris'), parseENW: only('enw'), parseBibTeX: only('bibtex'),
    deLatex: deLatex, parseBibName: nameFromBib, parseTaggedName: nameFromTagged, parseDate: parseDate };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AutoDOIParsers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
