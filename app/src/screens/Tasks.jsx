// Задачи: поломка, запчасть, документ, ТО. Статусы и историю пишет сервер.
import React, { useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useSession } from '../lib/session.jsx';
import { useQuery } from '../lib/data.js';
import { useRefs, vehicleLabel } from '../lib/refs.js';
import { enqueue, flush } from '../lib/outbox.js';
import { compressImage } from '../lib/image.js';
import { go, Link } from '../lib/router.jsx';
import { TASK_STATUS, ROLES, dayLabel, timeOf, newId, pbDate } from '../lib/format.js';
import { Button, Badge, Field, Select, Icon, PageTitle, ErrorBox, Loading, Seg, PhotoAdd, BlobImg, useToast } from '../ui.jsx';

const f = (expr, params) => pb.filter(expr, params);
const PRIORITY = { low: 'Не срочно', normal: 'Обычная', high: 'Срочно' };

export function TaskList() {
  const s = useSession();
  const refs = useRefs(s.companyId);
  const [tab, setTab] = useState('open');
  const q = useQuery(`tasks:${s.companyId}:${tab}`, () => pb.collection('tasks').getFullList({
    filter: f('company = {:c}' + (tab === 'open' ? ' && status != "done" && status != "cancelled"' : ' && (status = "done" || status = "cancelled")'), { c: s.companyId }),
    sort: tab === 'open' ? '-created' : '-updated',
  }), { deps: [tab] });
  const list = q.data || [];
  const me = s.membership.id;
  const mineFirst = [...list].sort((a, b) => Number(b.assignee === me || (s.membership.roles || []).includes(b.assignee_role)) - Number(a.assignee === me || (s.membership.roles || []).includes(a.assignee_role)));
  return (
    <div className="stack-lg">
      <PageTitle title="Задачи">
        <Link to="/tasks/new" className="btn primary"><Icon name="plus" size={20} />Задача</Link>
      </PageTitle>
      <Seg value={tab} onChange={setTab} label="Показать" options={[{ value: 'open', label: 'В работе' }, { value: 'closed', label: 'Закрытые' }]} />
      <ErrorBox text={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : (
        <div className="list">
          {mineFirst.length === 0 && <div className="list-empty">{tab === 'open' ? 'Открытых задач нет' : 'Пока пусто'}</div>}
          {mineFirst.map((t) => {
            const st = TASK_STATUS[t.status] || {};
            const to = t.assignee ? (refs.member[t.assignee] || {}).display_name : t.assignee_role ? ROLES[t.assignee_role] : '';
            return (
              <Link key={t.id} to={'/tasks/' + t.id} className="list-item">
                <div className="t">
                  <b>{t.priority === 'high' && <span className="bad">● </span>}{t.title}</b>
                  <span className="ellipsis">{[refs.vehicle[t.vehicle] && refs.vehicle[t.vehicle].name, to && '→ ' + to, dayLabel(t.created)].filter(Boolean).join(' · ')}</span>
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TaskForm({ query }) {
  const s = useSession();
  const toast = useToast();
  const refs = useRefs(s.companyId);
  const breakdown = query.kind === 'breakdown';
  const [form, setForm] = useState({ title: breakdown ? '' : '', description: '', vehicle: '', assignee_role: breakdown ? 'mechanic' : '', assignee: '', priority: breakdown ? 'high' : 'normal', due: '', photos: [] });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((x) => ({ ...x, ...p }));
  async function save() {
    if (form.title.trim().length < 3) { setErr('Коротко опишите, что случилось или что нужно'); return; }
    setBusy(true); setErr('');
    try {
      const id = newId();
      const ops = [{ op: 'create', col: 'tasks', id, data: {
        company: s.companyId, title: form.title.trim(), description: form.description, vehicle: form.vehicle, assignee: form.assignee,
        assignee_role: form.assignee ? '' : form.assignee_role, priority: form.priority, status: 'new', due: form.due ? pbDate(form.due) : '',
      }, label: 'Задача: ' + form.title.trim() }];
      for (const p of form.photos) ops.push({ op: 'create', col: 'documents', id: newId(), data: { company: s.companyId, task: id, vehicle: form.vehicle, kind: 'photo' }, files: { files: [{ blob: p.blob, name: p.name }] }, label: 'Фото к задаче' });
      await enqueue(ops);
      const left = await flush();
      toast(left ? 'Сохранено — отправится, когда будет связь' : 'Задача поставлена');
      go('/', { replace: true });
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <div className="stack-lg">
      <PageTitle title={breakdown ? 'Поломка' : 'Новая задача'} backTo="/" />
      <section className="card card-pad">
        <Field label={breakdown ? 'Что сломалось' : 'Что нужно сделать'}>
          <input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={breakdown ? 'Например: пробито колесо, задний мост' : ''} autoFocus />
        </Field>
        <Field label="Машина">
          <Select value={form.vehicle} onChange={(v) => set({ vehicle: v })} placeholder="Не относится к машине"
            options={refs.vehicles.filter((v) => v.active !== false).map((v) => ({ value: v.id, label: vehicleLabel(v) }))} />
        </Field>
        <Field label="Подробности"><textarea value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <div className="field-row">
          <Field label="Кому">
            <Select value={form.assignee || (form.assignee_role ? 'role:' + form.assignee_role : '')} onChange={(v) => (v.startsWith('role:') ? set({ assignee_role: v.slice(5), assignee: '' }) : set({ assignee: v, assignee_role: '' }))}
              placeholder="Руководству" options={[
                { value: 'role:mechanic', label: 'Механику' }, { value: 'role:dispatcher', label: 'Диспетчеру' }, { value: 'role:manager', label: 'Руководителю' },
                ...(s.isOffice ? refs.members.filter((m) => m.status === 'active').map((m) => ({ value: m.id, label: m.display_name })) : []),
              ]} />
          </Field>
          <Field label="Срочность">
            <Select value={form.priority} onChange={(v) => set({ priority: v })} options={Object.entries(PRIORITY).map(([value, label]) => ({ value, label }))} />
          </Field>
        </div>
        {s.isOffice && <Field label="Срок"><input type="date" value={form.due} onChange={(e) => set({ due: e.target.value })} /></Field>}
      </section>
      <div className="photos">
        {form.photos.map((p) => <div key={p.key} className="photo"><BlobImg blob={p.blob} alt="" /><button type="button" className="x" aria-label="Убрать" onClick={() => set({ photos: form.photos.filter((x) => x.key !== p.key) })}><Icon name="x" size={16} /></button></div>)}
        <PhotoAdd label="Фото" accept="image/*" onAdd={async (files) => {
          const out = [];
          for (const file of files) out.push({ key: newId(), ...(await compressImage(file)) });
          setForm((x) => ({ ...x, photos: [...x.photos, ...out] }));
        }} />
      </div>
      <ErrorBox text={err} />
      <Button variant="primary" size="lg" block busy={busy} onClick={save}>Поставить задачу</Button>
    </div>
  );
}

export function TaskView({ params }) {
  const s = useSession();
  const toast = useToast();
  const refs = useRefs(s.companyId);
  const q = useQuery('task:' + params.id, () => pb.collection('tasks').getOne(params.id));
  const ev = useQuery('taskev:' + params.id, () => pb.collection('task_events').getFullList({ filter: f('task = {:t}', { t: params.id }), sort: 'created', expand: 'author' }));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const t = q.data;
  if (q.loading && !t) return <Loading />;
  if (!t) return <ErrorBox text={q.error || 'Задача не найдена'} onRetry={q.reload} />;
  const st = TASK_STATUS[t.status] || {};
  const me = s.membership.id;
  const canWork = s.is(['owner', 'manager', 'dispatcher', 'mechanic']) || t.assignee === me;

  async function upd(patch, msg) {
    setBusy(JSON.stringify(patch)); setErr('');
    try { await pb.collection('tasks').update(t.id, patch); toast(msg); q.reload(); ev.reload(); } catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  }
  async function comment() {
    if (!text.trim()) return;
    setBusy('c');
    try { await pb.collection('task_events').create({ company: t.company, task: t.id, kind: 'comment', text: text.trim() }); setText(''); ev.reload(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  }
  return (
    <div className="stack-lg">
      <PageTitle title={t.title} eyebrow={dayLabel(t.created)} backTo="/tasks"><Badge tone={st.tone}>{st.label}</Badge></PageTitle>
      <section className="card card-pad">
        {t.description && <p style={{ whiteSpace: 'pre-line' }}>{t.description}</p>}
        <div className="row between"><span className="muted">Машина</span><b>{refs.vehicle[t.vehicle] ? vehicleLabel(refs.vehicle[t.vehicle]) : '—'}</b></div>
        <div className="row between"><span className="muted">Исполнитель</span><b>{t.assignee ? (refs.member[t.assignee] || {}).display_name : t.assignee_role ? ROLES[t.assignee_role] : 'Руководство'}</b></div>
        {t.priority === 'high' && <Badge tone="danger">Срочно</Badge>}
      </section>
      {canWork && t.status !== 'done' && t.status !== 'cancelled' && (
        <div className="grid2">
          {t.status !== 'in_progress' && <Button variant="primary" busy={!!busy} onClick={() => upd({ status: 'in_progress', assignee: t.assignee || me }, 'Взято в работу')}>Беру в работу</Button>}
          {t.status === 'in_progress' && <Button busy={!!busy} onClick={() => upd({ status: 'waiting' }, 'Ждём')}>Ждём (запчасть…)</Button>}
          <Button variant="success" busy={!!busy} onClick={() => upd({ status: 'done' }, 'Готово')}><Icon name="check" />Готово</Button>
        </div>
      )}
      {(t.status === 'done' || t.status === 'cancelled') && canWork && <Button onClick={() => upd({ status: 'new' }, 'Задача снова открыта')}>Открыть снова</Button>}
      <ErrorBox text={err} />
      <section className="stack">
        <h2 className="h2">История</h2>
        <div className="list">
          {(ev.data || []).length === 0 && <div className="list-empty">Пока ничего</div>}
          {(ev.data || []).map((e) => (
            <div key={e.id} className="list-item" style={{ cursor: 'default' }}>
              <div className="t">
                <b style={{ fontWeight: 500 }}>{e.kind === 'comment' ? e.text : e.kind === 'status' ? `Статус: ${(TASK_STATUS[e.to_status] || {}).label || e.to_status}${e.text ? ' — ' + e.text : ''}` : 'Назначено'}</b>
                <span>{(e.expand && e.expand.author && e.expand.author.name) || 'Ordius'} · {dayLabel(e.created)} {timeOf(e.created)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <div className="field grow"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Комментарий" aria-label="Комментарий" onKeyDown={(e) => { if (e.key === 'Enter') comment(); }} /></div>
          <Button variant="primary" busy={busy === 'c'} onClick={comment} aria-label="Отправить">Отправить</Button>
        </div>
      </section>
    </div>
  );
}
