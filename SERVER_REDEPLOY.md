# Manual Apps Script redeploy (proposed server improvements)

The browser sign-in client in `mrj-auth.js` works without these server changes. Deploy them when classroom load allows a short maintenance window.

## What changes (see `proposed/Code.gs`)

- **APP_VERSION** `1.2.0` → `1.3.0`
- **`progress_`**: token check and score index read run **without** `LockService` (read-only path).
- **`findAccount_`**: short **CacheService** TTL (45s) for account rows; cache busted on login/register writes.
- **`loadProgress_`**: returns **StudentScoreIndex only** — no `readMetricsTail_` scan of ClassroomMetrics during sign-in/resume.
- **Multiple device tokens**: up to 5 active tokens per student (`token` column stores `tok1|tok2|…`); legacy single-token rows still work.

## Redeploy steps (Jay)

1. Open the [MRJ sign-in Apps Script project](https://script.google.com) tied to the existing web app URL (`…/AKfycbwtJTUO3gbcMrlAwsn1feWxyp7Rw2cxpfe1bOT9v2rxmQHa2Tlc6pFNWAjU6ZAdlD6kFQ/exec`).
2. Replace the editor contents of `Code.gs` with `proposed/Code.gs` from this repo (or merge the diff carefully if you have local edits).
3. **Deploy → Manage deployments**.
4. Click the **pencil (Edit)** on the **existing** Web app deployment (do not create a new deployment URL).
5. Set **Version** to **New version**, add a description such as `1.3.0 resilient reads`, click **Deploy**.
6. Confirm the `/exec` URL is unchanged.
7. Smoke test: `GET` the `/exec` URL should return JSON with `"version":"1.3.0"`.
8. Optional live test with test account id `zz_test_mrjmetrics` only (no other production writes).

## Rollback

Redeploy the previous saved Apps Script version from **Manage deployments → Version history**, or restore `Code.gs` from git tag/commit before 1.3.0 and deploy a new version on the same deployment.
