import React, { useState } from 'react';
import { AssistantButton } from '../../Assistant.jsx';
import { useStore, addLog, nowLabel } from '../../store.jsx';
import { DRIVERS } from '../../data.js';
import { Logo, Button, Badge, Field } from '../../ui.jsx';

const CHECKS = ['Шины, диски, крепление колёс', 'Тормозная система, давление', 'Течи масла, топлива, ОЖ', 'Световые приборы', 'Зеркала и стёкла', 'Огнетушитель, аптечка, знак'];

export default function Release() {
  const { state, update } = useStore();
  const [unitId, setUnitId] = useState('u6');
  const [done, setDone] = useState({});
  const [remark, setRemark] = useState('');
  const u = state.units.find(x => x.id === unitId);
  const dr = DRIVERS.find(d => d.unitId === unitId);
  const released = state.releases[unitId];
  const allOk = CHECKS.every((_, i) => done[i]);
  const candidates = state.units.filter(x => x.status !== 'repair');

  const release = () => update(s => {
    s.releases[unitId] = nowLabel();
    if (remark.trim()) s.tasks.unshift({ id: 't' + (s.nextId++), chain: 100 + s.nextId, parentId: null, kind: 'repair', title: remark.trim(), unitId, from: 'Зуев П., выпуск на линию', toRole: 'mechanic', status: 'todo', created: nowLabel(), note: 'Замечание при предрейсовом осмотре. Выпуск разрешён.', history: [nowLabel() + ' · создано при выпуске'] });
    addLog(s, 'mechanic', `Выпустил на линию ${u.name} ${u.plate}`);
  }, remark.trim() ? 'Машина выпущена, замечание ушло механику задачей' : 'Машина выпущена на линию');

  return (
    <>
      <div className="ph-top" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="row" style={{ gap: 10 }}><Logo variant="mark" size={32} /><span style={{ display: 'flex', flexDirection: 'column' }}><span className="subtle" style={{ fontSize: 12 }}>Выпуск на линию · 16 октября</span><b style={{ fontSize: 16 }}>Механик Зуев П.</b></span></span>
          <AssistantButton />
        </div>
        <Field label="Машина" id="rel-u">
          <select id="rel-u" value={unitId} onChange={e => { setUnitId(e.target.value); setDone({}); setRemark(''); }}>
            {candidates.map(x => <option key={x.id} value={x.id}>{x.name} · {x.plate}{state.releases[x.id] ? ' — выпущена' : ''}</option>)}
          </select>
        </Field>
      </div>
      <div className="ph-body">
        {released ? (
          <div className="alert info" style={{ flexDirection: 'column', alignItems: 'flex-start' }}><b>Выпущена на линию в {released.slice(6)}</b><span style={{ color: 'var(--ink)' }}>Выберите другую машину вверху.</span></div>
        ) : (
          <>
            <div className="alert info" style={{ justifyContent: 'space-between' }}>
              <span><b>Водитель: {dr ? dr.name : '—'}</b><br /><span style={{ color: 'var(--ink)', fontSize: 13 }}>Допущен медработником · 06:41</span></span>
              <Badge tone="success">Допущен</Badge>
            </div>
            <h2 className="h2">Осмотр техники</h2>
            <div className="card" style={{ overflow: 'hidden' }}>
              {CHECKS.map((c, i) => (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', minHeight: 44, borderTop: i ? '1px solid var(--line)' : 0, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!done[i]} onChange={e => setDone({ ...done, [i]: e.target.checked })} style={{ width: 20, height: 20, accentColor: 'var(--signal)' }} />
                  <span style={{ fontSize: 14 }}>{c}</span>
                </label>
              ))}
            </div>
            <Field label="Замечание (если есть) — станет задачей механику" id="rel-r"><input id="rel-r" value={remark} onChange={e => setRemark(e.target.value)} placeholder="Например: треснуто левое зеркало" /></Field>
          </>
        )}
      </div>
      {!released && (
        <div className="ph-bottom">
          <span className="subtle" style={{ fontSize: 12, textAlign: 'center' }}>{allOk ? 'Все пункты проверены' : `Отметьте все пункты осмотра: ${Object.values(done).filter(Boolean).length} из ${CHECKS.length}`}</span>
          <Button variant="primary" size="lg" block disabled={!allOk} onClick={release}>Выпустить на линию</Button>
        </div>
      )}
    </>
  );
}
