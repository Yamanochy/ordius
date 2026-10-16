import React from 'react';
import { useStore, addLog, nowLabel } from '../../store.jsx';
import { PageHead, Stat, Table, Badge, Button } from '../../ui.jsx';

const POS = {
  u1: ['На объекте', 'success', 'Карьер Восточный · с 07:02'],
  u2: ['На объекте', 'success', 'ЖК Северный · с 19:58'],
  u3: ['Стоит', '', 'База, ул. Станционная'],
  u4: ['Холостой ход', 'warning', 'Ленинский р-н · 2 ч 10 мин'],
  u5: ['В пути', 'info', 'ул. Петухова, 34 км/ч'],
  u6: ['На объекте', 'success', 'Карьер Восточный · с 07:02']
};
const REPAIR = ['В ремонте', 'danger', 'База, ремонтный бокс'];

export default function Telematics({ role }) {
  const { state, update } = useStore();
  const rows = state.units.map(u => {
    const p = u.status === 'repair' ? REPAIR : POS[u.id];
    return { id: u.id, unit: u.name + ' · ' + u.plate, st: p, where: p[2], meter: u.meter };
  });
  const count = k => rows.filter(r => r.st[0] === k).length;

  const act = e => update(s => {
    const ev = s.gpsEvents.find(x => x.id === e.id); ev.done = true;
    s.tasks.unshift({ id: 't' + (s.nextId++), chain: 100 + s.nextId, parentId: null, kind: 'general', title: 'Проверить возможный слив 38 л · КамАЗ Е 207 НТ', unitId: e.unitId, from: 'Ordius, датчик топлива', toRole: 'dispatcher', status: 'todo', created: nowLabel(), note: 'Датчик уровня топлива зафиксировал падение на 38 л в 02:14 на стоянке.', history: [nowLabel() + ' · создано по событию GPS'] });
    addLog(s, role, 'Создал(а) задачу по сливу топлива');
  }, 'Задача ушла диспетчеру — увидите её в «Задачах»');

  return (
    <>
      <PageHead eyebrow="Данные из вашей системы мониторинга: трекеры и датчики топлива" title="Техника сейчас">
        <Badge tone="info">Подключено по API · обновлено 2 мин назад</Badge>
      </PageHead>
      <div className="grid-kpi">
        <Stat label="На объектах" value={String(count('На объекте'))} />
        <Stat label="В пути" value={String(count('В пути'))} />
        <Stat label="Холостой ход > 30 мин" value={String(count('Холостой ход'))} tone="bad" delta="!" hint="лишний расход топлива" />
        <Stat label="В ремонте" value={String(count('В ремонте'))} hint="по заявкам механика" />
      </div>
      <div className="split">
        <div className="main">
          <Table title="Где машины" columns={[{ key: 'unit', label: 'Машина' }, { key: 'st', label: 'Статус', render: v => <Badge tone={v[1]}>{v[0]}</Badge> }, { key: 'where', label: 'Где' }, { key: 'meter', label: 'Пробег / моточасы', right: true }]} rows={rows} />
        </div>
        <section className="card side" style={{ overflow: 'hidden' }}>
          <h2 className="h2" style={{ padding: '18px 18px 8px' }}>События за сутки</h2>
          {state.gpsEvents.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: 12, padding: '12px 18px', borderTop: '1px solid var(--line)' }}>
              <span className="num subtle" style={{ fontSize: 13, width: 44, flex: 'none' }}>{e.t}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <b style={{ fontWeight: 600, fontSize: 14, color: e.kind === 'danger' ? 'var(--danger)' : e.kind === 'warning' ? 'var(--warning)' : undefined }}>{e.title}</b>
                <span className="muted" style={{ fontSize: 13 }}>{e.text}</span>
                {e.action && !e.done && <span><Button size="sm" variant="primary" onClick={() => act(e)}>{e.action}</Button></span>}
                {e.done && <span><Badge tone="success">Задача создана</Badge></span>}
              </span>
            </div>
          ))}
        </section>
      </div>
      <p className="note" style={{ margin: 0 }}>Ordius не ставит трекеры сам — он забирает данные из системы мониторинга, которая у вас уже есть. Смена открывается и закрывается сама, когда машина въезжает в зону объекта и выезжает из неё; моточасы обновляют сроки ТО.</p>
    </>
  );
}
