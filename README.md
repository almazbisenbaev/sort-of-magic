# Sort of Magic

A browser-based cleanup app for CSV files and Excel worksheets, built with Next.js, React, TypeScript, AG Grid Community, Papa Parse, and SheetJS. The app supports editable data, undo history, local cleanup, and Meta-assisted category normalization. A four-step wizard guides users through Upload → Clean up → AI labels → Download. The spreadsheet and advanced tools open only when needed.

Public app: **https://sortofmagic.vercel.app**. Hosting is configured on Vercel; demo recording and hackathon submission materials remain in Phase 5 of the workspace's `PROJECT_BRIEF.md`.

## Run

Requires Node.js 22.12+ within the Node 22 release line and npm. `.nvmrc` and `package.json` select Node 22 for local use and hosting. An older system Node can run the app but fail the test toolchain; check `node --version` before running commands.

```sh
cd sort-of-magic
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Local cleanup requires no credentials. AI suggestions require the configuration below; no database is needed. The server binds to loopback for local use.

## Try it

1. In **Upload**, choose **Try a sample CSV**, check the column names, and click **Continue to cleanup**.
2. In **Clean up**, review **Trim extra spaces**, then apply the six changes. Review and remove the two exact duplicate rows; five rows remain.
3. Click **Continue to AI labels**. Select `country`, optionally add “prefer full country names,” and click **Analyze with Meta**.
4. Select suggestions, preview the exact changes, then apply them. **Undo last change** restores the prior data without leaving the step.
5. Click **Continue to download**. Review the net change counts and click **Download CSV**.

AI and individual fixes are optional. You can go back to visited steps without losing applied changes. The wizard blocks navigation during an unapplied preview or an active AI request; apply/cancel the preview or cancel analysis to continue. Selected AI suggestions are preserved when moving between cleanup, AI, and download. Continuing without applying them leaves the CSV unchanged and shows a reminder on the download step.

The demo contains synthetic data, including leading-zero IDs, Unicode, embedded newlines, commas, and quoted text.

## Limits and behavior

- Maximum 5,000 data rows, 50 columns, 5 MB. Confirm and edit column names during upload; names must be nonempty and unique.
- Choose whether the first record contains headers. Uncheck the option for headerless files to preserve the first data row. You can rename headers later with preview and undo.
- Import a comma-separated UTF-8 CSV or a standard, unencrypted Excel (.xlsx) workbook. Choose one visible tab if the workbook has several. Import uses the occupied table range and the displayed values as text, including values in hidden rows and columns. Formulas, Excel errors, and merged cells must be resolved on a copy of the selected tab first. Hidden worksheets cannot be chosen.
- Double-click cells to edit, Enter to commit, Escape to cancel. Sort with headers and filter with column inputs or global search. Stable internal IDs keep edits on the correct rows. Global search includes source record numbers.
- Local checks detect surrounding whitespace and exact duplicate rows. Meta analysis can propose equivalent category labels in one selected column.
- Exact duplicate removal keeps the first occurrence. Key-based deduplication lets you select key columns and choose the retained record for each group; blank keys are excluded. Non-key differences are shown before removal.
- Undo history retains the latest 100 changes, including manual edits, header edits, and all repairs. Undo restores exact values and removed rows in position. No redo in this phase.
- Values stay strings. CSV export quotes all fields to preserve empty records and special characters. It does not preserve original byte formatting or line endings.
- Excel export creates a new, single-sheet workbook. All cells are literal text. Other sheets, formatting, charts, and formulas are not carried over. The export format defaults to the input format; either CSV or XLSX is available. Workbook parsing and writing run in a local Web Worker.
- CSV export defaults to prefixing formula-like headers/cells with an apostrophe. This changes downloaded text only and includes negative numbers. The UI shows the count and lets you opt out to preserve exact values.
- The working file stays in browser memory. Clicking Analyze sends only the selected column name, distinct nonempty values, counts, and optional cleanup guidance through the server to the configured provider. Refreshing loses the session.
- Repairs and export include the entire imported table, even when filters hide rows. Export preserves source order. An unapplied preview blocks step navigation and download until it is applied or cancelled. Downloads use `-export` or `-repaired` with the chosen extension and, for workbook inputs, the sheet name.
- No formula evaluation, currency conversion, accounts, or persistent file storage.

## Phase 3 tools

In **Clean up**, expand **Need to clean up something else?**:

- **Empty rows:** preview and remove rows where every cell is blank or whitespace.
- **Required fields:** select the columns that must have values. Missing cells are listed by source record and column; correct them manually. Optional blanks are allowed.
- **Dates:** normalize numeric dates with four-digit years to `YYYY-MM-DD`. Valid unambiguous dates can be processed in mixed formats. `03/04/2026` remains unresolved until you choose day-first or month-first. Impossible dates and unsupported formats remain unchanged.
- **Numbers:** normalize decimal and grouping separators without floating-point rounding. Automatic mode leaves a single separator followed by three digits unresolved (`1,234`). Choose dot/comma decimal to disambiguate. Currency symbols/codes remain attached, with no currency conversion. Do not use on identifiers; numeric cleanup may remove leading zeros.
- **Key duplicates:** select columns, inspect records, and choose which one to retain. Unselected groups are skipped. Large group lists, record tables, and repair previews are paginated.
- **Headers:** edit names, preview, apply, and undo.

AI analysis accepts optional cleanup guidance (maximum 1,000 characters), such as “prefer full country names.” It is still constrained to category mappings among existing values. Edits, repairs, and undo clear prior AI proposals and abort active analysis.

### Test files

- [Excel workbook](public/demo/messy-workbook.xlsx): two usable sheets and a formula sheet; Orders starts at B3 and includes formatted IDs, dates, whitespace, and a duplicate.
- [Phase 3 messy data](../test-data/phase-3-messy.csv): ambiguous/invalid dates, mixed number formats, currencies, conflicting duplicate keys, an empty row, and a missing customer.
- [Headers to fix](../test-data/headers-to-fix.csv): one blank and one duplicate header.
- [5,000-row sample](../test-data/5000-orders.csv): scale and filtering checks.
- [Original messy orders](../test-data/messy-orders.csv): whitespace, duplicates, and semantic aliases.

## Verify

```sh
npm test
npm run typecheck
npm run build
```

Tests cover Excel worksheet selection, formatted text and safe exports, file limits, CSV parsing, import/header handling, date and numeric conventions, key duplicates, missing/empty values, mixed-operation undo, stale previews, AI validation, hosting rate-limit errors, wizard navigation, skipping optional work, preserving AI selections, final export, and component behavior. Type checking and the production build pass. Browser checks verified sorted/filtered cell editing, undoing manual and batch edits, explicit date resolution, currency-preserving number previews, choosing a retained key duplicate, corrected-header import, and a real Meta guidance → preview → apply → undo flow. A 5,000-row file was loaded, filtered, edited, and exported; the downloaded file retained every row in source order and only the intended edit.

## Code map

- `components/repair-workspace.tsx`: interface and state transitions.
- `lib/csv.ts`: parsing, shared table import, limits, and CSV export.
- `lib/excel.ts`, `lib/excel-client.ts`, `lib/excel-worker.ts`: workbook validation, worksheet selection, and Excel export. The parser is loaded on demand from the app’s own assets.
- `lib/detectors.ts`: whitespace and exact duplicate detection.
- `lib/patches.ts`: atomic patch validation/application and undo.
- `lib/dataset.ts`: shared data types.
- `tests/repair.test.ts`: correctness tests.
- `public/demo/messy-orders.csv`: synthetic example.

## Connect Meta AI

The existing `.env.local` is configured locally and ignored by Git. For a fresh checkout, copy `.env.example` to `.env.local`. Do not overwrite an existing configured file.

For direct Meta Model API access, use:

```dotenv
META_API_KEY=your_key_goes_here
META_MODEL=muse-spark-1.3
META_API_BASE_URL=https://api.meta.ai/v1
```

Replace the example model ID if your dashboard grants a different model. Keep the key in `.env.local`, never in chat, source code, or a `NEXT_PUBLIC_` variable. Restart `npm run dev` after editing configuration. The key is read only by the server; the status endpoint exposes only a configured flag and model ID, not the key.

The adapter uses HTTPS `POST /chat/completions` relative to the base URL and Bearer authentication, matching the [Meta Chat Completions documentation](https://dev.meta.ai/docs/protocols/chat-completions). If your access is through Fireworks, Baseten, or Modal, supply the provider documentation and model ID before assuming the same request parameters work. Partner compatibility has not been verified.

### Try AI category repair

1. Open the demo CSV, confirm the columns, and optionally apply whitespace cleanup.
2. Continue to **AI labels** and select `country`.
3. Expand **Review data to send** to see the values and counts.
4. Click **Analyze with Meta**. This makes a real provider call and may use credits.
5. Select the mappings you agree with. Nothing is selected or applied automatically.
6. Click **Preview selected AI repairs**, inspect exact cells, then **Apply repair**.
7. Use **Undo last change** to restore the previous dataset, or continue to **Download** to export the result.

Canonical labels must already exist in the column. Blank values are never filled; ambiguous values remain unchanged. Requests are limited to 2–100 distinct nonempty values, each at most 200 characters, and a 32 KB request body. Responses are capped at 128 KB and generation at 4,096 completion tokens. Provider calls time out after 45 seconds with no automatic retries. Retry explicitly after checking the error.

Dataset changes clear pending suggestions and abort active analysis. Selecting different mappings clears any old patch preview. Stale dataset versions cannot be applied. Formula-like text stays inert in the UI and follows the existing export protection setting.

### Verification status

- Core, server-route, provider-adapter, and component tests use explicit test-only provider mocks. There is no fake-AI mode in the application.
- Verified browser behavior: configuration-needed message, analysis error/retry, unchanged dataset on failure, and continued access to local repair previews.
- Successful live inference was verified on November 2, 2026: Muse Spark 1.3 returned validated mappings from `U.S.` and `United States` to `USA`. Phase 3 also verified a live guided repair through the browser: USA/U.S. → United States and UK → United Kingdom, followed by apply and undo.
- The local development server binds to loopback. The public deployment uses Vercel's firewall rate limit described below.

Additional code: `components/ai-repairs-panel.tsx`, `lib/ai-repairs.ts`, `lib/schemas.ts`, `lib/ai/meta.ts`, and `app/api/repairs/route.ts`.

## Deployment

The Vercel project is `sortofmagic` in `almazbisenbaevs-projects`, connected to the `main` branch of `almazbisenbaev/sort-of-magic`. The repository root is the application directory. Pushes to `main` deploy automatically.

Production environment variables are `META_API_KEY` (Sensitive), `META_MODEL`, and `META_API_BASE_URL`. They are server-only; the local `.env.local` is excluded from Git and CLI uploads. Preview deployments intentionally have no Meta credentials. After changing production variables, redeploy for them to take effect.

The AI route has a 60-second hosting limit, allowing its 45-second provider timeout to return a readable error. Requests remain capped at 32 KB, responses at 128 KB, and generation at 4,096 completion tokens.

Vercel Firewall limits `POST /api/repairs*` to **5 requests per 60-second fixed window per IP**, returning HTTP 429. The deployed rule is recorded in [deployment/firewall.json](deployment/firewall.json). This JSON is a reference for the Vercel Firewall API, not an automatically applied `vercel.json` setting. Preserve other existing firewall rules when making future edits. The rule uses the Hobby plan's included rate-limit rule, without another service or database.

The limit applies at Vercel's edge and counts separately by region. It reduces bursts; it is **not a global daily quota or a hard spending cap**. People sharing an IP share its allowance. Manage limits in the [project firewall](https://vercel.com/almazbisenbaevs-projects/sortofmagic/firewall). To stop AI spending immediately, change this rule's action to Deny; the browser's local cleanup and CSV export remain available.

Manual deployment, if needed:

```sh
vercel link --project sortofmagic --scope almazbisenbaevs-projects
npm test
npm run typecheck
npm run build
vercel --prod
```

Before sharing a fresh deployment, verify the sample CSV, a real AI suggestion, preview/apply/undo, and CSV download. Test the firewall with invalid `{}` JSON requests so the check does not consume Meta credits. See [Vercel's rate-limit documentation](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) for scope and current plan limits.

## Guided workflow

**Upload → Clean up → AI labels → Download** is the main path. Each screen has Back and Continue controls and a numbered progress indicator. Unvisited steps stay unavailable until the preceding screen is reached. Returning to Upload preserves the current dataset; choosing a replacement asks for confirmation, and cancelling its column preview preserves the old data.

The spreadsheet is collapsed by default. Expand **View or edit your spreadsheet** to edit, sort, and filter. The Show button in a repair preview reveals and focuses the affected cell. Editing is disabled while a preview or AI request is active; the final spreadsheet is read-only. The advanced cleanup tools remain available in step 2.

Download reports net cell changes on retained rows and the number of removed rows compared with the confirmed import. Undo updates these counts. Remaining quick-check findings and selected, unapplied AI suggestions are disclosed before export; the wizard does not claim every possible issue has been resolved.

Browser verification covers desktop and a 390-pixel phone layout, a real Meta request with guidance, preview/apply, returning to previous steps, revealing a cell in the spreadsheet, and downloading the exact expected five-row CSV. The initial file retains leading-zero IDs, Unicode, quotes, and embedded newlines through the full flow.

## License

The original Sort of Magic code is available under the [MIT License](LICENSE). Third-party dependencies retain their own licenses. The jumping cat GIF is excluded from this license.
