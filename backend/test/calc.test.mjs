// Проверка расчёта заработка (чистые функции из pb_hooks/lib/calc.js), без PocketBase.
//   node backend/test/calc.test.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const calc = require("../pb_hooks/lib/calc.js");

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; console.log("ok  -", name); }
  catch (err) { console.log("FAIL:", name, "\n", err.message); process.exitCode = 1; }
};

const rate = (o) => ({ id: o.id || "r" + Math.random(), unit: "shift", amount_kop: 100, valid_from: "2026-01-01", valid_to: "", member: "", vehicle: "", site: "", customer: "", ...o });

t("самая точная ставка побеждает общую", () => {
  const rates = [rate({ id: "all", amount_kop: 100 }), rate({ id: "veh", amount_kop: 200, vehicle: "v1" }), rate({ id: "veh+site", amount_kop: 300, vehicle: "v1", site: "s1" })];
  assert.equal(calc.pickRate(rates, "shift", "2026-05-01", { vehicle: "v1", site: "s1" }).id, "veh+site");
  assert.equal(calc.pickRate(rates, "shift", "2026-05-01", { vehicle: "v1", site: "s2" }).id, "veh");
  assert.equal(calc.pickRate(rates, "shift", "2026-05-01", { vehicle: "v2" }).id, "all");
});

t("ставка на другого водителя не применяется", () => {
  const rates = [rate({ id: "ivan", member: "m1" })];
  assert.equal(calc.pickRate(rates, "shift", "2026-05-01", { member: "m2" }), null);
});

t("при равной точности — более поздняя ставка", () => {
  const rates = [rate({ id: "old", valid_from: "2026-01-01" }), rate({ id: "new", valid_from: "2026-06-01" })];
  assert.equal(calc.pickRate(rates, "shift", "2026-05-31", {}).id, "old");
  assert.equal(calc.pickRate(rates, "shift", "2026-06-01", {}).id, "new");
});

t("ставка с датой окончания перестаёт действовать", () => {
  const rates = [rate({ id: "x", valid_to: "2026-03-31 00:00:00.000Z" })];
  assert.ok(calc.pickRate(rates, "shift", "2026-03-31", {}));
  assert.equal(calc.pickRate(rates, "shift", "2026-04-01", {}), null);
});

t("ночь и праздник перемножаются, копейки округляются", () => {
  const shift = { member: "m", date: "2026-05-09", night: true, holiday: true };
  const entries = [{ id: "e", unit: "hour", quantity: 7.5 }];
  const rates = [rate({ unit: "hour", amount_kop: 33333 })];
  const factors = [{ kind: "night", factor_permille: 1200, valid_from: "2026-01-01" }, { kind: "holiday", factor_permille: 2000, valid_from: "2026-01-01" }];
  // 7,5 × 333,33 ₽ × 1,2 × 2 = 5 999,94 ₽
  assert.equal(calc.calcShift(shift, entries, rates, factors).amount_kop, 599994);
});

t("переработка — только на отмеченной строке", () => {
  const shift = { member: "m", date: "2026-05-05" };
  const entries = [{ id: "a", unit: "hour", quantity: 8 }, { id: "b", unit: "hour", quantity: 2, overtime: true }];
  const r = calc.calcShift(shift, entries, [rate({ unit: "hour", amount_kop: 50000 })], [{ kind: "overtime", factor_permille: 1500, valid_from: "2026-01-01" }]);
  assert.equal(r.amount_kop, 8 * 50000 + 2 * 50000 * 1.5);
});

t("нет ставки — ошибка со списком строк", () => {
  const shift = { member: "m", date: "2026-05-05" };
  assert.throws(() => calc.calcShift(shift, [{ id: "a", unit: "trip", quantity: 2 }], [rate({})], []),
    (err) => /рейс/.test(err.message) && err.missing.length === 1);
});

t("пустая смена не считается", () => {
  assert.throws(() => calc.calcShift({ date: "2026-05-05" }, [], [], []), /нет ни одной строки/);
});

t("оклад делится по дням и по ставкам", () => {
  const month = [
    { unit: "month", amount_kop: 3100000, valid_from: "2026-01-01", valid_to: "" },
    { unit: "month", amount_kop: 6200000, valid_from: "2026-01-16", valid_to: "" },
  ];
  // январь: 15 дней по 31 000 ₽ и 16 дней по 62 000 ₽
  assert.equal(calc.salaryForPeriod(month, "2026-01-01", "2026-01-31"), 1500000 + 3200000);
  // февраль 2026 — 28 дней, полный месяц = ставка целиком
  assert.equal(calc.salaryForPeriod(month, "2026-02-01", "2026-02-28"), 6200000);
});

t("сводка: начислено, выплачено, к выплате", () => {
  const s = calc.payrollSummary({
    shifts: [{ status: "confirmed", amount_kop: 1000 }, { status: "submitted", amount_kop: 0 }, { status: "rejected" }],
    monthRates: [], adjustments: [{ amount_kop: 300 }, { amount_kop: -100 }],
    payouts: [{ status: "paid", amount_kop: 500 }, { status: "planned", amount_kop: 999 }],
    from: "2026-05-01", to: "2026-05-31",
  });
  assert.deepEqual([s.shifts_confirmed, s.shifts_pending, s.accrued_kop, s.paid_kop, s.due_kop], [1, 1, 1200, 500, 700]);
});

// ---------- выручка по контракту ----------
const items = [
  { id: "sweep", name: "Подметание", unit: "lin_m", vehicle_kind: "road_sweeper" },
  { id: "loader", name: "Час погрузчика", unit: "hour", vehicle_kind: "loader" },
  { id: "loader7", name: "Час погрузчика №7", unit: "hour", vehicle: "v7" },
  { id: "trip", name: "Рейс", unit: "trip" },
  { id: "fee", name: "Абонентская плата", unit: "month" },
];
const prices = [
  { item: "sweep", price_kop: 1500, vat: "22", valid_from: "2026-01-01" },
  { item: "loader", price_kop: 250000, valid_from: "2026-01-01" },
  { item: "loader", price_kop: 270000, valid_from: "2026-11-01" },
  { item: "loader7", price_kop: 300000, valid_from: "2026-01-01" },
  { item: "fee", price_kop: 3100000, valid_from: "2026-01-01" },
];
const kinds = { v1: "road_sweeper", v2: "loader", v7: "loader" };

t("водителю за часы, заказчику за погонные метры", () => {
  const r = calc.billShift({ date: "2026-10-15" }, [{ id: "a", vehicle: "v1", unit: "hour", quantity: 8, contract_item: "sweep", bill_qty: 2000 }], items, prices, kinds);
  assert.equal(r.amount_kop, 2000 * 1500);
  assert.equal(r.status, "ok");
  assert.equal(r.lines[0].vat, "22");
});

t("позиция подбирается по технике: своя машина точнее вида", () => {
  const r = calc.billShift({ date: "2026-10-15" }, [{ id: "a", vehicle: "v2", unit: "hour", quantity: 10 }, { id: "b", vehicle: "v7", unit: "hour", quantity: 2 }], items, prices, kinds);
  assert.deepEqual(r.lines.map((l) => [l.item, l.amount_kop]), [["loader", 2500000], ["loader7", 600000]]);
});

t("цена заказчика берётся на дату смены", () => {
  const r = calc.billShift({ date: "2026-11-02" }, [{ id: "a", vehicle: "v2", unit: "hour", quantity: 1 }], items, prices, kinds);
  assert.equal(r.amount_kop, 270000);
});

t("чего не хватает — не ломает, а попадает в «не выставлено»", () => {
  const r = calc.billShift({ date: "2026-10-15" }, [
    { id: "a", vehicle: "v1", unit: "hour", quantity: 8, contract_item: "sweep" },   // нет метров
    { id: "b", vehicle: "v9", unit: "tkm", tons: 10, km: 5 },                       // нет позиции
    { id: "c", vehicle: "v2", unit: "trip", quantity: 3 },                          // рейс есть, цены нет
    { id: "d", vehicle: "v2", unit: "hour", quantity: 1, contract_item: "чужая" },  // позиция не из контракта
  ], items, prices, kinds);
  assert.equal(r.status, "incomplete");
  assert.equal(r.amount_kop, 0);
  assert.deepEqual(r.missing.map((m) => m.entry), ["a", "b", "c", "d"]);
  assert.match(r.missing[0].reason, /п\.м\./);
  assert.match(r.missing[2].reason, /нет цены/);
});

t("две равные позиции — выбор за человеком", () => {
  const two = [...items, { id: "trip2", name: "Рейс дальний", unit: "trip" }];
  const r = calc.billShift({ date: "2026-10-15" }, [{ id: "a", vehicle: "v2", unit: "trip", quantity: 1 }], two, prices, kinds);
  assert.match(r.missing[0].reason, /несколько позиций/);
});

t("абонентская позиция — по дням периода", () => {
  assert.equal(calc.monthlyForPeriod(items[4], prices, "2026-10-01", "2026-10-31"), 3100000);
  assert.equal(calc.monthlyForPeriod(items[4], prices, "2026-10-01", "2026-10-10"), 1000000);
});

t("новые единицы оплаты: км и тонны из замеров", () => {
  assert.equal(calc.quantity({ unit: "km", km: 120 }), 120);
  assert.equal(calc.quantity({ unit: "ton", tons: 18.5 }), 18.5);
  assert.equal(calc.quantity({ unit: "lin_m", quantity: 1500 }), 1500);
});

// ---------- вахта, НДФЛ, ТО, ГСМ ----------
const pdRates = [rate({ id: "pd", unit: "per_diem", amount_kop: 70000 }), rate({ id: "pd-dos", unit: "per_diem", amount_kop: 100000, site: "dos" })];

t("суточные: дни закончившейся вахты внутри периода", () => {
  const r = calc.perDiemForPeriod([{ member: "m1", site: "", status: "done", date_from: "2026-09-20", date_to: "2026-10-10" }],
    pdRates, "2026-10-01", "2026-10-31", "2026-11-05", 70000);
  assert.equal(r.days, 10);
  assert.equal(r.amount_kop, 700000);
  assert.equal(r.taxable_kop, 0);
});

t("суточные: идущая вахта — только по сегодняшний день, запланированная не считается", () => {
  const r = calc.perDiemForPeriod([
    { member: "m1", status: "active", date_from: "2026-10-01", date_to: "2026-11-14" },
    { member: "m1", status: "planned", date_from: "2026-11-20", date_to: "2026-11-30" },
  ], pdRates, "2026-10-01", "2026-10-31", "2026-10-05", 70000);
  assert.equal(r.days, 5);
});

t("суточные сверх 700 ₽ в день облагаются НДФЛ", () => {
  const r = calc.perDiemForPeriod([{ member: "m1", site: "dos", status: "done", date_from: "2026-10-01", date_to: "2026-10-03" }],
    pdRates, "2026-10-01", "2026-10-31", "2026-11-01", 70000);
  assert.equal(r.amount_kop, 300000);
  assert.equal(r.free_kop, 210000);
  assert.equal(r.taxable_kop, 90000);
});

t("суточные: дни без ставки видны отдельно", () => {
  const r = calc.perDiemForPeriod([{ member: "m1", status: "done", date_from: "2025-12-30", date_to: "2026-01-02" }],
    pdRates, "2025-12-01", "2026-01-31", "2026-02-01", 70000);
  assert.equal(r.days, 2);
  assert.equal(r.missing_days, 2);
});

t("НДФЛ: 13 % до 2,4 млн, 15 % сверх — нарастающим итогом", () => {
  assert.equal(calc.ndflPeriod("gross", 0, 10000000), 1300000);
  assert.equal(calc.ndflPeriod("gross", 230000000, 20000000), 1300000 + 1500000);
  assert.equal(calc.ndflCumulative(1000050), 130000);   // 1 300,0065 ₽ → 1 300 ₽, в полных рублях
});

t("НДФЛ, когда ставки «на руки»: налог сверху", () => {
  assert.equal(calc.ndflPeriod("net", 0, 8700000), 1300000);
  assert.equal(calc.grossCumulative(8700000), 10000000);
  assert.equal(calc.ndflPeriod("net", 0, 0), 0);
});

t("ведомость: рейсы, суточные, дорога, НДФЛ на руки", () => {
  // вахта: 10 рейсов по 6 000 ₽, 30 дней суточных по 700 ₽, дорога 8 000 ₽, штраф 1 000 ₽, аванс 20 000 ₽
  const perDiem = { days: 30, amount_kop: 2100000, free_kop: 2100000, taxable_kop: 0 };
  const input = { shifts: [{ status: "confirmed", amount_kop: 6000000 }], monthRates: [], from: "2026-10-01", to: "2026-10-31",
    adjustments: [{ kind: "travel", amount_kop: 800000 }, { kind: "fine", amount_kop: -100000 }],
    payouts: [{ status: "paid", amount_kop: 2000000 }], perDiem };
  const base = calc.payComponents(input).taxable_kop;
  assert.equal(base, 6000000);
  const net = calc.payrollSummary({ ...input, basis: "net", ndfl_kop: calc.ndflPeriod("net", 0, base) });
  // 68 965 ₽ начислено − 8 965 ₽ НДФЛ (13 % в полных рублях) = 60 000 ₽ на руки
  assert.equal(net.ndfl_kop, 896500);
  assert.equal(6000000 + 896500 - calc.ndflCumulative(6000000 + 896500), 6000000);
  assert.equal(net.accrued_kop, 6000000 + 2100000 + 800000 - 100000);   // на руки — как договорились
  assert.equal(net.gross_kop, 6000000 + net.ndfl_kop + 2100000 + 800000);
  assert.equal(net.due_kop, net.accrued_kop - 2000000);
  const gross = calc.payrollSummary({ ...input, basis: "gross", ndfl_kop: calc.ndflPeriod("gross", 0, base) });
  assert.equal(gross.ndfl_kop, 780000);
  assert.equal(gross.accrued_kop, 6000000 - 780000 + 2100000 + 800000 - 100000);
});

t("ТО: осталось, скоро, просрочено — по км, моточасам и дням", () => {
  const plan = { interval_km: 10000, last_km: 50000, interval_hours: 500, last_hours: 1000, interval_days: 180, last_date: "2026-05-01" };
  assert.equal(calc.maintenanceStatus(plan, { odometer_now: 55000, engine_hours_now: 1100 }, "2026-07-01").status, "ok");
  const soon = calc.maintenanceStatus(plan, { odometer_now: 59200, engine_hours_now: 1100 }, "2026-07-01");
  assert.equal(soon.status, "soon");
  assert.equal(soon.parts[0].left, 800);
  assert.equal(calc.maintenanceStatus(plan, { odometer_now: 55000, engine_hours_now: 1510 }, "2026-07-01").status, "overdue");
  assert.equal(calc.maintenanceStatus(plan, { odometer_now: 55000, engine_hours_now: 1100 }, "2026-10-29").status, "overdue");
  assert.equal(calc.maintenanceStatus({ interval_days: 365 }, {}, "2026-07-01").status, "unknown");
});

t("ГСМ: расход по путевым против нормы и заправки мимо путевых", () => {
  const r = calc.fuelSummary({ fuel_norm_100km: 35, fuel_norm_hour: 0 }, [
    { odometer_start: 100000, odometer_end: 100400, fuel_start: 200, fuel_added: 100, fuel_end: 140 },
    { odometer_start: 100400, odometer_end: 100800, fuel_start: 140, fuel_added: 0, fuel_end: 0 },
    { odometer_start: 100800, odometer_end: 101000 },   // без топлива — в норму не идёт
  ], [{ liters: 100, amount_kop: 700000 }, { liters: 80, amount_kop: 560000 }]);
  assert.equal(r.km, 1000);
  assert.equal(r.used_l, 300);
  assert.equal(r.norm_l, 280);
  assert.equal(r.overrun_l, 20);
  assert.equal(r.refueled_l, 180);
  assert.equal(r.not_in_waybills_l, 80);
  assert.equal(r.spent_kop, 1260000);
});

console.log(`\n${n} проверок расчёта прошло`);
