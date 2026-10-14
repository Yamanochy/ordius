import React from 'react';
import { fmt } from './store.jsx';

// Логотип: сквиркл с кольцом и синей «стрелкой» + надпись ORDIUS
const SQ = (() => {
  const pts = [];
  for (let i = 0; i < 120; i++) {
    const th = 2 * Math.PI * i / 120, c = Math.cos(th), s = Math.sin(th);
    pts.push((32 + 32 * Math.sign(c) * Math.pow(Math.abs(c), 0.4)).toFixed(2) + ',' + (32 + 32 * Math.sign(s) * Math.pow(Math.abs(s), 0.4)).toFixed(2));
  }
  return 'M' + pts.join(' L') + ' Z';
})();

const WORD = [
  ['translate(0 0)', 'M18,3.25 A14.75,16.75 0 1 0 18.001,3.25'],
  ['translate(47 0)', 'M3.25,36.75 V3.25 H13.85 A8.9,8.9 0 0 1 13.85,21.05 H3.25 M12.35,21.05 L24.75,36.75'],
  ['translate(86 0)', 'M3.25,3.25 V36.75 H12 A16.75,16.75 0 0 0 12,3.25 Z'],
  ['translate(129 0)', 'M3.25,0 V40'],
  ['translate(146.5 0)', 'M3.25,0 V25 A11.75,11.75 0 0 0 26.75,25 V0'],
  ['translate(187.5 0)', 'M25.5,8.8 C23.3,5 19.3,3.25 14,3.25 C7.6,3.25 3.6,6.4 3.6,11.1 C3.6,15.8 7.4,17.6 14,19.4 C20.8,21.3 24.8,23.4 24.8,28.6 C24.8,33.6 20.4,36.75 14,36.75 C8.4,36.75 4.4,34.4 2.4,30.4']
];

export function Logo({ size = 30, onDark = false, variant = 'lockup' }) {
  const wordH = Math.round(size * 0.62);
  const ink = onDark ? 'var(--on-graphite)' : 'var(--ink)';
  return (
    <span role="img" aria-label="Ordius" style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.4), lineHeight: 0 }}>
      {variant !== 'wordmark' && (
        <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
          <path d={SQ} fill="var(--graphite)" stroke={onDark ? 'rgba(255,255,255,.12)' : 'none'} />
          <circle cx="32" cy="32" r="14" fill="none" stroke="#F3F4F6" strokeWidth="7" strokeDasharray="74.2 13.8" transform="rotate(-24 32 32)" />
          <path d="M30.2 33.8 L48.5 15.5" stroke="var(--signal)" strokeWidth="5.5" strokeLinecap="square" />
        </svg>
      )}
      {variant !== 'mark' && (
        <svg viewBox="0 0 215.5 40" height={wordH} width={Math.round(215.5 * wordH / 40)} aria-hidden="true">
          <g fill="none" stroke={ink} strokeWidth="6.5">
            {WORD.map(([t, d], i) => <path key={i} transform={t} d={d} />)}
          </g>
        </svg>
      )}
    </span>
  );
}

export function Button({ variant, size, block, children, className = '', ...rest }) {
  const cls = ['btn', variant, size, block ? 'block' : '', className].filter(Boolean).join(' ');
  return <button type="button" className={cls} {...rest}>{children}</button>;
}

export function Badge({ tone, children }) {
  return <span className={'badge ' + (tone || '')}>{children}</span>;
}

export function Stat({ label, value, delta, hint, tone }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {(delta || hint) && (
        <div className="stat-foot">
          {delta && <span className={'stat-delta ' + (tone || 'good')}>{delta}</span>}
          {hint && <span className="subtle">{hint}</span>}
        </div>
      )}
    </div>
  );
}

export function Seg({ options, value, onChange, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Table({ title, actions, columns, rows, total, empty }) {
  return (
    <div className="card table-wrap">
      {(title || actions) && <div className="table-title"><span>{title}</span>{actions}</div>}
      <div className="table-scroll">
        <table className="t">
          <thead><tr>{columns.map(c => <th key={c.key} className={c.money || c.right ? 'r' : ''}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={columns.length} className="subtle">{empty || 'Пока пусто'}</td></tr>}
            {rows.map((r, i) => (
              <tr key={r.id || i}>
                {columns.map(c => <td key={c.key} className={c.money || c.right ? 'r' : ''}>{c.render ? c.render(r[c.key], r) : c.money ? fmt(r[c.key]) : r[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot><tr>{columns.map((c, i) => <td key={c.key} className={c.money || c.right ? 'r' : ''}>{total[c.key] !== undefined ? (c.money ? fmt(total[c.key]) : total[c.key]) : i === 0 ? 'Итого' : ''}</td>)}</tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export function Field({ label, hint, children, id }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children, fixed }) {
  return (
    <div className={'modal-back' + (fixed ? ' fixed' : '')} onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Закрыть">Закрыть</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageHead({ eyebrow, title, children }) {
  return (
    <div className="page-head">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Icon({ name, size = 20, color = 'currentColor' }) {
  const p = {
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
    truck: <><path d="M3 17h2l1-5h9l2 5h4" /><circle cx="7.5" cy="17.5" r="2" /><circle cx="17.5" cy="17.5" r="2" /><path d="M8 12V7h5l2 5" /></>,
    wrench: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />,
    camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></>,
    check: <path d="M20 6 9 17l-5-5" />,
    alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
    cal: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></>,
    wallet: <><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /><path d="M21 12h-5a2 2 0 0 0 0 4h5z" /></>
  }[name];
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>{p}</svg>;
}
