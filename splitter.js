/*
 * AutoDOI — a pasted reference list cut into references: one per line, per paragraph, per number or bullet, or found
 * automatically, with lines a PDF wrapped joined again and references run together on one line cut apart.
 * Pure functions over text (no DOM, no network), so the page and the command line split alike; ES5 syntax but for two
 * Unicode-property patterns, as the page. Needs citations.js (AutoDOI.translit), loaded first in the page.
 *
 * splitReferences(text, mode) -> [reference]; mode is 'auto' (the default), 'lines', 'blank' or 'numbered'.
 * looksLikeTitle(line) -> { title, journal, year } when a line is only a paper's title (perhaps with its journal and year), else null.
 */
(function (root) {
  'use strict';
  var A = typeof module !== 'undefined' && module.exports ? require('./citations.js') : root.AutoDOI;

  // Lines that are nothing but an identifier are always their own reference
  // A bare number is a PubMed ID only with its prefix: inside a list a line of digits is a page number or a stray footnote, not a lookup
  var ID_LINE = /^((https?:\/\/)?(dx\.)?doi\.org\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+|PMC\d{4,9}|(PMID:?\s*|pubmed(\.ncbi\.nlm\.nih\.gov)?\/)\d{4,9}|arXiv:\s*\S+|\d{4}\.\d{4,5}(v\d+)?|ISBN[\s:\-0-9Xx]+|https?:\/\/\S+)\.?$/i;
  var BARE_NUMBER = /^\d{4,9}\.?$/; // the whole paste: a PubMed ID typed on its own
  var UC = 'A-Z\u00C0-\u00D6\u00D8-\u00DE\u0391-\u03A9\u0400-\u042F', WC = 'A-Za-z\u00C0-\u00FF\u0100-\u017F\u0370-\u03FF\u0400-\u04FF\'\u2019\\-';
  var PARTICLES = '(?:(?:van|von|de|der|den|del|della|da|di|du|la|le|dos|das|ter|ten|zu|mac|st\\.?)\\s+|d[\'\u2019]\\s*)+'; // each particle ends in a space: one way to parse, no backtracking blow-up
  // A line starts a new reference when it is numbered/bulleted, begins with a DOI or URL, or opens like an author name
  var START = new RegExp('^(\\[\\d{1,4}\\]|(?!(?:1[5-9]|20)\\d\\d[.)])\\d{1,4}[.)]|[\u2022\\-\u2013\u2014*\u00B7])\\s|^(https?:\\/\\/|doi:|10\\.\\d{4,9}\\/)|^[\u2014\u2015\u2013_\\-]{2,}[.,]?\\s' + // "———. 2019.": Chicago's "same author again"
    '|^' + PARTICLES + '[' + UC + '][' + WC + ']*,?\\s' +                                  // van der Maaten, L. / de Carvalho, A.
    '|^[' + UC + '][' + WC + ']+,\\s+[' + UC + ']' +                                      // Smith, J.
    '|^[' + UC + '][' + WC + ']+\\s+[' + UC + ']{1,3}[,.]' +                              // Smith JA,
    '|^[' + UC + '][' + WC + ']+\\s+(and|&)\\s');
  var DOI_ANY = /10\.\d{4,9}\/[^\s"'<>]+/g;
  function splitAtDois(chunk) { // two DOIs in one chunk means two references were glued together
    var m, cuts = [], re = new RegExp(DOI_ANY.source, 'g'), last = '', lastEnd = 0;
    while ((m = re.exec(chunk))) { // "doi:10.x/y. Available from: https://…/10.x/y": the same DOI again a few words on is a link to it, not a second reference
      var d = m[0].toLowerCase().replace(/[.,;:)\]]+$/, ''), gap = chunk.slice(lastEnd, m.index);
      if (!(d === last && gap.length < 120 && !/\b(?:1[5-9]|20)\d{2}\b/.test(gap))) cuts.push(re.lastIndex);
      last = d; lastEnd = re.lastIndex;
    }
    if (cuts.length < 2) return [chunk];
    var parts = [], from = 0;
    cuts.slice(0, -1).forEach(function (c) { var rest = chunk.slice(c).match(/^[.,;)\]]*/)[0]; parts.push(chunk.slice(from, c + rest.length)); from = c + rest.length; });
    parts.push(chunk.slice(from));
    return parts.map(function (x) { return x.trim(); }).filter(Boolean);
  }
  // Two references glued into one line, physics style ("Campbell L.J., Physica B 211 (1995) 52; Askenazy S., Physica B 216 (1996) 221.")
  // or simply run together.  A cut is taken only where the left part already reads as a whole reference (a year and
  // a volume, page or identifier) and the right part opens like one (a name, or "ibid.") and has its own year, so
  // semicolons between authors (ACS) or inside "Nature 1995; 375: 123" never split.
  var YEAR_IN = /\b(1[5-9]|20)\d{2}[a-z]?\b/;
  // A real author opening: "Surname, I." or "Surname AB" followed by another author or a year; or "I. Surname" initials first.
  // "Cambridge, MA: Harvard" and "Kandy, Sri Lanka" fail it, so a place after a title never starts a new reference
  var NAME = '(?:' + PARTICLES + ')?[' + UC + '][' + WC + ']+', JOIN = '(?:,?\\s*(?:and|&)\\s+|,\\s*|:?\\s+)', YR = '\\(?(?:1[5-9]|20)\\d{2}', INI = '[' + UC + '][a-z]?\\.'; // "Yu." "Zh." are one initial
  var STRONG_AUTHOR = new RegExp('^' + NAME + '(?:,?\\s+(?:' + INI + '(?:\\s?-?' + INI + ')*[.,]?' + JOIN + '(?:' + NAME + '|et al|' + YR + ')' +      // "Wahlert, J.H. 1977" / "Litvin Yu.A., Spivak" / "Taylor, S. R.: 1964"
    '|[' + UC + ']{1,3}(?=[,.\\s])[.,]?' + JOIN + '(?:' + NAME + '\\s+[' + UC + ']{1,3}(?=[,.\\s])|et al|' + YR + '))' +                                   // "Kucsko G, Maurer PC"; a space before the initials, so "IEEE, 2012" and "Moscow, FGU GKZ," are not names
    '|,\\s*[' + UC + '][a-z]+(?:\\s[' + UC + ']\\.?)?,?\\s+(?:and\\s+)?[' + UC + '][a-z]+\\s+' + NAME + ')');                                              // "Al-Badi, Ali, Ali Tarhini" / "Yunchao, Gu and Yang Jiayao"; the comma is required ("Proc Lunar Sci Conf" is not a name)
  var INITIALS_FIRST = new RegExp('^(?:' + INI + '\\s?){1,3}(?:-' + INI + '\\s?)?' + NAME + '[,.]');
  var HAS_LOCATOR = /\d+\s*[:,]\s*[A-Z]?\d+|\b[A-Z]?\d+\s*[–−-]\s*[A-Z]?\d+\b|\d+\s*\((?:1[5-9]|20)\d{2}\)\s*[A-Z]?\d+|\bpp?\.?\s*\d|\bvol\.?\s*\d|\bno\.\s*\d|\bV\.\s*\d|\bP\.\s*\d/i; // volume and pages: "15: 87–104", "88, A615–A630", "211 (1995) 52", "V. 194, No. 4828, p. 568"
  var YEAR_POS = /(?<![\d\-–−?\/:])\b(?:1[5-9]|20)\d{2}[a-z]?\b(?![\-–−?\/]\d)/; // a year, not one end of a page range "1549–1579"
  function gluePoint(text) {
    // Every test on the right side is anchored at its start and every test on the left looks at its tail, so each candidate cut
    // works on a window of the text rather than a copy of the whole (a long single-line paste has thousands of candidates)
    var re = /(; |\. | )/g, m, n = text.length, head = text.slice(0, 120).replace(/^(\[\d{1,4}\]|\d{1,4}[.)])\s*/, ''); // a list number is not a page
    while ((m = re.exec(text))) {
      var at = m.index, sep = m[1], keep = sep === ' ' ? 0 : 1, end = at + keep, rightLen = n - at - sep.length;
      if (end < 30) continue;
      var right = text.substr(at + sep.length, 400), ibid = /^ibid\b/i.test(right);
      if (rightLen < (ibid ? 12 : 25)) continue;
      if (!(ibid || STRONG_AUTHOR.test(right) || INITIALS_FIRST.test(right))) continue; // "Smith, J. (2020)" / "Kucsko G, Maurer PC" / "S. Askenazy," / "ibid."
      if (/^(?:In|Dans|En|From|See|Cf|Also|Cited)\b/.test(right)) continue;            // "In K. Jones (Ed.), Book title" is the chapter's book
      if (!YEAR_POS.test(right)) continue;
      var left = end <= 600 ? text.slice(0, end).replace(/^(\[\d{1,4}\]|\d{1,4}[.)])\s*/, '') : text.slice(end - 600, end);
      if (!YEAR_IN.test(left)) continue;
      var located = HAS_LOCATOR.test(left.replace(YEAR_IN, ' ')) || DOI_URL_END.test(left);
      if (!located && !/\d\s*;$/.test(left)) continue;                                                                             // "Smith, J. (2019)." alone is a start, not a reference
      if (sep === ' ' && !/[\d)\]]\.?$/.test(left) && !DOI_URL_END.test(left)) continue;                                              // run together: the left ends on a page, a year, a closing note or a link
      if (sep === '. ' && (ABBR_END.test(left.replace(/\s?\.$/, '')) || !/[\d)\]A-Za-z]\s?\.$/.test(left))) continue;                // "Res. " is an abbreviation, not an end
      if (sameWorkTwice(head, left, right)) continue;                                      // "Иванов И.И. (2013) … Ivanov I.I. (2013) … (in Russian)": one reference, twice
      return { at: at, len: sep === ' ' ? 1 : sep.length, keep: keep };
    }
    return null;
  }
  // A reference written in its own alphabet and again transliterated (Russian journals): the same first author and year on both sides
  function sameWorkTwice(head, left, right) { // head: the opening of the left part (its first author); left: its tail (its year)
    var lf = head.match(/^[^\s,.(]+/), rf = right.match(/^[^\s,.(]+/), ly = left.match(YEAR_IN), ry = right.match(YEAR_IN);
    if (!lf || !rf || !ly || !ry || ly[0] !== ry[0]) return false;
    var a = A.translit(lf[0].toLowerCase()).replace(/[^a-z]/g, ''), b = A.translit(rf[0].toLowerCase()).replace(/[^a-z]/g, '');
    return a.length >= 3 && (a === b || a.slice(0, 5) === b.slice(0, 5));
  }
  // "ibid. 22 (1967) 235" after "Fischback H.J., Phys. Stat. Sol. 3 (1963) 1082": the same authors and journal
  function ibidExpand(prev, part) {
    var m = prev.match(/^([\s\S]*?\S)\s+\d+[A-Za-z]?\s*\(\s*(1[5-9]|20)\d{2}[a-z]?\s*\)/);
    return m ? m[1] + ' ' + part.replace(/^ibid\.?,?\s*/i, '') : part;
  }
  function splitGlued(chunk) {
    var out = [], rest = chunk, guard = 0, cut, bound = Math.max(8, Math.floor(chunk.length / 20)); // a whole list pasted on one line: every cut, bounded only against a runaway
    while (guard++ < bound && (cut = gluePoint(rest))) { out.push(rest.slice(0, cut.at + cut.keep).trim()); rest = rest.slice(cut.at + cut.len).trim(); }
    out.push(rest);
    return out.map(function (p, i) { return i && /^ibid\b/i.test(p) ? ibidExpand(out[i - 1], p) : p; }).filter(Boolean);
  }
  // A line that ends mid-reference: trailing comma/colon/dash, or an initial or journal abbreviation ("et al.", "Res.", "U.S.A.")
  var ABBR_END = /(^|[\s(.])([A-Za-z]|al|Jr|Sr|St|Co|Mt|Ft|Dr|cf|vs|sp|Acad|Am|Amer|Ann|Assoc|Biol|Bull|Can|Chem|Col|Comp|Dept|Ecol|Environ|Evol|Fm|Geogr|Geol|Geophys|Hist|Inst|Int|Intl|Lett|Mag|Mem|Mineral|Mus|Nat|Natl|Palaeontol|Paleontol|Petrol|Phys|Proc|Publ|Res|Rev|Sci|Ser|Soc|Spec|Suppl|Surv|Trans|Univ|Vert|Vol|Zool|ed|eds|Eds|vol|no|pp|et al)\.$/;
  var DOI_URL_END = /(https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+)$/i;
  // "… Vol." + "2. 2019. p. 1-20.": the numbered-looking line is the wrapped tail of the item above, not item 2, when the line above ends on an
  // abbreviation that wants a number, or the line is nothing but a year and pages after its number
  var WRAP_ABBR = /\b(?:Vols?|Nos?|pp?|eds?|Eds|Ch|Chap|Chapt|Sect|Figs?|Tab|Pl|Bd|Jg|Nr|Heft|t|\u0442|\u0441|\u2116)\.$/;
  var NUM_THEN_YEAR = /^\[?\d{1,4}[\].)]\s+\(?(?:1[5-9]|20)\d{2}[a-z]?\)?[.,;:]?(?:\s*(?:pp?|S|\u0441)?\.?\s*[A-Za-z]?\d{1,5}(?:\s*[-\u2013\u2212]\s*[A-Za-z]?\d{1,5})?)?\.?$/; // "2. 2019. p. 1-20.": a year and pages, no title
  function numberedWrap(prev, line) { return (WRAP_ABBR.test(prev) && !/\d\s*pp?\.$/.test(prev)) || NUM_THEN_YEAR.test(line); } // "369 p." ends a book; "2. 1957. Title of the paper" is an item of an author's own list
  // a year in Arabic or Hebrew text: Western or Arabic-Indic digits, a hijri or solar year with its ه / ش, "(2019)" or "، 2019"
  var CJK = '\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF'; // kana, CJK ideographs, hangul
  var RTL_YEAR = '(?:(?:1[5-9]|20)\\d{2}|1[34]\\d{2}(?=\\s?[\\u0647\\u0634])|[\\u0660-\\u0669\\u06F0-\\u06F9]{4})(?:\\s?(?:\\u0647\\u0640?|\\u0634|\\u0645|\\u05D4))?';
  var AUTHOR_START = new RegExp('^(' + PARTICLES + ')?[' + UC + '][' + WC + ']+(,\\s+[' + UC + ']|\\s+[' + UC + ']{1,3}[,.\\s]|\\s+(and|&)\\s)' + // Smith, J. / Smith JA, / Smith and
    '|^([' + UC + ']\\.\\s?){1,3}[' + UC + '][' + WC + ']+[,\\s]' +                                                                       // J. A. Smith,
    '|^[\\u0590-\\u05FF\\u0600-\\u06FF][\\u0590-\\u05FF\\u0600-\\u06FF\\s.,\\u060C\\u061B]{1,60}?(?:[.,\\u060C\\u061B:]\\s?|\\s\\()' + RTL_YEAR + '\\)?[.,\\u060C\\u061B:\\s]' + // Arabic / Hebrew: a name run, a separator, then the year (no capitals to go by); "من 1990" mid-sentence is not one
    '|^[' + CJK + '][' + CJK + '\\s,\\u3001\\u30FB\\uFF0C\\u00B7.\\uFF0E;\\uFF1B]{0,40}?(?:[,.:\\u3001\\uFF0C\\uFF0E\\uFF1A;\\uFF1B]\\s?|\\s?[(\\uFF08]\\s?|\\s)(?:1[5-9]|20)\\d{2}[a-z]?\\s?[\\u5E74]?[).,:\\uFF09\\uFF0C\\uFF0E\\uFF1A\\u3001;\\s]'); // Chinese / Japanese / Korean: a name run (no digits), a separator or bracket, the year ("山田太郎 (2019)", "张三, 李四. 2019.", "김철수（2019）")
  // Bibliography headers and page furniture pasted along with the list: a section heading, "Page 3 of 12", a running head in capitals
  // (three or more words, no digits, or digits that are not a year beside a comma: an all-caps reference keeps its year and its commas)
  var HEADING = /^(?:references?|works cited|bibliography|literature cited|reference list|cited literature|references cited|references and notes|notes and references|sources|further reading|literatur|bibliographie|r\u00e9f\u00e9rences|referencias|bibliograf\u00eda)\s*[:.]?$/i;
  function isFurniture(line) {
    var l = String(line).trim();
    if (HEADING.test(l) || /^page\s+\d{1,4}\s+(?:of|\/)\s+\d{1,4}$/i.test(l)) return true; // a bare number is handled where the line above is known: it may be a wrapped article number
    if (/[a-z\u00DF-\u00FF\u0430-\u045F]/.test(l) || !/[A-Z\u0400-\u042F]/.test(l)) return false; // not all capitals
    var ws = l.match(/[^\s|\u00B7\u2022]+/g) || [];
    if (ws.filter(function (w) { return /[A-Z\u0400-\u042F]/.test(w); }).length < 3) return false;
    if (!/\d/.test(l)) return true;
    return !(/\b(?:1[5-9]|20)\d{2}\b/.test(l) && l.indexOf(',') !== -1); // "GEOLOGY | VOLUME 47 | 2019" is a head; "SMITH, J. (2019). TITLE. JOURNAL, 1, 2." is a reference
  }
  // "———. 2019. …" (Chicago, MLA: the author of the entry above, again): searched with that author's name
  var DASHES = /^[\u2014\u2015\u2013_\-]{2,}\s*/;
  function fillDashes(rows) {
    var author = function (prev) { var m = prev.match(/^([\s\S]{3,200}?)[.,]?\s+\(?(?:1[5-9]|20)\d{2}[a-z]?[).,]/) || prev.match(/^([^.]{3,120}?)\.(?:\s|$)/); return m ? m[1].trim() : ''; };
    return rows.map(function (r, i) { if (!i || !DASHES.test(r)) return r; var a = author(rows[i - 1]); return a ? rows[i] = r.replace(DASHES, a) : r; });
  }
  function hasEndPunct(line) { if (/,[\u201D"\u2019']$/.test(line)) return false; return /[.)\]”"?!]$/.test(line) && (!ABBR_END.test(line) || /\d\s*pp?\.$/.test(line)); } // "369 p." ends a book reference
  // Does the text read like a whole reference? It ends with a DOI/URL, or with a page / article number and a full stop.
  function complete(chunk) {
    if (DOI_URL_END.test(chunk)) return true;
    // "Smith, J. (2019)." / "Smith, J. 2019." is only the author-date start unless volume or pages came before the year
    if (/[\u201D"][^\u201C"]{2,80},\s(1[5-9]|20)\d{2}[a-z]?\.$/.test(chunk)) return true; // “Title.” Publisher, 2025.
    var yearTail = /[(\s]((1[5-9]|20)\d{2}[a-z]?)\)?\.?$/;
    if (yearTail.test(chunk) && !/\d/.test(chunk.replace(yearTail, ''))) return /\.\s+\S[\s\S]{30,}[(\s](1[5-9]|20)\d{2}[a-z]?\)?\.$/.test(chunk) && /(https?:\/\/|www\.)/.test(chunk); // "…/tree/main (2022)." (Nature-style ending) is whole
    return hasEndPunct(chunk) && /\d[\])]?\.$|\d\s*\(\d{4}\)\.$/.test(chunk) && chunk.length > 20;
  }
  // A line that is only a paper's title, perhaps with its journal and year ("Deep learning, Nature 2015"): no author, no identifier,
  // no volume or pages. Such a line is looked up by title, as on Find a DOI, not graded as a reference with everything missing.
  // Returns { title, journal, year } (journal and year '' when absent) or null
  var TITLE_AUTHOR = new RegExp('^(' + PARTICLES + ')?[' + UC + '][' + WC + ']+(,\\s+[' + UC + '][.\\s]|,\\s+[' + UC + '][' + WC + ']+,|\\s+[' + UC + ']{1,3}\\s*[,.(])' + // Smith, J. / Smith, John, / Smith JA, / Barnes SJ (
    '|^([' + UC + ']\\.\\s?){1,3}[' + UC + '][' + WC + ']+[,\\s]' +                                                                              // J. A. Smith; "Attention and memory" is a title, so no "Word and" branch
    '|[' + UC + '][' + WC + ']{2,}\\s[' + UC + ']\\.\\s?[' + UC + ']\\.' +                                                                       // "Расков Д. Е.": a surname with two initials anywhere ("The U.S. policy" is lost to it and takes the reference path)
    '|\\s\\p{L}\\s\\p{L}(?:\\s|$)', 'u');                                                                                                          // "siegel d j brainstorm": two single letters in a row are initials, whatever the case
  var JOURNAL_WORD = new RegExp('^([' + UC + '][' + WC + '.&:]*|of|and|the|for|in|on|&|de|des|der|und|et|di)$'), JOURNAL_STOP = /^(of|and|the|for|in|on|&|de|des|der|und|et|di)$/;
  var LETTER = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
  var TITLE_GLUE = /^(?:of|in|for|with|and|or|the|a|an|on|to|by|from|via|at|as|into|using|under|over|between|through|during|without|within|versus|vs\.?)\s/; // a wrapped title's second line opens this way; a name in a list does not
  function looksLikeTitle(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim().replace(/^[“‘"']|[”’"']$/g, '').replace(/\.$/, '').trim();
    if (t.length < 3 || t.length > 250) return null; // one word is a search too: a mineral name, a species
    if (ID_LINE.test(t) || /10\.\d{4,9}\/|https?:\/\/|www\.|\bISBN\b|\bPMID\b|\bPMC\d|\barXiv\b|<[a-z]+[^>]*>|\(\s*\)/i.test(t)) return null; // an identifier, HTML, or the "( )" a year was cut from
    if (/\bet al\b|\(eds?\.?\)|\beds?\.\s|\bIn:\s|^(\[\d{1,4}\]|\d{1,4}[.)]|[•●◦‣⁃·*\-–—])\s/i.test(t)) return null;
    if (STRONG_AUTHOR.test(t) || INITIALS_FIRST.test(t) || TITLE_AUTHOR.test(t)) return null;
    // "John Smith, Deep learning for crystals, Nature, 2020": a given and family name before a comma, then a title and more parts; "Deep Learning, Nature 2015" has only its journal after the comma
    var given = t.match(/^[A-Z][a-z]+ (?:[A-Z]\. )?[A-Z][\w'\u2019-]+(?:,? (?:and|&) [A-Z][a-z]+ [A-Z][\w'\u2019-]+)*, (.+)$/);
    if (given && ((given[1].match(/,/g) || []).length >= 2 || (given[1].split(',')[0].match(/\S+/g) || []).length >= 4)) return null;
    if (HAS_LOCATOR.test(t) || /\b\d{1,4}\s*\(\d{1,4}\)/.test(t)) return null; // "Nature 500:54", "12(3)"
    var ym = t.match(/[\s,(]\(?((?:1[5-9]|20)\d{2})\)?$/), year = ym ? ym[1] : '';
    var rest = ym ? t.slice(0, ym.index).replace(/[\s,(]+$/, '') : t;
    if (YEAR_POS.test(rest) || (rest.match(/\b\d{1,5}\b/g) || []).length >= 2) return null; // a year mid-line, or "nature 585 357 362": a reference, not a title
    var wordsN = (rest.match(/\S+/g) || []).filter(function (w) { return LETTER.test(w); }).length;
    if (wordsN < 1 || wordsN > 30) return null;
    // a journal after an explicit separator only ("Deep learning, Nature", "Deep learning - Nature", "Deep learning in Nature"): never split on a space
    var title = rest, journal = '', seps = [', ', ' - ', ' – ', ' — ', '. ', ' in '];
    for (var i = 0; i < seps.length && !journal; i++) {
      var at = rest.lastIndexOf(seps[i]); if (at < 0) continue;
      var head = rest.slice(0, at).trim(), tail = rest.slice(at + seps[i].length).trim(), tw = tail.split(/\s+/);
      if (tw.length <= 6 && tail.indexOf(':') < 0 && !JOURNAL_STOP.test(tw[0]) && tw.every(function (w) { return JOURNAL_WORD.test(w); }) &&
        (head.match(/\S+/g) || []).filter(function (w) { return LETTER.test(w); }).length >= 1) { title = head; journal = tail; } // "Oldsite, Mineralogical Magazine"; a wrong split is retried as a whole line by findByTitle
    }
    return { title: title, journal: journal, year: year };
  }
  // An explicit layout chosen by the user removes all guessing
  function splitByMode(text, mode) {
    var t = String(text || '').replace(/\r\n?/g, '\n').trim();
    var parts;
    t = t.replace(/[ \t]{2,}/g, ' '); // first, so the patterns below never scan a long run of spaces from every position
    if (t.split('\n').filter(function (l) { return l.trim(); }).length > 1) t = t.split('\n').filter(function (l) { return !isFurniture(l); }).join('\n'); // headings and page furniture, as in the automatic layout
    if (mode === 'blank') parts = t.split(/\n[ \t]?\n+/).map(function (c) { return c.split(/[ \t]?\n[ \t]?/).reduce(function (acc, l) { return BARE_NUMBER.test(l.trim()) && acc && complete(acc) ? acc : (acc ? acc + ' ' : '') + l; }, ''); }); // a page number after a finished reference is dropped; a wrapped article number is kept
    else if (mode === 'numbered') {
      parts = []; var next = null;
      t.split('\n').forEach(function (raw) {
        var l = raw.trim(); if (!l) return;
        var mm = l.match(/^\[?(\d{1,4})[\].)]\s/), num = mm ? Number(mm[1]) : null;
        if (!parts.length || (num !== null && (next === null || (num >= next && num - next <= 5)) && !numberedWrap(parts[parts.length - 1], l))) { parts.push(l); if (num !== null) next = num + 1; } // a gap of a few numbers is a deleted entry; "1998. Title" inside a wrap is not item 1998
        else parts[parts.length - 1] += ' ' + l;
      });
    } else { // one per line; a line that is only a DOI/URL belongs to the reference above
      parts = [];
      t.split('\n').forEach(function (raw) {
        var l = raw.trim(); if (!l) return;
        if (parts.length && /^((https?:\/\/)?(dx\.)?doi\.org\/|doi:\s*10\.|10\.\d{4,9}\/|https?:\/\/)\S+\.?$/i.test(l) && !/10\.\d{4,9}\//.test(parts[parts.length - 1]) && !ID_LINE.test(parts[parts.length - 1])) parts[parts.length - 1] += ' ' + l;
        else parts.push(l);
      });
    }
    var single = parts.length === 1;
    return fillDashes(parts.map(function (l) { if (ID_LINE.test(l) || /^(https?:\/\/|doi:|10\.\d{4,9}\/)/i.test(l)) return l.trim(); return l.replace(/^\s*(\[\d{1,4}\]|\d{1,4}[.)]|[\u2022\-\u2013\u2014*\u00B7])\s*/, '').trim(); })
      .filter(function (l) { return single ? (l.length > 8 || ID_LINE.test(l) || BARE_NUMBER.test(l) || looksLikeTitle(l)) : !isFurniture(l) && !BARE_NUMBER.test(l) && (l.length > 8 || ID_LINE.test(l) || (looksLikeTitle(l) && parts.every(function (p) { return looksLikeTitle(p); }))); }) // "oldsite" alone, or a list of mineral names, is a search, not debris; a heading or a page number is
      .reduce(function (acc, l) { return acc.concat(splitAtDois(l).reduce(function (a2, x) { return a2.concat(splitGlued(x)); }, [])); }, [])); // a line can still hold two references run together
  }
  function splitReferences(text, mode) {
    if (mode && mode !== 'auto') return splitByMode(text, mode);
    var t = String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]*\n+/, '').trimEnd();
    var rawLines = t.split('\n');
    if (rawLines.filter(function (l) { return l.trim(); }).length > 1) rawLines = rawLines.filter(function (l) { return !isFurniture(l); }); // a heading or a page break's furniture between two lines of one reference joins them; alone, "Sources" is a search
    var hasBlank = /\n\s*\n/.test(t);
    var NUM = /^(\[\d{1,4}\]|(?!(?:1[5-9]|20)\d\d[.)])\d{1,4}[.)])\s/; // up to 9999, but "2019." opens a year-led line
    var numbered = rawLines.filter(function (l) { return NUM.test(l.trim()); }).length >= 2; // a numbered list: only numbers start items
    var BUL = /^[\u2022\u25CF\u25E6\u2023\u2043\u00B7*\-\u2013\u2014]\s/;
    var bulletLines = rawLines.filter(function (l) { return BUL.test(l.trim()); }).length;
    // a bulleted list (only bullets start items) — unless unbulleted lines also open like references (a half-bulleted paste)
    var unbulletedOpens = rawLines.filter(function (l) { l = l.trim(); return l && !BUL.test(l) && (START.test(l) || AUTHOR_START.test(l)); }).length;
    var bulleted = !numbered && bulletLines >= 2 && unbulletedOpens < 0.2 * bulletLines;
    // Hanging indent: continuation lines are indented, first lines are not
    var nonEmpty = rawLines.filter(function (l) { return l.trim(); });
    var indented = nonEmpty.filter(function (l) { return /^[ \t]+\S/.test(l); }).length;
    // ... so an unindented line never continues an unindented one: where one does (the line above ends mid-sentence), the paste is
    // wrapped text with a stray leading space somewhere, not a hanging layout
    var wrappedUnindented = nonEmpty.filter(function (l, i) { var prev = i ? nonEmpty[i - 1].trim() : ''; return i > 0 && !/^[ \t]/.test(l) && !/^[ \t]/.test(nonEmpty[i - 1]) && /[,:\u2013\-&]$|\b[a-z]+$/.test(prev) && !DOI_URL_END.test(prev); }).length; // a note ending in ";" is a whole citation, not a wrap
    var hanging = !numbered && indented >= 1 && indented < nonEmpty.length && !/^[ \t]/.test(nonEmpty[0]) && !(wrappedUnindented >= 2 || wrappedUnindented >= 0.3 * (nonEmpty.length - indented)); // one prose note ending mid-line is not a wrapped paste
    // If nearly every line opens like a reference, the paste is one reference per line; a publisher's place ("Cambridge, MA: MIT Press.")
    // or an editor line ("Jones, K. (Ed.), ...") looks like a name but is the tail of the line above
    var PLACE_LINE = /^[A-Z][A-Za-z.\s]+, [A-Z]{2}\s*:/, EDS_LINE = /^[^,]+, (?:[A-Z]\.\s*)+\(Eds?\.\)/;
    var opens = nonEmpty.filter(function (l) { l = l.trim(); return !PLACE_LINE.test(l) && !EDS_LINE.test(l) && (START.test(l) || AUTHOR_START.test(l) || (ID_LINE.test(l) && !/^\d+\.?$/.test(l))); }).length;
    var perLine = !numbered && !bulleted && !hanging && !hasBlank && nonEmpty.length >= 3 && opens >= 0.8 * nonEmpty.length;
    // A list of bare titles, one per line: nothing opens like a reference and nearly every line reads as a title
    var titleLines = nonEmpty.filter(function (l) { return !!looksLikeTitle(l.trim()); }).length;
    var titleList = !numbered && !bulleted && !hanging && nonEmpty.length >= 2 && opens === 0 && titleLines >= 0.8 * nonEmpty.length;
    var numOf = function (l) { var m = l.match(/^\[?(\d{1,4})[\].)]/); return m && !(m[1].length === 4 && /^(1[5-9]|20)/.test(m[1]) && l.charAt(0) !== '[') ? Number(m[1]) : null; };
    var expect = null;
    var refs = [], cur = '';
    var flush = function () { if (cur) refs.push(cur); cur = ''; };
    rawLines.forEach(function (raw) {
      var l = raw.trim();
      if (!l) { flush(); return; }
      if (BARE_NUMBER.test(l) && nonEmpty.length > 1 && (!cur || complete(cur) || hasEndPunct(cur))) return; // a page number, a footnote number or a PubMed ID without its prefix between references; "10," + "4567891." is a wrapped article number
      if (!cur) {
        if (numbered && NUM.test(l)) expect = numOf(l) + 1;
        // "…Mol Ecol Notes 2004, 4: 786–788." [blank line] "10.1111/…": the DOI still belongs to the reference above
        if (/^((https?:\/\/)?(dx\.)?doi\.org\/|doi:\s*)?10\.\d{4,9}\/\S+$/i.test(l) && refs.length && !/10\.\d{4,9}\//.test(refs[refs.length - 1]) && !ID_LINE.test(refs[refs.length - 1])) { refs[refs.length - 1] += ' ' + l; return; }
        cur = l; return;
      }
      var isDoiLine = /^((https?:\/\/)?(dx\.)?doi\.org\/|doi:|10\.\d{4,9}\/|https?:\/\/|(available|retrieved)\s+(at|from|online)\b|url:|\[online\])/i.test(l);
      if (numbered) {
        if (NUM.test(l) && (expect === null || numOf(l) === expect) && !numberedWrap(cur, l)) { flush(); cur = l; expect = numOf(l) + 1; } // "191. [in Russian]" inside a wrap is not item 191
        else cur += (/-$/.test(cur) && isDoiLine ? '' : ' ') + l;
        return;
      }
      if (bulleted) { if (BUL.test(l)) { flush(); cur = l; } else cur += ' ' + l; return; }
      if (titleList) { // a wrapped title continues on a lowercase line or after a dangling word ("Deep learning methods for" / "protein structure prediction")
        if ((/^[a-z]/.test(l) && !/[.?!]$/.test(cur) && ((cur.match(/\S+/g) || []).length >= 4 || TITLE_GLUE.test(l))) || /[,;:–\-&]$|\b(of|for|and|the|a|an|in|on|to|with|by|from|is|are)$/i.test(cur)) cur += ' ' + l; else { flush(); cur = l; } // a lowercase line continues a line long enough to have wrapped, or one that opens on a joining word ("Molecular structure" / "of nucleic acids"); "oldsite" / "bobdownsite" is a list
        return;
      }
      if (perLine && !isDoiLine && !/^\(/.test(l) && !PLACE_LINE.test(l) && !EDS_LINE.test(l) && !/[,;:\u2013\-&]$/.test(cur) && !/\b[Ii]n$/.test(cur)) { flush(); cur = l; return; }
      if (hanging) { if (/^[ \t]/.test(raw)) cur += ' ' + l; else { flush(); cur = l; } return; }
      if (ID_LINE.test(cur)) { flush(); cur = l; return; }                  // a list of bare identifiers
      if (isDoiLine && !/10\.\d{4,9}\//.test(cur) && (/^(10\.\d{4,9}\/|https?:|doi:|available|retrieved|url:|\[online)/i.test(l) || !complete(cur))) { cur += ' ' + l; return; } // a wrapped DOI belongs to the reference above
      if (DOI_URL_END.test(cur) && !isDoiLine && (!/^[a-z0-9(]/.test(l) || START.test(l))) { flush(); cur = l; return; } // a reference that ends with its DOI is finished; "3. Brown" is the next item
      if (!/10\.\d{4,9}\//.test(cur) && /(doi\.org\/|doi:\s*|\b)10\.\d{4,9}\/\S+\.?$/.test(l) && !START.test(l) && !AUTHOR_START.test(l) && l.length < 90) { cur += ' ' + l; return; }
      if (ID_LINE.test(l) && complete(cur)) { flush(); cur = l; return; }
      var yrOpen = new RegExp('^(' + PARTICLES + ')?[' + UC + '][' + WC + ']+(\\s[' + UC + '][' + WC + ']+)?,?\\s+([' + UC + ']\\.?\\s?){1,3}[\\s\\S]{0,80}?[(\\s](1[5-9]|20)\\d{2}[a-z]?[).,]');
      if (!hasBlank && /[\d.)\]]$/.test(cur) && !ABBR_END.test(cur) && yrOpen.test(l) && /\b(1[5-9]|20)\d{2}[a-z]?\b[\s\S]{25,}/.test(cur) && cur.length > 50) { flush(); cur = l; return; } // "…Econ Geol 49: 317–327" + "Bassett WA (1963) …"
      if (/[,;:–\-&][\u201D"\u2019']?$/.test(cur) || !hasEndPunct(cur)) { cur += ' ' + l; return; } // mid-sentence wrap
      if (/^[a-z(\d]/.test(l) && !START.test(l) && !ID_LINE.test(l)) { cur += ' ' + l; return; } // "p. 147-64.", "(pp. 1-2)", "in Proceedings" continue
      // a short line with no year and no author after a complete-looking reference is its publisher / place tail
      if (complete(cur) && !START.test(l) && !AUTHOR_START.test(l) && l.length < 70 && !/\b(1[5-9]|20)\d{2}\b/.test(l)) { cur += ' ' + l; return; }
      if (complete(cur) && (START.test(l) || AUTHOR_START.test(l) || !hasBlank)) { flush(); cur = l; return; }
      // the text above is not obviously complete (a book, an online-first article): split only on a clear author opening
      var strongAuthor = new RegExp('^(' + PARTICLES + ')?[' + UC + '][' + WC + ']+(\\s[' + UC + '][' + WC + ']+)?(,\\s+[' + UC + ']\\.|,\\s+[' + UC + '][' + WC + ']+([,.]\\s|\\s+[' + UC + ']\\.)|\\s+[' + UC + ']{1,3},|\\s+([' + UC + ']\\.){1,3}[,\\s])|^([' + UC + ']\\.\\s?){1,3}[' + UC + '][' + WC + ']+,');
      if (!hasBlank && (strongAuthor.test(l) || /^(\[\d{1,4}\]|(?!(?:1[5-9]|20)\d\d[.)])\d{1,4}[.)]|[\u2022\-\u2013\u2014*\u00B7])\s/.test(l)) && (!/\(\d{4}[a-z]?\)\.?$/.test(cur) || /\.\s+\S[\s\S]{40,}\(\d{4}[a-z]?\)\.?$/.test(cur)) && cur.length > 20) { flush(); cur = l; return; }
      cur += ' ' + l;
    });
    flush();
    var out = [];
    refs.forEach(function (r) { splitAtDois(r).forEach(function (x) { splitGlued(x).forEach(function (y) { out.push(y); }); }); });
    var single = out.length === 1;
    return fillDashes(out.map(function (l) {
      l = l.trim();
      if (ID_LINE.test(l) || /^(https?:\/\/)?(dx\.)?doi\.org\/|^doi:|^10\.\d{4,9}\//i.test(l)) return l; // a bare identifier is not a numbered item
      return l.replace(/^\s*(\[\d{1,3}\]|\d{1,3}[.)]|[•\-–—*·])\s*/, '').trim();
    }).filter(function (l) { return single ? (l.length > 8 || ID_LINE.test(l) || BARE_NUMBER.test(l) || looksLikeTitle(l)) : !BARE_NUMBER.test(l) && (l.length > 8 || ID_LINE.test(l) || (looksLikeTitle(l) && titleList)); })); // "oldsite" alone, or a list of mineral names, is a search, not debris; a bare number in a list is a page number
  }

  var api = { splitReferences: splitReferences, looksLikeTitle: looksLikeTitle, ID_LINE: ID_LINE, CJK: CJK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AutoDOISplitter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
