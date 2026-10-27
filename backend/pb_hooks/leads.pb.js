/// <reference path="../pb_data/types.d.ts" />
// Заявки на пилот с формы на ordius.ru. Раньше их принимала облачная функция Yandex Cloud (form/),
// теперь — этот сервер: заявка записывается в коллекцию leads (только администратор, правил доступа нет)
// и, если в настройках PocketBase включена почта (SMTP), приходит карточкой на ordius.info@yandex.ru.
//
// POST /api/ordius/lead — тело формы (application/x-www-form-urlencoded) или JSON:
//   name, phone, company?, fleet (a–d), method (n,x,w,o,p), comment?, consent=yes, website (ловушка), elapsed (мс)
// Ответ: { ok: true, ref } · 400 { ok: false, error: "validation", fields: [...] } · 403 { error: "origin" }
// Принимаются только запросы со страниц ordius.ru (ORDIUS_LEAD_ORIGINS — другой список через запятую).
// IP-адрес не сохраняется. Заявки старше года удаляются задачей по расписанию.
routerAdd("POST", "/api/ordius/lead", (e) => {
  const lead = require(`${__hooks}/lib/lead.js`);
  const legal = require(`${__hooks}/lib/legal.js`);
  const { normalizePhone, code, nowIso } = require(`${__hooks}/lib/util.js`);

  const origin = lead.originOf(e.request.header.get("Origin"), e.request.header.get("Referer"));
  if (lead.allowedOrigins($os.getenv("ORDIUS_LEAD_ORIGINS")).indexOf(origin) === -1) {
    return e.json(403, { ok: false, error: "origin" });
  }
  let f = {};
  try { f = e.requestInfo().body || {}; } catch (_) { f = {}; }

  // бот: отвечаем «принято», но ничего не сохраняем — пусть не подбирает обход
  if (lead.isBot(f)) return e.json(200, { ok: true });

  const v = lead.validate(f, normalizePhone);
  if (v.errors) return e.json(400, { ok: false, error: "validation", fields: v.errors });

  const at = nowIso();
  const ref = code(6);
  const rec = new Record(e.app.findCollectionByNameOrId("leads"));
  rec.set("ref", ref);
  rec.set("name", v.data.name);
  rec.set("phone", v.data.phone);
  rec.set("company", v.data.company);
  rec.set("fleet", v.data.fleet);
  rec.set("method", v.data.method);
  rec.set("comment", v.data.comment);
  rec.set("consent_version", legal.CONSENT_VERSION);
  rec.set("consent_at", at);
  rec.set("source", "ordius.ru");
  try {
    e.app.save(rec);
  } catch (err) {
    e.app.logger().error("lead save failed", "error", String(err));
    return e.json(502, { ok: false, error: "unavailable" });
  }

  // письмо — только если почта настроена; заявка уже сохранена, сбой письма её не теряет
  const s = e.app.settings();
  if (s.smtp && s.smtp.enabled && s.meta.senderAddress) {
    try {
      const msg = new MailerMessage({
        from: { address: s.meta.senderAddress, name: "Сайт Ordius" },
        to: [{ address: $os.getenv("ORDIUS_LEADS_TO") || s.meta.senderAddress }],
        subject: `Ordius: заявка на пилот #${ref} — ${v.data.name}`,
        text: lead.card(ref, v.data, at.replace(" ", "T"), legal.CONSENT_URL, legal.CONSENT_VERSION),
      });
      e.app.newMailClient().send(msg);
      rec.set("mailed", true);
      e.app.save(rec);
    } catch (err) {
      // в журнал — без персональных данных, только номер заявки
      e.app.logger().error("lead mail failed", "ref", ref, "error", String(err));
    }
  }
  return e.json(200, { ok: true, ref });
});

// Срок хранения заявок — 1 год (политика и согласие на ordius.ru).
cronAdd("ordius_leads_cleanup", "23 21 * * *", () => {
  const cutoff = new Date(Date.now() - 365 * 86400e3).toISOString().replace("T", " ");
  $app.db().newQuery("DELETE FROM leads WHERE created < {:t}").bind({ t: cutoff }).execute();
});
