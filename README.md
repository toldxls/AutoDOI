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
| `apps-script/Code.gs` + `apps-script/Citations.gs` | The same logic as Google Sheets custom functions plus an export menu. |

After editing `citations.js`, run `./build.sh`; it updates both `index.html` and `apps-script/Citations.gs`.

## Web tool

1. **DOI → reference.** Paste a DOI, doi.org link, or any text containing one. You get APA 7, MLA 9, Chicago 17, Harvard, Vancouver and IEEE, plus BibTeX, RIS and EndNote tagged. *Copy* gives plain text. *Rich* keeps the italics for Word and Google Docs.
2. **Find a DOI.** Title plus optional journal. Best matches come back with a match chip; *Format* sends one to the first tab.
3. **Reference → EndNote.** Paste one or more references (one per line, any style). Each is matched against Crossref and colour-coded green / amber / red by how well the record's title, year and first author appear in your text. Untick anything wrong, then copy the combined `.enw` or `.ris` text. Download buttons appear when the page is opened from disk or from the GitHub Pages site.

Import into EndNote: *File → Import → File*, import option **EndNote Import** for `.enw` or **Reference Manager (RIS)** for `.ris`.

## Google Sheets version

1. In a sheet: *Extensions → Apps Script*.
2. Replace the default `Code.gs` with `apps-script/Code.gs`. Add a second file named `Citations` and paste `apps-script/Citations.gs`.
3. Save, then reload the spreadsheet. Grant the URL-fetch and Drive permissions when asked.

| Formula | Result |
| --- | --- |
| `=DOI_CITE(A2, "apa")` | Reference. Styles: `apa`, `mla`, `chicago`, `harvard`, `vancouver`, `ieee`, `bibtex`, `ris`, `endnote` |
| `=DOI_CITE(A2:A100, "vancouver")` | Whole column at once |
| `=FIND_DOI(B2, C2)` | Best DOI for title B2 and journal C2 |
| `=FIND_DOI(B2, C2, TRUE)` | DOI, matched title, journal, year and a 0–1 confidence, as a row |
| `=REF_TO_DOI(D2)` / `=REF_TO_ENW(D2)` / `=REF_TO_RIS(D2)` | From a pasted reference in any style |

Menu **AutoDOI → Export selection as .enw / .ris** matches every selected cell (DOIs or references) and writes one import file to your Drive.

Set `POLITE_EMAIL` at the top of `Code.gs` to your email to get Crossref's faster polite pool. Results are cached for six hours so recalculation does not re-query.

## Caveats

- Titles are output as deposited by the publisher. APA wants sentence case and MLA title case, so some titles need a manual tweak.
- Reference matching is a search, not parsing. Always check the match chip before importing; a reference with no Crossref record (grey literature, old books) will return the nearest wrong paper.
- Crossref's public pool occasionally rate-limits bursts. The Sheets version caches; the web tool paces batch requests.
