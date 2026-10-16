import React from 'react';
import { fmt } from './store.jsx';

import { WB, WU, MB, MU } from './logoPaths.js';

// Логотип: знак (сквиркл с окном и синим срезом) + надпись ORDIUS
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
