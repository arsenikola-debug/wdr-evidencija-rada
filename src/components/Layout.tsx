import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { isVisibleForProfile, resolveProfile, type UiProfile } from '../features/auth/profile';

/**
 * Vizuelni shell. Rute, dozvole i ponašanje su nepromenjeni —
 * `permission` i dalje preslikava app.has_perm(); baza je ta koja sprovodi pristup,
 * ovde se samo ne prikazuje link koji bi svakako pao.
 */

type IconName =
  | 'home'
  | 'shield'
  | 'bell'
  | 'grid'
  | 'clipboard'
  | 'users'
  | 'truck'
  | 'check'
  | 'wallet'
  | 'history'
  | 'plus'
  | 'chart'
  | 'settings';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  permission?: string;
  icon: IconName;
  /** Podrute koje i dalje pripadaju ovoj stavci (npr. /unos/pregled -> Unos). */
  alsoActiveOn?: string[];
  /**
   * Kojim ULOGAMA ovaj modul pripada. Izostavljeno = svima.
   *
   * Ovo je prezentaciona relevantnost, ne autorizacija: `SUPER_ADMIN_BA` ima
   * backend prava i nad operaterskim i nad finansijskim RPC-ovima, ali mu ti
   * moduli nisu posao i ne treba da mu zatrpavaju navigaciju.
   */
  profiles?: UiProfile[];
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Pregled',
    items: [
      { to: '/', label: 'Početna', end: true, icon: 'home' },
      {
        to: '/kontrolni-centar', label: 'Kontrolni centar',
        permission: 'controls.view', icon: 'shield', profiles: ['admin'],
      },
      { to: '/obavestenja', label: 'Obaveštenja', icon: 'bell' },
    ],
  },
  {
    title: 'Evidencija',
    items: [
      {
        to: '/unos/novi', label: 'Novi unos',
        permission: 'entry.edit_draft', icon: 'plus', profiles: ['operator'],
      },
      {
        to: '/unos', label: 'Unos', end: true, permission: 'entry.view', icon: 'grid',
        alsoActiveOn: ['/unos/pregled'], profiles: ['operator'],
      },
      {
        to: '/moje-prijave', label: 'Moji unosi',
        permission: 'period.view_status', icon: 'clipboard', profiles: ['operator'],
      },
      {
        to: '/zaposleni', label: 'Zaposleni',
        permission: 'employee.view', icon: 'users', profiles: ['operator', 'admin'],
      },
    ],
  },
  {
    title: 'Stopovi kurira',
    items: [
      {
        to: '/stopovi-kurira', label: 'Unos stopova',
        permission: 'courier_stops.view', icon: 'truck', profiles: ['operator'],
      },
      {
        to: '/finansije/stopovi-kurira',
        label: 'Odobrenje stopova',
        permission: 'finance.queue.view',
        icon: 'check',
        profiles: ['finance'],
      },
    ],
  },
  {
    title: 'Finansije',
    items: [
      {
        to: '/finansije', label: 'Odobrenje obračuna', end: true,
        permission: 'finance.queue.view', icon: 'wallet', profiles: ['finance'],
      },
      {
        to: '/finansije/istorija', label: 'Istorija obračuna',
        permission: 'finance.history.view', icon: 'history', profiles: ['finance'],
      },
    ],
  },
  {
    title: 'Korekcije',
    items: [
      {
        to: '/dodatni-zahtevi', label: 'Moji zahtevi',
        permission: 'adjustment.create', icon: 'plus', profiles: ['operator'],
      },
      {
        to: '/finansije/dodatni-zahtevi',
        label: 'Odobrenje zahteva',
        permission: 'adjustment.approve',
        icon: 'check',
        profiles: ['finance'],
      },
    ],
  },
  {
    title: 'Analitika',
    items: [
      {
        to: '/analitika', label: 'Analitika',
        permission: 'analytics.ba.view', icon: 'chart', profiles: ['admin'],
      },
    ],
  },
  {
    title: 'Administracija',
    items: [
      {
        to: '/administracija', label: 'Administracija',
        permission: 'centers.manage', icon: 'settings', profiles: ['admin'],
      },
    ],
  },
];

/** Diskretne linijske ikonice — bez nove zavisnosti. */
const ICON_PATHS: Record<IconName, string> = {
  home: 'M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z',
  shield: 'M10 3l6 2.2v4.3c0 3.6-2.4 6.6-6 7.5-3.6-.9-6-3.9-6-7.5V5.2z',
  bell: 'M6 8a4 4 0 1 1 8 0c0 3 1.2 4.2 1.7 4.7H4.3C4.8 12.2 6 11 6 8zM8.4 15.4a1.8 1.8 0 0 0 3.2 0',
  grid: 'M3 4h14v12H3zM3 8h14M3 12h14M8 4v12M13 4v12',
  clipboard: 'M7.5 3.5h5v2h-5zM6 4.5H4.5v12h11v-12H14M7 9h6M7 12h4',
  users: 'M7.2 9.4a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM2.8 16.2c0-2.4 2-4 4.4-4s4.4 1.6 4.4 4M13 5.2a2.4 2.4 0 0 1 0 4.6M14.2 12.6c1.8.4 3 1.8 3 3.6',
  truck: 'M2.5 5.5h9v7h-9zM11.5 8.5h3l2.5 2.5v1.5h-5.5zM6 15a1.4 1.4 0 1 0 0-2.8A1.4 1.4 0 0 0 6 15zM14 15a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z',
  check: 'M16.5 5.5 8.2 14.4 3.9 10',
  wallet: 'M3.5 5.5h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM2.5 8.5h14M13 11.8h1.6',
  history: 'M10 5.5V10l2.8 1.8M3.6 8.2A6.6 6.6 0 1 1 3.4 11M3.2 5.2v3h3',
  plus: 'M10 4.5v11M4.5 10h11',
  chart: 'M3.5 16.5v-6M7.8 16.5V5.5M12.2 16.5v-8M16.5 16.5v-4',
  settings:
    'M10 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zM10 2.8l1 1.9 2.1-.4 1.2 1.8-1.2 1.8.9 1.9-1.8 1.2-.4 2.1H9.2l-.4-2.1-1.8-1.2.9-1.9L6.7 6.1l1.2-1.8 2.1.4z',
};

function NavIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function initials(name: string | undefined): string {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '··';
}

export function Layout() {
  const { session, signOut, apiKind, demoRates, can, api } = useAuth();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    let alive = true;

    const loadUnread = () => {
      void api
        .listNotifications()
        .then((items) => {
          if (alive) {
            setUnreadNotifications(items.filter((item) => !item.read_at).length);
          }
        })
        .catch(() => {
          // Badge ne sme da obori ceo shell ako obaveštenja trenutno nisu dostupna.
        });
    };

    loadUnread();
    window.addEventListener('focus', loadUnread);

    const timer = window.setInterval(loadUnread, 30000);

    return () => {
      alive = false;
      window.removeEventListener('focus', loadUnread);
      window.clearInterval(timer);
    };
  }, [api, pathname]);

  /**
   * Dvostruko sito, tim redom:
   *   1. ULOGA odlučuje koji se moduli uopšte nude;
   *   2. PERMISIJA odlučuje koja je stavka unutar njih dostupna.
   * Nalog sa nepoznatom ulogom prolazi samo kroz drugo sito, da mu se ništa ne
   * oduzme. Baza u svakom slučaju ponovo proverava svaki poziv.
   */
  const profile = useMemo(() => resolveProfile(session?.roles), [session?.roles]);

  const groups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter(
          (i) => isVisibleForProfile(profile, i.profiles) && (!i.permission || can(i.permission)),
        ),
      })).filter((g) => g.items.length > 0),
    [can, profile],
  );

  // Naslov u top baru se izvodi iz iste navigacione mape — bez nove rute.
  const current = useMemo(() => {
    const all = NAV_GROUPS.flatMap((g) => g.items);
    const match = all
      .filter((i) => (i.to === '/' ? pathname === '/' : pathname.startsWith(i.to)))
      .sort((a, b) => b.to.length - a.to.length)[0];
    return match?.label ?? 'WDR';
  }, [pathname]);

  const centers = session?.centers.map((c) => c.center_code).join(', ') ?? '';
  const role = session?.roles?.join(' · ') || 'Bez uloge';

  return (
    <div className={collapsed ? 'app app-collapsed' : 'app'}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden>
            W
          </span>
          <span className="brand">
            WDR
            <span className="brand-sub">Evidencija rada</span>
          </span>
        </div>

        <nav className="sidebar-nav" aria-label="Glavna navigacija">
          {groups.map((g) => (
            <div className="nav-group" key={g.title}>
              <p className="nav-group-title">{g.title}</p>
              {g.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  title={n.label}
                  className={({ isActive }) =>
                    isActive || (n.alsoActiveOn ?? []).some((p) => pathname.startsWith(p))
                      ? 'active'
                      : ''
                  }
                >
                  <NavIcon name={n.icon} />
                  <span className="nav-label">{n.label}</span>
                  {n.to === '/obavestenja' && unreadNotifications > 0 && (
                    <span
                      className="notification-badge"
                      aria-label={`${unreadNotifications} nepročitanih obaveštenja`}
                    >
                      {unreadNotifications > 99 ? '99+' : unreadNotifications}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="user-card">
            <span className="user-avatar" aria-hidden>
              {initials(session?.full_name)}
            </span>
            <span className="user-id">
              <span className="user-name">{session?.full_name}</span>
              <span className="user-role">{role}</span>
            </span>
          </div>
          <button type="button" className="btn-signout" onClick={() => void signOut()}>
            <svg
              className="nav-icon"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 16.5H4.5v-13H8M12 13.5 15.5 10 12 6.5M15.5 10h-8" />
            </svg>
            <span>Odjava</span>
          </button>
        </div>
      </aside>

      <div className="app-body">
        <header className="app-header">
          <button
            type="button"
            className="topbar-toggle"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Proširi navigaciju' : 'Skupi navigaciju'}
            aria-expanded={!collapsed}
          >
            <svg
              viewBox="0 0 20 20"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M3 5.5h14M3 10h14M3 14.5h14" />
            </svg>
          </button>

          <span className="topbar-title">{current}</span>
          {centers && <span className="topbar-context">Centri: {centers}</span>}

          <div className="app-user">
            {apiKind === 'mock' && (
              <span className="chip chip-mock" title="Radi bez baze, preko mock adaptera">
                MOCK
              </span>
            )}
            {demoRates && (
              <span className="chip chip-warn" title="Prikazane stope su DEMO i nisu poslovni podaci">
                DEMO stope
              </span>
            )}
          </div>
        </header>

        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
