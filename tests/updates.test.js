var ROOT = require('path').resolve(__dirname, '..');
// Retractions, corrections and expressions of concern: read from Crossref's updated-by (Retraction Watch data included),
// OpenAlex's is_retracted, a RETRACTED: title prefix, and update-to on a notice.  Run: node tests/updates.test.js
const A = require(require('path').join(ROOT, 'citations.js'));
let pass = 0, fail = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) pass++; else { fail++; console.log('FAIL', label, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(exp)); } };
const jr = o => Object.assign({ type: 'journal-article', title: ['T'], 'container-title': ['J'], volume: '1', page: '1-2', issued: { 'date-parts': [[2020]] } }, o);

// As Crossref returns the Wakefield 1998 Lancet paper: a correction in 2004 and the 2010 retraction, both from Retraction Watch
var wakefield = jr({ title: ['RETRACTED: Ileal-lymphoid-nodular hyperplasia'], 'updated-by': [
  { DOI: '10.1016/s0140-6736(04)15715-2', type: 'correction', label: 'Correction', source: 'retraction-watch', updated: { 'date-parts': [[2004, 3, 6]] } },
  { DOI: '10.1016/s0140-6736(10)60175-4', type: 'retraction', label: 'Retraction', source: 'retraction-watch', updated: { 'date-parts': [[2010, 2, 6]] } }] });
var r = A.normalize(wakefield);
eq('both notices kept, in order', r.updates.map(u => u.kind), ['correction', 'retraction']);
eq('notice date and DOI', r.updates[1], { kind: 'retraction', type: 'retraction', label: 'Retraction', doi: '10.1016/s0140-6736(10)60175-4', year: '2010', month: 2, day: 6, from: 'crossref' });
eq('a title prefix adds no second retraction when a notice exists', r.updates.filter(u => u.kind === 'retraction').length, 1);
eq('the reference itself is unchanged', A.format(r, 'apa').indexOf('Retraction'), -1);
eq('not a notice itself', r.updateOf, null);
eq('a notice without a date', A.normalize(jr({ 'updated-by': [{ DOI: '10.1/x', type: 'expression_of_concern', label: 'Expression of concern' }] })).updates, [{ kind: 'concern', type: 'expression_of_concern', label: 'Expression of concern', doi: '10.1/x', year: '', month: 0, day: 0, from: 'crossref' }]);
eq('Crossref type spellings', A.normalize(jr({ 'updated-by': [{ type: 'Expression Of Concern' }, { type: 'partial-retraction' }, { type: 'withdrawal' }, { type: 'removal' }, { type: 'erratum' }, { type: 'corrigendum' }] })).updates.map(u => u.kind), ['concern', 'retraction', 'retraction', 'retraction', 'correction', 'correction']);
eq('new editions, versions, addenda and clarifications are not flagged', A.normalize(jr({ 'updated-by': [{ type: 'new_edition' }, { type: 'new_version' }, { type: 'addendum' }, { type: 'clarification' }, { type: '' }, null] })).updates, []);
eq('no updated-by: none', A.normalize(jr({})).updates, []);
eq('RETRACTED: in the title with no notice', A.normalize(jr({ title: ['RETRACTED: Something'] })).updates, [{ kind: 'retraction', type: 'retraction', label: 'Retracted', doi: '', year: '', month: 0, day: 0, from: 'title' }]);
eq('WITHDRAWN: in the title', A.normalize(jr({ title: ['WITHDRAWN: Something'] })).updates.map(u => u.kind), ['retraction']);
eq('Retracted article: in the title', A.normalize(jr({ title: ['Retracted article: Something'] })).updates.map(u => u.kind), ['retraction']);
eq('a retraction notice\'s own title is not a retracted work', A.normalize(jr({ title: ['Retraction: Something'] })).updates, []);
eq('"Retraction Note" is not a retracted work', A.normalize(jr({ title: ['Retraction Note: Something'] })).updates, []);
eq('a title mentioning retraction mid-sentence is not one', A.normalize(jr({ title: ['Why papers get retracted'] })).updates, []);
eq('OpenAlex is_retracted', A.normalize(A.fromOpenAlex({ title: 'X', is_retracted: true, publication_year: 2020 })).updates.map(u => u.kind + '/' + u.from), ['retraction/openalex']);
eq('OpenAlex not retracted', A.normalize(A.fromOpenAlex({ title: 'X', is_retracted: false, publication_year: 2020 })).updates, []);
eq('a notice knows what it updates', A.normalize(jr({ title: ['Retraction: Something'], 'update-to': [{ DOI: '10.1/abc', type: 'retraction', label: 'Retraction' }] })).updateOf, { kind: 'retraction', type: 'retraction', label: 'Retraction', doi: '10.1/abc' });
eq('a new edition is not a notice', A.normalize(jr({ 'update-to': [{ DOI: '10.1/abc', type: 'new_edition' }] })).updateOf, null);
eq('RIS carries no notice', A.format(r, 'ris').indexOf('etract'), -1);
eq('BibTeX carries no notice', A.format(r, 'bibtex').indexOf('etract'), -1);

// The grader: a publisher's title prefix must not cost a correct match its green
var cited = 'Wakefield AJ, Murch SH. Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children. The Lancet. 1998;351(9103):637-641.';
var wf = A.normalize(Object.assign({}, wakefield, { author: [{ given: 'A. J.', family: 'Wakefield' }, { given: 'S. H.', family: 'Murch' }], 'container-title': ['The Lancet'], volume: '351', issue: '9103', page: '637-641', issued: { 'date-parts': [[1998, 2]] } }));
eq('RETRACTED: prefix does not lower the grade', A.matchConfidence(cited, wf) >= 0.8, true);
eq('Retracted article - prefix does not either', A.matchConfidence(cited, A.normalize(Object.assign({}, wakefield, { title: ['Retracted article - Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children'], author: wf.authors.map(p => ({ given: p.given, family: p.family })), 'container-title': ['The Lancet'], volume: '351', issue: '9103', page: '637-641', issued: { 'date-parts': [[1998, 2]] } }))) >= 0.8, true);
eq('OpenAlex knowing it is retracted is enough', A.matchConfidence(cited, A.normalize(Object.assign({}, wakefield, { 'updated-by': undefined, is_retracted: true, author: wf.authors.map(p => ({ given: p.given, family: p.family })), 'container-title': ['The Lancet'], volume: '351', issue: '9103', page: '637-641', issued: { 'date-parts': [[1998, 2]] } }))) >= 0.8, true);
eq('a "Retracted: " title with no notice on record is still read as a notice about the paper, as before', A.matchConfidence(cited, A.normalize(Object.assign({}, wakefield, { title: ['Retracted: Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children'], 'updated-by': undefined, author: wf.authors.map(p => ({ given: p.given, family: p.family })), 'container-title': ['The Lancet'], volume: '351', issue: '9103', page: '637-641', issued: { 'date-parts': [[1998, 2]] } }))) <= 0.5, true);
var notice = A.normalize(Object.assign({}, wakefield, { title: ['Retraction\u2014Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children'], 'updated-by': undefined, 'update-to': [{ DOI: '10.1016/s0140-6736(97)11096-0', type: 'retraction', label: 'Retraction' }], author: [{ family: 'The Editors of The Lancet' }], 'container-title': ['The Lancet'], volume: '375', issue: '9713', page: '445', issued: { 'date-parts': [[2010, 2]] } }));
eq('the retraction notice itself is still not the cited paper', A.matchConfidence(cited, notice) < 0.5, true);
eq('a notice with the paper\'s exact title and no prefix is still docked', A.matchConfidence(cited, A.normalize(Object.assign({}, wakefield, { title: ['Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children'], 'updated-by': undefined, 'update-to': [{ DOI: '10.1/x', type: 'retraction' }], author: wf.authors.map(p => ({ given: p.given, family: p.family })), 'container-title': ['The Lancet'], volume: '351', issue: '9103', page: '637-641', issued: { 'date-parts': [[1998, 2]] } }))) < 0.8, true);
eq('a retracted title is not matched by the word retracted alone', A.matchConfidence('Smith J. Retracted. 2001', wf) < 0.5, true);

console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
