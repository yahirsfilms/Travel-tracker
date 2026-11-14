import {
  POOLS,
  uid,
  cents,
  convert,
  dayNumber,
  dateInZone,
  balance,
  summary,
  validate,
  backup,
  csv,
} from "./core.js";
import { read, write } from "./db.js";
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
  validate(backup(next.trips));
  state = await write(next, state.revision);
  render();
}
async function change(fn) {
  const next = structuredClone(state);
  fn(next);
  if (JSON.stringify(next.trips) !== JSON.stringify(state.trips))
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
function render() {
  status();
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const t = trip();
  $("#trip-picker").textContent = t ? "Trips ▾" : "New trip +";
  if (!t) {
    $("#main").innerHTML =
      `<div class="empty"><div class="big">↗</div><div class="eyebrow">A little planning. More exploring.</div><h1>Your next trip,<br>within reach.</h1><p>A simple travel notebook for your budget. Your records stay on this device, even when you go offline.</p><button data-action="new-trip">Plan a trip</button><button class="link" data-action="import">Restore a backup</button></div>`;
    return;
  }
  const date = today(),
    s = summary(t, date);
  if (tab === "today") {
    $("#main").innerHTML =
      `<div class="row"><div class="eyebrow">${esc(t.name)}</div><span class="pill">${s.status}</span></div><h1>${s.status === "Completed" ? "A trip to remember." : s.status === "Upcoming" ? "Adventure ahead." : "Enjoy the journey."}</h1><p class="sub">${esc(date)} · ${s.status === "Completed" ? "Trip summary" : s.days + " days " + (s.status === "Upcoming" ? "in your trip" : "including today")}</p><div class="hero"><div class="eyebrow">${s.status === "Completed" ? "Daily pool left" : s.status === "Upcoming" ? "First day’s allowance" : "Remaining today"}</div><div class="amount ${s.remaining < 0 ? "negative" : ""}">${money(s.status === "Completed" ? balance(t, "daily") : s.status === "Upcoming" ? s.allowance : s.remaining)}</div><div class="row"><div><div class="small" style="color:#c0d3c4">Daily allowance</div><strong>${money(s.allowance)}</strong></div><div><div class="small" style="color:#c0d3c4">Spent ${s.status === "Upcoming" ? "on first day" : "today"}</div><strong>${money(s.spent)}</strong></div></div></div><div class="row small"><span>${s.tomorrow === null ? "Final day — no future redistribution" : "Next day’s projected allowance"}</span><strong>${s.tomorrow === null ? "" : money(s.tomorrow)}</strong></div><button class="primary" data-action="expense">＋ Add expense</button><div class="row"><h2>Your other budgets</h2><button class="link" data-tab="trip">View all →</button></div><div class="grid">${["hotels", "transport", "emergency"].map((p) => `<div class="card"><div class="small">${poolIcon(p)} ${names[p]}</div><div class="metric ${balance(t, p) < 0 ? "negative" : ""}">${money(balance(t, p))}</div><div class="small">remaining</div></div>`).join("")}</div><div class="section"><h2>Recent expenses</h2>${entries([...t.transactions].reverse().slice(0, 4))}</div>`;
  } else if (tab === "history") {
    $("#main").innerHTML =
      `<div class="eyebrow">${esc(t.name)}</div><div class="row"><h1>Your travel trail.</h1><button data-action="expense">＋ Add</button></div><p class="sub">Every little stop, all in one place.</p><div class="toolbar"><input id="search" aria-label="Search expenses" placeholder="Search expenses" value="${esc(query)}"><select id="pool-filter" aria-label="Filter budget pool"><option value="">All budgets</option>${options(POOLS, filter)}</select></div><div id="entries"></div>`;
    renderEntries();
  } else {
    $("#main").innerHTML =
      `<div class="eyebrow">Trip overview</div><h1>${esc(t.name)}</h1><p class="sub">${esc(t.start)} → ${esc(t.end)} · ${esc(t.currency)}<br>${esc(t.zone)}</p><div class="row"><h2>Budget, your way.</h2><button class="quiet" data-action="adjust">Adjust budget</button></div><div class="notice">Each pool stays separate. Daily savings and overspending spread evenly across the remaining days.</div>${POOLS.map(
        (p) => {
          const b = balance(t, p),
            total =
              t.budgets[p] +
              t.adjustments
                .filter((a) => a.pool === p)
                .reduce((s, a) => s + a.amount, 0);
          return `<div class="card"><div class="row"><strong>${names[p]}</strong><strong class="${b < 0 ? "negative" : ""}">${money(b)}</strong></div><div class="progress"><span style="width:${Math.max(0, Math.min(100, total > 0 ? ((total - b) / total) * 100 : 0))}%"></span></div><div class="small" style="margin-top:9px">${money(total - b)} spent of ${money(total)} · ${money(t.reserved?.[p] || 0)} reserved, unpaid</div>${t.reserved?.[p] ? `<div class="small">After reservations: ${money(b - t.reserved[p])}</div>` : ""}</div>`;
        },
      ).join(
        "",
      )}<div class="actions"><button class="quiet" data-action="settings">Trip settings</button><button class="quiet" data-action="reserve">Reservations</button></div><div class="section"><h2>Budget adjustment history</h2>${
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
      }</div><div class="card backup"><h2>A copy for safekeeping.</h2><p class="small">Backups include all trips. Save the JSON file to Files on your iPhone. CSV is for spreadsheets and cannot restore the app.</p><p class="small">Last export prepared: ${state.lastBackup ? esc(new Date(state.lastBackup).toLocaleString()) : "No backup yet"}</p>${state.backupNeeded || !state.lastBackup ? '<div class="notice">Keep a fresh backup: you have records that need an export.</div>' : ""}<div class="stack"><button data-action="export">Export all trips · JSON</button><button class="quiet" data-action="import">Restore backup</button><button class="quiet" data-action="csv">Export this trip · CSV</button></div></div><p class="small">Private by design. No financial records are sent to a server. Clearing website data can remove records. Keep a backup outside the app.</p>`;
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
  const t = edit ? trip() : null;
  const d = new Date().toISOString().slice(0, 10);
  modal(
    `<h2>${edit ? "Trip settings" : "Where to next?"}</h2><form id="trip-form">${field("name", "Trip name", t?.name || "", "text", 'required maxlength="100" placeholder="China summer trip"')}<div class="grid"><div>${dateField("start", "First day", t?.start || d)}</div><div>${dateField("end", "Last day", t?.end || d)}</div></div><label for="currency">Planning currency</label><select id="currency" ${edit ? "disabled" : ""}>${options(currencies, t?.currency || "USD")}</select>${field("zone", "Trip time zone", t?.zone || "Asia/Shanghai", "text", 'required placeholder="Asia/Shanghai"')}<p class="small">Use an IANA time zone, such as Asia/Shanghai or America/Los_Angeles.${edit ? " Planning currency is fixed to preserve recorded conversions." : ""}</p>${edit ? "" : `<div class="grid">${POOLS.map((p) => `<div>${field(p, names[p] + " budget", "0", "number", 'required min="0" step="0.01" inputmode="decimal"')}</div>`).join("")}</div>`}${footer(edit ? "Save settings" : "Create trip")}</form>`,
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
      if (edit && t.transactions.some((x) => x.date < start || x.date > end))
        throw Error("Dates must include existing expenses.");
      await change((n) => {
        if (edit)
          Object.assign(
            n.trips.find((x) => x.id === t.id),
            { name, start, end, zone },
          );
        else {
          const id = uid();
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
  const t = trip(),
    old = t.transactions.find((x) => x.id === id),
    defDate =
      [t.start, today()].sort().at(-1) > t.end
        ? t.end
        : [t.start, today()].sort().at(-1);
  modal(
    `<h2>${old ? "Edit expense" : "A little stop along the way."}</h2><form id="expense-form"><div class="grid"><div>${field("amount", "Amount", old ? Math.abs(old.amount) / 100 : "", "number", 'required min="0.01" step="0.01" inputmode="decimal" autofocus')}</div><div><label for="expense-currency">Currency</label><select id="expense-currency">${options(currencies, old?.currency || t.expenseCurrency || t.currency)}</select></div></div><label for="kind">Record type</label><select id="kind"><option value="expense">Expense</option><option value="refund" ${old?.amount < 0 ? "selected" : ""}>Refund · returns money to this pool</option></select><div class="grid"><div><label for="category">Category</label><select id="category">${options(["Food & drink", "Activities", "Shopping", "Hotel", "Transportation", "Emergency", "Other"], old?.category || "Food & drink")}</select></div><div><label for="pool">Budget pool</label><select id="pool">${options(POOLS, old?.pool || "daily")}</select></div></div>${dateField("date", "Date", old?.date || defDate)}${field("rate", `1 expense currency = how many ${t.currency}?`, old?.rate || t.rates?.[t.expenseCurrency] || 1, "number", 'required min="0.000001" max="1000000" step="any" inputmode="decimal"')}<p class="small" id="conversion"></p>${field("note", "Note · optional", old?.note || "", "text", 'maxlength="1000" placeholder="Noodles near the station"')}${footer(old ? "Save changes" : "Save expense")}${old ? '<button type="button" class="danger" style="width:100%;margin-top:12px" data-action="delete-expense" data-id="' + esc(id) + '">Delete expense</button>' : ""}</form>`,
  );
  const update = () => {
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
  $("#category").onchange = () => {
    $("#pool").value =
      { Hotel: "hotels", Transportation: "transport", Emergency: "emergency" }[
        $("#category").value
      ] || "daily";
  };
  update();
  $("#expense-form").onsubmit = async (e) => {
    e.preventDefault();
    await action(async () => {
      const amount =
          cents($("#amount").value) * ($("#kind").value === "refund" ? -1 : 1),
        currency = $("#expense-currency").value,
        rate = Number($("#rate").value);
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
      };
      await change((n) => {
        const tr = n.trips.find((x) => x.id === t.id);
        if (old)
          tr.transactions[tr.transactions.findIndex((x) => x.id === old.id)] =
            record;
        else tr.transactions.push(record);
        tr.rates = { ...tr.rates, [currency]: rate };
        tr.expenseCurrency = currency;
      });
      close();
      toast("Saved on your device");
    });
  };
}
function adjustForm() {
  modal(
    `<h2>Adjust your budget</h2><p class="small">Add funds, reduce a budget, or transfer between pools. Your expenses stay intact.</p><form id="adjust-form"><label for="mode">Change</label><select id="mode"><option value="add">Add money</option><option value="remove">Remove money</option><option value="transfer">Transfer between pools</option></select><label for="from">Pool / transfer from</label><select id="from">${options(POOLS, "daily")}</select><label for="to">Transfer to · used only for transfers</label><select id="to">${options(POOLS, "emergency")}</select>${field("adjust-amount", "Amount in " + trip().currency, "", "number", 'required min="0.01" step="0.01" inputmode="decimal"')}${field("reason", "Reason", "", "text", 'required maxlength="1000"')}${footer("Apply adjustment")}</form>`,
  );
  $("#adjust-form").onsubmit = async (e) => {
    e.preventDefault();
    await action(async () => {
      const amount = cents($("#adjust-amount").value),
        from = $("#from").value,
        to = $("#to").value,
        mode = $("#mode").value,
        note = $("#reason").value.trim();
      if (!note) throw Error("Add a reason for your records.");
      if (mode === "transfer" && from === to)
        throw Error("Choose different pools.");
      const total =
        trip().budgets[from] +
        trip()
          .adjustments.filter((a) => a.pool === from)
          .reduce((s, a) => s + a.amount, 0);
      if (mode !== "add" && total < amount)
        throw Error("The pool’s budget cannot be negative.");
      await change((n) => {
        const t = n.trips.find((t) => t.id === n.active);
        t.adjustments.push({
          id: uid(),
          date: today(),
          pool: from,
          amount: mode === "add" ? amount : -amount,
          note,
        });
        if (mode === "transfer")
          t.adjustments.push({
            id: uid(),
            date: today(),
            pool: to,
            amount,
            note: "Transfer: " + note,
          });
      });
      close();
      toast("Budget updated. History preserved.");
    });
  };
}
function reservations() {
  modal(
    `<h2>Reserved, not paid.</h2><p class="small">Planning holds for upcoming bills. When you pay, record an expense and reduce the hold here. Holds do not count as expenses.</p><form id="res-form">${["hotels", "transport", "emergency"].map((p) => field("res-" + p, names[p], (trip().reserved?.[p] || 0) / 100, "number", 'required min="0" step="0.01" inputmode="decimal"')).join("")}${footer()}</form>`,
  );
  $("#res-form").onsubmit = async (e) => {
    e.preventDefault();
    await action(async () => {
      await change(
        (n) =>
          (n.trips.find((t) => t.id === n.active).reserved = Object.fromEntries(
            ["hotels", "transport", "emergency"].map((p) => [
              p,
              cents($("#res-" + p).value),
            ]),
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
    `<h2>Restore your notebook</h2><p class="small">Choose a Roam JSON backup from Files. Nothing changes until you review and confirm.</p><label for="backup-file">Backup file</label><input id="backup-file" type="file" accept=".json,application/json"><div id="import-preview"></div><button class="quiet" data-action="close" style="margin-top:20px">Cancel</button>`,
  );
  $("#backup-file").onchange = async () => {
    await action(async () => {
      const file = $("#backup-file").files[0];
      if (!file) return;
      if (file.size > 20e6) throw Error("Backup exceeds the 20 MB limit.");
      const data = validate(JSON.parse(await file.text()));
      const existing = new Set(state.trips.map((t) => t.id));
      const duplicates = data.trips.filter((t) => existing.has(t.id)).length;
      $("#import-preview").innerHTML =
        `<div class="notice">${data.trips.length} trips · ${data.trips.reduce((s, t) => s + t.transactions.length, 0)} expenses<br>${duplicates} matching trips. Restored trips will be added as separate copies; current trips stay untouched.</div><button id="confirm-import">Restore ${data.trips.length} trips as copies</button>`;
      $("#confirm-import").onclick = () =>
        action(async () => {
          await change((n) => {
            for (const original of data.trips) {
              const t = structuredClone(original);
              t.id = uid();
              if (existing.has(original.id))
                t.name = t.name.slice(0, 85) + " (restored)";
              n.trips.push(t);
            }
            if (!n.active) n.active = n.trips[0]?.id || null;
          });
          close();
          toast("Backup restored. Existing trips preserved.");
        });
    });
  };
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
        JSON.stringify(backup(state.trips), null, 2),
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
      const t = trip(),
        record = t.transactions.find((x) => x.id === b.dataset.id);
      modal(
        `<h2>Delete this expense?</h2><p>${esc(record.category)} · ${money(record.base)}</p><p class="small">The pool balance and future allowances will be recalculated.</p><div class="actions"><button data-action="close" class="quiet">Keep expense</button><button id="confirm-delete" class="danger">Delete</button></div>`,
      );
      $("#confirm-delete").onclick = () =>
        action(async () => {
          await change((n) => {
            const tr = n.trips.find((x) => x.id === t.id);
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
    `<h2>Your trips</h2><div class="stack">${state.trips.map((t) => `<button class="quiet select-trip" data-id="${esc(t.id)}">${esc(t.name)}<div class="small">${esc(t.start)} → ${esc(t.end)}${t.id === state.active ? " · Current" : ""}</div></button>`).join("")}<button data-action="new-trip">＋ Create a new trip</button><button class="quiet" data-action="import">Restore backup</button><button data-action="close" class="link">Close</button></div>`,
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
  validate(backup(state.trips));
  if (!trip()) state.active = state.trips[0]?.id || null;
  render();
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
  if (state) {
    toast("Offline setup unavailable: " + e.message);
  } else {
    $("#status").textContent = "Storage unavailable";
    $("#main").innerHTML =
      "<h1>Your records need storage.</h1><p>Close other tracker windows and reopen in regular Safari. Do not clear website data if you have records here.</p>";
    toast(e.message);
  }
}
