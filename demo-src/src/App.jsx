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

const SCREENS = {
  overview: { label: 'Обзор', C: Overview },
  tabel: { label: 'Табель', C: Tabel },
  tasks: { label: 'Задачи', C: Tasks },
  fleet: { label: 'Техника', C: Fleet },
  objects: { label: 'Объекты', C: Objects },
  accounting: { label: 'Бухгалтерия', C: Accounting },
  mech: { label: 'Телефон механика', C: MechanicApp, phone: true },
  driver: { label: 'Телефон водителя', C: DriverApp, phone: true }
};

const ROLE_SCREENS = {
  owner: ['overview', 'tabel', 'tasks', 'fleet', 'objects', 'accounting'],
  dispatcher: ['tabel', 'tasks', 'fleet'],
  mechanic: ['mech', 'tasks', 'fleet'],
  supply: ['tasks'],
  accountant: ['accounting', 'tabel'],
  driver: ['driver']
};

function readHash() {
  const h = (window.location.hash || '').replace('#', '').split('/');
  const role = ROLE_SCREENS[h[0]] ? h[0] : 'owner';
  const screen = ROLE_SCREENS[role].includes(h[1]) ? h[1] : ROLE_SCREENS[role][0];
  return { role, screen };
}

export default function App() {
  const { state, reset, toast } = useStore();
  const [{ role, screen }, setNav] = useState(readHash);

  useEffect(() => {
    const on = () => setNav(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = (r, s) => {
    const sc = s && ROLE_SCREENS[r].includes(s) ? s : ROLE_SCREENS[r][0];
    window.location.hash = r + '/' + sc;
    setNav({ role: r, screen: sc });
    window.scrollTo(0, 0);
  };

  const person = ROLES.find(r => r.id === role);
  const Screen = SCREENS[screen].C;
  const taskCount = actionableCount(state, role);

  return (
    <>
      <div className="demo-bar">
        <span><b>Демо Ordius.</b> Данные вымышленные, всё работает. Смотрите глазами каждого:</span>
        <Seg label="Роль" value={role} onChange={r => go(r)} options={ROLES.map(r => ({ value: r.id, label: r.label }))} />
        <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('Вернуть демо к исходным данным?')) reset(); }}>Сбросить демо</Button>
      </div>

      <header className="app-header">
        <div className="app-header-in">
          <Logo size={30} onDark />
          <nav className="nav" aria-label="Разделы">
            {ROLE_SCREENS[role].map(id => (
              <button key={id} type="button" className={id === screen ? 'on' : ''} onClick={() => go(role, id)}>
                {SCREENS[id].label}
                {id === 'tasks' && taskCount > 0 && <span className="count" aria-label={taskCount + ' ждут действия'}>{taskCount}</span>}
              </button>
            ))}
          </nav>
          <span className="who">ООО «СибСпецТранс» · {person.label}: {person.person}</span>
        </div>
      </header>

      {SCREENS[screen].phone
        ? <div className="phone-stage"><div className="phone"><Screen role={role} go={go} /></div></div>
        : <main className="page"><Screen role={role} go={go} /></main>}

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
