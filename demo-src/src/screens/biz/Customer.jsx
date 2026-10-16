import React from 'react';
import { useStore, addLog, fmt } from '../../store.jsx';
import { OBJECTS, DRIVERS } from '../../data.js';
import { PageHead, Stat, Table, Badge, Button } from '../../ui.jsx';
import { unitName } from '../Overview.jsx';

// Кабинет заказчика ООО «Северный квартал» — видит только свой объект «ЖК Северный»
const OBJ = 'o2';

export default function Customer({ role }) {
  const { state, update } = useStore();
  const obj = OBJECTS.find(o => o.id === OBJ);
  const isCustomer = role === 'customer';
  const rows = state.shifts.filter(s => s.objectId === OBJ).sort((a, b) => b.date.localeCompare(a.date)).map(s => {
    const cs = state.custStatus[s.id] || (s.status === 'pending' ? 'wait' : 'new');
    return { id: s.id, date: Number(s.date.slice(8)) + '.10', unit: unitName(state, s.unitId), driver: DRIVERS.find(d => d.id === s.driverId).name, hours: s.hours + ' ч', sum: obj.rate, cs };
  });
  const agreed = rows.filter(r => r.cs === 'ok');
  const questions = rows.filter(r => r.cs === 'question');
  const open = rows.filter(r => r.cs === 'new');

  const setSt = (id, st, msg) => update(s => { s.custStatus[id] = st; addLog(s, role, (st === 'ok' ? 'Заказчик подтвердил смену ' : 'Заказчик задал вопрос по смене ') + id.split('-').pop() + '.10'); }, msg);
  const approveAll = () => update(s => { open.forEach(r => { s.custStatus[r.id] = 'ok'; }); addLog(s, role, `Заказчик подтвердил реестр: ${open.length} смен`); }, 'Реестр подтверждён — акт сформирован, подрядчик увидит это сразу');

  return (
    <>
      <PageHead eyebrow={`Кабинет заказчика · ${obj.client} · подрядчик ООО «СибСпецТранс»`} title={`${obj.name} · реестр смен 1–14 октября`}>
        {isCustomer && open.length > 0 && <Button variant="primary" onClick={approveAll}>Подтвердить реестр ({open.length})</Button>}
        {!isCustomer && <Badge tone="info">Так заказчик видит ваш объект</Badge>}
      </PageHead>
      <div className="grid-kpi">
        <Stat label="Смен на объекте" value={String(rows.length)} hint="по путевым листам с фото" />
        <Stat label="Сумма за период" value={fmt(rows.length * obj.rate)} hint={`${fmt(obj.rate)} за смену по договору`} />
        <Stat label="Подтверждено" value={`${agreed.length} из ${rows.length}`} hint="заказчиком" />
        <Stat label="Вопросы" value={String(questions.length)} tone={questions.length ? 'bad' : 'good'} delta={questions.length ? '!' : ''} hint="ждут ответа подрядчика" />
      </div>
      <Table
        title="Смены на объекте"
        columns={[
          { key: 'date', label: 'Дата' }, { key: 'unit', label: 'Техника' }, { key: 'driver', label: 'Водитель' },
          { key: 'hours', label: 'Часы', right: true }, { key: 'sum', label: 'Сумма', money: true },
          { key: 'cs', label: 'Статус', render: (v, r) => {
            if (v === 'ok') return <Badge tone="success">Подтверждено</Badge>;
            if (v === 'question') return <Badge tone="danger">Вопрос по часам</Badge>;
            if (v === 'wait') return <Badge>Подрядчик ещё проверяет</Badge>;
            if (!isCustomer) return <Badge tone="warning">Ждёт заказчика</Badge>;
            return <span className="row" style={{ gap: 6 }}><Button size="sm" variant="primary" onClick={() => setSt(r.id, 'ok', 'Смена подтверждена')}>Подтвердить</Button><Button size="sm" onClick={() => setSt(r.id, 'question', 'Вопрос отправлен подрядчику')}>Вопрос</Button></span>;
          } }
        ]}
        rows={rows}
      />
      <div className="split">
        <p className="note main" style={{ margin: 0 }}>Прораб заказчика видит каждую смену в день работы: технику, водителя, часы и фото путевого с отметкой мастера. Несогласие отмечается прямо в строке. В конце периода реестр подтверждается одной кнопкой — акт формируется сам.</p>
        <p className="note side" style={{ margin: 0 }}>Заказчик не видит зарплаты водителей, ремонты, маржу и других заказчиков. Доступ — по приглашению, только к своему объекту.</p>
      </div>
    </>
  );
}
