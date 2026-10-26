// Выручка по сменам: позиции и цены контракта заказчика → запись shift_bills.
// Расчёт — чистые функции из calc.js; здесь только чтение из базы и сохранение.

// Контракт смены: указан в смене, иначе — контракт объекта.
function contractOf(app, shift) {
  if (shift.get("contract")) return shift.get("contract");
  const siteId = shift.get("site");
  if (!siteId) return "";
  try { return app.findRecordById("sites", siteId).get("contract") || ""; } catch (_) { return ""; }
}

// Заполняет контракт по объекту и заказчика по контракту; заказчик смены и контракта должны совпадать.
function contractDefaults(app, shift) {
  if (!shift.get("contract") && shift.get("site")) {
    try {
      const c = app.findRecordById("sites", shift.get("site")).get("contract");
      if (c) shift.set("contract", c);
    } catch (_) { /* объекта нет — проверит валидация */ }
  }
  const contractId = shift.get("contract");
  if (!contractId) return;
  let contract = null;
  try { contract = app.findRecordById("contracts", contractId); } catch (_) { return; }
  if (!shift.get("customer")) shift.set("customer", contract.get("customer"));
  if (shift.get("customer") !== contract.get("customer")) {
    throw new BadRequestError("Контракт смены — другого заказчика");
  }
}

function loadEntries(app, shiftId) {
  return app.findRecordsByFilter("shift_entries", "shift = {:s}", "created", 0, 0, { s: shiftId })
    .map((r) => ({
      id: r.id, unit: r.get("unit"), vehicle: r.get("vehicle"), quantity: r.get("quantity"), tons: r.get("tons"),
      km: r.get("km"), overtime: r.get("overtime"), contract_item: r.get("contract_item"), bill_qty: r.get("bill_qty"),
    }));
}

function loadItems(app, contractId) {
  return app.findRecordsByFilter("contract_items", "contract = {:c}", "created", 0, 0, { c: contractId })
    .map((r) => ({
      id: r.id, name: r.get("name"), unit: r.get("unit"), vehicle: r.get("vehicle"),
      vehicle_kind: r.get("vehicle_kind"), active: r.get("active"),
    }));
}

function loadPrices(app, itemIds) {
  if (!itemIds.length) return [];
  const out = [];
  for (const id of itemIds) {
    for (const r of app.findRecordsByFilter("contract_prices", "item = {:i}", "", 0, 0, { i: id })) {
      out.push({ item: r.get("item"), price_kop: r.get("price_kop"), vat: r.get("vat"),
        valid_from: r.getString("valid_from"), valid_to: r.getString("valid_to") });
    }
  }
  return out;
}

function vehicleKinds(app, companyId) {
  const kinds = {};
  for (const v of app.findRecordsByFilter("vehicles", "company = {:c}", "", 0, 0, { c: companyId })) kinds[v.id] = v.get("kind");
  return kinds;
}

// Пересчитать и сохранить выручку подтверждённой смены. Нет контракта — записи о выручке нет.
function saveBill(app, shift, calc) {
  const contractId = contractOf(app, shift);
  let bill = null;
  try { bill = app.findFirstRecordByFilter("shift_bills", "shift = {:s}", { s: shift.id }); } catch (_) { /* нет */ }
  if (!contractId) {
    if (bill) app.delete(bill);
    return null;
  }
  const items = loadItems(app, contractId);
  const prices = loadPrices(app, items.map((i) => i.id));
  const result = calc.billShift({ date: shift.getString("date") }, loadEntries(app, shift.id), items, prices,
    vehicleKinds(app, shift.get("company")));
  if (!bill) bill = new Record(app.findCollectionByNameOrId("shift_bills"));
  bill.set("company", shift.get("company"));
  bill.set("shift", shift.id);
  bill.set("customer", shift.get("customer"));
  bill.set("contract", contractId);
  bill.set("date", shift.getString("date"));
  bill.set("amount_kop", result.amount_kop);
  bill.set("status", result.status);
  bill.set("lines", result.lines);
  bill.set("missing", result.missing);
  app.save(bill);
  return bill;
}

function deleteBill(app, shiftId) {
  try { app.delete(app.findFirstRecordByFilter("shift_bills", "shift = {:s}", { s: shiftId })); } catch (_) { /* не было */ }
}

module.exports = { contractOf, contractDefaults, loadItems, loadPrices, saveBill, deleteBill };
