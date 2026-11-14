export const POOLS = ["daily", "hotels", "transport", "emergency"];
export const uid = () => crypto.randomUUID();
export function convert(amount, rate) {
  return Math.sign(amount) * Math.round(Math.abs(amount) * rate);
}
export function cents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 1e9)
    throw Error("Enter a valid amount.");
  return Math.round(n * 100);
}
export function dayNumber(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Error("Invalid date");
  const n = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== s)
    throw Error("Invalid date");
  return n / 86400000;
}
export function dateInZone(zone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function balance(trip, pool) {
  return (
    trip.budgets[pool] +
    trip.adjustments
      .filter((a) => a.pool === pool)
      .reduce((s, a) => s + a.amount, 0) -
    trip.transactions
      .filter((t) => t.pool === pool)
      .reduce((s, t) => s + t.base, 0)
  );
}
export function summary(trip, date) {
  const start = dayNumber(trip.start),
    end = dayNumber(trip.end),
    now = dayNumber(date);
  const day = Math.max(start, Math.min(now, end));
  const before = trip.transactions
    .filter((t) => t.pool === "daily" && dayNumber(t.date) < day)
    .reduce((s, t) => s + t.base, 0);
  const budget =
    trip.budgets.daily +
    trip.adjustments
      .filter((a) => a.pool === "daily")
      .reduce((s, a) => s + a.amount, 0);
  const days = end - day + 1;
  const future = trip.transactions
    .filter((t) => t.pool === "daily" && dayNumber(t.date) > day)
    .reduce((s, t) => s + t.base, 0);
  const allowance = Math.floor((budget - before - future) / days);
  const spent = trip.transactions
    .filter((t) => t.pool === "daily" && dayNumber(t.date) === day)
    .reduce((s, t) => s + t.base, 0);
  const futureSpent = trip.transactions
    .filter((t) => t.pool === "daily" && dayNumber(t.date) > day)
    .reduce((s, t) => s + t.base, 0);
  return {
    allowance,
    spent,
    remaining: allowance - spent,
    tomorrow:
      days > 1
        ? Math.floor((budget - before - spent - futureSpent) / (days - 1))
        : null,
    days,
    status: now < start ? "Upcoming" : now > end ? "Completed" : "In progress",
  };
}
export function validate(data) {
  if (
    !data ||
    data.format !== "travel-tracker" ||
    data.version !== 1 ||
    !Array.isArray(data.trips) ||
    data.trips.length > 1000
  )
    throw Error("Unsupported or damaged backup.");
  const ids = new Set();
  const money = (n) => Number.isSafeInteger(n) && Math.abs(n) <= 1e11;
  for (const t of data.trips) {
    if (
      !t ||
      typeof t.id !== "string" ||
      ids.has(t.id) ||
      typeof t.zone !== "string" ||
      typeof t.name !== "string" ||
      !t.name.trim() ||
      t.name.length > 100 ||
      !["USD", "CNY", "EUR", "JPY", "MXN", "HKD", "GBP"].includes(t.currency)
    )
      throw Error("Invalid trip.");
    ids.add(t.id);
    if (dayNumber(t.end) < dayNumber(t.start))
      throw Error("Invalid trip dates.");
    new Intl.DateTimeFormat("en", { timeZone: t.zone });
    if (
      !t.budgets ||
      !POOLS.every((p) => money(t.budgets[p]) && t.budgets[p] >= 0) ||
      !Array.isArray(t.transactions) ||
      !Array.isArray(t.adjustments)
    )
      throw Error("Invalid budget.");
    if (
      t.reserved &&
      !POOLS.every(
        (p) =>
          t.reserved[p] === undefined ||
          (money(t.reserved[p]) && t.reserved[p] >= 0),
      )
    )
      throw Error("Invalid reservation.");
    if (
      t.rates &&
      !Object.entries(t.rates).every(
        ([c, r]) =>
          ["USD", "CNY", "EUR", "JPY", "MXN", "HKD", "GBP"].includes(c) &&
          Number.isFinite(r) &&
          r > 0 &&
          r <= 1e6,
      )
    )
      throw Error("Invalid exchange rates.");
    const records = new Set();
    for (const r of [...t.transactions, ...t.adjustments]) {
      if (
        !r ||
        typeof r.id !== "string" ||
        records.has(r.id) ||
        !POOLS.includes(r.pool)
      )
        throw Error("Invalid record.");
      records.add(r.id);
      dayNumber(r.date);
    }
    for (const r of t.transactions) {
      if (
        !money(r.amount) ||
        !money(r.base) ||
        !Number.isFinite(r.rate) ||
        r.rate <= 0 ||
        r.rate > 1e6 ||
        !["USD", "CNY", "EUR", "JPY", "MXN", "HKD", "GBP"].includes(
          r.currency,
        ) ||
        typeof r.category !== "string" ||
        typeof r.note !== "string" ||
        r.note.length > 1000 ||
        r.base !== convert(r.amount, r.rate) ||
        (r.currency === t.currency && r.rate !== 1)
      )
        throw Error("Invalid transaction.");
    }
    for (const a of t.adjustments)
      if (
        !money(a.amount) ||
        typeof a.note !== "string" ||
        a.note.length > 1000
      )
        throw Error("Invalid adjustment.");
  }
  return data;
}
export function backup(trips) {
  return {
    format: "travel-tracker",
    version: 1,
    exportedAt: new Date().toISOString(),
    trips,
  };
}
export function csv(trip) {
  const cell = (v) =>
    '"' +
    String(v)
      .replaceAll('"', '""')
      .replace(/^[=+@-]/, "'$&") +
    '"';
  return [
    [
      "Date",
      "Category",
      "Pool",
      "Amount",
      "Currency",
      "Rate",
      "Base amount",
      "Base currency",
      "Note",
    ],
    ...trip.transactions.map((t) => [
      t.date,
      t.category,
      t.pool,
      (t.amount / 100).toFixed(2),
      t.currency,
      t.rate,
      (t.base / 100).toFixed(2),
      trip.currency,
      t.note,
    ]),
  ]
    .map((r) => r.map(cell).join(","))
    .join("\r\n");
}
