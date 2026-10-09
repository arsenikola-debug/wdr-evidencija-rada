import type { UiProfile } from '../features/auth/profile';

/**
 * Navigacija aplikacije (izdvojeno iz Layout-a radi testiranja).
 * `permission` preslikava app.has_perm(); baza sprovodi pristup — ovde se samo
 * ne prikazuje link koji bi svakako pao. `profiles` je prezentaciona relevantnost.
 *
 * Završne korekcije (2026-10-01):
 *   • nema zasebnog „Stopovi kurira → Unos stopova": Stopovi su deo Dodatnih
 *     isplata (Dodatne isplate → + Novi zahtev → Stopovi); ruta /stopovi-kurira
 *     i ceo modul ostaju (deep-linkovi rade), Finansije zadržavaju odobrenje stopova;
 *   • „Uvoz zaposlenih" (i Zaposleni, Tarife) su u grupi Administracija, ne Analitika.
 */
export type IconName =
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

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  permission?: string;
  icon: IconName;
  /** Podrute koje i dalje pripadaju ovoj stavci (npr. /unos/pregled -> Unos). */
  alsoActiveOn?: string[];
  /** Kojim ULOGAMA ovaj modul pripada. Izostavljeno = svima. */
  profiles?: UiProfile[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
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
        to: '/unos', label: 'Unos', end: true, permission: 'entry.view', icon: 'grid',
        alsoActiveOn: ['/unos/pregled'], profiles: ['operator'],
      },
      {
        // Stopovi su jedna od vrsta Dodatnih isplata (i dalje na /stopovi-kurira).
        to: '/dodatne-isplate', label: 'Dodatne isplate',
        permission: 'payout.create', icon: 'plus', profiles: ['operator'],
        alsoActiveOn: ['/stopovi-kurira'],
      },
      {
        to: '/moje-prijave', label: 'Moji unosi',
        permission: 'period.view_status', icon: 'clipboard', profiles: ['operator'],
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
        // Objedinjeno: sve dodatne isplate + Stopovi (detalji na postojećim rutama).
        to: '/finansije/dodatne-isplate', label: 'Dodatne isplate',
        permission: 'finance.queue.view', icon: 'check', profiles: ['finance'],
        alsoActiveOn: ['/finansije/stopovi-kurira'],
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
        to: '/korekcije', label: 'Korekcije obračuna',
        permission: 'adjustment.create', icon: 'history', profiles: ['operator'],
      },
      {
        to: '/finansije/korekcije', label: 'Odobrenje korekcija',
        permission: 'adjustment.approve', icon: 'check', profiles: ['finance'],
      },
      {
        to: '/finansije/dodatni-zahtevi', label: 'Odobrenje zahteva',
        permission: 'adjustment.approve', icon: 'check', profiles: ['finance'],
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
      {
        to: '/administracija/izvestaji', label: 'Izveštaji isplata',
        permission: 'analytics.ba.view', icon: 'history', profiles: ['admin'],
      },
    ],
  },
  {
    title: 'Administracija',
    items: [
      {
        // Centri, pravila osnovnih naknada, korisnici i ostala podešavanja.
        to: '/administracija', label: 'Administracija', end: true,
        permission: 'centers.manage', icon: 'settings', profiles: ['admin'],
      },
      {
        // Kreiranje/poziv, uloge, centri, (de)aktivacija — 0076 + Edge Function.
        to: '/administracija/korisnici', label: 'Korisnici',
        permission: 'users.manage', icon: 'users', profiles: ['admin'],
      },
      {
        to: '/zaposleni', label: 'Zaposleni',
        permission: 'employee.view', icon: 'users', profiles: ['admin'],
      },
      {
        to: '/administracija/uvoz-zaposlenih', label: 'Uvoz zaposlenih',
        permission: 'centers.manage', icon: 'users', profiles: ['admin'],
      },
      {
        to: '/administracija/dodatne-isplate', label: 'Tarife dodatnih isplata',
        permission: 'payout.cutover.manage', icon: 'wallet', profiles: ['admin'],
      },
    ],
  },
];
