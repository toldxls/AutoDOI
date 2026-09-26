/*
 * AutoDOI — shared citation library.
 * Pure functions only (no DOM, no network) so the same file runs in the browser
 * page (index.html) and in Google Apps Script (apps-script/Citations.gs).
 *
 * Input: a CSL-JSON-like record as returned by api.crossref.org (message object)
 * or by doi.org content negotiation (application/vnd.citationstyles.csl+json).
 */
(function (root) {
  'use strict';

  var DOI_RE = /10\.\d{4,9}\/[^\s"']+/i;
  // HTML tags that abut a DOI in pasted markup: "10.1000/abc</a>", "10.1000/abc<br/>" (a SICI's "<857::AID-SIM777>" is not a tag)
  var DOI_TAG_RE = /<\/?(?:a|br|p|div|span|i|b|em|strong|sub|sup|u|li|td|tr|font)\b[^<>]*>/gi;
  var DOI_TAIL = /[.,;:!?*\u2026\u2014"'\u201C\u201D\u2018\u2019]/; // punctuation and quotes that close a sentence, not a DOI

  /* ---------- helpers ---------- */

  // Trailing characters matching re removed by a backwards scan (the regex /[...]+$/ is quadratic on long runs)
  function trimTail(s, re) {
    var i = s.length;
    while (i > 0 && re.test(s.charAt(i - 1))) i--;
    return i === s.length ? s : s.slice(0, i);
  }
  // Trailing ")", "]" or ">" removed only while unbalanced (counted once: "10.1000/" + 50k ")" is linear)
  function trimUnbalanced(doi) {
    var open = 0, close = 0, lt = 0, gt = 0, i, c;
    for (i = 0; i < doi.length; i++) {
      c = doi.charAt(i);
      if (c === '(' || c === '[') open++; else if (c === ')' || c === ']') close++; else if (c === '<') lt++; else if (c === '>') gt++;
    }
    var end = doi.length;
    while (end > 0) {
      c = doi.charAt(end - 1);
      if ((c === ')' || c === ']') && close > open) close--;
      else if (c === '>' && gt > lt) gt--;
      else break;
      end--;
    }
    return end === doi.length ? doi : doi.slice(0, end);
  }
  function extractDoi(text) {
    if (!text) return null;
    var s = String(text).replace(DOI_TAG_RE, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    var m = s.match(DOI_RE);
    if (!m) return null;
    var doi = m[0];
    // a DOI inside a link: "?query" and "#fragment" belong to the URL, and reserved characters arrive percent-encoded
    if (/https?:\/\/[^\s"'<>]*$/i.test(s.slice(0, m.index))) {
      doi = doi.replace(/[?#].*$/, '');
      if (/%[0-9A-Fa-f]{2}/.test(doi)) { try { doi = decodeURIComponent(doi); } catch (e) { /* malformed escape: keep as written */ } }
    }
    // publisher landing-page suffixes, closing punctuation, quotes and unbalanced brackets, until nothing more comes off: "(see 10.1000/abc.)"
    var prev;
    do {
      prev = doi;
      doi = doi.replace(/\/(full|abstract|pdf|epdf|epub|fulltext|html|meta|summary|references|figures|tables|supplemental|suppl_file)(?:[\/;].*)?$/i, '');
      doi = trimUnbalanced(trimTail(doi.replace(/(?:'|\u2019)s$/, '').replace(/[\u00B2\u00B3\u00B9\u2070-\u209F]+$/, ''), DOI_TAIL)); // a footnote number set in superscript after the DOI
    } while (doi !== prev);
    if (!/^10\.\d{4,9}\/./.test(doi)) return null; // nothing left after the prefix
    // bioRxiv / medRxiv landing pages: 10.1101/2020.03.24.20042937v3.full -> 10.1101/2020.03.24.20042937
    if (/^10\.1101\//.test(doi)) doi = doi.replace(/(?:v\d+)?(?:\.(?:full|abstract|full-text|supplementary-material|article-info|article-metrics)(?:\.pdf(?:\+html)?)?)?$/i, '');
    return doi;
  }

  // A DOI, or an arXiv identifier mapped to its DataCite DOI (arXiv:2301.01234 -> 10.48550/arXiv.2301.01234)
  function toDoi(text) {
    var doi = extractDoi(text);
    if (doi) return doi;
    var t = String(text || '').trim();
    var m = t.match(/(?:arxiv\.org\/(?:abs|pdf|html)\/|arxiv:\s*)(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i)
      || t.match(/^(\d{4}\.\d{4,5})(?:v\d+)?\.?$/);
    if (m) return '10.48550/arXiv.' + m[1];
    return null;
  }

  // PubMed / PMC identifiers in free text: "PMID: 23903748", "PMC4221854", a pubmed.ncbi.nlm.nih.gov link
  function extractPmid(text) {
    var t = String(text || '');
    var m = t.match(/\bPMC\d{4,9}\b/i);
    if (m) return { type: 'pmcid', id: m[0].toUpperCase() };
    m = t.match(/(?:pmid\s*:?\s*|pubmed\.ncbi\.nlm\.nih\.gov\/|pubmed\/)(\d{4,9})/i) || t.trim().match(/^(\d{4,9})$/);
    if (m) return { type: 'pmid', id: m[1] };
    return null;
  }

  // ISBN-10 or ISBN-13 in free text, returned as bare digits, checksum verified. Accepted: an "ISBN" prefix
  // ("ISBN 978-0-521-38707-1", "ISBN 0521387078"), a 978/979 13-digit number, a hyphenated 4-group ISBN-10
  // ("0-521-38707-8"), or a bare ISBN-10 that is the whole input. Page ranges and phone numbers are not ISBNs.
  function isbnChecksum(raw) {
    var d = String(raw).replace(/[\s-]/g, '').toUpperCase();
    if (/^\d{13}$/.test(d)) {
      var sum = 0; for (var i = 0; i < 12; i++) sum += Number(d.charAt(i)) * (i % 2 ? 3 : 1);
      return (10 - sum % 10) % 10 === Number(d.charAt(12)) ? d : null;
    }
    if (/^\d{9}[\dX]$/.test(d)) {
      var s10 = 0; for (var j = 0; j < 9; j++) s10 += Number(d.charAt(j)) * (10 - j);
      s10 += d.charAt(9) === 'X' ? 10 : Number(d.charAt(9));
      return s10 % 11 === 0 ? d : null;
    }
    return null;
  }
  function extractIsbn(text) {
    var t = String(text || ''), m, d;
    var bare = t.trim().match(/^(\d{9}[\dXx])$/);
    if (bare) return isbnChecksum(bare[1]);
    var pats = [
      /\bISBN(?:-?1[03])?\s*:?\s*(97[89](?:[\s-]?\d){10}|\d(?:[\s-]?\d){8}[\s-]?[\dXx])(?![\dXx])/gi,
      /(?:^|[^\d-])(97[89](?:[\s-]?\d){10})(?![\dXx])(?!-\d)/g,
      /(?:^|[^\d-])(\d{1,5}-\d{1,7}-\d{1,7}-[\dXx])(?![\dXx-])/g
    ];
    for (var k = 0; k < pats.length; k++) {
      var re = pats[k];
      while ((m = re.exec(t))) {
        var before = t.slice(0, m.index + m[0].length - m[1].length);
        if (k > 0 && /(?:\bpp?\.?|\bpages?|\bvol\.?|\bvolume|\bno\.?|\bnr\.?|\bdoi:?)\s*$/i.test(before)) continue;
        if (k === 2 && m[1].replace(/-/g, '').length !== 10) continue;
        if ((d = isbnChecksum(m[1]))) return d;
      }
    }
    return null;
  }

  // "Georg Kucsko" / "Peter C. Maurer" / "van der Walt, Stéfan" / "Martin Luther King, Jr." -> {family, given, suffix?}
  var NAME_PARTICLE = /^(?:van|von|de|der|den|del|della|delle|da|di|du|la|le|los|las|dos|das|ter|ten|zu|zur|af|av)$/; // lowercase only
  var NAME_SUFFIX = /^(?:Jr\.?|Sr\.?|II|III|IV)$/;
  function splitName(full) {
    var n = clean(full);
    if (!n) return null;
    var suffix = '', parts = n.split(/\s*,\s*/), out;
    if (parts.length > 1 && NAME_SUFFIX.test(parts[parts.length - 1])) suffix = parts.pop();   // "King, Jr." / "King, Martin Luther, Jr."
    if (parts.length > 1) {
      var given = parts.slice(1).join(', '), gt = given.split(/\s+/);
      if (!suffix && gt.length > 1 && NAME_SUFFIX.test(gt[gt.length - 1])) { suffix = gt.pop(); given = gt.join(' '); }
      out = { family: parts[0], given: given };
    } else {
      var toks = parts[0].split(/\s+/);
      if (!suffix && toks.length > 1 && NAME_SUFFIX.test(toks[toks.length - 1])) suffix = toks.pop(); // "John Smith III"
      if (toks.length === 1) return suffix ? { family: toks[0], given: '', suffix: suffix } : { name: n };
      var fam = [toks.pop()];
      while (toks.length > 0 && NAME_PARTICLE.test(toks[toks.length - 1])) fam.unshift(toks.pop()); // "de la Cruz": particles and one capitalised word are a family name
      out = { family: fam.join(' '), given: toks.join(' ') };
    }
    if (suffix) out.suffix = suffix;
    return out;
  }

  // OpenAlex work -> Crossref-message-like object for normalize()
  function fromOpenAlex(w) {
    var loc = w.primary_location || (w.locations && w.locations[0]) || {};
    var src = loc.source || {};
    var typeMap = { article: 'journal-article', preprint: 'posted-content', 'book-chapter': 'book-chapter', 'conference-paper': 'proceedings-article', 'conference-abstract': 'journal-article',
      book: 'book', dissertation: 'dissertation', dataset: 'dataset', report: 'report', standard: 'standard', editorial: 'journal-article', letter: 'journal-article', erratum: 'journal-article',
      review: 'journal-article', paratext: 'other', 'peer-review': 'peer-review', 'reference-entry': 'reference-entry', 'supplementary-materials': 'other', libguides: 'other', grant: 'other' };
    var type = typeMap[w.type] || 'other';
    if (w.type === 'article' && src.type === 'repository') type = 'posted-content';
    if (w.type === 'article' && (src.type === 'conference' || /proceedings/i.test(src.display_name || ''))) type = 'proceedings-article';
    var b = w.biblio || {};
    var doi = (w.doi || (w.ids && w.ids.doi) || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    var date = (w.publication_date || String(w.publication_year || '')).split('-').map(Number).filter(Boolean);
    var m = {
      type: type, DOI: doi, URL: doi ? 'https://doi.org/' + doi : (loc.landing_page_url || w.id),
      title: [w.title || w.display_name || ''],
      author: (w.authorships || []).map(function (a) { return splitName((a.author && a.author.display_name) || a.raw_author_name || '') || { name: '' }; }).filter(function (a) { return a.family || a.name; }),
      'container-title': src.display_name ? [src.display_name] : [],
      volume: b.volume || '', issue: b.issue || '',
      page: b.first_page ? (b.last_page && b.last_page !== b.first_page ? b.first_page + '-' + b.last_page : b.first_page) : '',
      issued: { 'date-parts': [date.length ? date : []] },
      publisher: src.host_organization_name || '',
      ISSN: src.issn_l ? [src.issn_l] : [],
      is_retracted: w.is_retracted === true,
      source: 'openalex'
    };
    if (type === 'posted-content' && src.display_name) { m.institution = [{ name: src.display_name }]; m['container-title'] = []; }
    return m;
  }

  // Open Library search.json doc -> Crossref-message-like book object
  function fromOpenLibrary(doc, isbn) {
    var years = (Array.isArray(doc.publish_year) ? doc.publish_year : []).map(Number).filter(function (y) { return y > 0; });
    var year = doc.first_publish_year || (years.length ? Math.min.apply(null, years) : '') || ''; // an empty list is not year Infinity
    return {
      type: 'book',
      title: [doc.title ? doc.title + (doc.subtitle ? ': ' + doc.subtitle : '') : (doc.subtitle || '')],
      author: (doc.author_name || []).map(function (n) { return splitName(n) || { name: n }; }),
      publisher: (doc.publisher || [])[0] || '',
      'publisher-location': (doc.publish_place || [])[0] || '',
      issued: { 'date-parts': [year ? [Number(year)] : []] },
      ISBN: [isbn || (doc.isbn || [])[0] || ''],
      'number-of-pages': doc.number_of_pages_median ? String(doc.number_of_pages_median) : '',
      URL: doc.key ? 'https://openlibrary.org' + doc.key : '',
      source: 'openlibrary'
    };
  }

  function first(v) { return Array.isArray(v) ? v[0] : v; }

  // Named entities that survive in deposited titles ("&delta;18O", "&amp;Delta;"); numeric ones are decoded generically
  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', alpha: 'α', beta: 'β', gamma: 'γ', Gamma: 'Γ',
    delta: 'δ', Delta: 'Δ', epsilon: 'ε', epsi: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', Theta: 'Θ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', Lambda: 'Λ', mu: 'μ', nu: 'ν', xi: 'ξ', Xi: 'Ξ', pi: 'π', Pi: 'Π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ',
    upsilon: 'υ', phi: 'φ', Phi: 'Φ', chi: 'χ', psi: 'ψ', Psi: 'Ψ', omega: 'ω', Omega: 'Ω', micro: 'µ', minus: '−', ndash: '–',
    mdash: '—', times: '×', deg: '°', plusmn: '±', middot: '·', prime: '′', Prime: '″', lsquo: '‘', rsquo: '’', ldquo: '“',
    rdquo: '”', hellip: '…', le: '≤', ge: '≥', rarr: '→', harr: '↔', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö',
    Uuml: 'Ü', szlig: 'ß', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', agrave: 'à', egrave: 'è',
    ntilde: 'ñ', ccedil: 'ç', Aring: 'Å', aring: 'å', oslash: 'ø', Oslash: 'Ø' };
  // Some publishers deposit special characters as spelled-out placeholders: "Zn4Si2O7(OH)2{middle dot}H2O"
  var PLACEHOLDERS = { 'middle dot': '\u00B7', 'bullet': '\u2022', 'times': '\u00D7', 'degree': '\u00B0', 'degrees': '\u00B0', 'plus minus': '\u00B1',
    'plus or minus': '\u00B1', 'minus': '\u2212', 'en dash': '\u2013', 'em dash': '\u2014', 'prime': '\u2032', 'double prime': '\u2033', 'alpha': '\u03B1',
    'beta': '\u03B2', 'gamma': '\u03B3', 'delta': '\u03B4', 'Delta': '\u0394', 'epsilon': '\u03B5', 'mu': '\u03BC', 'micro': '\u00B5', 'sigma': '\u03C3',
    'Sigma': '\u03A3', 'lambda': '\u03BB', 'pi': '\u03C0', 'theta': '\u03B8', 'omega': '\u03C9', 'Omega': '\u03A9', 'approximately': '\u2248',
    'less than or equal to': '\u2264', 'greater than or equal to': '\u2265', 'square': '\u25A1', 'box': '\u25A1', 'right arrow': '\u2192', 'rightarrow': '\u2192' };
  function decodeEntities(s) {
    s = s.replace(/\{([A-Za-z][A-Za-z ]{1,24})\}/g, function (all, w) { return Object.prototype.hasOwnProperty.call(PLACEHOLDERS, w) ? PLACEHOLDERS[w] : all; });
    for (var guard = 0; guard < 4 && /&amp;(?:amp;)*(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z]+);/.test(s); guard++) s = s.replace(/&amp;(?=(?:amp;)*(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z]+);)/g, '&'); // "&amp;delta;", "&amp;amp;#8220;": encoded two or three times over
    return s.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z]+);/g, function (all, e) {
      if (e.charAt(0) !== '#') return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : all;
      var n = /^#[xX]/.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!(n > 0) || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF) || (n >= 0xE000 && n <= 0xF8FF) || n >= 0xF0000) return '';
      if (n > 0xFFFF) { n -= 0x10000; return String.fromCharCode(0xD800 + (n >> 10), 0xDC00 + (n & 0x3FF)); }
      return String.fromCharCode(n);
    });
  }
  // A real tag: "<sub>", "</mml:math>", "<br/>", "<a href=…>", or an HTML comment; "CD4 <200 cells/µL and viral load >1000" is text
  // (the comment opener is spelled with an escape so this file can be inlined into index.html)
  var TAG_RE = /<\/?[A-Za-z][\w:.-]*(?:\s[^<>]*)?\/?>|<\x21--[\s\S]*?--\x3e/g;
  // Tags removed, entities decoded, whitespace collapsed; private-use formatting markers removed unless keepMarks
  function cleanText(s, keepMarks) {
    if (s === undefined || s === null) return '';
    var t = String(s);
    if (t.indexOf('lt;') !== -1) { t = t.replace(ENCODED_TAG, '<$1>'); ENCODED_TAG.lastIndex = 0; } // "&lt;i&gt;" is markup, not text
    t = decodeEntities(t.replace(TAG_RE, ''))
      .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')  // zero-width space, bidi controls (ZWJ/ZWNJ are spelling)
      .replace(/[\uE007-\uF8FF]|[\uDB80-\uDBFF][\uDC00-\uDFFF]/g, ''); // publisher private-use glyphs (Elsevier U+E5F8) have no meaning here
    if (!keepMarks) t = t.replace(PUA_RE, '');
    return t.replace(/\s+/g, ' ').replace(/ ([,;:.!?])(?= |$)/g, '$1').trim(); // "Endodontics , Third Edition": a stray space before punctuation is a typing slip, not text
  }
  function clean(s) { return cleanText(s, false); }

  // Library-catalogue records (BHL, MARC) leave trailing " :", " ,", " ;" on places and publishers
  // (a backwards scan: the regex /[\s,:;\/]+$/ is quadratic on long runs of ", " that do not reach the end)
  function trimPunct(s) {
    var t = String(s || ''), i = t.length;
    while (i > 0 && /[\s,:;\/]/.test(t.charAt(i - 1))) i--;
    return t.slice(0, i).trim();
  }

  function cleanAbstract(s) {
    if (!s) return '';
    var t = String(s).replace(/<\/(jats:p|jats:title|jats:sec|p|title|sec)>/gi, ' ');
    t = clean(t).replace(/^(Abstract|Summary)\b[\s.:]*/i, '');
    return t;
  }

  function esc(s, inItalic) {
    var e = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return HAS_MARK.test(e) ? marksToHtml(e, inItalic) : e;
  }

  function stripTags(html) {
    return String(html)
      .replace(/<sub>([^<]*)<\/sub>/g, function (a, t) { return marksToText(SUBO + t + SUBC); })
      .replace(/<sup>([^<]*)<\/sup>/g, function (a, t) { return marksToText(SUPO + t + SUPC); })
      .replace(TAG_RE, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  /* ---------- chemical formulas, isotopes and italics in titles ----------
   * Titles carry formatting as private-use markers so it survives case conversion and every style:
   *   U+E000..U+E001 subscript, U+E002..U+E003 superscript, U+E004..U+E005 italic (e.g. taxa); U+E006 is an internal space.
   * Deposited <sub>/<sup>/<i> and MathML are honoured; plain "Fe2O3", "Fe3+", "40Ar/39Ar", "δ18O"
   * are detected. HTML output turns markers into tags, plain text into Unicode (Fe₂O₃), BibTeX into LaTeX. */
  var OPTIONS = { formulas: true };
  var SUBO = '', SUBC = '', SUPO = '', SUPC = '', ITO = '', ITC = '', KEEP_SP = '';
  var MARKS_RE = /[-]/g, HAS_MARK = /[-]/, PUA_RE = /[-]/g;
  function stripMarks(s) { return String(s || '').replace(MARKS_RE, ''); }
  function sub(t) { return SUBO + t + SUBC; }
  function sup(t) { return SUPO + t + SUPC; }

  var ELEM = {};
  ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc ' +
   'Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po ' +
   'At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr').split(' ').forEach(function (e, i) { ELEM[e] = i + 1; });

  // Commonly cited isotopes. One-letter elements must be listed ("50K", "48V", "7B", "100W", "10C" are sizes and units);
  // two-letter elements also accept any plausible mass number.
  var ISOTOPES = {};
  ('1H 2H 3H 3He 4He 6Li 7Li 7Be 9Be 10Be 10B 11B 11C 12C 13C 14C 13N 14N 15N 15O 16O 17O 18O 18F 19F 20Ne 21Ne 22Ne 23Na 24Mg 25Mg ' +
   '26Mg 26Al 27Al 28Si 29Si 30Si 31P 32P 33P 32S 33S 34S 35S 36S 35Cl 36Cl 37Cl 36Ar 38Ar 39Ar 40Ar 39K 40K 41K 40Ca 41Ca 42Ca 44Ca ' +
   '48Ca 45Sc 50Ti 50V 51V 50Cr 52Cr 53Cr 53Mn 54Fe 56Fe 57Fe 58Fe 60Fe 59Co 60Co 58Ni 60Ni 62Ni 63Cu 64Cu 65Cu 64Zn 66Zn 68Zn 67Ga ' +
   '68Ga 69Ga 71Ga 70Ge 74Ge 75As 76Se 77Se 78Se 80Se 82Se 79Br 81Br 78Kr 80Kr 81Kr 82Kr 83Kr 84Kr 86Kr 85Rb 87Rb 84Sr 86Sr 87Sr ' +
   '88Sr 89Sr 90Sr 89Y 90Y 89Zr 90Zr 91Zr 92Mo 95Mo 98Mo 99Tc 99mTc 106Ru 107Ag 109Ag 111Cd 114Cd 111In 113In 115In 116Sn 118Sn ' +
   '120Sn 121Sb 123Sb 125Te 123I 125I 127I 129I 131I 124Xe 129Xe 130Xe 132Xe 134Xe 136Xe 133Cs 134Cs 135Cs 137Cs 130Ba 132Ba 135Ba ' +
   '137Ba 138Ba 138La 139La 136Ce 138Ce 140Ce 142Ce 141Pr 142Nd 143Nd 144Nd 145Nd 146Nd 144Sm 147Sm 149Sm 152Sm 153Sm 151Eu 153Eu ' +
   '152Gd 158Gd 159Tb 163Dy 165Ho 166Er 169Tm 172Yb 174Yb 175Lu 176Lu 177Lu 174Hf 176Hf 177Hf 178Hf 180Hf 181Ta 182W 183W 184W ' +
   '186W 185Re 187Re 186Os 187Os 188Os 190Os 192Os 191Ir 193Ir 190Pt 195Pt 197Au 198Au 199Hg 202Hg 201Tl 203Tl 205Tl 204Pb 206Pb ' +
   '207Pb 208Pb 210Pb 209Bi 213Bi 210Po 211At 222Rn 223Ra 226Ra 228Ra 225Ac 227Ac 228Th 230Th 232Th 231Pa 233U 234U 235U 236U 238U ' +
   '237Np 239Pu 240Pu 241Am').split(' ').forEach(function (x) { ISOTOPES[x] = true; });
  function isIsotope(mass, meta, sym) {
    if (!ELEM[sym]) return false;
    if (ISOTOPES[mass + meta + sym]) return true;
    if (meta || sym.length === 1) return false;
    var a = Number(mass), z = ELEM[sym];
    return a >= z && a <= 2.7 * z + 3;
  }
  var LABELLED = { C: 1, N: 1, O: 1, S: 1, Cl: 1, Tc: 1, Fe: 1, Zn: 1, Cu: 1, Mo: 1, Sr: 1, Ca: 1, P: 1 }; // tracer-labelled species
  function isotope(p) { // 40Ar, 18O, 87Sr, 3He, 206Pb, 99mTc
    var m = p.match(/^(\d{1,3})(m?)([A-Z][a-z]?)$/);
    return m && isIsotope(m[1], m[2], m[3]) ? sup(m[1] + m[2]) + m[3] : null;
  }
  function isotopeQualified(p) { // δ13Corg, δ18Osw, δ34Spy: isotope followed by a lowercase qualifier
    var m = p.match(/^(\d{1,3})([A-Z])([a-z]{1,6})$/);
    if (!m || !(isIsotope(m[1], '', m[2]) || isIsotope(m[1], '', m[2] + m[3].charAt(0)))) return null;
    return sup(m[1]) + m[2] + m[3];
  }

  // Formula text split into elements, counts, brackets; null when it is not formula-shaped
  // Counts: 2, 0.5, solid-solution variables "x", "2x", "δ" and expressions "1−x", "3-δ", "1+x"
  var VAR_COUNT = /^(?:\d+(?:\.\d+)?[−+-]\d*(?:\.\d+)?[xyδ]|\d*(?:\.\d+)?[xyδ](?:[−+-]\d+(?:\.\d+)?)?)(?![a-z])/;
  function formulaTokens(s) {
    var toks = [], i = 0, depth = 0, m, last;
    while (i < s.length) {
      var rest = s.slice(i);
      last = toks[toks.length - 1];
      if (rest.charAt(0) === '□') { toks.push({ t: 'el', v: '□' }); i++; continue; } // vacancy: □Ca2Mg5Si8O22(OH)2
      if ((m = rest.match(/^[A-Z][a-z]?/))) {
        var sym = m[0];
        if (!ELEM[sym]) { if (sym.length === 2 && ELEM[sym.charAt(0)]) sym = sym.charAt(0); else return null; }
        toks.push({ t: 'el', v: sym }); i += sym.length; continue;
      }
      var metal = last && last.t === 'el' && (last.v.length === 2 || /^[VUWYK]$/.test(last.v));
      // "Fe3+2(H2O)4", "Fe2+3Al2Si3O12", "(Mg,Fe2+)2SiO4", "(Fe3+,Al)2O3": a metal's oxidation state inside the formula,
      // followed by a count, a bracket, or (inside a site list) a comma or the closing bracket
      // …or, in a mineral formula written IMA style, by the next element: "Ca19Fe2+Al4(Al7Fe2+)(SiO4)10" (vesuvianite group), "KFe2+Fe3+(SO4)2"
      var mineral = /[(\[]/.test(s) || (s.match(/[A-Z][a-z]?(?![a-z])/g) || []).filter(function (e, i, a) { return ELEM[e] && a.indexOf(e) === i; }).length >= 3; // "Ca2+Mg2+ ratio" is not one
      if (metal && (m = rest.match(depth > 0 ? /^(\d[+−])(?=\d|[(\[,)\]])/ : /^(\d[+−])(?=\d|[(\[])/)) || (metal && mineral && (m = rest.match(/^(\d[+−])(?=[A-Z][a-z]?(?![a-z])|$)/)))) {
        toks.push({ t: 'ox', v: m[1] }); i += m[1].length; continue;
      }
      // IMA order, count before charge: "PbFe22+V23+(PO4)3(OH)3" -> PbFe₂²⁺V₂³⁺(PO₄)₃(OH)₃
      if (metal && (m = rest.match(/^(\d)(\d[+−])(?=[A-Z(\[,)\]□])/))) {
        toks.push({ t: 'n', v: m[1] }); toks.push({ t: 'ox', v: m[2] }); i += m[0].length; continue;
      }
      if ((m = rest.match(/^\d+(?:\.\d+)?(?![−+-]\d*(?:\.\d+)?[xyδ](?![a-z]))/)) || (m = rest.match(VAR_COUNT))) {
        if (!last || (last.t !== 'el' && last.t !== 'close' && last.t !== 'ox')) return null;
        toks.push({ t: 'n', v: m[0].replace('-', '−') }); i += m[0].length; continue;
      }
      var c = rest.charAt(0);
      if (c === '(' || c === '[') { toks.push({ t: 'open', v: c }); depth++; i++; continue; }
      if ((c === ')' || c === ']') && depth > 0) { toks.push({ t: 'close', v: c }); depth--; i++; continue; }
      if (c === ',' && depth > 0) { var sp = s.charAt(i + 1) === KEEP_SP; toks.push({ t: 'comma', v: sp ? ', ' : ',' }); i += sp ? 2 : 1; continue; }
      return null;
    }
    return depth === 0 && toks.length ? toks : null;
  }
  function renderTokens(toks) { return toks.map(function (k) { return k.t === 'n' ? sub(k.v) : k.t === 'ox' ? sup(k.v.replace('-', '\u2212')) : k.v; }).join(''); }

  // Simple molecules and ions written only with one-letter elements (SH2, HSP70, NOS2, C3H, U2OS are genes and cell lines)
  var SIMPLE = {};
  ('H2O CO2 CO3 CH2 CH3 CH4 NH2 NH3 NH4 NO2 NO3 N2O SO2 SO3 SO4 PO3 PO4 O3 H2S H3O HCO3 CS2 CF4 BF3 BF4 NF3 SF4 SF6 PF5 PF6 ' +
   'UF4 UF6 WF6 IF5 IF7 K2O K2S WS2 WO3 WO4 VO2 VO4 UO2 UO3 IO3 IO4 BH3 BH4 PH3 CH3OH CH2O CH3CN CH3COOH HNO2 HNO3 KNO3 KIO3 ' +
   'YPO4 KOH2 H2O2 SiO2 TiO2 ClO4 MnO4 CrO4 Cr2O7 CCl4').split(' ').forEach(function (x) { SIMPLE[x] = true; });
  var SIMPLE_RE = [
    /^[A-Z]\d*O\d*$/,                     // oxides: CO2, N2O, K2O, WO3
    /^[BCNP]H\d$|^H\dS$/,                 // hydrides: CH4, NH3, PH3, H2S
    /^[BCNPSUWI]\d?F[1-7]$/,              // fluorides: CF4, BF3, SF6, UF6
    /^(?:H\d?|K|Y|U)?[BCNPSI]O[2-4]$/,    // oxyanions and acids: HCO3, HNO3, H2PO4, KNO3, YPO4
    /^C\d*H\d+(?:C\d*H\d+|COOH|OOH|CO|CN|O\d*H?|N\d*H\d*)*$/ // small organics: CH3OH, CH3COOH, CH3NH2
  ];
  var NOT_FORMULA = /^(?:H\d{1,2}N\d{1,2}|B16F\d+|(?:Ca|Na|Co)V\d.*)$/; // influenza subtypes, cell lines, channels (CaV1.2, NaV1.5)
  var BARE_IONS = { OH: 1, CN: 1, SCN: 1, HS: 1, NO: 1, CO: 1, ClO: 1, OCl: 1, BrO: 1, IO: 1 }; // no count, still charged: OH−, NO+
  var NO_BARE_CHARGE = { O: 1, Rh: 1, B: 1, C: 1 };   // O+, Rh+ blood groups; B+, C++ grades and languages
  var MAX_VALENCE = { H: 1, B: 0, C: 0, N: 5, O: 2, F: 1, P: 5, S: 6, K: 1, V: 5, Y: 3, I: 7, W: 6, U: 6 };

  // Is this uncharged token list a chemical formula?
  function acceptNeutral(toks, loose) {
    var elems = 0, groups = 0, two = false, paren = false, str = '', expr = false, loneLast = false;
    for (var i = 0; i < toks.length; i++) {
      var k = toks[i];
      if (k.t === 'el') {
        elems++; if (k.v.length === 2) two = true;
        if (i >= 2 && toks[i - 1].t === 'n' && toks[i - 2].t === 'el' && toks[i - 2].v === k.v) return false; // C2C12, B2B
      } else if (k.t === 'n') {
        groups++;
        if (k.v === '1' || (k.v.indexOf('.') === -1 && Number(k.v) >= 100)) return false; // formulas never write 1; 9001 is not a count
        if (/[xyδ]/.test(k.v)) {                                   // solid solution: Fe1−xS, MgxFe1−xSiO3, (NH4)xWO3
          if (/[\u2212+]/.test(k.v)) expr = true;
          else if (i === toks.length - 1 && toks[i - 1].t !== 'close') loneLast = true; // NOx, SOx, CHx: not a formula count
        }
      } else if (k.t === 'open') paren = true;
      else if (k.t === 'ox') { paren = true; continue; }           // an explicit oxidation state is unmistakably chemistry
      str += k.t === 'comma' ? ',' : k.v;
    }
    if (loneLast && !expr) return false;
    if (str === 'O3') return true;                                    // ozone, the one common single-element formula
    if (elems < 2 || !groups || NOT_FORMULA.test(str)) return false;
    if (paren || two || loose || SIMPLE[str]) return true;
    for (var j = 0; j < SIMPLE_RE.length; j++) if (SIMPLE_RE[j].test(str)) return true;
    return groups >= 2;                               // two or more counts: H2SO4, C2H6, N2O5
  }

  // One formula such as Mg2SiO4, (Mg,Fe)2SiO4, Ca3Zr2[Fe2SiO12], Fe3+, SO42−, NH4+ -> marked string, or null.
  // loose: part of a hydrate ("…·nH2O"), where any well-formed formula is accepted.
  function parseFormula(s, loose) {
    var cm = s.match(/^(.+?)([+−]{1,2}|-{1,2})$/);
    var toks = formulaTokens(cm ? cm[1] : s);
    if (!toks) return null;
    if (!cm) return acceptNeutral(toks, loose) ? renderTokens(toks) : null;
    var sign = cm[2], S = sign.replace(/-/g, '−'), last = toks[toks.length - 1], prev = toks[toks.length - 2];
    if (sign.charAt(0) === '-' && last.t !== 'n') return null;        // "Mg-", "Cl-" is a suspended hyphen ("Mg- and Fe-rich")
    var d = last.t === 'n' ? last.v : '';
    if (d.indexOf('.') !== -1) return null;
    if (toks.length === 1 || (toks.length === 2 && d)) {        // single element: Fe3+, Na+, Cl−, O2−, H2+, C60+
      var sym = toks[0].v, max = MAX_VALENCE[sym] !== undefined ? MAX_VALENCE[sym] : 8;
      if (!d) return NO_BARE_CHARGE[sym] ? null : sym + sup(S);
      if (sign.length > 1) return null;
      if (d === '2' && (sym === 'H' || sym === 'N' || (sym === 'O' && S === '+'))) return sym + sub(d) + sup(S); // diatomic ions
      if (d.length === 1) return Number(d) >= 1 && Number(d) <= max ? sym + sup(d + S) : null;
      if (/^[OSC]22$/.test(sym + d)) return sym + sub('2') + sup('2' + S); // peroxide O2²⁻
      if (/^C(?:60|70)$/.test(sym + d)) return sym + sub(d) + sup(S);     // fullerene ions
      return null;
    }
    var base = toks.slice(), charge = S;
    if (d && prev && prev.t === 'close' && prev.v === ']' && d.length === 1) { base.pop(); charge = d + S; } // [Fe(CN)6]3−
    else if (d.length === 1 && prev && prev.t === 'el' && sign.length === 1 && toks.some(function (k) { return k.t === 'ox'; })) { base.pop(); charge = d + S; } // IMA style, the last cation charged too: Fe2+Mn2+Mg2+
    else if (d.length >= 2) { base[base.length - 1] = { t: 'n', v: d.slice(0, -1) }; charge = d.slice(-1) + S; } // SO42−
    var plain = base.map(function (k) { return k.v; }).join('');
    if (!acceptNeutral(base, false) && !(BARE_IONS[plain] && !d)) return null; // HIV+, CK7+, HPV16+ are not ions
    return renderTokens(base) + sup(charge);
  }

  function formulaPiece(p, allowCoef, loose) {
    if (!p) return null;
    var coef = '';
    if (allowCoef) { var cm = p.match(/^(\d+(?:\.\d+)?|[nx])(?=[A-Z(])/); if (cm) { coef = cm[1]; p = p.slice(coef.length); } }
    var pre = '';
    var cn = p.match(/^\[(\d{1,2})\]/);                           // mineral site coordination: [4]Fe3+
    if (cn) { pre = sup('[' + cn[1] + ']'); p = p.slice(cn[0].length); }
    var greek = /^[δΔεμΣ]/.test(p);
    if (greek) { pre += p.charAt(0); p = p.slice(1); }             // δ18O, Σ
    var iso = isotope(p) || (greek && !cn ? isotopeQualified(p) || isotopeStandard(p) : null);
    if (iso) return coef + pre + iso;
    var f = parseFormula(p, loose);
    if (f) return coef + pre + f;
    if (cn) return /^[A-Z]/.test(p) ? coef + pre + p : null;
    var m;
    // initial ratio "86Sri" (87Sr/86Sri) -> ⁸⁶Srᵢ
    if (!greek && (m = p.match(/^(\d{1,3}[A-Z][a-z])i$/)) && (iso = isotope(m[1]))) return coef + iso + sub('i');
    // isotopically labelled species: "13CO2", "15NH4+", "99TcO4−". Listed tracer isotopes only: "2H2O" is two
    // waters and "20Na2O–80SiO2" a glass composition
    if (!greek && (m = p.match(/^(\d{2,3})(m?)([A-Z][a-z]?)([A-Z(\[\d].*)$/)) && ISOTOPES[m[1] + m[2] + m[3]] && LABELLED[m[3]] &&
      (f = parseFormula(m[3] + m[4], false) || parseFormula(m[3] + m[4], true))) return coef + sup(m[1] + m[2]) + f;
    // a variable of a gas or component: fO2, pCO2, XCO2, aH2O, fH2O
    if (!greek && !coef && (m = p.match(/^([fpa]|X)([A-Z].*)$/))) {
      f = /^(?:H2|O2|N2|Cl2|F2)$/.test(m[2]) ? m[2].replace(/\d$/, function (d) { return sub(d); }) : parseFormula(m[2], false);
      if (f && !/[\uE002]/.test(f)) return m[1] + f;
    }
    return null;
  }
  // δ18OVSMOW, δ13CPDB, δ34SVCDT: a reference standard written after the isotope
  function isotopeStandard(p) {
    var m = p.match(/^(\d{1,3})([A-Z][a-z]?)(V?SMOW|V?PDB|V?CDT|SLAP|AIR|NBS\d*|SRM\d*|NIST\d*)$/);
    if (m && isIsotope(m[1], '', m[2])) return sup(m[1]) + m[2] + m[3];
    return null;
  }

  function countOf(x, re) { return (x.match(re) || []).length; }
  // A piece left by splitting a word: strips brackets that belong to the neighbours ("(H2O", "CO2)") and
  // trailing labels such as "(i)" or a crystal face "(110)" before trying it as a formula
  function convertPiece(piece, allowCoef, loose) {
    // counted once, peeled by index (no rescans: linear in the piece)
    var o = countOf(piece, /[(\[]/g), c = countOf(piece, /[)\]]/g), a = 0, b = piece.length, tr;
    while (a < b && /[(\[]/.test(piece.charAt(a)) && o > c) { a++; o--; }
    var lead = piece.slice(0, a), core = piece.slice(a, b), trail = '';
    while (c > o && (tr = core.match(/[)\]][a-z]{0,3}$/))) { trail = tr[0] + trail; core = core.slice(0, -tr[0].length); c--; } // "86Sr)i"
    var lab = core.match(/^(.+?)(\((?:[a-z]{1,4}|\d{1,4})\))$/);
    if (lab) { core = lab[1]; trail = lab[2] + trail; }
    var star = core.match(/^(.+?)(\*+)$/);                      // radiogenic 207Pb*
    if (star) { core = star[1]; trail = star[2] + trail; }
    var r = formulaPiece(core, allowCoef, loose);
    return r === null ? null : lead + r + trail;
  }

  var MAX_FORMULA_WORD = 200;                  // longer tokens are never formulas; also bounds the work per token
  function formulaWord(w) {
    if (!w || w.length > MAX_FORMULA_WORD) return null;
    var lead = '', trail = '', core = w, changed = true;
    var opens = function (x) { return countOf(x, /[(\[{]/g); }, closes = function (x) { return countOf(x, /[)\]}]/g); };
    while (changed) {
      changed = false;
      var lm = core.match(/^["'“‘]+/); if (lm) { lead += lm[0]; core = core.slice(lm[0].length); changed = true; }
      var tm = core.match(/["'”’,.;:!?]+$/); if (tm) { trail = tm[0] + trail; core = core.slice(0, -tm[0].length); changed = true; }
      if (/^[(\[{]/.test(core) && opens(core) > closes(core)) { lead += core.charAt(0); core = core.slice(1); changed = true; }
      if (/[)\]}]$/.test(core) && closes(core) > opens(core)) { trail = core.slice(-1) + trail; core = core.slice(0, -1); changed = true; }
      var wrap = core.match(/^([(\[{])(.*)([)\]}])$/);
      if (wrap && '([{'.indexOf(wrap[1]) === ')]}'.indexOf(wrap[3]) && opens(wrap[2]) === closes(wrap[2]) && !/^\d{1,2}$/.test(wrap[2])) {
        lead += wrap[1]; trail = wrap[3] + trail; core = wrap[2]; changed = true;
      }
    }
    if (!core || !/[A-Z]/.test(core) || /:\/\/|^doi:|^10\./i.test(core)) return null;
    var dr = core.match(/^([δΔεμ])(\d{1,3})\/(\d{1,3}[A-Z][a-z]?)$/);  // δ88/86Sr, δ238/235U
    if (dr && isotope(dr[3])) return lead + dr[1] + sup(dr[2]) + '/' + isotope(dr[3]) + trail;
    var any = false;
    var conv = function (piece, allowCoef, loose) {
      var r = piece ? convertPiece(piece, allowCoef, loose) : null;
      return r === null ? piece : (any = true, r);
    };
    var hyphens = function (h, allowCoef, loose) {        // "Fe2+-bearing", "40Ar-39Ar", "δ15N-NO3−"
      return h.split(/(-(?=[A-Za-zδΔε]|\d{1,3}m?[A-Z]))/).map(function (piece, i) { return i % 2 ? piece : conv(piece, allowCoef, loose); }).join('');
    };
    var hydrate = function (x) {                           // CaSO4·0.5H2O, ·nH2O
      var parts = x.split(/([·•⋅])/), loose = parts.length > 1;
      return parts.map(function (h, i) { return i % 2 ? h : hyphens(h, i > 0, loose); }).join('');
    };
    var plus = function (x) {                              // H2O+CO2, Fe3++Fe2+ (only when every side is a formula)
      var parts = x.split(/(\+(?=[A-Z(\[]))/);
      if (parts.length > 1) {
        var whole = convertPiece(x, false, false);           // one formula whose "+" is an oxidation state ("Ca19Fe2+Al4…") beats a sum
        if (whole !== null && new RegExp(SUPO + '\\d*[+\u2212-]' + SUPC).test(whole)) { any = true; return whole; } // a superscript charge is still a marker here
        var ok = true, conv1 = false, out = parts.map(function (p, i) {
          if (i % 2) return p;
          var r = p ? convertPiece(p, false, false) : null;
          if (r !== null) conv1 = true;
          else if (!(p && (r = formulaTokens(p)) && r.filter(function (k) { return k.t === 'el'; }).length > 1)) ok = false; // NaCl
          else r = p;
          return r;
        });
        if (ok && conv1) { any = true; return out.join(''); }
      }
      return hydrate(x);
    };
    // "Fe1-xS", "Fe1–xO": the dash of a solid-solution count is a minus, not a separator
    core = core.replace(/(\d)[-–](?=[xyδ](?:[A-Z(\[)\],\u25A1]|$))/g, '$1\u2212');
    // separators: "/", en/em dash, "--" ("KAlSiO4--Mg2SiO4"), a minus between formulas ("Al2O3−SiO2")
    var out = core.split(/(--+|[\/–—@]|\u2212(?=[A-Z(\[\u25A1]))/).map(function (part, i) { return i % 2 ? part : plus(part); }).join('');
    return any ? lead + out + trail : null;
  }

  // "CO2- and H2O-bearing", "(CO2+ H2O + NaCl)": a sign closing a word is a joiner, not a charge
  var JOIN_WORD = /^(?:and|or|nor|to|&|\+|und|et)$/i;
  function bareWord(w) { return String(w || '').replace(/^["'“‘(\[]+/, '').replace(/["'”’,.;:!?)\]]+$/, ''); }
  function signIsJoiner(body, sign, trail, words, i) {
    if (/[+−]$/.test(body)) return sign === '-';                  // "Ca2+- and Mg2+-rich"
    var next = bareWord(words[i + 2]);
    if (sign === '-') {
      if (JOIN_WORD.test(next)) return !/[+−]$|[+−]-/.test(bareWord(words[i + 4])); // but "NO3- and NH4+-N" lists ions
      return /[^+−]-$/.test(next);                                 // "CO2-, H2O-, and halogen-bearing"
    }
    if (trail || !next || /[-+−]$/.test(next)) return false;
    return formulaWord(next) !== null && formulaWord(body) !== null;
  }

  var GAS_CONTEXT = /\b(?:gas|gases|gaseous|fluids?|fugacity|pressures?|atmospheres?|atmospheric|oxygen|hydrogen|nitrogen|chlorine|fluorine|degassing|outgassing|combustion|adsorption|electrolysis|evolution reaction)\b/i;
  function autoFormulas(s) {
    if (!s) return s;
    // "(Mg, Fe)SiO3": keep the element list together while splitting words
    s = s.replace(/\((?:[A-Z][a-z]?,\s+)+[A-Z][a-z]?\)/g, function (g) { return g.replace(/,\s+/g, ',' + KEEP_SP); });
    var words = s.split(/(\s+)/), converted = false;
    for (var i = 0; i < words.length; i += 2) {
      var w = words[i];
      if (!w || w.length > MAX_FORMULA_WORD || HAS_MARK.test(w)) continue;
      var sm = w.match(/^(.*[A-Za-z0-9)\]+−])([-+])([,;:)\]}"'”’]*)$/);
      if (sm && signIsJoiner(sm[1], sm[2], sm[3], words, i)) {
        var fj = formulaWord(sm[1]);
        words[i] = (fj === null ? sm[1] : fj) + sm[2] + sm[3];
        if (fj !== null) converted = true;
        continue;
      }
      var f = formulaWord(w);
      if (f !== null) { words[i] = f; converted = true; }
    }
    // Diatomic gases (H2, O2, N2, Cl2, F2) look like gene names, grades and generations ("F2 hybrids"); converted only
    // beside another formula or in a gas context
    if (converted || GAS_CONTEXT.test(s)) {
      for (var j = 0; j < words.length; j += 2) {
        var g = words[j].match(/^([("'\u201C\u2018\[]*)(H|O|N|Cl|F)(2)(-[a-z]+)?([)"'\u201D\u2019\],.;:]*)$/);
        if (g) words[j] = g[1] + g[2] + sub(g[3]) + (g[4] || '') + g[5];
      }
    }
    return words.join('').replace(//g, ' ');
  }

  // Carry deposited markers onto a title whose letters were re-cased (sentence case), character by character;
  // a letter whose case mapping changes length (ß -> SS, İ -> i̇) is matched as a unit. Any real difference -> plain title.
  function transferMarks(marked, plain) {
    plain = String(plain);
    var out = '', j = 0;
    for (var i = 0; i < marked.length; i++) {
      var ch = marked.charAt(i);
      if (HAS_MARK.test(ch)) { out += ch; continue; }
      if (j >= plain.length) return plain;
      var p = plain.charAt(j);
      if (p === ch || p.toLowerCase() === ch.toLowerCase() || p.toUpperCase() === ch.toUpperCase()) { out += p; j++; continue; }
      var lc = ch.toLowerCase(), uc = ch.toUpperCase(), done = false, cands = [lc, uc];
      for (var c = 0; c < cands.length && !done; c++) {
        var chunk = plain.substr(j, cands[c].length);
        if (cands[c].length > 1 && (chunk === cands[c] || chunk.toLowerCase() === lc || chunk.toUpperCase() === uc)) { out += chunk; j += chunk.length; done = true; }
      }
      if (!done) return plain;
    }
    return j === plain.length ? out : plain;
  }

  // MathML children at the top level of an element's content (prefix already removed)
  function mmlChildren(xml) {
    var out = [], depth = 0, start = -1, re = /<(\/?)([\w.-]+)[^>]*?(\/?)>/g, m, end = 0;
    while ((m = re.exec(xml))) {
      if (depth === 0 && m.index > end) out.push(xml.slice(end, m.index)); // text left by an already converted inner script
      end = re.lastIndex;
      if (m[3]) { if (depth === 0) out.push(m[0]); continue; }
      if (!m[1]) { if (depth === 0) start = m.index; depth++; }
      else { depth--; if (depth === 0 && start >= 0) { out.push(xml.slice(start, re.lastIndex)); start = -1; } }
    }
    if (depth === 0 && end < xml.length) out.push(xml.slice(end));
    return out;
  }
  function mmlText(x) { return String(x).replace(/<[^>]+>/g, ''); }
  function scripted(subT, supT) { return (subT ? sub(subT) : '') + (supT ? sup(supT) : ''); }
  function mathmlToMarks(s) {
    return s.replace(/<(?:mml:)?math\b[\s\S]*?<\/(?:mml:)?math>/g, function (math) {
      math = math.replace(/<(\/?)mml:/g, '<$1').replace(/>\s+</g, '><');
      var inner = /<(msub|msup|msubsup|mmultiscripts)(?:\s[^>]*)?>((?:(?!<(?:msub|msup|msubsup|mmultiscripts)[\s>])[\s\S])*?)<\/\1>/;
      var guard = 0;
      while (inner.test(math) && guard++ < 50) {
        math = math.replace(inner, function (all, kindName, body) {
          var raw = mmlChildren(body), ch = raw.map(mmlText);
          if (kindName === 'msub') return (ch[0] || '') + scripted(ch[1], '');
          if (kindName === 'msup') return (ch[0] || '') + scripted('', ch[1]);
          if (kindName === 'msubsup') return (ch[0] || '') + scripted(ch[1], ch[2]);
          // <mmultiscripts> base (postsub postsup)* <mprescripts/> (presub presup)*  ->  ¹³C
          var at = -1;
          for (var i = 0; i < raw.length; i++) if (/^<mprescripts\b/.test(raw[i])) { at = i; break; }
          var post = ch.slice(1, at === -1 ? ch.length : at), pre = at === -1 ? [] : ch.slice(at + 1), out = '', k;
          for (k = 0; k < pre.length; k += 2) out += scripted(pre[k], pre[k + 1]);
          out += ch[0] || '';
          for (k = 0; k < post.length; k += 2) out += scripted(post[k], post[k + 1]);
          return out;
        });
      }
      return mmlText(math);
    });
  }

  // Drop unmatched or improperly nested markers so every output format stays well formed
  function balanceMarks(s) {
    var OPEN = { '': '', '': '', '': '' }, stack = [], drop = {}, live = {}, i, c, k;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      if (OPEN[c]) {
        var nested = live[c] > 0;                                   // <sub> inside <sub> (a count, not a stack scan: linear)
        stack.push({ c: c, i: i, dropped: nested });
        if (nested) drop[i] = true; else live[c] = 1;
      } else if (c === '' || c === '' || c === '') {
        var top = stack[stack.length - 1];
        if (top && OPEN[top.c] === c) { stack.pop(); if (top.dropped) drop[i] = true; else live[top.c] = 0; } else drop[i] = true;
      }
    }
    for (k = 0; k < stack.length; k++) drop[stack[k].i] = true;
    var out = '';
    for (i = 0; i < s.length; i++) if (!drop[i]) out += s.charAt(i);
    var prev;
    do { prev = out; out = out.replace(/||/g, ''); } while (out !== prev);
    return out;
  }

  // Deposited title HTML -> plain text with markers
  // Markup names that may arrive entity-encoded ("&lt;inline-formula&gt;&lt;tex-math …&gt;$\alpha$&lt;/tex-math&gt;")
  var ENCODED_TAG = /&(?:amp;)?lt;(\/?(?:[A-Za-z][\w.-]*:)?(?:i|b|em|strong|sub|sup|inf|sc|scp|u|italic|bold|span|math|mi|mo|mn|msub|msup|msubsup|mrow|mtext|mmultiscripts|mprescripts|none|inline-formula|disp-formula|tex-math|alternatives|named-content|styled-content|roman|monospace|br|p|title|sec)\b(?:\s(?:(?!&(?:amp;)?gt;)[^<>]){0,300})?\/?)&(?:amp;)?gt;/g;
  var TEX_SYMBOLS = { times: '×', cdot: '·', pm: '±', mp: '∓', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', sim: '∼',
    simeq: '≃', infty: '∞', rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔', rightleftharpoons: '⇌', prime: '′', circ: '∘', degree: '°',
    partial: '∂', nabla: '∇', sum: '∑', prod: '∏', int: '∫', propto: '∝', ell: 'ℓ', hbar: 'ℏ', AA: 'Å', ast: '*', star: '⋆', bullet: '•',
    ldots: '…', cdots: '⋯', dots: '…', varphi: 'φ', vartheta: 'ϑ', varepsilon: 'ε', varrho: 'ϱ', varsigma: 'ς', upmu: 'μ', textmu: 'µ',
    square: '□', Box: '□', langle: '⟨', rangle: '⟩', vert: '|', mid: '|', parallel: '∥', perp: '⊥', in: '∈', subset: '⊂', cup: '∪', cap: '∩' };
  // LaTeX from <tex-math> -> text with sub/superscript markers: "$\alpha$" -> α, "$\mathrm{Fe}_{2}$" -> Fe₂
  function texToMarks(tex) {
    var t = String(tex).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    var body = t.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
    if (body) t = body[1];
    t = t.replace(/\\(?:documentclass|usepackage)(?:\[[^\]]*\])?\{[^}]*\}/g, '')
      .replace(/\$\$?|\\[()\[\]]/g, '')
      .replace(/\\(?:mathrm|mathit|mathbf|mathsf|mathtt|mathnormal|text|textrm|textit|textbf|operatorname|mbox|rm|it|bf|boldsymbol|bm|mathup|up)\s*(?=\{)/g, '')
      .replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°')
      .replace(/\\([%&_#$ ])/g, '$1')
      .replace(/\\[,;:!]|\\q?quad\b|~/g, ' ')
      .replace(/\\(?:left|right|big|Big|bigg|Bigg)\b\s*/g, '')
      .replace(/\\([A-Za-z]+)\s*/g, function (all, w) {
        if (Object.prototype.hasOwnProperty.call(TEX_SYMBOLS, w)) return TEX_SYMBOLS[w];
        if (Object.prototype.hasOwnProperty.call(ENTITIES, w) && /^[A-Za-z]+$/.test(w) && ENTITIES[w].length === 1 && /[Ͱ-Ͽ]/.test(ENTITIES[w])) return ENTITIES[w];
        return '';
      });
    var script = function (x) {                        // x_{12}, x^{2+}, x_2, x^+ (innermost groups first)
      var guard = 0, prev;
      do {
        prev = x;
        x = x.replace(/([_^])\s*(?:\{([^{}]*)\}|([^\s{}_^]))/g, function (all, op, grp, one) {
          var v = grp !== undefined ? grp : one;
          return op === '_' ? sub(v) : sup(v);
        });
      } while (x !== prev && guard++ < 10);
      return x;
    };
    return script(t).replace(/[{}]/g, '');
  }

  // Can the text after a pretty-printed "</sub>\n   " continue the formula? ("S", "TiSi", "(OH)", ")", ", Ca")
  var ENGLISH_ELEM = { In: 1, As: 1, At: 1, No: 1, Be: 1, He: 1, I: 1, Am: 1, Ho: 1, Es: 1, Pa: 1, Po: 1, Os: 1, U: 1, Y: 1, W: 1 };
  function continuesFormula(next) {
    if (/^(?:[)\],;:.]|<\/?(?:sub|sup|inf|i|em)\b|\([A-Z□])/.test(next)) return true;
    var m = next.match(/^((?:[A-Z][a-z]?)+)(?=[\s\d()\[\],<+−·-]|$)/);
    if (!m) return false;
    var els = m[1].match(/[A-Z][a-z]?/g);
    for (var i = 0; i < els.length; i++) if (!ELEM[els[i]]) return false;
    return !(els.length === 1 && ENGLISH_ELEM[els[0]] && /^\s/.test(next.slice(m[1].length)));
  }

  // Replace each <name …>body</name> (any namespace prefix) by fn(body); scans forward only, so unclosed or
  // repeated tags cost linear time
  function replaceElements(s, name, fn) {
    var open = new RegExp('<((?:[\\w.-]+:)?' + name + ')\\b[^<>]*>', 'g'), out = '', last = 0, m;
    while ((m = open.exec(s))) {
      var closeTag = '</' + m[1] + '>', end = s.indexOf(closeTag, open.lastIndex);
      if (end === -1) break;
      var inner = s.slice(open.lastIndex, end), nested = inner.indexOf('<' + m[1]);
      if (nested !== -1) { open.lastIndex = m.index + 1; continue; } // innermost first: the nested one is handled on its own
      out += s.slice(last, m.index) + fn(inner);
      last = end + closeTag.length; open.lastIndex = last;
    }
    return last ? out + s.slice(last) : s;
  }

  // Deposited title HTML -> plain text with markers
  function markup(html) {
    if (html === undefined || html === null) return '';
    var s = String(html).replace(PUA_RE, '');                   // user text cannot inject markers
    // tags deposited entity-encoded: decode them first so they are processed, not printed
    if (ENCODED_TAG.test(s)) {
      ENCODED_TAG.lastIndex = 0;
      s = s.replace(ENCODED_TAG, function (all, inner) { return '<' + inner.replace(/&(?:amp;)?quot;/g, '"').replace(/&(?:amp;)?apos;/g, "'") + '>'; });
    }
    ENCODED_TAG.lastIndex = 0;
    if (/<(?:[\w.-]+:)?(?:tex-math|inline-formula|alternatives)\b/.test(s)) {
      // <alternatives> holding MathML and LaTeX: keep one rendering
      s = replaceElements(s, 'alternatives', function (body) {
        return /<(?:mml:)?math\b/.test(body) ? replaceElements(body, 'tex-math', function () { return ''; }) : body;
      });
      s = replaceElements(s, 'inline-formula', function (body) { return body.replace(/^\s+|\s+$/g, ''); });
      s = replaceElements(s, 'tex-math', texToMarks);
    }
    if (/<(?:mml:)?math\b/.test(s)) s = mathmlToMarks(s);
    // Whitespace runs holding a line break become one "\n" first (linear; keeps the tag rules below cheap)
    s = s.replace(/\s+/g, function (w) { return w.indexOf('\n') === -1 ? w : '\n'; });
    // JATS line breaks around scripts: "MgSiO\n  <sub>3</sub>" -> MgSiO₃, "on\n  <sup>23</sup>\n  Na" -> on ²³Na,
    // "Fe\n  <sub>3</sub>\n  S" -> Fe₃S; a newline before ordinary words stays a space ("H<sub>2</sub>\n  and")
    s = s.replace(/\n(<(?:sub|inf)\b[^<>]*>)/gi, '$1')
      .replace(/(<\/(?:sub|inf)>)\n/gi, function (all, close, at, str) {
        return continuesFormula(str.substr(at + all.length, 40)) ? close : close + ' ';
      })
      .replace(/(\n)?(<sup\b[^<>]*>)([^<]*)(<\/sup>)(\n)?/gi, function (all, before, open, body, close, after, at, str) {
        if (!before && !after) return all;
        var next = str.substr(at + all.length, 40), el = next.match(/^[A-Z][a-z]?(?![a-z])/);
        if (/^\s*\d{1,3}m?\s*$/.test(body) && el && ELEM[el[0]]) return (before ? ' ' : '') + open + body + close; // prescript isotope
        return open + body + close + (after && !continuesFormula(next) ? ' ' : '');
      });
    // deposits drop the spaces around italics: "of<i>Trypanites</i>in" -> "of Trypanites in", "Cenozoic:<i>Capisocysta</i>",
    // "<i>Valvata</i>(Gastropoda)" (italic words of 3+ letters; "p<i>K</i>a" is notation)
    // a line break between italics and a hyphen or bracket is nothing: "di-\n<i>tert</i>\n-butyl" -> di-tert-butyl, "[2.10]\n<i>meta</i>" stays tight
    s = s.replace(/([-\u2010-\u2012(\[\/])\n(<(?:i|em|b|sub|sup)\b[^>]*>)/gi, '$1$2').replace(/(<\/(?:i|em|b|sub|sup)>)\n(?=[-\u2010-\u2012)\]\/,.;:])/gi, '$1');
    var L = 'A-Za-z\\u00C0-\\u024F';
    s = s.replace(new RegExp('([' + L + ':;,]?)(<(i|em)\\b[^>]*>)([' + L + '][^<]+[' + L + '])(</\\3>)([' + L + '(]?)', 'g'),
      function (all, a, open, tag, body, close, b) { return a + (a ? ' ' : '') + open + body + close + (b ? ' ' : '') + b; });
    s = s.replace(/<(sub|inf)\b[^>]*>/gi, SUBO).replace(/<\/(sub|inf)>/gi, SUBC)
      .replace(/<sup\b[^>]*>/gi, SUPO).replace(/<\/sup>/gi, SUPC)
      .replace(/<(i|em)\b[^>]*>/gi, ITO).replace(/<\/(i|em)>/gi, ITC);
    return balanceMarks(cleanText(s, true));
  }
  function displayTitle(r) {
    var t = r.title || '';
    if (!OPTIONS.formulas) return t;
    var marked = r.titleMarked ? transferMarks(r.titleMarked, t) : t;
    return autoFormulas(marked);
  }

  var SUB_MAP = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', '.': '.', ',': ',', ' ': ' ', 'x': '\u2093', 'n': '\u2099', 'i': '\u1D62' };
  var SUP_MAP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', '[': '[', ']': ']', 'n': 'ⁿ', 'i': 'ⁱ', 'm': 'ᵐ' };
  // Characters with a Unicode sub/superscript form are converted; anything else stays as written (P<sub>CO2</sub> -> PCO₂)
  // Letters convert only when every letter of the text has a form ("1−x" -> ₁₋ₓ); "max" stays "max", "1−y" -> ₁₋y
  function unicodeScript(text, map) {
    var letters = String(text).match(/[A-Za-z]/g) || [], allLetters = true;
    for (var i = 0; i < letters.length; i++) if (map[letters[i]] === undefined) allLetters = false;
    return text.split('').map(function (c) { return map[c] !== undefined && (allLetters || !/[A-Za-z]/.test(c)) ? map[c] : c; }).join('');
  }
  function marksToText(s) {
    // the body excludes both markers, so an unclosed run costs one scan, not one per marker (linear)
    return String(s).replace(/\uE000([^\uE000\uE001]*)\uE001/g, function (a, t) { return unicodeScript(t, SUB_MAP); })
      .replace(/\uE002([^\uE002\uE003]*)\uE003/g, function (a, t) { return unicodeScript(t, SUP_MAP); })
      .replace(MARKS_RE, '');
  }
  function marksToHtml(escaped, inItalic) {
    return String(escaped).replace(//g, '<sub>').replace(//g, '</sub>')
      .replace(//g, '<sup>').replace(//g, '</sup>')
      .replace(//g, inItalic ? '<span style="font-style:normal">' : '<i>').replace(//g, inItalic ? '</span>' : '</i>');
  }
  function marksToLatex(escaped) {
    return String(escaped).replace(//g, '\\textsubscript{').replace(//g, '\\textsuperscript{').replace(//g, '\\textit{')
      .replace(/[]/g, '}');
  }
  // Title as HTML (for the page heading and citeproc input), e.g. "Fe<sub>2</sub>O<sub>3</sub>"
  function titleHtml(r, raw) {
    var t = displayTitle(r);
    return marksToHtml(raw ? t : esc(t));
  }
  function withDisplayTitle(r) {
    var t = displayTitle(r);
    if (t === r.title) return r;
    var copy = {}; Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
    copy.title = t;
    return copy;
  }

  function datePartsOf(m) {
    var keys = ['issued', 'published-print', 'published-online', 'published', 'created'];
    for (var i = 0; i < keys.length; i++) {
      var d = m[keys[i]];
      if (d && d['date-parts'] && d['date-parts'][0] && d['date-parts'][0][0]) return d['date-parts'][0];
    }
    return [];
  }

  // Some publishers deposit names in capitals ("WATSON"); bring them back to title case
  function uncaps(name) {
    if (name.length > 1 && name === name.toUpperCase() && name !== name.toLowerCase()) {
      return name.toLowerCase().replace(/(^|[\s\-'])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
    }
    return name;
  }

  function isCaps(s) { return s.length > 1 && s === s.toUpperCase() && s !== s.toLowerCase(); }

  // DataCite splits "The Turing Way Community" into given "The Turing Way", family "Community"
  var ORG_FAMILY = /^(?:Community|Consortium|Collaboration|Team|Group|Project|Society|Committee|Association|Initiative|Network|Institute|Organi[sz]ation|Council)$/;
  var SUFFIX_TAIL = /^(.*?\S)[\s,]+(Jr\.?|Sr\.?|II|III|IV|2nd|3rd|4th)$/;
  function person(p) {
    var fam = clean(p.family);
    if (fam) {
      var given = clean(p.given), suffix = clean(p.suffix || '');
      if (!/[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u4E00-\u9FFF]/.test(given)) given = ''; // ",", "-", "." deposited as a given name
      // "Dorn, III" / "King, Jr." with the suffix inside the family field
      var fs = fam.match(/^(.+?),\s*(Jr\.?|Sr\.?|II|III|IV|2nd|3rd|4th)$/i);
      if (fs && !suffix) { fam = fs[1]; suffix = fs[2]; }
      // "StephanieM." / "GeorgeR." deposited without the space before the middle initial
      given = given.replace(/([a-z\u00DF-\u00F6\u00F8-\u00FF])([A-Z])\.(?=[\s.A-Z]|$)/g, '$1 $2.');
      // "R., Jr." / "R. Jr.": the suffix ended up in the given name
      var st = given.match(SUFFIX_TAIL);
      if (st && !suffix) { given = st[1].replace(/[\s,]+$/, ''); suffix = st[2]; }
      if (given && (/^The\s/.test(given) || ORG_FAMILY.test(fam))) return { family: given + ' ' + fam, given: '', suffix: '', literal: true };
      // no given name: a single-field name (organisation, mononym, "The pandas development team")
      if (!given && !suffix) return { family: fam.replace(/,,/g, ','), given: '', suffix: '', literal: true };
      // "SMITH, JOHN" deposited in capitals: title-case the given name too, but leave initials ("J.D.", "PC") alone
      if (isCaps(fam) && isCaps(given)) {
        given = given.split(/\s+/).map(function (tok) {
          if (/\./.test(tok)) return tok;                       // "J.D."
          if (/^[A-Z]{1,3}$/.test(tok) && !/[AEIOUY]/.test(tok)) return tok; // "PC", "JD"
          return uncaps(tok);                                   // "IAN", "JOHN"
        }).join(' ');
      }
      return { family: uncaps(fam), given: given, suffix: suffix, literal: false };
    }
    var name = clean(p.name || p.literal || p.given || '').replace(/,,/g, ','); // EndNote doubles commas inside single-field names
    return { family: name, given: '', suffix: '', literal: true };
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var MONTHS_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.',
    'Sep.', 'Oct.', 'Nov.', 'Dec.'];
  var MONTHS_IEEE = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', // IEEE Reference Guide (2025): three letters, May unabbreviated
    'Sep.', 'Oct.', 'Nov.', 'Dec.'];
  var MONTHS_MLA = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']; // MLA Handbook: four-letter months spelled out
  var MONTHS_NLM = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];                  // Citing Medicine: three letters, no period
  // A date with a month but no day is an issue date (PMLA, January 2013); one with a day is usually the online
  // publication date, which the journal styles do not print for an article identified by volume and issue
  function issueMonth(r) { return r.month && !r.day ? r.month : 0; }
  function longDate(r) { return r.year ? (r.month ? MONTHS[r.month - 1] + (r.day ? ' ' + r.day : '') + ', ' : '') + r.year : ''; } // "January 9, 2020" / "July 2018" / "2018"
  function accessedDate(r) { var a = r.accessed; return a && a.year ? (a.month ? MONTHS[a.month - 1] + (a.day ? ' ' + a.day : '') + ', ' : '') + a.year : ''; }
  var ORDINAL_WORDS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

  /* ---------- normalize ---------- */

  function relDoi(rel, key) {
    var list = rel && rel[key];
    if (!Array.isArray(list)) return '';
    for (var i = 0; i < list.length; i++) if (list[i] && list[i]['id-type'] === 'doi' && list[i].id) return String(list[i].id);
    return '';
  }

  // Month 1..12 and day 1..31 or 0; seasons (21-24), typos and junk are dropped
  // Crossref lists the notices that update a work under updated-by (a retraction, a correction, an expression of concern),
  // with Retraction Watch's entries merged in since 2023; OpenAlex only says whether a work is retracted; some publishers
  // write RETRACTED: into the title and deposit no notice.  Kept on the record for the page to flag; never printed in a reference.
  var TITLE_NOTICE_PREFIX = /^\s*(?:retracted(?:\s+article)?|withdrawn)\s*[:\-\u2013\u2014]\s*/i; // "RETRACTED: ...", "WITHDRAWN: ...", "Retracted article: ..."
  var UPDATE_KINDS = { retraction: 'retraction', partial_retraction: 'retraction', withdrawal: 'retraction', removal: 'retraction',
    expression_of_concern: 'concern', correction: 'correction', corrigendum: 'correction', erratum: 'correction' };
  function updatesOf(m) {
    var out = [], list = m['updated-by'];
    if (Array.isArray(list)) list.forEach(function (u) {
      var t = String((u && u.type) || '').toLowerCase().replace(/[\s-]+/g, '_'), kind = UPDATE_KINDS[t];
      if (!kind) return; // new_edition, new_version, addendum, clarification: nothing wrong with the work
      var d = (u.updated && u.updated['date-parts'] && u.updated['date-parts'][0]) || [];
      var month = validMonth(d[1]);
      out.push({ kind: kind, type: t, label: clean(u.label || ''), doi: cleanDoi(u.DOI || ''), year: d[0] ? String(d[0]) : '', month: month, day: month ? validDay(d[2]) : 0, from: 'crossref' });
    });
    var retracted = out.some(function (u) { return u.kind === 'retraction'; });
    if (!retracted && m.is_retracted === true) out.push({ kind: 'retraction', type: 'retraction', label: 'Retracted', doi: '', year: '', month: 0, day: 0, from: 'openalex' });
    else if (!retracted && /^\s*(?:retracted|withdrawn)\b/i.test(firstText(m.title) || '')) out.push({ kind: 'retraction', type: 'retraction', label: 'Retracted', doi: '', year: '', month: 0, day: 0, from: 'title' });
    return out;
  }
  function updateOf(m) { // Crossref's update-to on a notice: [{DOI, type, label}]
    var list = m['update-to']; if (!Array.isArray(list) || !list[0]) return null;
    var t = String(list[0].type || '').toLowerCase().replace(/[\s-]+/g, '_'), kind = UPDATE_KINDS[t];
    return kind ? { kind: kind, type: t, label: clean(list[0].label || ''), doi: cleanDoi(list[0].DOI || '') } : null;
  }
  function validMonth(v) { var n = Number(v); return n >= 1 && n <= 12 && Math.floor(n) === n ? n : 0; }
  function validDay(v) { var n = Number(v); return n >= 1 && n <= 31 && Math.floor(n) === n ? n : 0; }
  function monthName(list, m) { return m >= 1 && m <= 12 ? list[m - 1] : ''; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // First non-empty entry of a Crossref text list (title [""] is common for non-Latin records)
  function firstText(v) {
    var list = Array.isArray(v) ? v : [v];
    for (var i = 0; i < list.length; i++) if (list[i] !== undefined && list[i] !== null && clean(list[i])) return list[i];
    return '';
  }
  // "0", "None", "null": placeholders deposited where no edition exists
  function validEdition(e) {
    var t = clean(e === undefined || e === null ? '' : e);
    return /^(?:0+|none|null|undefined|n\/?a|-)$/i.test(t) ? '' : t;
  }
  // "Dakota and Nebraska : Including" (MARC/BHL spacing) -> "Dakota and Nebraska: Including"
  function colonSpace(s) { return String(s || '').replace(/\s+:(?=\s)/g, ':'); }
  // Library places: "[Chicago]" -> "Chicago"; "[S.l.]" (no place) -> ""
  function cleanPlace(s) {
    var t = trimPunct(s).replace(/^\[([^\[\]]*)\]$/, '$1').trim();
    return /^(?:s\.\s?l\.?|sine loco|n\.\s?p\.?)$/i.test(t) ? '' : t;
  }
  // "Proceedings of the Linnean Society of New South Wales." -> no final full stop, unless it closes an abbreviation ("J. Geol.")
  function cleanContainer(s) {
    var t = trimPunct(colonSpace(clean(s)));
    return /[^.]\.$/.test(t) && t.indexOf('.') === t.length - 1 ? t.slice(0, -1) : t;
  }
  function samePages(p) { // "263-263" -> "263"
    var m = p.match(/^\s*(\S+?)\s*[-\u2010-\u2015]+\s*(\S+)\s*$/);
    return m && m[1] === m[2] ? m[1] : p;
  }
  // Preprint servers whose DOIs are registered by a hosting service (California Digital Library)
  var PREPRINT_PREFIX = { '10.31223': 'EarthArXiv', '10.32942': 'EcoEvoRxiv' };
  // Preprint servers by DOI shape. A record from a file or a search that names no journal and carries one of these DOIs is a
  // preprint whatever type the exporter wrote (Crossref's own RIS says GENERIC and its BibTeX @article for bioRxiv)
  var PREPRINT_DOI = [
    [/^10\.1101\/(?:\d{4}\.\d{2}\.\d{2}\.\d+|\d{5,7})(?:v\d+)?$/i, 'bioRxiv'], [/^10\.31234\//i, 'PsyArXiv'], [/^10\.31219\//i, 'OSF Preprints'], [/^10\.31235\//i, 'SocArXiv'],
    [/^10\.31222\//i, 'MetaArXiv'], [/^10\.31224\//i, 'engrXiv'], [/^10\.31730\//i, 'AfricArXiv'], [/^10\.21203\/rs\./i, 'Research Square'], [/^10\.26434\/chemrxiv/i, 'ChemRxiv'],
    [/^10\.20944\/preprints/i, 'Preprints.org'], [/^10\.31223\//i, 'EarthArXiv'], [/^10\.32942\//i, 'EcoEvoRxiv'], [/^10\.22541\/(?:au|essoar)/i, 'Authorea'], [/^10\.36227\/techrxiv/i, 'TechRxiv'],
    [/^10\.2139\/ssrn/i, 'SSRN'], [/^10\.48550\/arxiv/i, 'arXiv'], [/^10\.1590\/scielopreprints/i, 'SciELO Preprints'], [/^10\.5194\/egusphere-/i, 'EGUsphere'], [/^10\.5194\/[a-z]+-\d{4}-\d+(?:-[a-z]+\d*)?$/i, 'Copernicus discussion paper'],
    [/^10\.1002\/essoar/i, 'ESSOAr'], [/^10\.33774\//i, 'Cambridge Open Engage'], [/^10\.12688\//i, ''] // F1000: a journal, kept as is
  ];
  function preprintServerOf(doi) { if (!doi) return ''; for (var i = 0; i < PREPRINT_DOI.length; i++) if (PREPRINT_DOI[i][0].test(doi)) return PREPRINT_DOI[i][1]; return ''; }

  function hasName(p) { return !!(p.family || p.given); }
  // author / editor as deposited: a list of people; null entries and non-lists ("Smith", {}) are not people
  function people(v) {
    return (Array.isArray(v) ? v : []).filter(function (p) { return p && typeof p === 'object'; }).map(person).filter(hasName);
  }
  // "10.1000/abc." / " 10.1000/abc;" as deposited, an array, or not a string at all: the bare DOI or nothing
  function cleanDoi(d) {
    if (Array.isArray(d)) d = d[0];
    if (typeof d !== 'string') return '';
    return d.replace(TAG_RE, '').replace(/^\s+|\s+$/g, '').replace(/[.,;]+$/, '').replace(/\s+$/, '');
  }
  // First value of a tag kept from an imported file, for a record that did not come through the parsers' field mapping
  function rawTagOf(m, src, tags, src2, tags2) {
    var raw = m.raw && typeof m.raw === 'object' ? m.raw : null; if (!raw) return '';
    var list = m.source === src2 ? tags2 : m.source === src ? tags : [];
    for (var i = 0; i < list.length; i++) { var v = raw[list[i]]; v = Array.isArray(v) ? v[0] : v; if (v) return String(v); }
    return '';
  }
  function normalize(m) {
    var dp = datePartsOf(m);
    var doi = cleanDoi(m.DOI || m.doi);
    var type = m.type || 'other';
    var page = samePages(clean(m.page || ''));
    var isPart = /chapter|section|book-part|proceedings-article|paper-conference/.test(type);
    // Crossref lists a chapter's series first and the book last: ["Use R!", "ggplot2"]
    var ct = m['container-title'];
    var containers = Array.isArray(ct) ? ct.filter(Boolean) : (ct ? [ct] : []);
    var container = isPart && containers.length > 1 ? containers[containers.length - 1] : containers[0];
    var series = isPart && containers.length > 1 ? containers[0] : first(m['collection-title'] || m.series || '');
    var inst = m.institution;
    var acc = m.accessed && m.accessed['date-parts'] && m.accessed['date-parts'][0];
    var accMonth = validMonth(acc && acc[1]);
    var month = validMonth(dp[1]), dayParts = dp;
    // A journal article's issue date is the print date ("2013 Aug;500(7460)" in PubMed, "(April 2016)" in Chicago); Crossref's
    // "issued" is the earliest date, usually the online one.  Same year only: an online-2019, print-2020 article keeps its 2019
    var pp = m['published-print'] && m['published-print']['date-parts'] && m['published-print']['date-parts'][0];
    if (type === 'journal-article' && pp && pp[0] && dp[0] && String(pp[0]) === String(dp[0]) && validMonth(pp[1])) { month = validMonth(pp[1]); dayParts = pp; }
    var titleSrc = firstText(m.title) || firstText(m['original-title']) || firstText(m['short-title']);
    var subSrc = firstText(m.subtitle);
    if (!titleSrc && subSrc) { titleSrc = subSrc; subSrc = ''; }
    var tm = colonSpace(trimPunct(markup(titleSrc)));
    var r = {
      type: type,
      doi: doi,
      url: m.URL || (doi ? 'https://doi.org/' + doi : ''),
      title: trimPunct(stripMarks(tm)),
      titleMarked: tm,
      subtitle: stripMarks(markup(subSrc)),
      container: cleanContainer(container),
      series: cleanContainer(series),
      number: clean(m.number || m['collection-number'] || ''),
      shortContainer: clean(first(m['short-container-title'])),
      institution: clean(Array.isArray(inst) ? (inst[0] && inst[0].name) : (inst && inst.name) || inst || ''),
      edition: validEdition(m.edition) || validEdition(m['edition-number']),
      numPages: clean(m['number-of-pages'] || ''),
      genre: clean(m.genre || first(m.degree) || ''),
      accessed: acc ? { year: acc[0], month: accMonth, day: accMonth ? validDay(acc[2]) : 0 } : null,
      authors: people(m.author),
      authorsOthers: !!m['author-others'], // BibTeX "and others": the list was truncated at the source
      editors: people(m.editor),
      year: dp[0] ? String(dp[0]) : '',
      years: ['issued', 'published-print', 'published-online', 'published'].map(function (k) { var d = m[k] && m[k]['date-parts'] && m[k]['date-parts'][0]; return d && d[0] ? String(d[0]) : ''; })
        .filter(function (y, i, a) { return y && a.indexOf(y) === i; }), // print and online years can differ; references may cite either
      month: month,
      day: month ? validDay(dayParts[2]) : 0,
      volume: clean(m.volume || ''),
      issue: clean(m.issue || ''),
      pages: page,
      articleNumber: clean(m['article-number'] || ''),
      publisher: trimPunct(clean(m.publisher || '')),
      place: cleanPlace(clean(m['publisher-location'] || m['publisher-place'] || '')),
      issn: clean(first(m.ISSN) || ''),
      isbn: clean(first(m.ISBN) || ''),
      abstract: cleanAbstract(m.abstract || ''),
      language: clean(m.language || ''),
      event: clean((m.event && m.event.name) || ''),
      originalTitle: stripMarks(markup(firstText(m['original-title']) || '')),                                   // the native-script title beside a translated one ("国外社区韧性的理论与实践进展" under an English title)
      database: clean(m.database || m.archive || rawTagOf(m, 'ris', ['DP', 'DB'], 'enw', ['W']) || ''),   // the database or platform a file says the record came from (RIS DP/DB, EndNote %W, CSL archive)
      accession: clean(m.accession || m.archive_location || rawTagOf(m, 'ris', ['AN'], 'enw', ['M']) || ''), // its accession number there (RIS AN, EndNote %M)
      publishedDoi: relDoi(m.relation, 'is-preprint-of'),
      preprintDoi: relDoi(m.relation, 'has-preprint'),
      updates: updatesOf(m), // retractions, corrections and expressions of concern published about this work
      updateOf: updateOf(m), // when this record is itself such a notice: what it updates
      source: m.source || 'crossref',
      score: m.score
    };
    if (m.raw) r.raw = m.raw;
    if (/^(?:book|monograph|edited-book|reference-book)$/.test(type) && r.container && !r.series) { r.series = r.container; r.container = ''; } // a book's container-title is its series                  // tags as read from an RIS / EndNote file, re-emitted by the exporters
    if (r.subtitle && r.title && r.title.indexOf(r.subtitle) === -1) {
      r.title = r.title + ': ' + r.subtitle;
      r.titleMarked = r.titleMarked + ': ' + markup(subSrc);
    }
    if (/^\d{4}$/.test(r.volume) && r.year && r.years.concat(r.year).indexOf(r.volume) !== -1) { // Fieldiana: volume "2010", issue "52"
      r.volume = r.issue; r.issue = '';
    }
    // A DOI built on an ISBN is a book, or a chapter when it carries a part number: 10.1007/978-3-031-49200-6 and 10.1007/978-3-031-49200-6_21
    if (r.type === 'other' && /\/97[89]-?\d[-\d]{9,}(?:_\d+)?$/i.test(r.doi)) r.type = type = /_\d+$/.test(r.doi) ? 'book-chapter' : 'book';
    // Report publishers whose DOIs Crossref's exports write as @book without an ISBN: USGS, OSTI, DTIC, IDB, NIST
    if (r.type === 'book' && !r.isbn && /^10\.(?:3133|2172|21236|18235|6028)\//i.test(r.doi)) r.type = type = 'report';
    var srv = preprintServerOf(r.doi);
    if (srv && !r.container && /^(?:journal-article|other|book|monograph)$/.test(r.type)) { r.type = type = 'posted-content'; } // a file or search record that names no journal
    if (/^(?:posted-content|preprint)$/.test(type) && !r.container) {
      var pre = PREPRINT_PREFIX[String(r.doi).split('/')[0].toLowerCase()];
      if (!pre) pre = preprintServerOf(r.doi) || '';
      if (pre) r.institution = pre;
      else if (!r.institution && /Center for Open Science/i.test(r.publisher) && m['group-title']) r.institution = clean(m['group-title']);
      else if (!r.institution && /California Digital Library/i.test(r.publisher) && m['group-title']) r.institution = clean(m['group-title']);
    }
    if (!HAS_MARK.test(r.titleMarked) || stripMarks(r.titleMarked) !== r.title) delete r.titleMarked; // only keep real markup
    r.isArticleNumber = false;
    if (r.articleNumber && (!r.pages || r.pages === r.articleNumber)) { r.pages = r.articleNumber; r.isArticleNumber = true; }
    if (r.pages && /^e\d+$/i.test(r.pages)) r.isArticleNumber = true;
    return r;
  }

  function kind(r) {
    var t = r.type;
    if (t === 'other' && r.raw && typeof r.raw === 'object') { // imported file: a type AutoDOI has no Crossref name for
      var raw = r.raw, rt = String(first(raw.TY || raw['0'] || raw.entrytype) || '').toLowerCase();
      if (raw.entrytype === 'misc' && raw.fields && /^\{?standard\}?$/i.test(String(raw.fields.note || '').trim())) rt = 'standard';
      if (/^(?:elec|web page|online|www|webpage|electronic)$/.test(rt)) return 'web';
      if (/^(?:stand|standard)$/.test(rt)) return 'standard';
      if (/^(?:encyc|dict|encyclopedia|dictionary|inreference)$/.test(rt)) return 'chapter';
    }
    if (t === 'journal-article' || t === 'article-journal' || t === 'article-magazine' || t === 'article-newspaper' || (!t && r.container)) return 'journal';
    if (t === 'article') return r.container ? 'journal' : 'preprint';  // DataCite/CSL "article": a preprint only without a journal
    // reference entries (encyclopedia, dictionary) are formatted like chapters; RIS/EndNote keep their own type
    if (t === 'book-chapter' || t === 'book-section' || t === 'book-part' || t === 'chapter' || t === 'reference-entry' ||
      t === 'entry-encyclopedia' || t === 'entry-dictionary' || t === 'entry') return 'chapter';
    if (t === 'book' || t === 'monograph' || t === 'edited-book' || t === 'reference-book') return 'book';
    if (t === 'proceedings-article' || t === 'paper-conference') return 'proceedings';
    if (t === 'posted-content' || t === 'preprint') return 'preprint';
    if (t === 'dataset') return 'dataset';
    if (t === 'software') return 'software';
    if (t === 'dissertation' || t === 'thesis') return 'thesis';
    if (t === 'report' || t === 'report-component' || t === 'report-series') return 'report';
    if (t === 'standard') return 'standard';
    if (t === 'webpage' || t === 'post-weblog' || t === 'web-page' || t === 'post') return 'web';
    if (r.container && r.volume) return 'journal';
    return 'generic';
  }

  /* ---------- names ---------- */

  function initials(given, opts) {
    opts = opts || {};
    if (!given) return '';
    // nicknames are not initials: "Aswathi (Asha)", 'Robert "Bob"', "William ‘Bill’"
    given = given.replace(/\s*(?:\([^()]*\)|"[^"]*"|\u201C[^\u201D]*\u201D)\s*/g, ' ')
      .replace(/(^|\s)(?:'[^'\s][^']*'|\u2018[^\u2019]*\u2019)(?=\s|$)/g, '$1').trim();
    if (!given) return '';
    // "J.-P." stays one token; "P.C." becomes two
    var tokens = given.replace(/\.(?![\-\u2010\u2011])/g, '. ').split(/\s+/).filter(Boolean);
    var out = [];
    tokens.forEach(function (tok) {
      tok = tok.replace(/\.+$/, '').replace(/^[\-\u2010\u2011]+|[\-\u2010\u2011]+$/g, '');
      if (!tok || /^(?:&|and)$/i.test(tok)) return; // "J & K" -> "J. K.": the conjunction is not an initial
      // "PC" style compressed initials
      if (/^[A-Z\u00C0-\u00D6\u00D8-\u00DE]{2,3}$/.test(tok)) {
        tok.split('').forEach(function (ch) { out.push(ch); });
        return;
      }
      var parts = tok.split(/[\-\u2010\u2011]/).filter(Boolean).map(function (p) { return p.replace(/\./g, '').charAt(0).toUpperCase(); });
      if (parts.length) out.push(parts.join(opts.dots === false ? '-' : '.-'));
    });
    if (opts.dots === false) return out.join('');
    return out.map(function (x) { return x + '.'; }).join(opts.space === false ? '' : ' ');
  }

  function sfx(p) { return p.suffix ? ', ' + p.suffix : ''; }
  function nameLastInit(p, sep) { // "Kucsko, G." / "King, M. L., Jr."
    if (p.literal) return p.family;
    var ini = initials(p.given);
    return p.family + (ini ? (typeof sep === 'string' ? sep : ', ') + ini : '') + sfx(p);
  }
  function nameLastFull(p) { // "Kucsko, Georg" / "King, Martin Luther, Jr."
    if (p.literal) return p.family;
    return p.family + (p.given ? ', ' + p.given : '') + sfx(p);
  }
  function nameFullFirst(p) { // "Georg Kucsko" / "Martin Luther King Jr."
    if (p.literal) return p.family;
    return (p.given ? p.given + ' ' : '') + p.family + (p.suffix ? ' ' + p.suffix : '');
  }
  function nameInitFirst(p) { // "G. Kucsko" / "M. L. King, Jr."
    if (p.literal) return p.family;
    var ini = initials(p.given);
    return (ini ? ini + ' ' : '') + p.family + sfx(p);
  }
  function nlmSuffix(sfx) { var m = { II: '2nd', III: '3rd', IV: '4th' }; var t = sfx.replace(/\./g, ''); return m[t.toUpperCase()] || t; } // Citing Medicine: "Izzo JL Jr", "Frei E 3rd"
  function nameVancouver(p) { // "Kucsko G" / "Izzo JL Jr"
    if (p.literal) return p.family;
    var ini = initials(p.given, { dots: false });
    return p.family + (ini ? ' ' + ini : '') + (p.suffix ? ' ' + nlmSuffix(p.suffix) : '');
  }

  function joinAnd(list, and, oxford) {
    if (list.length === 0) return '';
    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + ' ' + and + ' ' + list[1];
    return list.slice(0, -1).join(', ') + (oxford ? ',' : '') + ' ' + and + ' ' + list[list.length - 1];
  }

  /* ---------- pages ---------- */

  function enDash(pages) { return pages.replace(/\s*[-–—]+\s*/g, '–'); }
  function pageRange(pages) { var p = enDash(pages); return p; }
  function isRange(pages) { return /[-–—]/.test(pages); }
  function nlmPages(pages) { // 123-129 -> 123-9
    var m = pages.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (!m) return pages.replace(/\s*[-–—]+\s*/g, '-');
    var a = m[1], b = m[2];
    if (a.length !== b.length || Number(b) <= Number(a)) return a + '-' + b;
    var i = 0;
    while (i < a.length - 1 && a[i] === b[i]) i++;
    return a + '-' + b.slice(i);
  }

  /* ---------- text styles (return HTML with <i>) ---------- */

  // https://doi.org/ link: only characters that break a URL are percent-encoded, so a SICI DOI stays readable as APA readers
  // expect: "(SICI)1097-0258(19980430)17:8<857::AID-SIM777>3.0.CO;2-E" -> "(SICI)1097-0258(19980430)17:8%3C857::AID-SIM777%3E3.0.CO;2-E"
  function doiUrl(doi) {
    return 'https://doi.org/' + String(doi).replace(/%(?![0-9A-Fa-f]{2})|[<>"\s#?\[\]{}|\\^`]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\x00-\x7F]/g, function (c) {
      try { return encodeURIComponent(c); } catch (e) { return c; } // a lone surrogate cannot be encoded
    });
  }
  function doiLink(r) { return r.doi ? doiUrl(r.doi) : r.url; }
  function endsPunct(s) { return /[.?!][\uE000-\uE005]*[\u201D\u2019"']?$/.test(s); } // a closing quote after the mark still ends the sentence: “Dr. House.”
  function dot(s) { return s ? (endsPunct(s) ? s : s + '.') : ''; }
  function I(s) { return s ? '<i>' + esc(s, true) + '</i>' : ''; }
  function Idot(s) { return s ? I(s) + (endsPunct(s) ? '' : '.') : ''; } // italic title, no ".?." doubling
  function T(s) { return esc(s); }
  // Full stop after an HTML fragment unless its text already ends with one ("<i>Wiley, Inc.</i>", "Politics?")
  function htmlDot(h) { return endsPunct(String(h).replace(TAG_RE, '')) ? h : h + '.'; }
  function hostOf(r) { return r.container || r.institution || r.publisher; } // preprint server, repository, publisher
  // publisher shown after the host only when it is a distinct entity (a book's publisher), not the repository owner
  function showPublisher(r, k) { return k !== 'journal' && !!r.publisher && !(r.institution && !r.container) && r.publisher !== hostOf(r); }
  function pp(pages) { return (isRange(pages) ? 'pp. ' : 'p. ') + pageRange(pages); }

  // "3" -> "3rd ed." (APA/IEEE) or "Third Edition" (Carnegie); text editions pass through
  function editionLabel(ed, style) {
    var n = parseInt(ed, 10);
    if (!isNaN(n) && /^\d+(st|nd|rd|th)?\.?$/i.test(ed.trim())) {
      if (style === 'carnegie') return (ORDINAL_WORDS[n] || n + 'th') + ' Edition';
      var suf = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
      return n + suf + ' ed.';
    }
    return /edition|ed\./i.test(ed) ? ed : ed + (style === 'carnegie' ? ' Edition' : ' ed.');
  }
  // Append "et al." when the source list was truncated ("and others"), unless the style already abbreviated it
  function others(names, r, form) { return r.authorsOthers && r.authors.length && names && !/et al/.test(names) ? names + form : names; }
  function apaNames(people) {
    var n = people.length, li = function (p) { return nameLastInit(p); };
    if (n === 0) return '';
    if (n === 1) return li(people[0]);
    if (n === 2) return li(people[0]) + ', & ' + li(people[1]);
    if (n <= 20) return people.slice(0, -1).map(li).join(', ') + ', & ' + li(people[n - 1]);
    return people.slice(0, 19).map(li).join(', ') + ', . . . ' + li(people[n - 1]);
  }
  function apa(r) {
    var k = kind(r);
    var names = r.authorsOthers && r.authors.length ? r.authors.map(function (p) { return nameLastInit(p); }).join(', ') + ', et al.' : apaNames(r.authors);
    if (!names && r.editors.length) names = apaNames(r.editors) + (r.editors.length > 1 ? ' (Eds.)' : ' (Ed.)'); // edited book
    var n = names ? 1 : 0;
    var year = '(' + (r.year ? (k === 'web' && r.month ? r.year + ', ' + MONTHS[r.month - 1] + (r.day ? ' ' + r.day : '') : r.year) : 'n.d.') + ').'; // web pages carry their full date: (2018, May 24)
    var out = [];
    var link = doiLink(r);
    var vol = '';
    if (r.volume) vol = I(r.volume) + (r.issue ? '(' + T(r.issue) + ')' : '');
    else if (r.issue) vol = '(' + T(r.issue) + ')';

    if (k === 'journal') {
      var src = [I(r.container), vol, r.pages ? (r.isArticleNumber ? 'Article ' : '') + T(pageRange(r.pages)) : ''].filter(Boolean).join(', ');
      if (n) out.push(T(dot(names)), year, T(dot(r.title)));
      else out.push(T(dot(r.title)), year);
      if (src) out.push(src + '.');
    } else if (k === 'chapter' || k === 'proceedings') {
      var eds = r.editors.map(nameInitFirst);
      var inParen = [validEdition(r.edition) ? T(editionLabel(r.edition, 'apa')) : '', r.pages ? T(pp(r.pages)) : ''].filter(Boolean).join(', '); // (4th ed., pp. 115–129)
      var inPart = r.container ? 'In ' + (eds.length ? T(joinAnd(eds, '&', true)) + ' (' + (eds.length > 1 ? 'Eds.' : 'Ed.') + '), ' : '') +
        I(r.container) + (inParen ? ' (' + inParen + ')' : '') + '.' : (r.pages ? T(pp(r.pages)) + '.' : ''); // no book title, no "In ." 
      if (n) out.push(T(dot(names)), year, T(dot(r.title)), inPart);
      else out.push(T(dot(r.title)), year, inPart);
      if (r.publisher) out.push(T(dot(r.publisher)));
    } else if (k === 'book') {
      var ed = validEdition(r.edition) ? ' (' + T(editionLabel(r.edition, 'apa')) + ')' : '';
      if (n) out.push(T(dot(names)), year, I(r.title) + ed + (ed || !endsPunct(r.title) ? '.' : ''));
      else out.push(I(r.title) + ed + (ed || !endsPunct(r.title) ? '.' : ''), year);
      if (r.publisher) out.push(T(dot(r.publisher)));
    } else {
      // APA 7 examples: a preprint and a report carry no bracketed label; a report number and a dissertation's
      // publication number sit in parentheses after the title; the archive or database follows the bracket
      var label = { dataset: 'Data set', software: 'Computer software' }[k];
      var host = hostOf(r), pre = '', archive = '';
      if (k === 'thesis') {
        var deg = /m\.?\s?[as]\.?|master/i.test(r.genre) ? "Master's thesis" : 'Doctoral dissertation';
        var school = r.institution || r.publisher || r.container;
        label = T(deg + (school ? ', ' + school : '')); host = '';
        archive = r.publisher && r.publisher !== school ? r.publisher : r.database; // "ProQuest Dissertations & Theses Global", "UA Campus Repository"
        if (r.number) pre = ' (' + T(/publication no/i.test(r.number) ? r.number : 'Publication No. ' + r.number) + ')';
      }
      if (k === 'report' && r.number) pre = ' (' + T((r.series ? r.series + ' ' : '') + (r.series || /\b(no|number|rep|report|pub)\b/i.test(r.number) ? '' : 'Report No. ') + r.number) + ')';
      var titlePart = !r.title && !label && !pre ? '' : I(r.title) + pre + (label ? ' [' + label + ']' : '') + (label || pre || !endsPunct(r.title) ? '.' : '');
      if (n) out.push(T(dot(names)), year, titlePart);
      else out.push(titlePart, year);
      if (host) out.push(T(dot(host)));
      if (archive) out.push(T(dot(archive)));
      if (k === 'web' && link && accessedDate(r)) { out.push('Retrieved ' + accessedDate(r) + ', from ' + T(link)); link = ''; } // content that changes: the page recorded when it was read
    }
    if (link) out.push(T(link));
    return out.filter(Boolean).join(' ');
  }

  function mla(r) {
    var k = kind(r);
    var n = r.authors.length;
    var names = '';
    if (n === 1) names = nameLastFull(r.authors[0]);
    else if (n === 2) names = nameLastFull(r.authors[0]) + ', and ' + nameFullFirst(r.authors[1]);
    else if (n >= 3) names = nameLastFull(r.authors[0]) + ', et al';
    if (r.authorsOthers && n) names = nameLastFull(r.authors[0]) + ', et al';
    // MLA 9: a work with an editor but no author begins with its title; the editor follows in the container
    // ("Beowulf. Edited by Sarah Anderson, Pearson, 2004."), unless it is a book chapter, where "edited by" already follows the book
    var editedBy = '';
    if (!names && r.editors.length) {
      var ne = r.editors.length, edList = ne > 2 ? nameFullFirst(r.editors[0]) + ' et al.' : joinAnd(r.editors.map(nameFullFirst), 'and', false);
      if (r.type === 'edited-book' || k === 'chapter' || k === 'proceedings') // an edited collection: "Sánchez Prado, Ignacio M., editor."
        names = (ne === 1 ? nameLastFull(r.editors[0]) : ne === 2 ? nameLastFull(r.editors[0]) + ', and ' + nameFullFirst(r.editors[1]) : nameLastFull(r.editors[0]) + ', et al') + (ne > 1 ? ', editors' : ', editor');
      else editedBy = 'Edited by ' + T(edList);
    }
    var out = [];
    if (names) out.push(T(dot(names)));
    // dates: an issue month "Jan. 2013"; a web page's full date "28 Dec. 2014"; otherwise the year
    var when = !r.year ? '' : k === 'journal' ? (issueMonth(r) ? MONTHS_MLA[issueMonth(r) - 1] + ' ' : '') + r.year
      : k === 'book' || !r.month ? r.year : (r.day ? r.day + ' ' : '') + MONTHS_MLA[r.month - 1] + ' ' + r.year;
    var quoted = '“' + T(dot(r.title)) + '”';
    var link = doiLink(r);
    var contParts = [];
    if (k === 'book') {
      out.push(Idot(r.title));
      if (editedBy) contParts.push(editedBy);
      if (r.publisher) contParts.push(T(r.publisher));
      if (when) contParts.push(T(when));
    } else {
      out.push(quoted);
      if (r.container) contParts.push(I(r.container));
      else if (k !== 'journal' && hostOf(r)) contParts.push(T(hostOf(r)));
      if ((k === 'chapter' || k === 'proceedings') && r.editors.length) {
        contParts.push('edited by ' + T(r.editors.length > 2 ? nameFullFirst(r.editors[0]) + ' et al.' : joinAnd(r.editors.map(nameFullFirst), 'and', false)));
      }
      if (editedBy) contParts.push(editedBy);
      if (r.volume) contParts.push('vol. ' + T(r.volume));
      if (r.issue) contParts.push('no. ' + T(r.issue));
      if (showPublisher(r, k)) contParts.push(T(r.publisher));
      if (when) contParts.push(T(when));
      if (r.pages) contParts.push(T(pp(r.pages)));
    }
    if (r.database) { // MLA 9: the database or platform is a second container, holding the location: "pp. 69-88. JSTOR, www.jstor.org/stable/41403188."
      if (contParts.length) out.push(contParts.join(', ') + '.');
      out.push(T(r.database) + (link ? ', ' + T(link) : '') + '.');
    } else {
      if (link) contParts.push(T(link));
      if (contParts.length) out.push(contParts.join(', ') + '.');
    }
    return out.filter(Boolean).join(' '); // an empty part must not leave a double space
  }

  function chicago(r) {
    var k = kind(r);
    var n = r.authors.length;
    var names = '';
    if (n === 1) names = nameLastFull(r.authors[0]);
    else if (n >= 2 && n <= 10) {
      var rest = r.authors.slice(1).map(nameFullFirst);
      names = [nameLastFull(r.authors[0])].concat(rest.slice(0, -1)).join(', ') + ', and ' + rest[rest.length - 1];
    }
    else if (n > 10) names = nameLastFull(r.authors[0]) + ', ' + r.authors.slice(1, 7).map(nameFullFirst).join(', ') + ', et al';
    if (r.authorsOthers && n && n <= 10) names = nameLastFull(r.authors[0]) + ', ' + r.authors.slice(1).map(nameFullFirst).join(', ') + ', et al';
    if (!names && r.editors.length) { // edited book: "Ed, Alan, ed." / "Ed, Alan, and Beth Ed, eds."
      var re = r.editors.slice(1).map(nameFullFirst);
      names = (re.length ? [nameLastFull(r.editors[0])].concat(re.slice(0, -1)).join(', ') + ', and ' + re[re.length - 1] : nameLastFull(r.editors[0])) + (r.editors.length > 1 ? ', eds' : ', ed');
    }
    var out = [];
    if (names) out.push(T(dot(names)));
    var link = doiLink(r);
    if (k === 'journal') {
      out.push('“' + T(dot(r.title)) + '”');
      var s = I(r.container);
      if (r.volume) s += ' ' + T(r.volume);
      if (r.issue) s += ', no. ' + T(r.issue);
      s += ' (' + (r.year ? (issueMonth(r) ? MONTHS[issueMonth(r) - 1] + ' ' : '') + T(r.year) : 'n.d.') + ')'; // "111, no. 2 (April 2016)"; an undated article "(n.d.)"
      if (r.pages) s += ': ' + T(pageRange(r.pages));
      s = s.replace(/^[\s,]+/, '');
      if (s) out.push(htmlDot(s));
    } else if (k === 'book') {
      out.push(Idot(validEdition(r.edition) ? dot(r.title) + ' ' + editionLabel(r.edition, 'apa').replace(/\.$/, '') : r.title)); // no "Politics?. 2nd ed"
      var pub = [r.place, r.publisher].filter(Boolean).join(': ');
      out.push(T(dot([pub, r.year || 'n.d.'].filter(Boolean).join(', '))));
    } else if (k === 'chapter' || k === 'proceedings') {
      out.push('“' + T(dot(r.title)) + '”');
      var inp = r.container ? 'In ' + I(r.container) : '';
      if (r.editors.length) inp += (inp ? ', edited by ' : 'Edited by ') + T(joinAnd(r.editors.map(nameFullFirst), 'and', r.editors.length > 2));
      if (r.pages) inp += (inp ? ', ' : '') + T(pageRange(r.pages));
      if (inp) out.push(htmlDot(inp));
      var pub2 = [r.place, r.publisher].filter(Boolean).join(': ');
      out.push(T(dot([pub2, r.year || 'n.d.'].filter(Boolean).join(', '))));
    } else {
      out.push('“' + T(dot(r.title)) + '”');
      var host = k === 'thesis'
        ? [/m\.?\s?[as]\.?|master/i.test(r.genre) ? "Master's thesis" : 'PhD diss.', r.institution || r.publisher, r.year].filter(Boolean).join(', ') // "PhD diss., University of Chicago, 2013."
        : [hostOf(r), r.year || (k === 'web' && accessedDate(r) ? '' : 'n.d.')].filter(Boolean).join(', '); // an undated page shows its access date instead
      if (host) out.push(T(dot(host)));
      if (k === 'web' && !r.year && accessedDate(r)) out.push('Accessed ' + accessedDate(r) + '.'); // an undated page is cited by the day it was read
    }
    // CMOS: a DOI first; for a source consulted in a commercial database, the database name (with any accession number) stands in for a URL
    if (r.doi) out.push(T(link) + '.');
    else if (r.database) out.push(T(r.database + (r.accession ? ' (' + r.accession + ')' : '')) + '.');
    else if (link) out.push(T(link) + '.');
    return out.filter(Boolean).join(' '); // an empty part must not leave a double space
  }

  function harvard(r) {
    var k = kind(r);
    var n = r.authors.length;
    var hn = function (p) { if (p.literal) return p.family; var ini = initials(p.given, { space: false }); return p.family + (ini ? ', ' + ini : ''); }; // a given name of only nicknames has no initials
    var hlist = function (people) {
      var m = people.length;
      return m === 1 ? hn(people[0]) : m <= 3 ? joinAnd(people.map(hn), 'and', false) : hn(people[0]) + ' et al.';
    };
    var names = n ? (r.authorsOthers ? hn(r.authors[0]) + ' et al.' : hlist(r.authors)) : '';
    if (!names && r.editors.length) names = hlist(r.editors) + (r.editors.length > 1 ? ' (eds.)' : ' (ed.)');
    var out = [];
    var year = '(' + (r.year || 'no date') + ')';
    var link = doiLink(r);
    if (names) out.push(T(names), year);
    else out.push(year);
    var placePub = [r.place, r.publisher].filter(Boolean).join(': ');
    if (k === 'book') {
      out.push(Idot(validEdition(r.edition) ? dot(r.title) + ' ' + editionLabel(r.edition, 'apa').replace(/\.$/, '') : r.title)); // no "Politics?. 2nd ed"
      if (placePub) out.push(T(dot(placePub)));
    } else if (k === 'chapter' || k === 'proceedings') {
      // Cite Them Right: 'Title', in Editor, A. and Editor, B. (eds.) Book. Place: Publisher, pp. x–y.
      if (r.container) {
        var inb = 'in ' + (r.editors.length ? T(hlist(r.editors)) + (r.editors.length > 1 ? ' (eds.) ' : ' (ed.) ') : '') + Idot(r.container);
        out.push('‘' + T(r.title) + '’, ' + inb);
      } else out.push('‘' + T(r.title) + '’.');
      var tail = [placePub, r.pages ? T(pp(r.pages)) : ''].filter(Boolean).join(', ');
      if (tail) out.push(T(dot(tail)));
    } else {
      var parts = ['‘' + T(r.title) + '’'];
      if (r.container) parts.push(I(r.container));
      else if (k !== 'journal' && hostOf(r)) parts.push(T(hostOf(r)));
      if (r.volume || r.issue) parts.push(T(r.volume) + (r.issue ? '(' + T(r.issue) + ')' : ''));
      if (showPublisher(r, k)) parts.push(T(r.publisher));
      if (r.pages) parts.push(T(pp(r.pages)));
      out.push(htmlDot(parts.join(', ')));
    }
    if (link) out.push('Available at: ' + T(link) + '.');
    return out.filter(Boolean).join(' '); // an empty part must not leave a double space
  }

  function vancouver(r, num) {
    var k = kind(r);
    var n = r.authors.length;
    // persons first, six at most then "et al" (ICMJE); an organisation that is also an author follows after a semicolon:
    // "Orchard TJ, Temprosa M, ... Fowler S; Diabetes Prevention Program Research Group."
    var persons = r.authors.filter(function (p) { return !p.literal; }), orgs = r.authors.filter(function (p) { return p.literal; });
    var pn = persons.length > 6 ? persons.slice(0, 6).map(nameVancouver).join(', ') + ', et al' : persons.map(nameVancouver).join(', ');
    var names = others([pn, orgs.map(nameVancouver).join(', ')].filter(Boolean).join('; '), r, ', et al');
    if (!names && r.editors.length) names = r.editors.map(nameVancouver).join(', ') + (r.editors.length > 1 ? ', editors' : ', editor');
    var out = [];
    if (num) out.push(String(num) + '.');
    if (names) out.push(T(dot(names)));
    out.push(T(dot(r.title)));
    var placePubYear = [r.place, r.publisher].filter(Boolean).join(': ') + (r.year ? '; ' + r.year : '');
    if (k === 'journal') {
      var s = T(dot(r.shortContainer || r.container));
      // Citing Medicine: "2005 Jan;62(1):112-6", "2002 Jul 25;347(4):284-7", a supplement with no volume "2003 Nov;Suppl:19-20"
      var when = r.year ? r.year + (r.month ? ' ' + MONTHS_NLM[r.month - 1] + (r.day ? ' ' + r.day : '') : '') : '';
      var volIss = r.volume ? ';' + T(r.volume) + (r.issue ? '(' + T(r.issue) + ')' : '') : (r.issue ? ';' + (/^\d+$/.test(r.issue) ? '(' + T(r.issue) + ')' : T(r.issue)) : '');
      var tail = when + volIss + (r.pages ? ':' + T(nlmPages(r.pages)) : '');
      if (tail) s += (s ? ' ' : '') + tail.replace(/^;/, '');
      if (s) out.push(s + (endsPunct(s) && !tail ? '' : '.'));   // no journal name, no volume: nothing to add
    } else if (k === 'book') {
      if (validEdition(r.edition)) out.push(T(editionLabel(r.edition, 'apa')));
      if (placePubYear) out.push(T(dot(placePubYear)));
      if (/^\d+$/.test(r.numPages)) out.push(T(r.numPages) + ' p.'); // "New York: Oxford University Press; 2005. 194 p."
    } else if (k === 'chapter' || k === 'proceedings') {
      // Citing Medicine: In: Editor A, Editor B, editors. Book. 8th ed. Vol. 1. Place: Publisher; year. p. 10-20.
      var edsV = r.editors.length ? r.editors.map(nameVancouver).join(', ') + (r.editors.length > 1 ? ', editors. ' : ', editor. ') : '';
      if (r.container) out.push('In: ' + T(edsV) + T(dot(r.container)));
      if (validEdition(r.edition)) out.push(T(editionLabel(r.edition, 'apa')));
      if (r.volume) out.push('Vol. ' + T(r.volume) + '.');
      if (placePubYear) out.push(T(dot(placePubYear)));
      if (r.pages) out.push('p. ' + T(nlmPages(r.pages)) + '.');
    } else {
      var host = hostOf(r);
      var tailG = [host ? dot(host).replace(/\.$/, '') : '', r.year].filter(Boolean).join('; ');
      if (tailG) out.push(T(dot(tailG)));
    }
    if (r.doi) out.push('doi: ' + T(r.doi) + '.'); // as NLM prints it: "doi: 10.1136/bmj.a2752."
    return out.filter(Boolean).join(' '); // an empty part must not leave a double space
  }

  function ieee(r, num) {
    var k = kind(r);
    var n = r.authors.length;
    var names = '';
    if (n > 6) names = nameInitFirst(r.authors[0]) + ' et al.';
    else names = joinAnd(r.authors.map(nameInitFirst), 'and', n > 2);
    if (r.authorsOthers && n) names = nameInitFirst(r.authors[0]) + ' et al.';
    if (!names && r.editors.length) names = joinAnd(r.editors.map(nameInitFirst), 'and', r.editors.length > 2) + (r.editors.length > 1 ? ', Eds.' : ', Ed.');
    var out = [];
    if (num) out.push('[' + num + ']');
    if (names) out.push(T(names) + ',');
    var mon = monthName(MONTHS_IEEE, r.month); mon = mon ? mon + ' ' : '';
    var link = doiLink(r);
    var placePub = [r.place, r.publisher].filter(Boolean).join(': ');
    if (k === 'book') {
      out.push(I(r.title) + (validEdition(r.edition) ? ', ' + T(editionLabel(r.edition, 'apa')) : (endsPunct(r.title) ? '' : '.')));
      out.push(r.doi ? T([placePub, r.year].filter(Boolean).join(', ')) + ', doi: ' + T(r.doi) + '.' : htmlDot(T([placePub, r.year].filter(Boolean).join(', '))));
    } else if (k === 'chapter' || k === 'proceedings') {
      // IEEE Reference Guide: “Title,” in Book, vol. 4, A. Ed and B. Ed, Eds., 2nd ed. City, ST, USA: Publisher, year, pp. x–y, doi: …
      //                       “Title,” in Proc. Conf. Name (ABBR), City, ST, USA, Mon. year, pp. x–y, doi: …
      var edsI = r.container && r.editors.length ? ', ' + T(joinAnd(r.editors.map(nameInitFirst), 'and', r.editors.length > 2)) + (r.editors.length > 1 ? ', Eds.,' : ', Ed.,') : '';
      var volI = r.container && r.volume && !new RegExp('\\bvol\\.?\\s*' + r.volume.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(r.container) ? ', vol. ' + T(r.volume) : '';
      var edI = validEdition(r.edition) ? T(editionLabel(r.edition, 'apa')) : '';
      var head = '“' + T(r.title) + ',”' + (r.container ? ' in ' + I(r.container) + volI + edsI : '');
      var restC = [];
      if (r.year) restC.push(mon + T(r.year));
      if (r.pages) restC.push(T(pp(r.pages)));
      if (r.doi) restC.push('doi: ' + T(r.doi));
      var tailC = T(placePub) + (placePub && restC.length ? ', ' : '') + restC.join(', ');
      var joinC = edsI ? (edI ? ' ' + edI + ' ' : ' ') : edI ? ', ' + edI + ' ' : (k === 'proceedings' || endsPunct(r.container)) ? (endsPunct(r.container) ? ' ' : ', ') : '. ';
      out.push(r.container ? (tailC ? head + joinC + htmlDot(tailC) : htmlDot(head)) : head + (tailC ? ' ' + htmlDot(tailC) : ''));
    } else {
      var parts = ['“' + T(r.title) + ',”'];
      var rest = [];
      if (r.container) rest.push(I(r.container));
      else if (k !== 'journal' && hostOf(r)) rest.push(T(hostOf(r)));
      if (r.volume) rest.push('vol. ' + T(r.volume));
      if (r.issue) rest.push('no. ' + T(r.issue));
      if (r.pages && !r.isArticleNumber) rest.push(T(pp(r.pages)));
      if (showPublisher(r, k)) rest.push(T(r.publisher));
      if (r.year) rest.push(mon + T(r.year));
      if (r.pages && r.isArticleNumber) rest.push('Art. no. ' + T(r.pages)); // after the date: "vol. 91, no. 6, Aug. 2007, Art. no. 061103."
      if (r.doi) rest.push('doi: ' + T(r.doi));
      out.push(htmlDot(parts.join(' ') + (rest.length ? ' ' + rest.join(', ') : '')));
    }
    if (!r.doi && link) out.push('[Online]. Available: ' + T(link));
    return out.filter(Boolean).join(' '); // an empty part must not leave a double space
  }

  // Annals of Carnegie Museum / Bulletin of Carnegie Museum of Natural History.
  // Source: CMNH Publications Authors' Guide (6 Jan 2010), Literature Cited section:
  // all authors named (no et al.), initials without spaces ("Rawlins, J.E."), serial comma before "and",
  // periodicals spelled out, "Journal, volume(issue):pages" with no space after the colon,
  // books as "Title, Edition. Publisher, Place.", chapters as "Pp. x-y, in Book (Eds., eds.). Publisher, Place."
  function carnegieNames(people, mode) {
    var ini = function (p) { return initials(p.given, { space: false }); };
    var lastFirst = function (p) {
      if (p.literal) return p.family;
      var i = ini(p); return p.family + (i ? ', ' + i : '') + (p.suffix ? ', ' + p.suffix : '');
    };
    var firstLast = function (p) {
      if (p.literal) return p.family;
      var i = ini(p); return (i ? i + ' ' : '') + p.family + (p.suffix ? ', ' + p.suffix : '');
    };
    var n = people.length;
    if (!n) return '';
    if (mode === 'inline') { // editors inside parentheses: "K.D. Rose and J.D. Archibald"
      var all = people.map(firstLast);
      return n <= 2 ? all.join(' and ') : all.slice(0, -1).join(', ') + ', and ' + all[n - 1];
    }
    if (n === 1) return lastFirst(people[0]);
    var rest = people.slice(1).map(firstLast);
    return [lastFirst(people[0])].concat(rest.slice(0, -1)).join(', ') + ', and ' + rest[rest.length - 1];
  }

  function carnegie(r) {
    var k = kind(r);
    var names = others(carnegieNames(r.authors), r, ', et al');
    if (!names && r.editors.length) names = carnegieNames(r.editors) + (r.editors.length > 1 ? ' (eds.)' : ' (ed.)');
    var out = [];
    if (names) out.push(T(dot(names)));
    out.push(T(r.year ? r.year + '.' : 'n.d.'));
    var pages = r.pages ? r.pages.replace(/\s*[-–—]+\s*/g, '-') : '';
    var pubPlace = [r.publisher, r.place].filter(Boolean).join(', ');
    var eds = r.editors.length ? ' (' + T(carnegieNames(r.editors, 'inline')) + (r.editors.length > 1 ? ', eds.)' : ', ed.)') : '';
    if (k === 'journal') {
      // an edited work issued as a numbered part of a periodical series keeps its edition: "Index Herbariorum, Part I, Eighth Edition. Regnum Vegetabile, 120:1-693."
      out.push(T(dot(r.title + (validEdition(r.edition) ? ', ' + editionLabel(r.edition, 'carnegie') : ''))));
      var s = T(r.container);
      if (r.volume) s += ', ' + T(r.volume) + (r.issue ? '(' + T(r.issue) + ')' : '');
      if (pages) s += (r.volume ? ':' : ', ') + T(pages);
      s = s.replace(/^, /, '');
      if (s) out.push(htmlDot(s));
    } else if (k === 'book') {
      // Samways, M.J. 1994. Insect Conservation Biology. Chapman and Hall, London. 380 pp.
      // Ostle, B., and R.W. Mensing. 1975. Statistics in Research, Third Edition. Iowa State University Press, Ames, Iowa.
      out.push(T(dot(r.title + (validEdition(r.edition) ? ', ' + editionLabel(r.edition, 'carnegie') : ''))));
      if (pubPlace) out.push(T(dot(pubPlace)));
      if (/^\d+$/.test(r.numPages)) out.push(T(r.numPages) + ' pp.');
    } else if (k === 'chapter' || k === 'proceedings') {
      out.push(T(dot(r.title)));
      if (r.volume && (r.series || r.publisher)) { // paper in a numbered series volume: In Book (eds.). Series, 36:245-266.
        if (r.container) out.push('In ' + T(r.container) + eds + '.');
        out.push(T(r.series || r.publisher) + ', ' + T(r.volume) + (pages ? ':' + T(pages) : '') + '.');
      } else {
        if (r.container) out.push((pages ? 'Pp. ' + T(pages) + ', in ' : 'In ') + T(r.container) + eds + (eds || !endsPunct(r.container) ? '.' : ''));
        else if (pages) out.push('Pp. ' + T(pages) + '.');
        if (pubPlace) out.push(T(dot(pubPlace)));
      }
    } else if (k === 'thesis') {
      out.push(T(dot(r.title)));
      // the guide's example: "Unpublished Ph.D. Dissertation, University of Kansas, Lawrence, Kansas."; a master's degree is a thesis
      var degree = r.genre ? (/thesis|dissertation/i.test(r.genre) ? r.genre : r.genre + (/^m|master/i.test(r.genre.trim()) ? ' Thesis' : ' Dissertation')) : 'Ph.D. Dissertation';
      out.push(T(dot(['Unpublished ' + degree, r.publisher || r.institution, r.place].filter(Boolean).join(', '))));
    } else if (k === 'preprint') {
      out.push(T(dot(r.title)));
      var repo = hostOf(r);
      if (repo) out.push(T(repo) + ' preprint.');
      if (r.doi || r.url) out.push('Available from ' + T(doiLink(r)));
    } else if (k === 'report' || (k !== 'web' && !r.doi && !r.url)) {
      // printed reports like books, keeping the series and number:
      // U.S. Geological Survey. 2023. Mineral commodity summaries 2023. U.S. Geological Survey, Reston, Virginia. 210 pp.
      out.push(T(dot(r.title)));
      var ser = [r.series || (k === 'report' ? r.container : ''), r.number].filter(Boolean).join(' ');
      if (ser) out.push(T(dot(ser)));
      var rp = [r.publisher || r.institution, r.place].filter(Boolean).join(', ');
      if (rp) out.push(T(dot(rp)));
      if (/^\d+$/.test(r.numPages)) out.push(T(r.numPages) + ' pp.');
    } else { // web resource, dataset, software: Title [cited 16 July 2008]. Available from URL
      // "[cited …]" only with a recorded access date; today's date would be invented
      var host = hostOf(r), when = r.accessed, whenMonth = when ? monthName(MONTHS, when.month) : '';
      out.push(when && when.year ? T(r.title) + ' [cited ' + (whenMonth && validDay(when.day) ? when.day + ' ' : '') + (whenMonth ? whenMonth + ' ' : '') + when.year + '].' : T(dot(r.title)));
      if (host) out.push(T(dot(host)));
      if (r.doi || r.url) out.push('Available from ' + T(doiLink(r)));
    }
    return out.filter(Boolean).join(' '); // an empty part must not leave a double space
  }

  // In-text form for the Carnegie style: (Wible 2000), (Wible and Rawlins 2001), (Wible et al. 2002)
  /* ---------- in-text forms: the parenthetical citation, its narrative form, or the footnote, with an optional page locator ----------
   * Plain text (no italics), as it goes into a sentence.  opts.pages: "45" or "45-47" as the writer typed it; opts.n: the entry's
   * number in a numbered list (Vancouver, IEEE), 1 when a single reference is shown. */
  var ET_AL_FROM = { apa: 3, mla: 3, harvard: 4, chicago: 4, carnegie: 3 }; // the list length from which only the first name is given
  function citedPeople(r) { return r.authors.length ? r.authors : r.editors; }
  function famOf(p) { return p.family + (p.literal ? '' : ''); }
  // "Smith", "Smith and Jones", "Smith, Jones, and Lee", "Smith et al."
  function whoOf(r, style, and, oxford) {
    var people = citedPeople(r), fam = people.map(famOf), lim = ET_AL_FROM[style] || 3;
    if (!fam.length) return '';
    if (r.authorsOthers || fam.length >= lim) return fam[0] + ' et al.';
    return joinAnd(fam, and, oxford && fam.length > 2);
  }
  // A work with no author is cited by its title: the first words, in quotes for a part of something, plain for a whole work
  // A shortened title: the main title before a colon when it is short, never cut mid-phrase (CMOS 14.30 leaves that to the writer)
  function shortTitle(r) {
    var t = marksToText(r.title || ''), main = t.split(/:\s+/)[0];
    if (!t) return r.container || r.doi || 'Untitled'; // a figure or table DOI with no title or author of its own: cited by what it belongs to
    return main !== t && main.split(/\s+/).length <= 5 ? main : t;
  }
  function wholeWork(r) { return !/^(journal|chapter|proceedings|web|thesis)$/.test(kind(r)); } // italic in print: a book, report, dataset
  function shortTitleOf(r) { return wholeWork(r) ? shortTitle(r) : '\u201C' + shortTitle(r) + '\u201D'; }
  function locOf(pages, form) { // "p. 45" / "pp. 45–47" / "45–47"
    var p = String(pages || '').trim(); if (!p) return '';
    return form === 'bare' ? pageRange(p) : pp(p);
  }
  function apaInText(r, opts) {
    var who = whoOf(r, 'apa', '&') || shortTitleOf(r), whoN = whoOf(r, 'apa', 'and') || shortTitleOf(r);
    var when = (r.year || 'n.d.') + (opts.pages ? ', ' + locOf(opts.pages) : '');
    return { paren: '(' + who + ', ' + when + ')', narrative: whoN + ' (' + when + ')' };
  }
  function mlaInText(r, opts) {
    var who = whoOf(r, 'mla', 'and') || shortTitleOf(r);
    return { paren: '(' + who + (opts.pages ? ' ' + locOf(opts.pages, 'bare') : '') + ')' };
  }
  function harvardInText(r, opts) {
    var who = whoOf(r, 'harvard', 'and') || shortTitleOf(r);
    var when = (r.year || 'no date') + (opts.pages ? ', ' + locOf(opts.pages) : '');
    return { paren: '(' + who + ' ' + when + ')', narrative: who + ' (' + when + ')' };
  }
  function vancouverInText(r, opts) { return { paren: '(' + (opts.n || 1) + ')' }; }
  function ieeeInText(r, opts) { return { paren: '[' + (opts.n || 1) + (opts.pages ? ', ' + locOf(opts.pages) : '') + ']' }; }
  // Chicago notes and bibliography (CMOS 17, ch. 14): the full first note, and the shortened form for later notes
  function chicagoInText(r, opts) {
    var k = kind(r), loc = opts.pages ? locOf(opts.pages, 'bare') : '';
    var nm = function (people) { var m = people.length; return m === 0 ? '' : m >= 4 ? nameFullFirst(people[0]) + ' et al.' : joinAnd(people.map(nameFullFirst), 'and', m > 2); };
    var names = r.authorsOthers && r.authors.length ? nameFullFirst(r.authors[0]) + ' et al.' : nm(r.authors);
    var edited = !names && r.editors.length;
    if (edited) names = nm(r.editors) + (r.editors.length > 1 ? ', eds.' : ', ed.');
    var link = doiLink(r), tail = r.doi ? link : r.database ? r.database + (r.accession ? ' (' + r.accession + ')' : '') : (link || '');
    var title = marksToText(r.title || '') || shortTitle(r), quoted = function (t, comma) { return '\u201C' + t + (comma && !/[?!]$/.test(t) ? ',' : '') + '\u201D'; };
    var pub = [r.place, r.publisher].filter(Boolean).join(': ');
    var out = [], parts;
    if (k === 'journal') {
      var s = (r.container || '') + (r.volume ? ' ' + r.volume : '') + (r.issue ? ', no. ' + r.issue : '') + ' (' + (r.year ? (issueMonth(r) ? MONTHS[issueMonth(r) - 1] + ' ' : '') + r.year : 'n.d.') + ')';
      var pg = loc ? loc + (r.isArticleNumber && r.pages ? ', ' + r.pages : '') : (r.pages ? pageRange(r.pages) : '');
      if (pg) s += ': ' + pg;
      out = [names, quoted(title, true) + ' ' + s.replace(/^\s+/, '')];
      if (tail) out.push(tail);
    } else if (k === 'book') {
      var bt = title + (validEdition(r.edition) ? ', ' + editionLabel(r.edition, 'apa') : '');
      out = [names, bt + ' (' + [pub, r.year || 'n.d.'].filter(Boolean).join(', ') + ')'];
      if (loc) out.push(loc); if (tail) out.push(tail);
    } else if (k === 'chapter' || k === 'proceedings') {
      var inp = r.container ? 'in ' + r.container : '';
      if (r.editors.length && !edited) inp += (inp ? ', ed. ' : 'ed. ') + joinAnd(r.editors.map(nameFullFirst), 'and', r.editors.length > 2);
      out = [names, quoted(title, true) + (inp ? ' ' + inp : '') + ' (' + [pub, r.year || 'n.d.'].filter(Boolean).join(', ') + ')'];
      var cp = loc || (r.pages ? pageRange(r.pages) : ''); if (cp) out.push(cp); if (tail) out.push(tail);
    } else if (k === 'thesis') {
      out = [names, quoted(title) + ' (' + [/m\.?\s?[as]\.?|master/i.test(r.genre) ? "Master's thesis" : 'PhD diss.', r.institution || r.publisher, r.year].filter(Boolean).join(', ') + ')'];
      if (loc) out.push(loc); if (tail) out.push(tail);
    } else if (k === 'web') {
      var org = citedPeople(r).length && citedPeople(r)[0].literal; // an organisation follows the site name; a person leads
      out = org ? [quoted(title, true), r.container, names] : [names, quoted(title, true), r.container];
      if (r.year) out.push((r.month ? MONTHS[r.month - 1] + (r.day ? ' ' + r.day : '') + ', ' : '') + r.year);
      else if (accessedDate(r)) out.push('accessed ' + accessedDate(r));
      if (tail) out.push(tail);
    } else {
      out = [names, quoted(title, true) + ' ' + [hostOf(r), r.year || 'n.d.'].filter(Boolean).join(', ')];
      if (loc) out.push(loc); if (tail) out.push(tail);
    }
    var note = out.filter(Boolean).join(', ').replace(/,\u201D, /g, ',\u201D ').replace(/\s+/g, ' ') + '.'; // the comma sits inside a closing quote
    // the short form: surnames, a title of up to four words, the page
    var fam = citedPeople(r).map(famOf), sn = fam.length ? (r.authorsOthers || fam.length >= 4 ? fam[0] + ' et al.' : joinAnd(fam, 'and', fam.length > 2)) : '';
    var st = shortTitle(r);
    var shortNote = (sn ? sn + ', ' : '') + (wholeWork(r) ? st + (loc ? ', ' + loc : '') : '\u201C' + st + (loc ? ',\u201D ' + loc : '\u201D')) + '.';
    return { note: note, short: shortNote };
  }
  function carnegieInText(r, opts) {
    opts = opts || {};
    var fam = r.authors.map(function (p) { return p.family; });
    var who = fam.length === 0 ? (r.container || 'Anon.') : fam.length === 1 ? fam[0] : fam.length === 2 ? fam[0] + ' and ' + fam[1] : fam[0] + ' et al.';
    return '(' + who + ' ' + (r.year || 'n.d.') + (opts.pages ? ':' + locOf(opts.pages, 'bare') : '') + ')';
  }
  var IN_TEXT = { apa: apaInText, mla: mlaInText, chicago: chicagoInText, harvard: harvardInText, vancouver: vancouverInText, ieee: ieeeInText,
    carnegie: function (r, opts) { return { paren: carnegieInText(r, opts) }; } };
  // {paren, narrative?} for author-date and numeric styles; {note, short} for Chicago's notes
  function inTextForms(r, styleId, opts) {
    var fn = IN_TEXT[styleId]; if (!fn) return null;
    return fn(r, opts || {});
  }

  /* ---------- machine formats (plain text) ---------- */

  // ASCII form for keys: "Çelik" -> "Celik", "Bartók" -> "Bartok", "Øster" -> "Oster"
  var ASCII_LETTERS = { 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O', 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D',
    'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th', 'ı': 'i' };
  function foldAscii(s) { // letters folded, everything else kept: "García" -> "Garcia", "Schrödinger" -> "Schrodinger"
    var t = String(s || '').replace(/[ßæÆœŒøØłŁđĐðÐþÞı]/g, function (c) { return ASCII_LETTERS[c]; });
    if (t.normalize) t = t.normalize('NFD');
    return t.replace(/[\u0300-\u036f]/g, '');
  }
  function toAscii(s) { return foldAscii(s).replace(/[^A-Za-z0-9]/g, ''); }
  function bibKey(r) {
    var words = (toAsciiWords(r.title)).filter(function (w) {
      return !/^(the|and|for|with|from|into|over|under|that|this|are|was|were|its|our|their)$/i.test(w);
    });
    var who = r.authors.length ? r.authors : r.editors;
    var fam = who.length ? toAscii(who[0].family) : '';
    if (!fam) return (words[0] ? words[0].charAt(0).toUpperCase() + words[0].slice(1) : 'ref') + (r.year || '') + (words[1] || ''); // no author: title word
    return fam + (r.year || '') + (words[0] || '');
  }
  function toAsciiWords(t) {
    return String(t || '').split(/[\s\-\u2010-\u2015\/]+/).map(toAscii).filter(function (w) { return /[A-Za-z]{3,}/.test(w); });
  }
  var BIB_ESC = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
    '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_' };
  function bibEsc(s) { return String(s).replace(/[\\{}~^&%$#_]/g, function (c) { return BIB_ESC[c]; }); }
  // braces keep "World Health Organization" as one name; escaped first so the braces survive
  // BibTeX's three-part form puts the suffix second: "King, Jr., Martin Luther"
  // a part holding " and " is braced so BibTeX does not split the name there ("{Smith and Jones}, C")
  function bibPart(s) { return /\sand\s/i.test(s) ? '{' + bibEsc(s) + '}' : bibEsc(s); }
  function bibName(p) {
    if (p.literal) return '{' + bibEsc(p.family) + '}';
    var fam = bibPart(p.family), given = p.given ? bibPart(p.given) : '';
    if (!p.suffix) return fam + (given ? ', ' + given : '');
    return fam + ', ' + bibEsc(p.suffix) + ',' + (given ? ' ' + given : '');
  }
  // RIS / EndNote single-field name (EndNote convention): a trailing comma marks it, and commas inside
  // it are doubled so EndNote does not split it there: "USDOE,, Washington,, DC (United States),"
  function taggedName(p) { return p.literal ? p.family.replace(/,/g, ',,') + ',' : nameLastFull(p); }

  // Brace-protect title words so sentence-casing .bst styles keep their capitals (Zotero's practice): every word
  // with a capital letter except a plain capitalised first word ("The"), plus words carrying \textsubscript etc.
  // (script arguments are already braced, so a first word such as "Fe\textsuperscript{3+}" needs nothing).
  // A word starting with a command gets double braces: BibTeX treats "{\cmd …}" as a special character and
  // would change the case inside it.
  function bibProtect(t) {
    var words = [], depth = 0, cur = '';
    for (var i = 0; i < t.length; i++) {
      var c = t.charAt(i);
      if (c === '{' && t.charAt(i - 1) !== '\\') depth++;
      else if (c === '}' && t.charAt(i - 1) !== '\\') depth--;
      if (/\s/.test(c) && depth === 0) { if (cur) words.push(cur); words.push(c); cur = ''; } else cur += c;
    }
    if (cur) words.push(cur);
    var firstWord = true;
    return words.map(function (w) {
      if (/^\s$/.test(w)) return w;
      var isFirst = firstWord; firstWord = false;
      var plain = w.replace(/\\[a-zA-Z]+/g, '');                    // letters of commands are not text
      var caps = plain !== plain.toLowerCase();
      if (!caps && !/\\text(?:sub|super)script/.test(w)) return w;
      var rest = plain.replace(/^[^A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]*./, '');
      if (isFirst && rest === rest.toLowerCase()) return w;    // "The", "Fe\textsuperscript{3+}": a first capital is kept anyway
      return w.charAt(0) === '\\' ? '{{' + w + '}}' : '{' + w + '}';
    }).join('');
  }

  // The publisher field of an export: the preprint server or repository (r.institution) when the styles show it as the host
  function hostPublisher(r) { return r.institution && !r.container ? r.institution : r.publisher; }

  function bibtex(r) {
    var k = kind(r);
    var type = { journal: 'article', chapter: 'incollection', book: 'book', proceedings: 'inproceedings',
      thesis: 'phdthesis', report: 'techreport' }[k] || 'misc';
    var f = [];
    var add = function (key, val, raw) { if (val) f.push('  ' + key + ' = ' + (raw === 'bare' ? val : '{' + (raw ? val : bibEsc(val)) + '}')); };
    f.push('  title = {' + bibProtect(marksToLatex(bibEsc(r.title))) + '}');
    add('author', r.authors.map(bibName).join(' and '), true);
    add('editor', r.editors.map(bibName).join(' and '), true);
    if (k === 'journal') add('journal', r.container);
    else if (k === 'chapter' || k === 'proceedings') add('booktitle', r.container);
    else if (k === 'book') { if (r.container && r.container !== r.series) add('series', r.container); } // a book's container is its series
    else if (r.container) add('howpublished', r.container);
    add('series', r.series);
    if (k === 'report' && r.number) add('number', r.number);
    add('edition', validEdition(r.edition));
    add('volume', r.volume);
    add('number', r.issue);
    add('pages', r.pages ? enDash(r.pages).replace(/–/g, '--') : '');
    if (r.isArticleNumber) add('eid', r.pages);                    // article number, read back as one (pages kept for plain BibTeX styles)
    add('year', r.year);
    if (monthName(MONTHS_ABBR, r.month)) add('month', monthName(MONTHS_ABBR, r.month).replace('.', '').toLowerCase(), 'bare');
    if (k === 'thesis') add('school', r.publisher || r.institution);
    else if (k === 'report') add('institution', r.publisher || r.institution);
    else add('publisher', hostPublisher(r));
    add('address', r.place);
    add('issn', r.issn, true);
    add('isbn', r.isbn, true);
    add('doi', r.doi, true);
    add('url', doiLink(r), true);
    if (k === 'preprint') add('note', 'Preprint');
    if (k === 'dataset') add('note', 'Dataset');
    if (k === 'software') add('note', 'Software');
    if (k === 'standard') add('note', 'Standard');
    add('abstract', r.abstract);
    return '@' + type + '{' + bibKey(r) + ',\n' + f.join(',\n') + '\n}';
  }

  // Values of the given tags from the record's imported file (r.raw), when it came from that format
  function rawTags(r, src, tags, src2, tags2) {
    var out = [], raw = r.raw;
    if (!raw || typeof raw !== 'object') return out;
    var take = function (list) {
      list.forEach(function (t) {
        var v = raw[t];
        (Array.isArray(v) ? v : v ? [v] : []).forEach(function (x) { x = clean(x); if (x && out.indexOf(x) === -1) out.push(x); });
      });
    };
    if (r.source === src) take(tags);
    else if (src2 && r.source === src2) take(tags2);
    return out;
  }

  function ris(r) {
    var k = kind(r);
    var type = { journal: 'JOUR', chapter: 'CHAP', book: 'BOOK', proceedings: 'CONF', preprint: 'UNPB',
      dataset: 'DATA', software: 'COMP', thesis: 'THES', report: 'RPRT', standard: 'STAND', web: 'ELEC' }[k] || 'GEN';
    if (/^(?:reference-entry|entry-encyclopedia|entry)$/.test(r.type)) type = 'ENCYC';
    if (r.type === 'entry-dictionary') type = 'DICT';
    var L = [];
    var add = function (tag, val) { if (val) L.push(tag + '  - ' + val); };
    add('TY', type);
    r.authors.forEach(function (p) { add('AU', taggedName(p)); });
    r.editors.forEach(function (p) { add('ED', taggedName(p)); });
    add('TI', marksToText(r.title));
    add('T2', r.container);
    add('T3', r.series);
    add('ET', validEdition(r.edition));
    if (r.shortContainer && r.shortContainer !== r.container) add('JO', r.shortContainer);
    add('VL', r.volume);
    add('IS', r.issue);
    var pm = r.pages.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (pm) { add('SP', pm[1]); add('EP', pm[2]); } else add('SP', r.pages);
    add('PY', r.year);
    var dm = validMonth(r.month);
    if (r.year) add('DA', r.year + '/' + (dm ? pad2(dm) : '') + '/' + (dm && validDay(r.day) ? pad2(r.day) : '') + '/');
    add('PB', hostPublisher(r));
    add('CY', r.place);
    add('SN', r.isbn);                                            // RIS: SN is the ISBN of a book and the ISSN of a serial; both are kept
    add('SN', r.issn);
    add('DO', r.doi);
    var urls = rawTags(r, 'ris', ['UR']);
    (urls.length ? urls : [doiLink(r)]).forEach(function (u) { add('UR', u); }); // a file's own links are kept
    add('LA', r.language);
    add('AB', r.abstract);
    // tags AutoDOI does not model, carried over from an imported RIS / EndNote record
    rawTags(r, 'ris', ['KW'], 'enw', ['K']).forEach(function (v) { add('KW', v); });
    rawTags(r, 'ris', ['N1'], 'enw', ['Z']).forEach(function (v) { add('N1', v); });
    var rawDB = rawTags(r, 'ris', ['DB']), fromDB = !rawTags(r, 'ris', ['DP']).length && rawDB.indexOf(r.database) !== -1; // a DB-only file stays DB
    if (!fromDB) add('DP', r.database);
    add('AN', r.accession);
    ['L1', 'L2', 'Y2', 'M3'].forEach(function (t) { rawTags(r, 'ris', [t]).forEach(function (v) { add(t, v); }); });
    rawDB.forEach(function (v) { if (fromDB || v !== r.database) add('DB', v); });
    rawTags(r, 'ris', ['CN']).forEach(function (v) { add('CN', v); });
    L.push('ER  - ');
    return L.join('\r\n') + '\r\n';
  }

  function endnote(r) {
    var k = kind(r);
    var type = { journal: 'Journal Article', chapter: 'Book Section', book: 'Book', proceedings: 'Conference Paper',
      preprint: 'Unpublished Work', dataset: 'Dataset', software: 'Computer Program', thesis: 'Thesis', report: 'Report',
      standard: 'Standard', web: 'Web Page' }[k] || 'Generic';
    if (/^(?:reference-entry|entry-encyclopedia|entry)$/.test(r.type)) type = 'Encyclopedia';
    if (r.type === 'entry-dictionary') type = 'Dictionary';
    var L = [];
    var add = function (tag, val) { if (val) L.push(tag + ' ' + val); };
    add('%0', type);
    r.authors.forEach(function (p) { add('%A', taggedName(p)); });
    r.editors.forEach(function (p) { add('%E', taggedName(p)); });
    add('%T', marksToText(r.title));
    if (k === 'journal') add('%J', r.container);
    else add('%B', r.container);
    add('%S', r.series);
    add('%7', validEdition(r.edition));
    add('%V', r.volume);
    add('%N', r.issue);
    add('%P', r.pages ? enDash(r.pages).replace(/–/g, '-') : '');
    add('%D', r.year);
    if (monthName(MONTHS, r.month)) add('%8', monthName(MONTHS, r.month) + (validDay(r.day) ? ' ' + r.day : ''));
    add('%I', hostPublisher(r));
    add('%C', r.place);
    add('%@', r.isbn);
    add('%@', r.issn);
    add('%R', r.doi);
    var urls = rawTags(r, 'enw', ['U']);
    (urls.length ? urls : [doiLink(r)]).forEach(function (u) { add('%U', u); });
    add('%G', r.language);
    add('%X', r.abstract);
    rawTags(r, 'enw', ['K'], 'ris', ['KW']).forEach(function (v) { add('%K', v); });
    var notes = rawTags(r, 'enw', ['Z'], 'ris', ['N1']);
    if (notes.length) add('%Z', notes.join('; '));                // %Z is a single field
    add('%W', r.database); add('%M', r.accession);
    ['L', 'F', '1', '2', '3', '4'].forEach(function (t) { var v = rawTags(r, 'enw', [t]); if (v.length) add('%' + t, v.join('; ')); });
    return L.join('\n') + '\n';
  }

  /* ---------- registry ---------- */

  var STYLES = [
    { id: 'apa', label: 'APA 7th', fn: apa, rich: true, inText: function (r, o) { return apaInText(r, o || {}).paren; } },
    { id: 'mla', label: 'MLA 9th', fn: mla, rich: true, inText: function (r, o) { return mlaInText(r, o || {}).paren; } },
    { id: 'chicago', label: 'Chicago 17th', fn: chicago, rich: true, inText: function (r, o) { return chicagoInText(r, o || {}).note; }, notes: true },
    { id: 'harvard', label: 'Harvard', fn: harvard, rich: true, inText: function (r, o) { return harvardInText(r, o || {}).paren; } },
    { id: 'vancouver', label: 'Vancouver', fn: vancouver, rich: true, inText: function (r, o) { return vancouverInText(r, o || {}).paren; }, numbered: true },
    { id: 'ieee', label: 'IEEE', fn: ieee, rich: true, inText: function (r, o) { return ieeeInText(r, o || {}).paren; }, numbered: true },
    { id: 'carnegie', label: 'Annals of Carnegie Museum', fn: carnegie, rich: true, inText: carnegieInText }
  ];
  var EXPORTS = [
    { id: 'bibtex', label: 'BibTeX', fn: bibtex, ext: 'bib' },
    { id: 'ris', label: 'RIS', fn: ris, ext: 'ris' },
    { id: 'endnote', label: 'EndNote tagged', fn: endnote, ext: 'enw' }
  ];

  // Every field the formatters read, coerced to the type they expect.  Records from normalize() already have this
  // shape; this guards a caller's hand-built record, so a stray null, number or array cannot throw or leak
  var STR_FIELDS = ['type', 'doi', 'url', 'title', 'subtitle', 'container', 'series', 'number', 'shortContainer', 'institution', 'edition', 'numPages', 'genre',
    'year', 'volume', 'issue', 'pages', 'articleNumber', 'publisher', 'place', 'issn', 'isbn', 'abstract', 'language', 'event', 'database', 'accession', 'originalTitle'];
  var ANY_PUA = /[\uE000-\uF8FF]/g;
  function str(v) { return v === undefined || v === null || typeof v === 'boolean' || (typeof v === 'number' && !isFinite(v)) ? '' : Array.isArray(v) ? v.map(str).filter(Boolean).join(' ') : typeof v === 'object' ? '' : String(v); }
  function harden(record) {
    var r = {}, k;
    for (k in record) if (Object.prototype.hasOwnProperty.call(record, k)) r[k] = record[k];
    STR_FIELDS.forEach(function (f) { r[f] = str(r[f]); });
    if (!/^\d{4}[a-z]?$/.test(r.year)) r.year = (r.year.match(/\d{4}/) || [''])[0];
    r.month = r.month > 0 && r.month <= 12 ? Math.floor(Number(r.month)) : 0;
    r.day = r.month && r.day > 0 && r.day <= 31 ? Math.floor(Number(r.day)) : 0;
    r.years = Array.isArray(r.years) ? r.years.map(str).filter(Boolean) : (r.year ? [r.year] : []);
    var ppl = function (list) {
      return (Array.isArray(list) ? list : []).map(function (p) {
        if (!p || typeof p !== 'object') return null;
        var fam = str(p.family) || str(p.name) || str(p.literal === true ? '' : p.literal);
        return fam ? { family: fam, given: str(p.given), suffix: str(p.suffix), literal: !!p.literal } : null;
      }).filter(Boolean);
    };
    r.authors = ppl(r.authors); r.editors = ppl(r.editors); r.authorsOthers = !!r.authorsOthers;
    r.accessed = r.accessed && typeof r.accessed === 'object' && /^\d{4}$/.test(String(r.accessed.year)) ? { year: Number(r.accessed.year), month: r.accessed.month > 0 && r.accessed.month <= 12 ? Number(r.accessed.month) : 0, day: r.accessed.day > 0 && r.accessed.day <= 31 ? Number(r.accessed.day) : 0 } : null;
    return r;
  }
  function format(record, styleId, num) {
    var r = withDisplayTitle(harden(record.authors ? record : normalize(record)));
    var all = STYLES.concat(EXPORTS);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === styleId) {
        var out = all[i].fn(r, num);
        return (all[i].rich ? stripTags(out) : out).replace(ANY_PUA, '');
      }
    }
    throw new Error('Unknown style: ' + styleId);
  }

  // The renderers emit exactly these tags; any other "<" in the output is text and is escaped (a last line of defence
  // behind esc(): a field that somehow carried markup cannot become an element in the page)
  var HTML_ALLOWED = /<(?!\/?(?:i|sub|sup|span)>|span style="font-style:normal">)/g;
  function formatHtml(record, styleId, num) {
    var r = withDisplayTitle(harden(record.authors ? record : normalize(record)));
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === styleId) return STYLES[i].fn(r, num).replace(HTML_ALLOWED, '&lt;').replace(ANY_PUA, '');
    throw new Error('Unknown text style: ' + styleId);
  }

  /* ---------- matching confidence ---------- */

  // Sub/superscript digits and signs as plain characters: "Fe₂O₃" and "Fe<sub>2</sub>O<sub>3</sub>" are the same formula
  var SCRIPT_CHARS = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '⁰': '0', '¹': '1', '²': '2', '³': '3',
    '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', '₊': '+', '₋': '-' };
  // Words of any script. Letters and digits are words (three or more characters, as before for Latin); CJK text carries no
  // spaces, so a CJK run is read as its overlapping character pairs; a Cyrillic word also yields its Latin transliteration,
  // so "Пароникян" meets a record that Crossref holds as "Paronikyan"
  var WORD_RE; try { WORD_RE = new RegExp('[\\p{L}\\p{N}]+', 'gu'); } catch (e) { WORD_RE = /[a-z0-9À-ɏͰ-ϿЀ-ӿ԰-֏֐-׿؀-ۿ぀-ヿ㐀-鿿가-힯]+/g; }
  var CJK_RE = /[぀-ヿ㐀-鿿가-힯]/, CJK_SPLIT = /[぀-ヿ㐀-鿿가-힯]+|[^぀-ヿ㐀-鿿가-힯]+/g;
  var CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u' };
  function translit(w) { return w.replace(/[Ѐ-ӿ]/g, function (c) { return CYR[c] !== undefined ? CYR[c] : c; }); }
  function tokens(s) {
    var t = clean(s).replace(/[-]/g, '')
      .replace(/[₀-₉⁰¹²³⁴-⁹⁺⁻₊₋]/g, function (c) { return SCRIPT_CHARS[c]; });
    t = foldAscii(t).toLowerCase().replace(/ё/g, 'е'); // ё is е
    var out = [], m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(t))) {
      var w = m[0];
      if (CJK_RE.test(w)) {
        (w.match(CJK_SPLIT) || []).forEach(function (seg) {
          if (!CJK_RE.test(seg)) { if (seg.length >= 3) out.push(seg); return; }
          if (seg.length === 1) out.push(seg);
          for (var i = 0; i + 1 < seg.length; i++) out.push(seg.slice(i, i + 2));
          if (seg.length >= 2 && seg.length <= 4) for (var q = 0; q < seg.length; q++) out.push(seg.charAt(q)); // a name: 王明 is 王 + 明 too
        });
      } else if (w.length >= 3) {
        out.push(w);
        if (/[Ѐ-ӿ]/.test(w)) { var tr = translit(w); if (tr !== w && tr.length >= 3) out.push(tr); }
      }
    }
    return out;
  }


  // Spelling folded the same way on both sides, so British and American forms compare equal (behaviour/behavior,
  // sulphide/sulfide, palaeo/paleo, modelling/modeling, centre/center, -isation/-ization); only equality is ever tested
  function foldSpelling(w) {
    if (w.length < 6) return w === 'grey' ? 'gray' : w;                                   // short words are left as they are: gill is not gil, poet is not pet
    return w.replace(/sulph/g, 'sulf').replace(/(ae|oe)(?![l])/g, 'e').replace(/our$/, 'or').replace(/i[sz]ation$/, 'ization').replace(/i[sz]e[sd]?$/, 'ize')
      .replace(/y[sz]e[sd]?$/, 'yze').replace(/(t|b)re$/, '$1er').replace(/ll(?=[iea])/g, 'l').replace(/mme$/, 'm').replace(/logue$/, 'log');
  }
  // Damerau-Levenshtein distance, stopping once it exceeds max
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i]; var rowMin = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, (prev2 ? prev2[j - 2] : Infinity) + 1);
        cur[j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      var prev2 = prev; prev = cur;
    }
    return prev[b.length];
  }
  // Is this title word in the reference text? Exactly, within a typo or two ("fuids" for "fluids", the ligature dropped),
  // or as a hyphenated compound written solid on one side ("calc-alkaline" / "calcalkaline")
  function wordFound(word, i, words, hay, haySet) {
    if (haySet[word]) return true;
    if (words[i + 1] && haySet[word + words[i + 1]]) return true;
    if (words[i - 1] && haySet[words[i - 1] + word]) return true;
    var max = word.length >= 9 ? 2 : word.length >= 5 ? 1 : 0, k;
    for (k = 0; k + 1 < hay.length; k++) if (hay[k] + hay[k + 1] === word) return true;
    if (!max) return false;
    for (k = 0; k < hay.length; k++) if (editDistance(hay[k], word, max) <= max) return true;
    return false;
  }
  function titleScore(title, hay, haySet) {
    var raw = tokens(title), words = [], i;
    for (i = 0; i < raw.length; i++) { // a Cyrillic word is followed by its transliteration: one word, found if either form is
      if (i + 1 < raw.length && /[\u0400-\u04ff]/.test(raw[i]) && raw[i + 1] === translit(raw[i])) { words.push([foldSpelling(raw[i]), foldSpelling(raw[i + 1])]); i++; }
      else words.push([foldSpelling(raw[i])]);
    }
    if (!words.length) return 0;
    var flat = words.map(function (p) { return p[0]; }), hit = 0;
    for (i = 0; i < words.length; i++) if (words[i].some(function (w) { return wordFound(w, i, flat, hay, haySet); })) hit++;
    return hit / words.length;
  }
  // How well does a found record explain the reference text the user pasted? 0..1
  function matchConfidence(refText, record, opts) {
    record = harden(record && record.authors ? record : normalize(record || {}));
    opts = opts || {};
    var r = record.authors ? record : normalize(record);
    var hay = tokens(refText).map(foldSpelling), haySet = {};
    hay.forEach(function (w) { haySet[w] = true; });
    // A paper Crossref or OpenAlex knows to be retracted often carries a "RETRACTED: " prefix in its deposited title: not a title word the reference
    // should have, and not the sign of a notice.  Without that knowledge a "Retracted: " title is read as a notice about the paper, as before
    var retractedPaper = (r.updates || []).some(function (u) { return u.kind === 'retraction' && u.from !== 'title'; });
    var title = retractedPaper ? marksToText(r.title).replace(TITLE_NOTICE_PREFIX, '') : marksToText(r.title), score = 0;
    if (!tokens(title).length && !tokens(r.originalTitle || '').length) return 0;
    // the record's title, or the original-language title Crossref holds beside a translation; a reference often drops a subtitle
    [title, r.originalTitle ? marksToText(r.originalTitle) : ''].forEach(function (t) {
      if (!t) return;
      score = Math.max(score, titleScore(t, hay, haySet));
      var main = t.split(/:\s+/)[0];
      if (main !== t && tokens(main).length >= 3) score = Math.max(score, titleScore(main, hay, haySet));
    });
    if (opts.titleOnly) return Math.max(0, Math.min(1, score)); // the Find tab has no year or author to check
    // the first person named: an organisation deposited as first author cannot be checked against a name list
    var persons = r.authors.filter(function (p) { return !p.literal; });
    var authorOk = true;
    if (persons.length) {
      var fams = tokens(persons[0].family), fam = fams[0]; // names are compared as written (plus the transliteration), not spelling-folded
      if (fam && !fams.some(function (f) { return haySet[f] || (f.length >= 5 && hay.some(function (h) { return editDistance(h, f, f.length >= 8 ? 2 : 1) <= (f.length >= 8 ? 2 : 1); })); })) authorOk = false; // "Safna" for "Safina"; "Пароникян" for "Paronikyan"
    }
    // "(1964a)" is a year; "1573-1588" is a page range, but only a real year check can tell, so every four-digit token counts
    var yearsInRef = (String(refText).match(/\b(?:1[5-9]|20)\d{2}(?=[a-z]?\b)/g) || []).map(Number);
    var recYears = (r.years && r.years.length ? r.years : (r.year ? [r.year] : [])).map(Number);
    if (recYears.length && yearsInRef.length) {
      var near = yearsInRef.some(function (x) { return recYears.some(function (y) { return Math.abs(x - y) <= 1; }); });
      if (!near) score -= 0.35;                                                          // a different year is a different record
      else if (!yearsInRef.some(function (x) { return recYears.indexOf(x) !== -1; })) score -= 0.05; // online vs print year
    } else if (recYears.length) score -= authorOk ? 0.08 : 0.15;                         // no year given: the author carries more weight
    // Notices about a paper share its title: corrigenda, errata, replies, reviews, recommendations
    var NOTICE = /^(corrigendum|erratum|errata|correction|retraction|retracted|expression of concern|editorial|reply|authors?['\u2019]?s?\s+reply|response|comment|commentary on|faculty opinions|review of|book review|withdrawn|addendum|author correction|publisher correction|supplementary (?:material|information|data)|supplemental)\b/i;
    // A record Crossref says updates another work is a notice whatever its title; a paper whose own title was prefixed "RETRACTED: " is the paper, flagged on the row
    if ((NOTICE.test(retractedPaper && !r.updateOf ? title : r.title) || r.updateOf || /^(peer-review|component)$/.test(r.type)) && !NOTICE.test(String(refText).replace(/^[^.]*\.\s*/, ''))) score -= 0.5;
    // A container is never what a reference cites: the journal's own record ("Вестник Пермского университета") shares the journal name with every reference to it
    if (/^(?:journal|journal-issue|journal-volume|book-series|book-set|proceedings-series|report-series|book-track)$/.test(r.type)) score -= 0.5;
    if (!authorOk) score -= 0.15;
    // A reference with no title ("Бабичев А.В. и др. // Письма в ЖТФ. 2020. Т. 46. № 9. С. 35", "Smith J. Nature 500:54 (2013)"):
    // author, year, volume and first page agreeing with the record is a specific enough match; three of the four is one to check
    var STOP_PREFIX = /^(?:with|from|that|this|into|over|under|these|those|there|their|what|when|where|which|while|other|about|after|before|between)$/;
    if (score < 0.35 && authorOk && recYears.length && yearsInRef.length) {
      var raw = String(refText).replace(/^\s*(?:\[\d{1,3}\]|\d{1,3}[.)])\s+/, ''), nearYear = yearsInRef.some(function (x) { return recYears.some(function (y) { return Math.abs(x - y) <= 1; }); }); // a list number is not a volume
      var volText = raw.replace(/(\d)\s*\(\d{1,4}\)/g, '$1').replace(/(?:\bno\.?|\u2116|\bissue)\s*\d+/gi, ''); // "5(12)", "no. 12": an issue is not a volume
      var volOk = r.volume && new RegExp('(^|[^\\d])' + r.volume.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\d])').test(volText);
      var firstPage = (r.pages.match(/^[A-Za-z]?\d+/) || [''])[0];
      var pageOk = firstPage && new RegExp('(^|[^\\d])' + firstPage.replace(/^0+/, '') + '(?![\\d])').test(raw);
      // "15-25" is one page range, not volume 25 and page 15
      var rangeRe = /(\d+)\s*[-\u2013\u2212]\s*(\d+)/g, rg;
      while (volOk && pageOk && (rg = rangeRe.exec(raw))) { var ends = [rg[1], rg[2]]; if (ends.indexOf(String(r.volume)) !== -1 && ends.indexOf(firstPage.replace(/^0+/, '')) !== -1) { volOk = false; } }
      var known = {}; // the record's author names and journal words; whatever else the reference says of five letters or more is a title
      r.authors.forEach(function (p) { tokens(p.family).forEach(function (w) { known[foldSpelling(w)] = 1; }); });
      var jwords = tokens(r.container + ' ' + r.shortContainer).filter(function (w) { return w.length >= 4 && !/^\d+$/.test(w); }).map(foldSpelling);
      var ofJournal = function (w) { return jwords.some(function (j) { return j === w || (w.length >= 4 && !STOP_PREFIX.test(w) && j.indexOf(w) === 0); }); }; // "Geophys" abbreviates "Geophysical"; "the" does not abbreviate "Thermochimica"
      // a name the reference writes with initials ("Мохсени Т.И.", "J. Smith") is an author, however the record spells it
      var NAME_INI = /([A-Za-zÀ-ɏͰ-ϿЀ-ӿ]{3,}),?\s+(?:[A-ZÀ-ÞΑ-ΩА-Я]\.\s?){1,3}|(?:[A-ZÀ-ÞΑ-ΩА-Я]\.\s?){1,3}([A-Za-zÀ-ɏͰ-ϿЀ-ӿ]{3,})/g, nm;
      while ((nm = NAME_INI.exec(raw))) tokens(nm[1] || nm[2]).forEach(function (w) { known[foldSpelling(w)] = 1; });
      // a title word can only disagree with a title in its own script: a Russian reference to a record whose title is English has no title to compare
      var titleText = String(r.title || '') + ' ' + String(r.originalTitle || ''), letters = function (re) { return (titleText.match(re) || []).length; };
      var cnt = { cyr: letters(/[Ѐ-ӿ]/g), grk: letters(/[Ͱ-Ͽ]/g), cjk: letters(/[぀-ヿ㐀-鿿가-힯]/g), lat: letters(/[A-Za-zÀ-ɏ]/g) }, total = cnt.cyr + cnt.grk + cnt.cjk + cnt.lat;
      var scriptOf = function (w) { return /[Ѐ-ӿ]/.test(w) ? 'cyr' : /[Ͱ-Ͽ]/.test(w) ? 'grk' : /[぀-ヿ㐀-鿿가-힯]/.test(w) ? 'cjk' : 'lat'; };
      // …and only in the reference's own script: the bracketed English rendering of a Russian reference is not its title
      var refLetters = function (re) { return (raw.match(re) || []).length; }, refCnt = { cyr: refLetters(/[Ѐ-ӿ]/g), grk: refLetters(/[Ͱ-Ͽ]/g), cjk: refLetters(/[぀-ヿ㐀-鿿가-힯]/g), lat: refLetters(/[A-Za-zÀ-ɏ]/g) };
      var refScript = Object.keys(refCnt).sort(function (x, y) { return refCnt[y] - refCnt[x]; })[0];
      var comparable = function (w) { return total > 0 && scriptOf(w) === refScript && cnt[refScript] >= 0.3 * total; };
      // links, DOIs, EDN codes and the words around locators are not title words
      var hayC = tokens(raw.replace(/https?:\/\/\S+|\b(?:doi|dx\.doi)\S*|10\.\d{4,9}\/\S+|\bEDN:?\s*[A-Z]{6}\b/gi, ' ')), NOT_TITLE = /^(?:https?|suppl|supplement|issue|volume|pages|available|accessed|retrieved|online|cited|article|number)$/;
      var journalSaid = false, leftover = 0;
      hayC.forEach(function (w, i) {
        if (i && /[Ѐ-ӿ]/.test(hayC[i - 1]) && w === translit(hayC[i - 1])) return; // the transliteration the tokeniser adds beside a Cyrillic word
        var f = foldSpelling(translit(w));
        if (ofJournal(w) || ofJournal(f)) { journalSaid = true; return; }
        if (w.length >= 5 && !known[w] && !known[f] && !/^\d+$/.test(w) && !NOT_TITLE.test(w) && comparable(w)) leftover++;
      });
      var journalOk = journalSaid || !jwords.length || leftover === 0; // the journal named, or no journal named at all; an unexplained word may be another journal
      // a line with no title of its own: the same author, year, volume and first page is the same article; three of the four is one to check.
      // A full reference whose title disagrees is a different paper whatever the numbers say, unless the journal agrees too: then check it
      if (nearYear && volOk && pageOk && leftover <= 2) score = Math.max(score, journalOk ? 0.85 : 0.6);
      else if (nearYear && volOk && pageOk && journalSaid) score = Math.max(score, 0.6);
      else if (nearYear && leftover <= 3 && (volOk || pageOk)) score = Math.max(score, 0.6);
    }
    return Math.max(0, Math.min(1, score));
  }

  var api = {
    extractDoi: extractDoi,
    toDoi: toDoi,
    extractPmid: extractPmid,
    extractIsbn: extractIsbn,
    splitName: splitName,
    fromOpenAlex: fromOpenAlex,
    fromOpenLibrary: fromOpenLibrary,
    normalize: normalize,
    kind: kind,
    format: format,
    formatHtml: formatHtml,
    stripTags: stripTags,
    translit: translit,
    options: OPTIONS,
    titleHtml: titleHtml,
    titleText: function (r) { return marksToText(displayTitle(r)); },
    toScript: function (t, kind) { return unicodeScript(String(t), kind === 'sup' ? SUP_MAP : SUB_MAP); },
    autoFormulas: function (s) { return marksToText(autoFormulas(String(s === undefined || s === null ? '' : s).replace(PUA_RE, ''))); }, // plain text in: no markers
    inText: function (record, styleId, opts) {
      var r = harden(record.authors ? record : normalize(record));
      for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === styleId && STYLES[i].inText) return STYLES[i].inText(r, opts || {});
      return '';
    },
    inTextForms: function (record, styleId, opts) { return inTextForms(harden(record.authors ? record : normalize(record)), styleId, opts); },
    matchConfidence: matchConfidence,
    STYLES: STYLES,
    EXPORTS: EXPORTS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AutoDOI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
