# Changelog

All notable changes to this project are documented in this file.

## [1.2.0] - 2026-11-02

### Added

- Open saved links as native browser tab groups.
- Open each saved group as a separate native tab group using its original name.
- Open all non-empty saved groups at once, with each group opening as a separate native tab group.
- Automated tests for opening saved links and handling tab group creation.

### Improved

- Failed URLs no longer prevent the remaining links from opening.
- Opening operations report partial failures.
- Browser API detection prefers the Promise-based `browser.*` API when available and falls back to `chrome.*`.
- Browsers without the required tab grouping APIs fall back to opening ungrouped background tabs.

### Fixed

- Improved error handling when opening tabs or creating native tab groups.

### Compatibility

- Manually tested in Brave desktop.
- Firefox compatibility is based on WebExtensions API feature detection and automated tests; real-browser testing is pending.
- Opera Tab Islands use proprietary colors that are not exposed through the public Tab Groups API. The extension therefore uses the standard API color fallback.

## [1.1.0]

See the [1.1.0 GitHub Release](https://github.com/Cod3Talk3r/tab-group-links/releases/tag/v1.1.0) for previous changes.
