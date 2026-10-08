var ROOT = require('path').resolve(__dirname, '..');
// The command line, run offline: fetch is stubbed with the fixture record for 10.1038/nature12373 and a Crossref search that
// returns it, so the formatting, the matching path, the grades and the exit codes are checked without the network.
var fs = require('fs'), path = require('path');
var cli = require(path.join(ROOT, 'bin', 'autodoi.js'));
var A = require(path.join(ROOT, 'citations.js'));
var work = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'w.json'), 'utf8'));
let pass = 0, fail = 0;
const eq = (label, got, exp) => { if (got === exp) pass++; else { fail++; console.log('FAIL', label, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(exp)); } };
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
  eq('the usage names the exit codes and how --match splits its input', /0 done, 1 a lookup failed, 2 bad usage, 3 --match/.test(t.outs[0]) && /one reference per line, or one per paragraph when blank lines separate them/.test(t.outs[0]), true);
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
  eq('splitRefs: blank lines join wrapped lines', cli.splitRefs('A b\nc d\n\nE f').length, 2);
  eq('splitRefs: one per line otherwise', cli.splitRefs('A\nB\nC').length, 3);
  eq('the suite runs without real waiting (the throttle is injected)', Date.now() - t0 < 2000, true);
  console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})();
