# Travel-tracker
travel budget tracker

## Roam V1 — offline travel budget

A free, buildless Progressive Web App for personal travel budgeting. All application assets are local; there are no runtime packages, remote fonts, analytics, accounts, exchange-rate services, or financial uploads. GitHub Pages hosts code only. Personal records stay in IndexedDB on the device. JSON/CSV exports leave the app only when you explicitly save or share them.

### Features

- Today / History / Trip navigation with quick expense entry, editing, refunds, deletion confirmation and immediate undo.
- Multiple independent trips and an explicit trip picker; old trips are retained.
- Separate daily, hotel, transportation and emergency pools.
- Add/remove funds or transfer between pools with an adjustment history. Expenses remain unchanged.
- Manual unpaid reservation totals for non-daily pools; these are planning holds, not transactions. Reduce the hold when recording payment to avoid double-counting the commitment.
- USD, CNY, EUR, JPY, MXN, HKD and GBP. Every expense keeps its entered currency, manual conversion rate and rounded planning amount. No live rate is assumed. Enter the actual card charge by adjusting the transaction rate if needed.
- Searchable history, full JSON backups, spreadsheet CSV exports, validation and non-destructive restoration as separate trip copies.
- Local storage conflict protection, offline shell caching and explicit update activation.

### Budget rules

Trip dates are inclusive and use the selected IANA trip time zone. Before/after the trip, Today shows the first-day projection/final summary respectively. Future-dated payments are deducted before calculating available daily allowances.

For a trip day, in integer cents:

`allowance = floor((current daily budget - earlier daily spending - future-dated daily spending) / days including today)`

`remaining today = allowance - today's daily spending`

`next day's projection = floor((current daily budget - earlier spending - today's spending - future-dated spending) / days after today)`

The next-day projection assumes no more spending today. Overspending and underspending are spread over remaining days, with cent remainders naturally left for later days. Negative balances remain visible; other pools never fund daily overspending automatically. Refunds are negative expenses. Budget adjustments affect the current budget and recalculate allowances; they do not rewrite transaction history or freeze past allowance snapshots.

### Backups on iPhone

In Trip, choose **Export all trips · JSON**, then **Save to Files** in the share sheet. If sharing files is unsupported, the app offers a download. The export timestamp means the export/share operation completed; it cannot guarantee you retained the file. Open Files and verify it is there.

To recover, choose **Restore backup**, select the JSON file, review trip and expense counts, and confirm. Restoration adds copies of all trips and never replaces existing records. Repeated imports therefore create repeated copies. JSON preserves all trip details, transactions, rates, adjustments and reservations. CSV is for spreadsheets and cannot restore the app. Backups are plain text: keep them somewhere private. Backup imports have a 20 MB size limit.

### Run and test

Serve this directory with a local HTTP server (localhost) or HTTPS static hosting. No build step or runtime installation is needed. The development test dependency is not loaded by the app.

```sh
npm ci
npm test
python3 -m http.server 8000
```

Open `http://localhost:8000/`. File URLs do not support the service worker. For GitHub Pages, retain all root assets and the `/Travel-tracker/` URL prefix. Manifest and service-worker URLs are relative. The worker is scoped to the application directory. Do not rename the database or move the production URL when updating; storage is tied to the origin. Increment the service-worker cache version for changed shell assets. Updates clear only this app's old shell caches and never delete IndexedDB. Database version 1 is currently used; future schema upgrades must use non-destructive migrations and recovery tests.

### Publication status

Implementation is kept on `feature/offline-travel-v1`. No deployment workflow is included and no Pages configuration is changed. Do not merge into the Pages publishing branch, change the publishing source, or deploy until the owner explicitly approves.

See [TESTING.md](TESTING.md) for verified checks and the remaining iPhone acceptance steps.
