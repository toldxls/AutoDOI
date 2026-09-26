var ROOT = require('path').resolve(__dirname, '..');
// In-text citations: the parenthetical and narrative forms, the numbered forms, and Chicago's notes, with and without a page
// locator.  APA and Chicago are also checked against the style guides' own printed forms in golden-styleguides.test.js.
// Sources: APA Publication Manual 7th ed. 8.17 (author-date, "et al." from three authors, "p."/"pp."), MLA Handbook 9th ed. 6.1-6.20
// (author and page, no comma; "et al." from three), Cite Them Right Harvard (author year, "p."), Citing Medicine (numbers in
// parentheses), IEEE Reference Guide ("[1, p. 5]"), CMOS 17 ch. 14 (full and shortened notes).  Run: node tests/intext.test.js
const A = require(require('path').join(ROOT, 'citations.js'));
let pass = 0, fail = 0;
const eq = (label, got, exp) => { if (got === exp) pass++; else { fail++; console.log('FAIL', label, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(exp)); } };
const jr = o => Object.assign({ type: 'journal-article', title: ['Nanometre-scale thermometry in a living cell'], author: [{ given: 'G.', family: 'Kucsko' }, { given: 'P. C.', family: 'Maurer' }, { given: 'N. Y.', family: 'Yao' }],
  'container-title': ['Nature'], volume: '500', issue: '7460', page: '54-58', issued: { 'date-parts': [[2013]] }, DOI: '10.1038/nature12373' }, o);
const one = jr({ author: [{ given: 'Georg', family: 'Kucsko' }] }), two = jr({ author: [{ given: 'Georg', family: 'Kucsko' }, { given: 'Peter C.', family: 'Maurer' }] });
const F = (m, st, o) => A.inTextForms(m, st, o);

// APA
eq('apa one', F(one, 'apa').paren, '(Kucsko, 2013)');
eq('apa two', F(two, 'apa').paren, '(Kucsko & Maurer, 2013)');
eq('apa three', F(jr({}), 'apa').paren, '(Kucsko et al., 2013)');
eq('apa page', F(one, 'apa', { pages: '55' }).paren, '(Kucsko, 2013, p. 55)');
eq('apa pages', F(one, 'apa', { pages: '55-56' }).paren, '(Kucsko, 2013, pp. 55–56)');
eq('apa narrative', F(two, 'apa', { pages: '55' }).narrative, 'Kucsko and Maurer (2013, p. 55)');
eq('apa group author', F(jr({ author: [{ name: 'World Health Organization' }] }), 'apa').paren, '(World Health Organization, 2013)');
eq('apa no date', F(jr({ author: [{ family: 'Smith' }], issued: {} }), 'apa').paren, '(Smith, n.d.)');
eq('apa no author: the title, quoted for an article', F(jr({ author: [] }), 'apa').paren, '(“Nanometre-scale thermometry in a living cell”, 2013)');
eq('apa no author: a book title plain', F(jr({ type: 'book', author: [], title: ['Interior Chinatown'], 'container-title': undefined }), 'apa').paren, '(Interior Chinatown, 2013)');
eq('apa main title before a colon', F(jr({ author: [], title: ['Deep time: A history of the Earth in twelve chapters'] }), 'apa').paren, '(“Deep time”, 2013)');
eq('apa editors stand in for authors', F(jr({ type: 'book', author: [], editor: [{ given: 'J.', family: 'Marks' }, { given: 'S.', family: 'Parkin' }] }), 'apa').paren, '(Marks & Parkin, 2013)');
eq('apa "and others" list', F(jr({ author: [{ family: 'Kucsko' }], 'author-others': true }), 'apa').paren, '(Kucsko et al., 2013)');
// MLA
eq('mla one', F(one, 'mla').paren, '(Kucsko)');
eq('mla page', F(one, 'mla', { pages: '55' }).paren, '(Kucsko 55)');
eq('mla two', F(two, 'mla', { pages: '55-56' }).paren, '(Kucsko and Maurer 55–56)');
eq('mla three', F(jr({}), 'mla', { pages: '55' }).paren, '(Kucsko et al. 55)');
eq('mla no narrative', F(one, 'mla').narrative, undefined);
// Harvard
eq('harvard one', F(one, 'harvard').paren, '(Kucsko 2013)');
eq('harvard two', F(two, 'harvard').paren, '(Kucsko and Maurer 2013)');
eq('harvard three', F(jr({}), 'harvard').paren, '(Kucsko, Maurer and Yao 2013)');
eq('harvard four', F(jr({ author: jr({}).author.concat([{ given: 'M.', family: 'Kubo' }]) }), 'harvard').paren, '(Kucsko et al. 2013)');
eq('harvard page', F(one, 'harvard', { pages: '55' }).paren, '(Kucsko 2013, p. 55)');
eq('harvard narrative', F(one, 'harvard', { pages: '55-6' }).narrative, 'Kucsko (2013, pp. 55–6)');
eq('harvard no date', F(jr({ author: [{ family: 'Smith' }], issued: {} }), 'harvard').paren, '(Smith no date)');
// Numbered
eq('vancouver', F(one, 'vancouver').paren, '(1)');
eq('vancouver nth', F(one, 'vancouver', { n: 7 }).paren, '(7)');
eq('vancouver ignores pages', F(one, 'vancouver', { pages: '55' }).paren, '(1)');
eq('ieee', F(one, 'ieee').paren, '[1]');
eq('ieee page', F(one, 'ieee', { n: 3, pages: '55' }).paren, '[3, p. 55]');
eq('ieee pages', F(one, 'ieee', { pages: '55-56' }).paren, '[1, pp. 55–56]');
// Carnegie
eq('carnegie', F(jr({}), 'carnegie').paren, '(Kucsko et al. 2013)');
eq('carnegie two', F(two, 'carnegie').paren, '(Kucsko and Maurer 2013)');
eq('carnegie page', F(one, 'carnegie', { pages: '55' }).paren, '(Kucsko 2013:55)');
eq('carnegie inText string', A.inText(one, 'carnegie'), '(Kucsko 2013)');
// Chicago notes
eq('chicago journal note', F(two, 'chicago', { pages: '55' }).note, 'Georg Kucsko and Peter C. Maurer, “Nanometre-scale thermometry in a living cell,” Nature 500, no. 7460 (2013): 55, https://doi.org/10.1038/nature12373.');
eq('chicago journal note without pages gives the range', F(one, 'chicago').note, 'Georg Kucsko, “Nanometre-scale thermometry in a living cell,” Nature 500, no. 7460 (2013): 54–58, https://doi.org/10.1038/nature12373.');
eq('chicago four authors', F(jr({ author: jr({}).author.concat([{ given: 'M.', family: 'Kubo' }]) }), 'chicago').note.split(',')[0], 'G. Kucsko et al.');
eq('chicago book note', F({ type: 'book', title: ['Swing Time'], author: [{ given: 'Zadie', family: 'Smith' }], publisher: 'Penguin Press', 'publisher-location': 'New York', issued: { 'date-parts': [[2016]] } }, 'chicago', { pages: '315-16' }).note, 'Zadie Smith, Swing Time (New York: Penguin Press, 2016), 315–16.');
eq('chicago short note, book', F({ type: 'book', title: ['Swing Time'], author: [{ given: 'Zadie', family: 'Smith' }], publisher: 'Penguin Press', issued: { 'date-parts': [[2016]] } }, 'chicago', { pages: '315-16' }).short, 'Smith, Swing Time, 315–16.');
eq('chicago short note, article', F(two, 'chicago', { pages: '55' }).short, 'Kucsko and Maurer, “Nanometre-scale thermometry in a living cell,” 55.');
eq('chicago short note keeps a long title whole rather than cutting it', F(jr({ author: [{ family: 'Smith' }], title: ['Temporal variation in selection influences microgeographic local adaptation'] }), 'chicago').short, 'Smith, “Temporal variation in selection influences microgeographic local adaptation”.');
eq('chicago short note takes a short main title', F(jr({ author: [{ family: 'Smith' }], title: ['Deep time: A history of the Earth in twelve chapters'] }), 'chicago', { pages: '9' }).short, 'Smith, “Deep time,” 9.');
eq('chicago title ending in a question mark takes no comma', F(jr({ author: [{ family: 'Smith' }], title: ['Is this a title?'] }), 'chicago').note.indexOf('“Is this a title?” Nature'), 7);
eq('chicago chapter note', F({ type: 'book-chapter', title: ['Walking'], author: [{ given: 'Henry David', family: 'Thoreau' }], editor: [{ given: 'John', family: 'D’Agata' }], 'container-title': ['The Making of the American Essay'], publisher: 'Graywolf Press', 'publisher-location': 'Minneapolis', page: '167-195', issued: { 'date-parts': [[2016]] } }, 'chicago').note, 'Henry David Thoreau, “Walking,” in The Making of the American Essay, ed. John D’Agata (Minneapolis: Graywolf Press, 2016), 167–195.');
eq('chicago thesis note', F({ type: 'dissertation', title: ['A House Is Not a Home'], author: [{ given: 'Yuna', family: 'Blajer de la Garza' }], institution: [{ name: 'University of Chicago' }], issued: { 'date-parts': [[2019]] } }, 'chicago', { pages: '66-67' }).note, 'Yuna Blajer de la Garza, “A House Is Not a Home” (PhD diss., University of Chicago, 2019), 66–67.');
eq('chicago inText string is the note', A.inText(one, 'chicago', { pages: '55' }), F(one, 'chicago', { pages: '55' }).note);
eq('unknown style', F(one, 'nope'), null);
eq('the style table carries the forms', A.STYLES.every(function (s) { return typeof s.inText === 'function'; }), true);

console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
