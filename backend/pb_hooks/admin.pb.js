/// <reference path="../pb_data/types.d.ts" />
// Администратор Ordius: коды подключения компаний (lib/admin.js).
//   GET  /api/ordius/me                         → { platform_admin, company_code_required } — что показать в приложении
//   GET  /api/ordius/connect-codes              → { items } — только администратор
//   POST /api/ordius/connect-codes {note, max_uses?, days?} → новый код (по умолчанию 1 компания, 30 дней)
//   POST /api/ordius/connect-codes/{id}/revoke  → код перестаёт действовать
// Клиент создаёт компанию обычным запросом к companies, передавая код в поле тела connect_key.
routerAdd("GET", "/api/ordius/me", (e) => {
  const adm = require(`${__hooks}/lib/admin.js`);
  const { normalizePhone } = require(`${__hooks}/lib/util.js`);
  const admin = adm.isAdmin(e.auth, normalizePhone);
  return e.json(200, { platform_admin: admin, company_code_required: adm.codesRequired() && !admin });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/ordius/connect-codes", (e) => {
  const adm = require(`${__hooks}/lib/admin.js`);
  const { normalizePhone } = require(`${__hooks}/lib/util.js`);
  if (!adm.isAdmin(e.auth, normalizePhone)) throw new ForbiddenError("Только для администратора Ordius");
  const items = e.app.findRecordsByFilter("connect_codes", "id != ''", "-created", 200, 0)
    .map((r) => adm.codeView(e.app, r));
  return e.json(200, { items });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/ordius/connect-codes", (e) => {
  const adm = require(`${__hooks}/lib/admin.js`);
  const { normalizePhone, code } = require(`${__hooks}/lib/util.js`);
  if (!adm.isAdmin(e.auth, normalizePhone)) throw new ForbiddenError("Только для администратора Ordius");
  const body = e.requestInfo().body || {};
  const note = String(body.note || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (note.length < 2) throw new BadRequestError("Укажите, кому код: название компании или имя");
  const maxUses = Math.floor(Number(body.max_uses || 1));
  if (!(maxUses >= 1 && maxUses <= 20)) throw new BadRequestError("Компаний по коду — от 1 до 20");
  const days = Math.floor(Number(body.days || 30));
  if (!(days >= 1 && days <= 365)) throw new BadRequestError("Срок — от 1 до 365 дней");
  const rec = new Record(e.app.findCollectionByNameOrId("connect_codes"));
  rec.set("code", code(8));
  rec.set("note", note);
  rec.set("max_uses", maxUses);
  rec.set("used", 0);
  rec.set("expires", new Date(Date.now() + days * 86400e3).toISOString().replace("T", " "));
  rec.set("created_by", e.auth.id);
  e.app.save(rec);
  return e.json(200, adm.codeView(e.app, rec));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/ordius/connect-codes/{id}/revoke", (e) => {
  const adm = require(`${__hooks}/lib/admin.js`);
  const { normalizePhone, nowIso } = require(`${__hooks}/lib/util.js`);
  if (!adm.isAdmin(e.auth, normalizePhone)) throw new ForbiddenError("Только для администратора Ordius");
  let rec = null;
  try { rec = e.app.findRecordById("connect_codes", e.request.pathValue("id")); } catch (_) { throw new NotFoundError("Код не найден"); }
  rec.set("expires", nowIso());
  e.app.save(rec);
  return e.json(200, adm.codeView(e.app, rec));
}, $apis.requireAuth("users"));

// ---------- Кабинет Ordius (только администратор) ----------
// Только сводные цифры по компаниям и контакты владельца — нашего клиента. Данные работников клиентов
// (смены, деньги, фото) сюда не выводятся: их Ordius обрабатывает только по поручению клиента (ч. 3 ст. 6 152-ФЗ).
//   GET  /api/ordius/admin/summary
//   GET  /api/ordius/admin/companies
//   POST /api/ordius/admin/companies/{id}/plan {plan}
//   GET  /api/ordius/admin/leads
//   POST /api/ordius/admin/leads/{id} {status?, admin_note?}
routerAdd("GET", "/api/ordius/admin/summary", (e) => {
  const adm = require(`${__hooks}/lib/admin.js`);
  const { normalizePhone } = require(`${__hooks}/lib/util.js`);
  if (!adm.isAdmin(e.auth, normalizePhone)) throw new ForbiddenError("Только для администратора Ordius");
  const d7 = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10) + " 00:00:00.000Z";
  const one = (sql, params) => {
    const row = new DynamicModel({ n: 0 });
    e.app.db().newQuery(sql).bind(params || {}).one(row);
    return row.n;
  };
  return e.json(200, {
    companies: one("SELECT count(*) AS n FROM companies"),
    users: one("SELECT count(*) AS n FROM users"),
    people_active: one("SELECT count(*) AS n FROM memberships WHERE status = 'active'"),
    shifts7: one("SELECT count(*) AS n FROM shifts WHERE date >= {:d}", { d: d7 }),
    leads_new: one("SELECT count(*) AS n FROM leads WHERE status = '' OR status = 'new'"),
  });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/ordius/admin/companies", (e) => {
  const adm = require(`${__hooks}/lib/admin.js`);
  const { normalizePhone } = require(`${__hooks}/lib/util.js`);
  if (!adm.isAdmin(e.auth, normalizePhone)) throw new ForbiddenError("Только для администратора Ordius");
  const d30 = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10) + " 00:00:00.000Z";
  const owner = (col) => `COALESCE((SELECT u.${col} FROM memberships m JOIN users u ON u.id = m.user
      WHERE m.company = c.id AND m.status = 'active' AND m.roles LIKE '%"owner"%' ORDER BY m.created LIMIT 1), '')`;
  const rows = arrayOf(new DynamicModel({
    id: "", name: "", inn: "", plan: "", created: "", terms_at: "", code: "", code_note: "",
    people: 0, pending: 0, vehicles: 0, shifts30: 0, last_shift: "", owner_name: "", owner_phone: "",
  }));
  e.app.db().newQuery(`
    SELECT c.id AS id, c.name AS name, COALESCE(c.inn, '') AS inn, COALESCE(c.plan, '') AS plan, c.created AS created,
      COALESCE(c.terms_at, '') AS terms_at, COALESCE(cc.code, '') AS code, COALESCE(cc.note, '') AS code_note,
      (SELECT count(*) FROM memberships m WHERE m.company = c.id AND m.status = 'active') AS people,
      (SELECT count(*) FROM memberships m WHERE m.company = c.id AND m.status = 'pending') AS pending,
      (SELECT count(*) FROM vehicles v WHERE v.company = c.id) AS vehicles,
      (SELECT count(*) FROM shifts s WHERE s.company = c.id AND s.date >= {:d30}) AS shifts30,
      COALESCE((SELECT max(s.updated) FROM shifts s WHERE s.company = c.id), '') AS last_shift,
      ${owner("name")} AS owner_name,
      ${owner("phone")} AS owner_phone
    FROM companies c LEFT JOIN connect_codes cc ON cc.id = c.connect_code
    ORDER BY c.created DESC`).bind({ d30 }).all(rows);
  return e.json(200, { items: rows });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/ordius/admin/companies/{id}/plan", (e) => {
  const adm = require(`${__hooks}/lib/admin.js`);
  const { normalizePhone, audit } = require(`${__hooks}/lib/util.js`);
  if (!adm.isAdmin(e.auth, normalizePhone)) throw new ForbiddenError("Только для администратора Ordius");
  const plan = String((e.requestInfo().body || {}).plan || "");
  if (["pilot", "free", "start", "business"].indexOf(plan) === -1) throw new BadRequestError("Неизвестный тариф");
  let c = null;
  try { c = e.app.findRecordById("companies", e.request.pathValue("id")); } catch (_) { throw new NotFoundError("Компания не найдена"); }
  c.set("plan", plan);
  e.app.save(c);
  // запись в журнале компании: владелец видит, что тариф поменял Ordius
  audit(e.app, "update", c, e.auth, { reason: "plan changed by Ordius admin" });
  return e.json(200, { id: c.id, plan });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/ordius/admin/leads", (e) => {
  const adm = require(`${__hooks}/lib/admin.js`);
  const { normalizePhone } = require(`${__hooks}/lib/util.js`);
  if (!adm.isAdmin(e.auth, normalizePhone)) throw new ForbiddenError("Только для администратора Ordius");
  const items = e.app.findRecordsByFilter("leads", "id != ''", "-created", 300, 0).map((r) => ({
    id: r.id, ref: r.get("ref"), name: r.get("name"), phone: r.get("phone"), company: r.get("company"),
    fleet: r.get("fleet"), method: r.get("method"), comment: r.get("comment"), created: r.getString("created"),
    status: r.get("status") || "new", admin_note: r.get("admin_note"), mailed: r.get("mailed"),
  }));
  return e.json(200, { items });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/ordius/admin/leads/{id}", (e) => {
  const adm = require(`${__hooks}/lib/admin.js`);
  const { normalizePhone } = require(`${__hooks}/lib/util.js`);
  if (!adm.isAdmin(e.auth, normalizePhone)) throw new ForbiddenError("Только для администратора Ordius");
  let r = null;
  try { r = e.app.findRecordById("leads", e.request.pathValue("id")); } catch (_) { throw new NotFoundError("Заявка не найдена"); }
  const body = e.requestInfo().body || {};
  if (body.status !== undefined) {
    if (["new", "in_work", "connected", "rejected"].indexOf(body.status) === -1) throw new BadRequestError("Неизвестный статус");
    r.set("status", body.status);
  }
  if (body.admin_note !== undefined) r.set("admin_note", String(body.admin_note || "").slice(0, 500));
  e.app.save(r);
  return e.json(200, { id: r.id, status: r.get("status") || "new", admin_note: r.get("admin_note") });
}, $apis.requireAuth("users"));
