import type {
  EligibilityLockReason,
  EntryEligibility,
  IsoDate,
  Uuid,
} from '../../lib/api/types';
import { cellKey } from './model';

/**
 * Indeks dozvoljenih dana (api.rpc_get_entry_eligibility, 0059).
 *
 * Ovo je POMOĆ operateru, ne bezbednosna granica: baza i dalje odbija unos na
 * dan kada zaposleni nije u radnom odnosu ili nije raspoređen u centar prijave
 * (tg_work_entry_validate). Kada eligibility nije dostupan (stariji server,
 * greška mreže), ništa se ne zaključava i odluka ostaje serveru.
 */
export interface EligibilityIndex {
  available: boolean;
  locked: Map<string, EligibilityLockReason>;
  /** Osnovni tip po ćeliji (KARNET/OBUKA/…), samo za dozvoljene dane. */
  typeByKey: Map<string, string | null>;
  /** Zaposleni kojima se osnovni tip menja unutar perioda. */
  typeChanges: Map<Uuid, Array<{ from: IsoDate; code: string | null }>>;
}

export const EMPTY_ELIGIBILITY: EligibilityIndex = {
  available: false,
  locked: new Map(),
  typeByKey: new Map(),
  typeChanges: new Map(),
};

export const LOCK_REASON_TEXT: Record<EligibilityLockReason, string> = {
  NOT_EMPLOYED: 'zaposleni tog dana nije u radnom odnosu',
  NO_ASSIGNMENT: 'zaposleni tog dana nije raspoređen ni u jedan centar',
  OTHER_CENTER: 'zaposleni je tog dana raspoređen u drugi centar',
};

export function buildEligibilityIndex(e: EntryEligibility | null): EligibilityIndex {
  if (!e) return EMPTY_ELIGIBILITY;
  const locked = new Map<string, EligibilityLockReason>();
  const typeByKey = new Map<string, string | null>();
  const byEmployee = new Map<Uuid, Array<{ date: IsoDate; code: string | null }>>();

  for (const d of e.days) {
    const key = cellKey(d.employee_id, d.work_date);
    if (!d.eligible) {
      locked.set(key, d.lock_reason ?? 'NO_ASSIGNMENT');
      continue;
    }
    typeByKey.set(key, d.payment_type_code);
    const list = byEmployee.get(d.employee_id) ?? [];
    list.push({ date: d.work_date, code: d.payment_type_code });
    byEmployee.set(d.employee_id, list);
  }

  const typeChanges = new Map<Uuid, Array<{ from: IsoDate; code: string | null }>>();
  for (const [emp, list] of byEmployee) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const runs: Array<{ from: IsoDate; code: string | null }> = [];
    for (const x of sorted) {
      if (runs.length === 0 || runs[runs.length - 1].code !== x.code) {
        runs.push({ from: x.date, code: x.code });
      }
    }
    if (runs.length > 1) typeChanges.set(emp, runs);
  }

  return { available: true, locked, typeByKey, typeChanges };
}

export function isLocked(idx: EligibilityIndex, key: string): boolean {
  return idx.locked.has(key);
}

// ---------------------------------------------------------------------------
// K1 — Karnet i Obuka su dve SEKCIJE iste prijave (centar × period)
// ---------------------------------------------------------------------------

export type UiLockReason = EligibilityLockReason | 'OTHER_TYPE';

export const BASE_TYPES = ['KARNET', 'OBUKA'] as const;
export type BaseType = (typeof BASE_TYPES)[number] | 'OSTALO';

export function lockReasonText(r: UiLockReason, baseType?: string | null): string {
  if (r === 'OTHER_TYPE') {
    return `zaposleni tog dana nije ${baseType === 'OBUKA' ? 'na Obuci' : baseType === 'KARNET' ? 'na Karnetu' : 'u ovoj sekciji'}`;
  }
  return LOCK_REASON_TEXT[r];
}

function inSection(code: string | null | undefined, baseType: BaseType): boolean {
  if (baseType === 'OSTALO') return !(BASE_TYPES as readonly string[]).includes(code ?? '');
  return code === baseType;
}

/**
 * Sekcija tipa: dan čiji je osnovni tip (po raspodeli NA TAJ DAN) drugačiji od
 * izabrane sekcije je zaključan u toj sekciji. Primer: Karnet pon–uto, Obuka od
 * srede → u Karnet sekciji sreda–nedelja zaključani, u Obuka pon–uto zaključani.
 * Bez eligibility podataka ništa se ne zaključava (odluka ostaje serveru).
 */
export function applyBaseType(idx: EligibilityIndex, baseType: BaseType | null): EligibilityIndex {
  if (!idx.available || !baseType) return idx;
  const locked = new Map(idx.locked) as Map<string, EligibilityLockReason>;
  for (const [key, code] of idx.typeByKey) {
    if (!inSection(code, baseType)) locked.set(key, 'OTHER_TYPE' as EligibilityLockReason);
  }
  return { ...idx, locked };
}

/** Zaposleni koji u sekciji imaju bar jedan dostupan dan (redosled se čuva). */
export function employeesInSection<T extends { employee_id: Uuid }>(
  idx: EligibilityIndex, employees: T[], baseType: BaseType | null, dates: IsoDate[],
): T[] {
  if (!idx.available || !baseType) return employees;
  return employees.filter((e) => dates.some((d) => {
    const key = cellKey(e.employee_id, d);
    return idx.typeByKey.has(key) && inSection(idx.typeByKey.get(key), baseType);
  }));
}

export function sectionCounts<T extends { employee_id: Uuid }>(
  idx: EligibilityIndex, employees: T[], dates: IsoDate[],
): Record<BaseType, number> {
  return {
    KARNET: employeesInSection(idx, employees, 'KARNET', dates).length,
    OBUKA: employeesInSection(idx, employees, 'OBUKA', dates).length,
    OSTALO: employeesInSection(idx, employees, 'OSTALO', dates).length,
  };
}
