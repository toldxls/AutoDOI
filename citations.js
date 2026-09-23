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

  /* ---------- helpers ---------- */

  function extractDoi(text) {
    if (!text) return null;
    var m = String(text).match(DOI_RE);
    if (!m) return null;
    var doi = m[0].replace(/[.,;:]+$/, '').replace(/[<>]+$/, '');
    // drop a trailing ")" or "]" only if it is unbalanced
    while (/[)\]]$/.test(doi)) {
      var open = (doi.match(/[(\[]/g) || []).length;
      var close = (doi.match(/[)\]]/g) || []).length;
      if (close > open) doi = doi.slice(0, -1); else break;
    }
    return doi;
  }

  // A DOI, or an arXiv identifier mapped to its DataCite DOI (arXiv:2301.01234 -> 10.48550/arXiv.2301.01234)
  function toDoi(text) {
    var doi = extractDoi(text);
    if (doi) return doi;
    var t = String(text || '').trim();
    var m = t.match(/(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i)
      || t.match(/^(\d{4}\.\d{4,5})(?:v\d+)?$/);
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
      while (toks.length > 1 && NAME_PARTICLE.test(toks[toks.length - 1])) fam.unshift(toks.pop());
      out = { family: fam.join(' '), given: toks.join(' ') };
    }
    if (suffix) out.suffix = suffix;
    return out;
  }

  // OpenAlex work -> Crossref-message-like object for normalize()
  function fromOpenAlex(w) {
    var loc = w.primary_location || (w.locations && w.locations[0]) || {};
    var src = loc.source || {};
    var typeMap = { article: src.type === 'journal' || !src.type ? 'journal-article' : 'journal-article', preprint: 'posted-content', 'book-chapter': 'book-chapter',
      book: 'book', dissertation: 'dissertation', dataset: 'dataset', report: 'report', 'paratext': 'other', 'peer-review': 'other', 'reference-entry': 'book-chapter' };
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
      source: 'openalex'
    };
    if (type === 'posted-content' && src.display_name) { m.institution = [{ name: src.display_name }]; m['container-title'] = []; }
    return m;
  }

  // Open Library search.json doc -> Crossref-message-like book object
  function fromOpenLibrary(doc, isbn) {
    var year = doc.first_publish_year || (doc.publish_year && Math.min.apply(null, doc.publish_year)) || '';
    return {
      type: 'book',
      title: [doc.title + (doc.subtitle ? ': ' + doc.subtitle : '')],
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
    s = s.replace(/&amp;(?=(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z]+);)/g, '&');     // double-encoded "&amp;delta;"
    return s.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z]+);/g, function (all, e) {
      if (e.charAt(0) !== '#') return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : all;
      var n = /^#[xX]/.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!(n > 0) || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF) || (n >= 0xE000 && n <= 0xE006)) return '';
      if (n > 0xFFFF) { n -= 0x10000; return String.fromCharCode(0xD800 + (n >> 10), 0xDC00 + (n & 0x3FF)); }
      return String.fromCharCode(n);
    });
  }
  // Tags removed, entities decoded, whitespace collapsed; private-use formatting markers removed unless keepMarks
  function cleanText(s, keepMarks) {
    if (s === undefined || s === null) return '';
    var t = decodeEntities(String(s).replace(/<[^>]+>/g, ''));
    if (!keepMarks) t = t.replace(PUA_RE, '');
    return t.replace(/\s+/g, ' ').trim();
  }
  function clean(s) { return cleanText(s, false); }

  // Library-catalogue records (BHL, MARC) leave trailing " :", " ,", " ;" on places and publishers
  function trimPunct(s) { return String(s || '').replace(/[\s,:;\/]+$/, '').trim(); }

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
      .replace(/<[^>]+>/g, '')
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
  function formulaTokens(s) {
    var toks = [], i = 0, depth = 0, m, last;
    while (i < s.length) {
      var rest = s.slice(i);
      last = toks[toks.length - 1];
      if ((m = rest.match(/^[A-Z][a-z]?/))) {
        var sym = m[0];
        if (!ELEM[sym]) { if (sym.length === 2 && ELEM[sym.charAt(0)]) sym = sym.charAt(0); else return null; }
        toks.push({ t: 'el', v: sym }); i += sym.length; continue;
      }
      // "Fe3+2(H2O)4", "Fe2+3Al2Si3O12": a metal's oxidation state written inside the formula, always followed by a count or bracket
      if (last && last.t === 'el' && (last.v.length === 2 || /^[VUWYK]$/.test(last.v)) && (m = rest.match(/^(\d[+\u2212])(?=\d|[(\[])/))) {
        toks.push({ t: 'ox', v: m[1] }); i += m[1].length; continue;
      }
      if ((m = rest.match(/^\d+(?:\.\d+)?/))) {
        if (!last || (last.t !== 'el' && last.t !== 'close' && last.t !== 'ox')) return null;
        toks.push({ t: 'n', v: m[0] }); i += m[0].length; continue;
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
    var elems = 0, groups = 0, two = false, paren = false, str = '';
    for (var i = 0; i < toks.length; i++) {
      var k = toks[i];
      if (k.t === 'el') {
        elems++; if (k.v.length === 2) two = true;
        if (i >= 2 && toks[i - 1].t === 'n' && toks[i - 2].t === 'el' && toks[i - 2].v === k.v) return false; // C2C12, B2B
      } else if (k.t === 'n') {
        groups++;
        if (k.v === '1' || (k.v.indexOf('.') === -1 && Number(k.v) >= 100)) return false; // formulas never write 1; 9001 is not a count
      } else if (k.t === 'open') paren = true;
      else if (k.t === 'ox') { paren = true; continue; }           // an explicit oxidation state is unmistakably chemistry
      str += k.t === 'comma' ? ',' : k.v;
    }
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
    var iso = isotope(p) || (greek && !cn ? isotopeQualified(p) : null);
    if (iso) return coef + pre + iso;
    var f = parseFormula(p, loose);
    if (f) return coef + pre + f;
    return cn && /^[A-Z]/.test(p) ? coef + pre + p : null;
  }

  function countOf(x, re) { return (x.match(re) || []).length; }
  // A piece left by splitting a word: strips brackets that belong to the neighbours ("(H2O", "CO2)") and
  // trailing labels such as "(i)" or a crystal face "(110)" before trying it as a formula
  function convertPiece(piece, allowCoef, loose) {
    var lead = '', trail = '', core = piece;
    while (/^[(\[]/.test(core) && countOf(core, /[(\[]/g) > countOf(core, /[)\]]/g)) { lead += core.charAt(0); core = core.slice(1); }
    var tr;
    while ((tr = core.match(/[)\]][a-z]{0,3}$/)) && countOf(core, /[)\]]/g) > countOf(core, /[(\[]/g)) { trail = tr[0] + trail; core = core.slice(0, -tr[0].length); } // "86Sr)i"
    var lab = core.match(/^(.+?)(\((?:[a-z]{1,4}|\d{1,4})\))$/);
    if (lab) { core = lab[1]; trail = lab[2] + trail; }
    var r = formulaPiece(core, allowCoef, loose);
    return r === null ? null : lead + r + trail;
  }

  function formulaWord(w) {
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
      return h.split(/(-(?=[A-Za-z]|\d{1,3}m?[A-Z]))/).map(function (piece, i) { return i % 2 ? piece : conv(piece, allowCoef, loose); }).join('');
    };
    var hydrate = function (x) {                           // CaSO4·0.5H2O, ·nH2O
      var parts = x.split(/([·•⋅])/), loose = parts.length > 1;
      return parts.map(function (h, i) { return i % 2 ? h : hyphens(h, i > 0, loose); }).join('');
    };
    var plus = function (x) {                              // H2O+CO2, Fe3++Fe2+ (only when every side is a formula)
      var parts = x.split(/(\+(?=[A-Z(\[]))/);
      if (parts.length > 1) {
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
    var out = core.split(/([\/–—@])/).map(function (part, i) { return i % 2 ? part : plus(part); }).join('');
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

  function autoFormulas(s) {
    if (!s) return s;
    // "(Mg, Fe)SiO3": keep the element list together while splitting words
    s = s.replace(/\((?:[A-Z][a-z]?,\s+)+[A-Z][a-z]?\)/g, function (g) { return g.replace(/,\s+/g, ',' + KEEP_SP); });
    var words = s.split(/(\s+)/);
    for (var i = 0; i < words.length; i += 2) {
      var w = words[i];
      if (!w || HAS_MARK.test(w)) continue;
      var sm = w.match(/^(.*[A-Za-z0-9)\]+−])([-+])([,;:)\]}"'”’]*)$/);
      if (sm && signIsJoiner(sm[1], sm[2], sm[3], words, i)) {
        var fj = formulaWord(sm[1]);
        words[i] = (fj === null ? sm[1] : fj) + sm[2] + sm[3];
        continue;
      }
      var f = formulaWord(w);
      if (f !== null) words[i] = f;
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
    var OPEN = { '': '', '': '', '': '' }, stack = [], drop = {}, i, c, k;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      if (OPEN[c]) {
        var nested = false;
        for (k = 0; k < stack.length; k++) if (!stack[k].dropped && stack[k].c === c) nested = true; // <sub> inside <sub>
        stack.push({ c: c, i: i, dropped: nested });
        if (nested) drop[i] = true;
      } else if (c === '' || c === '' || c === '') {
        var top = stack[stack.length - 1];
        if (top && OPEN[top.c] === c) { stack.pop(); if (top.dropped) drop[i] = true; } else drop[i] = true;
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
  function markup(html) {
    if (html === undefined || html === null) return '';
    var s = String(html).replace(PUA_RE, '');                   // user text cannot inject markers
    if (/<(?:mml:)?math\b/.test(s)) s = mathmlToMarks(s);
    // JATS line breaks around scripts: "MgSiO\n  <sub>3</sub>" -> MgSiO₃, "on\n  <sup>23</sup>\n  Na" -> on ²³Na
    s = s.replace(/\s*\n\s*(<(?:sub|inf)\b[^>]*>)/gi, '$1')
      .replace(/(\s*\n\s*)?(<sup\b[^>]*>)([^<]*)(<\/sup>)(\s*\n\s*)?/gi, function (all, before, open, body, close, after, at, str) {
        if (!before && !after) return all;
        var next = str.slice(at + all.length), el = next.match(/^[A-Z][a-z]?(?![a-z])/);
        if (/^\s*\d{1,3}m?\s*$/.test(body) && el && ELEM[el[0]]) return (before ? ' ' : '') + open + body + close; // prescript isotope
        return open + body + close + (after ? ' ' : '');
      });
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

  var SUB_MAP = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', '.': '.', ',': ',', ' ': ' ' };
  var SUP_MAP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', '[': '[', ']': ']', 'n': 'ⁿ', 'i': 'ⁱ', 'm': 'ᵐ' };
  // Characters with a Unicode sub/superscript form are converted; anything else stays as written (P<sub>CO2</sub> -> PCO₂)
  function unicodeScript(text, map) {
    return text.split('').map(function (c) { return map[c] !== undefined ? map[c] : c; }).join('');
  }
  function marksToText(s) {
    return String(s).replace(/([^]*)/g, function (a, t) { return unicodeScript(t, SUB_MAP); })
      .replace(/([^]*)/g, function (a, t) { return unicodeScript(t, SUP_MAP); })
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
  function person(p) {
    var fam = clean(p.family);
    if (fam) {
      var given = clean(p.given);
      if (given && (/^The\s/.test(given) || ORG_FAMILY.test(fam))) return { family: given + ' ' + fam, given: '', suffix: '', literal: true };
      // "SMITH, JOHN" deposited in capitals: title-case the given name too, but leave initials ("J.D.", "PC") alone
      if (isCaps(fam) && isCaps(given)) {
        given = given.split(/\s+/).map(function (tok) {
          if (/\./.test(tok)) return tok;                       // "J.D."
          if (/^[A-Z]{1,3}$/.test(tok) && !/[AEIOUY]/.test(tok)) return tok; // "PC", "JD"
          return uncaps(tok);                                   // "IAN", "JOHN"
        }).join(' ');
      }
      return { family: uncaps(fam), given: given, suffix: clean(p.suffix || ''), literal: false };
    }
    var name = clean(p.name || p.literal || p.given || '');
    return { family: name, given: '', suffix: '', literal: true };
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var MONTHS_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.',
    'Sep.', 'Oct.', 'Nov.', 'Dec.'];
  var MONTHS_IEEE = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.',
    'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  var ORDINAL_WORDS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

  /* ---------- normalize ---------- */

  function relDoi(rel, key) {
    var list = rel && rel[key];
    if (!Array.isArray(list)) return '';
    for (var i = 0; i < list.length; i++) if (list[i] && list[i]['id-type'] === 'doi' && list[i].id) return String(list[i].id);
    return '';
  }

  // Month 1..12 and day 1..31 or 0; seasons (21-24), typos and junk are dropped
  function validMonth(v) { var n = Number(v); return n >= 1 && n <= 12 && Math.floor(n) === n ? n : 0; }
  function validDay(v) { var n = Number(v); return n >= 1 && n <= 31 && Math.floor(n) === n ? n : 0; }
  function monthName(list, m) { return m >= 1 && m <= 12 ? list[m - 1] : ''; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function normalize(m) {
    var dp = datePartsOf(m);
    var type = m.type || 'other';
    var page = clean(m.page || '');
    var isPart = /chapter|section|book-part|proceedings-article|paper-conference/.test(type);
    // Crossref lists a chapter's series first and the book last: ["Use R!", "ggplot2"]
    var ct = m['container-title'];
    var containers = Array.isArray(ct) ? ct.filter(Boolean) : (ct ? [ct] : []);
    var container = isPart && containers.length > 1 ? containers[containers.length - 1] : containers[0];
    var series = isPart && containers.length > 1 ? containers[0] : first(m['collection-title'] || m.series || '');
    var inst = m.institution;
    var acc = m.accessed && m.accessed['date-parts'] && m.accessed['date-parts'][0];
    var accMonth = validMonth(acc && acc[1]);
    var month = validMonth(dp[1]);
    var tm = trimPunct(markup(first(m.title)));
    var r = {
      type: type,
      doi: m.DOI || m.doi || '',
      url: m.URL || (m.DOI ? 'https://doi.org/' + m.DOI : ''),
      title: trimPunct(stripMarks(tm)),
      titleMarked: tm,
      subtitle: stripMarks(markup(first(m.subtitle))),
      container: trimPunct(clean(container)),
      series: trimPunct(clean(series)),
      shortContainer: clean(first(m['short-container-title'])),
      institution: clean(Array.isArray(inst) ? (inst[0] && inst[0].name) : (inst && inst.name) || inst || ''),
      edition: clean(m.edition || m['edition-number'] || ''),
      numPages: clean(m['number-of-pages'] || ''),
      genre: clean(m.genre || first(m.degree) || ''),
      accessed: acc ? { year: acc[0], month: accMonth, day: accMonth ? validDay(acc[2]) : 0 } : null,
      authors: (m.author || []).map(person),
      authorsOthers: !!m['author-others'], // BibTeX "and others": the list was truncated at the source
      editors: (m.editor || []).map(person),
      year: dp[0] ? String(dp[0]) : '',
      years: ['issued', 'published-print', 'published-online', 'published'].map(function (k) { var d = m[k] && m[k]['date-parts'] && m[k]['date-parts'][0]; return d && d[0] ? String(d[0]) : ''; })
        .filter(function (y, i, a) { return y && a.indexOf(y) === i; }), // print and online years can differ; references may cite either
      month: month,
      day: month ? validDay(dp[2]) : 0,
      volume: clean(m.volume || ''),
      issue: clean(m.issue || ''),
      pages: page,
      articleNumber: clean(m['article-number'] || ''),
      publisher: trimPunct(clean(m.publisher || '')),
      place: trimPunct(clean(m['publisher-location'] || m['publisher-place'] || '')),
      issn: clean(first(m.ISSN) || ''),
      isbn: clean(first(m.ISBN) || ''),
      abstract: cleanAbstract(m.abstract || ''),
      language: clean(m.language || ''),
      event: clean((m.event && m.event.name) || ''),
      publishedDoi: relDoi(m.relation, 'is-preprint-of'),
      preprintDoi: relDoi(m.relation, 'has-preprint'),
      source: m.source || 'crossref',
      score: m.score
    };
    if (r.subtitle && r.title && r.title.indexOf(r.subtitle) === -1) {
      r.title = r.title + ': ' + r.subtitle;
      r.titleMarked = r.titleMarked + ': ' + markup(first(m.subtitle));
    }
    if (!HAS_MARK.test(r.titleMarked) || stripMarks(r.titleMarked) !== r.title) delete r.titleMarked; // only keep real markup
    r.isArticleNumber = false;
    if (r.articleNumber && (!r.pages || r.pages === r.articleNumber)) { r.pages = r.articleNumber; r.isArticleNumber = true; }
    if (r.pages && /^e\d+$/i.test(r.pages)) r.isArticleNumber = true;
    return r;
  }

  function kind(r) {
    var t = r.type;
    if (t === 'journal-article' || (!t && r.container)) return 'journal';
    if (t === 'book-chapter' || t === 'book-section' || t === 'book-part' || t === 'chapter') return 'chapter';
    if (t === 'book' || t === 'monograph' || t === 'edited-book' || t === 'reference-book') return 'book';
    if (t === 'proceedings-article' || t === 'paper-conference') return 'proceedings';
    if (t === 'posted-content' || t === 'preprint' || t === 'article') return 'preprint';
    if (t === 'dataset') return 'dataset';
    if (t === 'software') return 'software';
    if (t === 'dissertation' || t === 'thesis') return 'thesis';
    if (t === 'report') return 'report';
    if (r.container && r.volume) return 'journal';
    return 'generic';
  }

  /* ---------- names ---------- */

  function initials(given, opts) {
    opts = opts || {};
    if (!given) return '';
    // "J.-P." stays one token; "P.C." becomes two
    var tokens = given.replace(/\.(?![\-\u2010\u2011])/g, '. ').split(/\s+/).filter(Boolean);
    var out = [];
    tokens.forEach(function (tok) {
      tok = tok.replace(/\.+$/, '').replace(/^[\-\u2010\u2011]+|[\-\u2010\u2011]+$/g, '');
      if (!tok) return;
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
  function nameVancouver(p) { // "Kucsko G"
    if (p.literal) return p.family;
    var ini = initials(p.given, { dots: false });
    return p.family + (ini ? ' ' + ini : '');
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

  function doiLink(r) { return r.doi ? 'https://doi.org/' + r.doi : r.url; }
  function endsPunct(s) { return /[.?!][\uE000-\uE005]*$/.test(s); }
  function dot(s) { return s ? (endsPunct(s) ? s : s + '.') : ''; }
  function I(s) { return s ? '<i>' + esc(s, true) + '</i>' : ''; }
  function Idot(s) { return s ? I(s) + (endsPunct(s) ? '' : '.') : ''; } // italic title, no ".?." doubling
  function T(s) { return esc(s); }
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
    var year = '(' + (r.year || 'n.d.') + ').';
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
      var inPart = r.container ? 'In ' + (eds.length ? T(joinAnd(eds, '&', true)) + ' (' + (eds.length > 1 ? 'Eds.' : 'Ed.') + '), ' : '') +
        I(r.container) + (r.pages ? ' (' + T(pp(r.pages)) + ')' : '') + '.' : (r.pages ? T(pp(r.pages)) + '.' : ''); // no book title, no "In ." 
      if (n) out.push(T(dot(names)), year, T(dot(r.title)), inPart);
      else out.push(T(dot(r.title)), year, inPart);
      if (r.publisher) out.push(T(dot(r.publisher)));
    } else if (k === 'book') {
      var ed = r.edition ? ' (' + T(editionLabel(r.edition, 'apa')) + ')' : '';
      if (n) out.push(T(dot(names)), year, I(r.title) + ed + (ed || !endsPunct(r.title) ? '.' : ''));
      else out.push(I(r.title) + ed + (ed || !endsPunct(r.title) ? '.' : ''), year);
      if (r.publisher) out.push(T(dot(r.publisher)));
    } else {
      var label = { preprint: 'Preprint', dataset: 'Data set', software: 'Computer software', report: 'Report' }[k];
      var host = hostOf(r);
      if (k === 'thesis') {
        var deg = /m\.?\s?[as]\.?|master/i.test(r.genre) ? "Master's thesis" : 'Doctoral dissertation';
        label = T(deg + (host ? ', ' + host : '')); host = '';
      }
      var titlePart = I(r.title) + (label ? ' [' + label + ']' : '') + (label || !endsPunct(r.title) ? '.' : '');
      if (n) out.push(T(dot(names)), year, titlePart);
      else out.push(titlePart, year);
      if (host) out.push(T(dot(host)));
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
    if (!names && r.editors.length) { // edited book: "Ed, Alan, editor." / "Ed, Alan, and Beth Ed, editors."
      var ne = r.editors.length;
      names = (ne === 1 ? nameLastFull(r.editors[0]) : ne === 2 ? nameLastFull(r.editors[0]) + ', and ' + nameFullFirst(r.editors[1]) : nameLastFull(r.editors[0]) + ', et al') + (ne > 1 ? ', editors' : ', editor');
    }
    var out = [];
    if (names) out.push(T(dot(names)));
    var quoted = '“' + T(dot(r.title)) + '”';
    var link = doiLink(r);
    var contParts = [];
    if (k === 'book') {
      out.push(Idot(r.title));
      if (r.publisher) contParts.push(T(r.publisher));
      if (r.year) contParts.push(T(r.year));
    } else {
      out.push(quoted);
      if (r.container) contParts.push(I(r.container));
      else if (k !== 'journal' && hostOf(r)) contParts.push(T(hostOf(r)));
      if ((k === 'chapter' || k === 'proceedings') && r.editors.length) {
        contParts.push('edited by ' + T(r.editors.length > 2 ? nameFullFirst(r.editors[0]) + ' et al.' : joinAnd(r.editors.map(nameFullFirst), 'and', false)));
      }
      if (r.volume) contParts.push('vol. ' + T(r.volume));
      if (r.issue) contParts.push('no. ' + T(r.issue));
      if (showPublisher(r, k)) contParts.push(T(r.publisher));
      if (r.year) contParts.push(T(r.year));
      if (r.pages) contParts.push(T(pp(r.pages)));
    }
    if (link) contParts.push(T(link));
    if (contParts.length) out.push(contParts.join(', ') + '.');
    return out.join(' ');
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
      s += r.year ? ' (' + T(r.year) + ')' : '';
      if (r.pages) s += ': ' + T(pageRange(r.pages));
      s = s.replace(/^[\s,]+/, '');
      if (s) out.push(s + '.');
    } else if (k === 'book') {
      out.push(Idot(r.title + (r.edition ? '. ' + editionLabel(r.edition, 'apa').replace(/\.$/, '') : '')));
      var pub = [r.place, r.publisher].filter(Boolean).join(': ');
      out.push(T(dot([pub, r.year].filter(Boolean).join(', '))));
    } else if (k === 'chapter' || k === 'proceedings') {
      out.push('“' + T(dot(r.title)) + '”');
      var inp = r.container ? 'In ' + I(r.container) : '';
      if (r.editors.length) inp += (inp ? ', edited by ' : 'Edited by ') + T(joinAnd(r.editors.map(nameFullFirst), 'and', r.editors.length > 2));
      if (r.pages) inp += (inp ? ', ' : '') + T(pageRange(r.pages));
      if (inp) out.push(inp + '.');
      var pub2 = [r.place, r.publisher].filter(Boolean).join(': ');
      out.push(T(dot([pub2, r.year].filter(Boolean).join(', '))));
    } else {
      out.push('“' + T(dot(r.title)) + '”');
      var host = [hostOf(r), r.year].filter(Boolean).join(', ');
      if (host) out.push(T(dot(host)));
    }
    if (link) out.push(T(link) + '.');
    return out.join(' ');
  }

  function harvard(r) {
    var k = kind(r);
    var n = r.authors.length;
    var hn = function (p) { return p.literal ? p.family : p.family + (p.given ? ', ' + initials(p.given, { space: false }) : ''); };
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
      out.push(Idot(r.title + (r.edition ? '. ' + editionLabel(r.edition, 'apa').replace(/\.$/, '') : '')));
      if (placePub) out.push(T(dot(placePub)));
    } else if (k === 'chapter' || k === 'proceedings') {
      // Cite Them Right: 'Title', in Editor, A. and Editor, B. (eds.) Book. Place: Publisher, pp. x–y.
      if (r.container) {
        var inb = 'in ' + (r.editors.length ? T(hlist(r.editors)) + (r.editors.length > 1 ? ' (eds.) ' : ' (ed.) ') : '') + I(r.container) + '.';
        out.push('‘' + T(r.title) + '’, ' + inb);
      } else out.push('‘' + T(r.title) + '’.');
      var tail = [placePub, r.pages ? T(pp(r.pages)) : ''].filter(Boolean).join(', ');
      if (tail) out.push(T(tail) + '.');
    } else {
      var parts = ['‘' + T(r.title) + '’'];
      if (r.container) parts.push(I(r.container));
      else if (k !== 'journal' && hostOf(r)) parts.push(T(hostOf(r)));
      if (r.volume || r.issue) parts.push(T(r.volume) + (r.issue ? '(' + T(r.issue) + ')' : ''));
      if (showPublisher(r, k)) parts.push(T(r.publisher));
      if (r.pages) parts.push(T(pp(r.pages)));
      out.push(parts.join(', ') + '.');
    }
    if (link) out.push('Available at: ' + T(link) + '.');
    return out.join(' ');
  }

  function vancouver(r, num) {
    var k = kind(r);
    var n = r.authors.length;
    var names = others(n > 6 ? r.authors.slice(0, 6).map(nameVancouver).join(', ') + ', et al' : r.authors.map(nameVancouver).join(', '), r, ', et al');
    if (!names && r.editors.length) names = r.editors.map(nameVancouver).join(', ') + (r.editors.length > 1 ? ', editors' : ', editor');
    var out = [];
    if (num) out.push(String(num) + '.');
    if (names) out.push(T(dot(names)));
    out.push(T(dot(r.title)));
    var placePubYear = [r.place, r.publisher].filter(Boolean).join(': ') + (r.year ? '; ' + r.year : '');
    if (k === 'journal') {
      var s = T(dot(r.shortContainer || r.container));
      var tail = (r.year || '') + (r.volume ? ';' + T(r.volume) + (r.issue ? '(' + T(r.issue) + ')' : '') : '') + (r.pages ? ':' + T(nlmPages(r.pages)) : '');
      if (tail) s += ' ' + tail.replace(/^;/, '');
      out.push(s + (endsPunct(s) && !tail ? '' : '.'));
    } else if (k === 'book') {
      if (r.edition) out.push(T(editionLabel(r.edition, 'apa')));
      if (placePubYear) out.push(T(dot(placePubYear)));
    } else if (k === 'chapter' || k === 'proceedings') {
      // Citing Medicine: In: Editor A, Editor B, editors. Book. Place: Publisher; year. p. 10-20.
      var edsV = r.editors.length ? r.editors.map(nameVancouver).join(', ') + (r.editors.length > 1 ? ', editors. ' : ', editor. ') : '';
      if (r.container) out.push('In: ' + T(edsV) + T(dot(r.container)));
      if (placePubYear) out.push(T(dot(placePubYear)));
      if (r.pages) out.push('p. ' + T(nlmPages(r.pages)) + '.');
    } else {
      var host = hostOf(r);
      var tailG = [host ? dot(host).replace(/\.$/, '') : '', r.year].filter(Boolean).join('; ');
      if (tailG) out.push(T(dot(tailG)));
    }
    if (r.doi) out.push('doi:' + T(r.doi));
    return out.join(' ');
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
      out.push(I(r.title) + (r.edition ? ', ' + T(editionLabel(r.edition, 'apa')) : (endsPunct(r.title) ? '' : '.')));
      out.push(T([placePub, r.year].filter(Boolean).join(', ')) + (r.doi ? ', doi: ' + T(r.doi) + '.' : '.'));
    } else if (k === 'chapter' || k === 'proceedings') {
      // “Title,” in Book, A. Ed and B. Ed, Eds. City: Publisher, year, pp. x–y, doi: …
      var edsI = r.editors.length ? ', ' + T(joinAnd(r.editors.map(nameInitFirst), 'and', r.editors.length > 2)) + (r.editors.length > 1 ? ', Eds.' : ', Ed.') : '';
      if (!r.container) edsI = '';
      var head = '“' + T(r.title) + ',”' + (r.container ? ' in ' + I(r.container) + edsI : '');
      var restC = [];
      if (r.year) restC.push(mon + T(r.year));
      if (r.pages) restC.push(T(pp(r.pages)));
      if (r.doi) restC.push('doi: ' + T(r.doi));
      var tailC = T(placePub) + (placePub && restC.length ? ', ' : '') + restC.join(', ');
      out.push(r.container ? head + (edsI ? ' ' : '. ') + tailC + '.' : head + (tailC ? ' ' + tailC + '.' : ''));
    } else {
      var parts = ['“' + T(r.title) + ',”'];
      var rest = [];
      if (r.container) rest.push(I(r.container));
      else if (k !== 'journal' && hostOf(r)) rest.push(T(hostOf(r)));
      if (r.volume) rest.push('vol. ' + T(r.volume));
      if (r.issue) rest.push('no. ' + T(r.issue));
      if (r.pages) rest.push(r.isArticleNumber ? 'Art. no. ' + T(r.pages) : T(pp(r.pages)));
      if (showPublisher(r, k)) rest.push(T(r.publisher));
      if (r.year) rest.push(mon + T(r.year));
      if (r.doi) rest.push('doi: ' + T(r.doi));
      out.push(parts.join(' ') + (rest.length ? ' ' + rest.join(', ') : '') + '.');
    }
    if (!r.doi && link) out.push('[Online]. Available: ' + T(link));
    return out.join(' ');
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
      out.push(T(dot(r.title)));
      var s = T(r.container);
      if (r.volume) s += ', ' + T(r.volume) + (r.issue ? '(' + T(r.issue) + ')' : '');
      if (pages) s += (r.volume ? ':' : ', ') + T(pages);
      out.push(s + '.');
    } else if (k === 'book') {
      // Samways, M.J. 1994. Insect Conservation Biology. Chapman and Hall, London. 380 pp.
      // Ostle, B., and R.W. Mensing. 1975. Statistics in Research, Third Edition. Iowa State University Press, Ames, Iowa.
      out.push(T(dot(r.title + (r.edition ? ', ' + editionLabel(r.edition, 'carnegie') : ''))));
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
      var degree = r.genre ? (/thesis|dissertation/i.test(r.genre) ? r.genre : r.genre + ' Thesis') : 'Ph.D. Dissertation';
      out.push(T(dot(['Unpublished ' + degree, r.publisher || r.institution, r.place].filter(Boolean).join(', '))));
    } else if (k === 'preprint') {
      out.push(T(dot(r.title)));
      var repo = hostOf(r);
      if (repo) out.push(T(repo) + ' preprint.');
      if (r.doi || r.url) out.push('Available from ' + T(doiLink(r)));
    } else { // dataset, software, report, web resource: Title [cited 16 July 2008]. Available from URL
      var host = hostOf(r);
      var when = r.accessed || (function () { var d = new Date(); return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }; })();
      var whenMonth = monthName(MONTHS, when.month);
      out.push(T(r.title) + ' [cited ' + (whenMonth && validDay(when.day) ? when.day + ' ' : '') + (whenMonth ? whenMonth + ' ' : '') + when.year + '].');
      if (host) out.push(T(dot(host)));
      if (r.doi || r.url) out.push('Available from ' + T(doiLink(r)));
    }
    return out.join(' ');
  }

  // In-text form for the Carnegie style: (Wible 2000), (Wible and Rawlins 2001), (Wible et al. 2002)
  function carnegieInText(r) {
    var fam = r.authors.map(function (p) { return p.family; });
    var who = fam.length === 0 ? (r.container || 'Anon.') : fam.length === 1 ? fam[0] : fam.length === 2 ? fam[0] + ' and ' + fam[1] : fam[0] + ' et al.';
    return '(' + who + ' ' + (r.year || 'n.d.') + ')';
  }

  /* ---------- machine formats (plain text) ---------- */

  function bibKey(r) {
    var fam = (r.authors.length ? r.authors[0].family : (r.container || '')).replace(/[^A-Za-z0-9]/g, '') || 'ref';
    var word = (r.title.match(/[A-Za-z]{3,}/g) || []).filter(function (w) {
      return !/^(the|and|for|with|from|into|over|under|that|this|are|was|were|its|our|their)$/i.test(w);
    })[0] || '';
    return fam + (r.year || '') + word.replace(/[^A-Za-z0-9]/g, '');
  }
  var BIB_ESC = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
    '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_' };
  function bibEsc(s) { return String(s).replace(/[\\{}~^&%$#_]/g, function (c) { return BIB_ESC[c]; }); }
  // braces keep "World Health Organization" as one name; escaped first so the braces survive
  function bibName(p) { return p.literal ? '{' + bibEsc(p.family) + '}' : bibEsc(nameLastFull(p)); }

  function bibtex(r) {
    var k = kind(r);
    var type = { journal: 'article', chapter: 'incollection', book: 'book', proceedings: 'inproceedings',
      thesis: 'phdthesis', report: 'techreport' }[k] || 'misc';
    var f = [];
    var add = function (key, val, raw) { if (val) f.push('  ' + key + ' = ' + (raw === 'bare' ? val : '{' + (raw ? val : bibEsc(val)) + '}')); };
    f.push('  title = {' + marksToLatex(bibEsc(r.title)) + '}');
    add('author', r.authors.map(bibName).join(' and '), true);
    add('editor', r.editors.map(bibName).join(' and '), true);
    if (k === 'journal') add('journal', r.container);
    else if (k === 'chapter' || k === 'proceedings') add('booktitle', r.container);
    else if (r.container) add('howpublished', r.container);
    add('series', r.series);
    add('edition', r.edition);
    add('volume', r.volume);
    add('number', r.issue);
    add('pages', r.pages ? enDash(r.pages).replace('–', '--') : '');
    add('year', r.year);
    if (monthName(MONTHS_ABBR, r.month)) add('month', monthName(MONTHS_ABBR, r.month).replace('.', '').toLowerCase(), 'bare');
    if (k === 'thesis') add('school', r.publisher || r.institution);
    else if (k === 'report') add('institution', r.publisher || r.institution);
    else add('publisher', r.publisher);
    add('address', r.place);
    add('issn', r.issn, true);
    add('isbn', r.isbn, true);
    add('doi', r.doi, true);
    add('url', doiLink(r), true);
    if (k === 'preprint') add('note', 'Preprint');
    if (k === 'dataset') add('note', 'Dataset');
    if (k === 'software') add('note', 'Software');
    return '@' + type + '{' + bibKey(r) + ',\n' + f.join(',\n') + '\n}';
  }

  function ris(r) {
    var k = kind(r);
    var type = { journal: 'JOUR', chapter: 'CHAP', book: 'BOOK', proceedings: 'CONF', preprint: 'UNPB',
      dataset: 'DATA', software: 'COMP', thesis: 'THES', report: 'RPRT' }[k] || 'GEN';
    var L = [];
    var add = function (tag, val) { if (val) L.push(tag + '  - ' + val); };
    add('TY', type);
    var risName = function (p) { return p.literal ? p.family + ',' : nameLastFull(p); }; // trailing comma = single-field name
    r.authors.forEach(function (p) { add('AU', risName(p)); });
    r.editors.forEach(function (p) { add('ED', risName(p)); });
    add('TI', marksToText(r.title));
    add('T2', r.container);
    add('T3', r.series);
    add('ET', r.edition);
    if (r.shortContainer && r.shortContainer !== r.container) add('JO', r.shortContainer);
    add('VL', r.volume);
    add('IS', r.issue);
    var pm = r.pages.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (pm) { add('SP', pm[1]); add('EP', pm[2]); } else add('SP', r.pages);
    add('PY', r.year);
    var dm = validMonth(r.month);
    if (r.year) add('DA', r.year + '/' + (dm ? pad2(dm) : '') + '/' + (dm && validDay(r.day) ? pad2(r.day) : '') + '/');
    add('PB', r.publisher);
    add('CY', r.place);
    add('SN', r.issn || r.isbn);
    add('DO', r.doi);
    add('UR', doiLink(r));
    add('LA', r.language);
    add('AB', r.abstract);
    L.push('ER  - ');
    return L.join('\r\n') + '\r\n';
  }

  function endnote(r) {
    var k = kind(r);
    var type = { journal: 'Journal Article', chapter: 'Book Section', book: 'Book', proceedings: 'Conference Paper',
      preprint: 'Unpublished Work', dataset: 'Dataset', software: 'Computer Program', thesis: 'Thesis', report: 'Report' }[k] || 'Generic';
    var L = [];
    var add = function (tag, val) { if (val) L.push(tag + ' ' + val); };
    add('%0', type);
    var enName = function (p) { return p.literal ? p.family + ',' : nameLastFull(p); };
    r.authors.forEach(function (p) { add('%A', enName(p)); });
    r.editors.forEach(function (p) { add('%E', enName(p)); });
    add('%T', marksToText(r.title));
    if (k === 'journal') add('%J', r.container);
    else add('%B', r.container);
    add('%S', r.series);
    add('%7', r.edition);
    add('%V', r.volume);
    add('%N', r.issue);
    add('%P', r.pages ? enDash(r.pages).replace('–', '-') : '');
    add('%D', r.year);
    if (monthName(MONTHS, r.month)) add('%8', monthName(MONTHS, r.month) + (validDay(r.day) ? ' ' + r.day : ''));
    add('%I', r.publisher);
    add('%C', r.place);
    add('%@', r.issn || r.isbn);
    add('%R', r.doi);
    add('%U', doiLink(r));
    add('%G', r.language);
    add('%X', r.abstract);
    return L.join('\n') + '\n';
  }

  /* ---------- registry ---------- */

  var STYLES = [
    { id: 'apa', label: 'APA 7th', fn: apa, rich: true },
    { id: 'mla', label: 'MLA 9th', fn: mla, rich: true },
    { id: 'chicago', label: 'Chicago 17th', fn: chicago, rich: true },
    { id: 'harvard', label: 'Harvard', fn: harvard, rich: true },
    { id: 'vancouver', label: 'Vancouver', fn: vancouver, rich: true },
    { id: 'ieee', label: 'IEEE', fn: ieee, rich: true },
    { id: 'carnegie', label: 'Annals of Carnegie Museum', fn: carnegie, rich: true, inText: carnegieInText }
  ];
  var EXPORTS = [
    { id: 'bibtex', label: 'BibTeX', fn: bibtex, ext: 'bib' },
    { id: 'ris', label: 'RIS', fn: ris, ext: 'ris' },
    { id: 'endnote', label: 'EndNote tagged', fn: endnote, ext: 'enw' }
  ];

  function format(record, styleId, num) {
    var r = withDisplayTitle(record.authors ? record : normalize(record));
    var all = STYLES.concat(EXPORTS);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === styleId) {
        var out = all[i].fn(r, num);
        return all[i].rich ? stripTags(out) : out;
      }
    }
    throw new Error('Unknown style: ' + styleId);
  }

  function formatHtml(record, styleId, num) {
    var r = withDisplayTitle(record.authors ? record : normalize(record));
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === styleId) return STYLES[i].fn(r, num);
    throw new Error('Unknown text style: ' + styleId);
  }

  /* ---------- matching confidence ---------- */

  function tokens(s) {
    return stripMarks(clean(s)).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(function (w) { return w.length >= 3; });
  }

  // How well does a found record explain the reference text the user pasted? 0..1
  function matchConfidence(refText, record, opts) {
    opts = opts || {};
    var r = record.authors ? record : normalize(record);
    var hay = ' ' + tokens(refText).join(' ') + ' ';
    var tt = tokens(r.title);
    if (!tt.length) return 0;
    var hit = tt.filter(function (w) { return hay.indexOf(' ' + w + ' ') !== -1; }).length;
    var score = hit / tt.length;
    if (opts.titleOnly) return Math.max(0, Math.min(1, score)); // the Find tab has no year or author to check
    var yearsInRef = (String(refText).match(/\b(19|20)\d{2}\b/g) || []);
    if (r.year && yearsInRef.length && yearsInRef.indexOf(r.year) === -1) score -= 0.35; // a different year is a different record
    else if (r.year && hay.indexOf(' ' + r.year + ' ') === -1) score -= 0.15;
    if (r.authors.length) {
      var fam = tokens(r.authors[0].family)[0];
      if (fam && hay.indexOf(' ' + fam + ' ') === -1) score -= 0.15;
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
    options: OPTIONS,
    titleHtml: titleHtml,
    titleText: function (r) { return marksToText(displayTitle(r)); },
    toScript: function (t, kind) { return unicodeScript(String(t), kind === 'sup' ? SUP_MAP : SUB_MAP); },
    autoFormulas: function (s) { return marksToText(autoFormulas(s)); },
    inText: function (record, styleId) {
      var r = record.authors ? record : normalize(record);
      for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === styleId && STYLES[i].inText) return STYLES[i].inText(r);
      return '';
    },
    matchConfidence: matchConfidence,
    STYLES: STYLES,
    EXPORTS: EXPORTS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AutoDOI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
