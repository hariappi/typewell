# Typewell privacy page

`dist/index.html` is the complete privacy page. The browser receives plain HTML and CSS, with no JavaScript, dependencies, or external assets.

The page was deployed to a new Cloudflare Pages project on October 19, 2026:

**https://typewell-privacy.pages.dev/**

Cloudflare confirmed the production deployment succeeded. The public URL was verified in Brave without signing in: the complete current policy, Chrome/Brave/Chromium/Firefox scope, and `typewell.support18@proton.me` contact were visible. Use this URL in the Chrome Web Store **Privacy policy** field. Verification details are recorded in `deployment.json`.

The deployment uses a small server-side Pages function that returns the exact contents of `dist/index.html`. It has no bindings, application storage, analytics, or secrets. This deployment method uses the connector's supported multipart deployment API; the separate static-asset upload API needs an upload-token authorization header the connector does not expose.

After changing the policy, regenerate the function with:

```sh
node build-cloudflare.mjs
```

Then deploy `cloudflare/_worker.js` as the `_worker.js` part with an empty `{}` asset manifest to the existing `typewell-privacy` Pages project on its `main` production branch. The generated function is tested locally to return the HTML byte for byte. `deployment.json` records the deployed source hashes and resource IDs.

For a local preview, run this command from this folder:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8080/` in your browser. Press Ctrl+C in the terminal when finished. A local preview URL is not a public privacy-policy URL.

The policy is based on the repository's root `PRIVACY.md`, with a browser scope, updated date, and support contact added. Keep both documents consistent when the extension's behavior changes. The page currently states October 19, 2026.

The page contains no analytics, cookies, forms, browser JavaScript, or external resource requests. Cloudflare may have its own access logs or other hosting data practices.
