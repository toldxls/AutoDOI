var ROOT = require('path').resolve(__dirname, '..');
var FIX = require('path').join(__dirname, 'fixtures');
const html = require('fs').readFileSync(require('path').join(ROOT, 'index.html'), 'utf8');
const a = html.indexOf('  // Lines that are nothing but an identifier'), b = html.indexOf('  async function resolve(refText)');
const splitReferences = new Function('A', html.slice(a, b) + '; return splitReferences;')(require(require('path').join(ROOT, 'citations.js')));
let pass = 0, fail = 0;
// Arabic and Hebrew references open with a name run and a year, with no capitals to go by
[['Arabic, one per line', 'العمري، محمد أحمد (2019). التغيرات المناخية وأثرها على الزراعة في اليمن. مجلة الدراسات الجغرافية، 12(3)، 45-67.\nالحسني، فاطمة (2020). إدارة الموارد المائية في المناطق الجافة. مجلة العلوم البيئية، 8، 101-120.\nالخطيب، أحمد (2018). التصحر في شمال أفريقيا. مجلة البحوث الجغرافية، 5(1)، 1-20.', 3],
 ['Hebrew, one per line', 'כהן, י. (2015). גיאולוגיה של הנגב. כתב עת למדעי כדור הארץ, 22, 33-48.\nלוי, ד. (2017). מים בישראל. מחקרים בגיאוגרפיה, 9(2), 5-19.\nמזרחי, ר. (2019). אקלים המזרח התיכון. אופקים בגיאוגרפיה, 41, 77-90.', 3]].forEach(c => {
  const r = splitReferences(c[1], 'auto'); if (r.length === c[2]) pass++; else { fail++; console.log('FAIL rtl ' + c[0], r.length, '!=', c[2], JSON.stringify(r).slice(0, 200)); }
});

// Two references glued into one line are separated; semicolons inside one reference are not
const glued = [
  ['physics semicolon pair', 'L.J. Campbell et al., Physica B 211 (1995) 52; S. Askenazy, Physica B 216 (1996) 221.', 2],
  ['ibid pair', 'H.J. Fischback, Phys. Stat. Sol. 3 (1963) 1082; ibid. 22 (1967) 235.', 2],
  ['run together after pages', 'M. J. Benton, 2000 .Stems, nodes, crown-clades, and rank-free lists: Is Linnaeus dead? Biological Reviews, 75 :633 –648 C. A. Brochu, 2000 .Phylogenetic relationships and divergence timing of Crocodylus based on morphology and the fossil record. Copeia, 2000 :657 –673', 2],
  ['period glue', 'Soltis, D.E., and P.S. Soltis. 1992. The distribution of selfing rates in homosporous ferns. American Journal of Botany, 79:97-100. Wahlert, J.H. 1977. Cranial foramina and relationships of Eutypomys (Rodentia, Eutypomyidae). American Museum Novitates, 2626:1-8.', 2],
  ['three glued', 'A. Smith, Phys. Rev. B 12 (1990) 100; B. Jones, Phys. Rev. B 13 (1991) 200; C. Brown, Phys. Rev. B 14 (1992) 300.', 3],
  ['ACS author semicolons are one reference', 'Smith, J.; Jones, K.; Brown, L. Deep learning for crystals. J. Am. Chem. Soc. 2020, 142, 1234-1240.', 1],
  ['Vancouver year;volume is one reference', 'Kucsko G, Maurer PC. Nanometre-scale thermometry in a living cell. Nature. 2013;500(7460):54-8.', 1],
  ['semicolon inside a title is one reference', 'Smith J (2020) Warming; cooling; and everything between: a review of ocean heat. J Clim 33:1-20.', 1],
  ['two-year title is one reference', 'Keng S-H (2017) Expanding college access in Taiwan, 1978–2014: effects on graduate quality. J Hum Cap 11:1-34.', 1]
];
glued.forEach(c => { ['auto', 'lines'].forEach(mode => { const r = splitReferences(c[1], mode); if (r.length === c[2]) pass++; else { fail++; console.log('FAIL glued ' + c[0] + ' (' + mode + ')', r.length, '!=', c[2], JSON.stringify(r)); } }); });
{ const r = splitReferences('H.J. Fischback, Phys. Stat. Sol. 3 (1963) 1082; ibid. 22 (1967) 235.', 'auto');
  if (r[1] === 'H.J. Fischback, Phys. Stat. Sol. 22 (1967) 235.') pass++; else { fail++; console.log('FAIL ibid expands to the journal', JSON.stringify(r)); } }

const eq0 = (label, got, n) => { if (got.length === n) pass++; else { fail++; console.log('FAIL', label, JSON.stringify(got)); } };
const t = (label, input, n) => { const r = splitReferences(input); if (r.length === n) pass++; else { fail++; console.log('FAIL', label, r.length, '!=', n); r.forEach(x => console.log('   |', x.slice(0, 100))); } };
t('particle', "Kucsko, G., & Maurer, P. C. (2013). Nanometre-scale thermometry. Nature, 500, 54-58.\nvan der Maaten, L., & Hinton, G. (2008). Visualizing data using t-SNE. JMLR, 9, 2579-2605.", 2);
t('ids', "PMC4221854\nPMID: 23903748\narXiv:1706.03762\narXiv:1810.04805", 4); // a PubMed ID carries its prefix inside a list
t('ids with blank', "10.1145/3292500.3330701\nISBN 978-0-521-38707-1\n\nsome junk line here", 3);
t('de Carvalho', "Smith, J. (2020). Title one. J, 1, 1-2.\nde Carvalho, A. (2019). Title two. J, 2, 3-4.\nd'Alembert, J. (1750). Title three. J, 3, 5.", 3);
t('one per line (a DOI line after a reference belongs to it)', "Watson JD, Crick FHC. Molecular structure. Nature. 1953;171:737-738.\nHarris, C. R. et al. Array programming with NumPy. Nature 585, 357–362 (2020).\n10.1038/nature12373", 2);
t('blank wrapped', "Watson JD, Crick FHC. Molecular structure of nucleic acids: a structure for\ndeoxyribose nucleic acid. Nature. 1953;171(4356):737-738.\n\nHarris, C. R. et al. Array programming with NumPy. Nature 585,\n357–362 (2020).", 2);
t('mixed', "A ref. Smith, J. (2020). Title one. Journal, 1, 1-2.\n\nJones, A. (2019). Title two. Journal, 2,\n3-4.\nBrown, B. (2018). Title three. Journal, 3, 5-6.", 3);
t('numbered wrapped', "1. Kucsko G, Maurer PC. Nanometre-scale thermometry in a living cell. Nature.\n2013;500:54-58.\n2. Vaswani A, et al. Attention is all you need. NeurIPS 2017.", 2);
t('no-blank wrap mid-sentence', "Watson JD, Crick FHC. Molecular structure of nucleic acids: a structure for\ndeoxyribose nucleic acid. Nature. 1953;171:737-738.", 1);
t('glued two DOIs', "Smith J. A. 2020. https://doi.org/10.1038/nature12373 Jones B. 2021. Title. doi:10.1016/j.gca.2019.01.001", 2);
t('accented author', "Kucsko, G. (2013). A. Nature.\nÅström, K. (2008). Feedback systems. Princeton.", 2);
t('bullets', "• Smith, J. (2020). Title. J, 1, 1.\n· Jones, A. (2019). Title. J, 2, 2.\n— Brown, B. (2018). Title. J, 3, 3.", 3);
t('numbered no-wrap with author starts', "1. Smith, J. Title. J 1:2.\n2. Jones, A. Title. J 3:4.\n3. Brown, B. Title. J 5:6.", 3);

t('et al. wrap', "Smith, J., Jones, K., et al.\n(2019). A title of the paper. Geology, 1, 2-3.\nBrown, T. (2018). Other. Geology, 2, 4-5.", 2);
t('PNAS wrap', "Kucsko G, et al. Nanometre-scale thermometry. Proc. Natl. Acad. Sci. U.S.A.\n116, 1234-1240.\nBrown T. Other. Nature 1, 2.", 2);
t('JGR wrap', "Smith, J. (2007). Crustal flow. J. Geophys. Res.\n112, B05401.\nJones, K. (2008). Mantle. Geology, 3, 4.", 2);
t('Fm wrap', "Horner, J. (1984). Nesting in the Hell Creek Fm.\nin eastern Montana. Nature, 1, 2.", 1);
t('article number wrap', "Smith, J. (2019). Thing. Nature Communications, 10,\n4567891.\nJones, K. (2020). Other. Nature, 1, 2.", 2);
t('blank with de Gruyter', "Smith, J. (2000). A book. Walter\nde Gruyter, Berlin.\n\nJones, K. (2001). Andes. Cordillera\nde Los Andes, Chile. Press.", 2);
t('year-led lines', "Smith J, Jones K\n2019. Title of the paper. Journal 1:2-3.\nBrown T, Lee C\n2020. Another title. Journal 4:5-6.", 2);
t('hanging indent capital wrap', "Smith, J. (2019). A long title about the geology of the\nNorthern Territory. Journal of Geology, 12, 1-5.\nJones, K. (2020). Other. Nature Geoscience, 12, 1-5.", 2);
t('book ending Press.', "Darwin, C. (1859). On the origin of species. John Murray.\nMayr, E. (1942). Systematics and the origin of species. Columbia University Press.\nSimpson, G. G. (1944). Tempo and mode. Columbia University Press.", 3);
t('Chicago', "Smith, John. 2020. “A Title.” Geology 48: 1–2.\nJones, Kate. 2019. “Another.” Nature 5: 3–4.", 2);
// adversarial review: a wrapped Arabic or Hebrew line with a year mid-sentence is not a new reference; Arabic-Indic and Persian digits and hijri years are years
t('Arabic wrap with a year mid-sentence', 'العمري، محمد أحمد (2019). التغيرات المناخية وأثرها على الزراعة في اليمن خلال\nالفترة من 1990 إلى 2015. مجلة الدراسات الجغرافية، 12(3)، 45-67.\nالحسني، فاطمة (2020). إدارة الموارد المائية في المناطق الجافة. مجلة العلوم البيئية، 8، 101-120.\nالخطيب، أحمد (2018). التصحر في شمال أفريقيا. مجلة البحوث الجغرافية، 5(1)، 1-20.', 3);
t('Hebrew wrap with a year mid-sentence', 'כהן, י. (2015). גיאולוגיה של הנגב והשינויים\nבשנת 2015 ואילך. כתב עת למדעי כדור הארץ, 22, 33-48.\nלוי, ד. (2017). מים בישראל. מחקרים בגיאוגרפיה, 9(2), 5-19.\nמזרחי, ר. (2019). אקלים המזרח התיכון. אופקים בגיאוגרפיה, 41, 77-90.', 3);
t('Arabic-Indic digits', 'العمري، محمد أحمد (٢٠١٩). التغيرات المناخية وأثرها على الزراعة في اليمن. مجلة الدراسات الجغرافية، ١٢(٣)، ٤٥-٦٧.\nالحسني، فاطمة (٢٠٢٠). إدارة الموارد المائية في المناطق الجافة. مجلة العلوم البيئية، ٨، ١٠١-١٢٠.\nالخطيب، أحمد (٢٠١٨). التصحر في شمال أفريقيا. مجلة البحوث الجغرافية، ٥(١)، ١-٢٠.', 3);
t('Persian digits and solar years', 'احمدی، علی (۱۳۹۸). زمین‌شناسی ایران مرکزی. مجله علوم زمین، ۱۲، ۴۵-۶۷.\nرضایی، مریم (۱۳۹۷). آب‌های زیرزمینی. فصلنامه محیط زیست، ۸، ۱۰۱-۱۲۰.\nکریمی، حسن (۱۳۹۶). زلزله‌های ایران. مجله زمین، ۵، ۱-۲۰.', 3);
t('hijri years', 'العمري، محمد (1440ه). التغيرات المناخية وأثرها على الزراعة. مجلة الدراسات، 12، 45-67.\nالحسني، فاطمة (1441ه). إدارة الموارد المائية. مجلة العلوم، 8، 101-120.\nالخطيب، أحمد (1439ه). التصحر في شمال أفريقيا. مجلة البحوث، 5، 1-20.', 3);
// glue: a reference given in Cyrillic and again transliterated is one; a chapter's "In K. Jones (Ed.)" is not a new reference; a link before a space is an end
t('Cyrillic reference with its transliteration', 'Иванов И.И. (2013) Геохимия гранитов Урала. Геохимия 12:54–58. Ivanov I.I. (2013) Geochemistry of Ural granites. Geochemistry 12:54–58 (in Russian).', 1);
t('chapter with its book after In', 'Smith, J. (2013). Chapter title, pp. 54–58. In K. Jones (Ed.), Book title. Berlin: Springer, 2013.', 1);
t('run together after a DOI link', 'Smith, J. (2020). Title one. Nature, 1, 1–2. https://doi.org/10.1007/s00410-019-1234-x Jones, K. (2019). Title two. Nature, 2, 3–4.', 2);
console.log(pass + ' passed, ' + fail + ' failed');

// --- regressions from the 2026-09-23 page-script review ---
const splitByMode = new Function(html.slice(a, b) + '; return splitByMode;')();
const timed = (label, fn, limit) => { const t0 = Date.now(); fn(); const ms = Date.now() - t0; if (ms < (limit || 1000)) pass++; else { fail++; console.log('FAIL', label, ms + ' ms'); } };
timed('particle run does not backtrack exponentially', () => splitReferences("Smith, J. (2020). Foo bar baz.\n" + "della ".repeat(30) + "x\nJones, K. (2019). Other. Journal, 1, 2-3."));
timed('glued particles', () => splitReferences("Smith, J. (2020). Foo.\n" + "della".repeat(40) + " x\nJones, K. (2019). Other."));
timed('50k spaces in a line', () => splitReferences("x\n" + " ".repeat(50000) + "y\na" + " ".repeat(50000) + "b"), 300);
timed('50k spaces, blank mode', () => splitByMode("a" + " ".repeat(50000) + "\n\nb" + " ".repeat(50000), 'blank'), 300);
t('particles still recognised', "van der Maaten, L., & Hinton, G. (2008). Visualizing data using t-SNE. Journal of Machine Learning Research, 9, 2579-2605.\nde la Cruz, A. (2010). Title of work here. Geology, 38, 1-10.\nd’Arcy, W. (1999). Another title here. Nature, 400, 1-2.", 3);
// Lines that are only titles: one reference each, a wrapped title joined on its dangling word or lowercase continuation
t('a list of bare titles', "Attention is all you need\nDeep learning\nNanometre-scale thermometry in a living cell", 3);
t('a single title', "Deep learning, Nature 2015", 1);
t('a single word is a search', "oldsite", 1);
t('a list of one-word titles', "oldsite\nbobdownsite\nkampfite", 3);
eq0('debris lines are still dropped', splitReferences("Smith, J. (2020). A title here. Journal, 1, 2.\n3.\npp."), 1);
t('a wrapped title stays one', "Deep learning methods for\nprotein structure prediction\nMolecular structure of nucleic acids", 2);
t('a title wrapped after two words stays one', "Molecular structure\nof nucleic acids\nArray programming\nwith NumPy\nNanometre-scale thermometry\nin a living cell", 3);
t('lowercase names are still a list', "oldsite\nbobdownsite\nnative copper\nnative gold", 4);
t('a paste with an author line is not a title list: lines still wrap as before', "Deep learning\nKucsko, G., & Maurer, P. C. (2013). Nanometre-scale thermometry.\nNature, 500, 54-58.", 1);
const eq = (label, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log('FAIL', label, JSON.stringify(got), '!=', JSON.stringify(want)); } };
eq('lines mode keeps the 10. of bare DOIs', splitByMode("10.1038/nature12373\n10.1000/x\n1. Smith J. 2020. Title. J 1:2.", 'lines'), ["10.1038/nature12373", "10.1000/x", "Smith J. 2020. Title. J 1:2."]);
eq('numbered mode survives a gap', splitByMode("1. Smith, J. (2020). A title here. Journal, 1, 2.\n3. Jones, K. (2019). Second title. Journal, 2, 3.\n4. Brown, L. (2018). Third title. Journal, 3, 4.\n1998. Not an item, a wrapped year", 'numbered').length, 3);
eq('blank mode joins wrapped lines', splitByMode("Smith, J. (2020). A title\n  that wraps. Journal, 1, 2.\n\nJones, K. (2019). B. Journal, 2, 3.", 'blank'), ["Smith, J. (2020). A title that wraps. Journal, 1, 2.", "Jones, K. (2019). B. Journal, 2, 3."]);
// --- 2026-10 page-logic audit: glued lists of any length, CJK name lists, numbered wraps, page furniture, prose authors, Chicago dashes, bare numbers ---
{ const names = ['Smith', 'Jones', 'Brown', 'Taylor', 'Wilson', 'Davies', 'Evans', 'Thomas', 'Roberts', 'Walker', 'Wright', 'Robinson', 'Thompson', 'White', 'Hughes', 'Edwards', 'Green', 'Hall', 'Wood', 'Harris'];
  const apa = names.map((n, i) => n + ', A. B., & Coauthor, C. (20' + (10 + i % 10) + '). A title about topic number ' + (i + 1) + ' and its consequences. Journal of Things, ' + (10 + i) + '(2), ' + (100 + i) + '-' + (110 + i) + '.');
  t('20 APA references glued on one line', apa.join(' '), 20);
  eq0('20 glued references in lines mode', splitReferences(apa.join(' '), 'lines'), 20); }
t('Japanese, one per line, no full stops', '山田太郎・鈴木一郎 (2019) 日本列島の地質構造と変動. 地質学雑誌, 125, 1-10\n佐藤花子 (2018) 火山岩の岩石学的研究. 岩石鉱物科学, 47, 55-70\n高橋健 (2020) 地震活動の統計的解析. 地震, 72, 100-115', 3);
t('Japanese with full-width brackets', '山田太郎（2019）日本列島の地質構造と変動．地質学雑誌，125，1-10\n佐藤花子（2018）火山岩の岩石学的研究．岩石鉱物科学，47，55-70\n高橋健（2020）地震活動の統計的解析．地震，72，100-115', 3);
t('Chinese, one per line', '张三, 李四. 2019. 青藏高原的地壳结构. 地质学报, 93(3): 45-67\n王五. 2018. 华北克拉通的破坏. 中国科学, 48(2): 100-120\n赵六, 钱七. 2020. 扬子板块的构造演化. 岩石学报, 36(1): 1-20', 3);
t('Korean, one per line', '김철수 (2019). 한반도의 지질 구조. 지질학회지, 55, 1-10\n이영희 (2018). 백두산 화산 활동 연구. 암석학회지, 27, 45-60\n박민수 (2020). 동해의 해저 지형. 해양학회지, 25, 100-115', 3);
{ const vol = '1. Smith J. Title one. J Geol. 2018;12:1-5.\n2. Jones K. A book about things. Oxford: OUP; Vol.\n2. 2019. p. 1-20.\n3. Brown T. Title three. Nature. 2020;1:2-3.';
  t('a wrapped "Vol." + "2. 2019. p. 1-20." is not item 2', vol, 3);
  eq('numbered mode keeps the wrapped volume with its item', splitByMode(vol, 'numbered')[1], 'Jones K. A book about things. Oxford: OUP; Vol. 2. 2019. p. 1-20.'); }
t('an author\'s own list opens its items with years', '1. Smith J. Title one. J Geol. 2018;12:1-5.\n2. 1957. Über Tonforschung in Deutschland in den letzten Jahren. Geologie 6: 1-20.\n3. 1963. Die Verwendbarkeit morphologischer Erscheinungen. Geologie 12: 5-30.', 3);
t('headings, page furniture and a running head are dropped', 'References\nSmith, J. (2020). Deep learning for crystals. Nature, 1, 1-2.\nJones, K. (2019). Mantle flow under Tibet. Geology, 2, 3-4.\nPage 3 of 12\nBrown, T. (2018). Olivine rheology. Science, 3, 5-6.\nJOURNAL OF GEOPHYSICAL RESEARCH SOLID EARTH\nLee, C. (2017). Quartz deformation. Nature, 4, 7-8.\n14\nWORKS CITED:\nKim, H. (2016). Garnet growth. Lithos, 5, 9-10.', 5);
t('a running head inside a wrapped reference does not break it', 'Smith, J. (2020). Deep learning for crystals and other\nAMERICAN MINERALOGIST VOLUME 104\nmaterials of the deep Earth. Nature, 1, 1-2.\nJones, K. (2019). Mantle flow under Tibet. Geology, 2, 3-4.\nBrown, T. (2018). Olivine rheology. Science, 3, 5-6.', 3);
t('an all-caps reference with its year and commas survives', 'SMITH, J. (2019). DEEP LEARNING FOR CRYSTALS. NATURE, 1, 1-2.\nJONES, K. (2018). MANTLE FLOW. GEOLOGY, 2, 3-4.\nBROWN, T. (2017). OLIVINE RHEOLOGY. SCIENCE, 3, 5-6.', 3);
eq0('a heading in blank-line mode is dropped too', splitByMode('Works Cited\n\nSmith, J. (2020). Deep learning for crystals. Nature, 1, 1-2.\n\nJones, K. (2019). Mantle flow under Tibet. Geology, 2, 3-4.', 'blank'), 2);
t('"Sources" alone is still a search', 'Sources', 1);
eq('Chicago dashes take the author of the entry above', splitReferences('Smith, John. 2020. “Deep Learning for Crystals.” Nature 1: 1–2.\n———. 2019. “Mantle Flow under Tibet.” Geology 2: 3–4.\n———, and Kate Jones. 2018. “Olivine Rheology.” Science 3: 5–6.\nJones, Kate. 2017. “Quartz.” Nature 4: 7–8.').map(x => x.slice(0, 28)),
  ['Smith, John. 2020. “Deep Lea', 'Smith, John. 2019. “Mantle F', 'Smith, John, and Kate Jones.', 'Jones, Kate. 2017. “Quartz.”']);
eq('underscores in lines mode too', splitByMode('Smith, John. 2020. “Deep Learning for Crystals.” Nature 1: 1–2.\n___. 2019. “Mantle Flow under Tibet.” Geology 2: 3–4.', 'lines')[1].slice(0, 18), 'Smith, John. 2019.');
{ const la = s => looksLikeTitleOf(s);
  const looksLikeTitleOf = new Function('A', html.slice(a, b) + '; return looksLikeTitle;')(require(require('path').join(ROOT, 'citations.js')));
  check0('"John Smith, Deep learning for crystals, Nature, 2020" is an author, not a title', la('John Smith, Deep learning for crystals, Nature, 2020') === null);
  check0('"John Smith and Kate Jones, Mantle flow under Tibet and its causes, 2019" is an author', la('John Smith and Kate Jones, Mantle flow under Tibet and its causes, 2019') === null);
  check0('"Deep Learning, Nature 2015" is still a title with its journal', la('Deep Learning, Nature 2015') && la('Deep Learning, Nature 2015').journal === 'Nature');
  check0('"Deep learning, Nature" is still a title', !!la('Deep learning, Nature')); }
t('a bare number inside a list is debris, not a PubMed ID', 'Smith, J. (2020). Deep learning for crystals. Nature, 1, 1-2.\n23903748\nJones, K. (2019). Mantle flow under Tibet. Geology, 2, 3-4.\n123456789', 2);
eq('a bare number is not glued to the line above', splitReferences('Smith, J. (2020). Deep learning for crystals. Nature, 1, 1-2.\n23903748\nJones, K. (2019). Mantle flow under Tibet. Geology, 2, 3-4.')[0], 'Smith, J. (2020). Deep learning for crystals. Nature, 1, 1-2.');
eq0('bare numbers in blank-line mode are dropped', splitByMode('Smith, J. (2020). Deep learning for crystals. Nature, 1, 1-2.\n23903748\n\nJones, K. (2019). Mantle flow under Tibet. Geology, 2, 3-4.\n123456789', 'blank'), 2);
eq('a PubMed ID alone is looked up', splitReferences('23903748'), ['23903748']);
eq('a prefixed PubMed ID in a list is kept', splitReferences('PMID: 23903748\nPMC4221854\n10.1038/nature12373'), ['PMID: 23903748', 'PMC4221854', '10.1038/nature12373']);
function check0(label, ok) { if (ok) pass++; else { fail++; console.log('FAIL', label); } }
console.log(pass + ' passed, ' + fail + ' failed');
