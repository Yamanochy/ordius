/// <reference path="../pb_data/types.d.ts" />
// Юридическая часть рабочей версии:
// - пользователь и компания хранят, какую редакцию условий использования приняли и когда
//   (условия — договор с пользователем и поручение компании на обработку данных её работников, ч. 3 ст. 6 152-ФЗ);
// - заявки с формы на ordius.ru принимает этот сервер (раньше — облачная функция Yandex Cloud).
//   Коллекция leads без правил доступа: видит только администратор сервера.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "terms_version", max: 20 }));
  users.fields.add(new DateField({ name: "terms_at" }));
  app.save(users);

  const companies = app.findCollectionByNameOrId("companies");
  companies.fields.add(new TextField({ name: "terms_version", max: 20 }));
  companies.fields.add(new DateField({ name: "terms_at" }));
  app.save(companies);

  const leads = new Collection({
    type: "base",
    name: "leads",
    fields: [
      { name: "ref", type: "text", required: true, max: 16 },
      { name: "name", type: "text", required: true, max: 80 },
      { name: "phone", type: "text", required: true, max: 16 },
      { name: "company", type: "text", max: 120 },
      { name: "fleet", type: "text", max: 20 },
      { name: "method", type: "text", max: 40 },
      { name: "comment", type: "text", max: 1000 },
      // доказательство согласия (ч. 3 ст. 9 152-ФЗ): какая редакция и когда
      { name: "consent_version", type: "text", required: true, max: 20 },
      { name: "consent_at", type: "date", required: true },
      { name: "source", type: "text", max: 40 },
      { name: "mailed", type: "bool" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_leads_created ON leads (created)",
      "CREATE UNIQUE INDEX idx_leads_ref ON leads (ref)",
    ],
  });
  app.save(leads);

  const s = app.settings();
  const label = "POST /api/ordius/lead";
  if (!s.rateLimits.rules.some((r) => r.label === label)) {
    s.rateLimits.rules = s.rateLimits.rules
      .map((r) => ({ label: r.label, audience: r.audience, maxRequests: r.maxRequests, duration: r.duration }))
      .concat([{ label, maxRequests: 10, duration: 600 }]);
    app.save(s);
  }
}, (app) => {
  const s = app.settings();
  s.rateLimits.rules = s.rateLimits.rules
    .filter((r) => r.label !== "POST /api/ordius/lead")
    .map((r) => ({ label: r.label, audience: r.audience, maxRequests: r.maxRequests, duration: r.duration }));
  app.save(s);

  try { app.delete(app.findCollectionByNameOrId("leads")); } catch (_) { /* уже нет */ }
  for (const name of ["users", "companies"]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.removeByName("terms_version");
    c.fields.removeByName("terms_at");
    app.save(c);
  }
});
