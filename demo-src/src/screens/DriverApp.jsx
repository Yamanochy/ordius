import React, { useState } from 'react';
import { useStore, payroll, shiftPay, fmt, nowLabel, STATUS, taskActions } from '../store.jsx';
import { DAYS, DRIVERS, OBJECTS } from '../data.js';
import { Logo, Button, Badge, Modal, Field, Icon } from '../ui.jsx';
import { unitName } from './Overview.jsx';

const ME = 'd1';
const WD = ['чт', 'пт', 'сб', 'вс', 'пн', 'вт', 'ср'];

export default function DriverApp() {
  const { state, update } = useStore();
  const [tab, setTab] = useState('home');
  const [modal, setModal] = useState(null);
  const me = DRIVERS.find(d => d.id === ME);
  const p = payroll(state).find(x => x.driver.id === ME);
  const shifts = state.shifts.filter(s => s.driverId === ME).sort((a, b) => b.date.localeCompare(a.date));
  const myTasks = state.tasks.filter(t => t.toRole === 'driver' && t.status !== 'accepted');
  const myReports = state.tasks.filter(t => t.from.startsWith('Ковалёв') && t.parentId === null);
  const advPct = p.earned ? Math.min(100, Math.round(p.advance / p.earned * 100)) : 0;

  return (
    <>
      <div className="ph-top">
        <Logo variant="mark" size={40} />
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span className="subtle" style={{ fontSize: 12 }}>ООО «СибСпецТранс»</span>
          <b style={{ fontSize: 16, fontWeight: 600 }}>{me.name}</b>
        </span>
      </div>

      <div className="ph-body">
        {tab === 'home' && (
          <>
            <section className="money-card">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="lbl">Заработано в октябре</span>
                <span className="big">{fmt(p.earned)}</span>
                <span style={{ fontSize: 13, color: 'var(--graphite-muted)' }}>{p.shifts} смен · {me.rate.toLocaleString('ru-RU')} ₽ за смену{p.pendingCount ? ` · ещё ${p.pendingCount} ждёт подтверждения` : ''}</span>
              </div>
              <div className="bar2" aria-hidden="true"><i style={{ width: advPct + '%', background: '#B9C0CC' }} /><i style={{ flex: 1, background: '#5B8CFF' }} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <span style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 12, color: 'var(--graphite-muted)' }}>Аванс получен</span><b className="num" style={{ fontSize: 17 }}>{fmt(p.advance)}</b></span>
                <span style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 12, color: 'var(--graphite-muted)' }}>{p.paid ? 'Выплачено' : 'Осталось к выплате'}</span><b className="num" style={{ fontSize: 17 }}>{fmt(p.left)}</b></span>
              </div>
            </section>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Button variant="primary" size="lg" onClick={() => setModal('shift')}><Icon name="camera" />Смена</Button>
              <Button size="lg" onClick={() => setModal('break')}><Icon name="wrench" />Поломка</Button>
            </div>

            {myTasks.length > 0 && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h2 className="h2">Задачи мне</h2>
                {myTasks.map(t => (
                  <div key={t.id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <b style={{ fontWeight: 600 }}>{t.title}</b>
                    <span className="muted" style={{ fontSize: 13 }}>от: {t.from}</span>
                    {taskActions(t, 'driver', state).map(a => <Button key={a.label} size="sm" variant={a.primary ? 'primary' : undefined} onClick={() => update(a.run, a.msg)}>{a.label}</Button>)}
                  </div>
                ))}
              </section>
            )}

            {myReports.length > 0 && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h2 className="h2">Мои заявки на ремонт</h2>
                <div className="card" style={{ overflow: 'hidden' }}>
                  {myReports.map((t, i) => (
                    <div key={t.id} style={{ padding: '12px 14px', borderTop: i ? '1px solid var(--line)' : 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <b style={{ fontWeight: 600, fontSize: 14 }}>{t.title}</b>
                      <span><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge></span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <ShiftList shifts={shifts.slice(0, 5)} state={state} title="Последние смены" />
          </>
        )}
        {tab === 'shifts' && <ShiftList shifts={shifts} state={state} title="Все смены за октябрь" />}
        {tab === 'pay' && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 className="h2">Выплаты</h2>
            <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Row k="Начислено за подтверждённые смены" v={fmt(p.earned)} />
              <Row k="Аванс 5 октября" v={'− ' + fmt(p.advance)} />
              <Row k={p.paid ? 'Выплачено' : 'Осталось к выплате'} v={fmt(p.left)} bold />
              <span>{p.paid ? <Badge tone="success">Выплачено бухгалтером</Badge> : <Badge tone="warning">Ожидает выплаты</Badge>}</span>
            </div>
            <p className="subtle" style={{ fontSize: 12, margin: 0 }}>Цифры совпадают с расчётом у руководителя — считаются одинаково.</p>
          </section>
        )}
      </div>

      <nav className="ph-bottom" aria-label="Разделы" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', padding: '6px 8px' }}>
        {[['home', 'home', 'Главная'], ['shifts', 'cal', 'Смены'], ['pay', 'wallet', 'Выплаты']].map(([id, ic, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} style={{ minHeight: 52, border: 0, background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 12, fontWeight: tab === id ? 600 : 500, color: tab === id ? 'var(--signal-text)' : 'var(--ink-muted)', cursor: 'pointer' }}>
            <Icon name={ic} size={22} />{label}
          </button>
        ))}
      </nav>

      {modal === 'shift' && <ShiftForm onClose={() => setModal(null)} />}
      {modal === 'break' && <BreakForm onClose={() => setModal(null)} me={me} />}
    </>
  );
}

function Row({ k, v, bold }) {
  return <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted" style={{ fontSize: 14 }}>{k}</span><b className="num" style={{ fontWeight: bold ? 700 : 600 }}>{v}</b></div>;
}

function ShiftList({ shifts, state, title }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 className="h2">{title}</h2>
      <div className="card" style={{ overflow: 'hidden' }}>
        {shifts.map((s, i) => {
          const day = Number(s.date.slice(8));
          const obj = OBJECTS.find(o => o.id === s.objectId);
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: i ? '1px solid var(--line)' : 0 }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-2)', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <b className="num" style={{ fontSize: 15, lineHeight: '18px' }}>{day}</b><span className="muted" style={{ fontSize: 11, lineHeight: '14px' }}>{WD[(day - 1) % 7]}</span>
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <b style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{obj.name} · {s.hours} ч</b>
                <span><Badge tone={s.status === 'pending' ? 'warning' : 'success'}>{s.status === 'pending' ? 'Ждёт подтверждения' : 'Подтверждена'}</Badge></span>
              </span>
              <b className="num" style={{ fontSize: 15 }}>{fmt(shiftPay(s))}</b>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ShiftForm({ onClose }) {
  const { state, update } = useStore();
  const taken = new Set(state.shifts.filter(s => s.driverId === ME).map(s => s.date));
  const free = DAYS.filter(d => !taken.has(d));
  const [date, setDate] = useState(free[free.length - 1] || DAYS[0]);
  const [obj, setObj] = useState('o1');
  const [hours, setHours] = useState('12');
  const [photo, setPhoto] = useState(false);
  const h = Number(hours) || 0;
  const save = () => {
    update(s => {
      s.shifts.push({ id: 's' + (s.nextId++), date, driverId: ME, unitId: 'u1', objectId: obj, hours: h, status: 'pending', photo: true });
      s.log.unshift({ t: nowLabel().slice(6), who: 'Ковалёв Д.', what: `Отметил смену за ${Number(date.slice(8))}.10, ${h} ч` });
    }, 'Смена отправлена диспетчеру на подтверждение');
    onClose();
  };
  return (
    <Modal title="Отметить смену" onClose={onClose}>
      {free.length === 0 ? <p className="muted">Все дни 1–14 октября уже отмечены.</p> : (
        <>
          <Field label="Дата" id="sd"><select id="sd" value={date} onChange={e => setDate(e.target.value)}>{free.map(d => <option key={d} value={d}>{Number(d.slice(8))} октября</option>)}</select></Field>
          <Field label="Объект" id="so"><select id="so" value={obj} onChange={e => setObj(e.target.value)}>{OBJECTS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
          <Field label="Отработано часов" id="sh" hint={h > 12 ? `Сверх 12 часов — переработка, ${h - 12} ч` : 'Техника: ' + unitName(state, 'u1')}><input id="sh" inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} /></Field>
          <Button onClick={() => setPhoto(true)} block><Icon name="camera" />{photo ? 'Фото путевого листа прикреплено' : 'Сфотографировать путевой лист'}</Button>
          <Button variant="primary" size="lg" block disabled={!photo || !h} onClick={save}>Отправить смену</Button>
          {!photo && <span className="subtle" style={{ fontSize: 12, textAlign: 'center' }}>Без фото путевого смену не отправить — в демо нажмите кнопку выше.</span>}
        </>
      )}
    </Modal>
  );
}

function BreakForm({ onClose }) {
  const { update } = useStore();
  const [what, setWhat] = useState('Стучит подвеска справа, нужна проверка');
  const [stops, setStops] = useState(false);
  const save = () => {
    update(s => {
      const id = 't' + (s.nextId++);
      s.tasks.unshift({ id, chain: 100 + s.nextId, parentId: null, kind: 'repair', stops, title: what, unitId: 'u1', from: 'Ковалёв Д., водитель', toRole: 'mechanic', status: 'todo', created: nowLabel(), note: stops ? 'Водитель отметил: ехать нельзя.' : 'Машина на линии, ремонт после смены.', history: [nowLabel() + ' · водитель сообщил о поломке'] });
      if (stops) s.units.find(u => u.id === 'u1').status = 'repair';
      s.log.unshift({ t: nowLabel().slice(6), who: 'Ковалёв Д.', what: 'Сообщил о поломке: ' + what });
    }, 'Заявка ушла механику — переключитесь на роль «Механик»');
    onClose();
  };
  return (
    <Modal title="Сообщить о поломке" onClose={onClose}>
      <Field label="Что случилось" id="bw"><textarea id="bw" value={what} onChange={e => setWhat(e.target.value)} /></Field>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44, fontSize: 15 }}>
        <input type="checkbox" checked={stops} onChange={e => setStops(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--signal)' }} />
        Ехать нельзя, машина встала
      </label>
      <Button variant="primary" size="lg" block disabled={!what.trim()} onClick={save}>Отправить механику</Button>
    </Modal>
  );
}
