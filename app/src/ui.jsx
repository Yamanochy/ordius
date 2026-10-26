import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { WB, WU, MB, MU } from './lib/logoPaths.js';
import { back as goBack } from './lib/router.jsx';

export function Logo({ size = 30, onDark = false, variant = 'lockup' }) {
  const ink = onDark ? 'var(--on-graphite)' : 'var(--ink)';
  const blue = 'var(--signal)';
  if (variant === 'mark') {
    return (
      <svg role="img" aria-label="Ordius" viewBox="0 0 433 433" width={size} height={size} style={{ flex: 'none' }}>
        <path fill={ink} fillRule="evenodd" d={MB} /><path fill={blue} d={MU} />
      </svg>
    );
  }
  return (
    <svg role="img" aria-label="Ordius" viewBox="0 0 2386 431" height={size} width={Math.round(size * 2386 / 431)} style={{ flex: 'none' }}>
      <path fill={ink} fillRule="evenodd" d={WB} /><path fill={blue} d={WU} />
    </svg>
  );
}

const ICONS = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  cal: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></>,
  wallet: <><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /><path d="M21 12h-5a2 2 0 0 0 0 4h5z" /></>,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></>,
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />,
  truck: <><path d="M3 17h2l1-5h9l2 5h4" /><circle cx="7.5" cy="17.5" r="2" /><circle cx="17.5" cy="17.5" r="2" /><path d="M8 12V7h5l2 5" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  checks: <><path d="M3 12l4 4L17 6" /><path d="M11 16l2 2 8-10" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  left: <path d="m15 6-6 6 6 6" />,
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  fuel: <><path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" /><path d="M3 21h13M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3" /><path d="M7 7h5v4H7z" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  cloudoff: <><path d="M3 3l18 18" /><path d="M8.5 8.6A5 5 0 0 0 6 18h11" /><path d="M20.4 15.6A4 4 0 0 0 17 9h-1a7 7 0 0 0-5.6-3.5" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>,
  pin: <><path d="M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" /><circle cx="12" cy="10" r="2.5" /></>,
  rate: <><path d="M4 19 19 4" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 20h16" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  refresh: <><path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4" /></>,
};

export function Icon({ name, size = 22, color = 'currentColor' }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>{ICONS[name]}</svg>
  );
}

export function Button({ variant, size, block, children, className = '', busy, type = 'button', ...rest }) {
  const cls = ['btn', variant, size, block ? 'block' : '', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={busy || rest.disabled} {...rest}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Badge({ tone, children }) {
  return <span className={'badge ' + (tone || '')}>{children}</span>;
}

let fid = 0;
export function Field({ label, hint, error, children, className = '' }) {
  const [id] = useState(() => 'f' + (++fid));
  const child = React.isValidElement(children) && !children.props.id ? React.cloneElement(children, { id }) : children;
  return (
    <div className={'field ' + (error ? 'err ' : '') + className}>
      {label && <label htmlFor={id}>{label}</label>}
      {child}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder, ...rest }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Seg({ options, value, onChange, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function PageTitle({ title, eyebrow, backTo, children }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {backTo && (
        <button type="button" className="back" onClick={() => goBack(backTo)}>
          <Icon name="left" size={18} />Назад
        </button>
      )}
      <div className="page-title">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
        </div>
        {children && <div className="row">{children}</div>}
      </div>
    </div>
  );
}

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h3>{title}</h3>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Закрыть"><Icon name="x" size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Loading({ text = 'Загружаю…' }) {
  return <div className="row muted" style={{ padding: '24px 4px' }}><span className="spinner" aria-hidden="true" />{text}</div>;
}

export function ErrorBox({ text, onRetry }) {
  if (!text) return null;
  return (
    <div className="alert danger" role="alert">
      <Icon name="alert" size={20} />
      <span className="grow">{text}</span>
      {onRetry && <button type="button" className="btn sm" onClick={onRetry}>Повторить</button>}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="list-empty">{children}</div>;
}

// ---------- всплывающие сообщения ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const timer = useRef(null);
  const show = useCallback((text, opts = {}) => {
    clearTimeout(timer.current);
    setT({ text, err: !!opts.err });
    timer.current = setTimeout(() => setT(null), opts.ms || 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={'toast' + (t.err ? ' err' : '')} role="status">{t.text}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- выбор фото: камера или галерея, сразу сжатие ----------
export function PhotoAdd({ onAdd, label = 'Фото', accept = 'image/*,application/pdf' }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className="photo-add">
      <input type="file" accept={accept} multiple onChange={async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;
        setBusy(true);
        try { await onAdd(files); } finally { setBusy(false); }
      }} />
      {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="camera" size={26} />}
      <span>{busy ? 'Сжимаю…' : label}</span>
    </label>
  );
}

export function BlobImg({ blob, alt = '' }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) return undefined;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? <img src={url} alt={alt} /> : null;
}
