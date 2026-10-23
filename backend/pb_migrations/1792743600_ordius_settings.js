/// <reference path="../pb_data/types.d.ts" />
// Базовые настройки PocketBase для Ordius. Применяется автоматически при запуске сервера.
migrate((app) => {
  const s = app.settings();

  s.meta.appName = "Ordius";
  s.meta.appURL = "https://app.ordius.ru";
  s.meta.senderName = "Ordius";
  s.meta.senderAddress = "ordius.info@yandex.ru";

  // PocketBase стоит за Caddy: настоящий IP клиента — в заголовке X-Forwarded-For,
  // который Caddy выставляет сам (поддельный заголовок от клиента он отбрасывает).
  // Без этого все запросы выглядели бы как с 127.0.0.1, и ограничения ниже не работали бы.
  s.trustedProxy.headers = ["X-Forwarded-For"];
  s.trustedProxy.useLeftmostIP = false;

  // Вход администратора — только с самого сервера (через SSH-туннель).
  s.superuserIPs = ["127.0.0.1", "::1"];

  // Защита от подбора паролей и потока запросов.
  s.rateLimits.enabled = true;

  // Пакетные запросы — для отправки очереди «без сети» одним запросом.
  s.batch.enabled = true;
  s.batch.maxRequests = 50;
  s.batch.timeout = 10;

  // Журнал запросов храним 14 дней и без IP-адресов: в политике обработки ПДн IP не собирается.
  s.logs.maxDays = 14;
  s.logs.logIP = false;

  app.save(s);
}, (app) => {
  // Откат настроек не нужен: при откате миграции остаются текущие значения.
});
