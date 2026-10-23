// Общие помощники серверной логики Ordius (выполняются внутри PocketBase).

// Телефон РФ в любом написании → +7XXXXXXXXXX; иностранный с «+» — как есть; иначе null.
function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) return "+7" + digits.slice(1);
  if (digits.length === 10 && digits[0] === "9") return "+7" + digits;
  if (s.startsWith("+") && digits.length >= 10 && digits.length <= 15) return "+" + digits;
  return null;
}

// Активное членство пользователя в компании или null.
function membershipOf(app, companyId, userId) {
  if (!companyId || !userId) return null;
  try {
    return app.findFirstRecordByFilter("memberships",
      "company = {:c} && user = {:u} && status = 'active'", { c: companyId, u: userId });
  } catch (_) {
    return null;
  }
}

function hasRole(membership, roles) {
  if (!membership) return false;
  const mine = membership.get("roles") || [];
  return roles.some((r) => mine.indexOf(r) !== -1);
}

const SAFE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function code(len) {
  return $security.randomStringWithAlphabet(len, SAFE);
}

function nowIso() {
  return new Date().toISOString().replace("T", " ");
}

// Запись в журнал изменений. Ошибка журнала не должна ломать основное действие, но и молчать не должна.
function audit(app, action, record, actor, extra) {
  try {
    const col = app.findCollectionByNameOrId("audit_log");
    const row = new Record(col);
    let company = "";
    if (record.collection().name === "companies") company = record.id;
    else company = record.get("company") || "";
    row.set("company", company);
    row.set("actor", actor ? actor.id : "");
    row.set("action", action);
    row.set("collection_name", record.collection().name);
    row.set("record_id", record.id);
    // скрытые поля (коды приглашений) в журнал не пишем
    const all = record.fieldsData();
    const after = {};
    const fields = record.collection().fields;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f.getHidden()) after[f.getName()] = all[f.getName()];
    }
    row.set("data", Object.assign({ after }, extra || {}));
    app.save(row);
  } catch (err) {
    app.logger().error("audit_log write failed", "error", String(err), "collection", record.collection().name);
  }
}

// Поля, которые клиент не может присылать сам (их ставит сервер).
function rejectServerFields(e, fields) {
  if (e.hasSuperuserAuth()) return;
  const body = e.requestInfo().body || {};
  const sent = fields.filter((f) => Object.prototype.hasOwnProperty.call(body, f));
  if (sent.length) throw new BadRequestError("Эти поля заполняет сервер: " + sent.join(", "));
}

module.exports = { normalizePhone, membershipOf, hasRole, code, nowIso, audit, rejectServerFields };
