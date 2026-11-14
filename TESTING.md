# V1 validation

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
