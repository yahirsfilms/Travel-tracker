import test from "node:test";
import assert from "node:assert/strict";
import {
  summary,
  balance,
  validate,
  backup,
  cents,
  convert,
  csv,
  dayNumber,
} from "../core.js";
const make = () => ({
  id: "fictional-trip",
  name: "Fictional test trip",
  start: "2027-06-01",
  end: "2027-06-10",
  currency: "USD",
  zone: "Asia/Shanghai",
  budgets: { daily: 100000, hotels: 50000, transport: 20000, emergency: 30000 },
  transactions: [],
  adjustments: [],
  reserved: { hotels: 10000 },
});
const expense = (base, date = "2027-06-01", pool = "daily") => ({
  id: crypto.randomUUID(),
  base,
  amount: base,
  date,
  pool,
  currency: "USD",
  rate: 1,
  category: "Food",
  note: "Fictional",
});
test("initial allowance includes both dates", () =>
  assert.equal(summary(make(), "2027-06-01").allowance, 10000));
test("overspending spreads evenly over remaining days", () => {
  const t = make();
  t.transactions.push(expense(14000));
  assert.equal(summary(t, "2027-06-01").remaining, -4000);
  assert.equal(summary(t, "2027-06-01").tomorrow, 9555);
  assert.equal(summary(t, "2027-06-02").allowance, 9555);
});
test("underspending rolls forward", () => {
  const t = make();
  t.transactions.push(expense(5500));
  assert.equal(summary(t, "2027-06-02").allowance, 10500);
});
test("other pools stay independent", () => {
  const t = make();
  t.transactions.push(expense(60000, "2027-06-01", "hotels"));
  assert.equal(balance(t, "hotels"), -10000);
  assert.equal(summary(t, "2027-06-01").allowance, 10000);
  assert.equal(balance(t, "emergency"), 30000);
});
test("adjustments preserve history and recalculate", () => {
  const t = make();
  t.transactions.push(expense(10000));
  t.adjustments.push({
    id: "a",
    date: "2027-06-02",
    pool: "daily",
    amount: 9000,
    note: "Extra funds",
  });
  assert.equal(summary(t, "2027-06-02").allowance, 11000);
  assert.equal(t.transactions.length, 1);
});
test("refunds return funds", () => {
  const t = make();
  t.transactions.push(expense(14000), expense(-4000));
  assert.equal(summary(t, "2027-06-02").allowance, 10000);
});
test("one day and overspent final day are finite", () => {
  const t = make();
  t.end = t.start;
  t.transactions.push(expense(110000));
  assert.equal(summary(t, t.start).tomorrow, null);
  assert.equal(summary(t, t.start).remaining, -10000);
});
test("future dated payments are deducted once", () => {
  const t = make();
  t.transactions.push(expense(10000, "2027-06-10"));
  assert.equal(summary(t, t.start).allowance, 9000);
  assert.equal(summary(t, t.start).tomorrow, 10000);
});
test("rounding leaves pennies for the last day", () => {
  const t = make();
  t.budgets.daily = 100001;
  for (let i = 1; i <= 10; i++) {
    const date = `2027-06-${String(i).padStart(2, "0")}`;
    t.transactions.push(expense(summary(t, date).allowance, date));
  }
  assert.equal(balance(t, "daily"), 0);
});
test("backup roundtrip retains all trips, transactions, adjustments and reservations", () => {
  const a = make(),
    b = make();
  b.id = "second";
  a.transactions.push(expense(12345));
  a.adjustments.push({
    id: "a",
    date: a.start,
    pool: "daily",
    amount: 500,
    note: "More",
  });
  const data = JSON.parse(JSON.stringify(backup([a, b])));
  assert.deepEqual(validate(data).trips, [a, b]);
});
test("reject damaged, unsupported and malformed backups", () => {
  for (const mutate of [
    (d) => (d.version = 2),
    (d) => (d.trips[0].budgets.daily = "100"),
    (d) => (d.trips[0].end = "2027-02-30"),
    (d) => d.trips.push(d.trips[0]),
    (d) => (d.trips[0].reserved.hotels = -1),
    (d) => (d.trips[0].zone = "Mars/City"),
  ]) {
    const d = backup([make()]);
    mutate(d);
    assert.throws(() => validate(d));
  }
});
test("conversion saved, not changed by later rates", () => {
  const t = make();
  const r = { ...expense(140), currency: "CNY", amount: 1000, rate: 0.14 };
  t.transactions.push(r);
  t.rates = { CNY: 0.15 };
  assert.equal(validate(backup([t])).trips[0].transactions[0].base, 140);
});
test("invalid conversion rejected", () => {
  const t = make();
  t.transactions.push({ ...expense(100), base: 200 });
  assert.throws(() => validate(backup([t])));
});
test("safe date and monetary validation", () => {
  assert.equal(cents("12.34"), 1234);
  assert.throws(() => cents("abc"));
  assert.throws(() => dayNumber("2027-02-29"));
});
test("CSV escapes quotes and spreadsheet formulas", () => {
  const t = make();
  t.transactions.push({ ...expense(100), note: '=SUM(1,2)"' });
  assert.match(csv(t), /'=SUM/);
  assert.match(csv(t), /""/);
});

test("refund conversion mirrors expense rounding", () => {
  assert.equal(convert(15, 0.1), 2);
  assert.equal(convert(-15, 0.1), -2);
});
test("transfers conserve total budget without changing expenses", () => {
  const t = make();
  t.transactions.push(expense(500));
  t.adjustments.push(
    {
      id: "from",
      date: t.start,
      pool: "hotels",
      amount: -10000,
      note: "Transfer",
    },
    { id: "to", date: t.start, pool: "daily", amount: 10000, note: "Transfer" },
  );
  validate(backup([t]));
  assert.equal(balance(t, "daily"), 109500);
  assert.equal(balance(t, "hotels"), 40000);
  assert.equal(t.transactions.length, 1);
});
