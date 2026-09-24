// Canary: the real services answer the way the page expects.  Everything else in tests/ mocks the network, so
// this is the only thing that notices when Crossref renames a field, OpenAlex changes its policy, a pinned file
// moves, or the live page stops matching the repository.  Run weekly by .github/workflows/canary.yml.
// Usage: node tests/canary.js
var fs = require('fs'), path = require('path'), crypto = require('crypto');
var ROOT = path.resolve(__dirname, '..');
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
var pick = function (re) { var m = html.match(re); if (!m) throw new Error('index.html no longer has ' + re); return m[1]; };
var SELECT = pick(/var SELECT = '([^']+)'/), OA_SELECT = pick(/var OA_SELECT = '([^']+)'/), CITEPROC = pick(/var CITEPROC = '([^']+)'/);
var SRI = pick(new RegExp(CITEPROC.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + "': '([^']+)'"));
var STYLES_SHA = pick(/CSL_STYLES_COMMIT = '([0-9a-f]{40})'/), LOCALES_SHA = pick(/CSL_LOCALES_COMMIT = '([0-9a-f]{40})'/);
var LIVE = process.env.LIVE_URL || 'https://toldxls.github.io/AutoDOI/';
var UA = 'AutoDOI-canary/' + pkg.version + ' (https://github.com/toldxls/AutoDOI)';
var NATURE = { doi: '10.1038/nature12373', title: 'Nanometre-scale thermometry in a living cell', year: 2013, authors: 8, journal: 'Nature', issn: '0028-0836', pmid: '23903748' };
var passed = 0, failed = 0;
function ok(name, detail) { passed++; console.log('ok   ' + name + (detail ? '  (' + detail + ')' : '')); }
function bad(name, detail) { failed++; console.log('FAIL ' + name + '\n     ' + String(detail).replace(/\s+/g, ' ').slice(0, 300)); }
async function get(url, headers) {
  var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 25000);
  try {
    var res = await fetch(url, { headers: Object.assign({ 'User-Agent': UA }, headers || {}), signal: ctl.signal, redirect: 'follow' });
    var buf = Buffer.from(await res.arrayBuffer()), ct = res.headers.get('content-type') || '';
    var body = null; if (/json/.test(ct)) { try { body = JSON.parse(buf.toString('utf8')); } catch (e) { body = null; } }
    return { status: res.status, ct: ct, buf: buf, text: buf.toString('utf8'), json: body };
  } finally { clearTimeout(t); }
}
async function probe(name, fn) { try { var d = await fn(); ok(name, d); } catch (e) { bad(name, e.message); } }
function expect(cond, msg) { if (!cond) throw new Error(msg); }

(async function () {
  var t0 = Date.now();
  // Crossref: the record lookup and the fields the page selects
  await probe('Crossref works/{doi} returns the record with the fields the page reads', async function () {
    var r = await get('https://api.crossref.org/works/' + encodeURIComponent(NATURE.doi));
    expect(r.status === 200 && r.json, 'HTTP ' + r.status + ' ' + r.ct);
    var m = r.json.message;
    expect((m.DOI || '').toLowerCase() === NATURE.doi, 'DOI field: ' + m.DOI);
    expect(Array.isArray(m.title) && m.title[0] === NATURE.title, 'title: ' + JSON.stringify(m.title));
    expect(Array.isArray(m.author) && m.author.length === NATURE.authors && m.author[0].family === 'Kucsko', 'author: ' + JSON.stringify(m.author && m.author[0]));
    expect(m.issued && m.issued['date-parts'] && m.issued['date-parts'][0][0] === NATURE.year, 'issued: ' + JSON.stringify(m.issued));
    expect(m['container-title'] && m['container-title'][0] === NATURE.journal && Array.isArray(m['short-container-title']), 'container: ' + JSON.stringify(m['container-title']));
    expect(m.volume === '500' && m.issue === '7460' && m.page === '54-58' && m.type === 'journal-article', 'volume/issue/page/type: ' + [m.volume, m.issue, m.page, m.type].join(' '));
    return 'title, 8 authors, 2013, Nature 500(7460):54-58';
  });
  await probe('Crossref works?query accepts the page\'s select list and ranks the exact title first', async function () {
    var r = await get('https://api.crossref.org/works?rows=3&select=' + SELECT + '&query.bibliographic=' + encodeURIComponent(NATURE.title) + '&query.container-title=Nature');
    expect(r.status === 200 && r.json, 'HTTP ' + r.status + ' ' + r.text.slice(0, 200));
    var items = r.json.message.items || [];
    expect(items.length && items.some(function (it) { return (it.DOI || '').toLowerCase() === NATURE.doi; }), 'top 3: ' + items.map(function (it) { return it.DOI; }).join(', '));
    expect(items[0].title && items[0].author && items[0].issued, 'selected fields missing: ' + Object.keys(items[0]).join(','));
    return 'found in top ' + items.length;
  });
  await probe('Crossref filter=isbn: is still a valid query', async function () {
    var r = await get('https://api.crossref.org/works?rows=1&select=DOI,title,ISBN&filter=isbn:9780262035613');
    expect(r.status === 200 && r.json && r.json.message, 'HTTP ' + r.status + ' ' + r.text.slice(0, 200));
    return (r.json.message['total-results'] || 0) + ' results';
  });
  await probe('Crossref answers a missing DOI with 404 (the page falls through to doi.org on exactly that)', async function () {
    var r = await get('https://api.crossref.org/works/' + encodeURIComponent('10.1038/does-not-exist-autodoi-canary'));
    expect(r.status === 404, 'HTTP ' + r.status);
    return '404';
  });
  // doi.org content negotiation: DataCite DOIs (Zenodo, Figshare) come from here
  await probe('doi.org content negotiation gives CSL JSON for a DataCite DOI', async function () {
    var r = await get('https://doi.org/10.5281/zenodo.3509134', { Accept: 'application/vnd.citationstyles.csl+json' });
    expect(r.status === 200 && /json/.test(r.ct) && r.json, 'HTTP ' + r.status + ' ' + r.ct);
    expect(r.json.title && r.json.DOI, 'fields: ' + Object.keys(r.json).join(','));
    return String(r.json.title).slice(0, 50);
  });
  // OpenAlex: the second search backend; 429 is the "credits used up" state the page handles
  await probe('OpenAlex search answers 200 (or the 429 credit limit the page handles)', async function () {
    var r = await get('https://api.openalex.org/works?per-page=1&select=' + OA_SELECT + '&search=' + encodeURIComponent(NATURE.title));
    if (r.status === 429) return '429: daily credits used up, which the page handles';
    expect(r.status === 200 && r.json, 'HTTP ' + r.status + ' ' + r.text.slice(0, 200));
    var w = (r.json.results || [])[0];
    expect(w && /nature12373/i.test(w.doi || ''), 'first result: ' + JSON.stringify(w && w.doi));
    expect(Array.isArray(w.authorships) && w.publication_year === NATURE.year && w.biblio && w.primary_location, 'fields: ' + Object.keys(w).join(','));
    return 'doi, authorships, year, biblio, primary_location present';
  });
  await probe('OpenAlex works/{doi} answers 200 (or 429)', async function () {
    var r = await get('https://api.openalex.org/works/' + encodeURIComponent('https://doi.org/' + NATURE.doi) + '?select=' + OA_SELECT);
    if (r.status === 429) return '429: daily credits used up';
    expect(r.status === 200 && r.json && /nature12373/i.test(r.json.doi || ''), 'HTTP ' + r.status + ' ' + r.text.slice(0, 200));
    return 'ok';
  });
  // Europe PMC: PubMed IDs
  await probe('Europe PMC resolves a PMID to its DOI', async function () {
    var r = await get('https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=lite&query=' + encodeURIComponent('EXT_ID:' + NATURE.pmid + ' AND SRC:MED'));
    expect(r.status === 200 && r.json && r.json.resultList, 'HTTP ' + r.status + ' ' + r.text.slice(0, 200));
    var hit = (r.json.resultList.result || [])[0];
    expect(hit && (hit.doi || '').toLowerCase() === NATURE.doi, 'first hit: ' + JSON.stringify(hit && hit.doi));
    return 'PMID ' + NATURE.pmid + ' -> ' + hit.doi;
  });
  // NLM Catalog: journal abbreviations
  await probe('NLM Catalog esearch by ISSN then esummary gives the MEDLINE abbreviation', async function () {
    var s = await get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=nlmcatalog&retmode=json&term=' + encodeURIComponent(NATURE.issn + '[issn]'));
    expect(s.status === 200 && s.json && s.json.esearchresult && s.json.esearchresult.idlist && s.json.esearchresult.idlist.length, 'esearch: HTTP ' + s.status + ' ' + s.text.slice(0, 200));
    var id = s.json.esearchresult.idlist[0];
    var m = await get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=nlmcatalog&retmode=json&id=' + id);
    expect(m.status === 200 && m.json && m.json.result && m.json.result[id], 'esummary: HTTP ' + m.status + ' ' + m.text.slice(0, 200));
    expect(m.json.result[id].medlineta === 'Nature', 'medlineta: ' + m.json.result[id].medlineta);
    return 'medlineta = Nature';
  });
  // Open Library: ISBNs
  await probe('Open Library answers an ISBN lookup', async function () {
    var r = await get('https://openlibrary.org/isbn/9780262035613.json');
    expect(r.status === 200 && r.json && r.json.title, 'HTTP ' + r.status + ' ' + r.ct + ' ' + r.text.slice(0, 120));
    return String(r.json.title).slice(0, 40);
  });
  // JabRef abbreviation lists
  await probe('JabRef abbreviation lists are where the page fetches them', async function () {
    var n = 0;
    for (var f of ['journal_abbreviations_general.csv', 'journal_abbreviations_geology_physics.csv']) {
      var r = await get('https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/' + f);
      expect(r.status === 200 && r.text.split('\n').length > 500, f + ': HTTP ' + r.status);
      n += r.text.split('\n').length;
    }
    return n + ' lines';
  });
  // The citation engine and its integrity hash
  await probe('citeproc from jsDelivr still matches the Subresource Integrity hash in the page', async function () {
    var r = await get(CITEPROC);
    expect(r.status === 200, 'HTTP ' + r.status);
    var hash = 'sha384-' + crypto.createHash('sha384').update(r.buf).digest('base64');
    expect(hash === SRI, 'served ' + hash + ' vs page ' + SRI);
    return (r.buf.length / 1024).toFixed(0) + ' KB, hash matches';
  });
  await probe('Pinned CSL style and locale commits are reachable', async function () {
    var s = await get('https://raw.githubusercontent.com/citation-style-language/styles/' + STYLES_SHA + '/nature.csl');
    var d = await get('https://raw.githubusercontent.com/citation-style-language/styles/' + STYLES_SHA + '/dependent/nature-geoscience.csl');
    var l = await get('https://raw.githubusercontent.com/citation-style-language/locales/' + LOCALES_SHA + '/locales-en-US.xml');
    expect(s.status === 200 && /<style[\s>]/.test(s.text), 'nature.csl: HTTP ' + s.status);
    expect(d.status === 200 && /independent-parent/.test(d.text), 'dependent/nature-geoscience.csl: HTTP ' + d.status);
    expect(l.status === 200 && /<locale[\s>]/.test(l.text), 'locale: HTTP ' + l.status);
    return 'style, dependent style, locale';
  });
  await probe('Zotero style index (source of data/styles-index.json) is available', async function () {
    var r = await get('https://www.zotero.org/styles-files/styles.json');
    expect(r.status === 200 && Array.isArray(r.json) && r.json.length > 9000, 'HTTP ' + r.status + ' ' + (r.json && r.json.length));
    return r.json.length + ' styles';
  });
  // The live page
  await probe('Live page serves the version in this repository', async function () {
    var r = await get(LIVE);
    expect(r.status === 200, 'HTTP ' + r.status);
    var v = (r.text.match(/var APP_VERSION = '([^']+)'/) || [])[1];
    expect(v === pkg.version, 'live ' + v + ' vs repository ' + pkg.version);
    expect(/Content-Security-Policy/.test(r.text) && /rel="icon"/.test(r.text), 'CSP or favicon missing');
    return 'v' + v;
  });
  await probe('Live page data files are reachable', async function () {
    for (var f of ['data/styles-index.json', 'data/endnote-shortlist.json', 'data/common-words.js']) {
      var r = await get(LIVE + f);
      expect(r.status === 200 && r.buf.length > 1000, f + ': HTTP ' + r.status + ' ' + r.buf.length + ' bytes');
    }
    return '3 files';
  });
  console.log('\n' + passed + ' passed, ' + failed + ' failed  (' + (Date.now() - t0) + ' ms)');
  process.exitCode = failed ? 1 : 0;
})();
