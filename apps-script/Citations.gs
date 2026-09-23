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

  // ISBN-10 or ISBN-13 in free text ("ISBN 978-0-521-38707-1", "0521387078"), returned as bare digits, checksum verified
  function extractIsbn(text) {
    var t = String(text || '');
    var m = t.match(/\b(?:ISBN(?:-1[03])?:?\s*)?((?:97[89][\s-]?)?\d[\d\s-]{8,15}[\dXx])\b/);
    if (!m) return null;
    var d = m[1].replace(/[\s-]/g, '').toUpperCase();
    if (d.length === 13 && /^\d{13}$/.test(d)) {
      var sum = 0; for (var i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 ? 3 : 1);
      return (10 - sum % 10) % 10 === Number(d[12]) ? d : null;
    }
    if (d.length === 10 && /^\d{9}[\dX]$/.test(d)) {
      var s10 = 0; for (var j = 0; j < 9; j++) s10 += Number(d[j]) * (10 - j);
      s10 += d[9] === 'X' ? 10 : Number(d[9]);
      return s10 % 11 === 0 ? d : null;
    }
    return null;
  }

  // "Georg Kucsko" / "Peter C. Maurer" / "van der Walt, Stéfan" -> {family, given}
  function splitName(full) {
    var n = clean(full);
    if (!n) return null;
    if (n.indexOf(',') !== -1) { var parts = n.split(','); return { family: parts[0].trim(), given: parts.slice(1).join(',').trim() }; }
    var toks = n.split(/\s+/);
    if (toks.length === 1) return { name: n };
    var fam = [toks.pop()];
    while (toks.length > 1 && /^(van|von|de|del|della|der|den|da|di|du|la|le|los|las|dos|das|ter|ten|af|av|zu|zur|y|e)$/i.test(toks[toks.length - 1])) fam.unshift(toks.pop());
    return { family: fam.join(' '), given: toks.join(' ') };
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

  function clean(s) {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Library-catalogue records (BHL, MARC) leave trailing " :", " ,", " ;" on places and publishers
  function trimPunct(s) { return String(s || '').replace(/[\s,:;\/]+$/, '').trim(); }

  function cleanAbstract(s) {
    if (!s) return '';
    var t = String(s).replace(/<\/(jats:p|jats:title|jats:sec|p|title|sec)>/gi, ' ');
    t = clean(t).replace(/^(Abstract|Summary)\b[\s.:]*/i, '');
    return t;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function stripTags(html) {
    return String(html).replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
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

  function person(p) {
    var fam = clean(p.family);
    if (fam) {
      var given = clean(p.given);
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
    var r = {
      type: type,
      doi: m.DOI || m.doi || '',
      url: m.URL || (m.DOI ? 'https://doi.org/' + m.DOI : ''),
      title: trimPunct(clean(first(m.title))),
      subtitle: clean(first(m.subtitle)),
      container: trimPunct(clean(container)),
      series: trimPunct(clean(series)),
      shortContainer: clean(first(m['short-container-title'])),
      institution: clean(Array.isArray(inst) ? (inst[0] && inst[0].name) : (inst && inst.name) || inst || ''),
      edition: clean(m.edition || m['edition-number'] || ''),
      numPages: clean(m['number-of-pages'] || ''),
      genre: clean(m.genre || first(m.degree) || ''),
      accessed: acc ? { year: acc[0], month: acc[1] || 0, day: acc[2] || 0 } : null,
      authors: (m.author || []).map(person),
      editors: (m.editor || []).map(person),
      year: dp[0] ? String(dp[0]) : '',
      month: dp[1] ? Number(dp[1]) : 0,
      day: dp[2] ? Number(dp[2]) : 0,
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
    }
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
  function endsPunct(s) { return /[.?!]$/.test(s); }
  function dot(s) { return s ? (endsPunct(s) ? s : s + '.') : ''; }
  function I(s) { return s ? '<i>' + esc(s) + '</i>' : ''; }
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
    var names = apaNames(r.authors);
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
      var inPart = 'In ' + (eds.length ? T(joinAnd(eds, '&', true)) + ' (' + (eds.length > 1 ? 'Eds.' : 'Ed.') + '), ' : '') +
        I(r.container) + (r.pages ? ' (' + T(pp(r.pages)) + ')' : '') + '.';
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
      var inp = 'In ' + I(r.container);
      if (r.editors.length) inp += ', edited by ' + T(joinAnd(r.editors.map(nameFullFirst), 'and', r.editors.length > 2));
      if (r.pages) inp += ', ' + T(pageRange(r.pages));
      out.push(inp + '.');
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
    var names = n ? hlist(r.authors) : '';
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
      var inb = 'in ' + (r.editors.length ? T(hlist(r.editors)) + (r.editors.length > 1 ? ' (eds.) ' : ' (ed.) ') : '') + I(r.container) + '.';
      out.push('‘' + T(r.title) + '’, ' + inb);
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
    var names = n > 6 ? r.authors.slice(0, 6).map(nameVancouver).join(', ') + ', et al' : r.authors.map(nameVancouver).join(', ');
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
      out.push('In: ' + T(edsV) + T(dot(r.container)));
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
    if (!names && r.editors.length) names = joinAnd(r.editors.map(nameInitFirst), 'and', r.editors.length > 2) + (r.editors.length > 1 ? ', Eds.' : ', Ed.');
    var out = [];
    if (num) out.push('[' + num + ']');
    if (names) out.push(T(names) + ',');
    var mon = r.month ? MONTHS_IEEE[r.month - 1] + ' ' : '';
    var link = doiLink(r);
    var placePub = [r.place, r.publisher].filter(Boolean).join(': ');
    if (k === 'book') {
      out.push(I(r.title) + (r.edition ? ', ' + T(editionLabel(r.edition, 'apa')) : (endsPunct(r.title) ? '' : '.')));
      out.push(T([placePub, r.year].filter(Boolean).join(', ')) + (r.doi ? ', doi: ' + T(r.doi) + '.' : '.'));
    } else if (k === 'chapter' || k === 'proceedings') {
      // “Title,” in Book, A. Ed and B. Ed, Eds. City: Publisher, year, pp. x–y, doi: …
      var edsI = r.editors.length ? ', ' + T(joinAnd(r.editors.map(nameInitFirst), 'and', r.editors.length > 2)) + (r.editors.length > 1 ? ', Eds.' : ', Ed.') : '';
      var head = '“' + T(r.title) + ',” in ' + I(r.container) + edsI;
      var restC = [];
      if (r.year) restC.push(mon + T(r.year));
      if (r.pages) restC.push(T(pp(r.pages)));
      if (r.doi) restC.push('doi: ' + T(r.doi));
      out.push(head + (edsI ? ' ' : '. ') + T(placePub) + (placePub && restC.length ? ', ' : '') + restC.join(', ') + '.');
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
    var names = carnegieNames(r.authors);
    if (!names && r.editors.length) names = carnegieNames(r.editors) + (r.editors.length > 1 ? ' (eds.)' : ' (ed.)');
    var out = [];
    if (names) out.push(T(dot(names)));
    out.push(T((r.year || 'n.d.') + '.'));
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
        out.push('In ' + T(r.container) + eds + '.');
        out.push(T(r.series || r.publisher) + ', ' + T(r.volume) + (pages ? ':' + T(pages) : '') + '.');
      } else {
        out.push((pages ? 'Pp. ' + T(pages) + ', in ' : 'In ') + T(r.container) + eds + (eds || !endsPunct(r.container) ? '.' : ''));
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
      out.push(T(r.title) + ' [cited ' + (when.day ? when.day + ' ' : '') + (when.month ? MONTHS[when.month - 1] + ' ' : '') + when.year + '].');
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
    add('title', r.title);
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
    if (r.month) add('month', MONTHS_ABBR[r.month - 1].replace('.', '').toLowerCase(), 'bare');
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
    add('TI', r.title);
    add('T2', r.container);
    add('T3', r.series);
    add('ET', r.edition);
    if (r.shortContainer && r.shortContainer !== r.container) add('JO', r.shortContainer);
    add('VL', r.volume);
    add('IS', r.issue);
    var pm = r.pages.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (pm) { add('SP', pm[1]); add('EP', pm[2]); } else add('SP', r.pages);
    add('PY', r.year);
    if (r.year) add('DA', r.year + '/' + (r.month ? String(r.month).padStart(2, '0') : '') + '/' + (r.day ? String(r.day).padStart(2, '0') : '') + '/');
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
    add('%T', r.title);
    if (k === 'journal') add('%J', r.container);
    else add('%B', r.container);
    add('%S', r.series);
    add('%7', r.edition);
    add('%V', r.volume);
    add('%N', r.issue);
    add('%P', r.pages ? enDash(r.pages).replace('–', '-') : '');
    add('%D', r.year);
    if (r.month) add('%8', MONTHS[r.month - 1] + (r.day ? ' ' + r.day : ''));
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
    var r = record.authors ? record : normalize(record);
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
    var r = record.authors ? record : normalize(record);
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === styleId) return STYLES[i].fn(r, num);
    throw new Error('Unknown text style: ' + styleId);
  }

  /* ---------- matching confidence ---------- */

  function tokens(s) {
    return clean(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
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
