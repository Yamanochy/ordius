/// <reference path="../pb_data/types.d.ts" />
// Коды подключения: на пилоте компанию создаёт только тот, кому администратор Ordius выдал код.
// Коллекция без правил доступа — работает только через /api/ordius/connect-codes (hooks/admin.pb.js).
// У компании — по какому коду она подключилась.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const codes = new Collection({
    type: "base",
    name: "connect_codes",
    fields: [
      { name: "code", type: "text", required: true, max: 16 },
      { name: "note", type: "text", max: 120 },
      { name: "max_uses", type: "number", onlyInt: true, min: 1, max: 20, required: true },
      { name: "used", type: "number", onlyInt: true, min: 0 },
      { name: "expires", type: "date" },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_connect_codes_code ON connect_codes (code)"],
  });
  app.save(codes);

  const companies = app.findCollectionByNameOrId("companies");
  companies.fields.add(new RelationField({ name: "connect_code", collectionId: codes.id, maxSelect: 1, cascadeDelete: false }));
  app.save(companies);

  // подбор кода перебором: не больше 10 попыток создать компанию за 10 минут с одного адреса
  const s = app.settings();
  const label = "companies:create";
  if (!s.rateLimits.rules.some((r) => r.label === label)) {
    s.rateLimits.rules = s.rateLimits.rules
      .map((r) => ({ label: r.label, audience: r.audience, maxRequests: r.maxRequests, duration: r.duration }))
      .concat([{ label, maxRequests: 10, duration: 600 }]);
    app.save(s);
  }
}, (app) => {
  const s = app.settings();
  s.rateLimits.rules = s.rateLimits.rules
    .filter((r) => r.label !== "companies:create")
    .map((r) => ({ label: r.label, audience: r.audience, maxRequests: r.maxRequests, duration: r.duration }));
  app.save(s);
  const companies = app.findCollectionByNameOrId("companies");
  companies.fields.removeByName("connect_code");
  app.save(companies);
  try { app.delete(app.findCollectionByNameOrId("connect_codes")); } catch (_) { /* уже нет */ }
});
