import { localizeIsoDates } from '../../lib/format/date';
/**
 * Database messages are written for an operator, but they contain UUIDs and
 * technical detail. The grid shows these instead, keyed by the named codes the
 * RPCs raise (see docs/RPC-CONTRACTS.md).
 */
const MESSAGES: Record<string, string> = {
  // --- Admin → Korisnici (0076 + Edge Function wdr-admin-users) -------------
  USER_ALREADY_EXISTS: 'Korisnik sa ovim emailom već postoji. Otvorite ga i izmenite pristup.',
  ADMIN_EMAIL_ALREADY_LINKED: 'Korisnik sa ovim emailom već postoji.',
  ADMIN_INVALID_EMAIL: 'Email nije ispravnog oblika.',
  ADMIN_INVALID_FULL_NAME: 'Ime i prezime su obavezni (najviše 120 znakova ukupno).',
  ADMIN_ROLE_REQUIRED: 'Korisniku mora biti dodeljena bar jedna uloga.',
  ADMIN_UNKNOWN_ROLE: 'Izabrana uloga više ne postoji. Osvežite stranicu.',
  ADMIN_UNKNOWN_CENTER: 'Izabrani centar ne postoji. Osvežite stranicu.',
  ADMIN_CENTER_INACTIVE: 'Pristup se ne dodeljuje neaktivnom centru.',
  ADMIN_OVERRIDE_REASON_REQUIRED: 'Svaki izuzetak prava zahteva obrazloženje (najmanje 10 znakova).',
  ADMIN_LAST_ADMIN: 'Izmena bi ostavila sistem bez ijednog aktivnog administratora.',
  ADMIN_SELF_LOCKOUT: 'Ne možete sebi oduzeti pravo upravljanja korisnicima.',
  ADMIN_SELF_DEACTIVATE: 'Ne možete deaktivirati sopstveni nalog.',
  ADMIN_USER_NOT_FOUND: 'Korisnik ne postoji. Osvežite stranicu.',
  AUTH_USER_MISSING: 'Auth nalog ovog korisnika ne postoji u Supabase-u.',
  ADMIN_USERS_FN_UNAVAILABLE:
    'Server funkcija za upravljanje korisnicima (wdr-admin-users) nije dostupna ili nije deployovana.',
  ADMIN_USERS_FN_ERROR: 'Server funkcija za korisnike je vratila neočekivanu grešku.',
  ORIGIN_NOT_ALLOWED: 'Ova adresa aplikacije nije dozvoljena za administraciju korisnika (WDR_ALLOWED_ORIGINS).',
  DB_MIGRATION_MISSING: 'Migracija 0076 još nije primenjena na bazu.',
  AUTH_BAN_FAILED: 'Blokada prijave u Supabase Auth-u nije uspela.',
  AUTH_UNBAN_FAILED: 'Skidanje blokade prijave u Supabase Auth-u nije uspelo. Korisnik nije aktiviran.',
  UNAUTHENTICATED: 'Sesija je istekla. Prijavite se ponovo.',
  PROFILE_INACTIVE: 'Nalog je deaktiviran. Obratite se administratoru.',
  CONFIG_MISSING: 'Server funkcija za korisnike nije potpuno podešena (Supabase tajne).',
  // --- privremena lozinka / promena lozinke (0076, bez emaila) -------------
  AUTH_USER_EXISTS_UNLINKED:
    'Supabase Auth nalog sa ovim emailom već postoji, ali nije povezan sa WDR profilom.',
  ADMIN_USER_INACTIVE: 'Korisnik je deaktiviran. Prvo ga ponovo aktivirajte.',
  ADMIN_SELF_RESET: 'Sopstvenu lozinku menjate kroz „Promeni šifru", ne resetom.',
  ADMIN_RESET_PRIVILEGED_TARGET:
    'Ne možete resetovati lozinku korisniku koji ima prava koja vi nemate.',
  TEMP_PASSWORD_NOT_SET:
    'Privremena lozinka nije postavljena u Supabase Auth-u. Pokušajte „Generiši novu privremenu lozinku".',
  CURRENT_PASSWORD_REQUIRED: 'Unesite trenutnu (privremenu) lozinku.',
  CURRENT_PASSWORD_INVALID: 'Trenutna lozinka nije ispravna.',
  PASSWORD_TOO_SHORT: 'Nova lozinka mora imati najmanje 10 znakova.',
  PASSWORD_TOO_LONG: 'Nova lozinka je predugačka (najviše 72 bajta).',
  SAME_PASSWORD: 'Nova lozinka mora biti različita od trenutne.',
  PASSWORD_CONTAINS_EMAIL: 'Nova lozinka ne sme da sadrži vaš email (deo pre @).',
  WEAK_PASSWORD: 'Lozinka ne zadovoljava pravila jačine lozinke. Izaberite dužu i raznovrsniju lozinku.',
  PASSWORD_FLAG_NOT_CLEARED:
    'Lozinka je promenjena, ali potvrda nije zabeležena. Prijavite se novom lozinkom i ponovite promenu.',
  PROFILE_NOT_LINKED: 'Prijavljeni korisnik nema povezan WDR profil. Obratite se administratoru.',
  AUTH_RATE_LIMIT: 'Supabase Auth je privremeno ograničio zahteve. Pokušajte ponovo za nekoliko minuta.',
  AUTH_SERVICE_ONLY: 'Ovu radnju sme da izvrši samo server.',
  EMPLOYEE_NOT_IN_CENTER:
    'Zaposleni ne pripada ovom centru — koristite unos ispomoći.',
  FOREIGN_SEGMENT_PRESENT:
    'Dan sadrži ispomoć drugog centra. Taj centar prvo mora da je ukloni.',
  SEGMENT_OVERLAP: 'Smena se preklapa sa već unetom smenom istog dana.',
  ASSISTANCE_SEGMENT_CONFLICT:
    'Ispomoć za taj dan i smenu već postoji sa drugim troškovnim centrom.',
  CONFLICT_WORK_ABSENCE:
    'Dan je evidentiran kao odsustvo — prvo promenite status.',
  HOME_SUBMISSION_MISSING:
    'Matični centar zaposlenog nema otvoren period za taj datum.',
  TARGET_SUBMISSION_MISSING:
    'Ovaj centar nema prijavu za taj datum.',
  EMPLOYEE_NOT_ACTIVE_ON_DATE:
    'Zaposleni nije u radnom odnosu na taj dan.',
  EMPLOYEE_NOT_ASSIGNED_TO_CENTER:
    'Zaposleni nije raspoređen ni u jedan centar na taj dan.',
  COST_CENTER_OVERRIDE_DENIED:
    'Nemate pravo da trošak prebacite na drugi centar.',
  COST_CENTER_ACCESS_DENIED:
    'Nemate pravo pisanja za izabrani centar troška.',
  INVALID_SHIFT: 'Smena je predugačka ili neispravna.',
  MISSING_WORK_SEGMENT: 'Dan je označen kao rad, ali nema unetu smenu.',
  MISSING_COMPENSATION_RULE:
    'Pravilo obračuna nije konfigurisano — obratite se administratoru.',
  MISSING_TRANSPORT_RULE:
    'Pravilo prevoza nije konfigurisano — obratite se administratoru.',
  MISSING_PAYMENT_TYPE: 'Nije određena vrsta isplate za taj dan.',
  MISSING_TRANSPORT_ASSIGNMENT:
    'Za zaposlenog nema evidencije o prevozu (ni DA ni NE).',
  PERIOD_NOT_OPEN: 'Period je zatvoren za unos.',
  PERIOD_RANGE_REQUIRED: 'Period mora imati početni i krajnji datum.',
  PERIOD_RANGE_INVALID: 'Datum „do" ne sme biti pre datuma „od".',
  PERIOD_RANGE_TOO_LONG: 'Period može imati najviše 7 kalendarskih dana.',
  PERIOD_OVERLAPS_EXISTING:
    'Za taj centar već postoji prijava istog tipa (Karnet/Obuka) koja se preklapa sa izabranim rasponom.',
  // 0074 — KARNET i OBUKA su zasebne prijave.
  BASE_TYPE_REQUIRED: 'Izaberite Karnet ili Obuka — svaka ima svoju prijavu.',
  PERIOD_LEGACY_COMBINED:
    'Za ovaj period postoji stara zajednička prijava (Karnet + Obuka). Otvorite nju; nova se ne pravi preko nje.',
  SUBMISSION_BASE_TYPE_MISMATCH:
    'Taj dan pripada drugom osnovnom tipu (Karnet/Obuka) i unosi se u njegovoj prijavi.',
  SUBMISSION_BASE_TYPE_IMMUTABLE: 'Osnovni tip prijave se ne menja.',
  PERIOD_ALREADY_SUBMITTED:
    'Period za taj centar i raspon je već poslat finansijama. Nov unos se ne otvara.',
  PERIOD_LOCKED_APPROVED:
    'Period za taj centar i raspon je odobren i zaključan. Izmene idu kroz Korekcije.',
  PERIOD_STATUS_UNKNOWN:
    'Prijava za taj centar i raspon je u statusu koji ne dozvoljava nov unos.',
  CENTER_NOT_ALLOWED: 'Nemate pravo unosa za izabrani centar.',
  CENTER_INACTIVE: 'Centar ne postoji ili nije aktivan.',
  PERIOD_CREATE_RPC_MISSING:
    'Otvaranje perioda još nije aktivirano na serveru. Potrebno je primeniti predloženu migraciju.',
  SAVE_FAILED: 'Čuvanje nije uspelo. Podaci su još samo u pregledaču.',
  INCOMPLETE_EXPECTED_ENTRIES:
    'Nisu pregledani svi očekivani dani. Prazna ćelija znači „nije pregledano".',
  EXPECTED_DATES_NOT_CONFIGURED:
    'Očekivani radni dani za ovaj centar nisu konfigurisani. Obratite se administratoru.',
  EXPECTED_DATES_WINDOW_CLOSED:
    'Očekivani dani se više ne mogu menjati — period je poslat.',
  INCOMPLETE_OVERRIDE_DENIED: 'Nemate pravo da pošaljete nepotpun period.',
  SUBMIT_PATH_ENFORCED: 'Slanje je moguće samo kroz zvanični postupak.',
  SUBMISSION_METADATA_LOCKED:
    'Prijava je poslata i više se ne može menjati. Ispravka ide kroz vraćanje finansija.',
  ACK_WINDOW_CLOSED:
    'Upozorenja se potvrđuju pre slanja. Period je već poslat finansijama.',
  '42501': 'Nemate pravo za ovu akciju ili je period zaključan.',
  '23505': 'Zapis za taj dan već postoji.',
  '23503': 'Vrednost koju ste izabrali ne postoji.',
  '22023': 'Nedostaje obavezan podatak.',
  '23514': 'Unos nije u skladu sa poslovnim pravilom.',
  P0002: 'Traženi zapis ne postoji.',
  invalid_credentials: 'Neispravna e-adresa ili šifra.',
};

const LOCKED_HINTS = ['nije u stanju za izmenu', 'zakljucana', 'zaključana'];

export function messageForCode(
  code: string | null | undefined,
  fallback?: string,
): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (fallback) {
    if (LOCKED_HINTS.some((h) => fallback.toLowerCase().includes(h))) {
      return 'Period je zaključan za unos.';
    }
    // Never surface a raw message containing UUIDs to the operator.
    if (/[0-9a-f]{8}-[0-9a-f]{4}/.test(fallback)) {
      return 'Unos nije prihvaćen. Osvežite stranicu i pokušajte ponovo.';
    }
    // Poruka iz baze može sadržati ISO datum — prikazuje se u formatu 05.10.2026.
    return localizeIsoDates(fallback);
  }
  return 'Došlo je do neočekivane greške.';
}

/** Codes the operator can fix themselves; the rest need an administrator. */
export function isOperatorFixable(code: string | null | undefined): boolean {
  if (!code) return false;
  return [
    'SEGMENT_OVERLAP',
    'CONFLICT_WORK_ABSENCE',
    'MISSING_WORK_SEGMENT',
    'EMPLOYEE_NOT_IN_CENTER',
    'FOREIGN_SEGMENT_PRESENT',
    '22023',
  ].includes(code);
}
