import React, { useState } from 'react';
import { useStore, shiftPay, fmt, nowLabel } from '../store.jsx';
import { DAYS, DRIVERS, OBJECTS } from '../data.js';
import { PageHead, Button, Badge, Modal } from '../ui.jsx';
import { unitName } from './Overview.jsx';

const WD = ['Чт', 'Пт', 'Сб', 'Вс', 'Пн', 'Вт', 'Ср'];

export default function Tabel({ role }) {
  const { state, update } = useStore();
  const [open, setOpen] = useState(null);
  const canConfirm = role === 'owner' || role === 'dispatcher';
  const pending = state.shifts.filter(s => s.status === 'pending');

  const confirmAll = () => update(s => {
    s.shifts.forEach(x => { if (x.status === 'pending') x.status = 'confirmed'; });
    s.log.unshift({ t: nowLabel().slice(6), who: role === 'owner' ? 'Петров И.' : 'Орлова Т.', what: 'Подтвердил(а) все смены, ждавшие подтверждения' });
  }, 'Смены подтверждены — зарплата пересчитана');

  return (
    <>
      <PageHead eyebrow="Табель смен · водители × дни" title="1–14 октября 2026">
        {canConfirm && pending.length > 0 && <Button variant="primary" onClick={confirmAll}>Подтвердить все ({pending.length})</Button>}
        {!canConfirm && <Badge>Только просмотр</Badge>}
      </PageHead>

      <div className="legend">
        {OBJECTS.map(o => <span key={o.id}><i className={'sw cell-' + o.cell} />{o.name}</span>)}
        <span><i className="sw cell-P" />Ждёт подтверждения — нажмите</span>
        <span>Цифра в клетке — часы</span>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <div className="tabel">
          <div className="tabel-row tabel-head">
            <span style={{ padding: '10px 16px' }}>Водитель · техника</span>
            {DAYS.map((d, i) => {
              const wd = WD[i % 7];
              return <span key={d} style={{ textAlign: 'center', padding: '8px 0', lineHeight: '16px' }}>{i + 1}<br /><span style={{ fontSize: 11, color: wd === 'Сб' || wd === 'Вс' ? 'var(--danger)' : 'var(--ink-subtle)' }}>{wd}</span></span>;
            })}
            <span style={{ textAlign: 'right', padding: '10px 8px' }}>Смен</span>
            <span style={{ textAlign: 'right', padding: '10px 16px' }}>Начислено</span>
          </div>
          {DRIVERS.map(d => {
            const own = state.shifts.filter(s => s.driverId === d.id);
            const conf = own.filter(s => s.status === 'confirmed');
            return (
              <div key={d.id} className="tabel-row">
                <span style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <b style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</b>
                  <span className="subtle" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{unitName(state, d.unitId)}</span>
                </span>
                {DAYS.map(day => {
                  const s = own.find(x => x.date === day);
                  if (!s) return <span key={day} style={{ display: 'flex', justifyContent: 'center', padding: '6px 3px' }}><span className="cell-btn cell-O" aria-label="выходной">·</span></span>;
                  const obj = OBJECTS.find(o => o.id === s.objectId);
                  const cls = s.status === 'pending' ? 'cell-P pending' : 'cell-' + obj.cell;
                  return (
                    <span key={day} style={{ display: 'flex', justifyContent: 'center', padding: '6px 3px' }}>
                      <button type="button" className={'cell-btn ' + cls} title={`${obj.name}, ${s.hours} ч`} aria-label={`${d.name}, ${Number(day.slice(8))} октября, ${s.hours} часов, ${s.status === 'pending' ? 'ждёт подтверждения' : obj.name}`} onClick={() => setOpen(s.id)}>{s.hours}</button>
                    </span>
                  );
                })}
                <span className="num" style={{ textAlign: 'right', padding: '0 8px', fontSize: 14 }}>{conf.length}</span>
                <span className="num" style={{ textAlign: 'right', padding: '0 16px', fontSize: 14, fontWeight: 600 }}>{fmt(conf.reduce((a, s) => a + shiftPay(s), 0))}</span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="note" style={{ margin: 0 }}>Водитель отмечает смену с телефона вместе с фото путевого листа — она появляется здесь пунктиром. После подтверждения смена сразу попадает в расчёт зарплаты и в выручку по объекту. Ставка «замораживается» в смене: если потом её поменять, прошлые смены не пересчитаются.</p>

      {open && <ShiftModal id={open} canConfirm={canConfirm} role={role} onClose={() => setOpen(null)} />}
    </>
  );
}

function ShiftModal({ id, canConfirm, role, onClose }) {
  const { state, update } = useStore();
  const s = state.shifts.find(x => x.id === id);
  if (!s) return null;
  const d = DRIVERS.find(x => x.id === s.driverId);
  const obj = OBJECTS.find(o => o.id === s.objectId);
  const confirm = () => { update(st => { st.shifts.find(x => x.id === id).status = 'confirmed'; st.log.unshift({ t: nowLabel().slice(6), who: role === 'owner' ? 'Петров И.' : 'Орлова Т.', what: `Подтвердил(а) смену ${d.name} за ${Number(s.date.slice(8))}.10` }); }, 'Смена подтверждена'); onClose(); };
  return (
    <Modal fixed title={`${d.name} · ${Number(s.date.slice(8))} октября`} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
        <Info k="Объект" v={obj.name} />
        <Info k="Техника" v={unitName(state, s.unitId)} />
        <Info k="Часы" v={s.hours + ' ч' + (s.hours > 12 ? ' (1 ч переработки)' : '')} />
        <Info k="Начислено" v={fmt(shiftPay(s))} />
        <Info k="Путевой лист" v={s.photo ? 'фото приложено' : 'нет фото'} />
        <Info k="Статус" v={s.status === 'pending' ? 'ждёт подтверждения' : 'подтверждена'} />
      </div>
      {s.status === 'pending' && canConfirm && <Button variant="primary" size="lg" block onClick={confirm}>Подтвердить смену</Button>}
      {s.status === 'pending' && !canConfirm && <p className="muted" style={{ margin: 0 }}>Подтверждает диспетчер или руководитель.</p>}
    </Modal>
  );
}

export function Info({ k, v }) {
  return <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span className="muted" style={{ fontSize: 12 }}>{k}</span><b style={{ fontWeight: 600 }}>{v}</b></span>;
}
