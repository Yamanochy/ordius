import React, { useState } from 'react';
import { AssistantButton } from '../Assistant.jsx';
import { useStore, inboxFor, taskActions, STATUS } from '../store.jsx';
import { Logo, Badge, Icon } from '../ui.jsx';
import { ChainView } from './Tasks.jsx';
import { unitName } from './Overview.jsx';

export default function MechanicApp() {
  const { state } = useStore();
  const [open, setOpen] = useState(null);
  const list = inboxFor(state, 'mechanic').filter(t => t.parentId === null);
  const waiting = state.tasks.filter(t => t.kind === 'repair' && t.parentId === null && t.status === 'done');
  const task = open && state.tasks.find(t => t.id === open);

  if (task) {
    return (
      <>
        <div className="ph-top">
          <button type="button" onClick={() => setOpen(null)} aria-label="Назад к заявкам" style={{ width: 44, height: 44, border: 0, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="subtle" style={{ fontSize: 12 }}>Заявка · механик Зуев П.</span>
            <b style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{unitName(state, task.unitId)}</b>
          </span>
        </div>
        <div className="ph-body"><ChainView root={task} role="mechanic" compact /></div>
      </>
    );
  }

  return (
    <>
      <div className="ph-top">
        <Logo variant="mark" size={40} />
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span className="subtle" style={{ fontSize: 12 }}>Механик · база Новосибирск</span>
          <b style={{ fontSize: 16, fontWeight: 600 }}>Павел Зуев</b>
        </span>
        <AssistantButton />
      </div>
      <div className="ph-body">
        <h2 className="h2">Мои заявки</h2>
        {list.length === 0 && <p className="muted" style={{ margin: 0 }}>Заявок нет. Переключитесь на «Водитель» и сообщите о поломке — она придёт сюда.</p>}
        <div className="card" style={{ overflow: 'hidden' }}>
          {list.map(t => {
            const act = taskActions(t, 'mechanic', state).length > 0 || state.tasks.some(c => c.parentId === t.id && taskActions(c, 'mechanic', state).length > 0);
            return (
              <button key={t.id} type="button" className="list-item" onClick={() => setOpen(t.id)} style={{ borderTop: 0, borderBottom: '1px solid var(--line)' }}>
                <Icon name="wrench" color={act ? 'var(--signal-text)' : 'var(--ink-subtle)'} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                  <b style={{ fontWeight: 600, fontSize: 14 }}>{t.title}</b>
                  <span className="muted" style={{ fontSize: 12 }}>{unitName(state, t.unitId)} · {t.created}</span>
                  <span className="row" style={{ gap: 6 }}><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>{act && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--signal-text)' }}>ваш ход</span>}</span>
                </span>
              </button>
            );
          })}
        </div>
        {waiting.length > 0 && (
          <>
            <h2 className="h2">Ждут приёмки руководителем</h2>
            <div className="card" style={{ overflow: 'hidden' }}>
              {waiting.map(t => (
                <div key={t.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
                  <b style={{ fontWeight: 600, fontSize: 14 }}>{t.title}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{unitName(state, t.unitId)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
