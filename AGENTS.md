# Project instructions

## Keep both browser editions in sync

Typewell is maintained for Firefox and Chromium browsers, including Chrome and Brave. The user requires future changes to update both editions.

- Apply features, bug fixes, UI changes, font assets, settings, and permission changes to both browser editions. Prefer shared source code so behavior stays consistent.
- Use browser-specific implementations where platform APIs differ. Preserve equivalent behavior and document any unavoidable difference.
- Keep release versions coordinated across the Firefox and Chromium packages. Update both store descriptions and privacy disclosures when a change affects their accuracy.
- For code changes, run `npm test` and the relevant browser checks (`npm run test:firefox` and `npm run test:chromium`). Report any browser that could not be tested.
- Prepare releases for both targets with `npm run build:all`; use `npm run package:amo` when preparing the Mozilla submission artifacts. Preserve previously submitted artifacts as required by the release documentation.
- A change is not complete when only one browser edition has been updated. Report the status of both editions. Building packages does not mean they have been submitted to or approved by either store.
