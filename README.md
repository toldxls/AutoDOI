# AutoDOI

Turn a DOI into a reference, find a DOI from a title, and convert pasted references to EndNote or RIS. Metadata comes live from [Crossref](https://api.crossref.org) with a fallback to doi.org content negotiation (covers DataCite DOIs such as Zenodo and Figshare).

## Use it

**No install.** Open the live page: **https://toldxls.github.io/AutoDOI/** and bookmark it. Everything runs in your browser; the only network calls go to api.crossref.org and doi.org.

**Offline copy.** Download `index.html` (Code → Download ZIP, or the raw file) and double-click it. It is a single self-contained file.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The web tool, single file, with `citations.js` inlined by `build.sh`. |
| `citations.js` | The formatting library: the only place citation rules live. |
| `build.sh` | Re-inlines `citations.js` into `index.html` and refreshes the Apps Script copy. |
| `data/styles-index.json` | Name and title of every CSL style, from Zotero's style index. Loaded only when you open the style search. |
| `data/endnote-shortlist.json` | CSL styles whose titles match the `.ens` files in an EndNote 21 Styles folder. |
| `tools/build-style-index.py` | Regenerates both data files. Pass your EndNote Styles folder to refresh the shortlist. |
| `apps-script/Code.gs` + `apps-script/Citations.gs` | The same logic as Google Sheets custom functions plus an export menu. |

After editing `citations.js`, run `./build.sh`; it updates both `index.html` and `apps-script/Citations.gs`.

## Web tool

1. **DOI → reference.** Paste a DOI, doi.org link, arXiv ID, PubMed or PMC ID, or any text containing one. You get APA 7, MLA 9, Chicago 17, Harvard, Vancouver, IEEE and Annals of Carnegie Museum, plus BibTeX, RIS and EndNote tagged. The **Style** dropdown shows all of them, just one, or opens a search across the 10,000+ journal styles of the [Citation Style Language](https://citationstyles.org/) repository (Nature, Geology, American Mineralogist, and so on), rendered in the browser by citeproc-js. Tick *Only the styles that also ship with EndNote* to narrow the search to the 261 styles whose names match EndNote 21's Styles folder. Styles you pick are remembered in the dropdown and in the batch tab's reference list. *Copy* gives plain text. *Rich* keeps the italics for Word and Google Docs. Link straight to a lookup with `?q=`, e.g. `https://toldxls.github.io/AutoDOI/?q=10.1038/nature12373`, or drag the bookmarklet in Settings to your bookmarks bar to cite the article page you are reading.
2. **Find a DOI.** Title plus optional journal. Best matches come back with a match chip; *Format* sends one to the first tab.
3. **Reference → EndNote.** Paste one or more references in any style, one per line, or separated by blank lines if they wrap. Each is matched against Crossref and colour-coded green / amber / red by how well the record's title, year and first author appear in your text. Untick anything wrong, then copy the combined `.enw`, `.ris` or BibTeX text, or a clean reference list re-formatted in any of the styles (alphabetical, or numbered for Vancouver and IEEE). Cmd/Ctrl+Enter submits.

### Annals of Carnegie Museum style

Follows the *Literature Cited* section of the CMNH Publications Authors' Guide (6 January 2010): every author named with no "et al.", initials without spaces (`Rawlins, J.E.`), a comma before "and", periodicals spelled out, `Journal, volume(issue):pages` with no space after the colon, books as `Title. Publisher, Place.`, chapters as `Pp. x-y, in Book (Editors, eds.). Publisher, Place.`, dissertations and web resources per the guide's examples. The in-text form, `(Wible et al. 2002)`, is shown under the reference. DOIs are omitted because the guide does not use them.

Import into EndNote: *File → Import → File*, import option **EndNote Import** for `.enw` or **Reference Manager (RIS)** for `.ris`.

## Google Sheets version

1. In a sheet: *Extensions → Apps Script*.
2. Replace the default `Code.gs` with `apps-script/Code.gs`. Add a second file named `Citations` and paste `apps-script/Citations.gs`.
3. Save, then reload the spreadsheet. Grant the URL-fetch and Drive permissions when asked.

| Formula | Result |
| --- | --- |
| `=DOI_CITE(A2, "apa")` | Reference. Styles: `apa`, `mla`, `chicago`, `harvard`, `vancouver`, `ieee`, `carnegie`, `bibtex`, `ris`, `endnote`. Also accepts arXiv, PubMed and PMC IDs |
| `=DOI_CITE(A2:A100, "vancouver")` | Whole column at once |
| `=FIND_DOI(B2, C2)` | Best DOI for title B2 and journal C2 |
| `=FIND_DOI(B2, C2, TRUE)` | DOI, matched title, journal, year and a 0–1 confidence, as a row |
| `=REF_TO_DOI(D2)` / `=REF_TO_ENW(D2)` / `=REF_TO_RIS(D2)` | From a pasted reference in any style |

Menu **AutoDOI → Export selection as .enw / .ris** matches every selected cell (DOIs or references) and writes one import file to your Drive.

Set `POLITE_EMAIL` at the top of `Code.gs` to your email to get Crossref's faster polite pool. Results are cached for six hours so recalculation does not re-query.

## License

MIT. See `LICENSE`.

## EndNote `.ens` styles

EndNote's own style files are a proprietary binary format that nothing outside EndNote can read, so they cannot be loaded here directly. The Citation Style Language repository covers most of the same journals under the same names; the search box finds them and the EndNote checkbox shows which ones overlap. A journal missing from both can be added as a hand-written style in `citations.js`, as Annals of Carnegie Museum was.

## Caveats

- Titles are output as deposited by the publisher. APA wants sentence case and MLA title case, so some titles need a manual tweak.
- Reference matching is a search, not parsing. Always check the match chip before importing; a reference with no Crossref record (grey literature, old books) will return the nearest wrong paper.
- Crossref's public pool occasionally rate-limits bursts. The Sheets version caches; the web tool paces batch requests.
