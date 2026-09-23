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
- `tests/browser/ui.test.js` drives the built page in headless Chromium with every external API mocked. Extend it when you change the page's behaviour.

## Style

ES5-flavoured JavaScript (`var`, `function`) in the libraries so they run unchanged in Google Apps Script and old browsers; the page code may use `async`/`await`. Two-space indent, single quotes, comments that say why. Keep the page dependency-free at runtime: the only external script is the pinned citeproc build, loaded with an integrity hash.

## Versioning

`APP_VERSION` in `index.html`, `version` in `package.json` and the top entry of `CHANGELOG.md` must agree (a test checks). Bump the minor version for user-visible changes, the patch version for fixes, and add a line to the changelog under *Unreleased* as you go.
