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

  var DOI_RE = /10\.\d{4,9}\/[^\s"'<>]+/i;

  /* ---------- helpers ---------- */

  function extractDoi(text) {
    if (!text) return null;
    var m = String(text).match(DOI_RE);
    if (!m) return null;
    var doi = m[0].replace(/[.,;:]+$/, '');
    // drop a trailing ")" or "]" only if it is unbalanced
    while (/[)\]]$/.test(doi)) {
      var open = (doi.match(/[(\[]/g) || []).length;
      var close = (doi.match(/[)\]]/g) || []).length;
      if (close > open) doi = doi.slice(0, -1); else break;
    }
    return doi;
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

  function person(p) {
    if (p.family || p.given) {
      return { family: clean(p.family), given: clean(p.given), literal: false };
    }
    var name = clean(p.name || p.literal || '');
    return { family: name, given: '', literal: true };
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var MONTHS_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.',
    'Sep.', 'Oct.', 'Nov.', 'Dec.'];

  /* ---------- normalize ---------- */

  function normalize(m) {
    var dp = datePartsOf(m);
    var type = m.type || 'other';
    var page = clean(m.page || '');
    var r = {
      type: type,
      doi: m.DOI || m.doi || '',
      url: m.URL || (m.DOI ? 'https://doi.org/' + m.DOI : ''),
      title: clean(first(m.title)),
      subtitle: clean(first(m.subtitle)),
      container: clean(first(m['container-title'])),
      shortContainer: clean(first(m['short-container-title'])),
      authors: (m.author || []).map(person),
      editors: (m.editor || []).map(person),
      year: dp[0] ? String(dp[0]) : '',
      month: dp[1] ? Number(dp[1]) : 0,
      day: dp[2] ? Number(dp[2]) : 0,
      volume: clean(m.volume || ''),
      issue: clean(m.issue || ''),
      pages: page,
      articleNumber: clean(m['article-number'] || ''),
      publisher: clean(m.publisher || ''),
      place: clean(m['publisher-location'] || m['publisher-place'] || ''),
      issn: clean(first(m.ISSN) || ''),
      isbn: clean(first(m.ISBN) || ''),
      abstract: clean(m.abstract || ''),
      language: clean(m.language || ''),
      event: clean((m.event && m.event.name) || ''),
      score: m.score
    };
    if (r.subtitle && r.title && r.title.indexOf(r.subtitle) === -1) {
      r.title = r.title + ': ' + r.subtitle;
    }
    if (r.title && !/[.?!]$/.test(r.title)) { /* keep as is; punctuation added per style */ }
    if (!r.pages && r.articleNumber) r.pages = r.articleNumber;
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
    var tokens = given.replace(/\./g, '. ').split(/\s+/).filter(Boolean);
    var out = [];
    tokens.forEach(function (tok) {
      tok = tok.replace(/\.$/, '');
      if (!tok) return;
      // "PC" style compressed initials
      if (/^[A-Z]{2,3}$/.test(tok)) {
        tok.split('').forEach(function (ch) { out.push(ch); });
        return;
      }
      var parts = tok.split('-').map(function (p) { return p.charAt(0).toUpperCase(); });
      out.push(parts.join(opts.dots === false ? '-' : '.-'));
    });
    if (opts.dots === false) return out.join('');
    return out.map(function (x) { return x + '.'; }).join(opts.space === false ? '' : ' ');
  }

  function nameLastInit(p, sep) { // "Kucsko, G."
    if (p.literal) return p.family;
    var ini = initials(p.given);
    return p.family + (ini ? (typeof sep === 'string' ? sep : ', ') + ini : '');
  }
  function nameLastFull(p) { // "Kucsko, Georg"
    if (p.literal) return p.family;
    return p.family + (p.given ? ', ' + p.given : '');
  }
  function nameFullFirst(p) { // "Georg Kucsko"
    if (p.literal) return p.family;
    return (p.given ? p.given + ' ' : '') + p.family;
  }
  function nameInitFirst(p) { // "G. Kucsko"
    if (p.literal) return p.family;
    var ini = initials(p.given);
    return (ini ? ini + ' ' : '') + p.family;
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
  function T(s) { return esc(s); }

  function apa(r) {
    var k = kind(r);
    var n = r.authors.length;
    var names;
    if (n === 0) names = '';
    else if (n === 1) names = nameLastInit(r.authors[0]);
    else if (n === 2) names = nameLastInit(r.authors[0]) + ', & ' + nameLastInit(r.authors[1]);
    else if (n <= 20) names = r.authors.slice(0, -1).map(nameLastInit).join(', ') + ', & ' + nameLastInit(r.authors[n - 1]);
    else names = r.authors.slice(0, 19).map(nameLastInit).join(', ') + ', . . . ' + nameLastInit(r.authors[n - 1]);
    var year = '(' + (r.year || 'n.d.') + ').';
    var out = [];
    var link = doiLink(r);
    var vol = '';
    if (r.volume) vol = I(r.volume) + (r.issue ? '(' + T(r.issue) + ')' : '');
    else if (r.issue) vol = '(' + T(r.issue) + ')';

    if (k === 'journal') {
      var src = [I(r.container), vol, r.pages ? T(pageRange(r.pages)) : ''].filter(Boolean).join(', ');
      if (n) out.push(T(dot(names)), year, T(dot(r.title)), src + '.');
      else out.push(T(dot(r.title)), year, src + '.');
    } else if (k === 'chapter' || k === 'proceedings') {
      var eds = r.editors.map(nameInitFirst);
      var inPart = 'In ' + (eds.length ? T(joinAnd(eds, '&', true)) + ' (' + (eds.length > 1 ? 'Eds.' : 'Ed.') + '), ' : '') +
        I(r.container) + (r.pages ? ' (pp. ' + T(pageRange(r.pages)) + ')' : '') + '.';
      if (n) out.push(T(dot(names)), year, T(dot(r.title)), inPart);
      else out.push(T(dot(r.title)), year, inPart);
      if (r.publisher) out.push(T(dot(r.publisher)));
    } else if (k === 'book') {
      if (n) out.push(T(dot(names)), year, I(r.title) + '.');
      else out.push(I(r.title) + '.', year);
      if (r.publisher) out.push(T(dot(r.publisher)));
    } else {
      var label = { preprint: 'Preprint', dataset: 'Data set', software: 'Computer software', thesis: 'Doctoral dissertation', report: 'Report' }[k];
      var titlePart = I(r.title) + (label ? ' [' + label + ']' : '') + '.';
      if (n) out.push(T(dot(names)), year, titlePart);
      else out.push(titlePart, year);
      var host = r.container || r.publisher;
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
    var out = [];
    if (names) out.push(T(dot(names)));
    var quoted = '“' + T(dot(r.title)) + '”';
    var link = doiLink(r);
    var contParts = [];
    if (k === 'book') {
      out.push(I(r.title) + '.');
      if (r.publisher) contParts.push(T(r.publisher));
      if (r.year) contParts.push(T(r.year));
    } else {
      out.push(quoted);
      if (r.container) contParts.push(I(r.container));
      if (k === 'chapter' && r.editors.length) contParts.push('edited by ' + T(joinAnd(r.editors.map(nameFullFirst), 'and', false)));
      if (r.volume) contParts.push('vol. ' + T(r.volume));
      if (r.issue) contParts.push('no. ' + T(r.issue));
      if (k !== 'journal' && r.publisher) contParts.push(T(r.publisher));
      if (r.year) contParts.push(T(r.year));
      if (r.pages) contParts.push((isRange(r.pages) ? 'pp. ' : 'p. ') + T(pageRange(r.pages)));
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
    else if (n >= 2 && n <= 10) names = nameLastFull(r.authors[0]) + ', ' + joinAnd(r.authors.slice(1).map(nameFullFirst), 'and', n > 2);
    else if (n > 10) names = nameLastFull(r.authors[0]) + ', ' + r.authors.slice(1, 7).map(nameFullFirst).join(', ') + ', et al';
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
      out.push(s + '.');
    } else if (k === 'book') {
      out.push(I(r.title) + '.');
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
      var host = [r.container || r.publisher, r.year].filter(Boolean).join(', ');
      if (host) out.push(T(dot(host)));
    }
    if (link) out.push(T(link) + '.');
    return out.join(' ');
  }

  function harvard(r) {
    var k = kind(r);
    var n = r.authors.length;
    var hn = function (p) { return p.literal ? p.family : p.family + (p.given ? ', ' + initials(p.given, { space: false }) : ''); };
    var names = '';
    if (n === 1) names = hn(r.authors[0]);
    else if (n === 2 || n === 3) names = joinAnd(r.authors.map(hn), 'and', false);
    else if (n > 3) names = hn(r.authors[0]) + ' et al.';
    var out = [];
    var year = '(' + (r.year || 'no date') + ')';
    var link = doiLink(r);
    if (names) out.push(T(names), year);
    else out.push(year);
    if (k === 'book') {
      out.push(I(r.title) + '.');
      if (r.publisher) out.push(T(dot([r.place, r.publisher].filter(Boolean).join(': '))));
    } else {
      var parts = ['‘' + T(r.title) + '’'];
      if (r.container) parts.push(I(r.container));
      if (r.volume) parts.push(T(r.volume) + (r.issue ? '(' + T(r.issue) + ')' : ''));
      if (k !== 'journal' && r.publisher) parts.push(T(r.publisher));
      if (r.pages) parts.push((isRange(r.pages) ? 'pp. ' : 'p. ') + T(pageRange(r.pages)));
      out.push(parts.join(', ') + '.');
    }
    if (link) out.push('Available at: ' + T(link) + '.');
    return out.join(' ');
  }

  function vancouver(r, num) {
    var k = kind(r);
    var n = r.authors.length;
    var names = n > 6 ? r.authors.slice(0, 6).map(nameVancouver).join(', ') + ', et al' : r.authors.map(nameVancouver).join(', ');
    var out = [];
    if (num) out.push(String(num) + '.');
    if (names) out.push(T(dot(names)));
    out.push(T(dot(r.title)));
    if (k === 'journal') {
      var s = T(r.shortContainer || r.container) + '.';
      s += ' ' + (r.year || '');
      if (r.volume) s += ';' + T(r.volume) + (r.issue ? '(' + T(r.issue) + ')' : '');
      if (r.pages) s += ':' + T(nlmPages(r.pages));
      out.push(s + '.');
    } else if (k === 'book') {
      out.push(T(dot([r.place, r.publisher].filter(Boolean).join(': ') + (r.year ? '; ' + r.year : ''))));
    } else {
      var host = [r.container, r.publisher].filter(Boolean).join('. ');
      var tail = [host, r.year].filter(Boolean).join('; ');
      if (tail) out.push(T(dot(tail)));
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
    var out = [];
    if (num) out.push('[' + num + ']');
    if (names) out.push(T(names) + ',');
    var mon = r.month ? MONTHS_ABBR[r.month - 1] + ' ' : '';
    var link = doiLink(r);
    if (k === 'book') {
      out.push(I(r.title) + '.');
      var pub = [r.place, r.publisher].filter(Boolean).join(': ');
      out.push(T(dot([pub, r.year].filter(Boolean).join(', '))));
    } else {
      var parts = ['“' + T(r.title) + ',”'];
      var rest = [];
      if (k === 'chapter' || k === 'proceedings') rest.push('in ' + I(r.container));
      else if (r.container) rest.push(I(r.container));
      if (r.volume) rest.push('vol. ' + T(r.volume));
      if (r.issue) rest.push('no. ' + T(r.issue));
      if (r.pages) rest.push((isRange(r.pages) ? 'pp. ' : 'p. ') + T(pageRange(r.pages)));
      if (k !== 'journal' && r.publisher) rest.push(T(r.publisher));
      if (r.year) rest.push(mon + T(r.year));
      if (r.doi) rest.push('doi: ' + T(r.doi));
      out.push(parts.join(' ') + (rest.length ? ' ' + rest.join(', ') : '') + '.');
    }
    if (!r.doi && link) out.push('[Online]. Available: ' + T(link));
    return out.join(' ');
  }

  /* ---------- machine formats (plain text) ---------- */

  function bibKey(r) {
    var fam = r.authors.length ? r.authors[0].family : (r.container || 'ref');
    var word = (r.title.match(/[A-Za-z]{3,}/g) || []).filter(function (w) {
      return !/^(the|and|for|with|from|into|over|under|that|this|are|was|were|its|our|their)$/i.test(w);
    })[0] || '';
    return (fam + (r.year || '') + word).replace(/[^A-Za-z0-9]/g, '');
  }
  function bibEsc(s) { return String(s).replace(/([&%$#_])/g, '\\$1'); }

  function bibtex(r) {
    var k = kind(r);
    var type = { journal: 'article', chapter: 'incollection', book: 'book', proceedings: 'inproceedings',
      thesis: 'phdthesis', report: 'techreport' }[k] || 'misc';
    var f = [];
    var add = function (key, val) { if (val) f.push('  ' + key + ' = {' + bibEsc(val) + '}'); };
    add('title', r.title);
    add('author', r.authors.map(nameLastFull).join(' and '));
    add('editor', r.editors.map(nameLastFull).join(' and '));
    if (k === 'journal') add('journal', r.container);
    else if (k === 'chapter' || k === 'proceedings') add('booktitle', r.container);
    else if (r.container) add('howpublished', r.container);
    add('volume', r.volume);
    add('number', r.issue);
    add('pages', r.pages ? enDash(r.pages).replace('–', '--') : '');
    add('year', r.year);
    if (r.month) add('month', MONTHS_ABBR[r.month - 1].replace('.', '').toLowerCase());
    add('publisher', r.publisher);
    add('address', r.place);
    add('issn', r.issn);
    add('isbn', r.isbn);
    add('doi', r.doi);
    add('url', doiLink(r));
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
    r.authors.forEach(function (p) { add('AU', nameLastFull(p)); });
    r.editors.forEach(function (p) { add('ED', nameLastFull(p)); });
    add('TI', r.title);
    add('T2', r.container);
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
    r.authors.forEach(function (p) { add('%A', nameLastFull(p)); });
    r.editors.forEach(function (p) { add('%E', nameLastFull(p)); });
    add('%T', r.title);
    if (k === 'journal') add('%J', r.container);
    else add('%B', r.container);
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
    { id: 'ieee', label: 'IEEE', fn: ieee, rich: true }
  ];
  var EXPORTS = [
    { id: 'bibtex', label: 'BibTeX', fn: bibtex, ext: 'bib' },
    { id: 'ris', label: 'RIS', fn: ris, ext: 'ris' },
    { id: 'endnote', label: 'EndNote tagged', fn: endnote, ext: 'enw' }
  ];

  function format(record, styleId) {
    var r = record.authors ? record : normalize(record);
    var all = STYLES.concat(EXPORTS);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === styleId) {
        var out = all[i].fn(r);
        return all[i].rich ? stripTags(out) : out;
      }
    }
    throw new Error('Unknown style: ' + styleId);
  }

  function formatHtml(record, styleId) {
    var r = record.authors ? record : normalize(record);
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === styleId) return STYLES[i].fn(r);
    throw new Error('Unknown text style: ' + styleId);
  }

  /* ---------- matching confidence ---------- */

  function tokens(s) {
    return clean(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(function (w) { return w.length >= 3; });
  }

  // How well does a found record explain the reference text the user pasted? 0..1
  function matchConfidence(refText, record) {
    var r = record.authors ? record : normalize(record);
    var hay = ' ' + tokens(refText).join(' ') + ' ';
    var tt = tokens(r.title);
    if (!tt.length) return 0;
    var hit = tt.filter(function (w) { return hay.indexOf(' ' + w + ' ') !== -1; }).length;
    var score = hit / tt.length;
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
    normalize: normalize,
    kind: kind,
    format: format,
    formatHtml: formatHtml,
    stripTags: stripTags,
    matchConfidence: matchConfidence,
    STYLES: STYLES,
    EXPORTS: EXPORTS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AutoDOI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
