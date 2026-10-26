// Очередь отправки. Всё, что водитель вносит (смена, строки, фото, заправка), сначала ложится сюда,
// а потом по порядку уходит на сервер — сразу, если есть связь, или когда она появится.
// Запись создаётся с id, который задало приложение, поэтому повторная отправка не создаёт дубль:
// сервер отвечает «такой id уже есть», и это считается успехом.
import { pb, isNetworkError, isDuplicateId, errText } from './pb.js';
import { outboxAdd, outboxAll, outboxDelete, outboxPut } from './idb.js';

const listeners = new Set();
let running = null;
let lastItems = [];

export function subscribe(fn) {
  listeners.add(fn);
  fn(lastItems);
  return () => listeners.delete(fn);
}
async function emit() {
  try { lastItems = await outboxAll(); } catch (_) { lastItems = []; }
  for (const fn of listeners) fn(lastItems);
}

// ops: [{ op: 'create'|'update'|'delete', col, id, data, files: { поле: [{ blob, name }] }, label }]
export async function enqueue(ops) {
  const now = Date.now();
  await outboxAdd(ops.map((o, i) => ({ ...o, at: now + i, tries: 0, error: '' })));
  await emit();
  flush();
}

export async function removeItem(seq) {
  await outboxDelete(seq);
  await emit();
}

function body(item) {
  const hasFiles = item.files && Object.keys(item.files).some((k) => item.files[k] && item.files[k].length);
  if (!hasFiles) return item.op === 'create' ? { id: item.id, ...item.data } : item.data;
  const fd = new FormData();
  if (item.op === 'create') fd.append('id', item.id);
  for (const [k, v] of Object.entries(item.data || {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.append(k, v === null ? '' : typeof v === 'boolean' ? String(v) : v);
  }
  for (const [field, list] of Object.entries(item.files)) {
    for (const f of list || []) fd.append(field, f.blob, f.name || 'photo.jpg');
  }
  return fd;
}

async function send(item) {
  const c = pb.collection(item.col);
  if (item.op === 'create') return c.create(body(item));
  if (item.op === 'update') return c.update(item.id, body(item));
  if (item.op === 'delete') return c.delete(item.id);
  throw new Error('неизвестная операция');
}

// Отправить всё, что накопилось. Возвращает, сколько осталось.
export function flush() {
  // уже отправляем — дождаться и пройти ещё раз: за это время могли добавиться новые записи
  if (running) return running.then(() => flush());
  running = (async () => {
    let items = [];
    try { items = await outboxAll(); } catch (_) { return 0; }
    items.sort((a, b) => a.seq - b.seq);
    for (const item of items) {
      if (!navigator.onLine) break;
      if (!pb.authStore.isValid) break;
      try {
        await send(item);
        await outboxDelete(item.seq);
      } catch (err) {
        if (item.op === 'create' && isDuplicateId(err)) { await outboxDelete(item.seq); continue; }
        if (item.op === 'delete' && err.status === 404) { await outboxDelete(item.seq); continue; }
        if (isNetworkError(err)) break;
        await outboxPut({ ...item, tries: (item.tries || 0) + 1, error: errText(err) });
      }
    }
    await emit();
    return lastItems.length;
  })().finally(() => { running = null; });
  return running;
}

// Пробуем отправить при запуске, при появлении сети, при возвращении в приложение и раз в 30 секунд.
let started = false;
export function startOutbox() {
  if (started) return;
  started = true;
  emit().then(() => flush());
  window.addEventListener('online', () => flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
  setInterval(() => { if (lastItems.length) flush(); }, 30000);
}

export const pendingFor = (items, col, pred) => items.filter((i) => i.col === col && (!pred || pred(i)));
