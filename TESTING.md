# Accounting review build validation

Run `npm ci && npm test`. **75 tests pass**: the original 19 checks plus 56 accounting/migration checks. Original core planner checks remain as compatibility tests; the app uses `safeSummary` from accounting.js.

New coverage includes shared China/Japan funds, allocations versus real receipts, hotel/transport overruns, overspending/underspending, partial payments, cancellation fees, unpaid penalties, pending/partial/completed refunds, duplicate payments/refunds, foreign-currency entry, pre/post-trip transactions, date changes and fixed original targets, reconciliation discrepancies and stale comparisons, unfunded/failed transfers, currency rounding, old/new backups, duplicate-safe references, source fund-history preservation, malformed data, and atomic IndexedDB migration retaining an untouched V1 recovery snapshot. Generated scenarios check 100 combinations of overspending and four legacy FX rates.

## Accounting browser checks (fictional data only)

- Activated the accounting update over the earlier V1 notebook. Existing trips and expenses survived. Opening with a counted $4,000 recorded a $4,140 opening basis for $140 already spent, leaving exactly $4,000 actual money. Excluded the earlier restored duplicate from live funds.
- Created a separate $1,500 Japan allocation; actual funds stayed $4,000. China original $100/day target remained visible.
- Added a $700 hotel booking against a $500 pool. The adjusted daily allowance fell from $100 to $80 and the original target remained $100. Actual money was unchanged.
- Recorded CNY 2,500 at 0.14 USD/CNY as a $350 partial hotel payment. Actual funds became $3,650 and the unpaid booking fell from $700 to $350.
- Cancelled with a $50 final cost. Cash stayed $3,650; $300 became refund pending. Recorded two received $150 refunds: actual funds became $3,800 then $3,950, with no remaining refund due.
- Compared $3,950 recorded with $3,900 counted. Preview showed -$50; confirmation added a reconciliation entry and retained expenses.
- Transferred $100 of China allocation to Japan. Allocations changed to $1,900 and $1,600; actual money stayed $3,900.
- Stopped the preview server, reopened the cached app, recorded a $5 expense, reloaded and verified actual money $3,895 and the saved expense. The browser still reported network online: this tests server unavailability, not airplane-mode transitions.
- Exported the complete JSON while the server was stopped and imported that exact file into the existing notebook as references. Actual money remained $3,895.
- In a separate QA namespace (same source, isolated database/cache names only), loaded an empty notebook, stopped the server, restored the exported JSON, reloaded and verified $3,895 actual funds, China/Japan allocations, original target, booking records, completed refunds, and reconciliation history. The original notebook was not cleared.

Final UI checks passed at 320/390/430 pixel frame widths with no horizontal page overflow. A 320-pixel trip-date dialog overflow was found and corrected; its measured scroll width now equals its client width (267 px). Browser shortening of trip dates retained all earlier transactions, the $3,895 actual balance and the original $100 target, while the first-day allowance recalculated to $150.62 over eight travel days. A further $50 pool transfer retained the same actual balance. Final syntax, formatting and diff checks pass. See docs/accounting-mobile-preview.jpg. iPhone device tests remain outstanding.

## Controlled iPhone acceptance after explicit deployment approval

1. Export any existing records. Open the approved HTTPS URL in Safari, add to Home Screen, launch that installed app consistently, and wait for Ready offline.
2. Use fictional money first: create one shared fund and China/Japan allocations. Confirm allocation and trip transfers never alter actual funds. Compare original target and safe allowance.
3. Add a hotel booking, pay part of it, revise the cost, cancel with a fee, then receive partial/final refunds. Confirm pending refunds never increase actual funds. Try the existing-payment link when testing V1 migration.
4. Shorten and extend trip dates; retain pre-trip payments and post-trip refunds. Verify original targets and transaction history survive.
5. Count a different balance, inspect the discrepancy, record a reasoned correction and inspect its history.
6. Export to Files, verify the JSON exists, restore references, and confirm no doubled money. Test full recovery in a separate empty test notebook/device—not by clearing your only records.
7. Turn on airplane mode with Wi-Fi off. Reopen, add expenses, change bookings, export/import a backup and reopen again. Verify persistence.
8. Check Safari date pickers, decimal keyboard, large text, small-screen scrolling, safe areas, file share sheet and Home Screen behavior. Reconnect and check a later app update preserves records.

No real records should be relied upon until device acceptance passes. See ACCOUNTING.md for manual FX, legacy holds, reference imports, and storage limitations.

---

# Original V1 validation record



Only fictional trip and expense records were used. There are no seeded production records or backup files in the source repository.

## Automated tests: 19 passing

Run `npm ci && npm test` with Node 24 or a compatible modern Node version.

- Inclusive dates, even redistribution of overspending/underspending, one-day trips, final-day shortfall, penny reconciliation.
- Separate pools, refunds, manual adjustments retaining transactions, future-dated payments deducted once.
- Fixed per-entry conversion and rejection of inconsistent conversions.
- Multi-trip JSON roundtrip including reservations and adjustments; malformed/unsupported backup rejection.
- CSV quote and formula escaping.
- IndexedDB reopen/read, stale revision rejection, original records retained after additive recovery. This automated test uses fake-indexeddb.
- Worker install checks every cached asset exists; offline shell/navigation/asset responses and unrelated-cache preservation. This automated test uses an in-memory worker/cache harness.

## Browser checks completed in cloud Chrome

- Created a fictional 10-day trip with four budgets; entered CNY 1,000 at USD 0.14/CNY. Verified USD 140 spending, -USD 40 remaining today, and USD 95.55 next-day projection.
- Reloaded and verified the trip and expense persisted.
- Activated a changed service worker and verified stored records were retained.
- Exported JSON through the app's download flow, selected that exact file in Restore, reviewed counts, confirmed recovery, switched to restored trip and verified its expense and balances. Original trip remained available.
- Stopped the local preview server. Reopened the service-worker-controlled app, saved a CNY 10 fictional expense, reloaded, and verified both expenses persisted. This tests server unavailability, not a device airplane-mode network transition; navigator.onLine remained true.
- Added USD 100 to the daily budget with a reason while the server was unavailable. Verified USD 1,100 budget, USD 141.40 expenses, USD 958.60 pool balance and preserved adjustment history.
- Reviewed responsive layout in a narrow iframe and checked for horizontal document overflow at 320/390/430 CSS pixel frame widths. This is Chrome responsive layout QA, not Safari device emulation.

## iPhone acceptance — still required

After explicit approval to publish a testable HTTPS version:

1. Open the supplied Pages URL in regular Safari. Add to Home Screen, launch from that icon, and wait for **Ready offline**. Use that installed app consistently for this test.
2. Create fictional trips A and B with different budgets. Switch between them and confirm they stay independent.
3. Add expenses in CNY and your planning currency; check the conversion preview. Overspend the daily allowance, then verify the next-day projection. Check edits, refunds and a manual budget transfer.
4. Export all trips via the share sheet → Save to Files. Verify the file exists. Restore it, review counts and confirm. Check the restored copies and original trips.
5. Turn on airplane mode and turn Wi-Fi off. Close and reopen the Home Screen app. Add/edit an expense, adjust a budget, export a backup and restore it. Close/reopen again and verify persistence.
6. Reconnect. Check the keyboard, decimal entry, date pickers, scrolling, dialog buttons, safe-area spacing and display with large text enabled.
7. During a future app update, export first, activate the update, then verify trips and transactions are unchanged. Test only with fictional data until acceptance is complete.

## Known limits

- Actual iPhone Safari/Home Screen and share-sheet recovery have not been tested here.
- Local storage can be removed by clearing website data, device loss or browser storage eviction. Persistent storage is requested where supported; it is not guaranteed. Keep JSON backups outside the app.
- There is no cross-device sync, encryption, bank integration, automatic exchange-rate retrieval or receipt attachment support in V1.
- No background reminders: the backup prompt appears in the app. Reservation holds require manual reduction after payment.
- Restoration is additive, not a merge/sync engine. This deliberately avoids overwriting current records, at the cost of duplicate restored trips.
