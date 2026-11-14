import {
  POOLS,
  uid,
  cents,
  convert,
  dayNumber,
  dateInZone,
  balance,
  backup,
  csv,
} from "./core.js";
import { read, write, readLegacyRecovery } from "./db.js";
import {
  migrateState,
  validateState,
  fundStats,
  safeSummary,
  poolBudget,
  allocation,
  spent,
  commitment,
  bookingStatus,
  initializeFund,
  recordFunds,
  adjustBudget,
  transferBudget,
  addBooking,
  reviseBooking,
  bookingTransaction,
  linkBookingRecord,
  makeBackup,
  parseBackup,
  restoreBackup,
  correctBookingTransaction,
  saveExpense,
} from "./accounting.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const currencies = ["USD", "CNY", "EUR", "JPY", "MXN", "HKD", "GBP"],
  names = {
    daily: "Daily spending",
    hotels: "Hotels",
    transport: "Transportation",
    emergency: "Emergency",
  },
  icons = { daily: "◉", hotels: "⌂", transport: "↗", emergency: "✚" };
const poolIcon = (p) =>
  `<svg class="pool-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${{ daily: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v10M15 9c-4-3-7 3-2 3s2 6-3 3", hotels: "M4 21V8l8-5 8 5v13M9 21v-6h6v6M8 9h1M15 9h1", transport: "M5 17 19 3M9 3h10v10M5 8H3v13h13v-2", emergency: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z" }[p]}"/></svg>`;
let deleted = null,
  reloadPending = false;
$("#dialog").addEventListener("close", () => {
  if (reloadPending) location.reload();
});
let state,
  tab = "today",
  readyOffline = false,
  query = "",
  filter = "",
  pending = null,
  busy = false;
let bootComplete = false;
const trip = () => state?.trips.find((t) => t.id === state.active),
  money = (n, c = trip()?.currency || "USD") =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: c,
      minimumFractionDigits: 2,
    }).format(n / 100),
  today = () =>
    dateInZone(
      trip()?.zone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").style.display = "block";
  setTimeout(() => ($("#toast").style.display = "none"), 5000);
}
function modal(html) {
  $("#dialog-content").innerHTML = html;
  $("#dialog").showModal();
}
const close = () => $("#dialog").close();
function options(list, value) {
  return list
    .map(
      (x) =>
        `<option value="${esc(x)}" ${x === value ? "selected" : ""}>${esc(names[x] || x)}</option>`,
    )
    .join("");
}
function dateField(id, label, value) {
  return `<label for="${id}">${label}</label><input id="${id}" name="${id}" type="date" required value="${esc(value)}">`;
}
function field(id, label, value = "", type = "text", extra = "") {
  return `<label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${extra}>`;
}
function footer(label = "Save") {
  return `<div class="actions"><button type="button" class="quiet" data-action="close">Cancel</button><button type="submit">${label}</button></div>`;
}
async function commit(next) {
  validateState(next);
  state = await write(next, state.revision);
  render();
}
async function change(fn) {
  const next = structuredClone(state);
  fn(next);
  if (
    JSON.stringify([next.trips, next.fund]) !==
    JSON.stringify([state.trips, state.fund])
  )
    next.backupNeeded = true;
  await commit(next);
}
function status() {
  const el = $("#status");
  el.textContent = `${navigator.onLine ? "● Online" : "● Offline"} · ${readyOffline ? "Ready offline" : "Offline setup pending"} · Saved on this device`;
  if (pending) {
    const b = document.createElement("button");
    b.className = "link";
    b.textContent = "Update ready";
    b.onclick = () => {
      if ($("#dialog").open) return toast("Finish editing before updating.");
      pending.postMessage("ACTIVATE");
    };
    el.append(b);
  }
}
function entries(list) {
  return list.length
    ? list
        .map(
          (t) =>
            `<div class="entry"><div class="icon">${poolIcon(t.pool)}</div><div class="details"><strong>${esc(t.category)}</strong><small>${esc(t.date)} · ${esc(names[t.pool])}${t.note ? " · " + esc(t.note) : ""}</small></div><button data-action="edit" data-id="${esc(t.id)}" aria-label="Edit ${esc(t.category)} expense">${money(t.base)}${t.currency !== trip().currency ? `<small>${money(t.amount, t.currency)}</small>` : ""}</button></div>`,
        )
        .join("")
    : `<p class="small">No expenses here yet. Your next adventure starts with one.</p>`;
}
function fundCard() {
  const f = fundStats(state),
    c = state.fund.currency;
  if (!state.fund.initialized)
    return `<div class="card fund-card"><div><strong>Your shared travel fund</strong><p class="small">Enter actual available money. Budgets alone do not establish funds.</p></div><button class="quiet" data-action="fund">Set up fund</button></div>`;
  return `<div class="card fund-card"><div><div class="eyebrow">Actual money · all live trips</div><strong class="fund-amount ${f.actual < 0 ? "negative" : ""}">${money(f.actual, c)}</strong><div class="small">${money(Math.max(0, f.unallocated), c)} unallocated${f.shortfall ? " · " + money(f.shortfall, c) + " allocation / commitment shortfall" : ""}</div></div><button class="quiet" data-action="fund">Fund & compare</button></div>`;
}
function bookingCards() {
  const t = trip();
  return `<div class="section"><div class="row"><h2>Bookings & bills</h2><button class="link" data-action="bookings">＋ Add</button></div>${
    t.bookings.length
      ? t.bookings
          .map((b) => {
            const st = bookingStatus(t, b);
            return `<button class="booking-card" data-action="booking" data-id="${esc(b.id)}"><div class="row"><strong>${esc(b.name)}</strong><span class="pill">${b.cancelled ? "Cancelled" : st.unpaid ? "Payment due" : "Paid"}</span></div><div class="small">${names[b.pool]} · ${money(st.net)} net paid · ${money(st.unpaid)} still owed${st.pendingRefund ? " · " + money(st.pendingRefund) + " refund pending" : ""}</div></button>`;
          })
          .join("")
      : '<p class="small">Track hotel or transport bills here. Partial payments reduce the unpaid commitment automatically.</p>'
  }</div>`;
}
function fundForm() {
  const f = fundStats(state),
    c = state.fund.currency;
  if (!state.fund.initialized) {
    modal(
      `<h2>One fund. Every trip.</h2><p class="small">Count what is available now, across your cash and travel accounts, in one currency. Existing paid expenses are preserved and bridged into the opening balance so they are not deducted twice.</p><form id="fund-setup"><label for="fund-currency">Fund currency</label><select id="fund-currency">${options(currencies, c)}</select>${field("fund-current", "Actual available now", "", "number", 'required min="0" step="0.01" inputmode="decimal"')}${state.trips.length ? '<h3>Existing records</h3><p class="small">Uncheck duplicate or reference trips. Included trips count toward actual money. Confirm fixed conversion rates for any older planning currencies.</p>' : ""}${state.trips.map((t, i) => `<div class="card"><label class="check-label"><input id="include-${i}" type="checkbox" ${t.included ? "checked" : ""}> Include ${esc(t.name)}</label>${field("legacy-rate-" + i, "1 " + t.currency + " in fund currency", t.currency === c ? 1 : t.fundRate || "", "number", 'min="0.000001" max="1000000" step="any" inputmode="decimal"')}</div>`).join("")}${footer("Confirm actual funds")}</form>`,
    );
    const update = () =>
      state.trips.forEach((t, i) => {
        const same = t.currency === $("#fund-currency").value;
        $("#legacy-rate-" + i).disabled = same;
        if (same) $("#legacy-rate-" + i).value = 1;
      });
    $("#fund-currency").onchange = update;
    update();
    $("#fund-setup").onsubmit = (e) => {
      e.preventDefault();
      action(async () => {
        const settings = Object.fromEntries(
          state.trips.map((t, i) => [
            t.id,
            {
              included: $("#include-" + i).checked,
              rate: Number($("#legacy-rate-" + i).value),
            },
          ]),
        );
        await change((n) =>
          initializeFund(
            n,
            cents($("#fund-current").value),
            $("#fund-currency").value,
            settings,
            today(),
          ),
        );
        close();
        toast("Actual fund established. Previous records preserved.");
      });
    };
    return;
  }
  modal(
    `<h2>Your shared fund</h2><div class="metric">${money(f.actual, c)}</div><p class="small">Actual money = opening basis + real fund changes − net recorded expenses. Pending refunds are excluded. Allocations are plans, not receipts.</p><h3>Trip allocations</h3>${state.trips
      .filter((t) => t.included)
      .map(
        (t) =>
          `<p class="small"><strong>${esc(t.name)}</strong> · ${money(allocation(t), t.currency)} allocated · ${money(allocation(t) - spent(t), t.currency)} remaining${t.currency !== c ? " · fixed " + t.fundRate + " " + c + "/" + t.currency : ""}</p>`,
      )
      .join(
        "",
      )}<form id="fund-change"><label for="fund-mode">Action</label><select id="fund-mode"><option value="reconciliation">Compare with actual money</option><option value="deposit">Record money added</option><option value="withdrawal">Record money removed</option></select>${field("fund-amount", "Counted actual balance / change amount in " + c, "", "number", 'required min="0" step="0.01" inputmode="decimal"')}<p id="fund-comparison" class="notice">Enter the balance you actually counted to see a discrepancy before recording a correction.</p>${field("fund-note", "Reason for the fund change", "", "text", 'required maxlength="1000"')}${footer("Record confirmed change")}</form><details><summary>Fund & reconciliation history</summary>${state.fund.ledger
      .slice()
      .reverse()
      .map(
        (e) =>
          `<p class="small">${esc(e.date)} · ${esc(e.type)} · ${money(e.amount, c)}<br>${esc(e.note)}${e.type === "reconciliation" ? "<br>Recorded before " + money(e.before, c) + " → counted " + money(e.observed, c) : e.type === "opening" ? "<br>Counted " + money(e.observed, c) + " + earlier net spending " + money(e.historical, c) : ""}</p>`,
      )
      .join(
        "",
      )}</details>${(state.referenceFunds || []).length ? `<details><summary>Reference fund histories · excluded from live money</summary>${state.referenceFunds.map((a) => `<div class="card"><p class="small">Archived balance at import: ${money(a.actual, a.fund.currency)}</p>${a.fund.ledger.map((e) => `<p class="small">${esc(e.date)} · ${esc(e.type)} · ${money(e.amount, a.fund.currency)}<br>${esc(e.note)}</p>`).join("")}</div>`).join("")}</details>` : ""}<button class="link" data-action="legacy-export">Export original V1 recovery, if available</button>`,
  );
  const update = () => {
    const mode = $("#fund-mode").value;
    $("#fund-comparison").textContent =
      mode === "reconciliation"
        ? "Recorded " +
          money(f.actual, c) +
          " · Counted " +
          money(cents($("#fund-amount").value || 0), c) +
          " · Difference " +
          money(cents($("#fund-amount").value || 0) - f.actual, c)
        : "Only record money that has actually entered or left your travel fund. This does not change trip allocations.";
  };
  $("#fund-amount").oninput = () => {
    try {
      update();
    } catch {}
  };
  $("#fund-mode").onchange = update;
  $("#fund-change").onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      const mode = $("#fund-mode").value,
        value = cents($("#fund-amount").value),
        note = $("#fund-note").value.trim();
      await change((n) =>
        recordFunds(n, {
          type: mode,
          date: today(),
          note,
          amount:
            mode === "reconciliation"
              ? value - f.actual
              : mode === "withdrawal"
                ? -value
                : value,
          ...(mode === "reconciliation" ? { observed: value } : {}),
        }),
      );
      close();
      toast("Fund history updated. Transactions unchanged.");
    });
  };
}
function bookingForm(id) {
  const t = trip(),
    b = t.bookings.find((x) => x.id === id);
  if (!t.included && !b) throw Error("Reference copies are read-only.");
  if (!b) {
    modal(
      `<h2>Plan a booking or bill</h2><p class="small">An unpaid commitment protects money but is not an expense. Record future daily costs, hotels, or transport. Amounts use ${esc(t.currency)}.</p><form id="booking-new">${field("booking-name", "Name", "", "text", 'required maxlength="100" placeholder="Shanghai hotel"')}<label for="booking-pool">Budget pool</label><select id="booking-pool">${options(["hotels", "transport", "daily"], "hotels")}</select>${field("booking-total", "Total agreed cost", "0", "number", 'required min="0" step="0.01" inputmode="decimal"')}${dateField("booking-date", "Due / service date", today())}<label class="check-label"><input id="replace-hold" type="checkbox"> Replace this cost from existing unlinked holds</label><p class="small">Use this only if the same bill was already entered under Other unpaid commitments.</p>${footer("Save reservation")}</form>`,
    );
    $("#booking-new").onsubmit = (e) => {
      e.preventDefault();
      action(async () => {
        await change((n) =>
          addBooking(
            n.trips.find((x) => x.id === t.id),
            {
              name: $("#booking-name").value.trim(),
              pool: $("#booking-pool").value,
              total: cents($("#booking-total").value),
              replaceHold: $("#replace-hold").checked,
              date: $("#booking-date").value,
            },
          ),
        );
        close();
        toast("Commitment saved. Actual money unchanged.");
      });
    };
    return;
  }
  const st = bookingStatus(t, b);
  modal(
    `<h2>${esc(b.name)}</h2><div class="notice">${b.cancelled ? "Cancelled · final cost " + money(b.fee) : "Agreed cost " + money(b.total)}<br>${money(st.paid)} paid · ${money(st.refunded)} refunds received<br>${money(st.unpaid)} unpaid · ${money(st.pendingRefund)} refund pending</div><p class="small">Only payments and received refunds change actual money. A cancelled booking releases its unpaid obligation; planning funds move to daily spending, but pending refunds stay unavailable.</p>${
      t.included
        ? `<form id="booking-action"><label for="booking-mode">Action</label><select id="booking-mode"><option value="pay">Record actual payment</option><option value="refund">Record refund received</option><option value="link">Link an already-recorded payment / refund</option>${b.cancelled ? '<option value="cancel">Revise final cancellation cost</option>' : '<option value="revise">Revise total agreed cost</option><option value="cancel">Cancel · enter final cancellation cost</option>'}</select><div id="booking-link" hidden><label for="link-record">Existing unlinked record · no new expense</label><select id="link-record">${t.transactions
            .filter((x) => !x.bookingId && x.pool === b.pool)
            .map(
              (x) =>
                `<option value="${esc(x.id)}">${esc(x.date)} · ${money(x.base)} · ${esc(x.note || x.category)}</option>`,
            )
            .join(
              "",
            )}</select></div>${field("booking-amount", "Amount / new total / final cancellation cost in " + t.currency, "", "number", 'required min="0" step="0.01" inputmode="decimal"')}<div id="booking-fx"><label for="booking-currency">Payment / refund currency</label><select id="booking-currency">${options(currencies, t.currency)}</select>${field("booking-rate", "1 payment currency in " + t.currency, 1, "number", 'required min="0.000001" max="1000000" step="any" inputmode="decimal"')}<p class="small" id="booking-conversion"></p></div>${dateField("booking-action-date", "Payment, refund or change date", today())}${field("booking-note", "Reason or note", "", "text", 'required maxlength="800"')}${footer("Record action")}</form>`
        : '<button data-action="close" class="quiet">Close reference</button>'
    }${t.included ? `<details><summary>Correct a payment or refund</summary><p class="small">Fix an entry mistake without claiming a new cash receipt. Earlier values remain in history.</p>${t.transactions.filter(x => x.bookingId === b.id).map(x => `<button class="link" data-action="correct-booking" data-id="${esc(x.id)}">Correct ${esc(x.date)} · ${money(x.base)}</button>`).join("")}</details>` : ""}<details><summary>Booking history</summary>${b.changes.map((e) => `<p class="small">${esc(e.date)} · ${esc(e.type)} · ${esc(e.note || "")} · total ${money(e.total)}${e.fee ? " · final cost " + money(e.fee) : ""}</p>`).join("")}${t.transactions
      .filter((x) => x.bookingId === b.id)
      .map(
        (x) =>
          `<p class="small">${esc(x.date)} · ${esc(x.note)} · ${money(x.base)}</p>`,
      )
      .join("")}</details>`,
  );
  if (t.included) {
    const fxUpdate = () => {
      const payment = ["pay", "refund"].includes($("#booking-mode").value),
        same = $("#booking-currency").value === t.currency;
      $("#booking-fx").hidden = !payment;
      const linking = $("#booking-mode").value === "link";
      $("#booking-link").hidden = !linking;
      $("#booking-amount").disabled = linking;
      $('label[for="booking-amount"]').textContent = payment
        ? "Amount in " + $("#booking-currency").value
        : $("#booking-mode").value === "revise"
          ? "New agreed total in " + t.currency
          : "Final cancellation cost in " + t.currency;
      $("#booking-rate").disabled = !payment || same;
      if (same) $("#booking-rate").value = 1;
      $("#booking-conversion").textContent =
        "Recorded planning amount: " +
        money(
          convert(
            cents($("#booking-amount").value || 0),
            Number($("#booking-rate").value) || 0,
          ),
        );
    };
    $("#booking-mode").onchange = fxUpdate;
    $("#booking-currency").onchange = () => {
      $("#booking-rate").value =
        $("#booking-currency").value === t.currency
          ? 1
          : t.rates?.[$("#booking-currency").value] || "";
      fxUpdate();
    };
    $("#booking-amount").oninput = () => {
      try {
        fxUpdate();
      } catch {}
    };
    $("#booking-rate").oninput = () => {
      try {
        fxUpdate();
      } catch {}
    };
    $("#booking-mode").value =
      st.pendingRefund > 0
        ? "refund"
        : st.unpaid > 0
          ? "pay"
          : b.cancelled
            ? "cancel"
            : "revise";
    fxUpdate();
  }
  if (t.included)
    $("#booking-action").onsubmit = (e) => {
      e.preventDefault();
      action(async () => {
        const mode = $("#booking-mode").value,
          amount = cents($("#booking-amount").value),
          date = $("#booking-action-date").value,
          note = $("#booking-note").value.trim();
        if (!note) throw Error("Enter a reason.");
        await change((n) => {
          const tr = n.trips.find((x) => x.id === t.id),
            bk = tr.bookings.find((x) => x.id === b.id);
          if (mode === "link")
            linkBookingRecord(tr, bk, $("#link-record").value, date, note);
          else if (mode === "pay" || mode === "refund")
            bookingTransaction(tr, bk, {
              amount,
              date,
              note,
              refund: mode === "refund",
              currency: $("#booking-currency").value,
              rate: Number($("#booking-rate").value),
              asOf: today(),
            });
          else
            reviseBooking(tr, bk, {
              total: mode === "revise" ? amount : bk.total,
              fee: mode === "cancel" ? amount : 0,
              cancelled: mode === "cancel",
              date,
              note,
            });
        });
        close();
        toast("Booking updated. Linked history preserved.");
      });
    };
}

function render() {
  status();
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const t = trip();
  $("#trip-picker").textContent = t ? "Trips ▾" : "Trips +";
  if (!t) {
    $("#main").innerHTML =
      fundCard() +
      `<div class="empty"><div class="eyebrow">A little planning. More exploring.</div><h1>Your next trip,<br>within reach.</h1><p>Start with your shared travel fund, then allocate money to China, Japan, or your next destination.</p><button data-action="new-trip">Plan a trip</button><button class="link" data-action="import">Restore a backup</button></div>`;
    return;
  }
  const date = today(),
    s = safeSummary(state, t, date);
  if (tab === "today") {
    $("#main").innerHTML =
      `${fundCard()}<div class="row"><div class="eyebrow">${esc(t.name)}</div><span class="pill">${s.status}</span></div><h1>${s.status === "Completed" ? "A trip to remember." : s.status === "Upcoming" ? "Adventure ahead." : "Enjoy the journey."}</h1><p class="sub">${esc(date)} · ${s.status === "Completed" ? "Trip summary" : s.days + " days " + (s.status === "Upcoming" ? "in your trip" : "including today")}</p><div class="hero"><div class="eyebrow">${s.status === "Completed" ? "Trip complete" : s.status === "Upcoming" ? "First-day safe allowance" : "Safe to spend today"}</div><div class="amount ${s.remaining < 0 ? "negative" : ""}">${money(s.safeToday)}</div><div class="row"><div><div class="small" style="color:#c0d3c4">Adjusted allowance</div><strong>${money(s.allowance)}</strong></div><div><div class="small" style="color:#c0d3c4">Spent ${s.status === "Upcoming" ? "on first day" : "today"}</div><strong>${money(s.spent)}</strong></div></div><p class="hero-note">Original target ${money(s.original)} / day · ${s.remaining < 0 ? money(-s.remaining) + " over today’s allowance" : ""}</p></div><div class="row small"><span>${s.needsSetup ? "Projection unavailable" : s.tomorrow === null ? "No remaining travel days to redistribute" : s.status === "Upcoming" ? "Next travel day’s projection" : "Next day’s projected allowance"}</span><strong>${s.tomorrow === null ? "" : money(s.tomorrow)}</strong></div>${s.needsSetup ? `<div class="notice">${t.included ? "Set up your actual travel fund to calculate safe spending." : "Reference copy: records are preserved but excluded from live money."}</div>` : ""}${s.shortfall ? `<div class="notice negative">Funding shortfall: ${money(s.shortfall)}. No extra money has been assumed.</div>` : ""}<button class="primary" data-action="expense">＋ Add expense</button><div class="row"><h2>Your other budgets</h2><button class="link" data-tab="trip">View all →</button></div><div class="grid">${["hotels", "transport", "emergency"].map((p) => `<div class="card"><div class="small">${poolIcon(p)} ${names[p]}</div><div class="metric ${balance(t, p) < 0 ? "negative" : ""}">${money(balance(t, p))}</div><div class="small">budget left${commitment(t, p) ? " · " + money(commitment(t, p)) + " owed" : ""}</div></div>`).join("")}</div><div class="section"><h2>Recent expenses</h2>${entries([...t.transactions].reverse().slice(0, 4))}</div>`;
  } else if (tab === "history") {
    $("#main").innerHTML =
      `<div class="eyebrow">${esc(t.name)}</div><div class="row"><h1>Your travel trail.</h1><button data-action="expense">＋ Add</button></div><p class="sub">Every little stop, all in one place.</p><div class="toolbar"><input id="search" aria-label="Search expenses" placeholder="Search expenses" value="${esc(query)}"><select id="pool-filter" aria-label="Filter budget pool"><option value="">All budgets</option>${options(POOLS, filter)}</select></div><div id="entries"></div>`;
    renderEntries();
  } else {
    $("#main").innerHTML =
      `${fundCard()}<div class="eyebrow">Trip overview</div><h1>${esc(t.name)}</h1><p class="sub">${esc(t.start)} → ${esc(t.end)} · ${esc(t.currency)}<br>${esc(t.zone)}</p><div class="row"><h2>Budget, your way.</h2><button class="quiet" data-action="adjust">Adjust budget</button></div><div class="notice">Plans are separate from actual money. Safe daily spending protects other trips, emergency funds, and unpaid commitments.</div>${POOLS.map(
        (p) => {
          const b = balance(t, p),
            total =
              t.budgets[p] +
              t.adjustments
                .filter((a) => a.pool === p)
                .reduce((s, a) => s + a.amount, 0);
          return `<div class="card"><div class="row"><strong>${names[p]}</strong><strong class="${b < 0 ? "negative" : ""}">${money(b)}</strong></div><div class="progress"><span style="width:${Math.max(0, Math.min(100, total > 0 ? ((total - b) / total) * 100 : 0))}%"></span></div><div class="small" style="margin-top:9px">${money(total - b)} spent of ${money(total)} · ${money(commitment(t, p))} committed, unpaid</div>${commitment(t, p) ? `<div class="small">After commitments: ${money(b - commitment(t, p))}</div>` : ""}</div>`;
        },
      ).join(
        "",
      )}<div class="actions"><button class="quiet" data-action="settings">Trip settings</button><button class="quiet" data-action="bookings">Bookings & bills</button></div>${bookingCards()}<button class="link" data-action="reserve">Other unpaid commitments</button><div class="section"><h2>Budget adjustment history</h2>${
        t.adjustments.length
          ? t.adjustments
              .slice()
              .reverse()
              .map(
                (a) =>
                  `<p class="adjustments">${esc(a.date)} · ${names[a.pool]} · ${money(a.amount)}<br>${esc(a.note)}</p>`,
              )
              .join("")
          : '<p class="small">Changes made during your trip will appear here.</p>'
      }</div><details class="card activity"><summary>Record and date changes</summary>${
        t.changes.length
          ? t.changes
              .slice()
              .reverse()
              .map(
                (e) =>
                  `<p class="small">${esc(e.date)} · ${esc(e.type)}${e.note ? "<br>" + esc(e.note) : ""}${e.type === "dates/settings" ? "<br>" + esc(e.before.start) + " → " + esc(e.before.end) + " changed to " + esc(e.after.start) + " → " + esc(e.after.end) : e.before?.base !== undefined ? "<br>Earlier: " + money(e.before.base) + " · " + esc(e.before.note || e.before.category) + (e.after ? "<br>Revised: " + money(e.after.base) + " · " + esc(e.after.note || e.after.category) : "") : ""}</p>`,
              )
              .join("")
          : '<p class="small">No expense or date corrections recorded.</p>'
      }</details><div class="card backup"><h2>A copy for safekeeping.</h2><p class="small">Backups include all trips. Save the JSON file to Files on your iPhone. CSV is for spreadsheets and cannot restore the app.</p><p class="small">Last export prepared: ${state.lastBackup ? esc(new Date(state.lastBackup).toLocaleString()) : "No backup yet"}</p>${state.backupNeeded || !state.lastBackup ? '<div class="notice">Keep a fresh backup: you have records that need an export.</div>' : ""}<div class="stack"><button data-action="export">Export all trips · JSON</button><button class="quiet" data-action="import">Restore backup</button><button class="quiet" data-action="csv">Export this trip · CSV</button></div></div><p class="small">Private by design. No financial records are sent to a server. Clearing website data can remove records. Keep a backup outside the app.</p>`;
  }
}
function renderEntries() {
  const list = trip()
    .transactions.filter(
      (t) =>
        (!filter || t.pool === filter) &&
        `${t.note} ${t.category} ${t.date}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  $("#entries").innerHTML = entries(list);
}
function tripForm(edit = false) {
  if (edit && !trip().included)
    throw Error("Reference settings are read-only.");
  if (!edit && !state.fund.initialized) {
    fundForm();
    return;
  }
  const t = edit ? trip() : null;
  const d = new Date().toISOString().slice(0, 10);
  modal(
    `<h2>${edit ? "Trip settings" : "Where to next?"}</h2><form id="trip-form">${field("name", "Trip name", t?.name || "", "text", 'required maxlength="100" placeholder="China summer trip"')}<div class="grid"><div>${dateField("start", "First day", t?.start || d)}</div><div>${dateField("end", "Last day", t?.end || d)}</div></div><label for="currency">Planning currency</label><select id="currency" ${edit ? "disabled" : ""}>${options(edit ? currencies : [state.fund.currency], t?.currency || state.fund.currency)}</select>${field("zone", "Trip time zone", t?.zone || "Asia/Shanghai", "text", 'required placeholder="Asia/Shanghai"')}<p class="small">Use an IANA time zone, such as Asia/Shanghai or America/Los_Angeles.${edit ? " Planning currency is fixed to preserve recorded conversions." : ""}</p>${edit ? "" : `<div class="grid">${POOLS.map((p) => `<div>${field(p, names[p] + " budget", "0", "number", 'required min="0" step="0.01" inputmode="decimal"')}</div>`).join("")}</div>`}${footer(edit ? "Save settings" : "Create trip")}</form>`,
  );
  $("#trip-form").onsubmit = async (e) => {
    e.preventDefault();
    await action(async () => {
      const name = $("#name").value.trim(),
        start = $("#start").value,
        end = $("#end").value,
        zone = $("#zone").value.trim();
      if (!name) throw Error("Enter a trip name.");
      new Intl.DateTimeFormat("en", { timeZone: zone });
      if (dayNumber(end) < dayNumber(start))
        throw Error("Last day must follow the first day.");

      await change((n) => {
        if (edit) {
          const tr = n.trips.find((x) => x.id === t.id);
          tr.changes.push({
            id: uid(),
            date: today(),
            type: "dates/settings",
            before: {
              name: tr.name,
              start: tr.start,
              end: tr.end,
              zone: tr.zone,
            },
            after: { name, start, end, zone },
          });
          Object.assign(
            n.trips.find((x) => x.id === t.id),
            { name, start, end, zone },
          );
        } else {
          const id = uid();
          const total = POOLS.reduce((v, p) => v + cents($("#" + p).value), 0);
          if (!n.fund.initialized)
            throw Error("Set up the actual travel fund first.");
          if (total > Math.max(0, fundStats(n).unallocated))
            throw Error("Trip budgets exceed unallocated actual money.");
          n.trips.push({
            id,
            name,
            start,
            end,
            zone,
            currency: $("#currency").value,
            budgets: Object.fromEntries(
              POOLS.map((p) => [p, cents($("#" + p).value)]),
            ),
            included: true,
            fundRate: 1,
            originalTarget: Math.floor(
              cents($("#daily").value) /
                (dayNumber(end) - dayNumber(start) + 1),
            ),
            bookings: [],
            changes: [],
            reserved: {},
            adjustments: [],
            transactions: [],
            rates: { [$("#currency").value]: 1 },
            expenseCurrency: $("#currency").value,
          });
          n.active = id;
        }
      });
      close();
      toast(edit ? "Trip updated" : "Your trip is ready");
    });
  };
}
function expenseForm(id) {
  if (!trip().included)
    throw Error(
      "Reference copies are read-only. They do not affect your shared fund.",
    );
  const linked = trip().transactions.find((x) => x.id === id);
  if (linked?.bookingId) {
    bookingForm(linked.bookingId);
    return;
  }
  const t = trip(),
    old = t.transactions.find((x) => x.id === id),
    defDate = today();
  modal(
    `<h2>${old ? "Edit expense" : "A little stop along the way."}</h2><form id="expense-form"><div class="grid"><div>${field("amount", "Amount", old ? Math.abs(old.amount) / 100 : "", "number", 'required min="0.01" step="0.01" inputmode="decimal" autofocus')}</div><div><label for="expense-currency">Currency</label><select id="expense-currency">${options(currencies, old?.currency || t.expenseCurrency || t.currency)}</select></div></div><label for="kind">Record type</label><select id="kind"><option value="expense">Expense</option><option value="refund" ${old?.amount < 0 ? "selected" : ""}>Refund · returns money to this pool</option></select><div class="grid"><div><label for="category">Category</label><select id="category">${options(["Food & drink", "Activities", "Shopping", "Hotel", "Transportation", "Emergency", "Other"], old?.category || "Food & drink")}</select></div><div><label for="pool">Budget pool</label><select id="pool">${options(POOLS, old?.pool || "daily")}</select></div></div><div id="booking-suggestion" hidden><label for="expense-booking">Pay an existing booking?</label><select id="expense-booking"><option value="">Separate purchase · not a booking payment</option>${t.bookings.filter(b => !b.cancelled).map(b => `<option value="${esc(b.id)}" data-pool="${b.pool}">${esc(b.name)} · ${money(bookingStatus(t,b).unpaid)} unpaid</option>`).join("")}</select><p class="small">Choose the booking to reduce its unpaid balance exactly once.</p></div><div id="refund-options" hidden><label for="refund-original">Original expense</label><select id="refund-original"><option value="">Choose original expense</option>${t.transactions.filter(x => x.base > 0 && !x.bookingId && x.id !== id).map(x => `<option value="${esc(x.id)}" ${old?.refundOf === x.id ? "selected" : ""}>${esc(x.date)} · ${esc(x.category)} · ${money(x.base)}</option>`).join("")}</select><label class="check-label"><input id="unmatched-credit" type="checkbox" ${old?.unmatchedCredit ? "checked" : ""}>This is an unmatched credit I have actually received</label><p class="small">Pending refunds are not money received. Confirm the cash change before saving.</p></div>${dateField("date", "Date", old?.date || defDate)}${field("rate", `1 expense currency = how many ${t.currency}?`, old?.rate || t.rates?.[t.expenseCurrency] || 1, "number", 'required min="0.000001" max="1000000" step="any" inputmode="decimal"')}<p class="small" id="conversion"></p>${field("note", "Note · optional", old?.note || "", "text", 'maxlength="1000" placeholder="Noodles near the station"')}${footer(old ? "Save changes" : "Save expense")}${old ? '<button type="button" class="danger" style="width:100%;margin-top:12px" data-action="delete-expense" data-id="' + esc(id) + '">Delete expense</button>' : ""}</form>`,
  );
  const update = () => {
    const isRefund = $("#kind").value === "refund";
    $("#refund-options").hidden = !isRefund;
    $("#booking-suggestion").hidden = isRefund || !!old || !["hotels", "transport"].includes($("#pool").value);
    for (const option of $("#expense-booking").options) option.hidden = !!option.dataset.pool && option.dataset.pool !== $("#pool").value;
    const c = $("#expense-currency").value;
    $("#rate").disabled = c === t.currency;
    if (c === t.currency) $("#rate").value = 1;
    $("#conversion").textContent =
      "Planning amount: " +
      money(
        Math.round(
          (Number($("#amount").value) || 0) *
            100 *
            (Number($("#rate").value) || 0),
        ),
      );
  };
  $("#expense-currency").onchange = () => {
    $("#rate").value =
      $("#expense-currency").value === t.currency
        ? 1
        : t.rates?.[$("#expense-currency").value] || "";
    update();
  };
  $("#amount").oninput = update;
  $("#rate").oninput = update;
  $("#kind").onchange = update;
  $("#pool").onchange = () => { $("#expense-booking").value = ""; update(); };
  $("#refund-original").onchange = () => {
    const original = t.transactions.find(x => x.id === $("#refund-original").value);
    if (original) $("#pool").value = original.pool;
    update();
  };
  $("#category").onchange = () => {
    $("#pool").value =
      { Hotel: "hotels", Transportation: "transport", Emergency: "emergency" }[
        $("#category").value
      ] || "daily";
    $("#expense-booking").value = "";
    update();
  };
  update();
  $("#expense-form").onsubmit = async (e) => {
    e.preventDefault();
    await action(async () => {
      const amount =
          cents($("#amount").value) * ($("#kind").value === "refund" ? -1 : 1),
        currency = $("#expense-currency").value,
        rate = Number($("#rate").value);
      if ($("#date").value > today())
        throw Error(
          "Record only money already paid or received. Use a booking for future commitments.",
        );
      const record = {
        id: old?.id || uid(),
        date: $("#date").value,
        amount,
        currency,
        rate,
        base: convert(amount, rate),
        pool: $("#pool").value,
        category: $("#category").value,
        note: $("#note").value.trim(),
        ...($("#kind").value === "refund" ? { refundOf: $("#refund-original").value || undefined, unmatchedCredit: $("#unmatched-credit").checked } : {}),
      };
      await change((n) => {
        const tr = n.trips.find((x) => x.id === t.id);
        const booking = tr.bookings.find(b => b.id === $("#expense-booking").value);
        if (booking && $("#kind").value === "expense" && !old) {
          if (booking.pool !== record.pool) throw Error("Choose a booking from this budget.");
          bookingTransaction(tr, booking, { ...record, asOf: today() });
        } else saveExpense(tr, record, old?.id, today());
        tr.rates = { ...tr.rates, [currency]: rate };
        tr.expenseCurrency = currency;
      });
      close();
      toast("Saved on your device");
    });
  };
}
function adjustForm() {
  if (!trip().included) throw Error("Reference budgets are read-only.");
  modal(
    `<h2>Adjust the plan</h2><p class="small">Allocations never change actual money. Add money to a budget only from the unallocated shared fund. Transfers can move budgets between pools or trips.</p><form id="adjust-form"><label for="mode">Change</label><select id="mode"><option value="add">Allocate unassigned funds</option><option value="remove">Release allocation</option><option value="transfer">Transfer to another pool / trip</option></select><label for="from">From / current pool</label><select id="from">${options(POOLS, "daily")}</select><label for="target-trip">Destination trip</label><select id="target-trip">${state.trips
      .filter((t) => t.included)
      .map(
        (t) =>
          `<option value="${esc(t.id)}" ${t.id === state.active ? "selected" : ""}>${esc(t.name)}</option>`,
      )
      .join(
        "",
      )}</select><label for="to">Destination pool</label><select id="to">${options(POOLS, "daily")}</select>${field("adjust-amount", "Amount in " + trip().currency, "", "number", 'required min="0.01" step="0.01" inputmode="decimal"')}${field("reason", "Reason", "", "text", 'required maxlength="1000"')}${footer("Apply")}</form>`,
  );
  $("#adjust-form").onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      const amount = cents($("#adjust-amount").value),
        mode = $("#mode").value;
      await change((n) => {
        const source = n.trips.find((t) => t.id === n.active);
        if (mode === "transfer")
          transferBudget(
            n,
            source,
            n.trips.find((t) => t.id === $("#target-trip").value),
            $("#from").value,
            $("#to").value,
            amount,
            today(),
            $("#reason").value.trim(),
          );
        else
          adjustBudget(
            n,
            source,
            $("#from").value,
            mode === "add" ? amount : -amount,
            today(),
            $("#reason").value.trim(),
          );
      });
      close();
      toast("Plan updated. Actual money unchanged.");
    });
  };
}
function reservations() {
  if (!trip().included) throw Error("Reference commitments are read-only.");
  modal(
    `<h2>Other unpaid commitments</h2><p class="small">Unlinked holds retained from V1, or other future costs. Do not also enter a linked booking for the same bill. Reduce these holds manually when paid; bookings handle this automatically.</p><form id="res-form">${POOLS.map((p) => field("res-" + p, names[p], (trip().reserved?.[p] || 0) / 100, "number", 'required min="0" step="0.01" inputmode="decimal"')).join("")}${footer()}</form>`,
  );
  $("#res-form").onsubmit = async (e) => {
    e.preventDefault();
    await action(async () => {
      await change(
        (n) =>
          (n.trips.find((t) => t.id === n.active).reserved = Object.fromEntries(
            POOLS.map((p) => [p, cents($("#res-" + p).value)]),
          )),
      );
      close();
    });
  };
}
async function exportFile(content, name, type, full = false) {
  const file = new File([content], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: "Roam backup" });
  } else {
    const url = URL.createObjectURL(file),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  if (full)
    await change((n) => {
      n.lastBackup = new Date().toISOString();
      n.backupNeeded = false;
    });
  toast("Export prepared. Keep the file in Files; verify it saved.");
}
function importFile() {
  modal(
    `<h2>Restore your notebook</h2><p class="small">Complete recovery restores the shared fund and linked records together in an empty notebook. Into an existing notebook, import read-only references: no duplicated money or expenses.</p><label for="backup-file">JSON backup</label><input id="backup-file" type="file" accept=".json,application/json"><div id="import-preview"></div><button class="quiet" data-action="close">Cancel</button>`,
  );
  $("#backup-file").onchange = () =>
    action(async () => {
      $("#import-preview").replaceChildren();
      const f = $("#backup-file").files[0];
      if (!f) return;
      if (f.size > 20e6) throw Error("Backup exceeds 20 MB.");
      const raw = JSON.parse(await f.text()),
        data = parseBackup(raw),
        full = !state.trips.length && !state.fund.initialized;
      $("#import-preview").innerHTML =
        `<div class="notice">${data.trips.length} trips · ${data.trips.reduce((v, t) => v + t.transactions.length, 0)} transactions · ${raw.version === 1 ? "V1 backup: actual fund setup required" : "Shared fund included"}<br>${full ? "Recover all records and fund history." : "Current records and actual money remain unchanged. Copies will be read-only references."}</div><button id="confirm-import">${full ? "Recover notebook" : "Import references"}</button>`;
      $("#confirm-import").onclick = () =>
        action(async () => {
          await commit(
            restoreBackup(
              structuredClone(state),
              raw,
              full ? "full" : "copies",
            ),
          );
          close();
          toast("Recovery complete. Existing records preserved.");
        });
    });
}
async function action(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (e) {
    toast(
      e.name === "AbortError"
        ? "Export cancelled."
        : e.message || "Something went wrong. No changes saved.",
    );
  } finally {
    busy = false;
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.tab) {
    tab = b.dataset.tab;
    render();
    return;
  }
  const a = b.dataset.action;
  if (!a) return;
  action(async () => {
    if (a === "undo-delete" && deleted) {
      const saved = deleted;
      await change((n) => {
        const tr = n.trips.find((t) => t.id === saved.tripId);
        if (tr && !tr.transactions.some((t) => t.id === saved.record.id))
          tr.transactions.push(saved.record);
      });
      deleted = null;
      toast("Expense restored");
    }
    if (a === "fund") fundForm();
    if (a === "bookings") bookingForm();
    if (a === "booking") bookingForm(b.dataset.id);
    if (a === "correct-booking") correctionForm(b.dataset.id);
    if (a === "legacy-export") {
      const original = await readLegacyRecovery();
      if (!original)
        throw Error("No earlier V1 recovery is stored on this device.");
      await exportFile(
        JSON.stringify(backup(original.trips), null, 2),
        "roam-original-v1.json",
        "application/json",
      );
    }
    if (a === "close") close();
    if (a === "new-trip") tripForm();
    if (a === "settings") tripForm(true);
    if (a === "expense") expenseForm();
    if (a === "edit") expenseForm(b.dataset.id);
    if (a === "adjust") adjustForm();
    if (a === "reserve") reservations();
    if (a === "import") importFile();
    if (a === "export")
      await exportFile(
        JSON.stringify(makeBackup(state), null, 2),
        "roam-backup-" + today() + ".json",
        "application/json",
        true,
      );
    if (a === "csv")
      await exportFile(
        csv(trip()),
        "roam-expenses-" + today() + ".csv",
        "text/csv",
      );
    if (a === "delete-expense") {
      if (!trip().included) throw Error("Reference copies are read-only.");
      const t = trip(),
        record = t.transactions.find((x) => x.id === b.dataset.id);
      if (t.transactions.some(x => x.refundOf === record.id)) throw Error("Correct linked refunds before deleting their original expense.");
      modal(
        `<h2>Delete this expense?</h2><p>${esc(record.category)} · ${money(record.base)}</p><p class="small">The pool balance and future allowances will be recalculated.</p><div class="actions"><button data-action="close" class="quiet">Keep expense</button><button id="confirm-delete" class="danger">Delete</button></div>`,
      );
      $("#confirm-delete").onclick = () =>
        action(async () => {
          await change((n) => {
            const tr = n.trips.find((x) => x.id === t.id);
            tr.changes.push({
              id: uid(),
              date: today(),
              type: "expense deleted",
              before: structuredClone(record),
            });
            tr.transactions = tr.transactions.filter((x) => x.id !== record.id);
          });
          deleted = { tripId: t.id, record };
          close();
          toast("Expense deleted");
          const undo = document.createElement("button");
          undo.textContent = "Undo";
          undo.dataset.action = "undo-delete";
          undo.className = "link";
          undo.style.color = "white";
          $("#toast").append(undo);
        });
    }
  });
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    query = e.target.value;
    renderEntries();
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "pool-filter") {
    filter = e.target.value;
    renderEntries();
  }
});
$("#trip-picker").onclick = () => {
  if (!state) return;
  modal(
    `<h2>Your trips</h2><div class="stack">${state.trips.map((t) => `<button class="quiet select-trip" data-id="${esc(t.id)}">${esc(t.name)}<div class="small">${esc(t.start)} → ${esc(t.end)}${t.included ? "" : " · Reference"}${t.id === state.active ? " · Current" : ""}</div></button>`).join("")}<button data-action="new-trip">＋ Create a new trip</button><button class="quiet" data-action="import">Restore backup</button><button data-action="close" class="link">Close</button></div>`,
  );
  document.querySelectorAll(".select-trip").forEach(
    (b) =>
      (b.onclick = () =>
        action(async () => {
          await change((n) => (n.active = b.dataset.id));
          tab = "today";
          query = "";
          filter = "";
          close();
          render();
        })),
  );
};
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state && !$("#dialog").open) render();
});
window.addEventListener("online", status);
window.addEventListener("offline", status);
try {
  state = await read();
  const originalState = state;
  state = migrateState(state);
  if (originalState.schemaVersion !== 2)
    state = await write(state, originalState.revision);
  if (!trip()) state.active = state.trips[0]?.id || null;
  render();
  bootComplete = true;
  navigator.storage?.persist?.().catch(() => {});
  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
    });
    const check = async () => {
      readyOffline = !!(await caches.match(
        new URL("./index.html", location.href),
      ));
      status();
    };
    await navigator.serviceWorker.ready;
    await check();
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "installed") {
          check();
          if (navigator.serviceWorker.controller) {
            pending = w;
            status();
          }
        }
      });
    });
    if (reg.waiting) {
      pending = reg.waiting;
      status();
    }
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if ($("#dialog").open) {
        reloadPending = true;
        toast("Update ready. Finish editing to reload safely.");
      } else location.reload();
    });
  }
} catch (e) {
  if (bootComplete) {
    toast("Offline setup unavailable: " + e.message);
  } else {
    $("#status").textContent = "Storage unavailable";
    $("#main").innerHTML =
      "<h1>Your records need storage.</h1><p>Close other tracker windows and reopen in regular Safari. Do not clear website data if you have records here.</p>";
    toast(e.message);
    if (state) {
      const recovery = document.createElement("button");
      recovery.textContent = "Export untouched recovery data";
      recovery.onclick = () =>
        action(() =>
          exportFile(
            JSON.stringify(
              { format: "travel-tracker-raw-recovery", state },
              null,
              2,
            ),
            "roam-recovery.json",
            "application/json",
          ),
        );
      $("#main").append(recovery);
    }
  }
}

function correctionForm(id) {
 const t=trip(), x=t.transactions.find(x=>x.id===id), b=t.bookings.find(b=>b.id===x?.bookingId);
 if (!b || !t.included) throw Error("Choose a live booking payment.");
 modal(`<h2>Correct recorded ${x.base < 0 ? "refund" : "payment"}</h2><p class="small">Earlier ${esc(x.date)} · ${money(x.base)}. This corrects your records; it is not another payment or refund.</p><form id="correction-form">${field("correction-amount","Correct amount in " + x.currency,Math.abs(x.amount)/100,"number",'required min="0.01" step="0.01" inputmode="decimal"')}${field("correction-rate","1 " + x.currency + " in " + t.currency,x.rate,"number",'required min="0.000001" step="any"')}${dateField("correction-date","Correct payment date",x.date)}${field("correction-note","Reason for correction","","text",'required maxlength="800"')}<p id="correction-preview" class="notice"></p>${footer("Save correction")}</form>`);
 const preview=()=> { try { const next=structuredClone(state),tr=next.trips.find(a=>a.id===t.id),bk=tr.bookings.find(a=>a.id===b.id);correctBookingTransaction(tr,bk,id,{amount:cents($("#correction-amount").value),currency:x.currency,rate:Number($("#correction-rate").value),date:$("#correction-date").value,note:$("#correction-note").value||"Preview",asOf:today()});$("#correction-preview").textContent="Actual money: " + money(fundStats(state).actual,state.fund.currency) + " → " + money(fundStats(next).actual,state.fund.currency)+" · Booking unpaid: " + money(bookingStatus(tr,bk).unpaid); } catch(e){$("#correction-preview").textContent=e.message;} };
 $("#correction-form").oninput=preview;preview();
 $("#correction-form").onsubmit=e=>{e.preventDefault();action(async()=>{await change(n=>{const tr=n.trips.find(a=>a.id===t.id);correctBookingTransaction(tr,tr.bookings.find(a=>a.id===b.id),id,{amount:cents($("#correction-amount").value),currency:x.currency,rate:Number($("#correction-rate").value),date:$("#correction-date").value,note:$("#correction-note").value.trim(),asOf:today()});});close();toast("Correction saved. Earlier values retained in history.");});};
}
