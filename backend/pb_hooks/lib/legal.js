// Редакции документов, которые принимают люди. Меняются вместе с текстами на ordius.ru
// и с app/src/lib/legal.js. Принятую редакцию сервер записывает в пользователя или компанию.
const TERMS_VERSION = "2026-10-27"; // https://ordius.ru/terms.html — условия использования (договор, поручение)
const CONSENT_VERSION = "2026-10-27"; // https://ordius.ru/consent.html — согласие для формы заявок

module.exports = {
  TERMS_VERSION,
  CONSENT_VERSION,
  TERMS_URL: "https://ordius.ru/terms.html",
  CONSENT_URL: "https://ordius.ru/consent.html",
};
