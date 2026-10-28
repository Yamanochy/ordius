import React, { useEffect, useState } from 'react';
import { useSession } from './lib/session.jsx';
import { useRoute, match, Link } from './lib/router.jsx';
import { subscribe, startOutbox } from './lib/outbox.js';
import { useOnline } from './lib/data.js';
import { Icon, Loading, Logo } from './ui.jsx';
import Auth from './screens/Auth.jsx';
import Welcome from './screens/Welcome.jsx';
import { DriverHome, Money } from './screens/Driver.jsx';
import { ShiftForm, ShiftList, ShiftView } from './screens/Shifts.jsx';
import { FuelForm, FuelList } from './screens/Fuel.jsx';
import { TaskList, TaskForm, TaskView } from './screens/Tasks.jsx';
import { More, Profile, Outbox, CompanySettings } from './screens/More.jsx';
import { OfficeHome } from './screens/Office.jsx';
import { People, Person } from './screens/People.jsx';
import { Payroll, Payouts } from './screens/Payroll.jsx';
import { Vehicles, Sites, Rates } from './screens/Directory.jsx';
import { Maintenance } from './screens/Fleet.jsx';
import { ConnectCodes, AdminCabinet } from './screens/Admin.jsx';

function navFor(s) {
  if (s.isOffice) {
    return [['/', 'Сводка', 'checks'], ['/shifts', 'Смены', 'cal'], ['/people', 'Люди', 'users'],
      ['/payroll', 'Ведомость', 'wallet'], ['/more', 'Ещё', 'more']];
  }
  if (s.is(['mechanic']) && !s.is(['driver'])) {
    return [['/', 'Задачи', 'wrench'], ['/maintenance', 'ТО', 'truck'], ['/money', 'Деньги', 'wallet'], ['/more', 'Ещё', 'more']];
  }
  return [['/', 'Главная', 'home'], ['/shifts', 'Смены', 'cal'], ['/money', 'Деньги', 'wallet'], ['/more', 'Ещё', 'more']];
}

const ROUTES = [
  ['/shifts', ShiftList], ['/shift/new', ShiftForm], ['/shift/:id/edit', ShiftForm], ['/shift/:id', ShiftView],
  ['/money', Money], ['/fuel', FuelList], ['/fuel/new', FuelForm],
  ['/tasks', TaskList], ['/tasks/new', TaskForm], ['/tasks/:id', TaskView],
  ['/more', More], ['/profile', Profile], ['/outbox', Outbox], ['/company', CompanySettings], ['/join', () => <Welcome embedded />],
  ['/people', People], ['/people/:id', Person], ['/payroll', Payroll], ['/payouts', Payouts],
  ['/vehicles', Vehicles], ['/sites', Sites], ['/rates', Rates], ['/maintenance', Maintenance],
  ['/connect-codes', ConnectCodes], ['/admin', AdminCabinet],
];
const WIDE = ['/admin', '/payroll', '/shifts', '/people', '/rates', '/payouts', '/vehicles', '/sites', '/maintenance', '/fuel'];

export default function App() {
  const s = useSession();
  const { path, query } = useRoute();
  const online = useOnline();
  const [outbox, setOutbox] = useState([]);
  useEffect(() => { if (s.user) startOutbox(); }, [s.user]);
  useEffect(() => subscribe(setOutbox), []);

  if (!s.user) return <Auth />;
  if (s.loading && !s.memberships.length) return <div className="main"><Loading /></div>;
  if (!s.membership) return <Welcome />;

  const nav = navFor(s);
  let Screen = null;
  let params = {};
  if (path === '/') {
    Screen = s.isOffice ? OfficeHome : (s.is(['mechanic']) && !s.is(['driver']) ? TaskList : DriverHome);
  } else {
    for (const [pattern, C] of ROUTES) {
      const m = match(pattern, path);
      if (m) { Screen = C; params = m; break; }
    }
  }
  const active = (to) => (to === '/' ? path === '/' : path === to || path.startsWith(to + '/') || (to === '/shifts' && path.startsWith('/shift/')));
  const failed = outbox.filter((i) => i.error).length;

  return (
    <div className="shell">
      {!online && <div className="offline-bar">Нет связи — всё, что вы внесёте, сохранится и отправится позже</div>}
      <header className="topbar">
        <div className="topbar-in">
          <Logo variant="mark" size={34} onDark />
          <button type="button" className="co" onClick={() => { window.location.hash = '/profile'; }}>
            <small className="ellipsis">{s.company && s.company.name}</small>
            <b>{s.membership.display_name || (s.user && s.user.name)}</b>
          </button>
          <nav className="topnav" aria-label="Разделы">
            {nav.map(([to, label]) => <Link key={to} to={to} className={active(to) ? 'on' : ''}>{label}</Link>)}
          </nav>
          {outbox.length > 0 && (
            <Link to="/outbox" className="icon-btn" aria-label={`Не отправлено: ${outbox.length}`} title="Не отправлено">
              <Icon name={failed ? 'alert' : 'upload'} size={20} />
              <span className="dot">{outbox.length}</span>
            </Link>
          )}
        </div>
      </header>
      <main className={'main' + (WIDE.some((w) => path === w) ? ' wide' : '')}>
        {Screen ? <Screen params={params} query={query} outbox={outbox} /> : <NotFound />}
      </main>
      <nav className="tabbar" aria-label="Разделы">
        {nav.map(([to, label, icon]) => (
          <Link key={to} to={to} className={active(to) ? 'on' : ''} aria-current={active(to) ? 'page' : undefined}>
            <Icon name={icon} size={24} />{label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function NotFound() {
  return <div className="stack"><h1 className="h2">Такой страницы нет</h1><Link to="/" className="btn">На главную</Link></div>;
}
