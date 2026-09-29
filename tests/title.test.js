// looksLikeTitle (the References tab's bare-title detector) must not fire on a real reference: every reference in the live matching
// bench, as deposited, in lowercase without punctuation, and with its year removed, is a reference and stays on the matching path
var ROOT = require('path').resolve(__dirname, '..');
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const a = html.indexOf('  // Lines that are nothing but an identifier'), b = html.indexOf('  async function resolve(refText)');
const looksLikeTitle = new Function('A', html.slice(a, b) + '; return looksLikeTitle;')(require(path.join(ROOT, 'citations.js')));
let pass = 0, fail = 0;
const DOI_RE = /(?:\bdoi:?\s*)?(?:https?:\/\/(?:dx\.)?doi\.org\/)?\b10\.\d{4,9}\/[^\s"'<>]+/gi;
const degrade = { // as tests/browser/match-bench.js degrades them
  deposited: t => t.replace(DOI_RE, ' ').replace(/\s+/g, ' ').trim(),
  lowercase: t => degrade.deposited(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(),
  noyear: t => degrade.deposited(t).replace(/\b(1[89]|20)\d{2}[a-z]?\b/g, ' ').replace(/\s+/g, ' ').trim()
};
const refs = [].concat(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'match-truth.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'match-truth-nonlatin.json'), 'utf8')));
Object.keys(degrade).forEach(v => refs.forEach(r => {
  const t = degrade[v](r.text), got = looksLikeTitle(t);
  if (!got) pass++; else { fail++; console.log('FAIL read as a title (' + v + '):', JSON.stringify(t).slice(0, 160), '->', JSON.stringify(got)); }
}));
// and the lines it is for
[['bare title', 'Attention is all you need', { title: 'Attention is all you need', journal: '', year: '' }],
 ['two words', 'Deep learning', { title: 'Deep learning', journal: '', year: '' }],
 ['title, journal year', 'Deep learning, Nature 2015', { title: 'Deep learning', journal: 'Nature', year: '2015' }],
 ['title. Journal (year)', 'Deep learning. Nature (2015)', { title: 'Deep learning', journal: 'Nature', year: '2015' }],
 ['title in Journal', 'Deep learning in Nature', { title: 'Deep learning', journal: 'Nature', year: '' }],
 ['quoted, full stop', '“Molecular structure of nucleic acids.”', { title: 'Molecular structure of nucleic acids', journal: '', year: '' }],
 ['no split on a space', 'Zircon U-Pb geochronology Journal of Petrology', { title: 'Zircon U-Pb geochronology Journal of Petrology', journal: '', year: '' }],
 ['a one-word head is not a title', 'Learning, Memory and Cognition', { title: 'Learning, Memory and Cognition', journal: '', year: '' }],
 ['"and" opens no author', 'Attention and memory in mice', { title: 'Attention and memory in mice', journal: '', year: '' }],
 ['a colon in the tail is not a journal', 'COVID-19 vaccines: two years on', { title: 'COVID-19 vaccines: two years on', journal: '', year: '' }]
].forEach(c => { const got = looksLikeTitle(c[1]); if (JSON.stringify(got) === JSON.stringify(c[2])) pass++; else { fail++; console.log('FAIL', c[0], JSON.stringify(got)); } });
// and never on these
['Nature 500:54 (2013)', 'Smith, J. (2020). Title. J 1:2', '10.1038/nature12373', 'https://doi.org/10.1038/nature12373', 'Kucsko G, Maurer PC (2013) Nanometre-scale thermometry in a living cell',
 'harris c r et al array programming with numpy nature 585 357 362 2020', 'Бабичев А.В. и др. // Письма в ЖТФ. 2020. Т. 46. № 9. С. 35', 'J. A. Smith, Deep learning', 'Smith JA, Jones K. Deep learning', '1. Deep learning', '[3] Deep learning',
 'Deep learning (2015) in Nature', 'Deep', 'In: Deep learning', 'Smith J et al. Deep learning', 'Vol. 3, pp. 12-15'
].forEach(s => { const got = looksLikeTitle(s); if (got === null) pass++; else { fail++; console.log('FAIL should not be a title:', JSON.stringify(s), JSON.stringify(got)); } });
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
