import test from "node:test";
import assert from "node:assert/strict";
import {
  migrateState,
  initializeFund,
  fundStats,
  safeSummary,
  poolBudget,
  allocation,
  commitment,
  bookingStatus,
  addBooking,
  bookingTransaction,
  linkBookingRecord,
  reviseBooking,
  adjustBudget,
  transferBudget,
  recordFunds,
  validateState,
  makeBackup,
  parseBackup,
  restoreBackup,
} from "../accounting.js";
import { backup, uid } from "../core.js";
const date = "2027-06-01";
const legacyTrip = (
  id = "china",
  budgets = {
    daily: 100000,
    hotels: 50000,
    transport: 20000,
    emergency: 30000,
  },
) => ({
  id,
  name: id === "china" ? "Fictional China" : "Fictional Japan",
  start: date,
  end: "2027-06-10",
  currency: "USD",
  zone: "Asia/Shanghai",
  budgets,
  transactions: [],
  adjustments: [],
  reserved: {},
});
const make = () => {
  const s = migrateState({
    trips: [
      legacyTrip(),
      legacyTrip("japan", {
        daily: 150000,
        hotels: 0,
        transport: 0,
        emergency: 0,
      }),
    ],
    revision: 0,
    active: "china",
  });
  initializeFund(s, 400000, "USD", {}, date);
  return s;
};
const tx = (t, base, pool = "daily", d = date) =>
  t.transactions.push({
    id: uid(),
    date: d,
    amount: base,
    base,
    rate: 1,
    currency: "USD",
    pool,
    category: "Fictional",
    note: "Fictional scenario",
  });
const book = (t, total = 50000, pool = "hotels") =>
  addBooking(t, { name: "Fictional reservation", pool, total, date });
const pay = (t, b, amount, refund = false, d = date) =>
  bookingTransaction(t, b, { amount, date: d, refund, asOf: "2027-12-31" });
const cancel = (t, b, fee = 0) =>
  reviseBooking(t, b, {
    total: b.total,
    cancelled: true,
    fee,
    date,
    note: "Fictional cancellation",
  });
const safe = (s, i = 0, d = date) => safeSummary(s, s.trips[i], d);

test("shared fund includes China and Japan once and protects Japan allocation", () => {
  const s = make();
  assert.equal(fundStats(s).actual, 400000);
  assert.equal(fundStats(s).unallocated, 50000);
  assert.equal(safe(s).allowance, 10000);
  assert.equal(safe(s, 1).allowance, 15000);
});
test("daily overspending is spread over remaining days, original target stays", () => {
  const s = make();
  tx(s.trips[0], 14000);
  assert.equal(safe(s).allowance, 10000);
  assert.equal(safe(s).remaining, -4000);
  assert.equal(safe(s).safeToday, 0);
  assert.equal(safe(s).tomorrow, 9555);
  assert.equal(safe(s, 0, "2027-06-02").allowance, 9555);
  assert.equal(safe(s).original, 10000);
});
test("underspending raises future allowance", () => {
  const s = make();
  tx(s.trips[0], 5500);
  assert.equal(safe(s, 0, "2027-06-02").allowance, 10500);
});
test("hotel overrun reduces daily spending without moving cash or stealing Japan", () => {
  const s = make();
  tx(s.trips[0], 70000, "hotels");
  assert.equal(fundStats(s).actual, 330000);
  assert.equal(safe(s).allowance, 8000);
  assert.equal(safe(s, 1).allowance, 15000);
});
test("transport overrun also reduces allowance", () => {
  const s = make();
  tx(s.trips[0], 35000, "transport");
  assert.equal(safe(s).allowance, 8500);
});
test("unpaid hotel commitment above budget reduces safe allowance", () => {
  const s = make();
  book(s.trips[0], 90000);
  assert.equal(fundStats(s).actual, 400000);
  assert.equal(safe(s).allowance, 6000);
});
test("ordinary hotel payment releases matching commitment exactly once", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  pay(t, b, 20000);
  assert.equal(commitment(t, "hotels"), 30000);
  assert.equal(fundStats(s).actual, 380000);
  assert.equal(safe(s).allowance, 10000);
  pay(t, b, 30000);
  assert.equal(commitment(t, "hotels"), 0);
  assert.equal(safe(s).allowance, 10000);
});
test("cancel unpaid booking releases commitment and planning allocation without cash receipt", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  cancel(t, b);
  assert.equal(commitment(t, "hotels"), 0);
  assert.equal(fundStats(s).actual, 400000);
  assert.equal(allocation(t), 200000);
  assert.equal(poolBudget(t, "daily"), 150000);
  assert.equal(safe(s).allowance, 15000);
});
test("cancel prepaid hotel does not release pending refund into cash", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  pay(t, b, 50000);
  const before = fundStats(s).actual;
  cancel(t, b);
  assert.equal(fundStats(s).actual, before);
  assert.equal(bookingStatus(t, b).pendingRefund, 50000);
  assert.equal(safe(s).available, 100000);
});
test("partial then completed refunds increase actual funds only when received", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  pay(t, b, 50000);
  cancel(t, b);
  pay(t, b, 20000, true);
  assert.equal(fundStats(s).actual, 370000);
  assert.equal(bookingStatus(t, b).pendingRefund, 30000);
  assert.equal(safe(s).available, 120000);
  pay(t, b, 30000, true);
  assert.equal(fundStats(s).actual, 400000);
  assert.equal(bookingStatus(t, b).pendingRefund, 0);
  assert.equal(safe(s).available, 150000);
});
test("cancellation fee and remaining unpaid penalty are protected", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  cancel(t, b, 5000);
  assert.equal(commitment(t, "hotels"), 5000);
  assert.equal(safe(s).available, 145000);
  pay(t, b, 5000);
  assert.equal(fundStats(s).actual, 395000);
  assert.equal(safe(s).available, 145000);
});
test("part paid cancellation fee leaves only excess payment pending", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  pay(t, b, 20000);
  cancel(t, b, 5000);
  assert.equal(bookingStatus(t, b).pendingRefund, 15000);
  assert.equal(bookingStatus(t, b).unpaid, 0);
  pay(t, b, 15000, true);
  assert.equal(fundStats(s).actual, 395000);
  assert.equal(safe(s).available, 145000);
});
test("repeated cancellation cannot release the budget twice", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  cancel(t, b);
  const allocationBefore = allocation(t),
    daily = poolBudget(t, "daily");
  cancel(t, b);
  assert.equal(allocation(t), allocationBefore);
  assert.equal(poolBudget(t, "daily"), daily);
});
test("changed cancellation fee retains audit history and recalculates pending refunds", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  pay(t, b, 50000);
  cancel(t, b, 5000);
  cancel(t, b, 10000);
  assert.equal(bookingStatus(t, b).pendingRefund, 40000);
  assert.equal(b.changes.length, 3);
});
test("refund beyond the amount due is rejected without changing transactions", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  pay(t, b, 10000);
  cancel(t, b);
  assert.throws(() => pay(t, b, 10001, true));
  assert.equal(t.transactions.length, 1);
});
test("duplicate full payment is rejected; future receipt rejected", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  pay(t, b, 50000);
  assert.throws(() => pay(t, b, 1));
  cancel(t, b);
  assert.throws(() =>
    bookingTransaction(t, b, {
      amount: 50000,
      date: "2028-01-01",
      asOf: date,
      refund: true,
    }),
  );
  assert.equal(fundStats(s).actual, 350000);
});
test("hotel cost revision creates or releases only outstanding obligation", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  pay(t, b, 20000);
  reviseBooking(t, b, {
    total: 70000,
    cancelled: false,
    date,
    note: "Fictional extra nights",
  });
  assert.equal(commitment(t, "hotels"), 50000);
  assert.equal(safe(s).allowance, 8000);
  assert.equal(fundStats(s).actual, 380000);
});
test("foreign currency booking payments preserve entered amount and fixed conversion", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  bookingTransaction(t, b, {
    amount: 100000,
    currency: "CNY",
    rate: 0.14,
    date,
    asOf: date,
  });
  assert.equal(t.transactions[0].amount, 100000);
  assert.equal(t.transactions[0].base, 14000);
  assert.equal(commitment(t, "hotels"), 36000);
  assert.equal(fundStats(s).actual, 386000);
});
test("zero-rounding and invalid payment rates rejected", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  assert.throws(() =>
    bookingTransaction(t, b, {
      amount: 1,
      currency: "CNY",
      rate: 0.000001,
      date,
      asOf: date,
    }),
  );
  assert.throws(() =>
    bookingTransaction(t, b, {
      amount: 1,
      currency: "USD",
      rate: 2,
      date,
      asOf: date,
    }),
  );
  assert.equal(t.transactions.length, 0);
});
test("pre-trip payments and post-trip refunds are accepted", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  pay(t, b, 50000, false, "2027-05-01");
  cancel(t, b);
  pay(t, b, 50000, true, "2027-07-01");
  validateState(s);
  assert.equal(fundStats(s).actual, 400000);
});
test("dates can shorten or extend without losing history or original target", () => {
  const s = make(),
    t = s.trips[0];
  tx(t, 10000, "daily", "2027-05-01");
  t.end = "2027-06-20";
  assert.equal(safe(s).allowance, 4500);
  t.start = "2027-06-05";
  t.end = "2027-06-09";
  assert.equal(safe(s).allowance, 18000);
  assert.equal(t.originalTarget, 10000);
  validateState(s);
  assert.equal(t.transactions.length, 1);
});
test("completed trips have no current daily allowance", () => {
  const s = make();
  assert.equal(safe(s, 0, "2027-06-11").safeToday, 0);
  assert.equal(safe(s, 0, "2027-06-11").days, 0);
});
test("original target remains after funded budget changes", () => {
  const s = make(),
    t = s.trips[0];
  adjustBudget(s, t, "daily", 50000, date, "Fictional allocated funds");
  assert.equal(safe(s).allowance, 15000);
  assert.equal(safe(s).original, 10000);
  assert.equal(fundStats(s).actual, 400000);
});
test("unfunded allocation is rejected; a planning adjustment cannot manufacture funds", () => {
  const s = make();
  assert.throws(() =>
    adjustBudget(s, s.trips[0], "daily", 50001, date, "Fictional"),
  );
  assert.equal(fundStats(s).actual, 400000);
  assert.equal(allocation(s.trips[0]), 200000);
});
test("cross-trip transfer conserves cash and original targets", () => {
  const s = make();
  transferBudget(
    s,
    s.trips[0],
    s.trips[1],
    "daily",
    "daily",
    50000,
    date,
    "Fictional China to Japan",
  );
  assert.equal(fundStats(s).actual, 400000);
  assert.equal(safe(s).allowance, 5000);
  assert.equal(safe(s, 1).allowance, 20000);
  assert.equal(safe(s).original, 10000);
});
test("within-trip pool transfer conserves allocation and actual funds", () => {
  const s = make(),
    t = s.trips[0];
  transferBudget(s, t, t, "daily", "hotels", 10000, date, "Fictional");
  assert.equal(allocation(t), 200000);
  assert.equal(fundStats(s).actual, 400000);
  assert.equal(safe(s).allowance, 9000);
});
test("cannot transfer spent money; failed transfer is atomic", () => {
  const s = make(),
    t = s.trips[0];
  s.fund.ledger[0].amount = 350000;
  tx(t, 200000);
  const before = structuredClone(s);
  assert.throws(() =>
    transferBudget(
      s,
      t,
      s.trips[1],
      "daily",
      "daily",
      10000,
      date,
      "Fictional",
    ),
  );
  assert.deepEqual(s, before);
});
test("actual cash deposits and withdrawals have separate audit records", () => {
  const s = make();
  recordFunds(s, { amount: 10000, date, note: "Fictional deposit" });
  recordFunds(s, {
    amount: -2000,
    date,
    note: "Fictional withdrawal",
    type: "withdrawal",
  });
  assert.equal(fundStats(s).actual, 408000);
  assert.equal(allocation(s.trips[0]), 200000);
  assert.equal(s.fund.ledger.length, 3);
});
test("reconciliation compares counted money and appends correction without editing expenses", () => {
  const s = make(),
    t = s.trips[0];
  tx(t, 10000);
  const old = structuredClone(t.transactions);
  recordFunds(s, {
    amount: -5000,
    observed: 385000,
    type: "reconciliation",
    date,
    note: "Fictional missing cash",
  });
  assert.equal(fundStats(s).actual, 385000);
  assert.equal(s.fund.ledger.at(-1).before, 390000);
  assert.deepEqual(t.transactions, old);
});
test("stale reconciliation comparison is rejected", () => {
  const s = make();
  assert.throws(() =>
    recordFunds(s, {
      amount: -5000,
      observed: 380000,
      type: "reconciliation",
      date,
      note: "Fictional",
    }),
  );
  assert.equal(fundStats(s).actual, 400000);
});
test("cash shortfall caps daily spending and never steals protected trips", () => {
  const s = make();
  recordFunds(s, {
    amount: -100000,
    observed: 300000,
    type: "reconciliation",
    date,
    note: "Fictional missing funds",
  });
  assert.equal(safe(s).allowance, 5000);
  assert.equal(safe(s).safeToday, 5000);
});
test("all money exhausted means zero safe spending and visible shortfall", () => {
  const s = make();
  recordFunds(s, {
    amount: -400000,
    observed: 0,
    type: "reconciliation",
    date,
    note: "Fictional loss",
  });
  assert.equal(safe(s).safeToday, 0);
  assert.ok(safe(s).shortfall > 0);
});
test("pending refunds in Japan cannot fund China", () => {
  const s = make(),
    t = s.trips[1];
  const b = book(t, 150000, "daily");
  pay(t, b, 150000);
  cancel(t, b);
  assert.equal(fundStats(s).actual, 250000);
  assert.equal(bookingStatus(t, b).pendingRefund, 150000);
  assert.equal(safe(s).allowance, 10000);
});
test("legacy migration preserves original transactions, holds, budgets, notes and adjustments", () => {
  const t = legacyTrip();
  tx(t, 12345);
  t.reserved.hotels = 10000;
  t.adjustments.push({
    id: uid(),
    date,
    pool: "daily",
    amount: 500,
    note: "Fictional",
  });
  const before = structuredClone(t),
    old = { revision: 7, trips: [t], active: t.id };
  const migrated = migrateState(old);
  for (const k of Object.keys(before))
    assert.deepEqual(migrated.trips[0][k], before[k]);
  assert.equal(migrated.fund.initialized, false);
  assert.equal(old.schemaVersion, undefined);
  assert.equal(safe(migrated).safeToday, 0);
});
test("legacy opening bridge does not deduct previous expenses twice", () => {
  const t = legacyTrip();
  tx(t, 12345);
  const s = migrateState({ trips: [t], revision: 0 });
  initializeFund(s, 200000, "USD", {}, date);
  assert.equal(fundStats(s).actual, 200000);
  assert.equal(s.fund.ledger[0].amount, 212345);
  assert.equal(s.fund.ledger[0].historical, 12345);
});
test("legacy mixed currencies require explicit fixed conversion", () => {
  const t = legacyTrip();
  t.currency = "CNY";
  t.transactions.push({
    id: uid(),
    date,
    base: 10000,
    amount: 10000,
    currency: "CNY",
    rate: 1,
    pool: "daily",
    category: "Fictional",
    note: "Fictional",
  });
  const s = migrateState({ trips: [t], revision: 0 });
  assert.throws(() => initializeFund(s, 200000, "USD", {}, date));
  initializeFund(
    s,
    200000,
    "USD",
    { china: { included: true, rate: 0.14 } },
    date,
  );
  assert.equal(fundStats(s).actual, 200000);
  assert.equal(s.fund.ledger[0].historical, 1400);
});
test("cross-currency trip budget transfer never creates cash or extra allocation", () => {
  const s = make(),
    t = s.trips[1];
  t.currency = "CNY";
  t.fundRate = 0.14;
  const before = fundStats(s).actual,
    plan = s.trips.reduce(
      (v, t) => v + Math.round(allocation(t) * t.fundRate),
      0,
    );
  transferBudget(
    s,
    s.trips[0],
    t,
    "daily",
    "daily",
    101,
    date,
    "Fictional rounding",
  );
  assert.equal(fundStats(s).actual, before);
  assert.ok(
    s.trips.reduce((v, t) => v + Math.round(allocation(t) * t.fundRate), 0) <=
      plan,
  );
});
test("V2 complete backup roundtrip includes fund, bookings, payment links and pending refund", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  pay(t, b, 20000);
  cancel(t, b);
  recordFunds(s, { amount: 1000, date, note: "Fictional extra cash" });
  const restored = parseBackup(JSON.parse(JSON.stringify(makeBackup(s))));
  assert.deepEqual(restored.trips, s.trips);
  assert.deepEqual(restored.fund, s.fund);
  assert.equal(fundStats(restored).actual, fundStats(s).actual);
  assert.equal(
    bookingStatus(restored.trips[0], restored.trips[0].bookings[0])
      .pendingRefund,
    20000,
  );
});
test("V1 backup still imports with explicit fund setup", () => {
  const old = backup([legacyTrip()]);
  const recovered = parseBackup(old);
  assert.equal(recovered.schemaVersion, 2);
  assert.equal(recovered.fund.initialized, false);
  assert.deepEqual(recovered.trips[0].transactions, old.trips[0].transactions);
});
test("full recovery works only into empty notebook and retains totals", () => {
  const s = make(),
    empty = migrateState({ trips: [], revision: 8 });
  const restored = restoreBackup(empty, makeBackup(s), "full");
  assert.equal(restored.revision, 8);
  assert.equal(fundStats(restored).actual, 400000);
  assert.throws(() => restoreBackup(s, makeBackup(s), "full"));
});
test("additive import preserves current fund and does not duplicate live money or expenses", () => {
  const s = make();
  tx(s.trips[0], 10000);
  const original = fundStats(s).actual,
    copy = makeBackup(s);
  restoreBackup(s, copy);
  restoreBackup(s, copy);
  assert.equal(s.trips.length, 6);
  assert.equal(fundStats(s).actual, original);
  assert.ok(s.trips.slice(2).every((t) => !t.included));
  assert.deepEqual(s.fund, copy.fund);
});
test("corrupt accounting backup and unknown notebook version rejected", () => {
  for (const change of [
    (s) => (s.fund.ledger[0].amount = "10"),
    (s) => (s.trips[0].fundRate = 0),
    (s) => (s.trips[0].originalTarget = -1),
    (s) => (s.trips[0].budgets.daily = -1),
    (s) => s.fund.ledger.push({ ...s.fund.ledger[0] }),
  ]) {
    const s = make();
    change(s);
    assert.throws(() =>
      parseBackup({ format: "travel-tracker", version: 2, ...s }),
    );
  }
  assert.throws(() => migrateState({ schemaVersion: 3, trips: [] }));
});
test("dangling booking payments and excess refunds rejected on import", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t);
  pay(t, b, 10000);
  t.transactions[0].bookingId = "missing";
  assert.throws(() => validateState(s));
  t.transactions[0].bookingId = b.id;
  tx(t, -20000, "hotels");
  t.transactions.at(-1).bookingId = b.id;
  assert.throws(() => validateState(s));
});
test("one-day trip and penny rounding reconcile exactly", () => {
  const s = make(),
    t = s.trips[0];
  t.budgets.daily = 100001;
  for (let day = 1; day <= 10; day++) {
    const d = "2027-06-" + String(day).padStart(2, "0");
    tx(t, safeSummary(s, t, d).safeToday, "daily", d);
  }
  assert.equal(safe(s, 0, "2027-06-10").available, 0);
  const last = make();
  last.trips[0].end = date;
  assert.equal(safe(last).allowance, 100000);
  assert.equal(safe(last).tomorrow, null);
});
test("non-daily reserves and commitments are protected by max, not double subtracted", () => {
  const s = make(),
    t = s.trips[0];
  t.reserved.hotels = 50000;
  assert.equal(safe(s).allowance, 10000);
  t.reserved.hotels = 70000;
  assert.equal(safe(s).allowance, 8000);
});
test("daily future commitments affect safety without becoming paid expenses", () => {
  const s = make();
  book(s.trips[0], 10000, "daily");
  assert.equal(safe(s).allowance, 9000);
  assert.equal(fundStats(s).actual, 400000);
});
test("generated overspending scenarios never permit more than own capacity or available cash", () => {
  for (let i = 0; i < 100; i++) {
    const s = make(),
      t = s.trips[0];
    tx(t, i * 2111, "hotels");
    tx(t, i * 97, "daily");
    const v = safe(s);
    assert.ok(v.safeToday >= 0);
    assert.ok(v.safeToday <= Math.max(0, fundStats(s).actual));
    assert.ok(
      v.safeToday <=
        Math.max(
          0,
          allocation(t) - t.transactions.reduce((v, x) => v + x.base, 0),
        ),
    );
    assert.equal(v.original, 10000);
  }
});

test("cancellation keeps final fee budgeted even when hotel was over original budget", () => {
  const s = make(),
    t = s.trips[0],
    b = book(t, 70000);
  pay(t, b, 35000);
  cancel(t, b, 5000);
  assert.equal(poolBudget(t, "hotels"), 5000);
  assert.equal(poolBudget(t, "daily"), 145000);
  assert.equal(allocation(t), 200000);
  pay(t, b, 30000, true);
  assert.equal(bookingStatus(t, b).pendingRefund, 0);
  assert.equal(
    poolBudget(t, "hotels") -
      t.transactions
        .filter((x) => x.pool === "hotels")
        .reduce((v, x) => v + x.base, 0),
    0,
  );
});
test("linking a legacy prepayment cannot create a duplicate expense or reduce cash again", () => {
  const s = make(),
    t = s.trips[0];
  tx(t, 20000, "hotels");
  const b = book(t);
  const before = fundStats(s).actual;
  linkBookingRecord(t, b, t.transactions[0].id, date, "Fictional legacy match");
  assert.equal(t.transactions.length, 1);
  assert.equal(fundStats(s).actual, before);
  assert.equal(bookingStatus(t, b).unpaid, 30000);
  assert.throws(() =>
    linkBookingRecord(t, b, t.transactions[0].id, date, "Duplicate"),
  );
  validateState(s);
});
test("legacy payment must precede linking a recorded refund", () => {
  const s = make(),
    t = s.trips[0];
  tx(t, 20000, "hotels");
  tx(t, -5000, "hotels");
  const b = book(t);
  assert.throws(() =>
    linkBookingRecord(t, b, t.transactions[1].id, date, "Fictional"),
  );
  linkBookingRecord(t, b, t.transactions[0].id, date, "Fictional original");
  linkBookingRecord(t, b, t.transactions[1].id, date, "Fictional refund");
  assert.equal(bookingStatus(t, b).net, 15000);
  assert.equal(t.transactions.length, 2);
});
test("explicitly replacing a legacy commitment avoids double counting", () => {
  const s = make(),
    t = s.trips[0];
  t.reserved.hotels = 70000;
  addBooking(t, {
    name: "Fictional linked hold",
    pool: "hotels",
    total: 50000,
    date,
    replaceHold: true,
  });
  assert.equal(t.reserved.hotels, 20000);
  assert.equal(commitment(t, "hotels"), 70000);
  assert.equal(t.changes.at(-1).before, 70000);
  assert.equal(fundStats(s).actual, 400000);
});
test("reference copy creation cannot bypass the current fund by importing extra cash", () => {
  const s = make(),
    external = make();
  recordFunds(external, {
    amount: 900000,
    date,
    note: "Fictional other account",
  });
  const before = fundStats(s).actual;
  restoreBackup(s, makeBackup(external));
  assert.equal(fundStats(s).actual, before);
  assert.equal(s.fund.ledger.length, 1);
});
test("safe spending remains within actual cash after exchange rounding", () => {
  for (const fx of [0.14, 0.123456, 1.27, 7.1]) {
    const s = make(),
      t = s.trips[0];
    t.currency = "CNY";
    t.fundRate = fx;
    s.trips[1].included = false;
    const v = safe(s);
    assert.ok(Math.round(v.safeToday * fx) <= Math.max(0, fundStats(s).actual));
    assert.ok(v.safeToday <= v.available);
  }
});

test("import preserves source fund history as references without adding money, including re-export", () => {
  const s = make(),
    other = make();
  recordFunds(other, { amount: 5000, date, note: "Fictional source cash" });
  const before = fundStats(s).actual;
  restoreBackup(s, makeBackup(other));
  assert.equal(fundStats(s).actual, before);
  assert.deepEqual(s.referenceFunds[0].fund, other.fund);
  assert.equal(s.referenceFunds[0].actual, 405000);
  const again = parseBackup(JSON.parse(JSON.stringify(makeBackup(s))));
  assert.deepEqual(again.referenceFunds, s.referenceFunds);
  const third = make();
  restoreBackup(third, makeBackup(again));
  assert.equal(fundStats(third).actual, 400000);
  validateState(third);
});
test("V1 restored duplicates default to reference status on migration", () => {
  const a = legacyTrip();
  tx(a, 10000);
  const b = structuredClone(a);
  b.id = "restored-copy";
  const migrated = migrateState({ trips: [a, b], revision: 0 });
  assert.equal(migrated.trips[0].included, true);
  assert.equal(migrated.trips[1].included, false);
  assert.deepEqual(migrated.trips[1].transactions, b.transactions);
});
