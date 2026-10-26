// Маршруты на «#/…»: работают на любом хостинге и без сервера, в том числе в приложении на экране «Домой».
import React, { useEffect, useState } from 'react';

const read = () => (window.location.hash.replace(/^#/, '') || '/');

export function useRoute() {
  const [path, setPath] = useState(read());
  useEffect(() => {
    const on = () => setPath(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [p, q = ''] = path.split('?');
  return { path: p, query: Object.fromEntries(new URLSearchParams(q)) };
}

export function go(to, { replace } = {}) {
  const h = '#' + to;
  if (replace) window.location.replace(h);
  else window.location.hash = to;
  window.scrollTo(0, 0);
}

export function back(fallback = '/') {
  if (window.history.length > 1) window.history.back();
  else go(fallback);
}

export function Link({ to, className, children, ...rest }) {
  return <a href={'#' + to} className={className} {...rest}>{children}</a>;
}

// «/shifts/abc» по шаблону «/shifts/:id» → { id: 'abc' }
export function match(pattern, path) {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) out[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return out;
}
