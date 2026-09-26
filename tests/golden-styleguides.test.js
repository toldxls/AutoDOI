// Oracle: reference examples published by the style authorities themselves (APA, MLA, Chicago, NLM's Citing
// Medicine for Vancouver, the IEEE Reference Guide), collected verbatim with their source URLs into
// tests/fixtures/golden-examples.json, rebuilt from their metadata and compared exactly.
// Usage: node tests/golden-styleguides.test.js [--all]   (--all prints every mismatch, not the first 12)
var fs = require('fs'), path = require('path');
var ROOT = path.resolve(__dirname, '..');
var A = require(path.join(ROOT, 'citations.js'));
var FILE = path.join(__dirname, 'fixtures', 'golden-examples.json');
if (!fs.existsSync(FILE)) { console.log('no fixture at ' + FILE + '\n0 passed, 0 failed'); process.exit(0); }
var examples = JSON.parse(fs.readFileSync(FILE, 'utf8'));
var showAll = process.argv.indexOf('--all') !== -1;
var STYLE = { apa: 'apa', mla: 'mla', 'chicago-nb': 'chicago', vancouver: 'vancouver', ieee: 'ieee', harvard: 'harvard' }; // chicago-ad: not implemented
var TYPE = { 'journal-article': 'journal-article', book: 'book', 'edited-book': 'edited-book', 'book-chapter': 'book-chapter', webpage: 'webpage', preprint: 'posted-content',
  dissertation: 'dissertation', 'conference-paper': 'proceedings-article', dataset: 'dataset', report: 'report', other: 'other' };
var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function person(p) {
  if (!p) return null;
  if (p.literal) return { family: p.literal, given: '', suffix: '', literal: true };
  if (!p.family && p.given) return { family: p.given, given: '', suffix: '', literal: true };
  return { family: p.family || '', given: p.given || '', suffix: p.suffix || '', literal: false };
}
function monthNum(m) { if (!m) return 0; if (/^\d+$/.test(String(m))) return Number(m); var k = String(m).slice(0, 3).toLowerCase(); return MONTHS[k] || 0; }
function accessed(a) {
  if (!a) return null;
  var iso = String(a).match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (iso) return { year: +iso[1], month: +iso[2], day: +iso[3] };
  var us = String(a).match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/); if (us) return { year: +us[3], month: monthNum(us[1]), day: +us[2] };
  var uk = String(a).match(/(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})/); if (uk) return { year: +uk[3], month: monthNum(uk[2]), day: +uk[1] };
  var y = String(a).match(/\d{4}/); return y ? { year: +y[0], month: 0, day: 0 } : null;
}
function record(ex) {
  // Crossref-shaped input through the same normalize() the app uses, so names, dates, article numbers and
  // subtitles take the real path; only what Crossref has no field for is set afterwards
  var m = ex.metadata || {};
  var ppl = function (list) { return (list || []).map(function (p) { return p.literal ? { name: p.literal } : (!p.family && p.given) ? { name: p.given } : { family: p.family || '', given: p.given || '', suffix: p.suffix || undefined }; }); };
  var date = m.year ? [[Number(m.year)].concat(monthNum(m.month) ? [monthNum(m.month)].concat(m.day ? [Number(m.day)] : []) : [])] : undefined;
  var acc = accessed(m.accessed);
  var msg = {
    type: TYPE[ex.kind] || 'other', title: [m.title || ''], subtitle: m.subtitle ? [m.subtitle] : undefined,
    author: ppl(m.authors), editor: ppl(m.editors), 'container-title': m.container ? [m.container] : undefined,
    issued: date ? { 'date-parts': date } : undefined, volume: m.volume ? String(m.volume) : undefined, issue: m.issue ? String(m.issue) : undefined,
    page: m.pages ? String(m.pages) : undefined, 'article-number': m.articleNumber ? String(m.articleNumber) : undefined,
    publisher: m.publisher || undefined, 'publisher-location': m.place || undefined, 'edition-number': m.edition ? String(m.edition) : undefined,
    DOI: m.doi || undefined, URL: m.url || undefined, institution: m.institution ? [{ name: m.institution }] : undefined, degree: m.genre ? [m.genre] : undefined,
    'number-of-pages': m.numPages ? String(m.numPages) : undefined, database: m.database || undefined, accession: m.accession || undefined, accessed: acc ? { 'date-parts': [[acc.year].concat(acc.month ? [acc.month].concat(acc.day ? [acc.day] : []) : [])] } : undefined
  };
  Object.keys(msg).forEach(function (k) { if (msg[k] === undefined) delete msg[k]; });
  var r = A.normalize(msg);
  if (m.number && !r.number) r.number = String(m.number);
  if (m.numPages && !r.numPages) r.numPages = String(m.numPages);
  if (ex.kind === 'dissertation' && !r.genre) r.genre = 'Ph.D.';
  // the source printed "et al." for a list longer than it gave: the metadata is a truncated list, as an RIS "and others" would be
  if (/\bet al\b/.test(ex.expected) && r.authors.length && r.authors.length < 7) r.authorsOthers = true;
  return r;
}
// Examples whose printed form needs a datum no source AutoDOI reads (Crossref, OpenAlex, doi.org, RIS/BibTeX files) can supply.
// They are reported, not silently passed, so the list stays visible.
var NOT_APPLICABLE = [
  [/\bc\d{4}\b/, 'copyright-only year'],
  [/\b(Winter|Spring|Summer|Fall|Autumn)\b/i, 'season in the date'],
  [/Effective |Last modified /, 'a labelled date taken from the page wording'],
  [/Translated by/, 'translators'],
  [/\. Cartoon\./, 'an untitled work described by genre'],
  [/\[Conference presentation\]|presented at the/, 'a presentation, which the data cannot tell from a proceedings paper'],
  [/ICPSR \d+; Version/, 'a dataset accession number and version'],
  [/\(Applied Mathematics Series 55\)/, 'a series in an edited-book entry with pages'],
  [/[A-Z][a-z]{2,8}\.? \d{1,2}[\u2013-]\d{1,2}, \d{4}/, 'a day range'],
  [/PubMed PMID/, 'PubMed identifiers'],
  [/edited by [^,]+ et al\., Oxford UP, Nov\. 2015/, 'three editors the source lists as one plus et al.'],
  [/Eds\. Human Biology of Pastoral Populations/, 'the IEEE guide prints edited books both as "Eds., Title" and "Eds. Title"; AutoDOI uses the first']
];
function tidy(s, st) { var t = String(s).replace(/\*/g, '').replace(/\s+/g, ' ').normalize('NFC').trim(); return st === 'mla' ? t.replace(/(\d)[\u2013-](\d)/g, '$1-$2') : t; } // MLA's own examples mix hyphens and en dashes in page ranges
function loose(s) { return tidy(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-').replace(/\.$/, '').toLowerCase(); }
var pass = 0, fail = 0, nearly = 0, skipped = 0, shown = 0, perStyle = {}, na = [];
// The in-text forms the same pages print: APA's parenthetical and narrative citations are printed jointly for a group of
// examples ("(Grady et al., 2019; Pope & Wall, 2025)"), so each example's own form must be one of the segments; Chicago's
// notes carry a page locator, read back out of the printed note so the same note can be rebuilt with it
function noteLocator(note) { var m = note.match(/(?:\(\d{4}\)|\d{4}\)): ([\d\u2013-]+)(?:, e\d+)?[,.]/) || note.match(/\d{4}\), ([\d\u2013-]+)[,.]/); return m ? m[1] : ''; }
function checkInText(ex, i, st, r) {
  if (!ex.inText) return;
  var label = 'in-text #' + i + ' ' + st + ' ' + ex.kind;
  if (st === 'apa') {
    var forms = A.inTextForms(r, 'apa', {});
    var segs = tidy(ex.inText).replace(/^\(|\)$/g, '').split(/;\s*/);
    if (segs.indexOf(tidy(forms.paren).replace(/^\(|\)$/g, '')) !== -1) pass++; else { fail++; console.log('FAIL ' + label + '\n   got  ' + forms.paren + '\n   want one of ' + ex.inText); }
    if (ex.inTextNarrative) { if (tidy(ex.inTextNarrative).indexOf(tidy(forms.narrative)) !== -1) pass++; else { fail++; console.log('FAIL ' + label + ' narrative\n   got  ' + forms.narrative + '\n   want in ' + ex.inTextNarrative); } }
  } else if (st === 'chicago') {
    var want = tidy(ex.inText).replace(/^\d+\.\s+/, '');
    if (/Rachel A\. Bay/.test(want)) { na.push(st + ' #' + i + ' note: the guide\'s note misspells the author its bibliography entry prints as Rachael'); return; }
    var got = tidy(A.inTextForms(r, 'chicago', { pages: noteLocator(want) }).note);
    if (got === want) pass++; else { fail++; if (showAll || shown++ < 12) console.log('FAIL ' + label + ' note\n   got  ' + got + '\n   want ' + want); }
  }
}
examples.forEach(function (ex, i) {
  var st = STYLE[ex.style];
  if (!st) { skipped++; return; }
  perStyle[st] = perStyle[st] || { pass: 0, fail: 0 };
  for (var q = 0; q < NOT_APPLICABLE.length; q++) if (NOT_APPLICABLE[q][0].test(tidy(ex.expected))) { na.push(st + ' #' + i + ': ' + NOT_APPLICABLE[q][1]); return; }
  // Citing Medicine lists every author by default and gives "six, then et al." as the option AutoDOI follows (ICMJE, PubMed)
  if (st === 'vancouver' && ((ex.metadata || {}).authors || []).filter(function (p) { return p && !p.literal; }).length > 6 && !/\bet al\b/.test(ex.expected)) { na.push(st + ' #' + i + ': Citing Medicine\'s list-every-author option'); return; }
  var got;
  try { got = A.format(record(ex), st); } catch (e) { fail++; perStyle[st].fail++; console.log('FAIL #' + i + ' ' + st + ' throws: ' + e.message); return; }
  checkInText(ex, i, st, record(ex));
  var want = tidy(ex.expected, st);
  if (tidy(got, st) === want) { pass++; perStyle[st].pass++; return; }
  fail++; perStyle[st].fail++;
  if (loose(got) === loose(want)) nearly++;
  if (showAll || shown++ < 12) console.log('FAIL #' + i + ' ' + st + ' ' + ex.kind + (loose(got) === loose(want) ? ' (punctuation/quotes only)' : '') + '\n   got  ' + tidy(got, st) + '\n   want ' + want + '\n   src  ' + ex.source);
});
Object.keys(perStyle).forEach(function (st) { console.log(st + ': ' + perStyle[st].pass + ' exact, ' + perStyle[st].fail + ' off'); });
if (skipped) console.log(skipped + ' examples in styles this library does not implement (chicago-ad) were skipped');
if (na.length) console.log(na.length + ' examples need data no source supplies and are not counted: ' + na.join('; '));
if (nearly) console.log(nearly + ' of the mismatches differ only in quotes, dashes or a final period');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
