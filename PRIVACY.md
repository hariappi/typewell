# Typewell privacy

Typewell does not transmit browsing history, page contents, font choices, or other personal data to a server. It has no analytics, advertisements, telemetry, accounts, or remote code.

## Data stored on your device

The extension stores its enabled state, interface theme, default font profile, website hostnames with saved font profiles or exclusions, and favorite font IDs using the browser's `storage.local` extension API. It does not use `storage.sync`. Each browser profile has its own settings; you can transfer them with Export and Import.

Typewell is disabled in private browsing and incognito windows. The manifest prevents access to private tabs and windows, so Typewell cannot save website rules from private browsing sessions.

To apply fonts, the content script examines page elements, computed styles, and whether text contains icon glyphs. It modifies presentation in the browser. Page text is not saved in settings or sent outside the page by Typewell. The background script uses the active tab's URL to associate frames and previews with the correct hostname.

## Fonts

Bundled font binaries are loaded from the installed extension. No Google Fonts, Fontsource, or other CDN requests occur during normal use. System and custom fonts are resolved locally. The developer-only asset download script contacts npm and jsDelivr when explicitly run to fetch font sources and licenses.

## Permissions

- **Access HTTP and HTTPS websites:** remember fonts on future visits, style dynamic content, and handle permitted embedded frames.
- **scripting:** insert and remove user-origin font styles, and initialize the page engine on already-open pages when necessary.
- **activeTab:** interact with the page where you open the popup.
- **storage:** save preferences in this browser profile.

No browsing-history, cookies, password, clipboard, or native-messaging permission is requested. Your browser may phrase website access as the ability to read and change data on websites because the content script inspects and styles page elements.

## Export, import, and removal

Export creates a local JSON file containing your preferences and saved website hostnames. The file is downloaded only when you choose Export. Import reads a local file you select, validates it, and asks you to confirm before replacing settings. No file is uploaded.

Website rules can be removed individually in Preferences. A global pause leaves preferences saved. Your browser manages extension storage when the extension is removed. Any JSON backups you exported remain wherever you saved them.
