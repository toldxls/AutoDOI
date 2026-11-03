var ROOT = require('path').resolve(__dirname, '..');
// The command line, run offline: fetch is stubbed with the fixture record for 10.1038/nature12373 and a Crossref search that
// returns it, so the formatting, the matching path, the grades and the exit codes are checked without the network.
var fs = require('fs'), path = require('path');
var cli = require(path.join(ROOT, 'bin', 'autodoi.js'));
var A = require(path.join(ROOT, 'citations.js'));
var work = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'w.json'), 'utf8'));
let pass = 0, fail = 0;
const eq = (label, got, exp) => { if (got === exp || (typeof exp === 'object' && JSON.stringify(got) === JSON.stringify(exp))) pass++; else { fail++; console.log('FAIL', label, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(exp)); } };
var calls = [], optsSeen = [], failNext = null; // failNext: an error the next fetch throws instead of answering (a timed-out request)
var sleeps = []; cli.sleep = async function (ms) { sleeps.push(ms); }; // no real waiting: the Crossref throttle and the retry pauses are recorded instead
global.fetch = async function (url, opts) {
  calls.push(url); optsSeen.push(opts);
  if (failNext) { var e = failNext; failNext = null; throw e; }
  var ok = function (body, type) { return { ok: true, status: 200, headers: { get: function () { return type || 'application/json'; } }, json: async function () { return body; } }; };
  var bad = function (status) { return { ok: false, status: status, headers: { get: function () { return 'text/html'; } }, json: async function () { throw new Error('no'); } }; };
  if (/api\.crossref\.org\/works\/10\.1038%2Fnature12373/.test(url)) return ok(work);
  if (/api\.crossref\.org\/works\//.test(url)) return bad(404);
  if (/api\.crossref\.org\/works\?/.test(url)) return ok({ message: { items: /Nanometre|thermometry/i.test(decodeURIComponent(url)) ? [work.message] : [] } });
  if (/doi\.org\//.test(url)) return bad(404);
  if (/openlibrary\.org\/search\.json\?isbn=9780198534532&fields=/.test(url)) return ok({ docs: [{ key: '/works/OL1W', title: 'Introduction to the Theory of Numbers', author_name: ['G. H. Hardy', 'E. M. Wright'], publisher: ['Clarendon Press'], publish_place: ['Oxford'], first_publish_year: 1938, number_of_pages_median: 426, isbn: ['9780198534532'] }] });
  if (/openlibrary\.org/.test(url)) return ok({ docs: [] });
  return bad(404);
};
function io(stdin) { var o = { outs: [], errs: [], stdin: async function () { return stdin || ''; } }; o.out = function (s) { o.outs.push(s); }; o.write = function (s) { o.outs.push(s); }; o.err = function (s) { o.errs.push(s); }; return o; }
var t0 = Date.now();
(async function () {
  var t = io(); var code = await cli.run(['10.1038/nature12373'], t);
  eq('a DOI formats in APA by default', t.outs[0].indexOf('Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., & Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. Nature, 500(7460), 54–58. https://doi.org/10.1038/nature12373'), 0);
  eq('exit 0', code, 0);
  eq('the request went to Crossref only', calls.every(function (u) { return /api\.crossref\.org/.test(u); }), true);
  t = io(); await cli.run(['https://doi.org/10.1038/nature12373', '--style', 'vancouver', '--email', 'me@example.org'], t);
  eq('a doi.org link and a style', /^Kucsko G, Maurer PC, Yao NY, Kubo M, Noh HJ, Lo PK, et al\. Nanometre-scale thermometry/.test(t.outs[0]), true);
  eq('the email goes to Crossref as mailto', calls.some(function (u) { return /mailto=me%40example\.org/.test(u); }), true);
  t = io(); await cli.run(['10.1038/nature12373', '--style', 'ris'], t);
  eq('RIS export', /^TY  - JOUR\r?\n/.test(t.outs[0]) && /DO  - 10\.1038\/nature12373/.test(t.outs[0]), true);
  t = io(); await cli.run(['10.1038/nature12373', '--style', 'apa', '--pages', '55'], t);
  eq('pages add the in-text citation after the reference', t.outs[0].split('\n').pop(), '(Kucsko et al., 2013, p. 55)');
  t = io(); await cli.run(['10.1038/nature12373', '--style', 'all'], t);
  eq('all styles', /APA 7th:/.test(t.outs[0]) && /IEEE:/.test(t.outs[0]) && /BibTeX:/.test(t.outs[0]) && /in text: \(Kucsko et al\. 2013\)/.test(t.outs[0]), true);
  t = io(); await cli.run(['10.1038/nature12373', '--json'], t);
  eq('JSON record', JSON.parse(t.outs[0])[0].doi, '10.1038/nature12373');
  t = io(); code = await cli.run(['10.9999/nope'], t);
  eq('an unknown DOI: message on stderr and exit 1', code === 1 && /10\.9999\/nope: DOI not found/.test(t.errs[0]), true);
  t = io(); code = await cli.run(['10.1038/nature12373', '--style', 'nope'], t);
  eq('an unknown style: exit 2', code === 2 && /Unknown style/.test(t.errs[0]), true);
  t = io(); code = await cli.run([], t);
  eq('no arguments: usage on stderr and exit 2', code === 2 && /autodoi 10\.1038\/nature12373/.test(t.errs[0]) && t.outs.length === 0, true);
  t = io(); code = await cli.run(['--help'], t);
  eq('--help: usage on stdout and exit 0', code === 0 && /autodoi 10\.1038\/nature12373/.test(t.outs[0]) && t.errs.length === 0, true);
  eq('the usage names the exit codes and how --match splits its input', /0 done, 1 a lookup failed, 2 bad usage, 3 --match/.test(t.outs[0]) && /the list split as the page splits it/.test(t.outs[0]) && /--split lines\|blank\|numbered/.test(t.outs[0]), true);
  eq('the usage ends with the comment block, not the code', /openlibrary\.org\.$/.test(t.outs[0].trim()) && !/require\(/.test(t.outs[0]), true);
  t = io(); code = await cli.run(['10.1038/nature12373', '--email', 'not-an-address'], t);
  eq('a malformed --email: exit 2 before any request', code === 2 && /--email .*not-an-address/.test(t.errs[0]), true);
  eq('every request carries a timeout signal', optsSeen.length > 0 && optsSeen.every(function (o) { return o && o.signal instanceof AbortSignal; }), true);
  calls = []; sleeps = []; failNext = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  t = io(); code = await cli.run(['10.1038/nature12373'], t);
  eq('a timed-out request is retried after a pause, like a 5xx', code === 0 && calls.length === 2 && sleeps.indexOf(2000) !== -1 && /^Kucsko, G\./.test(t.outs[0]), true);
  // matching
  var refs = 'Kucsko G, Maurer PC, Yao NY, et al. Nanometre-scale thermometry in a living cell. Nature. 2013;500(7460):54-58.\nSmith J. Something else entirely. Journal of Nothing. 2001;1:1-2.';
  t = io(refs); code = await cli.run(['--match', '--style', 'ris'], t);
  eq('match: the good row goes into the RIS, the other is reported', /TY  - JOUR/.test(t.outs[0]) && (t.outs[0].match(/ER  -/g) || []).length === 1 && t.errs.some(function (e) { return /^no match\tSmith J\./.test(e); }), true);
  eq('match exit 3 when a reference stayed unmatched, though every lookup worked', code, 3);
  t = io(refs); code = await cli.run(['--match', '--json'], t);
  eq('match --json exit 3 for the same list', code, 3);
  t = io(); code = await cli.run(['--match', '--style', 'all', 'Nanometre-scale thermometry in a living cell'], t);
  eq('--match with --style all: exit 2 up front, no lookup', code === 2 && /--style all/.test(t.errs[0]) && !calls.some(function (u) { return /query\.bibliographic=Nanometre/.test(u); }), true);
  t = io(); code = await cli.run(['--match', '--pages', '55', 'Kucsko G, Maurer PC, Yao NY, et al. Nanometre-scale thermometry in a living cell. Nature. 2013;500(7460):54-58.'], t);
  eq('--pages with --match: a note on stderr, the reference still printed, exit 0', code === 0 && /--pages is ignored with --match/.test(t.errs[0]) && /^Kucsko, G\./.test(t.outs[0]), true);
  t = io(refs + '\n' + refs.split('\n')[0]); code = await cli.run(['--match', '--style', 'bibtex'], t);
  eq('match --style bibtex streams the entries, a blank line between them, one line break at the end', t.outs.join('').replace(/\n$/, '').split('\n\n').length === 2 && /\}\n$/.test(t.outs.join('')) && code === 3, true);
  t = io(refs.split('\n')[0] + '\n' + refs.split('\n')[0]); code = await cli.run(['--match', '--style', 'ieee'], t);
  eq('numbered style counts the good matches as they stream', t.outs.length === 2 && /^\[1\]/.test(t.outs[0]) && /^\[2\]/.test(t.outs[1]) && code === 0, true);
  t = io(refs); await cli.run(['--match', '--json'], t);
  var j = JSON.parse(t.outs[0]);
  eq('match --json: grades and DOIs', j.length === 2 && j[0].grade === 'good' && j[0].record.doi === '10.1038/nature12373' && j[1].grade === 'none', true);
  t = io(); await cli.run(['--match', '--style', 'vancouver', 'Kucsko G, Maurer PC, Yao NY, et al. Nanometre-scale thermometry in a living cell. Nature. 2013;500(7460):54-58.'], t);
  eq('match from arguments in a numbered style', /^1\. Kucsko G/.test(t.outs[0]), true);
  t = io(); code = await cli.run(['--match', 'Kucsko G, Maurer PC, Yao NY, et al. Nanometre-scale thermometry in a living cell. Nature. 2013;500(7460):54-58.'], t);
  eq('match from arguments in the default APA style prints the reference', code === 0 && t.outs.length === 1 && /^Kucsko, G\., Maurer, P\. C\./.test(t.outs[0]), true);
  t = io(); t.tty = function () { return true; }; code = await cli.run(['--match'], t);
  eq('match with nothing on a terminal stdin: a message and exit 2, not a wait', code === 2 && t.errs[0] === 'Nothing to match: pipe references on stdin or give them as arguments.', true);
  // an ISBN goes to the Open Library work search, whose record shape carries the names, year, publisher and place
  t = io(); code = await cli.run(['978-0-19-853453-2'], t);
  eq('ISBN: author, year, publisher and place from the Open Library work search', t.outs[0], 'Hardy, G. H., & Wright, E. M. (1938). Introduction to the Theory of Numbers. Clarendon Press.');
  eq('ISBN exit 0', code, 0);
  eq('ISBN: the search endpoint with the fields A.fromOpenLibrary reads', calls.some(function (u) { return /openlibrary\.org\/search\.json\?isbn=9780198534532&fields=key,title,subtitle,author_name,publisher,first_publish_year,publish_year,publish_place,number_of_pages_median,isbn$/.test(u); }), true);
  eq('the usage example ISBN has a valid check digit', A.extractIsbn(fs.readFileSync(path.join(ROOT, 'bin', 'autodoi.js'), 'utf8').match(/97[89][-\d]+/)[0]), '9780198534532');
  // options
  t = io(); code = await cli.run(['10.1038/nature12373', '--sytle', 'apa'], t);
  eq('an unknown option: named on stderr and exit 2', code === 2 && /^Unknown option --sytle/.test(t.errs[0]), true);
  t = io(); code = await cli.run(['10.1038/nature12373', '--style'], t);
  eq('a value-taking flag without a value: exit 2', code === 2 && /^Option --style needs a value/.test(t.errs[0]), true);
  t = io(); code = await cli.run(['--match', '--email'], t);
  eq('--email without a value: exit 2', code === 2 && /^Option --email needs a value/.test(t.errs[0]), true);
  eq('parseArgs: -p at the end is an error, not pages "undefined"', cli.parseArgs(['x', '-p']).error, 'Option -p needs a value');
  // the page's splitter (splitter.js): tests/splitter.test.js holds its cases; these check the command line reaches it
  var abel = 'Abel, A. (2001) First title. J Chem 1, 1.', baker = 'Baker, B. (2002) Second title. J Chem 2, 2.', cole = 'Cole, C. (2003) Third title. J Chem 3, 3.';
  eq('splitRefs: blank lines set wrapped references apart', cli.splitRefs('Abel, A. (2001) First title that\nwraps. J Chem 1, 1.\n\nBaker, B. (2002) Second title that\nwraps. J Chem 2, 2.').length, 2);
  eq('splitRefs: one per line', cli.splitRefs([abel, baker, cole].join('\n')), [abel, baker, cole]);
  eq('splitRefs: a list\'s numbers are dropped', cli.splitRefs(['1. ' + abel, '2. ' + baker, '[3] ' + cole].join('\n')), [abel, baker, cole]);
  eq('splitRefs: a year that opens a reference is kept', cli.splitRefs('2019. Abel, A. First title. J Chem 1, 1.'), ['2019. Abel, A. First title. J Chem 1, 1.']);
  eq('splitRefs: two references run together on one line are cut apart, as on the page', cli.splitRefs('A. Smith, Phys. Rev. B 12 (1990) 100; B. Jones, Phys. Rev. B 13 (1991) 200.'), ['A. Smith, Phys. Rev. B 12 (1990) 100;', 'B. Jones, Phys. Rev. B 13 (1991) 200.']);
  eq('splitRefs: a split mode, as the page\'s menu', cli.splitRefs('Abel, A. (2001) First title that\nwraps. J Chem 1, 1.', 'lines').length, 2);
  t = io(); code = await cli.run(['--match', '--split', 'paragraphs', abel], t);
  eq('--split with an unknown mode: exit 2, naming the modes', [code, /--split takes one of auto, lines, blank, numbered/.test(t.errs[0])], [2, true]);
  eq('splitRefs: an indented line continues the line above (a PDF\'s hanging indent)', cli.splitRefs('Smith, J. (2020) A title that wraps\n onto a second line. J 1, 1.\nJones, K. (2021) Another. J 2, 2.'), ['Smith, J. (2020) A title that wraps onto a second line. J 1, 1.', 'Jones, K. (2021) Another. J 2, 2.']);
  // A manuscript as the argument: its reference list is read and matched; the Word file's paragraphs and the PDF's hanging indent give one reference each
  t = io(); code = await cli.run(['--match', '--style', 'apa', path.join(__dirname, 'fixtures', 'manuscript.docx')], t);
  eq('--match manuscript.docx matches its two references, the one Crossref holds as good', [code, t.outs.length, /^Kucsko, G\./.test(t.outs[0]), t.errs.length === 1 && /Attention is all you need/.test(t.errs[0])], [3, 1, true, true]);
  var pdfFile = path.join(require('os').tmpdir(), 'autodoi-cli-' + process.pid + '.pdf');
  fs.writeFileSync(pdfFile, require('./pdf-writer.js').manuscript({ compress: true, encrypt: 'aes' }));
  t = io(); code = await cli.run(['--match', '--json', pdfFile], t);
  var rows = JSON.parse(t.outs[0]);
  eq('--match paper.pdf reads the list after References, a wrapped entry as one reference', [code, rows.length, rows[0].text, rows[0].grade], [3, 2, 'Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., and Lukin, M. D. (2013) Nanometre-scale thermometry in a living cell. Nature, 500, 54\u201358.', 'good']);
  fs.writeFileSync(pdfFile, Buffer.from('%PDF-1.4\n%%EOF\n'));
  t = io(); code = await cli.run(['--match', pdfFile], t);
  eq('an unreadable manuscript: named on stderr and exit 2', code === 2 && /^Could not read .*autodoi-cli-\d+\.pdf: no pages found/.test(t.errs[0]), true, t.errs[0]);
  t = io(); code = await cli.run(['--match', pdfFile, 'Some reference text'], t);
  eq('a manuscript beside reference text is bad usage', code === 2 && /either manuscripts .* or references/.test(t.errs[0]), true);
  // A flush list, one entry per line, with a wider gap in it: each line is a reference, alone and beside a Word file (whose
  // paragraphs are set apart by blank lines, which must not join the PDF's lines)
  var flushLine = function (y, text) { return { x: 72, y: y, size: 9, text: text }; };
  fs.writeFileSync(pdfFile, require('./pdf-writer.js').pdf({ pages: [{ lines: [flushLine(720, 'References'), flushLine(700, 'Abel, A. (2001) First. J Chem 1, 1.'), flushLine(689, 'Baker, B. (2002) Second. J Chem 2, 2.'),
    flushLine(678, 'Cole, C. (2003) Third. J Chem 3, 3.'), flushLine(652, 'Dunn, D. (2004) Fourth. J Chem 4, 4.'), flushLine(641, 'Ernst, E. (2005) Fifth. J Chem 5, 5.')] }] }));
  t = io(); code = await cli.run(['--match', '--json', pdfFile], t);
  eq('--match on a flush PDF list: one reference per line, across a wider gap', JSON.parse(t.outs[0]).map(function (r) { return r.text.slice(0, 5); }), ['Abel,', 'Baker', 'Cole,', 'Dunn,', 'Ernst']);
  t = io(); code = await cli.run(['--match', '--json', path.join(__dirname, 'fixtures', 'manuscript.docx'), pdfFile], t);
  eq('--match on a Word file and a flush PDF: each file split on its own', JSON.parse(t.outs[0]).length, 7);
  t = io(); code = await cli.run(['--match', path.join(require('os').tmpdir(), 'no-such-manuscript-' + process.pid + '.pdf')], t);
  eq('a manuscript that is not there: named on stderr and exit 2, not sent to Crossref as a reference', [code, /^No such file: .*no-such-manuscript-\d+\.pdf$/.test(t.errs[0]), t.outs.length], [2, true, 0]);
  fs.unlinkSync(pdfFile);
  // Choosing among hits goes through A.matchPicker, as on the page: these are the page's own rules, reached from the command line
  var stub = global.fetch, oaWork = { id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1038/nature12373', title: 'Nanometre-scale thermometry in a living cell', display_name: 'Nanometre-scale thermometry in a living cell',
    authorships: [{ author: { display_name: 'G. Kucsko' } }], publication_year: 2013, type: 'article', primary_location: { source: { display_name: 'Nature' } }, biblio: { volume: '500', first_page: '54', last_page: '58' } };
  var answer = function (status, body) { return { ok: status === 200, status: status, headers: { get: function () { return 'application/json'; } }, json: async function () { return body; }, text: async function () { return JSON.stringify(body); } }; };
  var dataset = JSON.parse(JSON.stringify(work.message)); dataset.DOI = '10.5061/dryad.x1'; dataset.type = 'dataset'; dataset['container-title'] = [];
  global.fetch = async function (url, opts) { if (/api\.crossref\.org\/works\?/.test(url)) { calls.push(url); return answer(200, { message: { items: [dataset, work.message] } }); } return stub(url, opts); };
  t = io(); code = await cli.run(['--match', '--json', 'Kucsko G, Maurer PC (2013) Nanometre-scale thermometry in a living cell. Nature 500:54-58'], t);
  var got = JSON.parse(t.outs[0])[0];
  eq('a dataset Crossref lists before the paper, with the same title: the paper wins, the dataset is the runner-up', [got.record.doi, got.grade, got.alt && got.alt.record.doi], ['10.1038/nature12373', 'good', '10.5061/dryad.x1']);
  global.fetch = stub; calls = [];
  t = io(); code = await cli.run(['--match', '--json', 'Hardy GH, Wright EM (1938) An introduction to the theory of numbers. Clarendon Press, Oxford. ISBN 978-0-19-853453-2'], t);
  got = JSON.parse(t.outs[0])[0];
  eq('an ISBN in a reference is looked up as the book, without a search', [got.record.title, got.grade, calls.some(function (u) { return /query\.bibliographic/.test(u); })], ['Introduction to the Theory of Numbers', 'good', false]);
  var oaAsked = 0;
  global.fetch = async function (url, opts) {
    calls.push(url);
    if (/api\.crossref\.org\/works\?/.test(url)) return answer(200, { message: { items: [] } });
    if (/api\.openalex\.org\/works\?/.test(url)) { oaAsked++; return oaAsked === 1 ? answer(200, { results: [oaWork] }) : answer(429, { error: 'Rate limit exceeded' }); }
    return stub(url, opts);
  };
  calls = []; t = io(); code = await cli.run(['--match', '--json', '--email', 'me@example.org', 'Kucsko G (2013) Nanometre-scale thermometry in a living cell. Nature 500:54-58'], t);
  got = JSON.parse(t.outs[0])[0];
  eq('nothing at Crossref: OpenAlex is the second opinion, and its DOI is regraded on the Crossref record', [got.record.doi, got.record.source !== 'openalex', got.grade, code], ['10.1038/nature12373', true, 'good', 0]);
  eq('the email goes to OpenAlex too', calls.some(function (u) { return /api\.openalex\.org\/works\?.*mailto=me%40example\.org/.test(u); }), true);
  sleeps = []; t = io(); code = await cli.run(['--match', '--json', 'Abel A (2001) First title. J 1:1\nBaker B (2002) Second title. J 2:2'], t);
  eq('a 429 from OpenAlex: no waiting, no retry, and the rest of the run asks Crossref alone', [oaAsked, sleeps.filter(function (ms) { return ms >= 2000; }).length, JSON.parse(t.outs[0]).map(function (r) { return r.grade; }), code], [2, 0, ['none', 'none'], 3]);
  global.fetch = async function (url, opts) { calls.push(url); if (/api\.crossref\.org\/works\?/.test(url)) return answer(500, {}); return stub(url, opts); };
  sleeps = []; t = io(); code = await cli.run(['--match', '--json', 'Abel A (2001) First title. J 1:1'], t);
  eq('Crossref failing with nothing from OpenAlex is a failed lookup (exit 1), not "no match"', [JSON.parse(t.outs[0])[0].grade, code], ['error', 1]);
  oaAsked = 0; t = io(); code = await cli.run(['--match', '--json', 'Abel A (2001) First title. J 1:1'], t);
  eq('...and OpenAlex, once refused, is not asked again in the run', oaAsked, 0);
  global.fetch = stub;
  // a PubMed or PMC ID goes to Europe PMC for its DOI, then to Crossref
  global.fetch = async function (url, opts) {
    calls.push(url);
    if (/ebi\.ac\.uk\/europepmc\/webservices\/rest\/search/.test(url)) return answer(200, { resultList: { result: /23903748|PMC4221854/.test(decodeURIComponent(url)) ? [{ doi: '10.1038/nature12373' }] : [] } });
    return stub(url, opts);
  };
  calls = []; t = io(); code = await cli.run(['PMID:23903748', 'PMC4221854'], t);
  eq('a PubMed ID and a PMC ID: each resolved through Europe PMC, as the page asks it', [code, t.outs.length, /^Kucsko, G\./.test(t.outs[0]), calls.some(function (u) { return /query=EXT_ID%3A23903748%20AND%20SRC%3AMED/.test(u); }), calls.some(function (u) { return /query=PMCID%3APMC4221854/.test(u); })], [0, 2, true, true, true]);
  t = io(); code = await cli.run(['PMID:11111111'], t);
  eq('a PubMed ID Europe PMC has no DOI for: named on stderr, exit 1', [code, /PMID:11111111: No DOI known for 11111111/.test(t.errs[0])], [1, true]);
  global.fetch = stub;
  eq('the suite runs without real waiting (the throttle is injected)', Date.now() - t0 < 2000, true);
  console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})();
