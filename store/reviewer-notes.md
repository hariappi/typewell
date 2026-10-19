# Notes for Mozilla reviewers

Typewell is an independent Firefox font changer. No login, paid service, API key, or external application is required to exercise any feature.

## Source and build

All runtime JavaScript, HTML, and CSS is readable source in `extension/`. There is no bundler, transpiler, minification, obfuscation, eval, or remotely executed code. The submitted XPI contains the complete runtime source.

The accompanying `typewell-1.2.3-source.zip` includes the extension, original font-asset generator, development scripts, tests, lockfile, and documentation. The release used macOS 27.2 and Node.js 22.22.3; the packaging script is portable. From the extracted source:

```sh
npm ci --ignore-scripts
npm test
NO_UPDATE_NOTIFIER=1 npm run lint
npm run build
```

The build checks font hashes and licenses, copies the root license and privacy text into `extension/`, and packages that directory with Mozilla's `web-ext`. It does not transform application code. ZIP metadata may differ between builds; compare extracted file contents. Fonts are already included. **Do not run `npm run fonts` to reproduce this release**; it is a separate developer maintenance operation. That original asset script generates readable font CSS and provenance JSON while fetching pinned, unmodified font binaries and licenses. The source archive includes it. To regenerate only the CSS offline, run `node scripts/generate-font-css.mjs` before building.

The extension has no runtime npm dependencies. `web-ext` and `selenium-webdriver` are development tools. Font package versions, source URLs, and SHA-256 values are recorded in `extension/fonts/sources.json`; each bundled font has its own adjacent license file.

## Permissions and privacy

- HTTP/HTTPS host access applies saved font preferences automatically and handles dynamic content and permitted embedded frames.
- `scripting` inserts and removes user-origin font CSS and initializes existing tabs when needed.
- `activeTab` supports the toolbar popup's interaction with the current website.
- `storage` persists global settings, explicit hostname rules/exclusions, favorites, and the interface theme in `storage.local`.

The content engine examines text elements and computed styles to preserve existing sizes, code, ordinary editors, and common icons. Notion document editors are intentionally styled because Notion represents normal page content as editable regions. Page text is not persisted or transmitted. No history, cookies, passwords, clipboard, native messaging, telemetry, advertising, or analytics APIs are used.

Version 1.2.2 adds recognition of Google icon font names and classes, and protects generated icons even when their originating element has no text. Ordinary Google Sans text remains eligible for styling. The regression tests use representative local declarations rather than Google's icon binaries or a signed-in Google account. No permissions, collection behavior, or bundled font assets changed.

The extension loads font bytes only from its own installed package and creates binary `FontFace` instances. It does not modify a page's CSP or security headers. Extension pages use a self-only script policy. Open shadow roots use an author stylesheet fallback; normal documents use user-origin styles.

`data_collection_permissions.required` is `["none"]`. Private browsing is explicitly unavailable through `incognito: "not_allowed"`, so private-session hostnames cannot enter saved rules. Settings exports contain saved hostnames and are created only on an explicit Export action. Imports are local, validated, and require confirmation before replacing preferences.

## Manual verification

1. Install on Firefox Desktop 142+ and open an ordinary HTTP/HTTPS article. Fresh installations leave its typography unchanged.
2. Open Typewell from the extensions menu, choose Lora, and observe the temporary preview directly on the website. Close the popup without applying; the original or previously saved font returns.
3. Reopen, choose a font, click **Apply to this website**, and reload. The saved choice returns. This applies to the exact hostname; `example.com` and `www.example.com` are separate.
4. In the readability controls, change size and spacing, then apply. Headings retain their relative hierarchy; the default preserves code fonts and common icon glyphs.
5. Choose **All websites** and set a default. Website overrides still win. **Use original** temporarily previews the site's fonts; click **Apply to this website** to save an exclusion.
6. Open Preferences. Remove a site rule, pause/resume Typewell, and export settings. Importing a valid backup shows a replacement confirmation; malformed JSON/settings are rejected.
7. In Preferences, choose System, Light, or Dark under Typewell appearance. System follows Firefox and the operating system; Light and Dark remain fixed.
8. Try opening the popup on a protected Firefox page. It explains the restriction and still permits choosing a global default.

No special test account or live website is required. `tests/fixtures/article.html` and `frame.html` exercise code, icons, a cross-origin iframe, dynamic content, and restrictive page CSP through `npm run test:firefox`. This runner launches its own disposable profile and requires an official Mozilla geckodriver binary. See `TESTING.md` for measured results and coverage limits.

## Known limits

Desktop only; Android is not submitted for this version. Private windows, browser-protected pages, canvas text, and closed shadow roots are unsupported. Bundled fonts are Latin/regular/upright; Firefox synthesizes other weights/styles and falls back for missing scripts. Unusual icon implementations and tightly constrained layouts may require a site exclusion. Firefox's local-font visibility rules apply to system and custom fonts.

## Version 1.2.3 compatibility fix

The code-preservation option now recognizes GitHub modern file lines and line-number divs plus legacy blob code/number table cells. They keep their original computed typography when preserveCode is enabled; nearby passages still receive the selected font. No profile schema, permissions, font assets, or privacy behavior changed. The suite exercises code preservation under scaling/spacing, dynamic line insertion, syntax colors, and the explicit off/on toggle. An optional live check (TYPEWELL_TEST_LIVE_GITHUB=1 npm run test:firefox) also verified a public GitHub file in a disposable signed-out Firefox profile. See TESTING.md for evidence and scope.
