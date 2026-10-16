import React from 'react';
import { useStore, addLog, nowLabel, fmt } from '../../store.jsx';
import { TIRES } from '../../bizdata.js';
import { PageHead, Stat, Table, Badge, Button } from '../../ui.jsx';

export default function Warehouse({ role }) {
  const { state, update } = useStore();
  const can = role === 'supply' || role === 'owner';
  const canUse = role === 'mechanic' || can;
  const low = state.stock.filter(i => i.qty < i.min);
  const ordered = id => state.tasks.some(t => t.stockId === id && t.status !== 'done' && t.status !== 'accepted');
  const total = state.stock.reduce((a, i) => a + i.qty * i.price, 0);

  const order = i => update(s => {
    s.tasks.unshift({ id: 't' + (s.nextId++), chain: 100 + s.nextId, parentId: null, kind: 'supply', stockId: i.id, title: `Пополнить склад: ${i.name} — ${i.min * 2 - i.qty} ${i.unit}`, unitId: 'u1', from: 'Ordius, остаток ниже минимума', toRole: 'supply', status: 'buy', price: (i.min * 2 - i.qty) * i.price, created: nowLabel(), note: `База ${i.base}: осталось ${i.qty} ${i.unit} при минимуме ${i.min}.`, history: [nowLabel() + ' · создано автоматически'] });
    addLog(s, role, 'Создана закупка: ' + i.name);
  }, 'Задача на закупку ушла снабжению');
  const arrive = i => update(s => {
    const x = s.stock.find(y => y.id === i.id); x.qty = i.min * 2;
    s.tasks.forEach(t => { if (t.stockId === i.id && t.status === 'buy') { t.status = 'done'; t.history.push(nowLabel() + ' · приход на склад'); } });
    addLog(s, role, `Приход на склад: ${i.name}`);
  }, 'Приход оформлен, остаток в норме');
  const take = i => update(s => { const x = s.stock.find(y => y.id === i.id); x.qty = Math.max(0, x.qty - 1); addLog(s, role, `Списано 1 ${i.unit}: ${i.name}`); }, 'Списано на ремонт');

  return (
    <>
      <PageHead eyebrow="Запчасти, расходники и шины на всех базах" title="Склад" />
      <div className="grid-kpi">
        <Stat label="Остатки на складах" value={fmt(total)} hint={`${state.stock.length} позиций на 3 базах`} />
        <Stat label="Ниже минимума" value={String(low.length)} tone="bad" delta={low.length ? '!' : ''} hint="закупка — одной кнопкой" />
        <Stat label="Шин в работе" value={String(TIRES.length)} hint={`${TIRES.filter(t => t.wear >= 90).length} — ресурс выработан на 90%+`} />
      </div>
      <Table
        title="Остатки"
        columns={[
          { key: 'name', label: 'Позиция' }, { key: 'base', label: 'База' },
          { key: 'q', label: 'Остаток', right: true }, { key: 'm', label: 'Минимум', right: true },
          { key: 'sum', label: 'Стоимость', money: true },
          { key: 'st', label: 'Статус', render: (v, r) => r.qty < r.min ? (ordered(r.id) ? <Badge tone="info">Заказано</Badge> : <Badge tone="danger">Ниже минимума</Badge>) : <Badge tone="success">В норме</Badge> },
          { key: 'act', label: '', render: (v, r) => (
            <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
              {r.qty < r.min && !ordered(r.id) && can && <Button size="sm" variant="primary" onClick={() => order(r)}>Заказать</Button>}
              {r.qty < r.min && ordered(r.id) && can && <Button size="sm" onClick={() => arrive(r)}>Оформить приход</Button>}
              {canUse && r.qty > 0 && <Button size="sm" variant="ghost" onClick={() => take(r)}>Списать 1</Button>}
            </span>
          ) }
        ]}
        rows={state.stock.map(i => ({ ...i, q: `${i.qty} ${i.unit}`, m: `${i.min} ${i.unit}`, sum: i.qty * i.price }))}
      />
      <Table
        title="Шины: где стоят и сколько осталось"
        columns={[
          { key: 'tire', label: 'Шина · номер' }, { key: 'unit', label: 'Машина · ось' }, { key: 'since', label: 'Установлена' }, { key: 'run', label: 'Наработка', right: true },
          { key: 'wear', label: 'Ресурс выработан', right: true, render: v => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="progress" style={{ width: 80 }}><i style={{ width: v + '%', background: v >= 90 ? 'var(--danger)' : v >= 70 ? 'var(--warning)' : 'var(--success)' }} /></span>
              <b className="num">{v}%</b>
            </span>
          ) }
        ]}
        rows={TIRES}
      />
      <p className="note" style={{ margin: 0 }}>Списывайте запчасть ниже минимума — Ordius покажет «Ниже минимума», а «Заказать» создаст задачу снабжению. После прихода остаток вернётся в норму.</p>
    </>
  );
}
