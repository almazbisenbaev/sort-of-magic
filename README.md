# Sort of Magic — Phase 4

A CSV cleanup app built with Next.js, React, TypeScript, AG Grid Community, and Papa Parse. Phases 1–4 are implemented. The app supports editable data, undo history, local cleanup, and Meta-assisted category normalization. The workspace puts suggested fixes first, with optional tools below and the spreadsheet alongside. Hosting and demo preparation remain Phase 5 in [PROJECT_BRIEF.md](../PROJECT_BRIEF.md).

## Run

Requires Node.js 22.12+ and npm. `.nvmrc` selects Node 22 if you use nvm (`nvm use`). An older system Node can run the app but fail the test toolchain; check `node --version` before running commands.

```sh
cd sort-of-magic
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Local cleanup requires no credentials. AI suggestions require the configuration below; no database is needed. The server binds to loopback for local use.

## Try it

1. Click **Try a sample CSV**, or upload a UTF-8, comma-separated `.csv`.
2. Select **Review** beside **Trim extra spaces** and inspect the exact before/after values.
3. Click **Apply 6 changes**. The demo goes from 8 issue instances to 2.
4. Select **Review** beside **Remove exact duplicates**: source records 4 and 8 will be removed; 3 and 7 retained.
5. Apply the repair: 5 rows remain, with no Phase 1 issues.
6. Click **Undo last change** to restore both removed rows in place.
7. Click **Download CSV**.

The demo contains synthetic data, including leading-zero IDs, Unicode, embedded newlines, commas, and quoted text.

## Limits and behavior

- Maximum 5,000 data rows, 50 columns, 5 MB. Confirm and edit column names during upload; names must be nonempty and unique.
- Choose whether the first record contains headers. Uncheck the option for headerless files to preserve the first data row. You can rename headers later with preview and undo.
- Comma-separated UTF-8 CSV only; save other encodings/delimiters in this format first.
- Double-click cells to edit, Enter to commit, Escape to cancel. Sort with headers and filter with column inputs or global search. Stable internal IDs keep edits on the correct rows. Global search includes source record numbers.
- Local checks detect surrounding whitespace and exact duplicate rows. Meta analysis can propose equivalent category labels in one selected column.
- Exact duplicate removal keeps the first occurrence. Key-based deduplication lets you select key columns and choose the retained record for each group; blank keys are excluded. Non-key differences are shown before removal.
- Undo history retains the latest 100 changes, including manual edits, header edits, and all repairs. Undo restores exact values and removed rows in position. No redo in this phase.
- Values stay strings. CSV export quotes all fields to preserve empty records and special characters. It does not preserve original byte formatting or line endings.
- Export defaults to prefixing formula-like headers/cells with an apostrophe. This changes downloaded text only and includes negative numbers. The UI shows the count and lets you opt out to preserve exact values.
- The working file stays in browser memory. Clicking Analyze sends only the selected column name, distinct nonempty values, counts, and optional cleanup guidance through the server to the configured provider. Refreshing loses the session.
- Repairs and export include the entire file, even when filters hide rows. Export preserves source order. A pending preview triggers a confirmation before exporting without it. An unchanged session uses an `-export.csv` suffix; a session with applied changes uses `-repaired.csv`.
- No deployment, XLSX/formulas, currency conversion, persistent storage, or custom visual redesign in this phase.

## Phase 3 tools

Under **Additional cleanup**:

- **Empty rows:** preview and remove rows where every cell is blank or whitespace.
- **Required fields:** select the columns that must have values. Missing cells are listed by source record and column; correct them manually. Optional blanks are allowed.
- **Dates:** normalize numeric dates with four-digit years to `YYYY-MM-DD`. Valid unambiguous dates can be processed in mixed formats. `03/04/2026` remains unresolved until you choose day-first or month-first. Impossible dates and unsupported formats remain unchanged.
- **Numbers:** normalize decimal and grouping separators without floating-point rounding. Automatic mode leaves a single separator followed by three digits unresolved (`1,234`). Choose dot/comma decimal to disambiguate. Currency symbols/codes remain attached, with no currency conversion. Do not use on identifiers; numeric cleanup may remove leading zeros.
- **Key duplicates:** select columns, inspect records, and choose which one to retain. Unselected groups are skipped. Large group lists, record tables, and repair previews are paginated.
- **Headers:** edit names, preview, apply, and undo.

AI analysis accepts optional cleanup guidance (maximum 1,000 characters), such as “prefer full country names.” It is still constrained to category mappings among existing values. Edits, repairs, and undo clear prior AI proposals and abort active analysis.

### Test files

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

99 tests pass across CSV parsing, import/header handling, date and numeric conventions, key duplicates, missing/empty values, mixed-operation undo, stale previews, AI validation, and component behavior. Type checking and the production build pass. Browser checks verified sorted/filtered cell editing, undoing manual and batch edits, explicit date resolution, currency-preserving number previews, choosing a retained key duplicate, corrected-header import, and a real Meta guidance → preview → apply → undo flow. A 5,000-row file was loaded, filtered, edited, and exported; the downloaded file retained every row in source order and only the intended edit.

## Code map

- `components/repair-workspace.tsx`: interface and state transitions.
- `lib/csv.ts`: parsing, limits, and export.
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

1. Open the demo CSV; optionally apply whitespace cleanup first.
2. Under **Normalize categories with Meta AI**, select `country`.
3. Expand **Review data to send** to see the values and counts.
4. Click **Analyze with Meta**. This makes a real provider call and may use credits.
5. Select the mappings you agree with. Nothing is selected or applied automatically.
6. Click **Preview selected AI repairs**, inspect exact cells, then **Apply repair**.
7. Use **Undo last change** to restore the previous dataset, or export the result.

Canonical labels must already exist in the column. Blank values are never filled; ambiguous values remain unchanged. Requests are limited to 2–100 distinct nonempty values, each at most 200 characters, and a 32 KB request body. Responses are capped at 128 KB and generation at 4,096 completion tokens. Provider calls time out after 45 seconds with no automatic retries. Retry explicitly after checking the error.

Dataset changes clear pending suggestions and abort active analysis. Selecting different mappings clears any old patch preview. Stale dataset versions cannot be applied. Formula-like text stays inert in the UI and follows the existing export protection setting.

### Verification status

- Core, server-route, provider-adapter, and component tests use explicit test-only provider mocks. There is no fake-AI mode in the application.
- Verified browser behavior: configuration-needed message, analysis error/retry, unchanged dataset on failure, and continued access to local repair previews.
- Successful live inference was verified on November 2, 2026: Muse Spark 1.3 returned validated mappings from `U.S.` and `United States` to `USA`. Phase 3 also verified a live guided repair through the browser: USA/U.S. → United States and UK → United Kingdom, followed by apply and undo.
- The server still binds to loopback. Authentication and durable rate limiting for public hosting belong to Phase 5.

Additional code: `components/ai-repairs-panel.tsx`, `lib/ai-repairs.ts`, `lib/schemas.ts`, `lib/ai/meta.ts`, and `app/api/repairs/route.ts`.

Next milestone: Phase 4 visual design and usability improvements.

## Repair workspace

Suggested fixes appear first. Review the before/after values, then apply the whole group or cancel. Download is disabled while a preview is pending. Undo restores the last change. Expand **Standardize labels with Meta AI** or **More cleanup tools** when needed. On narrow screens, the fixes appear above the spreadsheet.
