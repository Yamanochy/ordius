import React, { useEffect, useState } from 'react';
import { useStore, actionableCount } from './store.jsx';
import { ROLES } from './data.js';
import { Logo, Seg, Button } from './ui.jsx';
import Overview from './screens/Overview.jsx';
import Tabel from './screens/Tabel.jsx';
import Tasks from './screens/Tasks.jsx';
import Fleet from './screens/Fleet.jsx';
import Objects from './screens/Objects.jsx';
import Accounting from './screens/Accounting.jsx';
import DriverApp from './screens/DriverApp.jsx';
import MechanicApp from './screens/MechanicApp.jsx';
import Planner from './screens/biz/Planner.jsx';
import Customer from './screens/biz/Customer.jsx';
import Branches from './screens/biz/Branches.jsx';
import Warehouse from './screens/biz/Warehouse.jsx';
import Economics from './screens/biz/Economics.jsx';
import Telematics from './screens/biz/Telematics.jsx';
import Fuel from './screens/biz/Fuel.jsx';
import Vahta from './screens/biz/Vahta.jsx';
import Staff from './screens/biz/Staff.jsx';
import Release from './screens/biz/Release.jsx';
import Fines from './screens/biz/Fines.jsx';
import Access from './screens/biz/Access.jsx';
import Assistant from './Assistant.jsx';

const SCREENS = {
  overview: { label: 'Обзор', C: Overview },
  tabel: { label: 'Табель', C: Tabel },
  tasks: { label: 'Задачи', C: Tasks },
  fleet: { label: 'Техника', C: Fleet },
  objects: { label: 'Объекты', C: Objects },
  accounting: { label: 'Бухгалтерия', C: Accounting },
  mech: { label: 'Телефон механика', C: MechanicApp, phone: true },
  driver: { label: 'Телефон водителя', C: DriverApp, phone: true },
  // ---- тариф «Бизнес» ----
  planner: { label: 'Планировщик', C: Planner, biz: true },
  customer: { label: 'Кабинет заказчика', C: Customer, biz: true },
  branches: { label: 'Филиалы', C: Branches, biz: true },
  economics: { label: 'Экономика машин', C: Economics, biz: true },
  warehouse: { label: 'Склад', C: Warehouse, biz: true },
  fuel: { label: 'Топливо', C: Fuel, biz: true },
  gps: { label: 'GPS', C: Telematics, biz: true },
  vahta: { label: 'Вахта', C: Vahta, biz: true },
  staff: { label: 'Кадры', C: Staff, biz: true },
  release: { label: 'Выпуск на линию', C: Release, biz: true, phone: true },
  fines: { label: 'Штрафы', C: Fines, biz: true },
  access: { label: 'Права и журнал', C: Access, biz: true }
};

const ROLE_SCREENS = {
  owner: ['overview', 'tabel', 'tasks', 'fleet', 'objects', 'accounting', 'planner', 'customer', 'branches', 'economics', 'warehouse', 'fuel', 'gps', 'vahta', 'staff', 'fines', 'access'],
  dispatcher: ['tabel', 'tasks', 'fleet', 'planner', 'gps', 'fuel', 'vahta', 'staff', 'fines'],
  mechanic: ['mech', 'tasks', 'fleet', 'release', 'warehouse'],
  supply: ['tasks', 'warehouse'],
  accountant: ['accounting', 'tabel', 'fuel', 'fines', 'economics'],
  driver: ['driver'],
  customer: ['customer']
};

function systemDark() { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
function currentTheme() { return document.documentElement.getAttribute('data-theme') || (systemDark() ? 'dark' : 'light'); }

function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const on = () => setTheme(currentTheme());
    if (mq && mq.addEventListener) mq.addEventListener('change', on);
    return () => { if (mq && mq.removeEventListener) mq.removeEventListener('change', on); };
  }, []);
  const dark = theme === 'dark';
  const flip = () => {
    const n = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', n);
    try { window.localStorage.setItem('ordius-theme', n); } catch (e) { /* без сохранения */ }
    setTheme(n);
  };
  const label = dark ? 'Включить светлую тему' : 'Включить тёмную тему';
  return (
    <button type="button" className="theme-btn" onClick={flip} aria-label={label} title={label}>
      {dark
        ? <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        : <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>}
    </button>
  );
}

function getPlan() { try { return window.localStorage.getItem('ordius-plan') || 'business'; } catch (e) { return 'business'; } }
function allowed(role, plan) { return ROLE_SCREENS[role].filter(s => plan === 'business' || !SCREENS[s].biz); }

function readHash(plan) {
  const h = (window.location.hash || '').replace('#', '').split('/');
  let role = ROLE_SCREENS[h[0]] ? h[0] : 'owner';
  if (allowed(role, plan).length === 0) role = 'owner';
  const list = allowed(role, plan);
  const screen = list.includes(h[1]) ? h[1] : list[0];
  return { role, screen };
}

export default function App() {
  const { state, reset, toast, setToast } = useStore();
  const [plan, setPlanState] = useState(getPlan);
  const [{ role, screen }, setNav] = useState(() => readHash(getPlan()));

  useEffect(() => {
    const on = () => setNav(readHash(plan));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [plan]);

  const go = (r, s, p = plan) => {
    const list = allowed(r, p);
    const sc = s && list.includes(s) ? s : list[0];
    window.location.hash = r + '/' + sc;
    setNav({ role: r, screen: sc });
    window.scrollTo(0, 0);
  };

  const setPlan = p => {
    try { window.localStorage.setItem('ordius-plan', p); } catch (e) { /* без сохранения */ }
    setPlanState(p);
    const r = allowed(role, p).length ? role : 'owner';
    go(r, allowed(r, p).includes(screen) ? screen : undefined, p);
    setToast(p === 'business' ? 'Тариф «Бизнес»: открыто 12 дополнительных разделов' : 'Тариф «Старт»: базовые разделы');
  };

  const roles = ROLES.filter(r => plan === 'business' || !r.business);
  const person = ROLES.find(r => r.id === role);
  const Screen = SCREENS[screen].C;
  const taskCount = actionableCount(state, role);
  const core = allowed(role, plan).filter(s => !SCREENS[s].biz);
  const biz = ROLE_SCREENS[role].filter(s => SCREENS[s].biz);

  return (
    <>
      <div className="demo-bar">
        <span><b>Демо Ordius.</b> Данные вымышленные, всё работает.</span>
        <Seg label="Тариф" value={plan} onChange={setPlan} options={[{ value: 'start', label: 'Старт' }, { value: 'business', label: 'Бизнес' }]} />
        <Seg label="Роль" value={role} onChange={r => go(r)} options={roles.map(r => ({ value: r.id, label: r.label }))} />
        <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('Вернуть демо к исходным данным?')) reset(); }}>Сбросить демо</Button>
      </div>

      <header className="app-header">
        <div className="app-header-in">
          <Logo size={24} onDark />
          <nav className="nav" aria-label="Разделы">
            {core.map(id => (
              <button key={id} type="button" className={id === screen ? 'on' : ''} onClick={() => go(role, id)}>
                {SCREENS[id].label}
                {id === 'tasks' && taskCount > 0 && <span className="count" aria-label={taskCount + ' ждут действия'}>{taskCount}</span>}
              </button>
            ))}
          </nav>
          <span className="who">ООО «СибСпецТранс» · {person.label}: {person.person}</span>
          <ThemeToggle />
        </div>
        {biz.length > 0 && (
          <div className="biz-strip">
            <div className="biz-strip-in">
              <span className="biz-tag">Бизнес</span>
              {biz.map(id => (
                <button key={id} type="button" className={(id === screen ? 'on ' : '') + (plan === 'start' ? 'locked' : '')} onClick={() => plan === 'start' ? setPlan('business') : go(role, id)} title={plan === 'start' ? 'Доступно в тарифе «Бизнес» — нажмите, чтобы включить' : undefined}>
                  {plan === 'start' && <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>}
                  {SCREENS[id].label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {SCREENS[screen].phone
        ? <div className="phone-stage"><div className="phone"><Screen role={role} go={go} /></div></div>
        : <main className="page"><Screen role={role} go={go} /></main>}

      <Assistant role={role} go={go} phone={!!SCREENS[screen].phone} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
