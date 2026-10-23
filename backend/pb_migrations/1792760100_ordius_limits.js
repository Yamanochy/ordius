/// <reference path="../pb_data/types.d.ts" />
// Ограничения частоты для кодов и звонков: вступление в компанию, смена пароля, подтверждение номера,
// регистрация. Подбирать коды перебором и обзванивать чужие номера с одного адреса не получится.
// Лимиты на сам номер и на сутки — в хуке /api/ordius/phone/start.
migrate((app) => {
  const rules = [
    { label: "POST /api/ordius/join", maxRequests: 10, duration: 60 },
    { label: "POST /api/ordius/password-reset", maxRequests: 5, duration: 300 },
    { label: "POST /api/ordius/phone/start", maxRequests: 20, duration: 600 },
    { label: "POST /api/ordius/phone/verify", maxRequests: 30, duration: 600 },
    // приложение спрашивает «был ли звонок» раз в 2–3 секунды, пока человек звонит (до 5 минут)
    { label: "POST /api/ordius/phone/status", maxRequests: 300, duration: 600 },
    { label: "POST /api/ordius/signup", maxRequests: 10, duration: 600 },
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
  const drop = ["POST /api/ordius/join", "POST /api/ordius/password-reset", "POST /api/ordius/phone/start",
    "POST /api/ordius/phone/verify", "POST /api/ordius/phone/status", "POST /api/ordius/signup"];
  const s = app.settings();
  s.rateLimits.rules = s.rateLimits.rules
    .filter((r) => drop.indexOf(r.label) === -1)
    .map((r) => ({ label: r.label, audience: r.audience, maxRequests: r.maxRequests, duration: r.duration }));
  app.save(s);
});
