// Расчёт заработка Ordius. Чистые функции без обращения к базе — проверяются и в PocketBase, и в Node.
//
// Деньги — целые копейки. Коэффициенты — тысячные доли (1500 = ×1,5).
// Даты — строки, сравниваются по первым 10 символам «ГГГГ-ММ-ДД».

const SCOPE = ["member", "vehicle", "site", "customer"];

function day(value) {
  return String(value || "").slice(0, 10);
}

function activeOn(row, date) {
  const d = day(date);
  return day(row.valid_from) <= d && (!day(row.valid_to) || d <= day(row.valid_to));
}

// Самая точная ставка: подходят ставки нужной единицы, действующие в этот день, у которых каждое
// заполненное поле (водитель, техника, объект, заказчик) совпадает со сменой. Побеждает та,
// где совпало больше полей; при равенстве — начавшая действовать позже.
function pickRate(rates, unit, date, ctx) {
  let best = null;
  let bestScore = -1;
  for (const r of rates) {
    if (r.unit !== unit || !activeOn(r, date)) continue;
    let ok = true;
    let score = 0;
    for (const f of SCOPE) {
      if (!r[f]) continue;
      if (r[f] !== ctx[f]) { ok = false; break; }
      score++;
    }
    if (!ok) continue;
    if (score > bestScore || (score === bestScore && day(r.valid_from) > day(best.valid_from))) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

function pickFactor(factors, kind, date) {
  let best = null;
  for (const f of factors) {
    if (f.kind !== kind || !activeOn(f, date)) continue;
    if (!best || day(f.valid_from) > day(best.valid_from)) best = f;
  }
  return best ? best.factor_permille : 1000;
}

const UNIT_LABEL = {
  hour: "час", shift: "смена", trip: "рейс", tkm: "т·км", km: "км", lin_m: "п.м.", sq_m: "м²", cu_m: "м³",
  ton: "т", piece: "шт", month: "месяц",
};

// Количество для оплаты по строке смены (в единице строки).
function quantity(entry) {
  switch (entry.unit) {
    case "tkm": return (Number(entry.tons) || 0) * (Number(entry.km) || 0);
    case "shift": return Number(entry.quantity) || 1;
    case "km": return Number(entry.km) || Number(entry.quantity) || 0;
    case "ton": return Number(entry.tons) || Number(entry.quantity) || 0;
    default: return Number(entry.quantity) || 0;
  }
}

// Расчёт смены. Если для какой-то строки нет ставки — ошибка со списком строк,
// чтобы руководитель не подтвердил смену с нулём вместо денег.
function calcShift(shift, entries, rates, factors) {
  if (!entries.length) throw new Error("в смене нет ни одной строки работ");
  const night = shift.night ? pickFactor(factors, "night", shift.date) : 1000;
  const holiday = shift.holiday ? pickFactor(factors, "holiday", shift.date) : 1000;
  const overtimeF = pickFactor(factors, "overtime", shift.date);
  const lines = [];
  const missing = [];
  let total = 0;
  for (const e of entries) {
    const ctx = { member: shift.member, vehicle: e.vehicle || "", site: shift.site || "", customer: shift.customer || "" };
    const rate = pickRate(rates, e.unit, shift.date, ctx);
    const qty = quantity(e);
    if (!rate) {
      missing.push({ entry: e.id, unit: e.unit, label: UNIT_LABEL[e.unit] || e.unit });
      continue;
    }
    if (qty <= 0) throw new Error(`строка «${UNIT_LABEL[e.unit] || e.unit}»: количество должно быть больше нуля`);
    const factors_ = [night, holiday, e.overtime ? overtimeF : 1000].filter((f) => f !== 1000);
    let amount = qty * rate.amount_kop;
    for (const f of factors_) amount = amount * f / 1000;
    amount = Math.round(amount);
    total += amount;
    lines.push({
      entry: e.id, vehicle: e.vehicle || "", unit: e.unit, quantity: qty, rate: rate.id, rate_kop: rate.amount_kop,
      factors_permille: factors_, amount_kop: amount,
    });
  }
  if (missing.length) {
    const what = missing.map((m) => m.label).join(", ");
    const err = new Error(`нет действующей ставки для: ${what}`);
    err.missing = missing;
    throw err;
  }
  return { amount_kop: total, lines, calculated_on: shift.date };
}

// ---------- выручка: цены заказчика по позициям контракта ----------

// Количество в единице позиции контракта. Если единицы оплаты и выставления разные (водителю — часы,
// заказчику — погонные метры), количество для заказчика берётся из bill_qty строки.
function billQuantity(entry, unit) {
  const bq = Number(entry.bill_qty) || 0;
  if (bq > 0) return bq;
  if (unit === entry.unit) return quantity(entry);
  const tons = Number(entry.tons) || 0;
  const km = Number(entry.km) || 0;
  if (unit === "tkm" && tons > 0 && km > 0) return tons * km;
  if (unit === "km" && km > 0) return km;
  if (unit === "ton" && tons > 0) return tons;
  return 0;
}

// Позиция контракта для строки: выбранная явно или подобранная по единице и технике
// (своя машина точнее вида техники, вид техники точнее «любой»). Две равные — выбор за человеком.
function pickItem(items, entry, vehicleKind) {
  if (entry.contract_item) {
    const it = items.find((i) => i.id === entry.contract_item);
    return it ? { item: it } : { reason: "позиция не из контракта этой смены" };
  }
  let best = [];
  let bestScore = -1;
  for (const it of items) {
    if (it.active === false || it.unit === "month" || it.unit !== entry.unit) continue;
    if (it.vehicle && it.vehicle !== entry.vehicle) continue;
    if (it.vehicle_kind && it.vehicle_kind !== vehicleKind) continue;
    const score = it.vehicle ? 2 : it.vehicle_kind ? 1 : 0;
    if (score > bestScore) { best = [it]; bestScore = score; } else if (score === bestScore) best.push(it);
  }
  if (best.length === 1) return { item: best[0] };
  if (best.length > 1) return { reason: "подходят несколько позиций — выберите позицию в строке" };
  return { reason: `в контракте нет позиции «${UNIT_LABEL[entry.unit] || entry.unit}» для этой техники` };
}

function pickPrice(prices, itemId, date) {
  let best = null;
  for (const p of prices) {
    if (p.item !== itemId || !activeOn(p, date)) continue;
    if (!best || day(p.valid_from) > day(best.valid_from)) best = p;
  }
  return best;
}

// Выручка по смене. Не мешает подтверждению: чего не хватает, попадает в missing,
// и реестр для заказчика показывает это как «не выставлено».
// kinds — { id техники: вид техники }.
function billShift(shift, entries, items, prices, kinds) {
  const lines = [];
  const missing = [];
  let total = 0;
  for (const e of entries) {
    const picked = pickItem(items, e, kinds[e.vehicle] || "");
    if (!picked.item) { missing.push({ entry: e.id, vehicle: e.vehicle || "", reason: picked.reason }); continue; }
    const it = picked.item;
    const qty = billQuantity(e, it.unit);
    if (!(qty > 0)) {
      missing.push({ entry: e.id, vehicle: e.vehicle || "", item: it.id,
        reason: `не указано количество в единице позиции (${UNIT_LABEL[it.unit] || it.unit})` });
      continue;
    }
    const price = pickPrice(prices, it.id, shift.date);
    if (!price) {
      missing.push({ entry: e.id, vehicle: e.vehicle || "", item: it.id, reason: `нет цены на ${day(shift.date)}` });
      continue;
    }
    const amount = Math.round(qty * price.price_kop);
    total += amount;
    lines.push({
      entry: e.id, vehicle: e.vehicle || "", item: it.id, item_name: it.name, unit: it.unit, quantity: qty,
      price_kop: price.price_kop, vat: price.vat || "", amount_kop: amount,
    });
  }
  return { amount_kop: total, lines, missing, status: missing.length ? "incomplete" : "ok" };
}

// Оклад за период: каждая месячная ставка считается пропорционально дням периода внутри её действия.
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function salaryForPeriod(monthRates, from, to) {
  let total = 0;
  const start = new Date(day(from) + "T00:00:00Z");
  const end = new Date(day(to) + "T00:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    let best = null;
    for (const r of monthRates) {
      if (r.unit !== "month" || !activeOn(r, iso)) continue;
      if (!best || day(r.valid_from) > day(best.valid_from)) best = r;
    }
    if (best) total += best.amount_kop / daysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }
  return Math.round(total);
}

// Сводка по одному человеку за период.
function payrollSummary({ shifts, monthRates, adjustments, payouts, from, to }) {
  let earned = 0;
  let confirmed = 0;
  let pending = 0;
  for (const s of shifts) {
    if (s.status === "confirmed") { confirmed++; earned += s.amount_kop || 0; }
    else if (s.status === "submitted" || s.status === "draft") pending++;
  }
  const salary = salaryForPeriod(monthRates, from, to);
  let bonuses = 0;
  let deductions = 0;
  for (const a of adjustments) {
    if (a.amount_kop >= 0) bonuses += a.amount_kop; else deductions += -a.amount_kop;
  }
  let paid = 0;
  for (const p of payouts) if (p.status === "paid") paid += p.amount_kop;
  const accrued = earned + salary + bonuses - deductions;
  return {
    shifts_confirmed: confirmed, shifts_pending: pending,
    earned_kop: earned, salary_kop: salary, bonuses_kop: bonuses, deductions_kop: deductions,
    accrued_kop: accrued, paid_kop: paid, due_kop: accrued - paid,
  };
}

// Абонентская позиция контракта («в месяц») за период — пропорционально дням, по действующей цене.
function monthlyForPeriod(item, prices, from, to) {
  const own = prices.filter((p) => p.item === item.id).map((p) => ({ unit: "month", amount_kop: p.price_kop,
    valid_from: p.valid_from, valid_to: p.valid_to }));
  return salaryForPeriod(own, from, to);
}

module.exports = {
  UNIT_LABEL, day, activeOn, pickRate, pickFactor, quantity, calcShift, salaryForPeriod, payrollSummary,
  billQuantity, pickItem, pickPrice, billShift, monthlyForPeriod,
};
