# Contributing

Thanks for helping. Bug reports and journal style requests go through the issue templates; the **Report it** links on the page prefill them.

## Set up

Plain JavaScript, no build tooling. Node 18 or newer runs the tests (`.nvmrc` says 24, the current LTS, which CI uses).

```
git clone https://github.com/toldxls/AutoDOI.git
cd AutoDOI
npm test                # unit suites, smoke checks, syntax and version checks (no dependencies)
npm install             # only for the browser tests
npx playwright install chromium
npm run test:browser    # page smoke tests and axe accessibility checks, offline
```

Open `index.html` in a browser to try the page; it works from a `file://` URL for the built-in styles, and from any static server for style search and title conversion.

## Where things live

| Change | Edit | Then |
| --- | --- | --- |
| A citation rule, style or export format | `citations.js` | `./build.sh` |
| Reading RIS / EndNote / BibTeX files | `parsers.js` | `./build.sh` |
| Sentence case / Title Case | `sentencecase.js` | `./build.sh` |
| The page itself (markup, UI logic, network) | `index.html`, outside the inlined blocks | nothing |
| The Google Sheets functions | `apps-script/Code.gs` | nothing (`Citations.gs` is a copy of `citations.js` made by `build.sh`) |

`build.sh` inlines the three libraries into `index.html` and refreshes `apps-script/Citations.gs`. CI rebuilds and fails if the committed copies are stale, so run it before committing.

## Tests

- `tests/*.test.js` are dependency-free suites run by `tests/run.js`; each prints `N passed, M failed`. Add a case next to the ones that look like yours.
- Citation rules need a test with the expected string and, for a journal style, a comment or commit message pointing at the author guidelines you followed.
- `tests/splitter-bench.test.js` holds accuracy thresholds on 85 real reference lists; if you raise accuracy, raise the threshold.
- `tests/golden-styleguides.test.js` and `tests/golden-carnegie.test.js` hold the style authorities' own printed examples; a change to a style must keep them exact. When an example needs a datum no source supplies, add it to the `NOT_APPLICABLE` list with the reason rather than loosening the comparison. `tests/golden-carnegie.test.js` holds the journal's own printed examples; a change to the Carnegie style must keep them byte for byte. `tests/invariants.test.js` and `tests/fuzz.test.js` need no expected strings: add a property there when you find a new class of bad output. `./tools/harvest-corpus.sh` draws a fresh random corpus; commit it with the tests passing.
- `tests/canary.js` and `tests/browser/live.test.js` hit the real services and are run weekly, not on push; `npm run canary` runs both locally.
- `tests/browser/match-bench.js` (`npm run bench:match`) is the yardstick for any change to `matchConfidence` or the page's `resolve()`: green precision must stay at 100% on the deposited variant and recall should not fall. Its `nonlatin` variant (Cyrillic, CJK and Greek references) guards the Unicode handling in `tokens()`. Its `glued` variant is the yardstick for in-line splitting (`gluePoint` in `index.html`), together with the "no single real reference is split" check in `tests/splitter-bench.test.js`. `tests/matching.test.js` pins the cases it has already taught us.
- `tests/browser/ui.test.js` drives the built page in headless Chromium with every external API mocked, in light and dark mode and at phone width. It fetches citeproc, one style and the locale once into `tests/browser/cache/`; after that it is offline. Extend it when you change the page's behaviour.
- `tests/sheets-menu.test.js` and `tests/smoke-sheets.js` run the Sheets script with stubbed Apps Script services; add a case there for changes to `Code.gs`.

## Style

ES5-flavoured JavaScript (`var`, `function`) in the libraries so they run unchanged in Google Apps Script and old browsers; the page code may use `async`/`await`. Two-space indent, single quotes, comments that say why. Keep the page dependency-free at runtime: the only external script is the pinned citeproc build, loaded with an integrity hash.

## Versioning

`APP_VERSION` in `index.html`, `version` in `package.json` and the top entry of `CHANGELOG.md` must agree (a test checks). Bump the minor version for user-visible changes, the patch version for fixes, and add a line to the changelog under *Unreleased* as you go.
