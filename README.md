# AutoDOI

Turn messy references into clean ones. Paste a reference list in any style and get it back matched to Crossref, formatted in APA, Vancouver, Chicago or any of 10,000 journal styles, or exported as RIS, EndNote or BibTeX. Or start from a DOI, a title, or an ISBN.

**Use it:** https://toldxls.github.io/AutoDOI/

Everything runs in your browser. Nothing is stored on a server, there is no tracking, and only the identifiers or text you look up are sent to the public scholarly APIs (Crossref, doi.org, OpenAlex, Unpaywall, Europe PMC, Open Library, the NLM Catalog). For an offline copy, download `index.html` and open it; style search and title conversion need the `data/` folder beside it.

## The three tabs

**References → any style.** Paste one reference or a whole list, however messy, or drop a `.ris`, `.enw` or `.bib` file. Each reference is matched against Crossref (OpenAlex as a second opinion) and graded green, amber or red by how well the record's title, year and first author appear in your text. Only green rows are ticked for export; anything unmatched stays in the list exactly as you pasted it. Rows show what differs from the record (a misspelt journal, a wrong year, missing diacritics), offer a runner-up under *Not this one?*, flag duplicates, preprints and retracted papers, and give a box to paste the right DOI. Export the list in any style or as `.enw`, `.ris` or BibTeX.

**Find a DOI.** Title plus optional journal; the best matches come back with a match chip.

**DOI → reference.** Paste a DOI, doi.org link, arXiv ID, PubMed or PMC ID, ISBN, or any text containing one. You get APA 7, MLA 9, Chicago 17, Harvard, Vancouver, IEEE and Annals of Carnegie Museum, plus BibTeX, RIS and EndNote tagged, or search the [Citation Style Language](https://citationstyles.org/) repository for a journal style, rendered by citeproc-js. Under each reference is its in-text citation with its own *Copy*: parenthetical and narrative forms, Chicago's footnote, or the number for Vancouver and IEEE. Type the pages you are citing in *Cite pages* and every form takes them. *Copy* gives plain text, *Rich* keeps italics for Word and Google Docs, *Copy link* gives a URL that reopens the same reference in the same style (`?q=10.1038/nature12373&style=csl:geology`). A retracted paper carries a red **Retracted** chip and a line naming each notice, from Crossref's record with the Retraction Watch database; corrections and expressions of concern are flagged in amber. *Free PDF* opens a legal open-access copy when Unpaywall or OpenAlex knows one; *Via library* appears once you set your library proxy under Settings.

The record you are working with follows you across the tabs.

## Details worth knowing

- **Titles.** The *Titles* control converts article titles to Sentence case or Title Case, keeping taxa, place names and acronyms; click a highlighted word to override it. Chemical formulas, isotopes and charges are set with real sub- and superscripts (Mg₂SiO₄, Fe³⁺, ⁴⁰Ar/³⁹Ar); turn this off under Settings if a title is misread.
- **Journal abbreviations** for Vancouver and short-form styles come from the NLM Catalog, then the JabRef lists.
- **Speed.** Crossref's public pool answers one search at a time (about 2 s per reference). An email under Settings puts you in the polite pool, about three times faster; it goes only to Crossref and OpenAlex.
- **EndNote styles.** `.ens` files are a closed format and cannot be read; the CSL repository covers most of the same journals, and a checkbox narrows the search to the 261 that ship with EndNote 21. A journal missing from both can be hand-written in `citations.js`, as Annals of Carnegie Museum was (it follows the CMNH authors' guide of 6 January 2010).
- **Import into EndNote:** *File → Import → File*, option **EndNote Import** for `.enw` or **Reference Manager (RIS)** for `.ris`.
- **Caveat.** Matching is a search, not parsing. A reference with no Crossref or OpenAlex record returns the nearest wrong paper, so check the chip before importing.

## Google Sheets

`apps-script/Code.gs` and `apps-script/Citations.gs` give the same logic as custom functions: `=DOI_CITE(A2, "apa")`, `=FIND_DOI(B2, C2)`, `=REF_TO_DOI(D2)`, `=REF_TO_RIS(D2)`, plus an export menu. Paste them into *Extensions → Apps Script*, replace the manifest with `apps-script/appsscript.json`, and set `POLITE_EMAIL` at the top of `Code.gs`. Results are cached for six hours; cells that hit the 30-second limit read `Retry` and fill on recalculation.

## Bugs and missing styles

Use **Report a bug** and **Request a journal style** at the foot of the page; they open a prefilled GitHub issue. The **Report it** link under a result carries its DOI, style and the last error messages. Nothing is sent unless you open the report.

## Development

Plain JavaScript, no runtime dependencies. `citations.js` holds every citation rule, `parsers.js` reads RIS, EndNote and BibTeX, `sentencecase.js` converts titles; `build.sh` inlines them into `index.html` and refreshes the Sheets copy.

```
./build.sh              # after editing any library file
npm test                # unit suites, smoke checks, syntax and version checks
npm install && npx playwright install chromium
npm run test:browser    # the built page in headless Chromium, APIs mocked, plus axe accessibility checks
npm run bench:match     # live matching benchmark against real Crossref (run when the grader or splitter changes)
```

The suites include oracles independent of this project's reading of the rules: reference examples and their in-text forms as printed by APA, Chicago, MLA, NLM and IEEE, the Carnegie guide's own examples, 600 random Crossref records of every work type run through every style with invariants and a parse-back round trip, fuzzing, and mapping checks against Crossref, OpenAlex and DataCite. CI runs everything on each push, and a weekly canary probes the real services. See `CONTRIBUTING.md` for where things live and how versions are bumped, `CHANGELOG.md` for what changed.

Journal styles and the locale are pinned to upstream commits; `tools/bump-csl-pin.sh` moves them. The page has a strict Content Security Policy, loads citeproc with an integrity hash, and passes axe in every tab in light and dark mode.

## License

MIT. See `LICENSE`.
