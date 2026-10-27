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
