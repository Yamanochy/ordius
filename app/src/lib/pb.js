import PocketBase from 'pocketbase';

// Приложение и API живут на одном адресе (app.ordius.ru). Для разработки — VITE_PB_URL.
export const pb = new PocketBase(import.meta.env.VITE_PB_URL || window.location.origin);
pb.autoCancellation(false);

// Нет ответа от сервера (нет связи, сервер недоступен), а не отказ сервера.
export function isNetworkError(err) {
  return !!err && (err.status === 0 || err.name === 'TypeError') && !err.isAbort;
}

// Понятный текст ошибки PocketBase: сообщение сервера или первая ошибка поля.
export function errText(err, fallback = 'Не получилось. Попробуйте ещё раз') {
  if (!err) return fallback;
  if (isNetworkError(err)) return 'Нет связи с сервером. Проверьте интернет';
  const r = err.response || err.data || {};
  const data = r.data || {};
  const firstField = Object.keys(data)[0];
  if (r.message && !/^(Failed to|Something went wrong)/.test(r.message) && !(firstField && /validate/i.test(r.message))) return r.message;
  if (firstField) return FIELD_NAMES[firstField] ? `${FIELD_NAMES[firstField]}: ${fieldMsg(data[firstField])}` : fieldMsg(data[firstField]);
  if (err.status === 403) return 'Нет прав на это действие';
  if (err.status === 404) return 'Не найдено или нет доступа';
  if (err.status === 429) return 'Слишком много попыток. Подождите немного';
  return r.message || err.message || fallback;
}

const FIELD_NAMES = {
  phone: 'Телефон', password: 'Пароль', name: 'Имя', display_name: 'Имя', date: 'Дата', quantity: 'Количество',
  amount_kop: 'Сумма', valid_from: 'Действует с', unit: 'Единица', vehicle: 'Техника', site: 'Объект', member: 'Сотрудник',
  liters: 'Литры', title: 'Название', number: 'Номер', inn: 'ИНН', plate: 'Госномер', text: 'Текст',
};

function fieldMsg(f) {
  if (!f) return 'неверное значение';
  const m = {
    validation_required: 'обязательно', validation_invalid_format: 'неверный формат', validation_not_unique: 'уже есть',
    validation_min_text_constraint: 'слишком коротко', validation_max_text_constraint: 'слишком длинно',
    validation_min_number_constraint: 'слишком мало', validation_max_number_constraint: 'слишком много',
  }[f.code];
  return m || f.message || 'неверное значение';
}

// Ошибка «запись с таким id уже есть» — значит, она уже дошла раньше (повторная отправка из очереди).
export function isDuplicateId(err) {
  const d = err && err.response && err.response.data;
  return !!(d && d.id && d.id.code === 'validation_not_unique');
}
