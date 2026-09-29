# Changelog

Versions follow [semver](https://semver.org/). The version shown in the page footer and in bug reports is `APP_VERSION` in `index.html`; `package.json` and this file carry the same number, and the tests fail if they drift.

## 1.11.0 - 2026-09-29

### New

- **Pick from the list.** A title row on the References tab lists every close title under it as on Find a DOI, open when the match is not exact so you click the paper you mean, folded under *Other matches* when it is. The chosen paper is green as *Your pick* and the list comes back with the row on your next visit.

## 1.10.0 - 2026-09-28

### New

- **A title is enough.** On the References tab a line that is only a paper's title, with or without its journal and year (*Deep learning, Nature 2015*), is looked up by title as on Find a DOI, and comes back green as *Found by title* when the title matches exactly. Several titles one per line are split one per row.

### Changed

- Find a DOI and the References tab share one title search. Equal titles rank the journal version above a preprint or chapter, and a year on the line breaks ties.
- The References tab's lead and example mention bare titles.

### Fixed

- The References tab's example list cites Watson and Crick (1953) in place of a NeurIPS paper Crossref does not hold, which came back amber; its lead is shorter.
- "Keep as written in the list" no longer wraps onto three lines: the fix row's width rule for its text box also caught the checkbox.

## 1.9.0 - 2026-09-27

### Changed

- **Click a hit to format it.** On Find a DOI the whole result card is the control, lit on hover and once picked; there is no Format button.
- **Click a row to include it.** On the References tab a matched row goes into the export when clicked anywhere on it and is tinted while it is in; the Include checkbox is gone (it remains for keyboards and screen readers, unseen).
- **Editing follows as you type.** Click the title or the byline of a record, or press *Edit*, and the reference rebuilds under each keystroke; *Done* closes the editor and *Undo changes* restores the record. There is no Apply.
- **Tab fills in the example.** In an empty box on any tab, Tab fills in the example the box shows, so it can be tried in one keystroke; a second Tab moves on as usual.
- *Write a reference by hand* moved from under the DOI box to the foot of the tab. The Search button on Find a DOI stands on the same line as its boxes.

### Fixed

From an adversarial review of the whole codebase:

- The grader no longer greens a paper whose title names a different part ("Part I" against "Part II") or a one-word title ("Introduction") whose volume and page disagree.
- A `?q=` link's lookup is no longer replaced by a remembered list or a title hit that finishes first; a `?refs=` link keeps a DOI holding a comma or a percent sign.
- The Word download strips characters XML forbids, so Word opens it; the editor keeps a report number and a book's page count.
- The splitter: a stray indented line no longer turns the paste into a hanging-indent layout, a publisher's place or an editor line no longer opens a new reference, numbered lists run past 999, the same DOI twice in one reference is one reference, a list of plain URLs in one-per-line mode stays a list, and a long single-line paste no longer freezes the tab.
- A corrupted remembered list no longer stops the page from loading; reading a Word manuscript no longer changes the remembered layout; a damaged Word file says so.
- A free-copy lookup that got no answer is asked again next time; the service worker no longer caches a 404 or 5xx page as the offline copy.
- The command line: `--match` with references as arguments prints in APA, an ISBN lookup keeps author, year and publisher, `--match` with nothing on a terminal says so instead of waiting, and unknown or valueless options are errors.
- The library: a DOI followed by a very long tail is stripped in linear time, a versioned arXiv DOI loses its version, an object-valued field is empty rather than "[object Object]", a null record formats as an empty one, a brace in a DOI or URL keeps the BibTeX entry balanced, a line break in a hand-built field is one space in RIS, and "Press, William H." and "SMITH JA" are read as people.

## 1.8.0 - 2026-09-26

### New

- **Command line.** `node bin/autodoi.js` (or `npx autodoi` once published) formats DOIs, arXiv IDs, PubMed IDs and ISBNs in any style or export, and `--match` reads a pasted reference list from stdin and matches it at Crossref. `package.json` names the library and the CLI for publishing.
- **Installable and offline.** A web app manifest and a service worker keep the page, its data files and the pinned citation styles once visited. Lookups still need the network.
- **Word in and out.** The reference list downloads as a `.docx` with a hanging indent, italics and sub- and superscripts. Dropping a Word manuscript on the References tab reads its reference list (or its footnotes and endnotes) into the box. Both are done in the browser with no library.
- **In-text citations.** Every reference on the DOI tab, and optionally every entry in the reference list, shows its in-text form with its own Copy: parenthetical and narrative, Chicago's note, or the number. A *Cite pages* field adds the pages in each style's form.
- **Retractions flagged.** A retracted, corrected or concerned work carries a chip and a line naming each notice, on the DOI tab and on every matched row. The reference itself is printed unchanged.
- **Free copies.** A record on the DOI tab looks up a legal free copy on Unpaywall and OpenAlex and offers a *Free PDF* button that says which version it opens. Matcher rows and Find-a-DOI hits look only when asked. A library link under Settings adds a *Via library* button.
- **Edit or write a record.** *Edit* opens a form over the record's fields and rebuilds it; *Write a reference by hand* opens the same form empty for a web page, report or anything without a DOI.
- **Journal styles in other languages.** A *Language of journal styles* setting offers the 52 CSL locales; the built-in styles stay English.
- **Two more exports.** *Your text with DOIs added* returns the list as pasted with each match's DOI link on its line. *CSL JSON* joins BibTeX, RIS and EndNote.
- **Your list comes back.** The References box and every resolved row are kept in the browser, so a remembered list rebuilds on the next visit with no lookup. *Copy link* gives a link that reopens the ticked rows from their DOIs.

### Changed

- **References → any style** is now the first tab and opens by default. Settings is a button in the header. The export sits in its own *Your export* box under the rows.
- The record you are working with follows you across tabs: a DOI lookup fills the other tabs' empty boxes, a title hit or the first good matched row takes the DOI tab, and every matched row has a *Format* button.
- Matcher rows say more: a wrong initial or year shows both sides, a name typed without diacritics is marked in blue with the record's spelling, and a close runner-up is offered under *Not this one?*.
- Pasting keeps sub- and superscripts from Word, Google Docs and browsers, and repairs text whose UTF-8 was read as Windows-1252.
- Diacritics go both ways: a name typed with them lends them to a record that lacks them, so the output keeps them.
- Arabic and Hebrew references are recognised by the splitter, and an IMA-style mineral formula reads "Fe2+" as a charge rather than a sum.

### Fixed

- Row marks no longer flag abbreviated journals, hyphenated line breaks, months, "2013a", "and others", "[Internet]", retrieval dates, or a record's abbreviated page range, and no longer read the next author's initial as this author's.
- The grader no longer greens a full reference whose title disagrees with the record just because its numbers agree, and no longer reads an issue number or a list number as a volume.
- The mojibake repair works line by line and run by run, so real text such as "Å³" and "10 × 10" is kept while a garbled line beside a clean one is repaired.
- A paste from Word no longer gains blank lines between paragraphs; hidden and struck text is dropped; a superscript footnote number after a DOI stays out of it.
- A click outside the Settings panel closes it.

## 1.7.0 - 2026-09-24

- References in Cyrillic, CJK and Greek scripts are now graded properly. The grader's tokeniser dropped every non-Latin letter, so a Russian or Japanese record could never score against the reference that cited it, whatever Crossref found. Words of any script now count, CJK text is read as overlapping character pairs, a Cyrillic name also matches its Latin transliteration in a record ("Пароникян" and "Paronikyan"), and ё is е. Two script-independent gaps found alongside: a compact citation with no title (authors, journal, year, volume and page, the norm in Russian physics journals and in "Physica B 211 (1995) 52") is graded by those four agreeing, a journal's own Crossref record, whose title is the journal name every reference contains, is never a match, and the page and the Sheets script now ask Crossref for `original-title`, the native-script title it holds beside an English translation for Chinese and Japanese journals, and grade against it.
- The matching bench has a `nonlatin` variant: 222 references in Cyrillic (149), Japanese and Chinese (66) and Greek (7) as publishers deposited them, each with its DOI. Before: green recall 9.9% and precision 78.9%, Crossref having found 80% of the records the grader then scored red. After: green recall 65.3% and precision 98.6%; Cyrillic 117 of 149 green, CJK 23 of 66 green out of 24 found, Greek 5 of 7. The three remaining "wrong" greens are deposited DOIs pointing at the wrong paper (a SAGE and a Kluwer DOI on Japanese coastal-engineering and seismology references, an Emerald DOI on a Russian one) where the record found is the cited paper. The Latin variant rose alongside, from 88.2% to 91.4% green recall, as compact physics citations began to grade.
## 1.6.0 - 2026-09-24

- Title conversion checked against the publishers' own casing: `tests/case-sweep.test.js` takes the 638 corpus and style-guide titles, requires a title deposited in sentence case to come back from Sentence case unchanged (95% do, the rest are conventions such as a capital after a colon or an ambiguous name), a Title Case title to keep every substantive capital through Title Case (99.5% do), both conversions and the formula detector to be idempotent, and acronyms to survive. Fixed from it: "Wi-Fi" no longer loses its capital F (a hyphenated compound whose first part is not an English word is a name), and a place name whose first word is an ordinary word is kept whole when an unknown word and a geographic head follow ("Bang Pakong River Basin"), while "Big Tyrannosaurus bones" is still lowercased.
- Two more mapping oracles: `tests/openalex-oracle.test.js` maps 147 OpenAlex works fetched with the page's own select list and compares them with the Crossref record of the same DOI; `tests/datacite-oracle.test.js` runs 120 random DataCite records' doi.org CSL JSON through the normaliser against DataCite's own metadata. Fixed from them: OpenAlex conference papers, standards, editorials, letters, errata and reviews were mapped to a generic type; a DOI built on an ISBN is now read as a book, or a chapter when it carries a part number, whatever a source calls it. Both suites separate source loss from our own errors: OpenAlex's online-first years and "and" for "&", DataCite CSL JSON that disagrees with DataCite's own year or calls a chapter an article.
- Chicago prints "n.d." for an undated work, as the manual and the official CSL style do; an undated web page keeps its access date instead.
- `tests/csl-compare.js` renders the corpus through the official APA, MLA, Chicago 17, NLM Vancouver, IEEE and Harvard CSL styles with citeproc and tallies the words that differ from the built-in formatters, so systematic disagreements stand out; APA agrees outright on 84 of 150 sampled records and the remaining differences are documented conventions. PubMed was tried as a sentence-case oracle and rejected: of 525 recent articles from Title Case publishers, one title differed by case, so PubMed now keeps the publisher's casing.
- New oracle for the file parsers: Crossref's own RIS and BibTeX renderings of 147 corpus records (`tests/fixtures/crossref-exports.json`), parsed and compared field by field with the record they came from. Fixes it forced: a generic RIS type or BibTeX `@misc` with an ISBN is read as a book, or as a chapter when it names the book; a DOI shaped like a preprint server's (bioRxiv, PsyArXiv, Research Square, ChemRxiv, SSRN, EGUsphere and others) makes a journal-less record a preprint whatever type the file said; a title's line break next to `<sup>` markup survives so "125I" is set as an isotope rather than "125 I"; and the BibTeX whitespace pass is linear again (a 200,000-space value took 17 seconds).
## 1.5.0 - 2026-09-24

- Two references run together on one line are now split before matching, in every layout mode: physics-style "…Physica B 211 (1995) 52; S. Askenazy, Physica B 216 (1996) 221.", two author-date references simply run together, and "ibid. 22 (1967) 235", which inherits the previous reference's authors and journal. A cut is taken only where the left part already reads as a whole reference (a year plus a volume, page or identifier) and the right part opens like one (a name with initials followed by another author or a year, or initials first), so semicolons between authors, "Nature 1995; 375: 123", a semicolon inside a title, and a place or organisation after a title ("Cambridge, MA: Harvard", "Kandy, Sri Lanka") never split. Lines the rule cannot separate keep the "May be two references" flag.
- The matching bench has a `glued` variant: 76 lines each holding two real references joined with "; ", a bare space or ". ", pasted in automatic layout. Before this change none of the 76 lines was split and 71 of the 152 references came back; now 59 lines split cleanly (all 26 joined with "; " but one), one line holding two double citations splits into four, and 123 references come back green with no new wrong greens. The 16 lines left whole have a left half with no year or no page numbers, which the rule requires. The splitter bench's 85 real lists now count an entry that holds several citations as several, and check that no single reference is ever cut.
## 1.4.0 - 2026-09-24

- Matching grades fewer right answers as "check": British and American spellings compare equal (behaviour/behavior, sulphide/sulfide, palaeo/paleo, modelling/modeling), a title word within a typo or two still counts (a PDF's dropped "fi" ligature: "fuids"), a hyphenated compound written solid on one side matches ("calc-alkaline"/"calcalkaline"), a reference that drops the record's subtitle scores on the main title, "(1964a)" is read as a year, an organisation deposited as first author no longer fails the author check (the first person is checked instead), and a missing year costs less when the author matches. Guards are unchanged: a different year, a different title, or a corrigendum in place of the paper are never green.
- `tests/browser/match-bench.js` measures this against 152 references exactly as publishers deposited them in Crossref reference lists, each with the DOI it resolved to (`tests/fixtures/match-truth.json`), and two degraded variants (lowercased with punctuation stripped; year removed). It runs against the real services and is not part of CI. On the deposited text the grading change lifted green recall from 81.6% to 88.2% and, with the year removed, from 65.8% to 80.9%; the three references it greens that disagree with the deposited DOI are cases where the deposited DOI is the less exact one (a book's DOI for its chapter, a report's DOI for the map actually cited, a journal version of a paper also issued as a book chapter).
- The third tab is now called **References → any style** and its lead says what it does first: paste one reference or a whole list, however messy, and get it back clean in any style or as an EndNote, RIS or BibTeX file. Nothing else about it changed.
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
