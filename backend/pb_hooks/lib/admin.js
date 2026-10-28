// Администратор Ordius — тот, кто ведёт сервис (не владелец компании-клиента).
// Его номера — в переменной ORDIUS_ADMIN_PHONES на сервере (через запятую), в репозиторий не попадают.
// Администратор выдаёт коды подключения: на пилоте компанию можно создать только с таким кодом.
// ORDIUS_OPEN_COMPANIES=1 — создавать компании может любой (самостоятельное подключение после пилота).

function adminPhones(normalizePhone) {
  return String($os.getenv("ORDIUS_ADMIN_PHONES") || "").split(",")
    .map((s) => normalizePhone(s.trim())).filter(Boolean);
}

function isAdmin(user, normalizePhone) {
  if (!user || user.collection().name !== "users") return false;
  const phone = user.get("phone");
  return !!phone && adminPhones(normalizePhone).indexOf(phone) !== -1;
}

function codesRequired() {
  return $os.getenv("ORDIUS_OPEN_COMPANIES") !== "1";
}

// Действующий код подключения или null: не отозван, не истёк, использован меньше разрешённого.
function activeCode(app, raw, nowIso) {
  const code = String(raw || "").trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z0-9]{6,16}$/.test(code)) return null;
  let rec = null;
  try { rec = app.findFirstRecordByData("connect_codes", "code", code); } catch (_) { return null; }
  if (rec.getInt("used") >= rec.getInt("max_uses")) return null;
  const exp = rec.getString("expires");
  if (exp && exp <= nowIso) return null;
  return rec;
}

function codeView(app, rec) {
  const companies = app.findRecordsByFilter("companies", "connect_code = {:c}", "created", 50, 0, { c: rec.id })
    .map((c) => ({ id: c.id, name: c.get("name"), created: c.getString("created") }));
  return {
    id: rec.id, code: rec.get("code"), note: rec.get("note"), max_uses: rec.getInt("max_uses"), used: rec.getInt("used"),
    expires: rec.getString("expires"), created: rec.getString("created"), companies,
  };
}

// ---------- удаление компании со всеми её данными ----------
// Нужно, когда клиент уходит (условия использования: данные удаляются после прекращения договора)
// или для пробных компаний. Аккаунты людей остаются: человек может состоять и в других компаниях.
//
// Удаляются записи всех коллекций, где есть связь company → companies; вложенные записи без поля company
// (строки смены, события задачи, позиции контракта) уходят каскадом вместе с родителем.
// Сначала — то, что ссылается на другие записи компании; остальное — проходами, пока не удалится всё
// (страховка на случай новых коллекций). Всё в одной транзакции: не удалилось что-то одно — не удаляется ничего.
const DELETE_ORDER = [
  "messages", "documents", "fuel_logs", "maintenance_logs", "adjustments", "payouts", "rate_factors", "rates",
  "rotations", "shift_bills", "shift_entries", "shifts", "task_events", "tasks", "maintenance_plans", "fuel_cards",
  "contract_prices", "contract_items", "contracts", "sites", "customers", "vehicles", "posts", "audit_log", "memberships",
];

function companyCollections(app) {
  const companiesId = app.findCollectionByNameOrId("companies").id;
  const names = [];
  for (const c of app.findAllCollections()) {
    if (c.system || c.name === "companies") continue;
    const f = c.fields.getByName("company");
    if (f && f.type() === "relation" && f.collectionId === companiesId) names.push(c.name);
  }
  const rank = (n) => { const i = DELETE_ORDER.indexOf(n); return i === -1 ? -1 : i; }; // незнакомые — первыми
  return names.sort((a, b) => rank(a) - rank(b));
}

// → { collection: удалено записей } (без каскадных); ошибка — если что-то не удалилось (транзакция откатывается).
function deleteCompany(app, companyId) {
  const counts = {};
  app.runInTransaction((tx) => {
    let pending = companyCollections(tx);
    for (let pass = 0; pass < 8 && pending.length; pass++) {
      const next = [];
      for (const name of pending) {
        const recs = tx.findRecordsByFilter(name, "company = {:c}", "", 0, 0, { c: companyId });
        let left = 0;
        for (const r of recs) {
          try { tx.delete(r); counts[name] = (counts[name] || 0) + 1; } catch (_) { left++; }
        }
        if (left) next.push(name);
      }
      pending = next;
    }
    if (pending.length) throw new Error("не удалось удалить записи: " + pending.join(", "));
    tx.delete(tx.findRecordById("companies", companyId));
  });
  return counts;
}

module.exports = { isAdmin, codesRequired, activeCode, codeView, companyCollections, deleteCompany };
