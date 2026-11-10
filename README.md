# ECE 466 · Homework 6

Aaraiz's experiment notebook for sentiment analysis and image captioning.

Live dashboard: https://aaraiz-assignment-work-ece-466.pages.dev

## What the page shows

- The assignment requirements, exact model and dataset settings, and verified test evidence.
- Five sentiment experiments with actual held-out results and recorded training histories.
- Three image-captioning experiments with real batch counters and interim token-weighted loss/perplexity; final metrics are shown only after a complete epoch.
- Sanitized scheduler state, numerical batch events, and explicit pending/failure/stale states.

The seven sections are Overview, Requirements, Models, Results, Validation, Activity, and Files. Results keeps measured outcomes separate from model settings, including the five sentiment runs, their twenty-epoch histories, and matched comparisons. Caption metrics become final only when the saved full-epoch record passes validation. The four-image comparison appears only when all twelve actual outputs and the image-specific review are bound to the published evidence hashes.

The 5,000-review sentiment test set is the course's stratified split from the pooled 50,000 labelled IMDB reviews. It is not the official IMDB benchmark test split. Interim losses are not final checkpoint evaluation metrics. Software tests do not establish model accuracy or guarantee that an assignment has no errors.

## Live data

The authorized local monitor reads the training server. `tools/public_snapshot.py` constructs an allowlisted public snapshot. `tools/publish_snapshot.py` sends it to the authenticated Pages endpoint. A SQLite-backed Durable Object stores the latest snapshot; the browser reads `/api/status` every 15 seconds. Data age and connection failures remain visible. The last snapshot persists when the publisher stops; the page must not represent an old snapshot as a live connection.

The public repository contains no university password, SSH key, VPN configuration, raw server log, private server path, or course-server notebook. The publisher token is supplied at runtime and must never be put in a frontend environment variable or committed file.

## Development

Use Node 22.12+ and Python 3.10+.

```sh
npm ci
npm run build
npm test
python -m unittest discover -s tests -p 'test_*.py'
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8765` by default. Set `DASHBOARD_API_ORIGIN` to another local API when needed. Refer to the command help for the snapshot and publisher tools. Actual source data is required; synthetic model results are not supplied as a fallback.

## Cloudflare deployment

```sh
npx wrangler whoami
npx wrangler deploy --config cloudflare/wrangler.jsonc
npx wrangler pages project create aaraiz-assignment-work-ece-466 --production-branch main
npx wrangler pages secret put PUBLISH_TOKEN --project-name aaraiz-assignment-work-ece-466
npm run build
npx wrangler pages deploy dist --project-name aaraiz-assignment-work-ece-466 --branch main
```

The store Worker has no public route. Only the Pages binding reaches it. Publication requires a long bearer token, bounded JSON and a strict schema. Older snapshots cannot overwrite newer data. No paid plan upgrade is required by this implementation.

The public feed is updated by a running authorized publisher; deploying the frontend alone does not connect to the university server. When that publisher or its monitor stops, the page retains the last snapshot and labels it stale. Source age is carried forward using server receipt time and monotonic browser elapsed time so workstation clock differences cannot keep old data appearing live.

Provider references: [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/), [SQLite-backed Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/), and [Durable Objects free-plan limits](https://developers.cloudflare.com/durable-objects/platform/pricing/).
