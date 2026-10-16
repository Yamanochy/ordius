import React from 'react';
import { useStore } from '../../store.jsx';
import { ACCESS_MATRIX } from '../../bizdata.js';
import { PageHead, Button } from '../../ui.jsx';

const ROLES_H = ['Владелец', 'Диспетчер', 'Механик', 'Снабжение', 'Бухгалтер', 'Водитель', 'Заказчик'];
const S = {
  'Всё': { background: 'var(--graphite)', color: 'var(--on-graphite)' },
  'Правит': { background: 'var(--signal-soft)', color: 'var(--signal-text)' },
  'Видит': { background: 'var(--surface-2)', color: 'var(--ink-muted)' },
  'Своё': { background: 'var(--success-soft)', color: 'var(--success)' },
  'Своя': { background: 'var(--success-soft)', color: 'var(--success)' },
  'Свой объект': { background: 'var(--success-soft)', color: 'var(--success)' },
  '—': { color: 'var(--ink-subtle)' }
};

export default function Access() {
  const { state } = useStore();
  return (
    <>
      <PageHead eyebrow="Кто что видит и меняет. Каждое действие записывается." title="Права доступа и журнал">
        <Button onClick={() => window.alert('В рабочей версии — выгрузка начислений, авансов и расходов в формате для 1С.')}>Выгрузка для 1С</Button>
      </PageHead>
      <section className="card" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 980 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '220px repeat(7, minmax(0,1fr))', background: 'var(--surface-2)', fontSize: 13, fontWeight: 500, color: 'var(--ink-muted)' }}>
            <span style={{ padding: '10px 16px' }}>Раздел</span>
            {ROLES_H.map(r => <span key={r} style={{ padding: '10px 6px', textAlign: 'center' }}>{r}</span>)}
          </div>
          {ACCESS_MATRIX.map(row => (
            <div key={row[0]} style={{ display: 'grid', gridTemplateColumns: '220px repeat(7, minmax(0,1fr))', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
              <span style={{ padding: '10px 16px', fontSize: 14, fontWeight: 600 }}>{row[0]}</span>
              {row.slice(1).map((v, i) => <span key={i} style={{ display: 'flex', justifyContent: 'center', padding: '8px 4px' }}><span style={{ fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap', ...S[v] }}>{v}</span></span>)}
            </div>
          ))}
        </div>
      </section>
      <div className="legend">
        <span><b style={{ color: 'var(--ink)' }}>Правит</b> — создаёт и меняет</span>
        <span><b style={{ color: 'var(--ink)' }}>Видит</b> — только просмотр</span>
        <span><b style={{ color: 'var(--ink)' }}>Своё</b> — только свои записи и задачи</span>
      </div>
      <section className="card card-pad">
        <h2>Журнал действий · всё, что вы сделали в демо</h2>
        {state.log.length === 0 && <p className="muted" style={{ margin: 0 }}>Пока пусто.</p>}
        {state.log.slice(0, 30).map((l, i) => (
          <div key={i} className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, gap: 14, flexWrap: 'nowrap', alignItems: 'baseline' }}>
            <span className="num subtle" style={{ fontSize: 13, width: 44, flex: 'none' }}>{l.t}</span>
            <b style={{ fontWeight: 600, fontSize: 14, flex: 'none', minWidth: 120 }}>{l.who}</b>
            <span className="muted" style={{ fontSize: 14 }}>{l.what}</span>
          </div>
        ))}
      </section>
    </>
  );
}
