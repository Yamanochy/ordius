/// <reference path="../pb_data/types.d.ts" />
// Серверная логика Ordius. Права доступа проверяют правила коллекций (миграция ordius_schema);
// здесь — то, что правилами не выразить: расчёт смен, вступление в компанию, защита роли владельца,
// служебные поля и журнал изменений.
//
// Каждый обработчик PocketBase выполняет отдельно: переменные верхнего уровня внутри него не видны.
// Поэтому помощники подключаются через require внутри обработчика, а обработчик передаётся напрямую, без обёрток.

// ---------- общее: запись и всё, на что она ссылается, — из одной компании ----------
// Дублирует правила доступа на случай ошибки в них: ни одна ссылка (водитель, техника, объект, смена…)
// не может вести в чужую компанию, а саму компанию у записи сменить нельзя.
const sameCompany = (e) => {
  const rec = e.record;
  const col = rec.collection();
  if (col.name === "companies" || !col.fields.getByName("company")) return e.next();
  const companyId = rec.get("company");
  if (!rec.isNew() && rec.original().get("company") !== companyId) {
    throw new BadRequestError("Компанию у записи менять нельзя");
  }
  const fields = col.fields;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.type() !== "relation" || f.getName() === "company") continue;
    const target = e.app.findCollectionByNameOrId(f.collectionId);
    if (!target.fields.getByName("company")) continue;
    for (const id of rec.getStringSlice(f.getName())) {
      let other = null;
      try { other = e.app.findRecordById(target.id, id); } catch (_) { /* проверит валидация поля */ }
      if (other && other.get("company") !== companyId) {
        throw new BadRequestError(`Поле «${f.getName()}» ссылается на запись другой компании`);
      }
    }
  }
  e.next();
};
onRecordCreateRequest(sameCompany);
onRecordUpdateRequest(sameCompany);

// ---------- пользователи: телефон в едином виде ----------
// Телефон видит только сам человек (и администратор сервера); коллегам — через карточку участника.
onRecordEnrich((e) => {
  const info = e.requestInfo;
  const self = info && info.auth && info.auth.collection().name === "users" && info.auth.id === e.record.id;
  if (!self && !(info && info.hasSuperuserAuth())) e.record.hide("phone");
  e.next();
}, "users");

// Номер меняется только через подтверждение звонком (/api/ordius/phone/change); напрямую — только администратор.
const normalizeUserPhone = (e) => {
  const { normalizePhone } = require(`${__hooks}/lib/util.js`);
  const body = e.requestInfo().body || {};
  const sent = Object.prototype.hasOwnProperty.call(body, "phone");
  if (sent && !e.hasSuperuserAuth() && normalizePhone(body.phone) !== e.record.original().get("phone")) {
    throw new BadRequestError("Номер меняется только с подтверждением звонком");
  }
  if (sent) {
    const raw = String(body.phone || "").trim();
    if (raw) {
      const p = normalizePhone(raw);
      if (!p) throw new BadRequestError("Телефон указан неверно");
      e.record.set("phone", p);
    } else {
      e.record.set("phone", "");
    }
  }
  if (!e.record.get("phone") && !e.record.get("email")) {
    throw new BadRequestError("Нужен телефон или почта");
  }
  e.next();
};
onRecordCreateRequest(normalizeUserPhone, "users");
onRecordUpdateRequest(normalizeUserPhone, "users");

// Вход: телефон в любом написании («8 923…», «+7 (923)…») приводим к виду, в котором он хранится.
onRecordAuthWithPasswordRequest((e) => {
  const { normalizePhone } = require(`${__hooks}/lib/util.js`);
  const p = normalizePhone(e.identity);
  if (p && !e.record) {
    try { e.record = e.app.findFirstRecordByData("users", "phone", p); } catch (_) { /* неверный вход */ }
  }
  e.next();
}, "users");

// ---------- подтверждение номера звонком ----------
// 1) POST /api/ordius/phone/start  { phone, purpose }  → робот звонит, { check, expires }
//    purpose: signup — регистрация, login — вход без пароля, reset — новый пароль, change — смена номера (нужен вход)
// 2) POST /api/ordius/phone/verify { check, code }     → code = последние 4 цифры входящего номера, { ticket }
// 3) билет (15 минут, один раз) — в signup, phone/login, password-reset или phone/change.
routerAdd("POST", "/api/ordius/phone/start", (e) => {
  const { normalizePhone } = require(`${__hooks}/lib/util.js`);
  const ph = require(`${__hooks}/lib/phone.js`);
  const body = e.requestInfo().body || {};
  const purpose = String(body.purpose || "");
  if (ph.PURPOSES.indexOf(purpose) === -1) throw new BadRequestError("Неизвестная цель проверки");
  const phone = normalizePhone(body.phone);
  if (!phone) throw new BadRequestError("Телефон указан неверно");
  const isUser = e.auth && e.auth.collection().name === "users";
  if (purpose === "change" && !isUser) throw new UnauthorizedError("Войдите в приложение");

  let existing = null;
  try { existing = e.app.findFirstRecordByData("users", "phone", phone); } catch (_) { /* номер свободен */ }
  if ((purpose === "signup" || purpose === "change") && existing) {
    throw new BadRequestError("Этот номер уже зарегистрирован. Войдите или восстановите пароль");
  }
  if ((purpose === "login" || purpose === "reset") && !existing) {
    throw new BadRequestError("Номер не зарегистрирован");
  }

  // Каждый звонок стоит денег и может быть использован, чтобы донимать чужой номер, поэтому лимиты.
  const now = Date.now();
  const count = (filter, params) => e.app.countRecords("phone_checks", $dbx.exp(filter, params));
  const ipHash = $security.sha256("ordius:" + e.realIP());
  if (count("phone = {:p} AND created >= {:t}", { p: phone, t: ph.iso(now - 3600e3) }) >= 3 ||
      count("phone = {:p} AND created >= {:t}", { p: phone, t: ph.iso(now - 86400e3) }) >= 6) {
    throw new TooManyRequestsError("На этот номер уже звонили несколько раз. Попробуйте позже");
  }
  // с одного адреса — 20 звонков в час: хватит, чтобы зарегистрировать бригаду с офисного Wi-Fi
  const perIp = Number($os.getenv("ORDIUS_PHONE_IP_HOURLY")) || 20;
  if (count("ip_hash = {:h} AND created >= {:t}", { h: ipHash, t: ph.iso(now - 3600e3) }) >= perIp) {
    throw new TooManyRequestsError("Слишком много звонков с этого устройства. Попробуйте позже");
  }
  const cap = Number($os.getenv("ORDIUS_PHONE_DAILY_CAP")) || 300;
  if (count("created >= {:t}", { t: ph.iso(now - 86400e3) }) >= cap) {
    e.app.logger().error("phone check daily cap reached", "cap", cap);
    throw new TooManyRequestsError("Сервис подтверждения временно перегружен. Попробуйте через час");
  }

  let call;
  try {
    call = ph.placeCall(phone, e.realIP());
  } catch (err) {
    e.app.logger().error("phone call failed", "error", String(err));
    if (err.notConfigured) throw new ApiError(503, "Подтверждение номера ещё не настроено на сервере", null);
    throw new BadRequestError("Не получилось позвонить. Проверьте номер и попробуйте через минуту");
  }
  const rec = new Record(e.app.findCollectionByNameOrId("phone_checks"));
  rec.set("phone", phone);
  rec.set("purpose", purpose);
  rec.set("status", "sent");
  rec.set("code", call.code);
  rec.set("attempts", 0);
  rec.set("expires", ph.iso(now + ph.CODE_TTL_MIN * 60e3));
  rec.set("ip_hash", ipHash);
  if (purpose === "change") rec.set("user", e.auth.id);
  rec.set("call_id", call.callId);
  rec.set("cost", call.cost);
  e.app.save(rec);
  return e.json(200, { check: rec.id, expires: rec.getString("expires"), digits: 4 });
});

routerAdd("POST", "/api/ordius/phone/verify", (e) => {
  const ph = require(`${__hooks}/lib/phone.js`);
  const body = e.requestInfo().body || {};
  let rec = null;
  try { rec = e.app.findRecordById("phone_checks", String(body.check || "")); } catch (_) { /* нет такой */ }
  const again = "Запросите звонок ещё раз";
  if (!rec || rec.get("status") !== "sent") throw new BadRequestError(again);
  if (rec.getString("expires") < ph.iso(Date.now())) throw new BadRequestError("Время вышло. " + again);
  const code = String(body.code || "").replace(/\D/g, "");
  if (code !== rec.get("code")) {
    const n = rec.getInt("attempts") + 1;
    rec.set("attempts", n);
    if (n >= ph.MAX_ATTEMPTS) { rec.set("status", "failed"); rec.set("code", ""); }
    e.app.save(rec);
    throw new BadRequestError(n >= ph.MAX_ATTEMPTS ? "Слишком много попыток. " + again : "Цифры не совпадают");
  }
  const ticket = $security.randomString(40);
  rec.set("status", "verified");
  rec.set("code", "");
  rec.set("ticket_hash", $security.sha256(ticket));
  rec.set("ticket_expires", ph.iso(Date.now() + ph.TICKET_TTL_MIN * 60e3));
  e.app.save(rec);
  return e.json(200, { ticket, phone: rec.get("phone"), purpose: rec.get("purpose") });
});

// Регистрация: POST /api/ordius/signup { ticket, name, password } → вход сразу (как auth-with-password).
routerAdd("POST", "/api/ordius/signup", (e) => {
  const ph = require(`${__hooks}/lib/phone.js`);
  const body = e.requestInfo().body || {};
  const chk = ph.findTicket(e.app, body.ticket, "signup");
  if (!chk) throw new BadRequestError("Подтвердите номер ещё раз");
  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new BadRequestError("Укажите имя и фамилию");
  const pass = String(body.password || "");
  if (pass.length < 8 || pass.length > 71) throw new BadRequestError("Пароль — от 8 до 71 символа");
  const user = new Record(e.app.findCollectionByNameOrId("users"));
  user.set("name", name.slice(0, 120));
  user.set("phone", chk.get("phone"));
  user.set("emailVisibility", false);
  user.setPassword(pass);
  try {
    e.app.runInTransaction((tx) => {
      tx.save(user);
      chk.set("status", "used");
      chk.set("user", user.id);
      tx.save(chk);
    });
  } catch (err) {
    e.app.logger().error("signup failed", "error", String(err));
    throw new BadRequestError("Не получилось зарегистрироваться: возможно, номер уже занят");
  }
  return $apis.recordAuthResponse(e, user, "phone", null);
});

// Вход без пароля: POST /api/ordius/phone/login { ticket }.
routerAdd("POST", "/api/ordius/phone/login", (e) => {
  const ph = require(`${__hooks}/lib/phone.js`);
  const body = e.requestInfo().body || {};
  const chk = ph.findTicket(e.app, body.ticket, "login");
  if (!chk) throw new BadRequestError("Подтвердите номер ещё раз");
  let user = null;
  try { user = e.app.findFirstRecordByData("users", "phone", chk.get("phone")); } catch (_) { /* удалён */ }
  if (!user) throw new BadRequestError("Номер не зарегистрирован");
  chk.set("status", "used");
  chk.set("user", user.id);
  e.app.save(chk);
  return $apis.recordAuthResponse(e, user, "phone", null);
});

// Смена номера: POST /api/ordius/phone/change { ticket } — билет выдан на новый номер этому же человеку.
routerAdd("POST", "/api/ordius/phone/change", (e) => {
  const ph = require(`${__hooks}/lib/phone.js`);
  const { audit } = require(`${__hooks}/lib/util.js`);
  const body = e.requestInfo().body || {};
  const chk = ph.findTicket(e.app, body.ticket, "change");
  if (!chk || chk.get("user") !== e.auth.id) throw new BadRequestError("Подтвердите новый номер ещё раз");
  const user = e.app.findRecordById("users", e.auth.id);
  const phone = chk.get("phone");
  try {
    e.app.runInTransaction((tx) => {
      user.set("phone", phone);
      tx.save(user);
      chk.set("status", "used");
      tx.save(chk);
      // контактный телефон в карточках сотрудника — тоже новый
      for (const m of tx.findRecordsByFilter("memberships", "user = {:u}", "", 0, 0, { u: user.id })) {
        m.set("phone", phone);
        tx.save(m);
        audit(tx, "update", m, user, { reason: "phone changed" });
      }
    });
  } catch (err) {
    e.app.logger().error("phone change failed", "error", String(err));
    throw new BadRequestError("Не получилось сменить номер: возможно, он уже занят");
  }
  return e.json(200, { phone });
}, $apis.requireAuth("users"));

// Приглашения по номеру: руководитель завёл человека с телефоном — человек видит это после входа
// и сам решает, вступать ли. GET /api/ordius/invitations, POST /api/ordius/invitations/{id}/accept
routerAdd("GET", "/api/ordius/invitations", (e) => {
  const phone = e.auth.get("phone");
  if (!phone) return e.json(200, { items: [] });
  const items = e.app.findRecordsByFilter("memberships",
    "phone = {:p} && user = '' && status != 'dismissed'", "-created", 50, 0, { p: phone })
    .map((m) => {
      const c = e.app.findRecordById("companies", m.get("company"));
      return { membership: m.id, company: c.id, company_name: c.get("name"), display_name: m.get("display_name"), roles: m.get("roles") };
    });
  return e.json(200, { items });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/ordius/invitations/{id}/accept", (e) => {
  const { audit } = require(`${__hooks}/lib/util.js`);
  const phone = e.auth.get("phone");
  let m = null;
  try {
    m = e.app.findFirstRecordByFilter("memberships", "id = {:id} && phone = {:p} && user = '' && status != 'dismissed'",
      { id: e.request.pathValue("id"), p: phone || "-" });
  } catch (_) { /* нет приглашения */ }
  if (!phone || !m) throw new NotFoundError("Приглашение не найдено");
  let dup = null;
  try {
    dup = e.app.findFirstRecordByFilter("memberships", "company = {:c} && user = {:u}", { c: m.get("company"), u: e.auth.id });
  } catch (_) { /* нет дубля */ }
  if (dup) throw new BadRequestError("Вы уже состоите в этой компании");
  m.set("user", e.auth.id);
  m.set("invite_code", "");
  m.set("invite_expires", "");
  if (m.get("status") === "pending") m.set("status", "active");
  e.app.save(m);
  audit(e.app, "update", m, e.auth, { reason: "invitation accepted" });
  const c = e.app.findRecordById("companies", m.get("company"));
  return e.json(200, { membership: m.id, company: c.id, company_name: c.get("name"), status: m.get("status") });
}, $apis.requireAuth("users"));

// Проверки звонков храним 30 дней, потом удаляем.
cronAdd("ordius_phone_checks_cleanup", "17 21 * * *", () => {
  const cutoff = new Date(Date.now() - 30 * 86400e3).toISOString().replace("T", " ");
  $app.db().newQuery("DELETE FROM phone_checks WHERE created < {:t}").bind({ t: cutoff }).execute();
});

// ---------- компании: создатель становится владельцем ----------
onRecordCreateRequest((e) => {
  const { code, rejectServerFields, audit } = require(`${__hooks}/lib/util.js`);
  // тариф меняет только администратор сервера (после оплаты), не клиент
  rejectServerFields(e, ["join_code", "created_by", "plan"]);
  if (!e.record.get("plan")) e.record.set("plan", "pilot");
  e.record.set("join_code", code(8));
  if (e.hasSuperuserAuth()) return e.next();
  const mine = e.app.countRecords("companies", $dbx.hashExp({ created_by: e.auth.id }));
  if (mine >= 5) throw new BadRequestError("Создано уже 5 компаний. Если нужно больше — напишите в поддержку");
  e.record.set("created_by", e.auth.id);
  e.next();

  const m = new Record(e.app.findCollectionByNameOrId("memberships"));
  m.set("company", e.record.id);
  m.set("user", e.auth.id);
  m.set("display_name", e.auth.get("name"));
  m.set("phone", e.auth.get("phone"));
  m.set("roles", ["owner"]);
  m.set("status", "active");
  try {
    e.app.save(m);
  } catch (err) {
    e.app.delete(e.record);
    throw new BadRequestError("Не удалось создать владельца компании: " + err);
  }
  audit(e.app, "create", e.record, e.auth);
}, "companies");

onRecordUpdateRequest((e) => {
  const { rejectServerFields, audit } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["join_code", "created_by", "plan"]);
  e.next();
  audit(e.app, "update", e.record, e.auth);
}, "companies");

// Новый код вступления (старый перестаёт работать): POST /api/ordius/companies/{id}/join-code
routerAdd("POST", "/api/ordius/companies/{id}/join-code", (e) => {
  const { membershipOf, hasRole, code, audit } = require(`${__hooks}/lib/util.js`);
  const company = e.app.findRecordById("companies", e.request.pathValue("id"));
  if (!hasRole(membershipOf(e.app, company.id, e.auth.id), ["owner", "manager"])) {
    throw new ForbiddenError("Только владелец или руководитель");
  }
  company.set("join_code", code(8));
  e.app.save(company);
  audit(e.app, "update", company, e.auth, { reason: "new join_code" });
  return e.json(200, { join_code: company.get("join_code") });
}, $apis.requireAuth("users"));

// ---------- участники ----------
// Вступление: по коду компании — заявка ждёт одобрения; по личному приглашению — сразу в работу.
// POST /api/ordius/join  { code, display_name? }
routerAdd("POST", "/api/ordius/join", (e) => {
  const { nowIso } = require(`${__hooks}/lib/util.js`);
  const body = e.requestInfo().body || {};
  const raw = String(body.code || "").trim().toUpperCase().replace(/[\s-]/g, "");
  if (raw.length < 6) throw new BadRequestError("Введите код");

  // 1) личное приглашение на уже заведённого руководителем человека
  let invited = null;
  try {
    invited = e.app.findFirstRecordByFilter("memberships",
      "invite_code = {:c} && invite_expires >= {:now} && user = ''", { c: raw, now: nowIso() });
  } catch (_) { /* нет такого приглашения */ }
  if (invited) {
    let dup = null;
    try {
      dup = e.app.findFirstRecordByFilter("memberships", "company = {:c} && user = {:u}",
        { c: invited.get("company"), u: e.auth.id });
    } catch (_) { /* нет дубля */ }
    if (dup) throw new BadRequestError("Вы уже состоите в этой компании");
    invited.set("user", e.auth.id);
    invited.set("invite_code", "");
    invited.set("invite_expires", "");
    if (invited.get("status") === "pending") invited.set("status", "active");
    if (!invited.get("phone")) invited.set("phone", e.auth.get("phone"));
    e.app.save(invited);
    const company = e.app.findRecordById("companies", invited.get("company"));
    return e.json(200, { membership: invited.id, company: company.id, company_name: company.get("name"), status: invited.get("status") });
  }

  // 2) общий код компании — заявка
  let company = null;
  try {
    company = e.app.findFirstRecordByFilter("companies", "join_code = {:c}", { c: raw });
  } catch (_) { /* нет такой компании */ }
  if (!company) throw new NotFoundError("Код не подошёл. Проверьте его у руководителя");

  let existing = null;
  try {
    existing = e.app.findFirstRecordByFilter("memberships", "company = {:c} && user = {:u}", { c: company.id, u: e.auth.id });
  } catch (_) { /* нет */ }
  if (existing) {
    return e.json(200, { membership: existing.id, company: company.id, company_name: company.get("name"), status: existing.get("status") });
  }
  const m = new Record(e.app.findCollectionByNameOrId("memberships"));
  m.set("company", company.id);
  m.set("user", e.auth.id);
  m.set("display_name", String(body.display_name || e.auth.get("name") || "").slice(0, 120));
  m.set("phone", e.auth.get("phone"));
  m.set("roles", ["driver"]);
  m.set("status", "pending");
  e.app.save(m);
  return e.json(200, { membership: m.id, company: company.id, company_name: company.get("name"), status: "pending" });
}, $apis.requireAuth("users"));

// Личное приглашение для заведённого человека: POST /api/ordius/memberships/{id}/invite → { code, expires }
routerAdd("POST", "/api/ordius/memberships/{id}/invite", (e) => {
  const { membershipOf, hasRole, code } = require(`${__hooks}/lib/util.js`);
  const m = e.app.findRecordById("memberships", e.request.pathValue("id"));
  if (!hasRole(membershipOf(e.app, m.get("company"), e.auth.id), ["owner", "manager"])) {
    throw new ForbiddenError("Только владелец или руководитель");
  }
  if (m.get("user")) throw new BadRequestError("Человек уже вошёл в приложение");
  const c = code(8);
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().replace("T", " ");
  m.set("invite_code", c);
  m.set("invite_expires", expires);
  e.app.save(m);
  return e.json(200, { code: c, expires });
}, $apis.requireAuth("users"));

// ---------- смена пароля без почты ----------
// Руководитель выдаёт сотруднику одноразовый код на сутки: POST /api/ordius/memberships/{id}/password-code
// Ограничения — чтобы код не стал способом зайти под чужим аккаунтом:
//   владельцу код не выдаётся (только поддержка), руководителю — только владельцем;
//   человеку, который состоит ещё в одной компании, — только поддержка (иначе руководитель
//   одной компании получил бы доступ к данным другой).
routerAdd("POST", "/api/ordius/memberships/{id}/password-code", (e) => {
  const { membershipOf, hasRole, code, audit } = require(`${__hooks}/lib/util.js`);
  const m = e.app.findRecordById("memberships", e.request.pathValue("id"));
  const me = membershipOf(e.app, m.get("company"), e.auth.id);
  if (!hasRole(me, ["owner", "manager"])) throw new ForbiddenError("Только владелец или руководитель");
  const userId = m.get("user");
  if (!userId) throw new BadRequestError("Человек ещё не входил в приложение — выдайте ему приглашение");
  if (userId === e.auth.id) throw new BadRequestError("Свой пароль меняйте в профиле");
  if (m.get("status") !== "active") throw new BadRequestError("Сотрудник не работает в компании");
  if (hasRole(m, ["owner"])) throw new ForbiddenError("Пароль владельца сбрасывается только через поддержку");
  if (hasRole(m, ["manager"]) && !hasRole(me, ["owner"])) throw new ForbiddenError("Код для руководителя выдаёт только владелец");
  const elsewhere = e.app.findRecordsByFilter("memberships",
    "user = {:u} && company != {:c} && status != 'dismissed'", "", 1, 0, { u: userId, c: m.get("company") });
  if (elsewhere.length) throw new BadRequestError("Сотрудник состоит и в другой компании — сброс пароля через поддержку");
  const c = code(8);
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace("T", " ");
  m.set("reset_code", c);
  m.set("reset_expires", expires);
  e.app.save(m);
  audit(e.app, "update", m, e.auth, { reason: "password reset code issued" });
  return e.json(200, { code: c, expires });
}, $apis.requireAuth("users"));

// Новый пароль по коду: POST /api/ordius/password-reset { phone, code, password }.
// Все входы на других устройствах после этого сбрасываются.
// Или { ticket, password } — билет после подтверждения номера звонком (purpose = reset).
routerAdd("POST", "/api/ordius/password-reset", (e) => {
  const { normalizePhone, nowIso, audit } = require(`${__hooks}/lib/util.js`);
  const body = e.requestInfo().body || {};
  const pass = String(body.password || "");
  if (pass.length < 8 || pass.length > 71) throw new BadRequestError("Пароль — от 8 до 71 символа");

  if (body.ticket) {
    const ph = require(`${__hooks}/lib/phone.js`);
    const chk = ph.findTicket(e.app, body.ticket, "reset");
    let u = null;
    if (chk) {
      try { u = e.app.findFirstRecordByData("users", "phone", chk.get("phone")); } catch (_) { /* удалён */ }
    }
    if (!u) throw new BadRequestError("Подтвердите номер ещё раз");
    e.app.runInTransaction((tx) => {
      u.setPassword(pass);
      tx.save(u);
      chk.set("status", "used");
      chk.set("user", u.id);
      tx.save(chk);
    });
    return e.json(200, { ok: true });
  }

  const phone = normalizePhone(body.phone);
  const c = String(body.code || "").trim().toUpperCase().replace(/[\s-]/g, "");
  const wrong = "Телефон или код не подходят";
  if (!phone || c.length < 6) throw new BadRequestError(wrong);
  let user = null;
  let m = null;
  try {
    user = e.app.findFirstRecordByData("users", "phone", phone);
    m = e.app.findFirstRecordByFilter("memberships",
      "user = {:u} && reset_code = {:c} && reset_expires >= {:now} && status = 'active'", { u: user.id, c, now: nowIso() });
  } catch (_) { /* неверный телефон или код */ }
  if (!user || !m) throw new BadRequestError(wrong);
  e.app.runInTransaction((txApp) => {
    user.setPassword(pass);
    txApp.save(user);
    m.set("reset_code", "");
    m.set("reset_expires", "");
    txApp.save(m);
  });
  audit(e.app, "update", m, user, { reason: "password reset by code" });
  return e.json(200, { ok: true });
});

// Роль владельца: выдаёт и снимает только владелец; у компании всегда остаётся хотя бы один владелец.
const guardOwners = (e) => {
  const isCreate = e.record.isNew();
  const { membershipOf, hasRole, normalizePhone, rejectServerFields, audit } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["invite_code", "invite_expires"]);
  const phone = e.record.get("phone");
  if (phone) {
    const p = normalizePhone(phone);
    if (!p) throw new BadRequestError("Телефон указан неверно");
    e.record.set("phone", p);
  }
  if (!e.hasSuperuserAuth()) {
    const me = membershipOf(e.app, e.record.get("company"), e.auth.id);
    const iAmOwner = hasRole(me, ["owner"]);
    const was = isCreate ? [] : (e.record.original().get("roles") || []);
    const now = e.record.get("roles") || [];
    const touchesOwner = (was.indexOf("owner") !== -1) !== (now.indexOf("owner") !== -1) ||
      (!isCreate && was.indexOf("owner") !== -1 && e.record.get("status") !== e.record.original().get("status"));
    if (touchesOwner && !iAmOwner) throw new ForbiddenError("Роль владельца может менять только владелец");
    if (!isCreate && was.indexOf("owner") !== -1 && (now.indexOf("owner") === -1 || e.record.get("status") !== "active")) {
      const owners = e.app.findRecordsByFilter("memberships",
        "company = {:c} && status = 'active' && roles ?= 'owner' && id != {:id}", "", 0, 0,
        { c: e.record.get("company"), id: e.record.id });
      if (!owners.length) throw new BadRequestError("В компании должен остаться хотя бы один владелец");
    }
  }
  if (e.record.get("status") === "dismissed" && !e.record.getString("dismissed_on")) {
    e.record.set("dismissed_on", new Date().toISOString().slice(0, 10) + " 00:00:00.000Z");
  }
  e.next();
  audit(e.app, isCreate ? "create" : "update", e.record, e.auth);
};
onRecordCreateRequest(guardOwners, "memberships");
onRecordUpdateRequest(guardOwners, "memberships");

// ---------- смены: расчёт при подтверждении ----------
// Поля смены, которые ставит только сервер: amount_kop, calc, confirmed_by, confirmed_at, created_by.

onRecordCreateRequest((e) => {
  const { rejectServerFields, audit } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["amount_kop", "calc", "confirmed_by", "confirmed_at", "created_by"]);
  e.record.set("created_by", e.auth ? e.auth.id : "");
  e.next();
  audit(e.app, "create", e.record, e.auth);
}, "shifts");

onRecordUpdateRequest((e) => {
  const { rejectServerFields, audit, nowIso } = require(`${__hooks}/lib/util.js`);
  const calc = require(`${__hooks}/lib/calc.js`);
  rejectServerFields(e, ["amount_kop", "calc", "confirmed_by", "confirmed_at", "created_by"]);
  const before = e.record.original().get("status");
  const after = e.record.get("status");

  if (after === "confirmed" && before !== "confirmed") {
    const shift = e.record;
    const companyId = shift.get("company");
    const entries = e.app.findRecordsByFilter("shift_entries", "shift = {:s}", "created", 0, 0, { s: shift.id })
      .map((r) => ({ id: r.id, unit: r.get("unit"), vehicle: r.get("vehicle"), quantity: r.get("quantity"),
        tons: r.get("tons"), km: r.get("km"), overtime: r.get("overtime") }));
    const rates = e.app.findRecordsByFilter("rates", "company = {:c} && unit != 'month'", "", 0, 0, { c: companyId })
      .map((r) => ({ id: r.id, unit: r.get("unit"), amount_kop: r.get("amount_kop"), member: r.get("member"),
        vehicle: r.get("vehicle"), site: r.get("site"), customer: r.get("customer"),
        valid_from: r.getString("valid_from"), valid_to: r.getString("valid_to") }));
    const factors = e.app.findRecordsByFilter("rate_factors", "company = {:c}", "", 0, 0, { c: companyId })
      .map((r) => ({ kind: r.get("kind"), factor_permille: r.get("factor_permille"),
        valid_from: r.getString("valid_from"), valid_to: r.getString("valid_to") }));
    let result;
    try {
      result = calc.calcShift({ member: shift.get("member"), site: shift.get("site"), customer: shift.get("customer"),
        date: shift.getString("date"), night: shift.get("night"), holiday: shift.get("holiday") }, entries, rates, factors);
    } catch (err) {
      throw new BadRequestError("Смену нельзя подтвердить: " + err.message, err.missing ? { missing: err.missing } : undefined);
    }
    shift.set("amount_kop", result.amount_kop);
    shift.set("calc", result);
    shift.set("confirmed_by", e.auth ? e.auth.id : "");
    shift.set("confirmed_at", nowIso());
    shift.set("reject_reason", "");
  } else if (before === "confirmed" && after !== "confirmed") {
    e.record.set("amount_kop", null);
    e.record.set("calc", null);
    e.record.set("confirmed_by", "");
    e.record.set("confirmed_at", "");
  }
  if (after === "rejected" && !String(e.record.get("reject_reason") || "").trim()) {
    throw new BadRequestError("Укажите причину, по которой смена возвращена");
  }
  e.next();
  audit(e.app, "update", e.record, e.auth, { status: { from: before, to: after } });
}, "shifts");

onRecordDeleteRequest((e) => {
  const { audit } = require(`${__hooks}/lib/util.js`);
  e.next();
  audit(e.app, "delete", e.record, e.auth);
}, "shifts");

// Строки смены: проверка количества по единице расчёта.
const checkEntry = (e) => {
  const unit = e.record.get("unit");
  if (unit === "tkm" && (!(e.record.get("tons") > 0) || !(e.record.get("km") > 0))) {
    throw new BadRequestError("Для тонно-километров укажите тонны и километры");
  }
  if ((unit === "hour" || unit === "trip") && !(e.record.get("quantity") > 0)) {
    throw new BadRequestError(unit === "hour" ? "Укажите часы" : "Укажите число рейсов");
  }
  e.next();
};
onRecordCreateRequest(checkEntry, "shift_entries");
onRecordUpdateRequest(checkEntry, "shift_entries");

// ---------- деньги: кто внёс, журнал ----------
const moneyCreate = (e) => {
  const { rejectServerFields, audit } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["created_by", "member_confirmed_at"]);
  e.record.set("created_by", e.auth ? e.auth.id : "");
  e.next();
  audit(e.app, "create", e.record, e.auth);
};
const moneyUpdate = (e) => {
  const { rejectServerFields, audit, nowIso } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["created_by", "member_confirmed_at"]);
  if (e.record.collection().name === "payouts") {
    const nowConfirmed = e.record.get("member_confirmed");
    if (nowConfirmed && !e.record.original().get("member_confirmed")) {
      if (e.record.get("status") !== "paid") throw new BadRequestError("Выплата ещё не проведена");
      e.record.set("member_confirmed_at", nowIso());
    } else if (!nowConfirmed) {
      e.record.set("member_confirmed_at", "");
    }
  }
  e.next();
  audit(e.app, "update", e.record, e.auth);
};
const moneyDelete = (e) => {
  const { audit } = require(`${__hooks}/lib/util.js`);
  e.next();
  audit(e.app, "delete", e.record, e.auth);
};
for (const c of ["adjustments", "payouts"]) {
  onRecordCreateRequest(moneyCreate, c);
  onRecordUpdateRequest(moneyUpdate, c);
  onRecordDeleteRequest(moneyDelete, c);
}
for (const c of ["rates", "rate_factors"]) {
  onRecordCreateRequest((e) => { const { audit } = require(`${__hooks}/lib/util.js`); e.next(); audit(e.app, "create", e.record, e.auth); }, c);
  onRecordUpdateRequest((e) => { const { audit } = require(`${__hooks}/lib/util.js`); e.next(); audit(e.app, "update", e.record, e.auth); }, c);
  onRecordDeleteRequest((e) => { const { audit } = require(`${__hooks}/lib/util.js`); e.next(); audit(e.app, "delete", e.record, e.auth); }, c);
}

// ---------- документы, задачи, объявления: автор ставится сервером ----------
onRecordCreateRequest((e) => {
  const { rejectServerFields } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["uploaded_by"]);
  e.record.set("uploaded_by", e.auth ? e.auth.id : "");
  e.next();
}, "documents");

onRecordCreateRequest((e) => {
  const { rejectServerFields } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["created_by", "closed_at"]);
  e.record.set("created_by", e.auth ? e.auth.id : "");
  if (!e.record.get("status")) e.record.set("status", "new");
  if (!e.record.get("priority")) e.record.set("priority", "normal");
  e.next();
}, "tasks");

onRecordUpdateRequest((e) => {
  const { rejectServerFields, nowIso } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["created_by", "closed_at"]);
  const before = e.record.original();
  const fromStatus = before.get("status");
  const toStatus = e.record.get("status");
  const reassigned = before.get("assignee") !== e.record.get("assignee") ||
    before.get("assignee_role") !== e.record.get("assignee_role");
  if (toStatus !== fromStatus) {
    e.record.set("closed_at", toStatus === "done" || toStatus === "cancelled" ? nowIso() : "");
  }
  e.next();
  const col = e.app.findCollectionByNameOrId("task_events");
  const add = (kind, extra) => {
    const ev = new Record(col);
    ev.set("company", e.record.get("company"));
    ev.set("task", e.record.id);
    ev.set("author", e.auth ? e.auth.id : "");
    ev.set("kind", kind);
    for (const k in extra) ev.set(k, extra[k]);
    e.app.save(ev);
  };
  if (toStatus !== fromStatus) add("status", { from_status: fromStatus, to_status: toStatus });
  if (reassigned) add("assign", { text: e.record.get("assignee") || e.record.get("assignee_role") || "" });
}, "tasks");

onRecordCreateRequest((e) => {
  const { rejectServerFields } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["author", "from_status", "to_status"]);
  e.record.set("author", e.auth ? e.auth.id : "");
  e.next();
}, "task_events");

onRecordCreateRequest((e) => {
  const { rejectServerFields } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["author"]);
  e.record.set("author", e.auth ? e.auth.id : "");
  e.next();
}, "posts");

// ---------- расчётная ведомость ----------
// GET /api/ordius/payroll?company=…&from=ГГГГ-ММ-ДД&to=ГГГГ-ММ-ДД[&member=…][&format=csv]
// Владелец, руководитель и бухгалтер видят всех; остальные — только себя.
routerAdd("GET", "/api/ordius/payroll", (e) => {
  const { membershipOf, hasRole } = require(`${__hooks}/lib/util.js`);
  const calc = require(`${__hooks}/lib/calc.js`);
  const q = e.requestInfo().query || {};
  const companyId = String(q.company || "");
  const from = String(q.from || "").slice(0, 10);
  const to = String(q.to || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new BadRequestError("Укажите период: from и to в виде ГГГГ-ММ-ДД");
  }
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (days > 370) throw new BadRequestError("Период не длиннее года");
  const me = membershipOf(e.app, companyId, e.auth.id);
  if (!me) throw new ForbiddenError("Нет доступа к компании");
  const seeAll = hasRole(me, ["owner", "manager", "accountant"]);
  let members;
  if (seeAll) {
    members = q.member
      ? [e.app.findFirstRecordByFilter("memberships", "id = {:id} && company = {:c}", { id: String(q.member), c: companyId })]
      : e.app.findRecordsByFilter("memberships", "company = {:c} && status != 'pending'", "display_name", 0, 0, { c: companyId });
  } else {
    members = [me];
  }
  const range = { c: companyId, from: from + " 00:00:00.000Z", to: to + " 23:59:59.999Z" };
  const rows = members.map((m) => {
    const p = Object.assign({ m: m.id }, range);
    const shifts = e.app.findRecordsByFilter("shifts", "member = {:m} && date >= {:from} && date <= {:to}", "date", 0, 0, p)
      .map((s) => ({ status: s.get("status"), amount_kop: s.get("amount_kop") }));
    const monthRates = e.app.findRecordsByFilter("rates", "company = {:c} && unit = 'month' && member = {:m}", "", 0, 0, p)
      .map((r) => ({ unit: "month", amount_kop: r.get("amount_kop"), valid_from: r.getString("valid_from"), valid_to: r.getString("valid_to") }));
    const adjustments = e.app.findRecordsByFilter("adjustments", "member = {:m} && date >= {:from} && date <= {:to}", "", 0, 0, p)
      .map((a) => ({ amount_kop: a.get("amount_kop") }));
    const payouts = e.app.findRecordsByFilter("payouts",
      "member = {:m} && ((period_from != '' && period_from <= {:to} && period_to >= {:from}) || (period_from = '' && paid_on >= {:from} && paid_on <= {:to}))",
      "", 0, 0, p).map((x) => ({ status: x.get("status"), amount_kop: x.get("amount_kop") }));
    return Object.assign({
      member: m.id, display_name: m.get("display_name"), personnel_no: m.get("personnel_no"), status: m.get("status"),
    }, calc.payrollSummary({ shifts, monthRates, adjustments, payouts, from, to }));
  });

  if (q.format === "csv") {
    const rub = (k) => (k / 100).toFixed(2).replace(".", ",");
    const esc = (s) => '"' + String(s || "").replace(/"/g, '""') + '"';
    const head = ["Табельный №", "ФИО", "Смен подтверждено", "Смен не подтверждено", "По сменам, ₽", "Оклад, ₽",
      "Премии, ₽", "Удержания, ₽", "Начислено, ₽", "Выплачено, ₽", "К выплате, ₽"];
    const lines = [head.map(esc).join(";")].concat(rows.map((r) => [
      esc(r.personnel_no), esc(r.display_name), r.shifts_confirmed, r.shifts_pending, rub(r.earned_kop), rub(r.salary_kop),
      rub(r.bonuses_kop), rub(r.deductions_kop), rub(r.accrued_kop), rub(r.paid_kop), rub(r.due_kop),
    ].join(";")));
    e.response.header().set("Content-Type", "text/csv; charset=utf-8");
    e.response.header().set("Content-Disposition", `attachment; filename="ordius-${from}_${to}.csv"`);
    return e.string(200, "﻿" + lines.join("\r\n") + "\r\n");
  }
  return e.json(200, { company: companyId, from, to, rows });
}, $apis.requireAuth("users"));
