var ROOT = require('path').resolve(__dirname, '..');
// The command line, run offline: fetch is stubbed with the fixture record for 10.1038/nature12373 and a Crossref search that
// returns it, so the formatting, the matching path, the grades and the exit codes are checked without the network.
var fs = require('fs'), path = require('path');
var cli = require(path.join(ROOT, 'bin', 'autodoi.js'));
var work = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'w.json'), 'utf8'));
let pass = 0, fail = 0;
const eq = (label, got, exp) => { if (got === exp) pass++; else { fail++; console.log('FAIL', label, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(exp)); } };
var calls = [];
global.fetch = async function (url, opts) {
  calls.push(url);
  var ok = function (body, type) { return { ok: true, status: 200, headers: { get: function () { return type || 'application/json'; } }, json: async function () { return body; } }; };
  var bad = function (status) { return { ok: false, status: status, headers: { get: function () { return 'text/html'; } }, json: async function () { throw new Error('no'); } }; };
  if (/api\.crossref\.org\/works\/10\.1038%2Fnature12373/.test(url)) return ok(work);
  if (/api\.crossref\.org\/works\//.test(url)) return bad(404);
  if (/api\.crossref\.org\/works\?/.test(url)) return ok({ message: { items: /Nanometre|thermometry/i.test(decodeURIComponent(url)) ? [work.message] : [] } });
  if (/doi\.org\//.test(url)) return bad(404);
  return bad(404);
};
function io(stdin) { var o = { outs: [], errs: [], stdin: async function () { return stdin || ''; } }; o.out = function (s) { o.outs.push(s); }; o.err = function (s) { o.errs.push(s); }; return o; }
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
  eq('no arguments: usage and exit 2', code === 2 && /autodoi 10\.1038\/nature12373/.test(t.outs[0]), true);
  // matching
  var refs = 'Kucsko G, Maurer PC, Yao NY, et al. Nanometre-scale thermometry in a living cell. Nature. 2013;500(7460):54-58.\nSmith J. Something else entirely. Journal of Nothing. 2001;1:1-2.';
  t = io(refs); code = await cli.run(['--match', '--style', 'ris'], t);
  eq('match: the good row goes into the RIS, the other is reported', /TY  - JOUR/.test(t.outs[0]) && (t.outs[0].match(/ER  -/g) || []).length === 1 && t.errs.some(function (e) { return /^no match\tSmith J\./.test(e); }), true);
  eq('match exit 0 when lookups worked', code, 0);
  t = io(refs); await cli.run(['--match', '--json'], t);
  var j = JSON.parse(t.outs[0]);
  eq('match --json: grades and DOIs', j.length === 2 && j[0].grade === 'good' && j[0].record.doi === '10.1038/nature12373' && j[1].grade === 'none', true);
  t = io(); await cli.run(['--match', '--style', 'vancouver', 'Kucsko G, Maurer PC, Yao NY, et al. Nanometre-scale thermometry in a living cell. Nature. 2013;500(7460):54-58.'], t);
  eq('match from arguments in a numbered style', /^1\. Kucsko G/.test(t.outs[0]), true);
  eq('splitRefs: blank lines join wrapped lines', cli.splitRefs('A b\nc d\n\nE f').length, 2);
  eq('splitRefs: one per line otherwise', cli.splitRefs('A\nB\nC').length, 3);
  console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})();
