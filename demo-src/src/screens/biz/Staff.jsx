import React from 'react';
import { useStore, addLog, addTask } from '../../store.jsx';
import { PageHead, Stat, Table, Badge, Button } from '../../ui.jsx';

const C = { ok: 'var(--success)', soon: 'var(--warning)', bad: 'var(--danger)' };
const W = { ok: 'действует', soon: 'истекает', bad: 'не подписан' };

export default function Staff({ role }) {
  const { state, update } = useStore();
  const can = role === 'owner' || role === 'dispatcher';
  const items = state.staff.flatMap(p => ['dl', 'tm', 'med', 'ot'].filter(k => p[k]).map(k => ({ p, k, st: p[k][1] })));
  const soon = items.filter(i => i.st === 'soon');
  const bad = items.filter(i => i.st === 'bad');

  const remind = p => update(s => {
    const x = s.staff.find(y => y.id === p.id); x.reminded = true;
    if (p.driverId) addTask(s, { title: 'Пройти медкомиссию до ' + p.med[0], toRole: 'driver', driverId: p.driverId, from: 'Ordius, кадры', note: 'После прохождения сфотографируйте справку.' });
    addLog(s, role, 'Напоминание о документах: ' + p.name);
  }, p.driverId === 'd1' ? 'Задача ушла Ковалёву в телефон — проверьте роль «Водитель»' : 'Напоминание отправлено сотруднику');
  const sign = p => update(s => { const x = s.staff.find(y => y.id === p.id); x.ot = ['16.10.2026', 'ok']; addLog(s, role, 'Инструктаж подписан: ' + p.name); }, 'Инструктаж подписан');

  const cell = v => v ? <span style={{ display: 'flex', flexDirection: 'column' }}><b className="num" style={{ fontWeight: 600 }}>{v[0] || '—'}</b><span style={{ fontSize: 12, fontWeight: 600, color: C[v[1]] }}>{W[v[1]]}</span></span> : <span className="subtle">—</span>;

  return (
    <>
      <PageHead eyebrow="Удостоверения, медкомиссии и инструктажи — со сроками" title="Кадры и допуски" />
      <div className="grid-kpi">
        <Stat label="Сотрудников" value="48" hint="3 филиала" />
        <Stat label="Истекает за 30 дней" value={String(soon.length)} tone="bad" delta={soon.length ? '!' : ''} hint="напомните одной кнопкой" />
        <Stat label="Не подписан инструктаж" value={String(bad.length)} tone="bad" delta={bad.length ? '!' : ''} hint="инструкция от 01.10" />
      </div>
      <Table
        title="Допуски сотрудников"
        columns={[
          { key: 'name', label: 'Сотрудник', render: (v, r) => <span style={{ display: 'flex', flexDirection: 'column' }}><b style={{ fontWeight: 600 }}>{v}</b><span className="subtle" style={{ fontSize: 12 }}>{r.role}</span></span> },
          { key: 'dl', label: 'Водительское', render: cell }, { key: 'tm', label: 'Тракторист-машинист', render: cell },
          { key: 'med', label: 'Медкомиссия', render: cell }, { key: 'ot', label: 'Инструктаж по ОТ', render: cell },
          { key: 'act', label: '', render: (v, r) => (
            <span className="row" style={{ gap: 6 }}>
              {r.med && r.med[1] === 'soon' && (r.reminded ? <Badge tone="info">Напомнили</Badge> : can && <Button size="sm" variant="primary" onClick={() => remind(r)}>Напомнить</Button>)}
              {r.ot && r.ot[1] === 'bad' && can && <Button size="sm" onClick={() => sign(r)}>Подписан</Button>}
            </span>
          ) }
        ]}
        rows={state.staff}
      />
      <p className="note" style={{ margin: 0 }}>Сотрудника с просроченным документом планировщик не даст поставить на смену. Инструктаж сотрудник подписывает в телефоне кнопкой «Ознакомлен» — дата и время сохраняются в журнале.</p>
    </>
  );
}
