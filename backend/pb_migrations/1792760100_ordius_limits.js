/// <reference path="../pb_data/types.d.ts" />
// Ограничения частоты для кодов: вступление в компанию и смена пароля по коду.
// Подбирать 8-значные коды перебором с одного адреса не получится.
migrate((app) => {
  const rules = [
    { label: "POST /api/ordius/join", maxRequests: 10, duration: 60 },
    { label: "POST /api/ordius/password-reset", maxRequests: 5, duration: 300 },
  ];
  const s = app.settings();
  const have = s.rateLimits.rules.map((r) => r.label);
  const next = s.rateLimits.rules.map((r) => ({ label: r.label, audience: r.audience, maxRequests: r.maxRequests, duration: r.duration }));
  for (const r of rules) {
    if (have.indexOf(r.label) === -1) next.push(r);
  }
  s.rateLimits.rules = next;
  app.save(s);
}, (app) => {
  const drop = ["POST /api/ordius/join", "POST /api/ordius/password-reset"];
  const s = app.settings();
  s.rateLimits.rules = s.rateLimits.rules
    .filter((r) => drop.indexOf(r.label) === -1)
    .map((r) => ({ label: r.label, audience: r.audience, maxRequests: r.maxRequests, duration: r.duration }));
  app.save(s);
});
