// Сводка для офиса: что ждёт подтверждения, заявки, деньги за месяц, объявления.
import React, { useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useSession } from '../lib/session.jsx';
import { useQuery } from '../lib/data.js';
import { useRefs } from '../lib/refs.js';
import { Link } from '../lib/router.jsx';
import { rub, monthRange, monthName, dayLabel, isoDay, pbDate, plural } from '../lib/format.js';
import { Button, Badge, Field, Icon, PageTitle, ErrorBox, Loading, Sheet, useToast } from '../ui.jsx';

const f = (expr, params) => pb.filter(expr, params);

export function OfficeHome() {
  const s = useSession();
  const toast = useToast();
  const refs = useRefs(s.companyId);
  const range = monthRange();
  const today = isoDay();
  const queue = useQuery(`queue:${s.companyId}`, () => pb.collection('shifts').getList(1, 50, {
    filter: f('company = {:c} && status = "submitted"', { c: s.companyId }), sort: 'date', expand: 'shift_entries_via_shift',
  }));
  const pendingPeople = useQuery(`pendingpeople:${s.companyId}`, () => pb.collection('memberships').getFullList({ filter: f('company = {:c} && status = "pending"', { c: s.companyId }) }));
  const payroll = useQuery(s.isMoney && `payrollall:${s.companyId}:${range.from}`, () => pb.send('/api/ordius/payroll', { query: { company: s.companyId, from: range.from, to: range.to } }));
  const tasks = useQuery(`opentasks:${s.companyId}`, () => pb.collection('tasks').getList(1, 1, { filter: f('company = {:c} && status != "done" && status != "cancelled"', { c: s.companyId }) }).then((r) => r.totalItems));
  const posts = useQuery(`posts:${s.companyId}`, () => pb.collection('posts').getList(1, 10, {
    filter: f('company = {:c} && (until = "" || until >= {:t})', { c: s.companyId, t: today + ' 00:00:00.000Z' }), sort: '-pinned,-created',
  }).then((r) => r.items));
  const [postSheet, setPostSheet] = useState(false);
  const rows = (payroll.data && payroll.data.rows) || [];
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const q = (queue.data && queue.data.items) || [];

  async function removePost(id) {
    if (!window.confirm('Убрать объявление?')) return;
    try { await pb.collection('posts').delete(id); posts.reload(); } catch (e) { toast(errText(e), { err: true }); }
  }

  return (
    <div className="stack-lg">
      <PageTitle title="Сводка" eyebrow={`${s.company && s.company.name} · ${monthName(range.from)}`} />
      {s.isMoney && (
        <section className="kpis">
          <div className="card stat"><span className="lbl">Начислено</span><span className="val">{payroll.data ? rub(sum('accrued_kop')) : '…'}</span></div>
          <div className="card stat"><span className="lbl">Выплачено</span><span className="val">{payroll.data ? rub(sum('paid_kop')) : '…'}</span></div>
          <div className="card stat"><span className="lbl">К выплате</span><span className="val">{payroll.data ? rub(sum('due_kop')) : '…'}</span></div>
        </section>
      )}
      {(pendingPeople.data || []).length > 0 && (
        <Link to="/people" className="alert info" style={{ textDecoration: 'none' }}>
          <Icon name="users" size={20} /><span className="grow">Заявки на вступление: {pendingPeople.data.length}. Одобрите и назначьте роль</span><Icon name="chevron" size={18} />
        </Link>
      )}
      <section className="stack">
        <div className="row between">
          <h2 className="h2">Ждут подтверждения{q.length ? ` · ${q.length}` : ''}</h2>
          <Link to="/shift/new" className="btn sm"><Icon name="plus" size={18} />Смена за водителя</Link>
        </div>
        <ErrorBox text={queue.error} onRetry={queue.reload} />
        {queue.loading && !queue.data ? <Loading /> : (
          <div className="list">
            {q.length === 0 && <div className="list-empty">Всё проверено</div>}
            {q.map((sh) => {
              const entries = (sh.expand && sh.expand.shift_entries_via_shift) || [];
              return (
                <Link key={sh.id} to={'/shift/' + sh.id} className="list-item">
                  <div className="t">
                    <b>{(refs.member[sh.member] || {}).display_name || '…'}</b>
                    <span className="ellipsis">{dayLabel(sh.date)}{refs.site[sh.site] ? ' · ' + refs.site[sh.site].name : ''} · {entries.length} {plural(entries.length, 'строка', 'строки', 'строк')}</span>
                  </div>
                  <Badge tone="info">Проверить</Badge>
                </Link>
              );
            })}
          </div>
        )}
      </section>
      <div className="grid2">
        <Link to="/tasks" className="btn"><Icon name="wrench" />Задачи{tasks.data ? ` · ${tasks.data}` : ''}</Link>
        <Link to="/payouts" className="btn"><Icon name="wallet" />Выплата</Link>
      </div>
      <section className="stack">
        <div className="row between">
          <h2 className="h2">Объявления</h2>
          {s.is(['owner', 'manager', 'dispatcher']) && <Button size="sm" onClick={() => setPostSheet(true)}><Icon name="plus" size={18} />Объявление</Button>}
        </div>
        {(posts.data || []).length === 0 && <p className="note">Объявления видят все сотрудники на главном экране. Например: «8 марта — выходной у всех».</p>}
        {(posts.data || []).map((p) => (
          <div key={p.id} className="card card-pad" style={p.pinned ? { borderColor: 'var(--signal)' } : undefined}>
            <p style={{ whiteSpace: 'pre-line' }}>{p.text}</p>
            <div className="row between">
              <span className="small subtle">{dayLabel(p.created)}{p.until ? ' · показывать до ' + dayLabel(p.until) : ''}</span>
              {s.is(['owner', 'manager']) && <button type="button" className="btn ghost sm" onClick={() => removePost(p.id)}>Убрать</button>}
            </div>
          </div>
        ))}
      </section>
      {postSheet && <PostSheet onClose={() => setPostSheet(false)} onDone={() => { setPostSheet(false); posts.reload(); toast('Объявление опубликовано'); }} />}
    </div>
  );
}

function PostSheet({ onClose, onDone }) {
  const s = useSession();
  const [text, setText] = useState('');
  const [until, setUntil] = useState('');
  const [pinned, setPinned] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr('');
    try { await pb.collection('posts').create({ company: s.companyId, text: text.trim(), pinned, until: until ? pbDate(until) : '' }); onDone(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title="Объявление" onClose={onClose}>
      <Field label="Текст"><textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="Например: 8 марта — выходной у всех" /></Field>
      <Field label="Показывать до" hint="Пусто — пока не уберёте"><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />Закрепить наверху</label>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} disabled={!text.trim()} onClick={save}>Опубликовать</Button>
    </Sheet>
  );
}
