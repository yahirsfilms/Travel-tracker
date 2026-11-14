import {
  POOLS,
  uid,
  convert,
  dayNumber,
  dateInZone,
  validate as validateTrips,
  backup as legacyBackup,
} from "./core.js";
export const CURRENCIES = ["USD", "CNY", "EUR", "JPY", "MXN", "HKD", "GBP"];
const sum = (a) => a.reduce((s, n) => s + n, 0);
const integer = (n) => Number.isSafeInteger(n) && Math.abs(n) <= 1e11;
const rate = (n) => Number.isFinite(n) && n > 0 && n <= 1e6;
const text = (s, max = 1000) =>
  typeof s === "string" && s.trim().length > 0 && s.length <= max;
const fail = (s) => {
  throw Error(s);
};
export const poolBudget = (t, p) =>
  t.budgets[p] +
  sum(t.adjustments.filter((a) => a.pool === p).map((a) => a.amount));
export const spent = (t, p) =>
  sum(t.transactions.filter((x) => !p || x.pool === p).map((x) => x.base));
export const allocation = (t) => sum(POOLS.map((p) => poolBudget(t, p)));
export const fundValue = (t, n) => convert(n, t.fundRate);
export function bookingStatus(t, b) {
  const tx = t.transactions.filter((x) => x.bookingId === b.id),
    paid = sum(tx.filter((x) => x.base > 0).map((x) => x.base)),
    refunded = Math.max(
      0,
      -sum(tx.filter((x) => x.base < 0).map((x) => x.base)),
    );
  const net = paid - refunded,
    liability = b.cancelled ? b.fee : b.total;
  return {
    paid,
    refunded,
    net,
    liability,
    unpaid: Math.max(0, liability - net),
    pendingRefund: Math.max(0, net - liability),
  };
}
export function commitment(t, p) {
  return (
    (t.reserved?.[p] || 0) +
    sum(
      (t.bookings || [])
        .filter((b) => b.pool === p)
        .map((b) => bookingStatus(t, b).unpaid),
    )
  );
}
export function protections(t) {
  return (
    sum(
      ["hotels", "transport", "emergency"].map((p) =>
        Math.max(0, poolBudget(t, p) - spent(t, p), commitment(t, p)),
      ),
    ) + commitment(t, "daily")
  );
}
export const liveTrips = (s) => s.trips.filter((t) => t.included);
export function fundStats(s) {
  if (!s.fund?.initialized)
    return {
      actual: 0,
      receipts: 0,
      paid: 0,
      unallocated: 0,
      protected: 0,
      shortfall: 0,
    };
  const trips = liveTrips(s),
    receipts = sum(s.fund.ledger.map((x) => x.amount)),
    paid = sum(
      trips.map((t) => sum(t.transactions.map((x) => fundValue(t, x.base)))),
    ),
    actual = receipts - paid;
  const protectedTotal = sum(
    trips.map((t) =>
      Math.max(
        0,
        fundValue(t, allocation(t)) -
          sum(t.transactions.map((x) => fundValue(t, x.base))),
        fundValue(t, protections(t)),
      ),
    ),
  );
  return {
    actual,
    receipts,
    paid,
    protected: protectedTotal,
    unallocated: actual - protectedTotal,
    shortfall: Math.max(0, protectedTotal - actual),
  };
}
export function safeSummary(s, t, date) {
  const start = dayNumber(t.start),
    end = dayNumber(t.end),
    now = dayNumber(date),
    day = Math.max(start, Math.min(now, end)),
    days = now > end ? 0 : end - day + 1;
  const paidToday = sum(
    t.transactions
      .filter((x) => x.pool === "daily" && dayNumber(x.date) === day)
      .map((x) => x.base),
  );
  if (!s.fund?.initialized || !t.included)
    return {
      days,
      allowance: 0,
      remaining: 0,
      safeToday: 0,
      tomorrow: null,
      available: 0,
      shortfall: 0,
      original: t.originalTarget,
      status:
        now < start ? "Upcoming" : now > end ? "Completed" : "In progress",
      spent: paidToday,
      needsSetup: true,
    };
  const own = allocation(t) - spent(t) - protections(t);
  const others = sum(
    liveTrips(s)
      .filter((x) => x.id !== t.id)
      .map((x) =>
        Math.max(
          0,
          fundValue(x, allocation(x)) -
            sum(x.transactions.map((r) => fundValue(x, r.base))),
          fundValue(x, protections(x)),
        ),
      ),
  );
  const globalFund =
    fundStats(s).actual - others - fundValue(t, protections(t));
  // Convert down so currency rounding can never make a cent of extra money available.
  let global = Math.floor(globalFund / t.fundRate);
  while (fundValue(t, global) > globalFund) global--;
  const raw = Math.min(own, global),
    available = Math.max(0, raw);
  const allowance = days
    ? Math.max(0, Math.floor((raw + paidToday) / days))
    : 0;
  const remaining = days ? Math.min(available, allowance - paidToday) : 0;
  return {
    days,
    allowance,
    remaining,
    safeToday: Math.max(0, remaining),
    tomorrow: days > 1 ? Math.floor(available / (days - 1)) : null,
    available,
    shortfall: Math.max(0, -raw),
    original: t.originalTarget,
    status: now < start ? "Upcoming" : now > end ? "Completed" : "In progress",
    spent: paidToday,
    needsSetup: false,
  };
}
export function migrateState(input) {
  if (input.schemaVersion !== undefined && input.schemaVersion !== 2)
    fail(
      "Unsupported notebook version. Export and preserve the original records.",
    );
  if (input.schemaVersion === 2) {
    validateState(input);
    return {
      ...structuredClone(input),
      referenceFunds: structuredClone(input.referenceFunds || []),
    };
  }
  validateTrips(legacyBackup(input.trips));
  const s = structuredClone(input);
  s.schemaVersion = 2;
  s.fund = {
    currency: s.trips[0]?.currency || "USD",
    initialized: false,
    ledger: [],
  };
  const seen = new Set();
  s.referenceFunds = [];
  s.trips = s.trips.map((t) => {
    const duplicate = t.transactions.some((x) => seen.has(x.id));
    t.transactions.forEach((x) => seen.add(x.id));
    return {
      ...t,
      included: !duplicate,
      fundRate: t.currency === s.fund.currency ? 1 : null,
      originalTarget: Math.floor(
        t.budgets.daily / (dayNumber(t.end) - dayNumber(t.start) + 1),
      ),
      bookings: [],
      changes: [],
    };
  });
  return s;
}
export function initializeFund(s, available, currency, settings, date) {
  if (s.fund.initialized)
    fail("The fund is already set up. Use reconciliation.");
  if (!integer(available) || available < 0 || !CURRENCIES.includes(currency))
    fail("Enter valid currently available funds.");
  dayNumber(date);
  for (const t of s.trips) {
    const setting = settings[t.id];
    t.included = setting?.included ?? true;
    t.fundRate = t.currency === currency ? 1 : setting?.rate;
    if (t.included && !rate(t.fundRate))
      fail("Enter a conversion rate for every included trip.");
  }
  const historical = sum(
    liveTrips(s).map((t) =>
      sum(t.transactions.map((x) => fundValue(t, x.base))),
    ),
  );
  s.fund = {
    currency,
    initialized: true,
    ledger: [
      {
        id: uid(),
        date,
        type: "opening",
        amount: available + historical,
        note: "Opening basis: counted available money plus existing recorded net expenses.",
        observed: available,
        historical,
      },
    ],
  };
  validateState(s);
}
export function recordFunds(
  s,
  { amount, date, note, type = "deposit", observed },
) {
  if (!s.fund.initialized) fail("Set up the shared fund first.");
  if (!integer(amount) || !text(note)) fail("Enter an amount and a reason.");
  dayNumber(date);
  if (
    !["deposit", "withdrawal", "reconciliation"].includes(type) ||
    (type === "deposit" && amount < 0) ||
    (type === "withdrawal" && amount > 0)
  )
    fail("Invalid cash change type or sign.");
  const before = fundStats(s).actual;
  if (
    type === "reconciliation" &&
    (!integer(observed) || amount !== observed - before)
  )
    fail("The fund changed. Compare balances again.");
  s.fund.ledger.push({
    id: uid(),
    amount,
    date,
    note,
    type,
    ...(type === "reconciliation" ? { observed, before } : {}),
  });
  validateState(s);
}
export function adjustBudget(s, t, p, delta, date, note) {
  if (!t.included) fail("Reference copies cannot affect live funds.");
  if (
    !POOLS.includes(p) ||
    !integer(delta) ||
    !text(note) ||
    poolBudget(t, p) + delta < 0
  )
    fail("Budget must stay nonnegative.");
  const free = fundStats(s).unallocated,
    old = fundValue(t, allocation(t)),
    increase = fundValue(t, allocation(t) + delta) - old;
  if (delta > 0 && increase > Math.max(0, free))
    fail(
      "Not enough unallocated actual money. Transfer a budget or record a real deposit first.",
    );
  t.adjustments.push({ id: uid(), pool: p, amount: delta, date, note });
}
export function transferBudget(
  s,
  from,
  to,
  fromPool,
  toPool,
  amount,
  date,
  note,
) {
  if (
    !from.included ||
    !to.included ||
    !integer(amount) ||
    amount <= 0 ||
    !text(note)
  )
    fail("Choose live trips and a positive transfer amount.");
  if (from.id === to.id && fromPool === toPool)
    fail("Choose different pools or trips.");
  if (
    !POOLS.includes(fromPool) ||
    !POOLS.includes(toPool) ||
    poolBudget(from, fromPool) < amount
  )
    fail("The source budget is too small.");
  const before = structuredClone(s),
    actualBefore = fundStats(s).actual;
  try {
    const oldFrom = fundValue(from, allocation(from));
    from.adjustments.push({
      id: uid(),
      pool: fromPool,
      amount: -amount,
      date,
      note: "Transfer out: " + note,
    });
    const removed = oldFrom - fundValue(from, allocation(from)),
      oldTo = fundValue(to, allocation(to));
    let added =
      from.currency === to.currency && from.fundRate === to.fundRate
        ? amount
        : Math.floor(removed / to.fundRate);
    while (fundValue(to, allocation(to) + added) - oldTo > removed) added--;
    if (added <= 0) fail("Transfer is too small after currency rounding.");
    const increase = fundValue(to, allocation(to) + added) - oldTo;
    if (from.id !== to.id && increase > Math.max(0, fundStats(s).unallocated))
      fail("Those funds are already spent or committed.");
    to.adjustments.push({
      id: uid(),
      pool: toPool,
      amount: added,
      date,
      note: "Transfer in: " + note,
    });
    if (fundStats(s).actual !== actualBefore)
      fail("A transfer must not change actual money.");
    validateState(s);
    return added;
  } catch (e) {
    Object.keys(s).forEach((k) => delete s[k]);
    Object.assign(s, before);
    throw e;
  }
}
export function addBooking(
  t,
  { name, pool, total, date, replaceHold = false },
) {
  if (
    !text(name, 100) ||
    !["daily", "hotels", "transport"].includes(pool) ||
    !integer(total) ||
    total < 0
  )
    fail("Enter a valid booking.");
  dayNumber(date);
  const b = {
    id: uid(),
    name,
    pool,
    total,
    cancelled: false,
    fee: 0,
    changes: [
      { id: uid(), date, type: "created", total, note: "Reservation created" },
    ],
  };
  if (replaceHold) {
    const before = t.reserved?.[pool] || 0;
    t.reserved = { ...t.reserved, [pool]: Math.max(0, before - total) };
    t.changes.push({
      id: uid(),
      date,
      type: "unlinked hold replaced",
      pool,
      before,
      after: t.reserved[pool],
      bookingId: b.id,
    });
  }
  t.bookings.push(b);
  return b;
}
export function reviseBooking(t, b, { total, cancelled, fee = 0, date, note }) {
  if (
    !integer(total) ||
    total < 0 ||
    !integer(fee) ||
    fee < 0 ||
    fee > total ||
    !text(note)
  )
    fail("Enter a valid final cost and reason.");
  dayNumber(date);
  if (b.cancelled && !cancelled)
    fail("Create a new booking to rebook a cancelled reservation.");
  if (cancelled && !b.cancelled && b.pool !== "daily") {
    const release = Math.min(
      Math.max(0, poolBudget(t, b.pool) - fee),
      Math.max(0, b.total - fee),
    );
    if (release > 0) {
      const reason = "Cancellation planning release: " + b.name;
      t.adjustments.push(
        { id: uid(), pool: b.pool, amount: -release, date, note: reason },
        { id: uid(), pool: "daily", amount: release, date, note: reason },
      );
    }
  }
  b.changes.push({
    id: uid(),
    date,
    type: cancelled ? "cancelled" : "revised",
    before: { total: b.total, cancelled: b.cancelled, fee: b.fee },
    total,
    fee,
    note,
  });
  b.total = total;
  b.cancelled = cancelled;
  b.fee = cancelled ? fee : 0;
}
export function bookingTransaction(
  t,
  b,
  {
    amount,
    date,
    refund = false,
    note = "",
    asOf = dateInZone(t.zone),
    currency = t.currency,
    rate: fx = 1,
  },
) {
  if (!integer(amount) || amount <= 0) fail("Enter a positive payment amount.");
  dayNumber(date);
  if (date > asOf)
    fail(
      "Only record money already paid or received. Future amounts belong in commitments.",
    );
  if (
    !CURRENCIES.includes(currency) ||
    !rate(fx) ||
    (currency === t.currency && fx !== 1)
  )
    fail("Enter a valid payment currency and conversion rate.");
  const value = convert(amount, fx);
  if (value <= 0) fail("Payment rounds to zero in the planning currency.");
  const status = bookingStatus(t, b),
    maximum = refund ? status.pendingRefund : status.unpaid;
  if (value > maximum)
    fail(
      refund
        ? "Refund exceeds the amount due back."
        : "Payment exceeds the unpaid bill. Update the booking cost first.",
    );
  const base = refund ? -value : value;
  t.transactions.push({
    id: uid(),
    date,
    amount: refund ? -amount : amount,
    base,
    currency,
    rate: fx,
    pool: b.pool,
    category:
      b.pool === "hotels"
        ? "Hotel"
        : b.pool === "transport"
          ? "Transportation"
          : "Other",
    note:
      (refund ? "Received refund: " : "Booking payment: ") +
      b.name +
      (note ? " · " + note : ""),
    bookingId: b.id,
  });
}
export function linkBookingRecord(t, b, transactionId, date, note) {
  const x = t.transactions.find((x) => x.id === transactionId);
  if (!x || x.bookingId || x.pool !== b.pool || !text(note))
    fail("Choose an unlinked record from this booking’s pool.");
  dayNumber(date);
  const st = bookingStatus(t, b);
  if (st.net + x.base < 0) fail("Link the original payment before its refund.");
  t.changes.push({
    id: uid(),
    date,
    type: "existing record linked",
    transactionId: x.id,
    bookingId: b.id,
    note,
  });
  x.bookingId = b.id;
}

export function validateState(s) {
  if (
    s.schemaVersion !== 2 ||
    !s.fund ||
    !CURRENCIES.includes(s.fund.currency) ||
    typeof s.fund.initialized !== "boolean" ||
    !Array.isArray(s.fund.ledger)
  )
    fail("Invalid shared fund.");
  validateTrips(legacyBackup(s.trips));
  const ledgerIds = new Set();
  for (const e of s.fund.ledger) {
    if (
      !text(e.id) ||
      ledgerIds.has(e.id) ||
      !integer(e.amount) ||
      !text(e.note) ||
      !["opening", "deposit", "withdrawal", "reconciliation"].includes(e.type)
    )
      fail("Invalid fund record.");
    dayNumber(e.date);
    ledgerIds.add(e.id);
    if (
      e.type === "reconciliation" &&
      (!integer(e.before) ||
        !integer(e.observed) ||
        e.amount !== e.observed - e.before)
    )
      fail("Invalid reconciliation.");
  }
  for (const t of s.trips) {
    if (
      typeof t.included !== "boolean" ||
      (t.included && s.fund.initialized && !rate(t.fundRate)) ||
      (t.currency === s.fund.currency && t.fundRate !== 1) ||
      !integer(t.originalTarget) ||
      t.originalTarget < 0 ||
      !Array.isArray(t.bookings) ||
      !Array.isArray(t.changes) ||
      !POOLS.every((p) => integer(poolBudget(t, p)) && poolBudget(t, p) >= 0)
    )
      fail("Invalid trip accounting.");
    const ids = new Set();
    for (const b of t.bookings) {
      if (
        !text(b.id) ||
        ids.has(b.id) ||
        !text(b.name, 100) ||
        !["daily", "hotels", "transport"].includes(b.pool) ||
        !integer(b.total) ||
        b.total < 0 ||
        !integer(b.fee) ||
        b.fee < 0 ||
        b.fee > b.total ||
        typeof b.cancelled !== "boolean" ||
        !Array.isArray(b.changes)
      )
        fail("Invalid booking.");
      ids.add(b.id);
      for (const e of b.changes) dayNumber(e.date);
      const st = bookingStatus(t, b);
      if (st.refunded > st.paid)
        fail("Booking refunds exceed recorded payments.");
    }
    for (const x of t.transactions)
      if (
        x.bookingId &&
        (!ids.has(x.bookingId) ||
          t.bookings.find((b) => b.id === x.bookingId).pool !== x.pool)
      )
        fail("Payment has no matching booking.");
  }
  if (!s.fund.initialized && s.fund.ledger.length)
    fail("Uninitialized fund contains money.");
  if (
    s.fund.initialized &&
    s.fund.ledger.filter((e) => e.type === "opening").length !== 1
  )
    fail("Expected one opening fund record.");
  if (s.referenceFunds !== undefined) {
    if (!Array.isArray(s.referenceFunds) || s.referenceFunds.length > 1000)
      fail("Invalid reference fund archives.");
    const ids = new Set();
    for (const a of s.referenceFunds) {
      if (!text(a.id) || ids.has(a.id) || !integer(a.actual))
        fail("Invalid reference fund history.");
      ids.add(a.id);
      validateState({
        schemaVersion: 2,
        fund: a.fund,
        trips: [],
        referenceFunds: [],
      });
    }
    for (const t of s.trips)
      if (t.archiveId && !ids.has(t.archiveId))
        fail("Missing reference fund history.");
  }
  const stats = fundStats(s);
  if (
    ![
      stats.actual,
      stats.receipts,
      stats.paid,
      stats.protected,
      stats.unallocated,
    ].every(integer)
  )
    fail("Totals exceed the supported money range.");
  return s;
}
export function makeBackup(s) {
  validateState(s);
  return {
    format: "travel-tracker",
    version: 2,
    exportedAt: new Date().toISOString(),
    schemaVersion: 2,
    fund: structuredClone(s.fund),
    trips: structuredClone(s.trips),
    referenceFunds: structuredClone(s.referenceFunds || []),
  };
}
export function parseBackup(data) {
  if (data?.format !== "travel-tracker" || ![1, 2].includes(data.version))
    fail("Unsupported backup.");
  if (data.version === 1) {
    validateTrips(data);
    return migrateState({
      trips: data.trips,
      active: data.trips[0]?.id || null,
      revision: 0,
    });
  }
  return validateState({
    fund: structuredClone(data.fund),
    referenceFunds: structuredClone(data.referenceFunds || []),
    trips: structuredClone(data.trips),
    schemaVersion: 2,
    revision: 0,
    active: data.trips[0]?.id || null,
  });
}
export function restoreBackup(s, data, mode = "copies") {
  const restored = parseBackup(data);
  if (mode === "full") {
    if (s.trips.length || s.fund.initialized)
      fail(
        "Full recovery requires an empty notebook. Import references to preserve current records.",
      );
    return { ...s, ...restored, revision: s.revision, backupNeeded: true };
  }
  s.referenceFunds ??= [];
  const map = new Map();
  for (const archive of restored.referenceFunds || []) {
    const id = uid();
    map.set(archive.id, id);
    s.referenceFunds.push({ ...structuredClone(archive), id });
  }
  const archiveId = uid();
  s.referenceFunds.push({
    id: archiveId,
    fund: structuredClone(restored.fund),
    actual: fundStats(restored).actual,
  });
  for (const original of restored.trips) {
    const t = structuredClone(original);
    t.id = uid();
    t.name = t.name.slice(0, 85) + " (reference)";
    t.sourceIncluded = original.included;
    t.archiveId = map.get(original.archiveId) || archiveId;
    t.included = false;
    t.sourceId = original.sourceId || original.id;
    if (t.currency === s.fund.currency) t.fundRate = 1;
    s.trips.push(t);
  }
  s.backupNeeded = true;
  validateState(s);
  return s;
}

// Corrections retain the earlier record in the audit history; they are not cash receipts.
export function correctBookingTransaction(t, b, id, { amount, currency, rate: fx, date, note, asOf = dateInZone(t.zone) }) {
  const index = t.transactions.findIndex(x => x.id === id && x.bookingId === b.id);
  if (index < 0 || !text(note) || !integer(amount) || amount <= 0 || !CURRENCIES.includes(currency) || !rate(fx) || (currency === t.currency && fx !== 1)) fail("Enter a valid correction and reason.");
  dayNumber(date);
  if (date > asOf) fail("A correction cannot record a future payment.");
  const before = structuredClone(t.transactions[index]), previous = bookingStatus(t, b);
  const base = convert(amount, fx) * Math.sign(before.base);
  if (!base) fail("The correction rounds to zero.");
  const after = { ...before, date, currency, rate: fx, amount: amount * Math.sign(before.amount), base, note: before.note };
  t.transactions[index] = after;
  const st = bookingStatus(t, b);
  if (st.refunded > st.paid || st.net > Math.max(previous.net, st.liability)) {
    t.transactions[index] = before;
    fail("Correction exceeds the bill or leaves refunds above payments. Review related records first.");
  }
  t.changes.push({ id: uid(), date: asOf, type: "booking payment corrected", bookingId: b.id, note, before, after: structuredClone(after) });
}

export function saveExpense(t, record, oldId, asOf = dateInZone(t.zone)) {
  if (!t.included) fail("Reference copies are read-only.");
  dayNumber(record.date);
  if (record.date > asOf || !integer(record.amount) || !record.amount || !record.base || record.base !== convert(record.amount, record.rate)) fail("Enter a nonzero payment already paid or received.");
  const old = t.transactions.find(x => x.id === oldId);
  if (old?.bookingId) fail("Correct linked payments from their booking.");
  if (record.base < 0) {
    const original = t.transactions.find(x => x.id === record.refundOf && x.base > 0 && !x.bookingId);
    // Existing unmatched refunds remain editable; new unmatched credits need explicit acknowledgment.
    if (!original && !record.unmatchedCredit && !(old?.base < 0 && !old.refundOf)) fail("Choose the original expense, or confirm an unmatched received credit.");
    if (original) {
      if (record.pool !== original.pool) fail("Refunds must return to the original budget.");
      const already = -sum(t.transactions.filter(x => x.refundOf === original.id && x.id !== oldId).map(x => x.base));
      if (-record.base + already > original.base) fail("Refund exceeds the original expense remaining to be refunded.");
    }
  }
  const refunds = old ? -sum(t.transactions.filter(x => x.refundOf === oldId).map(x => x.base)) : 0;
  if (refunds && (record.base < refunds || record.pool !== old.pool || record.base <= 0)) fail("Correct the linked refunds before reducing or moving this expense.");
  if (old) {
    t.changes.push({ id: uid(), date: asOf, type: "expense edit", before: structuredClone(old), after: structuredClone(record) });
    t.transactions[t.transactions.indexOf(old)] = record;
  } else t.transactions.push(record);
}
