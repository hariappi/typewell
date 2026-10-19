# Publish Typewell on Mozilla Add-ons

**Status: version 1.1.0 submitted and approved by Mozilla on September 18, 2026. It is the current public version. AMO validation: 0 errors, 0 warnings.**

The signed-in Mozilla developer account is **hariapp**. The user completed the agreement and upload flow. AMO assigned the slug **typewell-font-changer**. The user created and selected **typewell.support18@proton.me** for public support; that full address was verified in the Proton account UI.

AMO displayed **Version Submitted** after the listing details and source archive were submitted. The [version dashboard](https://addons.mozilla.org/en-US/developers/addon/typewell-font-changer/versions/6482700) identifies version **6482700** and file **5026864**. The [public listing](https://addons.mozilla.org/en-US/firefox/addon/typewell-font-changer/) and approved version are now visible on AMO.

The name, summary, description, Appearance category, MIT license, public support email, privacy policy, reviewer notes, source ZIP, icon, two captioned screenshots and release notes are saved. The portal reports **Changes successfully saved** for the version notes. Use `reviewer-notes-submission.txt` for the 3,000-character reviewer field; the longer notes remain supplementary documentation. The user explicitly confirmed the support address and authorized submission.

`submission.json` records the observed approval state and the exact submitted artifact hashes. The source ZIP is preserved as uploaded; some preparation-status documentation inside predates this submission record. Installation of the signed AMO build has not been separately tested.

## Prepared materials

| Item | File |
| --- | --- |
| Extension upload | `../dist/typewell-1.0.0.xpi` or the equivalent `.zip` |
| Submitted reviewer source archive | `../dist/typewell-1.0.0-source.zip` |
| Store copy, release notes, captions | `listing.md` |
| Reviewer notes for the portal (under 3,000 characters) | `reviewer-notes-submission.txt` |
| Privacy policy | `../PRIVACY.md` |
| Store icon | `icon-64.png` |
| Screenshots | `screenshots/font-picker.png`, `screenshots/preferences.png` |
| Package integrity report | `../dist/amo-release.json` |
| Verification detail | `../TESTING.md` |

For future releases, `npm run package:amo` rebuilds the upload, source archive, checksums, and a convenient `dist/amo/` submission folder. It overwrites those generated files: preserve the submitted 1.0.0 artifacts and increment the manifest version for a new release. This helper needs the `zip` command (included on macOS; commonly available on Linux). It does not log in, upload, or publish anything. Run the tests and validator separately after code changes.

## Portal steps

1. Open [Submit a New Add-on](https://addons.mozilla.org/en-US/developers/addon/submit/distribution) and choose **On this site**.
2. Upload the XPI or ZIP. Select desktop platforms only. Wait for AMO's validation result and resolve any errors.
3. Complete the listing using `listing.md`, the privacy policy, MIT license choice, and the publishing account's public developer details. Add screenshots and the PNG icon.
4. Supply `reviewer-notes-submission.txt` and the matching source archive. Runtime code is unminified and untranspiled, but the font asset script generates CSS declarations and provenance JSON. Include that generator and reproducible build instructions.
5. Submit the version. Record AMO's actual status and public URL. Submission, signing, and store availability are separate states; local validation is not Mozilla approval.

The [official submission guide](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/) is the reference if the portal changes. Do not place account credentials or signing secrets in this project.

## Release checks

- Runtime source is readable and all fonts have recorded licenses and verified hashes.
- The manifest declares no data collection, uses only the required feature permissions, and prevents private-window access.
- Desktop browser tests, model/asset tests, and Mozilla's local validator must pass for the packaged version. See the recorded verification detail.
- The upload contains only the extension; development tools and store assets are outside the XPI.
- Local tests do not constitute a Mozilla code review. AMO server validation passed independently with 0 errors and 0 warnings.
- AMO assigned the listing slug and displayed the publishing account and correct support address in the saved listing.

## After submission

Check the version dashboard and Mozilla's notification for approval/publication. Once the release is public, download the signed artifact separately and verify installation in a disposable Firefox profile. Do not replace the preserved unsigned upload with the signed download.

For a release problem, use AMO's version controls to disable the affected version while preparing a corrected version with a higher manifest version. Users can pause Typewell or restore original fonts from the popup. A signed update keeps the same add-on ID and must preserve existing settings or migrate them deliberately.

The first release excludes private windows to avoid storing private-session site rules, consistent with [Mozilla's private-session data policy](https://extensionworkshop.com/documentation/publish/add-on-policies/#63-additional-privacy-protocols).
