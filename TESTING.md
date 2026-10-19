# Verification — October 19, 2026

## Release automation

The release workflow was validated locally with **78 unit tests**, including mocked Chrome and Firefox API failure/retry cases and delayed theme-storage reads, and **actionlint** with no findings. Firefox 158.0 passed 35 integration checks; Brave 155.0.8059.85 passed 16 integration checks. Extension lint reported 0 errors, warnings, and notices. Both browser builds and the Mozilla source package were produced in a temporary checkout to preserve historical release archives.

The shared theme script now keeps a newer theme selection when its initial storage read finishes or fails later. Deterministic tests reproduced both stale-read cases before the fix. A hosted Firefox run exposed a theme timeout, but its exact cause was not established; subsequent Firefox checks passed. The hosted Chrome startup logs identified a missing usable sandbox. CI now uses the runner's existing root-owned Chrome sandbox helper, as documented by Chromium, and retains browser/driver logs for failures.

Publishing calls were tested with mocked API responses only. These checks do not confirm store authorization, acceptance, review, or publication. See [the release guide](docs/RELEASING.md) for the required account configuration.

## Chromium port

Typewell 1.2.3 now has Firefox and Chromium builds from the same source. The Chromium package was tested in **Chrome for Testing 155.0.8059.84** and **Brave (Chromium 155.0.8059.85)**. The Firefox regression suite was rerun in **Firefox 158.0**. Every browser used a new disposable profile; the tests did not modify the user's usual profiles.

| Check | Result |
| --- | --- |
| `npm test` | 24 settings, messaging, build, and asset tests passed |
| Chrome for Testing integration suite | 16 checks passed |
| Brave integration suite | 16 checks passed |
| `npm run test:firefox` | 35 checks passed with light system appearance |
| `npm run lint` | 0 errors, 0 warnings, 0 notices |
| `npm run build:all` | Firefox ZIP/XPI and Chromium ZIP/unpacked folder produced |
| Archive verification | Both ZIPs passed integrity checks; every one of their 319 packaged files matched the corresponding extension folder |

Current browser evidence: [Chrome for Testing](docs/chrome-results.json), [Brave](docs/brave-results.json), [Firefox](docs/firefox-results-2026-10-19.json). The reports below from October 17 remain historical evidence for that earlier run.

The Chromium suite exercises all 147 bundled fonts; restrictive font CSP and author `!important`; code, icons, editors and Notion document text; cross-origin frames, open shadow roots and dynamic content; relative sizing; site/global/exclusion precedence; pause/resume; backup validation and confirmed import; and the actual toolbar popup's search, favorites, preview, tuning, Apply, and original-font selection.

It also leaves a real live preview open for **35 seconds**, beyond the normal service-worker idle threshold, before applying and closing the popup. A separate check explicitly stops the worker, verifies that it stops, then reloads the page and changes its profile to confirm storage and CSS updates recover after restart. Callback-only messaging tests cover asynchronous responses and error propagation for Chromium versions without promise-returning listeners.

Run the Chromium suite with `npm run build:chromium`, then `CHROMIUM_BINARY=/path/to/browser CHROMEDRIVER=/path/to/chromedriver npm run test:chromium`. Use Chrome for Testing, Chromium, or Brave for automated extension loading. OpenSSL is required for the local Notion HTTPS fixture. The test trusts only its temporary certificate's public key in the disposable profile; its servers bind to loopback. See [README.md](README.md) for setup and manual installation in standard Chrome.

The declared minimums are Chromium 114 and Firefox 142; the versions above were actually tested. Standard branded Chrome was not installed on this machine, so its automated coverage uses Google's Chrome for Testing distribution. Edge and other Chromium browsers were not individually run. The current Chromium runs used light system appearance and exercised explicit light/dark preferences; the earlier Firefox light/dark system runs are recorded below. Controlled fixtures do not prove compatibility with every live website, closed shadow root, unusual icon implementation, protected page, operating system, or older browser version. The optional live GitHub check was not rerun for this port.

The Chromium ZIP and unpacked folder are **local development artifacts**, not a published Chrome Web Store release. The Firefox XPI remains unsigned. No store submission or user-profile installation was performed.

## Earlier verification — October 17, 2026

Typewell 1.2.3 was loaded into **Firefox 158.0** using a new temporary profile. The test runner exercised the real background script, content engine, fonts, preferences page, and toolbar popup. It did not use the user's normal Firefox profile.

| Check | Result |
| --- | --- |
| `npm test` | 15 tests passed |
| `npm run test:firefox` | 35 integration checks passed in both light and dark system modes |
| Optional live GitHub check | Passed on a public Tinker SDK file in a signed-out Firefox profile |
| `npm run lint` | 0 errors, 0 warnings, 0 notices |
| `npm run build` | ZIP and unsigned XPI produced; approximately 3.06 MB |
| Package verification | Every packaged source file matches the tested extension; ZIP integrity verified |

## Browser coverage

- All 147 bundled font files load in Firefox; 159 total font choices appear in the actual popup.
- The popup and Preferences page can follow Firefox automatically or stay in Light or Dark mode, including native form controls and accessible focus states.
- The popup uses the current website as its live preview and shows more font rows instead of a separate sample box.
- A fresh installation leaves page typography unchanged.
- Firefox reports private browsing access disabled for the release manifest (`incognito: "not_allowed"`).
- The selected bundled font loads with a page CSP of `font-src 'none'` and overrides author `!important` font rules.
- Heading sizes and weights, emphasis, code, ordinary editors, common icon fonts, and icon pseudo-elements retain the expected formatting.
- Google Symbols, Google Material Icons, Google Sans Icons, and Google icon classes retain their original typography while ordinary Google Sans labels receive the selected font.
- Generated icons on text labels and empty descendants retain their fonts, sizes, and spacing. Icons in dynamically opened menus remain protected when readability adjustments are active.
- Notion document editors receive the selected font because Notion uses editable regions for its normal page content.
- Permitted cross-origin frames use the top-level website's preference. Open shadow-root text receives the selected font.
- Dynamically inserted content receives the font; repeated insertion does not compound percentage scaling.
- New text inside an existing protected code block stays protected.
- Modern GitHub code lines, syntax tokens, line numbers, and legacy code tables preserve their original fonts, size, line height, spacing, and syntax colors.
- Dynamically inserted GitHub code lines stay protected. Disabling code preservation restyles visible code text; re-enabling it restores the original formatting.
- A public GitHub file was tested with Lora at 125% size, 1.6 line height and 0.03em letter spacing. Source lines kept their original monospace font, size and spacing while surrounding text changed. See [live results](docs/github-live-results.json) and [screenshot](docs/screenshots/github-code-preserved.png).
- Reading mode excludes navigation outside reading regions, and turning off code preservation permits code styling.
- Global defaults, site overrides, exclusions, and rule removal resolve correctly.
- Closing both a preview connection and the actual toolbar popup restores the saved profile.
- **Use original** is a temporary preview until **Apply to this website** is clicked; applying saves the original-font choice.
- Pause removes presentation markers and restores original computed formatting. Resume and page reload use saved preferences.
- Preferences support removing rules and exporting settings. Invalid imports show a validation error; valid imports require confirmation before replacement.
- The actual toolbar popup supports searching, selecting, favoriting, changing size, applying settings, and previewing on the page.
- The popup stays within its 420 × 600 layout. Protected Firefox pages show a useful message while allowing global preferences.

Browser test names are recorded in [docs/firefox-results.json](docs/firefox-results.json). The screenshots show the real extension in the isolated test profile, with a local test page and example website rules:

Separate results are preserved for [light mode](docs/firefox-results-light.json) and [dark mode](docs/firefox-results-dark.json).

- [Toolbar popup](docs/screenshots/popup.png)
- [Preferences page](docs/screenshots/preferences.png)

## Limits of this verification

The core suite uses controlled local HTML fixtures, including a restrictive CSP and cross-origin iframe. Google regression fixtures reproduce icon-family declarations, icon classes, generated icons and dynamic menus; they do not load Google's actual icon binaries or test a signed-in Google account menu. The additional live GitHub check uses a public file, not the exact file in the user screenshot, and does not cover all diff, editor or enterprise views. These checks do not prove compatibility with every live website, every unusual icon system, closed shadow DOM, browser-protected pages, or Firefox Android. The minimum declared version is Firefox 142; this run used 158.0.

The import tests supply a real browser `File` object to the file input to avoid OS-specific automation permissions around filesystem selection. The browser validates its contents and exercises the actual confirmation dialog and storage updates. Export creates a real local JSON download.

The tested 1.2.3 XPI is an **unsigned local development build** and has not been uploaded to Mozilla. The last locally recorded approved public AMO release is version 1.1.0; that record may be stale if a newer version was submitted manually. Its preserved submission record is unchanged. See `store/submission-1.1.0.json` for the recorded identifiers and artifact hashes.
