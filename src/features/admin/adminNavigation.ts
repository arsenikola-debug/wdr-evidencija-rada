/**
 * Administracija — grupe i moduli (samo navigacija).
 *
 * Ništa se ne menja u pravima: modul je vidljiv tačno onda kada je bio dostupan i
 * pre (ista permisija kao njegova ruta). Sekcije stranice `/administracija`
 * (bivši tabovi) i dalje zahtevaju `centers.manage`; upis u njima i dalje
 * kontrolišu `cfg.can.*` zastavice sa servera.
 *
 * Landing `/administracija` otvara svako ko vidi BAR JEDAN modul (canEnterAdmin)
 * i prikazuje samo njegove module — npr. korisnik sa users.manage bez
 * centers.manage vidi samo „Korisnici".
 *
 * Deep linkovi: zasebne rute (`/administracija/korisnici`, `/zaposleni`,
 * `/administracija/uvoz-zaposlenih`, `/administracija/dodatne-isplate`) su iste;
 * sekcije stranice dobijaju link `/administracija?modul=<ključ>`.
 */

/** Sekcije koje žive na stranici /administracija (ranije horizontalni tabovi). */
export type AdminSectionKey =
  | 'centri' | 'smene' | 'statusi' | 'kalendar'
  | 'isplate' | 'naknade' | 'stopovi'
  | 'prevoznici' | 'prevoz'
  | 'kontrole' | 'spremnost';

export const ADMIN_PAGE_PATH = '/administracija';
/** Pravo za sekcije stranice /administracija (Centri, Smene, …) — nepromenjeno. */
export const ADMIN_PAGE_PERMISSION = 'centers.manage';

interface ModuleBase { label: string; description: string }
export interface SectionModule extends ModuleBase { kind: 'section'; key: AdminSectionKey }
export interface RouteModule extends ModuleBase { kind: 'route'; key: string; to: string; permission: string }
export type AdminModule = SectionModule | RouteModule;

export interface AdminGroup {
  key: 'ljudi' | 'organizacija' | 'obracun' | 'prevoz' | 'sistem';
  title: string;
  description: string;
  modules: AdminModule[];
}

/** Redosled = učestalost korišćenja: ljudi prvo, sistem poslednji. */
export const ADMIN_GROUPS: readonly AdminGroup[] = [
  {
    key: 'ljudi',
    title: 'Korisnici i zaposleni',
    description: 'Nalozi za prijavu u WDR, evidencija zaposlenih i masovni uvoz.',
    modules: [
      { kind: 'route', key: 'korisnici', label: 'Korisnici', to: '/administracija/korisnici', permission: 'users.manage',
        description: 'Nalozi, dodela postojećih uloga i centara, privremena lozinka, aktivnost.' },
      { kind: 'route', key: 'zaposleni', label: 'Zaposleni', to: '/zaposleni', permission: 'employee.view',
        description: 'Lista zaposlenih, profili, centri i radni odnos.' },
      { kind: 'route', key: 'uvoz-zaposlenih', label: 'Uvoz zaposlenih', to: '/administracija/uvoz-zaposlenih',
        permission: 'centers.manage', description: 'Uvoz i povezivanje zaposlenih iz spoljnog spiska.' },
    ],
  },
  {
    key: 'organizacija',
    title: 'Organizacija rada',
    description: 'Centri, smene, statusi evidencije i radni kalendar.',
    modules: [
      { kind: 'section', key: 'centri', label: 'Centri', description: 'Centri i njihov status.' },
      { kind: 'section', key: 'smene', label: 'Smene', description: 'Šabloni smena (početak i kraj).' },
      { kind: 'section', key: 'statusi', label: 'Statusi evidencije', description: 'Statusi prisustva i njihovo ponašanje u obračunu.' },
      { kind: 'section', key: 'kalendar', label: 'Radni kalendar', description: 'Obrasci očekivanih radnih dana po centru.' },
    ],
  },
  {
    key: 'obracun',
    title: 'Obračun',
    description: 'Vrste isplata, tarife, pravila naknada i cene po stopu.',
    modules: [
      { kind: 'section', key: 'isplate', label: 'Vrste isplata', description: 'Vrste isplata i način obračuna.' },
      { kind: 'route', key: 'tarife-dodatnih-isplata', label: 'Tarife dodatnih isplata',
        to: '/administracija/dodatne-isplate', permission: 'payout.cutover.manage',
        description: 'Tarife i prelazak na nove dodatne isplate.' },
      { kind: 'section', key: 'naknade', label: 'Pravila naknada', description: 'Iznosi naknada sa periodom važenja.' },
      { kind: 'section', key: 'stopovi', label: 'Cene po stopu', description: 'Cena po stopu po centru, sa istorijom.' },
    ],
  },
  {
    key: 'prevoz',
    title: 'Prevoz',
    description: 'Prevoznici, odgovorna lica i pravila prevoza.',
    modules: [
      { kind: 'section', key: 'prevoznici', label: 'Prevoznici i odgovorna lica', description: 'Prevoznici i lica odgovorna za prevoz.' },
      { kind: 'section', key: 'prevoz', label: 'Pravila prevoza', description: 'Pravila i iznosi prevoza sa periodom važenja.' },
    ],
  },
  {
    key: 'sistem',
    title: 'Sistem',
    description: 'Kontrolna pravila i spremnost sistema.',
    modules: [
      { kind: 'section', key: 'kontrole', label: 'Kontrolna pravila', description: 'Pragovi i uključenost kontrolnih pravila.' },
      { kind: 'section', key: 'spremnost', label: 'Spremnost sistema', description: 'Pregled konfiguracije, podataka i obaveznih provera.' },
    ],
  },
];

export const ADMIN_SECTION_KEYS: readonly AdminSectionKey[] = ADMIN_GROUPS
  .flatMap((g) => g.modules).filter((m): m is SectionModule => m.kind === 'section').map((m) => m.key);

/** Isto pravilo kao pre: sekcija ↔ pravo stranice, ruta ↔ pravo te rute. */
export function moduleVisible(m: AdminModule, can: (permission: string) => boolean): boolean {
  return m.kind === 'section' ? can(ADMIN_PAGE_PERMISSION) : can(m.permission);
}

/** Grupe sa samo vidljivim modulima; grupa bez ijednog vidljivog modula se ne prikazuje. */
export function visibleAdminGroups(can: (permission: string) => boolean): AdminGroup[] {
  return ADMIN_GROUPS
    .map((g) => ({ ...g, modules: g.modules.filter((m) => moduleVisible(m, can)) }))
    .filter((g) => g.modules.length > 0);
}

/** `?modul=` → poznata sekcija ili null (landing). Nepoznata vrednost ne ruši stranicu. */
export function parseSectionParam(value: string | null): AdminSectionKey | null {
  return value && (ADMIN_SECTION_KEYS as readonly string[]).includes(value) ? (value as AdminSectionKey) : null;
}

export function groupOfSection(key: AdminSectionKey): AdminGroup {
  return ADMIN_GROUPS.find((g) => g.modules.some((m) => m.kind === 'section' && m.key === key))!;
}

export function moduleHref(m: AdminModule): string {
  return m.kind === 'section' ? adminSectionHref(m.key) : m.to;
}

/** Deep link na sekciju stranice Administracija (npr. iz Home-a). */
export function adminSectionHref(key: AdminSectionKey): string {
  return `${ADMIN_PAGE_PATH}?modul=${key}`;
}

/**
 * Prava koja otvaraju landing Administracije: tačno prava modula iz grupa
 * (izvedeno, ne ručno pisano) — bez ijednog novog prava.
 */
export const ADMIN_ENTRY_PERMISSIONS: readonly string[] = [...new Set(ADMIN_GROUPS.flatMap((g) =>
  g.modules.map((m) => (m.kind === 'section' ? ADMIN_PAGE_PERMISSION : m.permission))))].sort();

/** Ulaz u landing: bar jedan vidljiv modul. Ne daje pristup ničemu što modul već ne dozvoljava. */
export function canEnterAdmin(can: (permission: string) => boolean): boolean {
  return visibleAdminGroups(can).length > 0;
}
