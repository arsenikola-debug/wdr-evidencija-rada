/**
 * Prezentacioni profil korisnika — izveden iz ULOGE, ne iz permisija.
 *
 * Zašto ne iz permisija: `SUPER_ADMIN_BA` po dizajnu nosi široka backend prava,
 * uključujući i ona koja pripadaju drugim funkcijama. Ako se početna strana i
 * navigacija biraju po permisijama, superadmin biva prikazan kao Finansije samo
 * zato što sme da pogleda red za odobrenje. Uloga je ta koja kaže ČIJI je ovo
 * posao; permisija kaže ŠTA taj neko sme da uradi.
 *
 * Granica je stroga i ide u jednom smeru:
 *   * uloga  -> koji se MODULI uopšte nude (čisto prezentaciono);
 *   * permisija -> koje su AKCIJE dostupne unutar modula;
 *   * baza / RLS -> konačna odluka, uvek i bez izuzetka.
 *
 * Sakriven modul nije kontrola pristupa. Server i dalje odbija svaki poziv za
 * koji korisnik nema pravo, bez obzira na to šta je prikazano.
 */

export type UiProfile = 'admin' | 'finance' | 'operator';

/**
 * Šifre uloga iz `seed.sql`. Namerno je mapiranje eksplicitno i kratko: svaka
 * nova uloga se svesno dodaje ovde, a dok se ne doda ponaša se kao nepoznata
 * (vidi `unmapped` ispod) i ničim nije uskraćena.
 */
const ROLE_TO_PROFILE: Record<string, UiProfile> = {
  SUPER_ADMIN_BA: 'admin',
  FINANCE: 'finance',
  DATA_ENTRY_OPERATOR: 'operator',
};

/** Redosled kada korisnik nosi više uloga — određuje IZGLED početne strane. */
const PROFILE_PRIORITY: UiProfile[] = ['admin', 'finance', 'operator'];

export interface ProfileResolution {
  /** Svi prepoznati profili korisnika. Više uloga = unija modula. */
  profiles: Set<UiProfile>;
  /** Profil koji određuje početnu stranu. `null` kada nijedna uloga nije poznata. */
  primary: UiProfile | null;
  /**
   * `true` SAMO kada nalog nema nijednu prepoznatu ulogu.
   *
   * Tada se navigacija ne sužava po profilu nego se vraća na čistu proveru
   * permisija: nepoznata uloga ne sme da znači prazan ekran.
   *
   * Namerno NIJE dovoljno da postoji nepoznata uloga. Nalog `['FINANCE',
   * 'REVIZOR']` je i dalje Finance — da nije tako, jedna nepoznata uloga bi
   * poništila celo profilno filtriranje i vratila širu navigaciju nego što joj
   * pripada. To je upravo problem zbog kojeg profil i postoji.
   */
  unmapped: boolean;

  /**
   * Uloge koje ovaj modul ne poznaje. Ne utiču na filtriranje kada postoji bar
   * jedan poznat profil; izdvojene su da ih dijagnostika može prijaviti.
   */
  unknownRoles: string[];
}

export function resolveProfile(roles: readonly string[] | undefined | null): ProfileResolution {
  const list = roles ?? [];
  const profiles = new Set<UiProfile>();
  const unknownRoles: string[] = [];

  for (const role of list) {
    const mapped = ROLE_TO_PROFILE[role];
    if (mapped) profiles.add(mapped);
    else unknownRoles.push(role);
  }

  const primary = PROFILE_PRIORITY.find((p) => profiles.has(p)) ?? null;

  return {
    profiles,
    primary,
    // Fallback na permisije samo kada NIJEDNA uloga nije prepoznata.
    unmapped: profiles.size === 0,
    unknownRoles,
  };
}

/**
 * Da li se stavka navigacije nudi ovom korisniku.
 *
 * Stavka bez `itemProfiles` pripada svima. Kada nalog ima nepoznatu ulogu,
 * profil se ignoriše i odlučuje samo permisija.
 */
export function isVisibleForProfile(
  resolution: ProfileResolution,
  itemProfiles: readonly UiProfile[] | undefined,
): boolean {
  if (!itemProfiles || itemProfiles.length === 0) return true;
  // Bez ijednog prepoznatog profila odlučuje isključivo permisija.
  if (resolution.unmapped) return true;
  return itemProfiles.some((p) => resolution.profiles.has(p));
}
