# Security

AutoDOI is a static page. It stores nothing on a server; your inputs go directly from your browser to the public APIs listed in the README, and settings stay in your browser's local storage. The page ships a Content Security Policy, loads its one external script with a Subresource Integrity hash, and never puts pasted text into links or bug reports.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use [GitHub's private vulnerability reporting](https://github.com/toldxls/AutoDOI/security/advisories/new) on this repository. You should hear back within a week. Once a fix is published, the report will be credited in the changelog unless you prefer otherwise.

In scope: anything that would let a third party run code in the page, read another user's data, or make the page send your inputs anywhere other than the services named in the README.

## Supported versions

Only the current version on the `main` branch and the live page at https://toldxls.github.io/AutoDOI/ are supported. Downloaded copies of `index.html` should be refreshed from time to time.
