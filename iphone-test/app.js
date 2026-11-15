import {coordinatedContext,activateCoordination,addCoordinatedTrip,coordinatedProjection,coordinatedTripView} from "./coordinated-budget.js";
import {activateFixedBudget,fixedProjection,fixedMove,deriveFixedPlan,fixedTarget,refreshFixedClock,reviewFixedClock,settleFixedFunding,changeFixedDates,archiveFixedTrip,reopenFixedTrip} from "./fixed-budget.js";
import {fixedReferenceSummary} from "./reference-views.js";
import {setAppearance} from "./appearance.js";
import {readBackupFile} from "./backup-file.js";
import {ENVELOPES} from "./planning.js";
import {moneyBreakdown,historyRecords,spendingSummary,completedTripSummary} from "./insights.js";
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
  backupFingerprint,
} from "./core.js";
import { read, write, readLegacyRecovery } from "./db.js";
import {
  migrateState,
  validateState,
  fundStats as cashFundStats,
  safeSummary as rollingSummary,
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
  editBookingDetails,
  confirmBooking,
  bookingTransaction,
  linkBookingRecord,
  makeBackup,
  parseBackup,
  restoreBackup,
  correctBookingTransaction,
  saveExpense,
  closeTrip,
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
    system:"System",light:"Light",dark:"Dark",
    daily: "Daily spending",
    hotels: "Hotels",
    transport: "Transportation",
    emergency: "Emergency",
    savings: "Savings", shopping:"Shopping",activities:"Activities",unassigned:"Available to allocate",
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
  historyFilter = { tripId: undefined, from:"", to:"", category:"" },
  pending = null,
  busy = false;
let bootComplete = false;
let renderedDate = "";
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
function fixedContext(s=state){return s.coordination?coordinatedContext(s):s.fixedBudget;}
function fixedView(s=state,date=dateInZone(fixedContext(s)?.plan.zone||trip()?.zone||"UTC")){return s.fixedBudget?fixedProjection(s,date,{instant:Date.now()}):null;}
function fundStats(s){const f=cashFundStats(s);if(!s.fixedBudget)return f;const x=fixedView(s),g=x.global;return {...f,unallocated:x.balances.unassigned,availableToAllocate:x.transferable.unassigned,shortfall:g?g.fundingShortfall:Math.max(x.uncovered,x.commitmentShortfall),fixed:x};}
function moneyView(){const x=fixedView();if(!x?.global)return x;const g=x.global;return {...x,balances:g.balances,uncovered:g.uncovered,commitmentShortfall:g.commitmentShortfall,dailyFundingShortfall:Object.values(g.views).reduce((n,v)=>n+v.dailyFundingShortfall,0)};}
function safeSummary(s,t,date){
 if(!s.fixedBudget||t.id!==fixedContext(s).tripId)return rollingSummary(s,t,date);
 if(date<fixedContext(s).plan.activationDate&&!s.coordination)return {...rollingSummary(s,t,date),scheduled:true};
 const x=fixedView(s,date),days=Math.max(0,dayNumber(t.end)-Math.max(dayNumber(t.start),dayNumber(date))+1),tomorrow=x.days.find(d=>dayNumber(d.date)===dayNumber(date)+1);
 return {days,allowance:x.target,remaining:x.target-x.spentToday,safeToday:x.backedLeftToday,tomorrow:tomorrow?.target??null,spent:x.spentToday,original:fixedContext(s).plan.originalTarget,shortfall:Math.max(x.dailyFundingShortfall,x.uncovered,x.commitmentShortfall),status:t.closed?'Closed':date<t.start?'Upcoming':date>t.end?'Completed':'In progress',scheduled:date<t.start,needsSetup:false,fixed:x};
}
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").style.display = "block";
  setTimeout(() => ($("#toast").style.display = "none"), 5000);
}
const draftStorageKey="roam-iphone-test-drafts:"+(new URLSearchParams(location.search).get("notebook")||"main");
let drafts = new Map();
try { drafts=new Map(JSON.parse(sessionStorage.getItem(draftStorageKey)||"[]")); } catch {}
function persistDrafts(){try{sessionStorage.setItem(draftStorageKey,JSON.stringify([...drafts]));}catch{}}

let modalKey = "";
function rememberDraft() {
 const form = $("#dialog form");
 if (!$("#dialog").open || !form || !modalKey) return;
 const values = [...form.elements].filter(e=>e.id && e.type!=="file" && !["submit","button"].includes(e.type)).map(e=>({id:e.id,value:e.value,checked:e.checked}));
 if (form.dataset.dirty === "true") {drafts.set(modalKey, values);persistDrafts();}
}
function modal(html) {
 rememberDraft();
 $("#dialog-content").innerHTML = `<button type="button" class="dialog-close quiet" data-action="close" aria-label="Close dialog">×</button>` + html;
 const heading = $("#dialog h2");
 if (heading) { heading.id="dialog-title"; $("#dialog").setAttribute("aria-labelledby","dialog-title"); }
 const form = $("#dialog form");
 modalKey = (trip()?.id || "global") + ":" + (form?.dataset.draftKey || form?.id || "") + ":" + (heading?.textContent || "");
 const saved = drafts.get(modalKey);
 if (form && saved) {
   for (const v of saved) { const e=document.getElementById(v.id); if(e) {e.value=v.value;if(e.type==="checkbox")e.checked=v.checked;} }
   form.dataset.dirty="true";
 }
 if (form) {form.addEventListener("input",()=>{form.dataset.dirty="true";rememberDraft();});form.addEventListener("change",()=>{form.dataset.dirty="true";rememberDraft();});}
 const error=document.createElement("p");error.id="form-error";error.className="notice negative";error.setAttribute("role","alert");error.hidden=true;
 if(form)form.setAttribute("aria-describedby","form-error");
 $("#dialog-content").prepend(error);
 if (!$("#dialog").open) $("#dialog").showModal();
}
const close = (saved = true) => {
 if (saved) {drafts.delete(modalKey);persistDrafts();} else rememberDraft();
 $("#dialog").close();
 if(saved&&tab==="settings")render();
};
$("#dialog").addEventListener("cancel",e=>{e.preventDefault();close(false);});
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
  if(next.revision!==state.revision)throw Error("Records changed. Review this operation again.");
  if(JSON.stringify([next.trips,next.fund,next.settings,next.fixedBudget,next.coordination])!==JSON.stringify([state.trips,state.fund,state.settings,state.fixedBudget,state.coordination]))next.backupNeeded=true;
  if(next.fixedBudget){next=refreshFixedClock(next,Date.now());settleFixedFunding(next,dateInZone(fixedContext(next).plan.zone));}
  validateState(next);
  state = await write(next, state.revision);
  render();
}
async function change(fn) {
  const next = structuredClone(state);
  fn(next);
  if (
    JSON.stringify([next.trips, next.fund, next.settings,next.fixedBudget,next.coordination]) !==
    JSON.stringify([state.trips, state.fund, state.settings,state.fixedBudget,state.coordination])
  )
    next.backupNeeded = true;
  await commit(next);
}
function status() {
  const el = $("#status");
  el.textContent = `${new URLSearchParams(location.search).get("notebook") ? "Recovery notebook · " : ""}${navigator.onLine ? "● Online" : "● Offline"} · ${readyOffline ? "Ready offline" : "Offline setup pending"} · Saved on this device`;
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
 return list.length ? list.map(x=>`<button class="entry transaction-card" data-action="transaction" data-id="${esc(x.id)}" data-trip="${esc(x.tripId||trip().id)}"><span class="icon">${poolIcon(x.pool)}</span><span class="details"><strong>${esc(x.category)}</strong><small>${esc(x.date)} · Paid from ${esc(names[x.fundingSource||x.pool])}${x.tripName?' · '+esc(x.tripName):''}${x.note?' · '+esc(x.note):''}</small></span><span class="transaction-amount ${x.base>0?'expense-amount':'refund-amount'}">${x.base>0?'−':'+'}${money(Math.abs(x.displayAmount??x.base),x.displayCurrency||trip().currency)} <span aria-hidden="true">›</span></span></button>`).join('') : '<p class="small">No purchases match this view.</p>';
}
function fundCard() {
 const f=fundStats(state),c=state.fund.currency;
 if(!state.fund.initialized)return `<div class="card fund-card"><div><strong>Your travel money</strong><p class="small">Enter the money you actually have. Budgets are plans.</p></div><button class="quiet" data-action="fund">Set up money</button></div>`;
 return `<button class="card fund-card detail-card" data-action="money-detail"><span><span class="eyebrow">Travel money · recorded balance</span><strong class="fund-amount ${f.actual<0?'negative':''}">${money(f.actual,c)}</strong><span class="small">${money(Math.max(0,f.availableToAllocate??f.unallocated),c)} ${f.shortfall?"not assigned · review shortfall":"available to allocate"}${f.shortfall?' · '+money(f.shortfall,c)+' funding shortfall':''}</span></span><span aria-hidden="true">›</span></button>`;
}
function bookingCards() {
  const t = trip();
  return `<div class="section"><div class="row"><h2>Bookings & bills</h2>${t.closed?'':'<button class="link" data-action="bookings">＋ Add</button>'}</div>${
    t.bookings.length
      ? t.bookings
          .map((b) => {
            const st = bookingStatus(t, b);
            return `<button class="booking-card" data-action="booking" data-id="${esc(b.id)}"><div class="row"><strong>${esc(b.name)}</strong><span class="pill">${b.estimated?"Estimate":b.cancelled ? "Cancelled" : st.unpaid ? "Payment due" : "Paid"}</span></div><div class="small">${names[b.pool]} · ${b.estimated?money(b.total)+" estimated · not a confirmed bill":money(st.net)+" net paid · "+money(st.unpaid)+" still owed"}${st.pendingRefund ? " · " + money(st.pendingRefund) + " refund pending" : ""}</div></button>`;
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
          `<p class="small"><strong>${esc(t.name)}</strong> · ${money(state.coordination?Object.values(coordinatedProjection(state).views[t.id].balances).reduce((n,x)=>n+x,0):allocation(t), t.currency)} ${state.coordination?'remaining in this trip': 'allocated'}${state.coordination?'':' · '+money(allocation(t)-spent(t),t.currency)+' remaining'}${t.currency !== c ? " · fixed " + t.fundRate + " " + c + "/" + t.currency : ""}</p>`,
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
function bookingForm(id, mode) {
  if(trip().closed&&(!id||mode))throw Error("Reopen the archived trip before changing bookings.");
  const t = trip(),
    b = t.bookings.find((x) => x.id === id);
  if (!t.included && !b) throw Error("Reference copies are read-only.");
  if (!b) {
    modal(
      `<h2>Plan a booking or bill</h2><p class="small">An unpaid commitment protects money but is not an expense. Record future daily costs, hotels, or transport. Amounts use ${esc(t.currency)}.</p><form id="booking-new">${field("booking-name", "Name", "", "text", 'required maxlength="100" placeholder="Shanghai hotel"')}<label for="booking-pool">Budget pool</label><select id="booking-pool">${options(["hotels", "transport", "daily"], "hotels")}</select>${field("booking-total", "Total agreed cost", "0", "number", 'required min="0" step="0.01" inputmode="decimal"')}${field("booking-city","City · optional","","text",'maxlength="100"')}${state.fixedBudget?'<label for="booking-certainty">Cost status</label><select id="booking-certainty"><option value="confirmed">Confirmed agreed cost</option><option value="estimated">Estimate · not a confirmed bill</option></select>':''}${dateField("booking-date", "Payment due date", today())}<details><summary>Stay or service dates · optional</summary>${field("booking-stay-start","Stay / service start","","date")}${field("booking-stay-end","Stay / service end","","date")}</details><div id="hold-review"><label for="hold-relationship">Existing unpaid hold</label><select id="hold-relationship"><option value="">Review existing hold before saving</option><option value="replace">This booking replaces the same bill</option><option value="separate">This is a different bill · keep both</option></select><p class="small">If an earlier unpaid hold describes this same bill, replace it to avoid reserving the money twice.</p></div>${footer("Save reservation")}</form>`,
    );
    const reviewHold = () => { $("#hold-review").hidden = !(t.reserved?.[$("#booking-pool").value] > 0); $("#hold-relationship").value = ""; };
    $("#booking-pool").onchange = reviewHold; reviewHold();
    $("#booking-new").onsubmit = (e) => {
      e.preventDefault();
      action(async () => {
        const estimated=$("#booking-certainty")?.value==="estimated";
        await change((n) =>
          addBooking(
            n.trips.find((x) => x.id === t.id),
            {
              name: $("#booking-name").value.trim(),
              pool: $("#booking-pool").value,
              total: cents($("#booking-total").value),
              replaceHold: $("#hold-relationship").value === "replace",
              separateHold: $("#hold-relationship").value === "separate",
              date: $("#booking-date").value,
              estimated,
              city: $("#booking-city").value.trim(),
              stayStart: $("#booking-stay-start").value,
              stayEnd: $("#booking-stay-end").value,
            },
          ),
        );
        close();
        toast(estimated?"Estimate saved. No bill reserved or cash deducted.":"Commitment saved. Actual money unchanged.");
      });
    };
    return;
  }
  if (!mode) { bookingOverview(id); return; }
  const st = bookingStatus(t, b), bookingOperation = uid();
  modal(
    `<h2>${esc(({pay:"Record payment",refund:"Record refund received",revise:"Edit agreed cost",service:"Change payment due date",cancel:"Cancel or revise cancellation",link:"Link existing record"})[mode]||b.name)}</h2><p>${esc(b.name)}</p>${b.serviceDate?`<p class="small">Due / service date: ${esc(b.serviceDate)}</p>`:''}<div class="notice">${b.cancelled ? "Cancelled · final cost " + money(b.fee) : "Agreed cost " + money(b.total)}<br>${money(st.paid)} paid · ${money(st.refunded)} refunds received<br>${money(st.unpaid)} unpaid · ${money(st.pendingRefund)} refund pending</div><p class="small">Only payments and received refunds change actual money. Cancellation releases the unpaid obligation. ${state.fixedBudget?"Keep the budget in its category; choose a separate budget move if needed.":"Keep the budget where it is or explicitly move released planning money to Daily."} Pending refunds stay unavailable.</p>${bookingRefundNotice(t,b)}${
      t.included
        ? `<form id="booking-action" data-draft-key="booking-action-${esc(id)}-${esc(mode)}"><label for="booking-mode" hidden>Action</label><select id="booking-mode" hidden><option value="pay">Record actual payment</option><option value="refund">Record refund received</option><option value="link">Link an already-recorded payment / refund</option>${b.cancelled ? '<option value="cancel">Revise final cancellation cost</option>' : '<option value="revise">Revise total agreed cost</option><option value="service">Change due / service date</option><option value="cancel">Cancel · enter final cancellation cost</option>'}</select><div id="booking-link" hidden><label for="link-record">Existing unlinked record · no new expense</label><select id="link-record">${t.transactions
            .filter((x) => !x.bookingId && x.pool === b.pool)
            .map(
              (x) =>
                `<option value="${esc(x.id)}">${esc(x.date)} · ${money(x.base)} · ${esc(x.note || x.category)}</option>`,
            )
            .join(
              "",
            )}</select></div>${field("booking-amount", "Amount / new total / final cancellation cost in " + t.currency, "", "number", 'required min="0" step="0.01" inputmode="decimal"')}<div id="booking-fx"><label for="booking-currency">Payment / refund currency</label><select id="booking-currency">${options(currencies, t.currency)}</select>${field("booking-rate", "1 payment currency in " + t.currency, 1, "number", 'required min="0.000001" max="1000000" step="any" inputmode="decimal"')}<p class="small" id="booking-conversion"></p></div>${dateField("booking-action-date", "Payment, refund or change date", today())}${field("booking-note", "Reason or note", "", "text", 'required maxlength="800"')}<div id="cancel-options" hidden><label class="check-label"><input id="cancel-release" type="checkbox"> Move released planning money to Daily spending</label><p class="small">Leave unchecked to keep the budget in its current category. Actual money does not increase.</p></div>${footer("Record action")}</form>`
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
      const service = $("#booking-mode").value === "service";
      $("#cancel-options").hidden = state.fixedBudget || $("#booking-mode").value !== "cancel";
      $("#booking-amount").disabled = linking || service;
      $("#booking-amount").hidden = linking || service;
      $('label[for="booking-amount"]').hidden = linking || service;
      $("#booking-action button[type=submit]").textContent = ({pay:"Record payment",refund:"Record received refund",revise:"Save agreed cost",service:"Save date",cancel:"Confirm cancellation cost",link:"Link existing record"})[$("#booking-mode").value];
      document.querySelector('label[for="booking-action-date"]').textContent = service ? "New due / service date" : "Payment, refund or change date";
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
              operationId: bookingOperation,
              currency: $("#booking-currency").value,
              rate: Number($("#booking-rate").value),
              asOf: today(),
            });
          else if(mode === "service") {
            bk.changes.push({id:uid(),date:today(),type:"service date changed",before:{serviceDate:bk.serviceDate},serviceDate:date,note,total:bk.total});
            bk.serviceDate=date;bk.dueDate=date;
          } else
            reviseBooking(tr, bk, {
              total: mode === "revise" ? amount : bk.total,
              fee: mode === "cancel" ? amount : 0,
              cancelled: mode === "cancel",
              releaseToDaily: !state.fixedBudget&&$("#cancel-release").checked,
              date,
              note,
            });
        });
        close();
        toast("Booking updated. Linked history preserved.");
      });
    };
  $("#booking-mode").value = mode;
  $("#booking-mode").dispatchEvent(new Event("change"));

}

function render() {
  renderedDate = today();
  applyAppearance(state.settings?.appearance || "system");
  status();
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => { b.classList.toggle("active", b.dataset.tab === tab); if(b.dataset.tab===tab)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current"); });
  const t = trip();
  $("#trip-picker").textContent = t ? "Trips ▾" : "Trips +";
  if (tab === "settings") { renderSettings(); return; }
  if (tab === "money") { renderMoney(); return; }
  if (!t) {
    $("#main").innerHTML =
      fundCard() +
      `<div class="empty"><div class="eyebrow">A little planning. More exploring.</div><h1>Your next trip,<br>within reach.</h1><p>Start with your shared travel fund, then allocate money to China, Japan, or your next destination.</p><button data-action="new-trip">Plan a trip</button><button class="link" data-action="import">Restore a backup</button></div>`;
    return;
  }
  const date = today(),
    s = safeSummary(state, t, date);
  if (tab === "today") {
    if(t.closed||s.status==="Completed"){renderCompletedTrip(t,s);return;}
    if(state.coordination&&s.status==="Upcoming"){renderUpcomingTrip(t,s);return;}
    const over=Math.max(0,-s.remaining), progress=s.allowance>0?Math.min(100,s.spent/s.allowance*100):0;
    const due=t.bookings.filter(b=>!b.cancelled&&bookingStatus(t,b).unpaid>0).sort((a,b)=>(a.dueDate||a.serviceDate||'').localeCompare(b.dueDate||b.serviceDate||''))[0];
    $("#main").innerHTML=`${fundCard()}<div class="row"><h1>${esc(t.name)}</h1><span class="pill">${s.status}</span></div><p class="sub">${s.days} travel days remaining · ${esc(date)}</p><section class="hero"><button class="hero-detail" data-action="daily-detail">Today's spending details ›</button><div class="eyebrow">${s.status==='Upcoming'?'Projected first-day amount':['Completed','Closed'].includes(s.status)?'Trip complete':'Left today'}</div><div class="amount">${money(s.safeToday)}</div><div class="row"><span>${money(s.spent)} spent</span><strong>${money(s.allowance)} allowance</strong></div><div class="progress" role="progressbar" aria-label="Daily allowance used" aria-valuenow="${Math.round(progress)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${progress}%"></span></div></section>${over?`<p class="notice negative">${money(over)} over today's allowance. ${s.fixed?'Your daily limit stays fixed. Choose savings or an available budget to cover the excess.':'The rolling budget recalculates later days.'} Emergency funds are not automatically spent.</p>`:''}${s.shortfall?`<p class="notice negative">${money(s.shortfall)} funding shortfall. Review the plan before spending more.</p>`:''}${s.fixed?`${t.closed?'<p class="notice">This trip is archived. Budgets and savings are preserved.</p><button class="quiet" data-action="reopen-fixed">Reopen to correct a record</button>':''}<button class="card savings-card detail-card" data-action="savings"><span class="eyebrow">Saved from daily spending</span><strong class="fund-amount">${money(s.fixed.savingsAvailable)}</strong><span class="small">View savings & distribution ›</span></button>${s.fixed.clock?.review?'<button class="notice negative detail-card" data-action="clock-review">Review travel clock before releasing more savings ›</button>':''}${over?'<button class="quiet" data-action="fixed-transfer">Choose how to cover overspending</button>':''}`:''}${s.needsSetup?'<p class="notice">Set up recorded money or choose a live trip to calculate spending.</p>':''}<button class="primary" data-action="expense" ${!t.included||t.closed?'disabled':''}>＋ Add expense</button><div class="row"><h2>Reserved money</h2><button class="link" data-tab="trip">Trip details</button></div><div class="pool-strip">${['hotels','transport','emergency'].map(p=>`<button class="card detail-card reserved-card" data-action="pool-detail" data-pool="${p}"><span class="small">${esc(names[p])}</span><strong class="${balance(t,p)<0?'negative':''}">${money(s.fixed?s.fixed.balances[p]:balance(t,p))}</strong><span class="small">${commitment(t,p)?money(commitment(t,p))+' unpaid':'View breakdown'} ›</span></button>`).join('')}</div>${due?`<button class="booking-card upcoming-card" data-action="booking" data-id="${esc(due.id)}"><span class="eyebrow">Next payment</span><div class="row"><strong>${esc(due.name)}</strong><strong>${money(bookingStatus(t,due).unpaid)}</strong></div><span class="small">${esc(due.dueDate||due.serviceDate||'Date not recorded')} · View booking ›</span></button>`:''}<details class="card"><summary>Daily plan & starting target</summary><p class="small">Starting daily target ${money(s.original)}. ${s.tomorrow===null?'No next travel day.':s.fixed?'Tomorrow’s fixed limit '+money(s.tomorrow)+'.':'Next-day projection '+money(s.tomorrow)+' if no more spending today.'} ${s.fixed?'Fixed daily limit: unused funded money becomes savings after each travel day.':'This notebook uses rolling allowances.'}</p></details>${state.backupNeeded?'<button class="link" data-tab="settings">Changes need a fresh backup →</button>':''}<section class="section"><div class="row"><h2>Recent purchases</h2><button class="link" data-tab="history">See all</button></div>${entries(recentTransactions(t).slice(0,4))}</section>`;
  } else if (tab === "history") {
    renderHistory();
  } else {
    $("#main").innerHTML =
      `${fundCard()}<div class="eyebrow">Trip overview · ${t.closed ? "Closed" : t.dateCertainty || "Dates recorded"}</div><h1>${esc(t.name)}</h1><p class="sub">${esc(t.start)} → ${esc(t.end)} · ${esc(t.currency)}<br>${esc(t.zone)}</p><div class="row"><h2>Trip budget</h2><button class="quiet" data-action="${t.closed&&state.fixedBudget?'reopen-fixed':'adjust'}">${t.closed&&state.fixedBudget?'Reopen to adjust':'Adjust budget'}</button></div><div class="notice">Plans are separate from actual money. Safe daily spending protects other trips, emergency funds, and unpaid commitments.</div>${POOLS.map(
        (p) => {
          const b = state.fixedBudget?fixedView().balances[p]:balance(t, p),
            total = state.fixedBudget ? fixedPoolData(p).allocation :
              t.budgets[p] +
              t.adjustments
                .filter((a) => a.pool === p)
                .reduce((s, a) => s + a.amount, 0);
          return `<button class="card detail-card trip-pool" data-action="pool-detail" data-pool="${p}"><div class="row"><strong>${names[p]}</strong><strong class="${b < 0 ? "negative" : ""}">${money(b)}</strong></div><div class="progress"><span style="width:${Math.max(0, Math.min(100, total > 0 ? ((total - b) / total) * 100 : 0))}%"></span></div><div class="small" style="margin-top:9px">${money(state.fixedBudget?fixedPoolData(p).paid:total-b)} net paid · ${money(total)} allocated · ${money(commitment(t, p))} committed, unpaid</div>${commitment(t, p) ? `<div class="small">After commitments: ${money(b - commitment(t, p))}</div>` : ""}<span class="small">View budget details ›</span></button>`;
        },
      ).join(
        "",
      )}<div class="actions"><button class="quiet" data-action="settings">Trip settings</button><button class="quiet" data-action="bookings">Add a booking or bill</button></div>${bookingCards()}<button class="link" data-action="reserve" ${state.fixedBudget?'hidden':''}>Other unpaid commitments · advanced</button>${t.included && !t.closed ? '<button class="link" data-action="close-trip">Close trip & review unused allocations</button>' : ''}<details class="section"><summary>Budget moves & changes</summary>${
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
      }</details><details class="card activity"><summary>Record and date changes</summary>${
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
      }</details>${state.fixedBudget?`<button class="card savings-card detail-card" data-action="savings">Savings & budget moves ›</button><details class="card"><summary>Daily plan & clock history</summary>${(fixedContext().plan.audit||[]).slice().reverse().map(a=>`<p class="small">${esc(a.date)} · ${esc(a.type)}${a.effectiveDate?' · effective '+esc(a.effectiveDate):''}${a.amount!==undefined?' · '+money(a.amount):''}<br>${esc(a.reason||'')}</p>`).join('')||'<p class="small">No daily plan or clock changes recorded.</p>'}</details>`:''}<button class="link" data-tab="settings">Backups & recovery in Settings →</button><p class="small">Private by design. No financial records are sent to a server. Clearing website data can remove records. Keep a backup outside the app.</p>`;
  }
}
function renderEntries() {
 const selected=historyFilter.tripId===undefined?state.active:historyFilter.tripId;
 const records=historyRecords(state,{...historyFilter,tripId:selected,pool:filter,query});
 const invalidRange=historyFilter.from&&historyFilter.to&&historyFilter.from>historyFilter.to;
 const stats=spendingSummary(records),currency=selected?state.trips.find(t=>t.id===selected).currency:state.fund.currency;
 const largest=Math.max(1,...stats.categories.map(x=>Math.abs(x.amount)));
 $("#history-summary").innerHTML=`${invalidRange?'<p class="notice negative" role="alert">Choose an end date on or after the start date.</p>':''}<div class="card history-total"><span class="eyebrow">Net spending</span><h2>${money(stats.net,currency)}</h2><p class="small">${money(stats.expenses,currency)} purchases − ${money(stats.refunds,currency)} refunds received</p>${stats.categories.map(x=>`<div class="category-bar"><div class="row"><span>${esc(x.name)}</span><strong>${money(x.amount,currency)}</strong></div><div class="progress"><span style="width:${Math.abs(x.amount)/largest*100}%"></span></div></div>`).join('')}</div>`;
 $("#entries").innerHTML=entries(records);
}
function renderHistory(){
 const selected=historyFilter.tripId===undefined?state.active:historyFilter.tripId;
 const selectedTrip=state.trips.find(t=>t.id===selected),reference=state.referenceFunds?.find(a=>a.id===selectedTrip?.archiveId);
 const categories=[...new Set(state.trips.flatMap(t=>t.transactions.map(x=>x.category)))].sort();
 $("#main").innerHTML=`<div class="row"><h1>Where your money went</h1>${selectedTrip?.included===false?(reference?.notebook?`<button class="quiet" data-action="reference-view" data-id="${esc(reference.id)}">Reference details</button>`:'<span class="pill">Read-only reference</span>'):`<button data-action="${state.fixedBudget&&trip()?.closed?'reopen-fixed':'expense'}">${state.fixedBudget&&trip()?.closed?'Reopen for correction':'＋ Add'}</button>`}</div><p class="sub">${selectedTrip?.included===false?'Read-only source history. These records do not affect live money.':'Purchases and refunds. Budget moves are separate.'}</p><div class="toolbar"><input id="search" aria-label="Search purchases" placeholder="Search purchases" value="${esc(query)}"><select id="history-trip" aria-label="Filter by trip"><option value="">All live trips</option>${state.trips.map(t=>`<option value="${esc(t.id)}" ${selected===t.id?'selected':''}>${esc(t.name)}${t.included?'':' · Reference'}</option>`).join('')}</select><select id="history-category" aria-label="Filter by purchase category"><option value="">All categories</option>${options(categories,historyFilter.category)}</select><select id="pool-filter" aria-label="Filter funding budget"><option value="">All funding budgets</option>${options(state.fixedBudget?ENVELOPES:POOLS,filter)}</select></div><div class="history-presets"><button class="quiet" data-action="history-range" data-days="1">Today</button><button class="quiet" data-action="history-range" data-days="7">Last 7 days</button><button class="quiet" data-action="history-range" data-days="0">All dates</button></div><details class="history-dates"><summary>Date range</summary><div class="grid">${field('history-from','From',historyFilter.from,'date')}${field('history-to','Through',historyFilter.to,'date')}</div></details><div id="history-summary"></div><div id="entries"></div><button class="link" data-tab="trip">View budget moves & changes →</button>`;
 if(selected==='')$("#history-trip").value='';renderEntries();
}
function tripForm(edit = false) {
  if(state.fixedBudget){fixedPlanForm();return;}
  if (edit && !trip().included)
    throw Error("Reference settings are read-only.");
  if (!edit && !state.fund.initialized) {
    fundForm();
    return;
  }
  const t = edit ? trip() : null;
  const firstFixedPlan=!edit&&!state.trips.some(x=>x.included);
  const d = dateInZone(t?.zone || "Asia/Shanghai");
  modal(
    `<h2>${edit ? "Trip settings" : "Where to next?"}</h2><form id="trip-form">${field("name", "Trip name", t?.name || "", "text", 'required maxlength="100" placeholder="China summer trip"')}<div class="grid"><div>${dateField("start", "First day", t?.start || d)}</div><div>${dateField("end", "Last day", t?.end || d)}</div></div><label for="date-certainty">Travel dates</label><select id="date-certainty">${options(["estimated","confirmed"],t?.dateCertainty||"estimated")}</select><p class="small">Estimated dates give provisional allowances. You can change them without deleting expenses.</p>${edit ? "" : field("trip-allocation","Trip allocation in " + state.fund.currency,"0","number",'required min="0" step="0.01" inputmode="decimal"')}<label for="destination-zone">Destination</label><select id="destination-zone"><option value="Asia/Shanghai">China · Shanghai time</option><option value="Asia/Tokyo">Japan · Tokyo time</option><option value="Asia/Hong_Kong">Hong Kong</option><option value="America/Los_Angeles">Los Angeles</option><option value="custom">Another time zone</option></select><label for="currency">Planning currency</label><select id="currency" ${edit ? "disabled" : ""}>${options(edit ? currencies : [state.fund.currency], t?.currency || state.fund.currency)}</select>${field("zone", "Trip time zone", t?.zone || "Asia/Shanghai", "text", 'required placeholder="Asia/Shanghai"')}<p class="small">${edit ? "Planning currency stays fixed to preserve recorded conversions." : "New plans use your shared fund currency. Purchases can use local currencies."}</p>${edit ? "" : `<div class="grid">${POOLS.map((p) => `<div>${field(p, names[p] + " budget", "0", "number", 'required min="0" step="0.01" inputmode="decimal"')}</div>`).join("")}</div>`}<p class="notice" id="distribution-preview"></p>${firstFixedPlan?'<label class="check-label"><input id="new-fixed-mode" type="checkbox" checked>Use a fixed daily limit and save unused daily money.</label><p class="small">The daily budget is divided across the travel days to set the starting limit. Tomorrow’s limit will not grow automatically. A complete V3 backup preserves the plan; older app versions cannot edit it. Fixed mode currently supports one live trip per notebook.</p>':''}${footer(edit ? "Save settings" : "Create trip")}</form>`,
  );
  const zoneSelect=$("#destination-zone"), zoneInput=$("#zone");
  zoneSelect.value=[...zoneSelect.options].some(o=>o.value===zoneInput.value)?zoneInput.value:"custom";
  const zoneUpdate=()=>{const custom=zoneSelect.value==="custom";zoneInput.hidden=!custom;document.querySelector('label[for="zone"]').hidden=!custom;if(!custom)zoneInput.value=zoneSelect.value;};
  zoneSelect.onchange=zoneUpdate;zoneUpdate();
  const distribution=()=>{
    if(edit){$("#distribution-preview").textContent="Change allocations from Adjust budget; settings preserve your recorded original daily target.";return;}
    const total=cents($("#trip-allocation").value||0), sum=POOLS.reduce((v,p)=>v+cents($("#"+p).value||0),0);
    $("#distribution-preview").textContent="Allocated " + money(total,state.fund.currency) + " · Distributed " + money(sum,state.fund.currency) + (total===sum?" · Balanced":" · Difference "+money(total-sum,state.fund.currency));
  };
  if(!edit){const allocate=()=>{try{$("#daily").value=Math.max(0,cents($("#trip-allocation").value||0)-["hotels","transport","emergency"].reduce((v,p)=>v+cents($("#"+p).value||0),0))/100;distribution();}catch{}};$("#trip-allocation").oninput=allocate;for(const p of ["hotels","transport","emergency"])$("#"+p).oninput=allocate;$("#daily").oninput=distribution;}
  distribution();
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
              dateCertainty: tr.dateCertainty,
            },
            after: { name, start, end, zone, dateCertainty: $("#date-certainty").value },
          });
          Object.assign(
            n.trips.find((x) => x.id === t.id),
            { name, start, end, zone, dateCertainty: $("#date-certainty").value },
          );
        } else {
          const id = uid();
          const total = POOLS.reduce((v, p) => v + cents($("#" + p).value), 0);
          if(total!==cents($("#trip-allocation").value)) throw Error("Budget distribution must equal the trip allocation.");
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
            dateCertainty: $("#date-certainty").value,
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
          if(firstFixedPlan&&$("#new-fixed-mode").checked){const tr=n.trips.find(x=>x.id===id),current=dateInZone(zone);Object.assign(n,activateFixedBudget(n,{tripId:id,start:start>current?start:current,target:tr.originalTarget,asOf:current}));}
        }
      });
      close();
      toast(edit ? "Trip updated" : "Your trip is ready");
    });
  };
}
function expenseForm(id) {
  if(trip().closed)throw Error("Reopen the archived trip before editing its records.");
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
  const initialCurrency = old?.currency || t.expenseCurrency || t.currency;
  const initialRate = old?.rate ?? (initialCurrency === t.currency ? 1 : t.rates?.[initialCurrency] ?? "");
  modal(`<h2>${old ? "Edit expense" : "Add expense"}</h2><form id="expense-form" data-draft-key="expense-${esc(id || 'new')}"><div class="grid"><div>${field("amount","Amount",old?Math.abs(old.amount)/100:"","number",'required min="0.01" step="0.01" inputmode="decimal" autofocus')}</div><div><label for="expense-currency">Currency</label><select id="expense-currency">${options(currencies,initialCurrency)}</select></div></div><p class="small" id="conversion"></p><label for="category">Category</label><select id="category">${options([...new Set(["Food & drink","Local transport","Intercity travel","Accommodation","Clothes","Keychains","Souvenirs","Gifts","Shopping & gifts","Activities","Essentials","Other",old?.category].filter(Boolean))],old?.category||"Food & drink")}</select>${state.fixedBudget?`<label for="funding-source">Pay from</label><select id="funding-source">${options(ENVELOPES,old?.fundingSource||old?.pool||'daily')}</select>`:''}<label for="pool" ${state.fixedBudget?'hidden':''}>${state.fixedBudget?'Cash record pool':'Pay from'}</label><select id="pool" ${state.fixedBudget?'hidden':''}>${options(POOLS,old?.pool||"daily")}</select><p class="small" id="expense-context"></p><div id="booking-suggestion" hidden><label for="expense-booking">Pay an existing booking?</label><select id="expense-booking"><option value="">Separate purchase · not a booking payment</option>${t.bookings.filter(b=>!b.cancelled).map(b=>`<option value="${esc(b.id)}" data-pool="${b.pool}">${esc(b.name)} · ${money(bookingStatus(t,b).unpaid)} unpaid</option>`).join('')}</select><p class="small">Choose the booking to reduce its unpaid balance exactly once.</p></div><details id="expense-advanced" ${old?.amount<0 || !initialRate ? 'open':''}><summary>Date, conversion, note & refund options</summary><label for="kind">Record type</label><select id="kind"><option value="expense">Expense</option><option value="refund" ${old?.amount<0?'selected':''}>Refund received</option></select><div id="refund-options" hidden><label for="refund-original">Original expense</label><select id="refund-original"><option value="">Choose original expense</option>${t.transactions.filter(x=>x.base>0&&!x.bookingId&&x.id!==id).map(x=>`<option value="${esc(x.id)}" ${old?.refundOf===x.id?'selected':''}>${esc(x.date)} · ${esc(x.category)} · ${money(x.base)}</option>`).join('')}</select><label class="check-label"><input id="unmatched-credit" type="checkbox" ${old?.unmatchedCredit?'checked':''}>This is an unmatched credit actually received</label><p class="small">Pending refunds do not increase your money.</p></div>${dateField("date","Date",old?.date||defDate)}${field("rate","1 expense currency in " + t.currency,initialRate,"number",'required min="0.000001" max="1000000" step="any" inputmode="decimal"')}${field("note","Note · optional",old?.note||"","text",'maxlength="1000"')}</details><div class="expense-save">${footer(old?"Save changes":"Save expense")}</div>${old?`<button type="button" class="danger" data-action="delete-expense" data-id="${esc(id)}">Delete expense</button>`:''}</form>`);
  const update = () => {
    if($("#funding-source"))$('#pool').value=['hotels','transport','emergency'].includes($('#funding-source').value)?$('#funding-source').value:'daily';
    const isRefund = $("#kind").value === "refund";
    $("#refund-options").hidden = !isRefund;
    $("#booking-suggestion").hidden = isRefund || !!old || !["hotels", "transport"].includes($("#pool").value);
    for (const option of $("#expense-booking").options) option.hidden = !!option.dataset.pool && option.dataset.pool !== $("#pool").value;
    const c = $("#expense-currency").value;
    $("#amount").step = c === "JPY" ? "1" : "0.01";
    const suggested={Accommodation:"hotels","Intercity travel":"transport"}[$("#category").value];
    $("#expense-context").textContent = "Paid from " + names[$("#funding-source")?.value||$("#pool").value] + " · " + $("#date").value + (isRefund ? " · Received refund" : "") + (!isRefund&&suggested&&suggested!==$("#pool").value?". To use "+names[suggested]+", choose it under Pay from; the category alone does not move money.":"")+(state.fixedBudget&&$("#date").value<fixedContext().plan.activationDate?". This predates fixed mode: the cash correction affects available-to-allocate money and does not create past daily savings.":"");
    if (!$("#rate").value) $("#expense-advanced").open = true;
    $("#rate").disabled = c === t.currency;
    if (c === t.currency) $("#rate").value = 1;
    $("#conversion").textContent =
      (c === t.currency ? "Recorded amount: " : "Planning amount · " + ($("#rate").value || "rate required") + " " + t.currency + "/" + c + ": ") +
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
  $("#date").onchange = update;
  if($("#funding-source"))$("#funding-source").onchange=()=>{$("#expense-booking").value="";update();};
  $("#pool").onchange = () => { $("#expense-booking").value = ""; update(); };
  $("#refund-original").onchange = () => {
    const original = t.transactions.find(x => x.id === $("#refund-original").value);
    if (original) {$("#pool").value = original.pool;if($("#funding-source"))$("#funding-source").value=original.fundingSource||original.pool;}
    update();
  };
  $("#category").onchange = () => { update(); };
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
        ...(state.fixedBudget?{fundingSource:$("#funding-source").value}:{}),
        category: $("#category").value,
        note: $("#note").value.trim(),
        ...($("#kind").value === "refund" ? { refundOf: $("#refund-original").value || undefined, unmatchedCredit: $("#unmatched-credit").checked } : {}),
      };
      await change((n) => {
        const tr = n.trips.find((x) => x.id === t.id);
        const booking = tr.bookings.find(b => b.id === $("#expense-booking").value);
        if (booking && $("#kind").value === "expense" && !old) {
          if (booking.pool !== record.pool) throw Error("Choose a booking from this budget.");
          bookingTransaction(tr, booking, { ...record, operationId: record.id, asOf: today() });
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
  if(state.fixedBudget){fixedTransferForm();return;}
  const operationId=uid();
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
  const adjustmentMode=()=>{const transfer=$("#mode").value==="transfer";for(const id of ["target-trip","to"]){$("#"+id).hidden=!transfer;document.querySelector('label[for="'+id+'"]').hidden=!transfer;}};
  $("#mode").onchange=adjustmentMode;adjustmentMode();
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
            operationId,
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
 if(state.fixedBudget)throw Error("Use linked bookings in fixed mode so unpaid bills are not reserved twice.");
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
async function exportFile(content, name, type, full = false, share = false) {
  const file = new File([content], name, { type });
  if (share && navigator.canShare?.({ files: [file] })) {
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
      n.exportRevision = n.revision + 1;
      // Keep the reminder until the user confirms that this file exists in Files.
    });
  toast("Export prepared. Keep the file in Files; verify it saved.");
}
function importFile() {
  modal(
    `<h2>Restore your notebook</h2><p class="small">Complete recovery restores the shared fund and linked records together in an empty notebook. Into an existing notebook, import read-only references: no duplicated money or expenses.</p><div class="notice">${!state.trips.length&&!state.fund.initialized?"Empty notebook: recover all live records here.":"This notebook already has records or a fund. Import here creates read-only references. To recover an editable copy, open a separate recovery notebook below; the original is preserved."}</div><button class="quiet" data-action="new-recovery">Open a separate empty recovery notebook</button><label for="backup-file">JSON backup</label><input id="backup-file" type="file" accept=".json,application/json"><div id="import-preview"></div><button class="quiet" data-action="close">Cancel</button>`,
  );
  let selectedImport=0;
  $("#backup-file").onchange = async () => {
    const selection=++selectedImport;
    $("#import-preview").replaceChildren();
    await action(async () => {
      const f = $("#backup-file").files[0];
      if (!f) return;
      const raw = await readBackupFile(f),
        data = parseBackup(raw),
        full = !state.trips.length && !state.fund.initialized;

      const fingerprint=await backupFingerprint(raw);
      if(selection!==selectedImport) return;
      if(data.schemaVersion>=3&&!full&&!state.fixedBudget){$("#import-preview").innerHTML='<p class="notice">This legacy notebook stays unchanged. Import this fixed-budget backup into a fixed-budget notebook or recover it in a separate empty notebook to preserve its savings and audit history.</p>';return;}
      if((state.importedBackupHashes||[]).includes(fingerprint)) throw Error("This backup was already imported. No new copies were created.");
      $("#import-preview").innerHTML =
        `<div class="notice">${data.trips.length} trips · ${data.trips.reduce((v, t) => v + t.transactions.length, 0)} transactions · ${raw.version === 1 ? "V1 backup: actual fund setup required" : "Shared fund included"}<br>${full ? "Recover all records and fund history." : "Current records and actual money remain unchanged. Copies will be read-only references."}${data.fixedBudget&&!full?" The complete source notebook, savings and allocation history are preserved separately. Its money is not added here.":""}</div><button id="confirm-import">${full ? "Recover notebook" : "Import references"}</button>`;
      $("#confirm-import").onclick = () =>
        action(async () => {
          if(selection!==selectedImport || $("#backup-file").files[0]!==f) throw Error("Select and review the backup again.");
          await commit(
            restoreBackup(
              structuredClone(state),
              raw,
              full ? "full" : "copies",
              fingerprint,
            ),
          );
          close();
          toast("Recovery complete. Existing records preserved.");
        });
    });
  };
}
async function action(fn) {
  if (busy) return;
  busy = true;
  const submits=[...document.querySelectorAll('button[type="submit"]')];
  submits.forEach(b=>b.disabled=true);
  if($("#form-error")) $("#form-error").hidden=true;
  try {
    await fn();
  } catch (e) {
    if(/Another window/.test(e.message||"")) {
      const banner=$("#conflict");banner.hidden=false;banner.textContent="Another window changed these records. Reload to use the latest saved values. Your unsaved form draft will be kept.";
      const reload=document.createElement("button");reload.textContent="Reload records · keep draft";reload.dataset.action="reload-records";banner.append(reload);
      if($("#appearance"))$("#appearance").value=state.settings?.appearance||"system";
    }
    const error=$("#form-error");
    if(error && $("#dialog").open) {error.textContent=e.message || "Could not save. Your draft is retained.";error.hidden=false;error.tabIndex=-1;error.focus();if(/Another window/.test(e.message)){const retry=document.createElement("button");retry.textContent="Reload records · keep draft";retry.dataset.action="reload-records";error.append(retry);}}
    toast(
      e.name === "AbortError"
        ? "Export cancelled."
        : e.message || "Something went wrong. No changes saved.",
    );
  } finally {
    busy = false;
    submits.forEach(b=>b.disabled=false);
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.tab) {
    if(state.fixedBudget&&b.dataset.tab!=="history"&&(!state.coordination||!trip()?.included))state.active=fixedContext().tripId;
    tab = b.dataset.tab;
    render();
    window.scrollTo(0,0);
    return;
  }
  const a = b.dataset.action;
  if (!a) return;
  action(async () => {
    if(state.fixedBudget&&(!state.coordination||!trip()?.included)&&["savings","split-savings","fixed-transfer","reverse-fixed","fixed-plan","clock-review","pool-detail","daily-detail","money-detail"].includes(a))state.active=fixedContext().tripId;
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
    if (a === "booking-details-edit") bookingDetailsForm(b.dataset.id);
    if (a === "booking-action") bookingForm(b.dataset.id,b.dataset.mode);
    if(a==="reference-view")referenceOverview(b.dataset.id);
    if(a==="reference-export"){const archive=state.referenceFunds.find(a=>a.id===b.dataset.id);if(!archive?.notebook)throw Error("Reference snapshot not found.");await exportFile(JSON.stringify(archive.notebook,null,2),"roam-reference-complete-v"+archive.notebook.version+".json","application/json");}
    if(a==="reference-history"){state.active=b.dataset.trip;historyFilter={tripId:b.dataset.trip,from:"",to:"",category:""};filter="";query="";tab="history";close();render();}
    if(a==="trip-history"){historyFilter={tripId:state.active,from:"",to:"",category:""};filter="";query="";tab="history";render();window.scrollTo(0,0);}
    if (a === "history-range") {const days=Number(b.dataset.days),date=today();historyFilter.to=days?date:"";historyFilter.from=days?new Date((dayNumber(date)-days+1)*86400000).toISOString().slice(0,10):"";renderHistory();}
    if(a==="confirm-estimate") confirmEstimateForm(b.dataset.id);
    if(a==="category-total") categoryTotalDetails(b.dataset.pool);
    if(a==="coordinated-category") coordinatedCategoryDetails(b.dataset.pool);
    if(a==="enable-coordination") coordinationForm();
    if(a==="coordination-original-export")await exportFile(JSON.stringify(state.coordination.baseline,null,2),"roam-original-before-multiple-trips-v3.json","application/json");
    if(a==="enable-fixed") fixedActivationForm();
    if(a==="savings") savingsOverview();
    if(a==="split-savings") savingsSplitForm();
    if(a==="fixed-transfer") fixedTransferForm();
    if(a==="reverse-fixed") reverseFixedForm(b.dataset.id);
    if(a==="fixed-plan") fixedPlanForm();
    if(a==="reopen-fixed") reopenFixedForm();
    if(a==="clock-review") fixedClockForm();
    if (a === "money-detail") moneyDetails();
    if (a === "money-trip") {if(state.active!==b.dataset.id)await change(n=>{n.active=b.dataset.id;});poolDetails(b.dataset.pool);}
    if (a === "pool-detail") poolDetails(b.dataset.pool);
    if (a === "daily-detail") dailyDetails();
    if (a === "transaction") transactionDetails(b.dataset.id,b.dataset.trip);
    if (a === "edit-record") { if(b.dataset.trip!==state.active)await change(n=>{n.active=b.dataset.trip;});expenseForm(b.dataset.id); }
    if (a === "correct-booking") correctionForm(b.dataset.id);
    if(a==="fixed-original-export"){if(!state.fixedBudget)throw Error('No original fixed-mode snapshot.');await exportFile(JSON.stringify(state.fixedBudget.baseline,null,2),'roam-original-before-fixed-v2.json','application/json');}
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
    if (a === "close") close(false);
    if (a === "verify-backup") { if(!state.lastBackup || state.exportRevision!==state.revision) throw Error("Export a fresh backup, then verify that file in Files."); await change(n=>{n.lastBackupVerified=new Date().toISOString();n.backupNeeded=false;}); toast("File verification noted. Keep your external backup."); }
    if (a === "new-trip") {if(state.coordination)coordinatedTripForm();else if(state.fixedBudget)coordinationForm();else tripForm();}
    if (a === "settings") tripForm(true);
    if (a === "expense") expenseForm();
    if (a === "edit") expenseForm(b.dataset.id);
    if (a === "adjust") adjustForm();
    if (a === "reserve") reservations();
    if (a === "close-trip") closeTripForm();
    if (a === "import") importFile();
    if (a === "new-recovery") { const url=new URL(location.href);url.searchParams.set("notebook","recovery-"+uid());location.assign(url.href); }
    if (a === "original-notebook") { const url=new URL(location.href);url.searchParams.delete("notebook");location.assign(url.href); }
    if (a === "reload-records") { rememberDraft();location.reload(); }
    if (a === "discard-drafts") { drafts.clear();persistDrafts();toast("Unsaved drafts discarded. Saved records unchanged."); }
    if (a === "export")
      await exportFile(
        JSON.stringify(makeBackup(state), null, 2),
        "roam-iphone-test-backup-" + today() + ".json",
        "application/json",
        true,
      );
    if (a === "share-export") await exportFile(JSON.stringify(makeBackup(state),null,2),"roam-iphone-test-backup-"+today()+".json","application/json",true,true);
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
  const mapping={'history-trip':'tripId','history-category':'category','history-from':'from','history-to':'to'};
  if(mapping[e.target.id]) {historyFilter[mapping[e.target.id]]=e.target.value;renderEntries();}
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
          const selected=state.trips.find(t=>t.id===b.dataset.id),archive=state.referenceFunds?.find(a=>a.id===selected?.archiveId);
          if(archive?.notebook){referenceOverview(archive.id);return;}
          await change((n) => (n.active = b.dataset.id));
          tab = state.fixedBudget&&!state.trips.find(t=>t.id===b.dataset.id).included?"history":"today";
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
  if (originalState.schemaVersion === undefined)
    state = await write(state, originalState.revision);
  if (!trip()) state.active = state.trips[0]?.id || null;
  if(state.fixedBudget){if(!state.coordination||!trip()?.included)state.active=fixedContext().tripId;state=refreshFixedClock(state,Date.now());settleFixedFunding(state,today());state=await write(state,state.revision);}
  render();
  bootComplete = true;
  navigator.storage?.persist?.().catch(() => {});
  if ("serviceWorker" in navigator) {
    let reg;
    try{reg=await navigator.serviceWorker.register("./sw.js",{scope:"./"});}
    catch(error){reg=await navigator.serviceWorker.getRegistration("./");if(!reg)throw error;}
    const check = async () => {
      const controller=navigator.serviceWorker.controller;
      readyOffline=false;
      if(controller && controller.scriptURL===new URL("./sw.js",location.href).href) {
       readyOffline=await new Promise(resolve=>{const channel=new MessageChannel();const timer=setTimeout(()=>resolve(false),3000);channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data?.ready===true);channel.port1.close();};controller.postMessage({type:"CHECK_OFFLINE"},[channel.port2]);});
      }
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
 modal(`<h2>Correct recorded ${x.base < 0 ? "refund" : "payment"}</h2><p class="small">Earlier ${esc(x.date)} · ${money(x.base)}. This corrects your records; it is not another payment or refund.</p><form id="correction-form" data-draft-key="correction-${esc(id)}">${field("correction-amount","Correct amount in " + x.currency,Math.abs(x.amount)/100,"number",'required min="0.01" step="0.01" inputmode="decimal"')}${field("correction-rate","1 " + x.currency + " in " + t.currency,x.rate,"number",'required min="0.000001" step="any"')}${dateField("correction-date","Correct payment date",x.date)}${field("correction-note","Reason for correction","","text",'required maxlength="800"')}<p id="correction-preview" class="notice"></p>${footer("Save correction")}</form>`);
 const preview=()=> { try { const next=structuredClone(state),tr=next.trips.find(a=>a.id===t.id),bk=tr.bookings.find(a=>a.id===b.id);correctBookingTransaction(tr,bk,id,{amount:cents($("#correction-amount").value),currency:x.currency,rate:Number($("#correction-rate").value),date:$("#correction-date").value,note:$("#correction-note").value||"Preview",asOf:today()});$("#correction-preview").textContent="Actual money: " + money(fundStats(state).actual,state.fund.currency) + " → " + money(fundStats(next).actual,state.fund.currency)+" · Booking unpaid: " + money(bookingStatus(tr,bk).unpaid); } catch(e){$("#correction-preview").textContent=e.message;} };
 $("#correction-form").oninput=preview;preview();
 $("#correction-form").onsubmit=e=>{e.preventDefault();action(async()=>{await change(n=>{const tr=n.trips.find(a=>a.id===t.id);correctBookingTransaction(tr,tr.bookings.find(a=>a.id===b.id),id,{amount:cents($("#correction-amount").value),currency:x.currency,rate:Number($("#correction-rate").value),date:$("#correction-date").value,note:$("#correction-note").value.trim(),asOf:today()});});close();toast("Correction saved. Earlier values retained in history.");});};
}

function applyAppearance(mode) {
 let storage;try{storage=localStorage;}catch{}
 setAppearance({mode,systemDark:matchMedia("(prefers-color-scheme: dark)").matches,root:document.documentElement,meta:document.querySelector('meta[name="theme-color"]'),storage});
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>applyAppearance(state?.settings?.appearance||"system"));
function backupPanel() {
 return `<section class="card backup"><h2>Keep a copy</h2><p class="small">Complete JSON includes your fund, every trip and accounting history. ${state.fixedBudget?(state.coordination?"V4 preserves every trip’s independent limits, savings and transfers plus the original V3 snapshot. Older apps cannot read V4. ":"V3 preserves fixed daily limits, savings and budget moves. ")+"Use a separate empty notebook for editable recovery. Imports into another fixed-budget notebook are read-only references. ":""}CSV cannot restore Roam.</p><p class="small">Last export prepared: ${state.lastBackup?esc(new Date(state.lastBackup).toLocaleString()):"Never"}<br>Last file verified: ${state.lastBackupVerified?esc(new Date(state.lastBackupVerified).toLocaleString()):"Not yet"}</p>${state.backupNeeded || !state.lastBackup ? '<div class="notice">Changes need a fresh export.</div>' : '<p class="small">Verify the exported file in Files; export preparation alone does not confirm it was saved.</p>'}<div class="stack"><button data-action="export">Download complete backup · JSON</button><button class="quiet" data-action="share-export">Share backup / Save to Files</button><button class="quiet" data-action="import">Restore or import a backup</button><button class="quiet" data-action="verify-backup">I verified the file in Files</button>${trip()?'<button class="link" data-action="csv">Export this trip · CSV</button>':''}</div><p class="small">Clearing website data or losing this device can remove local records. Keep an external copy.</p></section>`;
}
function renderSettings() {
 $("#main").innerHTML=`<h1>Settings & backups</h1>${/^recovery-[0-9a-f-]{36}$/.test(new URLSearchParams(location.search).get("notebook")||"")?'<div class="notice">Separate recovery notebook. Original records are untouched. Keep this URL to reopen this copy; the normal Home Screen icon opens the original.<button class="link" data-action="original-notebook">Return to original notebook</button></div>':''}${drafts.size?'<button class="link" data-action="discard-drafts">Discard retained unsaved drafts</button>':''}<section class="card"><h2>Appearance</h2><label for="appearance">Theme</label><select id="appearance">${options(["system","light","dark"],state.settings?.appearance||"system")}</select><p class="small">System follows your device. Your choice works offline.</p></section>${dailyModePanel()}${backupPanel()}${referenceLibraryPanel()}`;
 $("#appearance").onchange=e=>action(async()=>{const mode=e.target.value;await change(n=>{n.settings={...n.settings,appearance:mode};});});
}
function renderMoney() {
 const legacy=moneyBreakdown(state),c=state.fund.currency,x=state.fixedBudget?moneyView():null;
 const palette={daily:'◷',hotels:'⌂',transport:'↗',emergency:'✚',shopping:'◇',activities:'☆',savings:'◎',unassigned:'＋'};
 const items=x?ENVELOPES.map(pool=>({pool,amount:x.balances[pool]})):POOLS.map(pool=>({pool,amount:legacy.trips.reduce((n,t)=>n+(t.pools.find(x=>x.pool===pool)?.amount||0),0)})).concat([{pool:'unassigned',amount:Math.max(0,legacy.unallocated)}]);
 const deficit=x?x.uncovered:legacy.shortfall,total=items.reduce((n,x)=>n+x.amount,0),actual=x?x.actual:legacy.actual;
 const free=x?x.transferable.unassigned:Math.max(0,legacy.unallocated);
 const assigned=items.filter(p=>p.pool!=='unassigned').reduce((n,p)=>n+p.amount,0),unassigned=items.find(p=>p.pool==='unassigned')?.amount||0,held=Math.max(0,unassigned-free),keyNames={daily:'Daily',hotels:'Hotels',transport:'Transport',emergency:'Emergency',shopping:'Shopping',activities:'Activities',savings:'Savings',unassigned:held?'Unassigned':'Available'};
 $("#main").innerHTML=`<h1>Your travel money</h1>${fundCard()}<p class="small">One recorded balance. Budgets assign this money; they do not add to it.</p><div class="money-summary"><section class="card assigned-summary"><span class="small">Assigned to budgets${deficit?' · before shortfall':''}</span><strong>${money(assigned,c)}</strong></section><section class="card available-summary"><span class="small">Available to allocate</span><strong>${money(free,c)}</strong></section></div>${held?`<p class="small">${money(held,c)} of unassigned money is held for backing gaps. Review the breakdown before moving it.</p>`:''}<section class="card money-distribution"><h2>How it is assigned</h2>${!deficit&&total>0?`<div class="allocation-bar" role="img" aria-label="Budget distribution: ${items.filter(x=>x.amount).map(x=>esc(names[x.pool])+': '+money(x.amount,c)).join(', ')}">${items.filter(x=>x.amount).map(x=>`<span class="tone-${x.pool}" style="flex:${x.amount}" title="${esc(names[x.pool])}: ${money(x.amount,c)}"></span>`).join('')}</div><div class="allocation-key" role="list" aria-label="Allocation color key">${items.filter(p=>p.amount).map(p=>`<span role="listitem"><i class="tone-${p.pool}" aria-hidden="true"></i>${esc(keyNames[p.pool])}</span>`).join('')}</div>`:''}${items.map(p=>`<button class="money-row" data-action="${p.pool==='unassigned'?'money-detail':state.coordination?'coordinated-category':p.pool==='savings'?'savings':x?'pool-detail':'category-total'}" ${!x?'data-id="'+esc(state.active)+'"':''} data-pool="${p.pool}"><span><span class="category-dot tone-${p.pool}" aria-hidden="true">${palette[p.pool]}</span>${p.pool==='unassigned'?(free===p.amount?'Available to allocate':'Not assigned · review backing'):esc(names[p.pool])}</span><strong>${money(p.amount,c)} ›</strong></button>`).join('')}${deficit?`<div class="row negative"><span>Uncovered planning shortfall</span><strong>−${money(deficit,c)}</strong></div>`:''}<div class="row money-check"><strong>Recorded money</strong><strong>${money(actual,c)}</strong></div><p class="small">${deficit?'Resolve the shortfall before relying on planning balances.':"These balances add up to your recorded money."}</p>${x?.dailyFundingShortfall?`<p class="notice negative">${money(x.dailyFundingShortfall,c)} more needs allocating to back your fixed daily limits. The target has not been changed.</p>`:''}${x?.commitmentShortfall?`<p class="notice negative">${money(x.commitmentShortfall,c)} of unpaid bills needs additional backing.</p>`:''}</section>${x?(x.plan.archived?'<button class="quiet" data-action="reopen-fixed">Reopen archived trip to move budgets</button>':'<button class="quiet" data-action="fixed-transfer">Move available budget money</button>'):'<button class="quiet" data-action="adjust">Move budget money</button>'}<button class="link" data-action="fund">Record received money / compare counted balance</button><p class="small">${x?`Each trip keeps its fixed daily limit. Unused funded money is saved when its travel day ends${!state.coordination&&today()<fixedContext().plan.activationDate?' · begins '+esc(fixedContext().plan.activationDate):''}.`:'Daily budgets currently roll unused money into later days.'}</p>`;
}
$(".brand").addEventListener("click",e=>{e.preventDefault();tab="today";render();window.scrollTo(0,0);});

function recentTransactions(t) {
 return t.transactions.map((record,index)=>({record,index})).sort((a,b)=>b.record.date.localeCompare(a.record.date)||b.index-a.index).map(x=>x.record);
}
setInterval(()=>{if(state && !document.hidden && !$("#dialog").open && today()!==renderedDate)render();},30000);
$("#dialog").addEventListener("close",()=>{if(state && today()!==renderedDate)render();});

function closeTripForm() {
 if(state.fixedBudget){const x=fixedView(),t=trip(),date=today();let blocked='';try{archiveFixedTrip(state,{date,reason:'Preview completion'},date);}catch(e){blocked=e.message;}
 modal(`<h2>Review trip completion</h2><p class="small">Archiving keeps every balance, saving, purchase and booking. It does not release money or start another trip.</p><div class="row"><span>Recorded money</span><strong>${money(x.actual)}</strong></div><div class="row"><span>Outstanding confirmed bills</span><strong>${money(x.plan.commitments.reduce((n,b)=>n+b.unpaid,0))}</strong></div><div class="row"><span>Pending refunds</span><strong>${money(t.bookings.reduce((n,b)=>n+bookingStatus(t,b).pendingRefund,0))}</strong></div>${blocked?`<p class="notice">${esc(blocked)} Final travel day: ${esc(t.end)}.</p>${x.clock?.review?'<button class="quiet" data-action="clock-review">Review travel clock</button>':''}`:`<form id="archive-fixed-form">${field('archive-note','Reason','Travel complete','text','required maxlength="800"')}${footer('Archive trip · preserve balances')}</form>`}<p class="small">You can explicitly reopen an archived trip for a correction. Starting another live fixed trip in this notebook remains guarded until multi-trip planning is verified.</p><button class="link" data-action="export">Download complete backup · JSON</button>`);
 if(!blocked)$('#archive-fixed-form').onsubmit=e=>{e.preventDefault();action(async()=>{requirePlanningClock();const candidate=archiveFixedTrip(state,{date:today(),reason:$('#archive-note').value.trim()},today());await commit(candidate);close();toast('Trip archived. Every balance and record preserved.');});};return;}

 const t=trip(), next=structuredClone(state), tr=next.trips.find(x=>x.id===t.id);
 closeTrip(next,tr,today(),"Preview");
 const released=allocation(t)-allocation(tr);
 modal(`<h2>Close ${esc(t.name)}?</h2><p class="small">Release ${money(released)} of unused allocation to your shared fund. Actual money remains ${money(fundStats(state).actual,state.fund.currency)}. Every expense, payment and history entry is retained. No unpaid commitment or pending refund can be skipped.</p><form id="close-trip-form">${field("close-reason","Reason","Trip finished","text",'required maxlength="800"')}${footer("Close & release unused allocation")}</form>`);
 $("#close-trip-form").onsubmit=e=>{e.preventDefault();action(async()=>{await change(n=>closeTrip(n,n.trips.find(x=>x.id===t.id),today(),$("#close-reason").value.trim()));close();toast("Trip closed. Cash unchanged; unused allocation released.");});};
}

window.addEventListener("pagehide",rememberDraft);

function bookingRefundNotice(t,b){return state.coordination&&b.pool==='daily'&&new Set(t.transactions.filter(x=>x.bookingId===b.id&&x.base>0).map(x=>x.date)).size>1?'<p class="notice">Payments span several daily budgets. A received refund stays in this trip’s Daily budget without guessing which earlier day to credit. You can move any available excess after future limits are protected.</p>':'';}
function bookingOverview(id){
 const t=trip(),b=t.bookings.find(x=>x.id===id),st=bookingStatus(t,b);
 modal(`<h2>${esc(b.name)}</h2><p class="small">${esc(names[b.pool])}${b.city?' · '+esc(b.city):''}${b.dueDate||b.serviceDate?' · Payment due '+esc(b.dueDate||b.serviceDate):''}</p><section class="card reserved-card">${b.stayStart?`<p class="small">Stay / service ${esc(b.stayStart)} → ${esc(b.stayEnd)}</p>`:''}<div class="row"><span>${b.estimated?'Estimated cost':b.cancelled?'Final cancellation cost':'Agreed cost'}</span><strong>${money(st.liability)}</strong></div><div class="row"><span>Net paid</span><strong>${money(st.net)}</strong></div><div class="row"><span>Still to pay</span><strong>${money(st.unpaid)}</strong></div>${st.pendingRefund?`<p class="notice">${money(st.pendingRefund)} refund pending · excluded from your money.</p>`:''}</section><p class="small">${b.estimated?"This is a planning estimate. Confirm the cost before recording a payment.":"Viewing this booking records no payment."}</p>${t.included&&!t.closed?`<div class="stack"><button class="quiet" data-action="booking-details-edit" data-id="${esc(id)}">Edit booking name, city & dates</button>${b.estimated&&!b.cancelled?`<button data-action="confirm-estimate" data-id="${esc(id)}">Confirm agreed cost</button>`:''}${(!b.cancelled&&st.unpaid)?`<button data-action="booking-action" data-id="${esc(id)}" data-mode="pay">Record payment</button>`:''}${st.pendingRefund>0?`<button class="quiet" data-action="booking-action" data-id="${esc(id)}" data-mode="refund">Record refund received</button>`:''}<button class="quiet" data-action="booking-action" data-id="${esc(id)}" data-mode="${b.cancelled?'cancel':'revise'}">${b.cancelled?'Review cancellation cost':'Edit agreed cost'}</button>${!b.cancelled?`<button class="quiet" data-action="booking-action" data-id="${esc(id)}" data-mode="service">Change due / service date</button><button class="link" data-action="booking-action" data-id="${esc(id)}" data-mode="cancel">Cancel booking</button>`:''}${!b.estimated?`<button class="link" data-action="booking-action" data-id="${esc(id)}" data-mode="link">Link an already recorded payment</button>`:''}</div>`:''}${bookingRefundNotice(t,b)}<h3>Payments & refunds</h3>${t.transactions.filter(x=>x.bookingId===b.id).map(x=>`<div class="card"><div class="row"><span>${esc(x.date)} · ${x.base>0?'Payment':'Refund received'}</span><strong class="${x.base>0?'expense-amount':'refund-amount'}">${x.base>0?'−':'+'}${money(Math.abs(x.base))}</strong></div>${t.included&&!t.closed?`<button class="link" data-action="correct-booking" data-id="${esc(x.id)}">Correct this record</button>`:''}</div>`).join('')||'<p class="small">No payments recorded yet.</p>'}<details><summary>Booking change history</summary>${b.changes.map(x=>`<p class="small">${esc(x.date)} · ${esc(x.type)}${x.note?' · '+esc(x.note):''}</p>`).join('')}</details>`);
}
function moneyDetails(){
 if(state.fixedBudget){fixedMoneyDetails();return;}
 const f=moneyBreakdown(state),c=state.fund.currency;
 modal(`<h2>Travel money breakdown</h2><p class="small">Recorded balance, based on actual money entered, purchases and received refunds.</p><h3>${money(f.actual,c)}</h3>${f.trips.map(t=>`<div class="row"><span>${esc(t.name)} · assigned</span><strong>${money(t.held,c)}</strong></div>`).join('')}<div class="row"><span>Not assigned${f.unallocated<0?' · shortfall':''}</span><strong>${money(f.unallocated,c)}</strong></div><p class="small">Unpaid bills are inside their trip budgets where covered. Pending refunds are excluded. Nothing is added twice.</p><button class="quiet" data-action="fund">Record money / compare counted balance</button>`);
}
function poolDetails(pool){
 if(state.fixedBudget){fixedPoolDetails(pool);return;}
 const t=trip(),remaining=poolBudget(t,pool)-spent(t,pool),unpaid=commitment(t,pool);
 modal(`<h2>${esc(names[pool])}</h2><section class="card reserved-card"><div class="row"><span>Planned budget</span><strong>${money(poolBudget(t,pool))}</strong></div><div class="row"><span>Net spent</span><strong>${money(spent(t,pool))}</strong></div><div class="row"><span>Remaining budget</span><strong>${money(remaining)}</strong></div><div class="row"><span>Unpaid bills · included where covered</span><strong>${money(unpaid)}</strong></div><div class="row"><span>Uncommitted remainder</span><strong>${money(Math.max(0,remaining-unpaid))}</strong></div></section>${remaining<unpaid?`<p class="notice negative">${money(unpaid-remaining)} more is needed to cover this budget.</p>`:''}<h3>Purchases & received refunds</h3>${entries(recentTransactions(t).filter(x=>x.pool===pool))}<button class="quiet" data-action="adjust">Move or adjust budget</button>`);
}
function dailyDetails(){
 if(state.fixedBudget){fixedDailyDetails();return;}
 const t=trip(),s=safeSummary(state,t,today());modal(`<h2>Today's daily spending</h2><p>${money(s.spent)} spent · ${money(s.allowance)} current allowance · ${money(s.safeToday)} left.</p><p class="small">Unused daily money currently increases later allowances.</p>${entries(recentTransactions(t).filter(x=>x.date===today()&&x.pool==='daily'))}<button data-action="expense">Add expense</button>`);
}
function transactionDetails(id,tripId){
 const t=state.trips.find(t=>t.id===(tripId||state.active)),x=t?.transactions.find(x=>x.id===id);if(!x)throw Error('Record not found.');
 modal(`<h2>${esc(x.category)}</h2><h3 class="${x.base>0?'expense-amount':'refund-amount'}">${x.base>0?'−':'+'}${money(Math.abs(x.base),t.currency)}</h3><p>${esc(x.date)} · ${esc(t.name)}<br>Paid from ${esc(names[x.fundingSource||x.pool])}</p><p class="small">Original amount ${money(Math.abs(x.amount),x.currency)} · Stored rate ${esc(x.rate)} ${esc(t.currency)}/${esc(x.currency)}</p>${x.note?`<p>${esc(x.note)}</p>`:''}${x.refundOf?'<p class="small">Received refund linked to its original purchase.</p>':''}${state.fixedBudget&&!state.coordination&&t.included&&x.date<fixedContext().plan.activationDate&&!x.bookingId?'<p class="small">This record predates fixed daily mode. Later cash corrections affect available-to-allocate money; no earlier daily savings are invented.</p>':''}${t.included&&!t.closed?`<button class="quiet" data-action="edit-record" data-trip="${esc(t.id)}" data-id="${esc(id)}">${x.bookingId?'View booking & correction options':'Edit this record'}</button>`:t.closed?'<p class="small">Archived record. Reopen the trip to correct it.</p>':'<p>Read-only reference.</p>'}<details><summary>Corrections</summary>${t.changes.filter(c=>c.before?.id===id||c.after?.id===id).map(c=>`<p class="small">${esc(c.date)} · ${esc(c.type)}${c.note?' · '+esc(c.note):''}</p>`).join('')||'<p class="small">No corrections recorded.</p>'}</details>`);
}

function bookingDetailsForm(id){
 const t=trip(),b=t.bookings.find(x=>x.id===id);
 modal(`<h2>Edit booking details</h2><p class="small">Changes here do not record a payment or change the agreed cost.</p><form id="booking-details-form" data-draft-key="booking-details-${esc(id)}">${field('details-name','Booking name',b.name,'text','required maxlength="100"')}${field('details-city','City · optional',b.city||'','text','maxlength="100"')}${field('details-due','Payment due date',b.dueDate||b.serviceDate||'','date')}${field('details-start','Stay / service start · optional',b.stayStart||'','date')}${field('details-end','Stay / service end · optional',b.stayEnd||'','date')}${field('details-reason','Reason for change','','text','required maxlength="800"')}${footer('Save booking details')}</form>`);
 $('#booking-details-form').onsubmit=e=>{e.preventDefault();action(async()=>{await change(n=>{const tr=n.trips.find(x=>x.id===t.id);editBookingDetails(tr,tr.bookings.find(x=>x.id===id),{name:$('#details-name').value.trim(),city:$('#details-city').value.trim(),dueDate:$('#details-due').value,stayStart:$('#details-start').value,stayEnd:$('#details-end').value},today(),$('#details-reason').value.trim());});close();bookingOverview(id);toast('Booking details saved. Recorded money unchanged.');});};
}

function dailyModePanel(){
 if(state.fixedBudget)return `<section class="card savings-card"><h2>Fixed daily budget</h2><p>${money(fixedContext().plan.originalTarget)} starting limit · ${esc(fixedContext().plan.zone)}. Unused funded money becomes savings after each travel day.</p><button class="quiet" data-action="savings">View savings & distribution</button><button class="link" data-action="${fixedContext().plan.archived?'reopen-fixed':'fixed-plan'}">${fixedContext().plan.archived?'Reopen archived trip for corrections':'Review daily limit, dates & clock'}</button>${state.coordination?'<button class="link" data-action="new-trip">Plan another trip</button><button class="link" data-action="coordination-original-export">Download original V3 transition snapshot</button>':'<button class="link" data-action="enable-coordination">Preview shared multi-trip planning</button>'}<details><summary>Original recovery snapshot</summary><p class="small">The V2 snapshot is the notebook as it was when fixed mode began. It excludes later purchases and budget moves. Keep the current complete backup for up-to-date recovery.</p><button class="quiet" data-action="fixed-original-export">Download original pre-switch snapshot · V2</button></details></section>`;
 return `<section class="card"><h2>Daily budget style</h2><p class="small">Current mode: rolling allowance. Switch explicitly to a fixed daily limit and a separate savings balance. Your transactions and cash remain intact; a recovery snapshot is kept.</p><button class="quiet" data-action="enable-fixed" ${!trip()||!trip().included?'disabled':''}>Preview fixed daily mode</button></section>`;
}
function fixedActivationForm(){
 const t=trip(),defaultStart=today()<t.start?t.start:today(),initial=state.revision;
 modal(`<h2>Preview fixed daily mode</h2><p class="small">Your existing cash ledger stays intact. No earlier travel days earn invented savings. Existing purchases on the starting day count toward its limit without being charged again.</p><form id="fixed-activation"><div class="grid">${field('fixed-limit','Fixed daily limit in '+t.currency,t.originalTarget/100,'number','required min="0.01" step="0.01"')}${dateField('fixed-start','Begin on',defaultStart)}</div><p id="fixed-preview" class="notice" role="status"></p><label class="check-label"><input id="fixed-ack" type="checkbox" required>I reviewed the balances and want to use fixed limits and savings.</label>${footer('Switch to fixed daily mode')}</form>`);
 let candidate;
 const preview=()=>{try{candidate=activateFixedBudget(state,{tripId:t.id,start:$('#fixed-start').value,target:cents($('#fixed-limit').value),asOf:today()});const x=fixedProjection(candidate,$('#fixed-start').value);$('#fixed-preview').textContent=`Recorded money stays ${money(x.actual,state.fund.currency)}. Daily limit ${money(candidate.fixedBudget.plan.originalTarget)}. ${money(x.balances.unassigned)} not assigned to budgets. Complete V3 backups retain both original history and the new plan. Older app versions cannot read V3 backups.`;$('#fixed-activation button[type=submit]').disabled=false;}catch(e){candidate=null;$('#fixed-preview').textContent=e.message;$('#fixed-activation button[type=submit]').disabled=true;}};
 $('#fixed-limit').oninput=preview;$('#fixed-start').onchange=preview;preview();
 $('#fixed-activation').onsubmit=e=>{e.preventDefault();action(async()=>{if(state.revision!==initial)throw Error('Records changed. Open a fresh activation preview.');preview();if(!candidate||!$('#fixed-ack').checked)throw Error('Review and acknowledge the plan first.');await commit(candidate);close();toast('Fixed daily mode saved. Cash and prior history preserved.');});};
}
function fixedPoolData(pool){
 const x=fixedView(),p=x.plan;
 const paid=trip().transactions.filter(t=>(t.fundingSource||t.pool)===pool).reduce((n,t)=>n+t.base,0),unpaid=p.commitments.filter(c=>c.envelope===pool).reduce((n,c)=>n+c.unpaid,0);
 return {x,p,allocation:x.balances[pool]+paid,paid,unpaid,remaining:x.balances[pool],free:x.transferable[pool]};
}
function fixedPoolDetails(pool){
 if(pool==='savings'){savingsOverview();return;}
 const v=fixedPoolData(pool),bookings=trip().bookings.filter(b=>b.pool===pool);
 modal(`<h2>${esc(names[pool])}</h2><section class="card budget-detail tone-border-${pool}"><div class="row"><span>Total allocation</span><strong>${money(v.allocation)}</strong></div><div class="row"><span>Net paid purchases</span><strong>${money(v.paid)}</strong></div><div class="row"><span>Remaining budget</span><strong>${money(v.remaining)}</strong></div><div class="row"><span>Outstanding confirmed booking payments</span><strong>${money(v.unpaid)}</strong></div><div class="row"><span>Available to move</span><strong>${money(v.free)}</strong></div></section><p class="small">Unpaid bills are included within this remaining category budget where funded. They are not subtracted from recorded money until paid.</p>${bookings.map(b=>`<button class="booking-card" data-action="booking" data-id="${esc(b.id)}">${esc(b.name)} · ${money(bookingStatus(trip(),b).unpaid)} unpaid ›</button>`).join('')}<h3>Purchases & received refunds</h3>${entries(recentTransactions(trip()).filter(x=>(x.fundingSource||x.pool)===pool))}<button class="quiet" data-action="${v.p.archived?'reopen-fixed':'fixed-transfer'}">${v.p.archived?'Reopen to move this budget':'Choose a budget move'}</button>`);
}
function savingsOverview(){
 if(!state.fixedBudget){fixedActivationForm();return;}
 const x=fixedView(),p=x.plan;
 if(state.coordination){const label=a=>a.tripId?state.trips.find(t=>t.id===a.tripId).name+' · '+names[a.envelope]:names.unassigned;p.transfers=state.coordination.book.moves.filter(m=>m.from.tripId===state.active||m.to.tripId===state.active).map(m=>({...m,fromLabel:label(m.from),toLabel:label(m.to)}));}
 modal(`<h2>${esc(trip().name)} · savings</h2><section class="card savings-card"><span class="eyebrow">Available savings</span><strong class="fund-amount">${money(x.savingsAvailable)}</strong><p class="small">${money(x.earnedSavings)} earned from completed daily allowances. Budget moves below show where saved or set-aside money went.</p></section>${x.uncovered?`<p class="notice negative">${money(x.uncovered)} planning shortfall after corrections or overspending. No protected category was silently reduced.</p>`:''}${x.clock?.review?`<button class="notice detail-card" data-action="clock-review">Review travel clock before distributing savings ›</button>`:''}<button data-action="split-savings" ${!x.savingsAvailable||x.clock?.review||p.archived?'disabled':''}>Distribute savings</button><button class="quiet" data-action="${p.archived?'reopen-fixed':'fixed-transfer'}">${p.archived?'Reopen to move budgets':'Move available budget money'}</button><h3>Budget moves & reversals</h3>${p.transfers.length?p.transfers.slice().reverse().map(t=>`<section class="card"><div class="row"><span>${esc(t.fromLabel||names[t.from])} → ${esc(t.toLabel||names[t.to])}</span><strong>${money(t.amount)}</strong></div><p class="small">${esc(t.date)} · ${esc(t.note)}${t.reversalOf?' · Reversal':''}</p>${!p.archived&&!t.reversalOf&&!p.transfers.some(a=>a.reversalOf===t.id)?`<button class="link" data-action="reverse-fixed" data-id="${esc(t.id)}">Review reversal</button>`:''}</section>`).join(''):'<p class="small">Nothing distributed yet. You can leave all unused daily money here.</p>'}`);
}
function requirePlanningClock(){if(fixedContext().plan.archived)throw Error('Reopen the archived trip before changing its budgets.');const x=fixedView();if(x.clock?.review)throw Error('Review the travel clock before making budget moves. Recording real purchases is still available.');if(!state.coordination&&today()<fixedContext().plan.activationDate)throw Error('Budget moves become available when fixed mode begins.');}
function savingsSplitForm(){
 requirePlanningClock();const x=fixedView(),op=uid(),date=today();
 modal(`<h2>Distribute saved money</h2><p>${money(x.savingsAvailable)} available. Keep all or part in savings.</p><form id="savings-split" data-draft-key="savings-split">${state.coordination?`<label for="split-trip">Destination trip</label><select id="split-trip">${state.coordination.book.trips.filter(t=>!t.plan.archived).map(t=>`<option value="${esc(t.id)}" ${t.id===state.active?'selected':''}>${esc(t.name)}</option>`).join('')}</select>`:''}<div class="grid">${['hotels','transport','shopping','emergency','activities'].map(p=>`<div>${field('split-'+p,names[p],0,'number','required min="0" step="0.01" inputmode="decimal"')}</div>`).join('')}</div><p id="split-left" class="notice" role="status"></p>${field('split-note','Note','Distribute savings','text','required maxlength="500"')}${footer('Review allocation')}</form>`);
 const values=()=>['hotels','transport','shopping','emergency','activities'].map(to=>({to,amount:cents($('#split-'+to).value),...(state.coordination?{tripId:$('#split-trip').value}:{})}));
 const update=()=>{try{const used=values().reduce((n,a)=>n+a.amount,0);$('#split-left').textContent=money(x.savingsAvailable-used)+' stays saved. Recorded money does not change.';}catch(e){$('#split-left').textContent=e.message;}};
 document.querySelectorAll('#savings-split input').forEach(e=>e.addEventListener('input',update));update();
 $('#savings-split').onsubmit=e=>{e.preventDefault();action(async()=>{requirePlanningClock();const command={type:'split',id:op,date,allocations:values(),note:$('#split-note').value.trim(),instant:Date.now()};const candidate=fixedMove(state,command,date);fixedMovePreview(candidate,command);});};
}
function fixedMovePreview(candidate,command){
 const before=fixedView(),after=fixedProjection(candidate,today()),revision=state.revision,sourceDraft=modalKey,g=before.global,next=after.global,boundaries=g?JSON.stringify(g.dates):null;
 const shortBefore=g?g.fundingShortfall:before.fundingShortfall,shortAfter=next?next.fundingShortfall:after.fundingShortfall;
 const changes=g?g.book.trips.flatMap(t=>ENVELOPES.filter(p=>p!=='unassigned'&&g.views[t.id].balances[p]!==next.views[t.id].balances[p]).map(p=>`<div class="row"><span>${esc(t.name)} · ${esc(names[p])}</span><strong>${money(g.views[t.id].balances[p])} → ${money(next.views[t.id].balances[p])}</strong></div>`)).join('')+(g.sharedUnassigned!==next.sharedUnassigned?`<div class="row"><span>Available shared money</span><strong>${money(g.sharedUnassigned)} → ${money(next.sharedUnassigned)}</strong></div>`:''):ENVELOPES.filter(p=>before.balances[p]!==after.balances[p]).map(p=>`<div class="row"><span>${esc(names[p])}</span><strong>${money(before.balances[p])} → ${money(after.balances[p])}</strong></div>`).join('');
 modal(`<h2>Review budget move</h2><p class="notice">Recorded money stays ${money(before.actual,state.fund.currency)}.</p>${changes}${shortBefore!==shortAfter?`<div class="row"><span>Funding shortfall</span><strong>${money(shortBefore)} → ${money(shortAfter)}</strong></div><p class="small">This transfer covers existing backing first; the same money is never available twice.</p>`:''}<p class="small">This changes budgets, not expenses or income. Daily limits stay fixed.</p><form id="confirm-fixed-move">${footer('Confirm budget move')}</form>`);
 $('#confirm-fixed-move').onsubmit=e=>{e.preventDefault();action(async()=>{if(revision!==state.revision||(g?JSON.stringify(coordinatedProjection(state,{instant:Date.now()}).dates)!==boundaries:command.date!==today()))throw Error('Records or a travel day changed. Review this move again.');requirePlanningClock();await commit(candidate);drafts.delete(sourceDraft);persistDrafts();close();toast('Budget move saved. Recorded cash unchanged.');});};
}
function fixedTransferForm(){
 requirePlanningClock();const x=fixedView(),op=uid(),date=today(),g=x.global;
 const trips=g?g.book.trips.filter(t=>!t.plan.archived):[];
 const selector=(id,label)=>g?`<label for="${id}">${label}</label><select id="${id}">${trips.map(t=>`<option value="${esc(t.id)}" ${t.id===state.active?'selected':''}>${esc(t.name)}</option>`).join('')}</select>`:'';
 modal(`<h2>Move budget money</h2><p class="small">Only unspent, uncommitted money can move. Daily limits and unpaid bills stay protected. A shared available balance belongs to the whole notebook.</p><form id="fixed-transfer">${selector('from-trip','Source trip')}<label for="fixed-from">From budget</label><select id="fixed-from">${options(ENVELOPES,'savings')}</select>${selector('to-trip','Destination trip')}<label for="fixed-to">To budget</label><select id="fixed-to">${options(ENVELOPES,'daily')}</select><p id="transfer-available" class="notice" role="status"></p><p class="small">Freely movable amounts exclude backing gaps. A reviewed transfer may also use reserved money when it directly reduces an existing shortfall.</p>${field('fixed-transfer-amount','Amount in '+state.fund.currency,'','number','required min="0.01" step="0.01" inputmode="decimal"')}${field('fixed-transfer-note','Reason','','text','required maxlength="500"')}<label id="emergency-ack-label" class="check-label" hidden><input id="emergency-ack" type="checkbox">I choose to reduce my emergency reserve.</label>${footer('Review move')}</form>`);
 const update=()=>{const source=$('#fixed-from').value,sourceTrip=$('#from-trip')?.value,view=g?.views[sourceTrip];let available=view?Math.max(0,view.transferable[source]-(g.uncovered-view.uncovered)-(g.commitmentShortfall-view.commitmentShortfall)):x.transferable[source];if(g&&source==='unassigned')available=g.availableToAllocate;$('#transfer-available').textContent=money(available)+' available from '+names[source]+'. Future daily limits and unpaid bills are reserved.';$('#emergency-ack-label').hidden=source!=='emergency';$('#emergency-ack').required=source==='emergency';if(g){$('#from-trip').disabled=source==='unassigned';$('#to-trip').disabled=$('#fixed-to').value==='unassigned';}};
 ['fixed-from','fixed-to','from-trip','to-trip'].forEach(id=>{if($('#'+id))$('#'+id).onchange=update;});update();
 $('#fixed-transfer').onsubmit=e=>{e.preventDefault();action(async()=>{requirePlanningClock();const command={id:op,date,from:$('#fixed-from').value,to:$('#fixed-to').value,amount:cents($('#fixed-transfer-amount').value),note:$('#fixed-transfer-note').value.trim(),acknowledgeEmergency:$('#emergency-ack').checked,...(g?{fromTripId:$('#from-trip').value,toTripId:$('#to-trip').value,instant:Date.now()}: {})};const candidate=fixedMove(state,command,date);fixedMovePreview(candidate,command);});};
}
function reverseFixedForm(id){
 requirePlanningClock();if(!state.coordination){const command={type:'reverse',originalId:id,id:uid(),date:today(),note:'Reverse mistaken budget move'};fixedMovePreview(fixedMove(state,command,today()),command);return;}
 const original=state.coordination.book.moves.find(m=>m.id===id);if(!original)throw Error('Budget move not found.');const emergency=original.to.envelope==='emergency';
 modal(`<h2>Review reversal</h2><p class="small">Return ${money(original.amount)} only if the destination still has unspent, uncommitted money. The original move stays in history.</p><form id="reverse-coordinated">${field('reverse-note','Reason','Reverse mistaken budget move','text','required maxlength="500"')}${emergency?'<label class="check-label"><input id="reverse-emergency" type="checkbox" required>I choose to reduce the emergency reserve.</label>':''}${footer('Review reversal')}</form>`);
 $('#reverse-coordinated').onsubmit=e=>{e.preventDefault();action(async()=>{const command={type:'reverse',originalId:id,id:uid(),date:today(),note:$('#reverse-note').value.trim(),acknowledgeEmergency:!!$('#reverse-emergency')?.checked,instant:Date.now()};fixedMovePreview(fixedMove(state,command,today()),command);});};
}
function fixedDailyDetails(){const x=fixedView(),t=trip();modal(`<h2>Today's fixed daily limit</h2><section class="card"><div class="row"><span>Daily limit</span><strong>${money(x.target)}</strong></div><div class="row"><span>Daily-funded spending</span><strong>${money(x.spentToday)}</strong></div><div class="row"><span>Backed amount left today</span><strong>${money(x.backedLeftToday)}</strong></div></section><p class="small">Shopping or hotel purchases paid from their own budgets do not consume this daily allowance. Unused funded money becomes savings after the travel day ends.</p>${x.dailyFundingShortfall?`<p class="notice negative">${money(x.dailyFundingShortfall)} needed to back the planned daily limits. The displayed target has not been silently lowered.</p>`:''}${entries(recentTransactions(t).filter(a=>a.date===today()&&(a.fundingSource||a.pool)==='daily'))}<button data-action="${t.closed?'reopen-fixed':'expense'}">${t.closed?'Reopen for correction':'Add expense'}</button><button class="quiet" data-action="${t.closed?'reopen-fixed':'fixed-transfer'}">${t.closed?'Reopen to move budgets':'Choose how to cover overspending'}</button><button class="link" data-action="fixed-plan">Review future limits</button>`);}
function fixedClockForm(){const p=fixedContext().plan;modal(`<h2>Review travel clock</h2><p class="notice">${esc(p.clockReview?.reason||fixedView().clock?.reason||'Check the current destination date and missing purchases.')}</p><p>Travel day: ${esc(today())} · ${esc(p.zone)}. Transaction dates will not be relabeled.</p><form id="fixed-clock-form">${field('clock-note','What you checked','','text','required maxlength="500"')}${footer('Confirm clock and continue')}</form>`);$('#fixed-clock-form').onsubmit=e=>{e.preventDefault();action(async()=>{await commit(reviewFixedClock(state,Date.now(),$('#clock-note').value.trim()));close();toast('Travel clock reviewed. Existing cash records unchanged.');});};}
function fixedPlanForm(){
 if(fixedContext().plan.archived){reopenFixedForm();return;}
 const p=fixedContext().plan,date=today(),tomorrow=new Date((dayNumber(date)+1)*86400000).toISOString().slice(0,10);
 modal(`<h2>Daily plan & trip dates</h2><p class="small">Starting daily limit ${money(p.originalTarget)}. Changes are explicit and audited. Future date extensions require backing; they never create cash.</p><form id="fixed-plan-form">${field('plan-limit','Daily limit',p.targets.slice().sort((a,b)=>b.date.localeCompare(a.date))[0].amount/100,'number','required min="0" step="0.01"')}${dateField('plan-effective','Limit effective from',(tomorrow<p.activationDate?p.activationDate:tomorrow)<=p.end?(tomorrow<p.activationDate?p.activationDate:tomorrow):date)}${dateField('plan-end','Trip end',p.end)}${field('plan-zone','Travel time zone',p.zone,'text','required maxlength="100"')}${field('plan-reason','Reason','','text','required maxlength="500"')}${footer('Review plan change')}</form>`);
 $('#fixed-plan-form').onsubmit=e=>{e.preventDefault();action(async()=>{const reason=$('#plan-reason').value.trim(),effective=$('#plan-effective').value;let candidate=changeFixedDates(state,{end:$('#plan-end').value,zone:$('#plan-zone').value,reason},date);candidate=fixedTarget(candidate,{date:effective,amount:cents($('#plan-limit').value),reason},date);settleFixedFunding(candidate,date);const x=fixedProjection(candidate,date),rev=state.revision,sourceDraft=modalKey,newLimit=cents($('#plan-limit').value);modal(`<h2>Review daily plan</h2><p>Recorded money stays ${money(x.actual)}. New limit ${money(newLimit)} from ${esc(effective)}.</p><p class="notice">${x.dailyFundingShortfall?money(x.dailyFundingShortfall)+' of daily limits is not backed yet.':'Daily limits remain backed.'}${x.clock?.review?' A travel-clock review is required.':''}</p><form id="confirm-plan">${footer('Confirm plan change')}</form>`);$('#confirm-plan').onsubmit=e=>{e.preventDefault();action(async()=>{if(state.revision!==rev)throw Error('Records changed; review again.');await commit(candidate);drafts.delete(sourceDraft);persistDrafts();close();toast('Daily plan change saved. Cash unchanged.');});};});};
}
function fixedMoneyDetails(){const x=moneyView();modal(`<h2>Travel money breakdown</h2><h3>${money(x.actual,state.fund.currency)}</h3>${ENVELOPES.map(p=>`<div class="row"><span>${esc(names[p])}</span><strong>${money(x.balances[p])}</strong></div>`).join('')}${x.uncovered?`<div class="row negative"><span>Uncovered planning shortfall</span><strong>−${money(x.uncovered)}</strong></div>`:''}<p class="small">Every amount is included once. Available to allocate: ${money(x.transferable.unassigned)}. Confirmed unpaid bills are nested within their category; pending refunds are excluded from recorded money.</p><button class="quiet" data-action="${x.plan.archived?'reopen-fixed':'fixed-transfer'}">${x.plan.archived?'Reopen to move budgets':'Review a budget move'}</button><button class="link" data-action="fund">Record money / compare balance</button>`);}
function categoryTotalDetails(pool){const b=moneyBreakdown(state),c=state.fund.currency,total=b.trips.reduce((n,t)=>n+(t.pools.find(p=>p.pool===pool)?.amount||0),0);modal(`<h2>${esc(names[pool])} · all live trips</h2><h3>${money(total,c)} assigned</h3><p class="small">This is a grouping of your trip budgets, not extra money. Open a trip for its paid, unpaid and available breakdown.</p>${b.trips.map(t=>`<button class="money-row" data-action="money-trip" data-id="${esc(t.id)}" data-pool="${pool}"><span>${esc(t.name)}</span><strong>${money(t.pools.find(p=>p.pool===pool)?.amount||0,c)} ›</strong></button>`).join('')}`);}
function confirmEstimateForm(id){const t=trip(),b=t.bookings.find(b=>b.id===id);modal(`<h2>Confirm booking cost</h2><p>${esc(b.name)} · estimate ${money(b.total)}. This reserves the unpaid bill within its budget; it does not deduct cash.</p><form id="confirm-estimate-form">${field('confirmed-total','Agreed total in '+t.currency,b.total/100,'number','required min="0" step="0.01"')}${field('confirmed-note','Confirmation note','','text','required maxlength="500"')}${footer('Confirm agreed cost')}</form>`);$('#confirm-estimate-form').onsubmit=e=>{e.preventDefault();action(async()=>{await change(n=>{const tr=n.trips.find(x=>x.id===t.id);confirmBooking(tr,tr.bookings.find(x=>x.id===id),{total:cents($('#confirmed-total').value),date:today(),note:$('#confirmed-note').value.trim()});});close();bookingOverview(id);toast('Booking confirmed. Cash unchanged.');});};}

function reopenFixedForm(){const t=state.trips.find(t=>t.id===fixedContext().tripId);modal(`<h2>Reopen ${esc(t.name)}?</h2><p class="small">This makes the same trip editable for corrections. It does not create money, change dates, restart daily allowances or add another trip.</p><form id="reopen-fixed-form">${field('reopen-note','Reason','','text','required maxlength="800"')}${footer('Reopen preserved trip')}</form>`);$('#reopen-fixed-form').onsubmit=e=>{e.preventDefault();action(async()=>{await commit(reopenFixedTrip(state,{date:dateInZone(fixedContext().plan.zone),reason:$('#reopen-note').value.trim()}));close();toast('Original trip reopened. Cash and history preserved.');});};}

function renderCompletedTrip(t,s){
 const summary=completedTripSummary(t,s.fixed),unresolved=summary.unpaid||summary.pendingRefund;
 $('#main').innerHTML=`${fundCard()}<div class="row"><h1>${esc(t.name)}</h1><span class="pill">${t.closed?'Archived':'Trip completed'}</span></div><p class="sub">${esc(t.start)} → ${esc(t.end)} · History preserved</p><section class="card completion-card"><div class="completion-title"><span aria-hidden="true">✓</span><h2>Trip summary</h2></div><div class="completion-metrics"><button class="completion-stat spending-stat" data-action="trip-history"><span class="small">Net spending</span><strong>${money(summary.net)}</strong><span class="small">${summary.purchases} purchases ›</span></button>${summary.savings!==null?`<button class="completion-stat savings-stat" data-action="savings"><span class="small">Still saved</span><strong>${money(summary.savings)}</strong><span class="small">View savings ›</span></button>`:''}<button class="completion-stat" data-action="trip-history"><span class="small">Refunds received</span><strong>${money(summary.refunds)}</strong><span class="small">${summary.refundRecords} records ›</span></button></div><p class="small">${t.closed?'Your records and balances are preserved. Reopen to make a correction.':'Your daily plan has ended. Review any missing purchases before archiving.'}${summary.earnedSavings!==null?' '+money(summary.earnedSavings)+' saved from completed days. Distributed savings stay in their chosen budgets.':''}</p><div class="completion-actions"><button data-action="trip-history">View spending history</button>${t.closed?(state.fixedBudget?'<button class="quiet" data-action="reopen-fixed">Reopen for a correction</button>':'<button class="quiet" data-tab="trip">View preserved trip details</button>'):'<button class="quiet" data-action="close-trip">Review trip completion</button>'}</div></section>${s.fixed?.clock?.review?'<button class="notice negative detail-card" data-action="clock-review">Review travel clock before relying on final savings ›</button>':''}${unresolved?`<p class="notice negative">${money(summary.unpaid)} confirmed bills remain unpaid · ${money(summary.pendingRefund)} refunds pending. Pending refunds are excluded from recorded money.</p>`:''}<button class="quiet" data-tab="trip">View preserved budgets & bookings ›</button>${state.backupNeeded?'<button class="link" data-tab="settings">Changes need a fresh backup →</button>':''}`;
}

function referenceLibraryPanel(){const archives=(state.referenceFunds||[]).filter(a=>a.notebook);return archives.length?`<section class="card"><h2>Preserved reference notebooks</h2><p class="small">Frozen source money, savings and history. These do not affect live balances.</p>${archives.map(a=>`<button class="money-row" data-action="reference-view" data-id="${esc(a.id)}"><span>${esc(a.notebook.trips.find(t=>t.included)?.name||'Imported notebook')}</span><strong>View reference ›</strong></button>`).join('')}</section>`:'';}
function referenceOverview(id){const archive=state.referenceFunds.find(a=>a.id===id),v=fixedReferenceSummary(archive),copies=state.trips.filter(t=>t.archiveId===id);modal(`<h2>Reference notebook</h2><p class="notice">Frozen copy · No effect on your live money. Source travel date ${esc(v.date)}. To edit a recovered copy, restore its complete backup in a separate empty notebook.</p><section class="card"><span class="eyebrow">Source recorded money · ${esc(v.currency)}</span><strong class="fund-amount">${money(v.actual,v.currency)}</strong><p class="small">This amount is informational and is never added to the current fund.</p></section><section class="card savings-card"><div class="row"><span>Source savings kept</span><strong>${money(v.balances.savings,v.currency)}</strong></div><p class="small">${money(v.earnedSavings,v.currency)} earned on completed source days. This snapshot does not accrue new savings.</p></section>${v.uncovered?`<p class="notice negative">Source planning shortfall: ${money(v.uncovered,v.currency)}.</p>`:''}${v.clockReview?'<p class="notice">The source had a pending clock review. Its saved boundary is preserved.</p>':''}<details><summary>Source budget breakdown</summary>${ENVELOPES.map(p=>`<div class="row"><span>${esc(names[p])}</span><strong>${money(v.balances[p],v.currency)}</strong></div>`).join('')}</details><h3>Read-only purchases & bookings</h3>${copies.map(t=>`<button class="money-row" data-action="reference-history" data-trip="${esc(t.id)}"><span>${esc(t.name)}</span><strong>${t.transactions.length} records ›</strong></button>`).join('')}<details><summary>Source booking summaries</summary>${v.trips.map(t=>t.bookings.map(b=>`<p class="small">${esc(b.name)}${b.city?' · '+esc(b.city):''} · ${b.estimated?'Estimate':b.cancelled?'Cancelled':'Confirmed'}<br>${money(b.net,t.currency)} net paid · ${money(b.unpaid,t.currency)} unpaid · ${money(b.pendingRefund,t.currency)} refund pending</p>`).join('')).join('')||'<p class="small">No source bookings.</p>'}</details><details><summary>Preserved allocation & plan history</summary>${v.transfers.map(t=>`<p class="small">${esc(t.date)} · ${esc(t.fromLabel||names[t.from])} → ${esc(t.toLabel||names[t.to])} · ${money(t.amount,v.currency)}<br>${esc(t.note)}</p>`).join('')}${v.audit.map(a=>`<p class="small">${esc(a.date)} · ${esc(a.type)} · ${esc(a.reason||'')}</p>`).join('')||(!v.transfers.length?'<p class="small">No source plan changes.</p>':'')}</details><button class="quiet" data-action="reference-export" data-id="${esc(id)}">Download preserved complete backup</button>`);}

function coordinationForm(){
 const revision=state.revision;let candidate;
 try{candidate=activateCoordination(state,{instant:Date.now(),reason:'Enable shared multi-trip planning'});}catch(e){modal(`<h2>Prepare multiple trips</h2><p class="notice">${esc(e.message)}</p><p class="small">Your current notebook stays unchanged. Resolve the issue, then review this transition again.</p>`);return;}
 const g=coordinatedProjection(candidate,{instant:Date.now()});
 modal(`<h2>One fund, independent trips</h2><p>Recorded travel money stays <strong>${money(g.actual,state.fund.currency)}</strong>.</p><p class="small">Each trip keeps its own daily limit, saved money and booking protection. New trips use available shared money. Transfers change budgets, never cash.</p><div class="notice">Your current V3 notebook is preserved in a recovery snapshot. Future complete backups use V4; older app versions cannot read them. Your existing purchases and history stay intact.</div><form id="enable-coordination-form"><label class="check-label"><input id="coordination-ack" type="checkbox" required>I understand the recovery format changes to V4.</label>${footer('Enable shared trip planning')}</form>`);
 $('#enable-coordination-form').onsubmit=e=>{e.preventDefault();action(async()=>{if(state.revision!==revision||!$('#coordination-ack').checked)throw Error('Review a fresh transition preview.');const verified=activateCoordination(state,{instant:Date.now(),reason:'Enable shared multi-trip planning'});await commit(verified);close();toast('Shared planning enabled. Original cash and history preserved.');coordinatedTripForm();});};
}
function coordinatedTripForm(){
 const g=coordinatedProjection(state,{instant:Date.now()}),revision=state.revision,source=trip();
 modal(`<h2>Plan another trip</h2><p class="notice">${money(g.availableToAllocate,state.fund.currency)} available to allocate across all trips. Existing budgets stay protected.</p><form id="coordinated-trip-form">${field('new-trip-name','Trip name','','text','required maxlength="100"')}${dateField('new-trip-start','Start',today())}${dateField('new-trip-end','End',today())}${field('new-trip-zone','Destination time zone',source?.zone||'Asia/Shanghai','text','required maxlength="100"')}${field('new-trip-target','Fixed daily limit in '+state.fund.currency,'','number','required min="0.01" step="0.01" inputmode="decimal"')}<p id="new-trip-daily" class="small" role="status"></p><div class="grid">${['hotels','transport','emergency','shopping','activities'].map(p=>`<div>${field('new-trip-'+p,names[p],0,'number','required min="0" step="0.01" inputmode="decimal"')}</div>`).join('')}</div><p class="small">The full daily plan is funded at creation. Future trips do not earn savings before their start. Trip planning uses ${esc(state.fund.currency)}; purchases may use local currencies.</p>${footer('Review trip allocation')}</form>`);
 const values=()=>{const start=$('#new-trip-start').value,end=$('#new-trip-end').value,zone=$('#new-trip-zone').value.trim(),target=cents($('#new-trip-target').value||0),first=start>dateInZone(zone)?start:dateInZone(zone),days=Math.max(0,dayNumber(end)-dayNumber(first)+1);return {name:$('#new-trip-name').value.trim(),start,end,zone,target,opening:{daily:days*target,...Object.fromEntries(['hotels','transport','emergency','shopping','activities'].map(p=>[p,cents($('#new-trip-'+p).value)]))},instant:Date.now()};};
 const update=()=>{try{const v=values(),total=Object.values(v.opening).reduce((n,x)=>n+x,0);$('#new-trip-daily').textContent=`Daily plan ${money(v.opening.daily)} · Total allocation ${money(total)} · Shared money left ${money(g.availableToAllocate-total)}.`;}catch{$('#new-trip-daily').textContent='Choose valid dates, time zone and amounts.';}};document.querySelectorAll('#coordinated-trip-form input').forEach(e=>e.addEventListener('input',update));update();
 $('#coordinated-trip-form').onsubmit=e=>{e.preventDefault();action(async()=>{if(state.revision!==revision)throw Error('Records changed. Open a fresh trip preview.');const v=values(),candidate=addCoordinatedTrip(state,v),after=coordinatedProjection(candidate,{instant:Date.now()}),sourceDraft=modalKey,day=dateInZone(v.zone);
 modal(`<h2>Review ${esc(v.name)}</h2><p>${esc(v.start)} → ${esc(v.end)} · ${esc(v.zone)}</p><div class="notice">Recorded money stays ${money(after.actual,state.fund.currency)}. Available shared money becomes ${money(after.availableToAllocate,state.fund.currency)}.</div>${Object.entries(v.opening).filter(([,n])=>n).map(([p,n])=>`<div class="row"><span>${esc(names[p])}</span><strong>${money(n)}</strong></div>`).join('')}<p class="small">Your other trips’ limits and savings stay unchanged. This is an allocation, not an expense.</p><form id="confirm-coordinated-trip">${footer('Create funded trip')}</form>`);
 $('#confirm-coordinated-trip').onsubmit=e=>{e.preventDefault();action(async()=>{if(state.revision!==revision||dateInZone(v.zone)!==day)throw Error('Records or the destination date changed. Review again.');await commit(candidate);drafts.delete(sourceDraft);persistDrafts();tab='today';close();render();toast('Trip created. Shared cash unchanged.');});};});};
}
function coordinatedCategoryDetails(pool){
 const g=coordinatedProjection(state,{instant:Date.now()});modal(`<h2>${esc(names[pool])} · every trip</h2><h3>${money(g.balances[pool],state.fund.currency)} remaining</h3><p class="small">These are portions of the same recorded money. Open a trip for its allocation, payments, unpaid bookings and available budget.</p>${g.book.trips.map(t=>`<button class="money-row" data-action="money-trip" data-id="${esc(t.id)}" data-pool="${esc(pool)}"><span>${esc(t.name)}${t.plan.archived?' · Archived':''}</span><strong>${money(g.views[t.id].balances[pool],state.fund.currency)} ›</strong></button>`).join('')}`);
}
function renderUpcomingTrip(t,s){
 const x=s.fixed,first=x.days.find(d=>d.date===x.plan.activationDate),limit=first?.target||x.plan.originalTarget;
 $('#main').innerHTML=`${fundCard()}<div class="row"><h1>${esc(t.name)}</h1><span class="pill">Upcoming</span></div><p class="sub">${esc(t.start)} → ${esc(t.end)} · ${esc(t.zone)}</p><section class="card"><h2>${x.dailyFundingShortfall?'Review daily backing':'Your trip is funded'}</h2>${x.dailyFundingShortfall?`<p class="notice negative">${money(x.dailyFundingShortfall)} more is needed to back the daily plan. Choose an available budget; no money is moved automatically.</p>`:''}${x.clock?.review?'<button class="notice detail-card" data-action="clock-review">Review travel clock ›</button>':''}<div class="row"><span>Fixed daily limit from ${esc(x.plan.activationDate)}</span><strong>${money(limit)}</strong></div><div class="row"><span>Daily budget held for this trip</span><strong>${money(x.balances.daily)}</strong></div><p class="small">Savings start accumulating after each funded travel day ends. No allowance is available before the daily plan starts.</p><button class="quiet" data-action="fixed-plan">Review dates & daily limit</button></section><div class="pool-strip">${['hotels','transport','emergency'].map(p=>`<button class="card detail-card" data-action="pool-detail" data-pool="${p}"><span class="small">${esc(names[p])}</span><strong>${money(x.balances[p])}</strong><span class="small">View breakdown ›</span></button>`).join('')}</div>${bookingCards()}<button class="quiet" data-action="expense">Record a purchase already paid</button><button class="link" data-action="fixed-transfer">Review a budget move</button><p class="small">Future bills belong in Bookings. Only record expenses when money has actually been paid.</p>`;
}
