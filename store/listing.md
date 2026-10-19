# Typewell — Font Changer

Listing text submitted to Mozilla Add-ons on September 13, 2026. See `submission.json` for the verified status; submission does not mean approval or public availability.

## Basic information

- **Name:** Typewell — Font Changer
- **Slug:** typewell-font-changer (assigned by AMO in the submission flow)
- **Default locale:** English (United States)
- **Distribution:** Public listing, “On this site”
- **Target:** Firefox Desktop 142+; do not select Firefox for Android
- **Suggested category:** Appearance
- **Suggested tags:** fonts, font changer, readability, typography
- **License:** MIT for original extension code; bundled fonts retain the licenses included with each font
- **Developer display name:** hariapp
- **Support email:** typewell.support18@proton.me
- **Homepage:** Leave empty until a real public project page exists

## Summary

Choose from 159 font options, preview them live, and save a different look for each website. Offline fonts, spacing controls, and easy restore.

## Description

Make websites easier to read and more comfortable to look at. Typewell lets you try fonts directly on a page, fine-tune the spacing, and remember your choices for the next visit.

**Find your type**

- Explore 147 bundled fonts and 12 system-font choices, or enter the family name of a font installed on your computer.
- Search, filter by category, and keep your favorites close by.
- Try Inter, Geist, Poppins, Lora, Literata, JetBrains Mono, Lexend, Atkinson Hyperlegible, and more.
- Preview a font on the current page before saving. Closing the popup restores your saved choice.

**Make each website comfortable**

- Save a different font and spacing profile for each website, or choose a default for all websites.
- Adjust text size from 75% to 175%, line height, letter spacing, and word spacing.
- Focus changes on reading content and preserve code fonts when you want to.
- Restore a website's original fonts, exclude it from your default, or pause Typewell everywhere.
- Manage website rules and export or import your preferences as a local JSON file.

**Built to work locally**

Bundled fonts are included in the extension. There are no font CDN requests, analytics, ads, accounts, or remote scripts. Preferences stay in your Firefox profile. Website access lets Typewell apply your saved choices and style newly loaded text.

**Before you install**

This release supports Firefox Desktop 142 and newer in regular windows. Private windows are not supported. Firefox protects some pages from extensions, including internal pages and its built-in PDF viewer.

Bundled fonts cover Latin text in regular weight; Firefox can synthesize bold and italic. Other scripts and missing characters use fallback fonts. System and custom fonts must be available to Firefox. Common icon fonts and editors are preserved; Notion document text is styled because Notion uses editable regions for normal page content. Some site layouts or unusual icons may need you to restore the original font. Canvas text and closed shadow roots cannot be changed.

## Screenshots and captions

1. `screenshots/font-picker.png` — “Search 159 font choices, preview them on the page, and save a style for each website.”
2. `screenshots/preferences.png` — “Manage your default style, website rules, favorites, and local settings backups.”

These are actual extension screenshots from a disposable Firefox profile. The displayed hosts are local or example sites.

## Icon

Upload `icon-64.png`. A 32-pixel copy and the original SVG are also included.

## Privacy policy

Paste the contents of the project's `PRIVACY.md` into AMO's privacy policy field. The manifest declares no data collection or transmission. Local website preferences and JSON backups are explained in that policy.

## Version 1.0.0 release notes

First public release of Typewell:

- 131 font choices, live previews, search, categories, and favorites.
- Website profiles, a global default, size and spacing controls, and reading mode.
- Common icon and code-font preservation, original-font restore, and global pause.
- Local preferences with JSON backup and import.
- Bundled offline fonts and no analytics or remote font requests.
- Regular Firefox Desktop windows only.

## Version 1.2.0 release notes

- System, Light, and Dark themes for the popup and Preferences page. System mode follows Firefox automatically.
- More fonts visible in the popup after removing the separate sample box; the open website remains the live preview.
- Improved dark-theme contrast for controls, messages, dialogs, selected fonts, and keyboard focus.
- All fonts and settings remain local, with no analytics or font-service requests while browsing.

## Version 1.2.1 release notes

- Fixed font changes on Notion pages, whose normal document text is built from editable regions.
- Continued to preserve email composers, forms, and rich-text editors on other websites.
- No privacy changes: fonts and settings remain local, with no analytics or font-service requests while browsing.

## Version 1.2.2 release notes

- Fixed Google icon fonts being replaced with text fonts, which could show icon names and overlap nearby labels.
- Improved protection for generated icons and icons inside dynamically opened menus.
- Preserved icon sizes and spacing during readability adjustments.
- No new permissions or privacy changes.

## Version 1.2.3 release notes

- Fixed code-font preservation on GitHub file views, including modern code lines and legacy code tables.
- Kept code alignment, syntax colors, line numbers and original spacing while surrounding text uses your chosen font.
- Protected dynamically inserted code lines. No new permissions or privacy changes.

## Submission reference

Mozilla's [submission guide](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/) describes the public-listing flow. Its [listing guidance](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/) covers descriptions, icons, and screenshots. The name, slug, support address, icon and screenshots were verified in the saved listing preview. Tags above remain suggestions and were not added to the portal.
