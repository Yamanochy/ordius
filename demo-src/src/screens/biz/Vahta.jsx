import React from 'react';
import { useStore, addLog } from '../../store.jsx';
import { VAHTA_ROWS } from '../../bizdata.js';
import { PageHead, Table, Badge, Button } from '../../ui.jsx';

const D = 182; // дней в окне: 1 октября — 31 марта
const seg = (a, b, on, label) => ({ left: a / D * 100, width: (b - a) / D * 100, on, label });
const A = [seg(0, 29, true, 'вахта до 29.10'), seg(29, 74, false, 'межвахта'), seg(74, 119, true, 'вахта 14.12–27.01'), seg(119, 164, false, 'межвахта'), seg(164, 182, true, 'вахта')];
const B = [seg(0, 29, false, 'межвахта'), seg(29, 74, true, 'вахта 30.10–13.12'), seg(74, 119, false, 'межвахта'), seg(119, 164, true, 'вахта 28.01–13.03'), seg(164, 182, false, '')];
const TODAY = 15 / D * 100;

export default function Vahta({ role }) {
  const { state, update } = useStore();
  const can = role === 'owner' || role === 'dispatcher';
  const set = (id, key, val, msg) => update(s => { s.trips.find(t => t.id === id)[key] = val; addLog(s, role, msg); }, msg);
  const ready = state.trips.filter(t => t.ticket === 'bought' && t.room === 'booked' && t.med === 'ok').length;

  return (
    <>
      <PageHead eyebrow="Филиал Досатуй · график 45 × 45 · две смены на 8 Shacman" title="Вахта · октябрь 2026 — март 2027" />
      <section className="card" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 900 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink-muted)', fontWeight: 500 }}>
            <span style={{ padding: '10px 16px' }}>Водитель · смена</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>{['Октябрь', 'Ноябрь', 'Декабрь', 'Январь', 'Февраль', 'Март'].map(m => <span key={m} style={{ padding: '10px 8px' }}>{m}</span>)}</div>
          </div>
          {VAHTA_ROWS.map(r => (
            <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
              <span style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column' }}><b style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</b><span className="subtle" style={{ fontSize: 12 }}>{r.unit}</span></span>
              <div style={{ position: 'relative', height: 44, marginRight: 12 }}>
                <span aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: TODAY + '%', width: 2, background: 'var(--danger)' }} />
                {(r.shift === 'A' ? A : B).map((s, i) => (
                  <span key={i} style={{ position: 'absolute', top: 9, height: 26, left: s.left + '%', width: s.width + '%', borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 8px', boxSizing: 'border-box', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', ...(s.on ? { background: 'var(--signal)', color: 'var(--on-signal)' } : { background: 'var(--surface-2)', color: 'var(--ink-muted)', boxShadow: 'inset 0 0 0 1px var(--line-strong)' }) }}>{s.label}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="legend">
        <span><i className="sw" style={{ background: 'var(--signal)' }} />На вахте</span>
        <span><i className="sw" style={{ background: 'var(--surface-2)', boxShadow: 'inset 0 0 0 1px var(--line-strong)' }} />Межвахта</span>
        <span><i className="sw" style={{ width: 2, background: 'var(--danger)' }} />Сегодня</span>
      </div>
      <Table
        title={`Заезд 30 октября: смена Б · готовы ${ready} из ${state.trips.length}`}
        columns={[
          { key: 'name', label: 'Водитель' }, { key: 'route', label: 'Маршрут' },
          { key: 'ticket', label: 'Билет', render: (v, r) => v === 'bought' ? <Badge tone="success">Куплен</Badge> : can ? <Button size="sm" variant="primary" onClick={() => set(r.id, 'ticket', 'bought', `Купил(а) билет: ${r.name}`)}>Купить билет</Button> : <Badge tone="danger">Не куплен</Badge> },
          { key: 'room', label: 'Проживание', render: (v, r) => v === 'booked' ? <Badge tone="success">Забронировано</Badge> : can ? <Button size="sm" onClick={() => set(r.id, 'room', 'booked', `Забронировал(а) жильё: ${r.name}`)}>Забронировать</Button> : <Badge tone="warning">Ждёт</Badge> },
          { key: 'med', label: 'Медкомиссия', render: (v, r) => v === 'ok' ? <Badge tone="success">Пройдена</Badge> : can ? <Button size="sm" onClick={() => set(r.id, 'med', 'ok', `Отметил(а) медкомиссию: ${r.name}`)}>Отметить пройденной</Button> : <Badge tone="danger">Истекает</Badge> }
        ]}
        rows={state.trips}
      />
    </>
  );
}
