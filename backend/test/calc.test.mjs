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

console.log(`\n${n} проверок расчёта прошло`);
