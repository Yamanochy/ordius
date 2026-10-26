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
  ton: "т", piece: "шт", month: "месяц", per_diem: "сутки вахты",
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

// ---------- вахта: суточные за каждый день вахты ----------
// Считаются дни вахт со статусом «идёт» (до сегодняшнего дня включительно) и «закончена» внутри периода.
// Ставка — unit "per_diem", самая точная по человеку и объекту. Часть до freeKop в день — без НДФЛ.
function addDays(iso, n) {
  const d = new Date(day(iso) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function perDiemForPeriod(rotations, rates, from, to, today, freeKop) {
  const seen = {};
  let days = 0, amount = 0, free = 0, missing = 0;
  for (const r of rotations) {
    if (r.status !== "active" && r.status !== "done") continue;
    let start = day(r.date_from) > day(from) ? day(r.date_from) : day(from);
    let end = day(r.date_to) < day(to) ? day(r.date_to) : day(to);
    if (r.status === "active" && today && day(today) < end) end = day(today);
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (seen[d]) continue;
      seen[d] = true;
      const rate = pickRate(rates, "per_diem", d, { member: r.member || "", site: r.site || "", vehicle: "", customer: "" });
      if (!rate) { missing++; continue; }
      days++;
      amount += rate.amount_kop;
      free += Math.min(rate.amount_kop, freeKop);
    }
  }
  return { days, amount_kop: amount, free_kop: free, taxable_kop: amount - free, missing_days: missing };
}

// ---------- НДФЛ (резиденты, прогрессивная шкала с 2025 г., ст. 224 НК РФ) ----------
// Налог считается нарастающим итогом с начала года и округляется до полных рублей (п. 6 ст. 52 НК РФ).
const NDFL_SCALE = [[240000000, 13], [500000000, 15], [2000000000, 18], [5000000000, 20], [Infinity, 22]];

function ndflCumulative(baseKop) {
  let tax = 0;
  let prev = 0;
  for (const [limit, pct] of NDFL_SCALE) {
    if (baseKop <= prev) break;
    tax += (Math.min(baseKop, limit) - prev) * pct / 100;
    prev = limit;
  }
  return Math.round(tax / 100) * 100;
}

// Сколько нужно начислить с начала года, чтобы на руки вышло netKop.
function grossCumulative(netKop) {
  if (netKop <= 0) return 0;
  let lo = netKop;
  let hi = Math.ceil(netKop / 0.77) + 200;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid - ndflCumulative(mid) >= netKop) hi = mid; else lo = mid + 1;
  }
  return lo;
}

// НДФЛ за период. basis "gross" — суммы до налога; "net" — суммы «на руки», налог сверху.
// ytdBase — облагаемое с начала года до начала периода, в той же базе.
function ndflPeriod(basis, ytdBase, base) {
  if (!(base > 0)) return 0;
  const ytd = Math.max(0, ytdBase || 0);
  if (basis === "gross") return ndflCumulative(ytd + base) - ndflCumulative(ytd);
  return (grossCumulative(ytd + base) - grossCumulative(ytd)) - base;
}

// Составляющие заработка человека за период (без налога и выплат).
function payComponents({ shifts, monthRates, adjustments, perDiem, from, to }) {
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
  let travel = 0;
  for (const a of adjustments) {
    if (a.kind === "travel") travel += a.amount_kop;
    else if (a.amount_kop >= 0) bonuses += a.amount_kop;
    else deductions += -a.amount_kop;
  }
  const pd = perDiem || { days: 0, amount_kop: 0, free_kop: 0, taxable_kop: 0, missing_days: 0 };
  return {
    shifts_confirmed: confirmed, shifts_pending: pending, earned_kop: earned, salary_kop: salary,
    bonuses_kop: bonuses, deductions_kop: deductions, travel_kop: travel,
    per_diem_days: pd.days, per_diem_kop: pd.amount_kop, per_diem_missing_days: pd.missing_days || 0,
    taxable_kop: earned + salary + bonuses + pd.taxable_kop,
    tax_free_kop: travel + pd.free_kop,
  };
}

// Сводка по одному человеку за период. ndfl_kop считает вызывающий (ndflPeriod) — ему нужны суммы с начала года.
//   gross_kop   — начислено до НДФЛ (с суточными и дорогой);
//   accrued_kop — на руки после НДФЛ и удержаний; due_kop — осталось выплатить.
function payrollSummary({ shifts, monthRates, adjustments, payouts, from, to, perDiem, ndfl_kop, basis }) {
  const c = payComponents({ shifts, monthRates, adjustments, perDiem, from, to });
  const ndfl = ndfl_kop || 0;
  const grossTaxable = basis === "gross" ? c.taxable_kop : c.taxable_kop + ndfl;
  const netTaxable = grossTaxable - ndfl;
  let paid = 0;
  for (const p of payouts) if (p.status === "paid") paid += p.amount_kop;
  const accrued = netTaxable + c.tax_free_kop - c.deductions_kop;
  return Object.assign(c, {
    ndfl_kop: ndfl, gross_kop: grossTaxable + c.tax_free_kop,
    accrued_kop: accrued, paid_kop: paid, due_kop: accrued - paid,
  });
}

// ---------- ТО: сколько осталось по пробегу, моточасам и дням ----------
// «Скоро» — когда осталось 10 % интервала и меньше; «просрочено» — когда интервал вышел.
function daysBetween(a, b) {
  return Math.round((Date.parse(day(b) + "T00:00:00Z") - Date.parse(day(a) + "T00:00:00Z")) / 86400000);
}

function maintenanceStatus(plan, vehicle, today) {
  const parts = [];
  const add = (by, interval, last, now, unit) => {
    if (!(interval > 0)) return;
    const next = (last || 0) + interval;
    parts.push({ by, unit, next, left: Math.round((next - (now || 0)) * 10) / 10, warn: Math.ceil(interval * 0.1) });
  };
  add("km", plan.interval_km, plan.last_km, vehicle.odometer_now, "км");
  add("hours", plan.interval_hours, plan.last_hours, vehicle.engine_hours_now, "моточ.");
  if (plan.interval_days > 0 && day(plan.last_date)) {
    const nextDate = addDays(plan.last_date, plan.interval_days);
    parts.push({ by: "days", unit: "дн.", next: nextDate, left: daysBetween(today, nextDate),
      warn: Math.max(1, Math.ceil(plan.interval_days * 0.1)) });
  }
  let status = parts.length ? "ok" : "unknown";
  for (const p of parts) {
    if (p.left <= 0) status = "overdue";
    else if (p.left <= p.warn && status !== "overdue") status = "soon";
  }
  return { status, parts };
}

// ---------- ГСМ: расход по путевым против нормы, заправки против путевых ----------
// entries — строки смен по машине: показания одометра, моточасов и топлива; logs — заправки.
function fuelSummary(vehicle, entries, logs) {
  const r1 = (x) => Math.round(x * 10) / 10;
  let km = 0, hours = 0, used = 0, norm = 0, addedWaybills = 0, withFuel = 0;
  for (const e of entries) {
    const dk = e.odometer_end > 0 && e.odometer_start > 0 ? Math.max(0, e.odometer_end - e.odometer_start) : 0;
    const dh = e.engine_hours_end > 0 && e.engine_hours_start > 0 ? Math.max(0, e.engine_hours_end - e.engine_hours_start) : 0;
    km += dk;
    hours += dh;
    addedWaybills += e.fuel_added || 0;
    if (e.fuel_start > 0) {
      const u = e.fuel_start + (e.fuel_added || 0) - (e.fuel_end || 0);
      if (u >= 0) {
        withFuel++;
        used += u;
        norm += dk * (vehicle.fuel_norm_100km || 0) / 100 + dh * (vehicle.fuel_norm_hour || 0);
      }
    }
  }
  let refueled = 0, spent = 0;
  for (const l of logs) { refueled += l.liters || 0; spent += l.amount_kop || 0; }
  const hasNorm = norm > 0 && used > 0;
  return {
    km: r1(km), hours: r1(hours), entries: entries.length, entries_with_fuel: withFuel,
    used_l: r1(used), norm_l: hasNorm ? r1(norm) : null,
    overrun_l: hasNorm ? r1(used - norm) : null, overrun_pct: hasNorm ? r1((used - norm) / norm * 100) : null,
    per_100km: km > 0 && used > 0 && !hours ? r1(used / km * 100) : null,
    refueled_l: r1(refueled), spent_kop: spent, added_waybills_l: r1(addedWaybills),
    // по чекам и картам залито больше, чем записано в путевых — повод проверить
    not_in_waybills_l: r1(refueled - addedWaybills),
  };
}

// Абонентская позиция контракта («в месяц») за период — пропорционально дням, по действующей цене.
function monthlyForPeriod(item, prices, from, to) {
  const own = prices.filter((p) => p.item === item.id).map((p) => ({ unit: "month", amount_kop: p.price_kop,
    valid_from: p.valid_from, valid_to: p.valid_to }));
  return salaryForPeriod(own, from, to);
}

module.exports = {
  UNIT_LABEL, day, addDays, activeOn, pickRate, pickFactor, quantity, calcShift, salaryForPeriod, payrollSummary,
  payComponents, perDiemForPeriod, ndflCumulative, grossCumulative, ndflPeriod,
  billQuantity, pickItem, pickPrice, billShift, monthlyForPeriod, maintenanceStatus, fuelSummary,
};
