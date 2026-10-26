// Загрузка данных с запасной копией: сначала показываем сохранённое на телефоне, потом — свежее с сервера.
// Без связи остаётся сохранённое, и экран работает.
import { useCallback, useEffect, useRef, useState } from 'react';
import { kvGet, kvSet } from './idb.js';
import { errText, isNetworkError } from './pb.js';
import { subscribe } from './outbox.js';

export function useQuery(key, fetcher, { cache = true, deps = [], refreshOnSync = true } = {}) {
  const [state, setState] = useState({ data: undefined, loading: true, error: '', stale: false });
  const keyRef = useRef(key);
  keyRef.current = key;
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!key) { setState({ data: undefined, loading: false, error: '', stale: false }); return; }
    const my = ++seq.current;
    if (cache) {
      const saved = await kvGet('q:' + key);
      if (my === seq.current && saved !== undefined) setState((s) => (s.data === undefined ? { data: saved, loading: true, error: '', stale: true } : s));
    }
    try {
      const data = await fetcher();
      if (my !== seq.current) return;
      setState({ data, loading: false, error: '', stale: false });
      if (cache) kvSet('q:' + key, data);
    } catch (err) {
      if (my !== seq.current) return;
      setState((s) => ({ ...s, loading: false, error: isNetworkError(err) && s.data !== undefined ? '' : errText(err), stale: isNetworkError(err) || s.stale }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);

  useEffect(() => { load(); }, [load]);

  // после отправки очереди — обновить
  const lastLen = useRef(null);
  useEffect(() => {
    if (!refreshOnSync) return undefined;
    return subscribe((items) => {
      if (lastLen.current !== null && items.length < lastLen.current) load();
      lastLen.current = items.length;
    });
  }, [load, refreshOnSync]);

  return { ...state, reload: load };
}

// Онлайн ли устройство (для полоски «нет связи»)
export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}
