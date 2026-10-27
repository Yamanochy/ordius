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

module.exports = { isAdmin, codesRequired, activeCode, codeView };
