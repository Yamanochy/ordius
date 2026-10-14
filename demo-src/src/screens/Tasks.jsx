import React, { useState } from 'react';
import { useStore, inboxFor, taskActions, requestPart, STATUS, REPAIR_FLOW, roleLabel, fmt, nowLabel, SUPPLY_LIMIT } from '../store.jsx';
import { ROLES } from '../data.js';
import { PageHead, Button, Badge, Modal, Field, Icon } from '../ui.jsx';
import { unitName } from './Overview.jsx';

export default function Tasks({ role }) {
  const { state } = useStore();
  const list = inboxFor(state, role).filter(t => t.parentId === null || (role !== 'owner' && t.kind === 'supply'));
  const ordered = [...list].sort((a, b) => (taskActions(b, role, state).length > 0) - (taskActions(a, role, state).length > 0));
  const [sel, setSel] = useState(ordered[0] ? ordered[0].id : null);
  const [creating, setCreating] = useState(false);
  const current = state.tasks.find(t => t.id === sel) || ordered[0];
  const root = current ? (current.parentId ? state.tasks.find(t => t.id === current.parentId) : current) : null;

  return (
    <>
      <PageHead eyebrow="У каждой роли — свои входящие. Задача сама уходит тому, кто её делает." title="Задачи">
        {(role === 'owner' || role === 'dispatcher') && <Button variant="primary" onClick={() => setCreating(true)}>Новая задача</Button>}
      </PageHead>

      <div className="split">
        <section className="card side" style={{ overflow: 'hidden', flexBasis: 340 }} aria-label="Входящие">
          <div style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: 'var(--ink-muted)', background: 'var(--surface-2)' }}>
            {role === 'owner' ? 'Все задачи компании' : 'Входящие · ' + roleLabel(role)}
          </div>
          {ordered.length === 0 && <p className="muted" style={{ padding: 16, margin: 0 }}>Входящих нет. Попробуйте роль «Водитель» и сообщите о поломке — задача придёт механику.</p>}
          {ordered.map(t => {
            const acts = taskActions(t, role, state).length > 0;
            return (
              <button key={t.id} type="button" className={'list-item' + (current && current.id === t.id ? ' on' : '')} onClick={() => setSel(t.id)}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <b style={{ fontWeight: 600, fontSize: 14 }}>{t.title}</b>
                    <span className="subtle" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{t.created}</span>
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>{unitName(state, t.unitId)} · от: {t.from}</span>
                  <span className="row" style={{ gap: 6 }}>
                    <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                    {acts && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--signal-text)' }}>нужно ваше действие</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </section>

        <section className="main">
          {root ? <ChainView root={root} role={role} /> : <div className="card card-pad"><p className="muted" style={{ margin: 0 }}>Выберите задачу слева.</p></div>}
        </section>
      </div>

      <section className="card card-pad">
        <h2>Куда задача уходит сама</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '4px 24px' }}>
          {[
            ['Неисправность от водителя', '→ механику, «К исполнению»; машина — в «Ремонт»'],
            ['Нужна запчасть', '→ снабжению; механик видит «Ждёт запчасть»'],
            [`Закупка дороже ${fmt(SUPPLY_LIMIT)}`, '→ сначала владельцу на согласование'],
            ['Закуплено', '→ счёт бухгалтеру, запчасть — механику'],
            ['Выполнено механиком', '→ владельцу на приёмку'],
            ['Принято', '→ машина возвращается «На линию»']
          ].map(([a, b]) => <span key={a} style={{ display: 'flex', flexDirection: 'column', padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 14 }}><b style={{ fontWeight: 600 }}>{a}</b><span className="muted">{b}</span></span>)}
        </div>
      </section>

      {creating && <NewTaskModal role={role} onClose={() => setCreating(false)} />}
    </>
  );
}

export function ChainView({ root, role, compact }) {
  const { state, update } = useStore();
  const [partFor, setPartFor] = useState(null);
  const children = state.tasks.filter(t => t.parentId === root.id);
  const steps = [root, ...children];
  const curIdx = REPAIR_FLOW.indexOf(root.status);

  const runAction = (a, t) => {
    if (a.ask === 'part') { setPartFor(t); return; }
    update(a.run, a.msg);
  };

  return (
    <div className={compact ? '' : 'card card-pad'} style={compact ? { display: 'flex', flexDirection: 'column', gap: 14 } : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="muted" style={{ fontSize: 13 }}>Цепочка № {root.chain} · {unitName(state, root.unitId)}</span>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="h2" style={{ fontSize: compact ? 18 : 22, lineHeight: 1.3 }}>{root.title}</h2>
          <Badge tone={STATUS[root.status].tone}>{STATUS[root.status].label}</Badge>
        </div>
      </div>

      {root.kind === 'repair' && !compact && (
        <ol className="flow" aria-label="Ход статусов">
          {REPAIR_FLOW.map((s, i) => <li key={s} className={i < curIdx ? 'past' : i === curIdx ? 'cur' : ''}><i />{STATUS[s].label}</li>)}
        </ol>
      )}

      <div>
        {steps.map((t, i) => {
          const acts = taskActions(t, role, state);
          const done = ['accepted', 'done'].includes(t.status) && t.kind === 'supply' || t.status === 'accepted';
          return (
            <div key={t.id} className="chain-step" style={{ paddingLeft: t.parentId ? 28 : 0 }}>
              <span className="chain-dot"><i className={done ? 'done' : acts.length ? 'now' : ''} />{i < steps.length - 1 && <b />}</span>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 18 }}>
                <span className="row" style={{ gap: 8 }}>
                  <span className="muted" style={{ fontSize: 13 }}>{t.from}</span>
                  <Icon name="arrow" size={14} color="var(--ink-subtle)" />
                  <b style={{ fontSize: 13, fontWeight: 600 }}>{roleLabel(t.toRole)}</b>
                  <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                  {t.price ? <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>{fmt(t.price)}</span> : null}
                </span>
                <b style={{ fontWeight: 600 }}>{t.title}</b>
                {t.note && <span className="muted" style={{ fontSize: 13, lineHeight: '19px' }}>{t.note}</span>}
                {t.history && t.history.length > 0 && (
                  <details style={{ fontSize: 12 }} className="subtle">
                    <summary style={{ cursor: 'pointer' }}>История ({t.history.length})</summary>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{t.history.map((h, k) => <li key={k}>{h}</li>)}</ul>
                  </details>
                )}
                {acts.length > 0 && (
                  <div className="row" style={{ marginTop: 4 }}>
                    {acts.map(a => <Button key={a.label} size="sm" variant={a.primary ? 'primary' : undefined} onClick={() => runAction(a, t)}>{a.label}</Button>)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {role !== 'owner' && steps.every(t => taskActions(t, role, state).length === 0) && (
        <p className="subtle" style={{ fontSize: 13, margin: 0 }}>Сейчас ход за другой ролью. Переключите роль вверху — например, «{nextRoleHint(root, state)}».</p>
      )}

      {partFor && <PartModal task={partFor} onClose={() => setPartFor(null)} fixed={!compact} />}
    </div>
  );
}

function nextRoleHint(root, state) {
  const kids = state.tasks.filter(t => t.parentId === root.id && t.status !== 'done');
  if (kids.some(k => k.status === 'approve')) return 'Владелец';
  if (kids.some(k => k.status === 'buy')) return 'Снабжение';
  if (kids.some(k => k.status === 'handed')) return 'Механик';
  if (root.status === 'done') return 'Владелец';
  return 'Механик';
}

function PartModal({ task, onClose, fixed }) {
  const { state, update } = useStore();
  const [name, setName] = useState('Фильтр топливный тонкой очистки');
  const [price, setPrice] = useState('4200');
  const p = Number(String(price).replace(/\s/g, '')) || 0;
  return (
    <Modal fixed={fixed} title="Нужна запчасть" onClose={onClose}>
      <Field label="Что купить" id="pn"><input id="pn" value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Примерная цена, ₽" id="pp" hint={p > SUPPLY_LIMIT ? 'Дороже 20 000 ₽ — сначала уйдёт владельцу на согласование' : 'В пределах лимита — сразу снабжению'}>
        <input id="pp" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
      </Field>
      <Button variant="primary" size="lg" block disabled={!name || !p} onClick={() => { requestPart(state, update, task, name, p); onClose(); }}>Отправить</Button>
    </Modal>
  );
}

function NewTaskModal({ role, onClose }) {
  const { state, update } = useStore();
  const [title, setTitle] = useState('');
  const [to, setTo] = useState('mechanic');
  const [unit, setUnit] = useState(state.units[0].id);
  const create = () => {
    update(s => {
      const id = 't' + (s.nextId++);
      const repair = to === 'mechanic';
      s.tasks.unshift({ id, chain: 100 + s.nextId, parentId: null, kind: repair ? 'repair' : 'general', title, unitId: unit, from: role === 'owner' ? 'Петров И., владелец' : 'Орлова Т., диспетчер', toRole: to, status: 'todo', created: nowLabel(), note: '', history: [nowLabel() + ' · создано'] });
    }, 'Задача отправлена: ' + roleLabel(to));
    onClose();
  };
  return (
    <Modal fixed title="Новая задача" onClose={onClose}>
      <Field label="Что сделать" id="nt"><input id="nt" value={title} onChange={e => setTitle(e.target.value)} placeholder="Например: перегнать грейдер на ЖК Северный" /></Field>
      <Field label="Кому" id="nto">
        <select id="nto" value={to} onChange={e => setTo(e.target.value)}>
          {ROLES.filter(r => r.id !== 'owner' && r.id !== role).map(r => <option key={r.id} value={r.id}>{r.label} · {r.person}</option>)}
        </select>
      </Field>
      <Field label="Техника" id="ntu">
        <select id="ntu" value={unit} onChange={e => setUnit(e.target.value)}>
          {state.units.map(u => <option key={u.id} value={u.id}>{u.name} · {u.plate}</option>)}
        </select>
      </Field>
      <Button variant="primary" size="lg" block disabled={!title.trim()} onClick={create}>Поставить задачу</Button>
    </Modal>
  );
}
