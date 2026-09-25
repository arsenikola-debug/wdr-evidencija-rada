/**
 * Database messages are written for an operator, but they contain UUIDs and
 * technical detail. The grid shows these instead, keyed by the named codes the
 * RPCs raise (see docs/RPC-CONTRACTS.md).
 */
const MESSAGES: Record<string, string> = {
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
  PERIOD_RANGE_TOO_LONG: 'Raspon je duži od 62 dana. Podelite ga na više perioda.',
  PERIOD_OVERLAPS_EXISTING:
    'Za taj centar već postoji prijava koja se preklapa sa izabranim rasponom.',
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
    return fallback;
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
