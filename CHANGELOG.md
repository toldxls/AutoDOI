# Changelog

Versions follow [semver](https://semver.org/). The version shown in the page footer and in bug reports is `APP_VERSION` in `index.html`; `package.json` and this file carry the same number, and the tests fail if they drift.

## Unreleased

## 1.3.0 - 2026-09-24

- A database or platform name carried by an imported file (RIS `DP` or `DB`, EndNote `%W`) and its accession number (`AN`, `%M`) are now kept. MLA prints the database as the second container with the location ("pp. 69–88. JSTOR, www.jstor.org/stable/41403188."), Chicago prints it in place of a URL when there is no DOI ("Project MUSE.", "ProQuest (13865986)."), APA uses it as a dissertation's archive when the file names no publisher, and the RIS and EndNote exports write it back. Six more of the style authorities' published examples now reproduce exactly (72 in all).
## 1.2.1 - 2026-09-24

- A journal article's issue month and day now come from Crossref's print date when its year matches, not from the earliest (usually online) date, so Vancouver, Chicago, MLA and IEEE print the issue date PubMed and the journal print ("Nature. 2013 Aug;500(7460):54-8."). The first canary run caught this against the live page and opened its issue as designed.
## 1.2.0 - 2026-09-24

- References now match the style authorities' own published examples exactly: 66 examples from the APA Style site, the Chicago Manual of Style citation guide, the MLA Style Center, NLM's Citing Medicine and formatted-reference samples, and the IEEE Reference Guide are reproduced from their metadata in `tests/golden-styleguides.test.js` (27 more are listed there as needing data no source supplies). Corrections this forced: APA prints a web page's full date, a retrieval date when one was recorded, a chapter's edition before its pages, a dissertation's publication number and archive, a report number in place of a bracketed label, and no "[Preprint]" label; Chicago prints the issue month, "PhD diss.," and an access date for undated pages; MLA prints issue months and full web dates, and starts an authorless edited book with its title; Vancouver prints month and day, name suffixes as "Jr" and "3rd", an organisation author after a semicolon, book page counts, a chapter's book edition and volume, supplements without a volume, and "doi: … ." as NLM does; IEEE uses "Ed.," before the place, a comma after a proceedings title, the book volume and edition, three-letter months, and puts an article number after the date. A title ending in a quoted sentence no longer gets a second period.
- Three new oracles independent of the project's own reading of the rules: the Annals of Carnegie Museum guide's printed examples reproduced exactly; an invariant sweep over 600 random real Crossref records of 19 work types through every style, export and a parse-back round trip; and a seeded fuzz suite over mutated export files, reference lists and records.
- Found by them and fixed: an entity encoded three times over (`&amp;amp;#8220;`) leaked into references; a family name holding its own suffix ("Dorn, III") was exported in the wrong order; a given name that was a bare comma printed as ",."; a line break between italics and a hyphen produced "ipso -nitration"; a stray space before punctuation in a deposited title was kept; a tag inside a DOI field survived; the Carnegie style dropped the edition of an edited work in a series and wrote "Ph.D. Thesis" where the guide says "Ph.D. Dissertation".
- Hardening: the formatters coerce every field of a hand-built record, the HTML renderer escapes anything but its own inline tags and strips private-use characters, the page parses HTML it did not build with an inert parser, and the Content Security Policy allows scripts only by hash (no `unsafe-inline`).
- A weekly canary against the real services and the live page, with an issue opened on failure and closed on recovery.
- Browser suite now also covers a journal style rendered through citeproc (search, pick, deep link), RIS and BibTeX file import, Title Case conversion, the Settings panel, and every flow in dark mode as well as light. The citation engine, one style and the locale are fetched once into a local cache; everything else stays mocked.
- Browser suite: a dependent CSL style (Nature Geoscience) is rendered through its parent, including by deep link on a fresh page, and a phone-width pass (390 px, touch) checks that no tab overflows sideways before or after content arrives, that tap targets are at least 24 px tall, and that axe still passes.
- `tests/sheets-menu.test.js` runs the Google Sheets menu and custom functions against stubbed Apps Script services: menu registration, Drive export files in EndNote and RIS form, alert text, misses, and the `DOI_CITE`, `FIND_DOI`, `REF_TO_DOI` and `REF_TO_RIS` formulas.

## 1.1.0 - 2026-09-23

- The page shows its version in the footer, and bug reports carry the version and browser even when no error was logged.
- Favicon.
- Journal styles and the citation locale are pinned to fixed Citation Style Language commits, so a reference renders the same way from one visit to the next. `tools/bump-csl-pin.sh` moves the pins.
- Browser test suite (Playwright, offline with mocked APIs) covers the three tabs, deep links, lookups, matching, error reporting and axe accessibility checks; it runs in CI next to the unit suites.
- Syntax and consistency suite: every shipped script must parse, the Apps Script and inlined copies must be current, and the version string must agree everywhere.
- GitHub Pages now deploys from the CI workflow only after all tests pass, so a broken push never reaches the live page.
- Repository housekeeping: contributing and security guides, pull request template, Dependabot for the CI actions and test dependencies, `.nvmrc`, `.editorconfig`.

## 1.0.0 - 2026-09-23

- First tagged version: DOI to reference in APA, MLA, Chicago, Harvard, Vancouver, IEEE and Annals of Carnegie Museum plus 10,000 CSL styles; DOI finder; reference list matching and export to EndNote, RIS and BibTeX; sentence case and Title Case conversion; chemical formula formatting; Google Sheets functions.
