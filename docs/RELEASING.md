# Publish Typewell from a GitHub release

Publishing a stable [GitHub release](https://github.com/hariappi/typewell/releases/new) starts automated submissions to **Firefox Add-ons** and the **Chrome Web Store**. Brave uses the Chrome Web Store package. Microsoft Edge Add-ons and Safari publishing are not configured.

Drafts and prereleases do not publish to either store. A normal push or pull request runs checks only. Store review and public availability remain separate for each browser; a successful submission does not guarantee approval or simultaneous availability.

## What the workflow does

1. [`release.yml`](../.github/workflows/release.yml) calls [`checks.yml`](../.github/workflows/checks.yml). It validates the version and release notes, runs unit tests and extension lint, builds both editions and the Mozilla source ZIP, and runs Firefox and Chromium integration tests.
2. The configuration job checks that the release commit belongs to `main` and that both stores' required secrets and variables are present. Missing configuration stops both uploads. This checks presence, not whether the credentials will be accepted.
3. The two store jobs download the tested artifacts and verify their SHA-256 checksums. Firefox uses `web-ext sign --channel listed`, with release notes and reviewer source. Chrome uses a short-lived Google token obtained through GitHub OIDC, then uploads and submits the Chromium ZIP.
4. Each job records its result in the GitHub Actions run summary. Check the store dashboards for review and publication status.

The jobs run independently after validation. One store can accept an update while the other fails. Mozilla's command does not wait for approval, and Chrome's publish request uses the normal review process. [Mozilla submission options](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign) · [Chrome publishing API](https://developer.chrome.com/docs/webstore/using-api#publish_an_item)

## Configure the accounts once

As of October 19, 2026, the Google project, service account, and restricted GitHub identity provider are created. The provider is active, all four Chrome/GCP repository variables are saved and read back, and the publisher has confirmed linking the service account in Chrome's dashboard. Google's billing API confirmed `billingEnabled: false` with no billing account attached. Mozilla's two GitHub secrets still require account setup, so the shared release workflow will stop before either upload until they are added. Live Chrome API authorization remains unverified: the local Google user cannot impersonate the publishing service account, whose federation access is granted to GitHub releases. No store upload has been performed by this workflow.

### Firefox secrets

Sign in to the Mozilla account that owns Typewell and open [AMO API credentials](https://addons.mozilla.org/en-US/developers/addon/api/key/). Create or use its API credentials. Save them under **New repository secret** in [Typewell's Actions secrets](https://github.com/hariappi/typewell/settings/secrets/actions):

| GitHub secret | AMO value |
| --- | --- |
| `AMO_API_KEY` | JWT issuer / API key |
| `AMO_API_SECRET` | JWT secret / API secret |

Enter secrets directly in GitHub. Never paste them into chat, commit them, or place them in a release description. The workflow passes them through the environment variables supported by [`web-ext`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#api-key).

If AMO asks for email confirmation first, search the account's inbox for **Confirmation for developer API keys** from `nobody@mozilla.org`. This goes to the AMO account email, which may differ from the listing's support email. An Apple `privaterelay.appleid.com` address forwards to the inbox configured in Sign in with Apple. On the API-key page, **Haven't received the email yet? → Re-send email confirmation** requests a replacement; use the newest link and avoid repeated requests. If it still does not arrive, use [AMO Contact Support](https://addons.mozilla.org/en-US/developers/support). [Mozilla's confirmation-email implementation](https://github.com/mozilla/addons-server/blob/bce4a39e4009bb99479d9c73f5def0e7bae868a4/src/olympia/api/models.py#L139-L158) · [Apple email forwarding](https://support.apple.com/en-us/105078)

### Chrome identity and variables

The dedicated Google Cloud project is `typewell-publishing-1425913806` (number `645044318350`). It has no linked billing account or compute resources. Its Chrome Web Store, IAM, IAM Credentials, and Security Token Service APIs are enabled. The service account is `typewell-publisher@typewell-publishing-1425913806.iam.gserviceaccount.com`; its provider is `projects/645044318350/locations/global/workloadIdentityPools/github/providers/typewell-release`.

Workload Identity Federation lets the release job exchange its GitHub identity for a short-lived token. No Google service-account JSON key is created or saved in GitHub. Follow Google's [deployment pipeline federation guide](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) when creating or repairing this setup.

Configure the provider with issuer `https://token.actions.githubusercontent.com` and these attribute mappings:

```text
google.subject=assertion.sub
attribute.repository_id=assertion.repository_id
attribute.repository_owner_id=assertion.repository_owner_id
attribute.event_name=assertion.event_name
attribute.ref=assertion.ref
attribute.workflow_ref=assertion.workflow_ref
```

Restrict trust to this repository's release workflow:

```text
assertion.repository_id == '1425913806' &&
assertion.repository_owner_id == '68689504' &&
assertion.event_name == 'release' &&
assertion.ref.startsWith('refs/tags/v') &&
assertion.workflow_ref == 'hariappi/typewell/.github/workflows/release.yml@' + assertion.ref
```

Grant `roles/iam.workloadIdentityUser` on the publishing service account only to the pool's principal set for `attribute.repository_id/1425913806`. The numeric repository and owner IDs prevent another account from gaining access by reusing a repository name. GitHub documents the available [OIDC claims](https://docs.github.com/en/actions/reference/security/oidc).

Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/), select Typewell's publisher, and add the service-account email in **Account**. This grants access to items owned by that publisher. Google currently allows one linked service account per publisher, so inspect an existing entry before replacing it. See [Chrome service-account setup](https://developer.chrome.com/docs/webstore/service-accounts).

Add these **repository variables** in [Typewell's Actions variables](https://github.com/hariappi/typewell/settings/variables/actions):

| Variable | Value to copy |
| --- | --- |
| `CWS_PUBLISHER_ID` | `4f6fc093-c0cf-463d-8bb8-66594ad86ab2` |
| `CWS_EXTENSION_ID` | `fbkhpcclcklddcfoanadpalnfelpngch` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/645044318350/locations/global/workloadIdentityPools/github/providers/typewell-release` |
| `GCP_SERVICE_ACCOUNT` | `typewell-publisher@typewell-publishing-1425913806.iam.gserviceaccount.com` |

Typewell's existing listing is managed in its [Chrome developer dashboard](https://chrome.google.com/webstore/devconsole/4f6fc093-c0cf-463d-8bb8-66594ad86ab2/fbkhpcclcklddcfoanadpalnfelpngch/edit).

These identifiers are configuration, not access tokens. The workflow requests only the `https://www.googleapis.com/auth/chromewebstore` token scope. [Find the Chrome publisher ID](https://developer.chrome.com/docs/webstore/using-api#obtain_your_publisher_id)

Complete the initial store listings, contact verification, screenshots, privacy disclosures, and required account checks in the dashboards. This workflow updates an existing Typewell listing; it does not maintain those fields. Update both listings and privacy disclosures when a future change affects their accuracy. Chrome requires completed **Store listing** and **Privacy** tabs and account two-step verification. [Chrome API prerequisites](https://developer.chrome.com/docs/webstore/using-api#prerequisites)

## Publish the next version

1. Choose a version higher than the versions already submitted to both stores. Update `package.json`, both root version fields in `package-lock.json`, and `extension/manifest.json` to the same `X.Y.Z`. The Chromium manifest is generated from that shared manifest. Keep the Firefox ID `typewell@font-changer.local` unchanged.
2. Add `store/release-notes-X.Y.Z.md` and update `store/reviewer-notes-submission.txt` for that release. Each must contain text. Refresh listing/privacy copy if needed.
3. Run the normal checks and inspect the resulting packages. Use a fresh checkout for release preparation if the working directory contains previously submitted archives: build and packaging commands overwrite matching `dist/` files. Preserve historical submissions separately.
4. Merge the changes into `main`. Create a GitHub release with tag **`vX.Y.Z`** pointing to that commit, leave **Set as a pre-release** unchecked, and click **Publish release**. Merely creating or pushing a tag does not start store publishing.
5. Open [GitHub Actions](https://github.com/hariappi/typewell/actions/workflows/release.yml), review both store jobs, then check [AMO versions](https://addons.mozilla.org/en-US/developers/addon/typewell-font-changer/versions) and the Chrome dashboard.

Typewell uses exactly three version components. Each must be from 0 to 65535, with no leading zeros, and the version cannot be `0.0.0`. The release validator also rejects mismatched lockfiles and tags. [Chrome version rules](https://developer.chrome.com/docs/extensions/reference/manifest/version)

## Recover a failed submission

Read the failing job and check the destination store before retrying. A timeout or failed job can happen after a request reached the store.

- **Configuration failed:** correct the missing GitHub secrets or variables, then rerun the failed jobs.
- **Only one store failed:** rerun that failed store job only. Keep the successful submission in place. Do not rerun all jobs just to retry one store.
- **Firefox failed:** inspect the version in AMO first. `web-ext` creates the version before uploading reviewer source, so a source-upload failure can leave a version already created. Complete that existing version in AMO when appropriate instead of blindly submitting it again. The publishing guard skips a matching enabled listed version only after confirming its reviewer source and a public or unreviewed state; incomplete versions stop with recovery guidance.
- **Chrome failed:** the script checks for an identical version already submitted or published and skips duplicate work. It stops for conflicting pending versions, rejected/cancelled versions, and uncertain responses. Resolve those in the dashboard before retrying; do not cancel an existing review automatically.

Validated packages remain in Actions artifacts for **7 days**; browser test artifacts remain for **3 days**. If artifacts have expired, recover the exact tested packages or prepare a new coordinated release. Do not move a published tag to different code to work around a failed job.

## Expected cost

The expected ongoing automation cost is **$0** for this public repository using standard Ubuntu GitHub-hosted runners and the Google identity services above. GitHub makes standard runner use free for public repositories, and Google IAM is free. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) · [Google IAM pricing](https://cloud.google.com/iam/pricing)

Artifact storage has a separate account allowance shared with GitHub Packages; other repositories can consume it. Short retention reduces usage but does not guarantee the whole account has no charges. No paid runner, paid Google workload, or linked Google billing account is required by this design. Existing store registration fees are separate from workflow execution.
