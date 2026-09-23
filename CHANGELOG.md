# Changelog

Versions follow [semver](https://semver.org/). The version shown in the page footer and in bug reports is `APP_VERSION` in `index.html`; `package.json` and this file carry the same number, and the tests fail if they drift.

## Unreleased

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
