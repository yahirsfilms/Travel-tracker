# Accounting corrections — local review build

No remote branch, `main`, Pages configuration, or deployment is changed by this work. The existing published source branch remains at `d02f20e` until a separate push is approved.

## Model

One shared fund has a single reporting currency and a dated cash ledger. New trips use that planning currency; expense entry still supports USD, CNY, JPY, EUR, MXN, HKD and GBP with saved manual conversion rates. Existing mixed-currency trips retain their original records and require a fixed trip-to-fund rate during setup.

**Actual remaining money = opening basis + real cash additions − withdrawals + reconciliation corrections − recorded expenses + received refunds.**

A budget allocation, pool transfer, trip transfer, reservation, cancellation, or expected refund never adds a cash receipt. Allocating more money requires actual unallocated funds. Reducing or transferring already-spent allocations cannot free nonexistent cash. Rounding differences in cross-currency transfers remain unallocated rather than becoming extra budget.

For each trip, remaining allocation is its current total budget minus recorded net expenses. Other live trips retain protection for the greater of their remaining allocation or required commitments/reserves. For the active trip, each hotel/transport/emergency pool protects the **greater** of its remaining budget and unpaid commitments, not their sum; future daily commitments are also protected.

The remaining daily capacity is the lower of:

1. This trip's remaining allocation after its protected amounts.
2. Actual shared money after protecting other trips and this trip's protected amounts, converted down conservatively.

Daily allowance reconstructs the start-of-day amount from current capacity plus today's net daily spending, divided by remaining inclusive travel days. Safe spending today is capped at available capacity and never goes below zero. Overspending is shown separately; negative capacity is a visible shortfall. The next-day projection assumes no additional spending today. Original daily target is captured once and remains unchanged by date edits, transfers or later budget adjustments. For migrated records, it is inferred from the original daily budget and currently stored dates because V1 did not retain the earliest date settings.

All dated transactions represent money already paid or received. Future obligations belong in bookings or unlinked holds; new future-dated actual payments/refunds are refused. Existing V1 entries are preserved, including any future dates; review those during setup because V1 did not distinguish scheduled from paid transactions.

## Bookings and refunds

Bookings support daily bills, hotels and transportation. A booking's unpaid amount is its agreed/final cost minus net linked payments, floored at zero. Payments automatically reduce the unpaid commitment; they never count as an additional separate expense.

Cancelling records a final retained cost and releases the remaining obligation. A transparent pair of budget adjustments moves the released planning provision to daily spending while retaining provision for the final cost where possible. The trip's total allocation and actual cash are unchanged. Refund due is net payments minus the final bill. It remains unavailable until a received-refund transaction is recorded. Partial refunds reduce that due amount; overpayments and excess/duplicate refunds are rejected. Final cancellation cost can be corrected with another dated history event.

Earlier V1 payments/refunds can be linked to a booking without creating new transactions. When creating a booking from a legacy unlinked hold, the explicit replacement checkbox deducts the replaced hold so the same bill is not committed twice. Unlinked holds otherwise require manual clearing when paid.

Booked payments retain their original entered currency and conversion. Expected refunds are measured against the planning-currency final bill. An exchange gain beyond the amount due is recorded separately as a real fund addition; a foreign-exchange loss/retained charge requires revising the final cost. There is no automatic exchange-rate feed or bank reconciliation.

## Reconciliation and history

Fund & compare shows the recorded balance, the counted balance and the difference before submission. A reason is required. Confirmation appends a correction with the recorded-before and observed amounts; existing expense history is not rewritten. Adding/removing money and allocating money are distinct actions.

Generic expense edits/deletions retain before/after or deleted values in trip change history. Booking payments are managed through their linked booking rather than silently edited/deleted. Trip date/name/time-zone edits retain previous settings. Both dates can move independently of transaction dates; prepayments, late refunds and shortened trips retain every transaction.

## Preservation and recovery

The IndexedDB database name, version and store remain unchanged. State schema version 2 is saved transactionally. On the first V1-to-accounting write, the untouched earlier state is kept under a separate recovery key in the same local database; Fund & compare can export its original V1 JSON. Repeated updates do not replace that snapshot. It is a local safeguard, not a substitute for an external backup.

V1 JSON backups still import. Their existing budgets never become assumed cash: setup asks what is actually available now and records an explicit opening bridge for earlier net expenses, preventing double deduction. Possible restored duplicates with repeated transaction IDs default to reference status during migration; the setup list permits review.

New version-2 JSON backups contain the shared ledger, all trips, linked bookings/payments, original targets, settings/change history, and imported reference-fund histories. Complete recovery into an empty notebook restores them together. Import into an existing notebook adds read-only references and archives the source fund history separately; neither the imported opening balance nor its expenses enter live totals. This preserves records while preventing duplicate money. Imported references can be reviewed/exported but are not merged into live trips. Full replacement of an existing notebook is intentionally unavailable.

The backup format is forward versioned. Future/unsupported notebook versions and damaged accounting records are rejected before writing. Failed writes and stale revisions leave prior data intact. Corrupt startup data can be exported untouched for manual recovery rather than cleared automatically.

## Remaining boundaries

Actual iPhone Safari/Home Screen testing is still required. The browser tests use Chrome, including narrow frames and server-unavailable operation rather than an airplane-mode network transition. All fixtures are fictional.

Manual rates and counted balances determine accuracy. No bank sync, multi-wallet ledger, recurring bills, automatic FX revaluation or cloud financial storage is added. Completed trips retain their remaining allocation until explicitly released/transferred. Safe allowances can be conservative when existing plans exceed actual funds; review the visible shortfall and release/reallocate plans rather than assuming new money.
