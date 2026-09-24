// Oracle for DataCite DOIs (Zenodo, Figshare, Dryad, institutional repositories): the page gets their metadata as CSL JSON
// from doi.org.  120 random DataCite records (tests/fixtures/datacite-records.json) hold DataCite's own metadata as the
// truth and the CSL JSON as what the page receives; the normalised result must agree on title, creators, year,
// publisher and kind.  Usage: node tests/datacite-oracle.test.js [--verbose]
var fs = require('fs'), path = require('path');
var ROOT = path.resolve(__dirname, '..');
var A = require(path.join(ROOT, 'citations.js'));
var recs = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'datacite-records.json'), 'utf8'));
var verbose = process.argv.indexOf('--verbose') !== -1, pass = 0, fail = 0, problems = {}, notes = [];
function flag(rule, s) { fail++; (problems[rule] = problems[rule] || []).push(s); }
function check(rule, ok, s) { if (ok) pass++; else flag(rule, s); }
var SUBSUP = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
function norm(s) { return A.stripTags(String(s || '')).normalize('NFC').replace(/[₀-₉⁰¹²³⁴-⁹]/g, function (c) { return SUBSUP[c]; }).toLowerCase().replace(/[‐-―]/g, '-').replace(/[^a-z0-9À-ɏͰ-ϿЀ-ӿ一-鿿]+/g, ' ').trim(); }
var KIND = { Dataset: 'dataset', Software: 'software', Text: null, Preprint: 'preprint', JournalArticle: 'journal', Report: 'report', Dissertation: 'thesis', Book: 'book', BookChapter: 'chapter', ConferencePaper: 'proceedings', ConferenceProceeding: 'proceedings', Image: null, Other: null, Collection: null, Audiovisual: null, Model: null, PhysicalObject: null, Sound: null, Workflow: null, Instrument: null, StudyRegistration: null, Standard: 'standard', Journal: null, Event: null, InteractiveResource: null, OutputManagementPlan: null, PeerReview: null, Service: null, ComputationalNotebook: 'software' };
recs.forEach(function (x) {
  var d = x.datacite, got;
  try { got = A.normalize(x.csl); } catch (e) { flag('normalize throws on CSL JSON', x.doi + ' ' + e.message); return; }
  var id = x.doi;
  check('DOI', (got.doi || '').toLowerCase() === x.doi.toLowerCase(), id + ' got ' + got.doi);
  var wantTitle = (d.titles || []).filter(function (t) { return !t.titleType; })[0] || (d.titles || [])[0];
  if (wantTitle && wantTitle.title) check('title', norm(got.title) === norm(wantTitle.title) || norm(got.title).indexOf(norm(wantTitle.title)) === 0, id + ' got "' + got.title + '" want "' + wantTitle.title + '"');
  // the page renders the year doi.org sends; DataCite's own CSL sometimes disagrees with its publicationYear (a created date), which is noted, not failed
  var cslYear = x.csl.issued && x.csl.issued['date-parts'] && x.csl.issued['date-parts'][0] && x.csl.issued['date-parts'][0][0];
  if (cslYear) check('year as sent', String(got.year) === String(cslYear), id + ' got ' + got.year + ' csl ' + cslYear);
  if (d.publicationYear && cslYear && String(cslYear) !== String(d.publicationYear)) notes.push(id + ': DataCite says ' + d.publicationYear + ', its CSL JSON says ' + cslYear);
  var creators = d.creators || [];
  if (creators.length) {
    check('creator count', got.authors.length === creators.length, id + ' got ' + got.authors.length + ' want ' + creators.length);
    var c0 = creators[0], g0 = got.authors[0];
    if (g0) {
      var wantFam = c0.familyName || c0.name || '', wantGiven = c0.givenName || '';
      var ok = norm(g0.family) === norm(wantFam) || norm(wantFam).indexOf(norm(g0.family)) !== -1 || norm(c0.name || '').indexOf(norm(g0.family)) !== -1;
      var okName = ok || norm(g0.family + ' ' + g0.given).indexOf(norm(wantFam)) !== -1 || norm(wantFam + ' ' + wantGiven).indexOf(norm(g0.family)) !== -1;
      check('first creator name', okName, id + ' got "' + g0.family + '" / "' + g0.given + '" want "' + wantFam + '" / "' + wantGiven + '" (' + (c0.nameType || '') + ')');
      if (c0.nameType === 'Organizational') check('organisation kept whole', g0.literal && norm(g0.family) === norm(c0.name), id + ' got ' + JSON.stringify(g0) + ' want "' + c0.name + '"');
      if (c0.familyName && c0.givenName && !g0.literal) check('first creator given name', norm(g0.given) === norm(c0.givenName) || norm(g0.given).charAt(0) === norm(c0.givenName).charAt(0), id + ' got "' + g0.given + '" want "' + c0.givenName + '"');
    }
  }
  var pub = typeof d.publisher === 'object' && d.publisher ? d.publisher.name : d.publisher;
  if (pub) check('publisher or host present', norm(got.publisher + ' ' + got.institution + ' ' + got.container).indexOf(norm(pub)) !== -1, id + ' got pub "' + got.publisher + '" inst "' + got.institution + '" cont "' + got.container + '" want "' + pub + '"');
  var wantKind = d.types && KIND[d.types.resourceTypeGeneral];
  // DataCite's CSL JSON says 'article' for chapters and books and nothing at all for conference papers: only what it does say can be checked
  var cslLossy = (x.csl.type === 'article' && /^(BookChapter|Book|Text|Report|ConferencePaper)$/.test(d.types.resourceTypeGeneral)) || !x.csl.type;
  if (cslLossy && wantKind && A.kind(got) !== wantKind) notes.push(id + ': DataCite type ' + d.types.resourceTypeGeneral + ' sent as CSL "' + (x.csl.type || '') + '"');
  if (wantKind && !cslLossy) check('kind (' + d.types.resourceTypeGeneral + ')', A.kind(got) === wantKind || (wantKind === 'preprint' && A.kind(got) === 'journal') || (wantKind === 'proceedings' && A.kind(got) === 'chapter'), id + ' got ' + A.kind(got) + ' (' + got.type + ') want ' + wantKind + ' [' + (x.csl.type || '') + ']');
  if (d.container && d.container.title && wantKind === 'journal') check('journal', norm(got.container) === norm(d.container.title), id + ' got "' + got.container + '" want "' + d.container.title + '"');
  check('no leaked markup', !/<\/?[a-z]|&[a-z#]+;/i.test(got.title + got.container + got.publisher), id + ' ' + got.title);
  A.STYLES.forEach(function (st) { var out = A.format(got, st.id); check(st.id + ' output is sane', out.length > 10 && !/undefined|\[object/.test(out) && norm(out).indexOf(norm(got.title).split(' ').slice(0, 3).join(' ')) !== -1, id + ' ' + out.slice(0, 160)); });
});
Object.keys(problems).sort(function (a, b) { return problems[b].length - problems[a].length; }).forEach(function (rule) { console.log('FAIL ' + rule + '  (' + problems[rule].length + ')'); problems[rule].slice(0, verbose ? 40 : 3).forEach(function (s) { console.log('     ' + String(s).slice(0, 230)); }); });
if (notes.length) console.log(notes.length + ' records where DataCite\'s CSL JSON disagrees with its own metadata (the page can only render what doi.org sends): ' + notes.slice(0, 4).join('; ') + (notes.length > 4 ? '; …' : ''));
console.log(recs.length + ' DataCite records');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
