import type { AdminConfig, BehaviorCatalogItem } from '../../lib/api/types';

/**
 * Pure rules for the Admin screens.
 *
 * The point of these helpers is that the UI can only ever offer what the engine
 * actually understands: behaviors come from the server catalog, never from a
 * hardcoded list, and unsupported transport models are not offered at all.
 */

/** Behaviors valid for a PRIMARY or COMPONENT payment type. */
export function behaviorsForKind(
  catalog: BehaviorCatalogItem[],
  kind: 'PRIMARY' | 'COMPONENT',
): BehaviorCatalogItem[] {
  return catalog.filter((b) => b.kind === kind).sort((a, b) => a.sort_order - b.sort_order);
}

/** A behavior the server did not send is not offerable — no invented arithmetic. */
export function isBehaviorSupported(catalog: BehaviorCatalogItem[], key: string): boolean {
  return catalog.some((b) => b.behavior_key === key);
}

/** Q22: only priceable transport models may appear as options. */
export function transportRuleOptions(cfg: Pick<AdminConfig, 'transport_rule_types_allowed'>) {
  const labels: Record<string, string> = {
    PER_ELIGIBLE_WORKED_DAY: 'Po employee-danu sa pravom',
    LITERS_PER_EMPLOYEE_DAY: 'Litri × cena goriva po employee-danu',
  };
  return cfg.transport_rule_types_allowed.map((t) => ({ value: t, label: labels[t] ?? t }));
}

/** What may still be edited on an existing row, and what has become history. */
export function editableFields(row: { in_use: boolean }): {
  code: boolean;
  behavior: boolean;
  presentation: boolean;
} {
  return {
    // A code that reached an approved snapshot must keep meaning the same thing.
    code: !row.in_use,
    // Behavior is identity: never editable after creation.
    behavior: false,
    presentation: true,
  };
}

export function isSensitivePermission(cfg: AdminConfig, code: string): boolean {
  return cfg.sensitive_permissions.includes(code);
}

/** Serbian labels for ISO weekdays 1..7 (Monday first). */
export const WEEKDAY_LABELS = ['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned'];

export function weekdayPatternLabel(weekdays: number[]): string {
  if (weekdays.length === 0) return '—';
  return [...weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d - 1]).join(', ');
}

/**
 * What a user-access save will actually send.
 *
 * `rpc_admin_set_user_access` has REPLACEMENT semantics for any non-null array:
 * sending one role or one center silently removes the rest. So the editor always
 * works with the full intended set, and this helper makes that explicit —
 * including the rule that roles are omitted entirely (null = leave alone) when
 * the caller may not manage roles.
 */
export function userAccessPayload(input: {
  profileId: string;
  active: boolean;
  roles: string[];
  centers: Array<{ code: string; write: boolean }>;
  canManageRoles: boolean;
  /**
   * Stanje editora izuzetaka. `undefined` znači „editor nije učitan" — a to NIJE
   * isto što i „korisnik nema izuzetke". Prazna lista je legitimna namera
   * (obrisati sve izuzetke) i samo ona se šalje kao prazan niz.
   */
  overrides?: PermissionOverrideDraft[];
}): {
  profile_id: string;
  active: boolean;
  role_codes: string[] | null;
  center_access: Array<{ center_code: string; can_write: boolean }>;
  permission_overrides: Array<{
    permission_code: string; mode: OverrideMode; reason: string | null;
  }> | null;
} {
  return {
    profile_id: input.profileId,
    active: input.active,
    role_codes: input.canManageRoles ? input.roles : null,
    center_access: input.centers.map((c) => ({
      center_code: c.code,
      can_write: c.write,
    })),
    // Bez `roles.manage` server ionako odbija izmenu izuzetaka; slanje praznog
    // niza bi, zbog semantike zamene, obrisalo tuđe izuzetke. Zato null.
    permission_overrides:
      input.canManageRoles && input.overrides !== undefined
        ? intendedOverrides(input.overrides)
        : null,
  };
}

/** GRANT / REVOKE / bez izuzetka — jedini oblici koje server razume. */
export type OverrideMode = 'GRANT' | 'REVOKE';
export type OverrideChoice = 'NONE' | OverrideMode;

export interface PermissionOverrideDraft {
  permission_code: string;
  choice: OverrideChoice;
  reason: string;
}

export interface PermissionOverrideRow extends PermissionOverrideDraft {
  name: string;
  area: string;
  sensitive: boolean;
  /** Šta je na serveru pre izmene — da se vidi šta se tačno menja. */
  server_choice: OverrideChoice;
}

/**
 * Početno stanje editora se gradi iz SERVERSKOG stanja, nikada iz praznog
 * lokalnog podrazumevanog. Isti princip koji već važi za role i centre:
 * `rpc_admin_set_user_access` zamenjuje ceo skup, pa editor mora da vidi sve
 * što bi njegovo čuvanje moglo da obriše.
 */
export function overrideEditorRows(
  permissions: Array<{ code: string; name: string; area: string }>,
  user: {
    permission_overrides: Array<{
      permission_code: string; mode: string; reason: string | null;
    }>;
  } | undefined,
  sensitivePermissions: string[],
): PermissionOverrideRow[] {
  const existing = new Map(
    (user?.permission_overrides ?? []).map((o) => [o.permission_code, o]),
  );

  const rows: PermissionOverrideRow[] = permissions.map((p) => {
    const cur = existing.get(p.code);
    const choice: OverrideChoice =
      cur?.mode === 'GRANT' || cur?.mode === 'REVOKE' ? cur.mode : 'NONE';
    return {
      permission_code: p.code,
      name: p.name,
      area: p.area,
      sensitive: sensitivePermissions.includes(p.code),
      choice,
      reason: cur?.reason ?? '',
      server_choice: choice,
    };
  });

  // Izuzetak za permisiju koje nema u katalogu se NE gubi tiho: prikazuje se,
  // pa administrator vidi (i može da ukloni) ono što bi inače nestalo.
  const known = new Set(permissions.map((p) => p.code));
  for (const o of user?.permission_overrides ?? []) {
    if (known.has(o.permission_code)) continue;
    const choice: OverrideChoice =
      o.mode === 'GRANT' || o.mode === 'REVOKE' ? o.mode : 'NONE';
    rows.push({
      permission_code: o.permission_code,
      name: o.permission_code,
      area: 'nepoznato',
      sensitive: sensitivePermissions.includes(o.permission_code),
      choice,
      reason: o.reason ?? '',
      server_choice: choice,
    });
  }

  return rows;
}

/** PUN nameravani skup: sve što nije „bez izuzetka". */
export function intendedOverrides(
  rows: PermissionOverrideDraft[],
): Array<{ permission_code: string; mode: OverrideMode; reason: string | null }> {
  return rows
    .filter((r) => r.choice !== 'NONE')
    .map((r) => ({
      permission_code: r.permission_code,
      mode: r.choice as OverrideMode,
      reason: r.reason.trim() === '' ? null : r.reason.trim(),
    }));
}

/** Minimalna dužina obrazloženja za GRANT/REVOKE. */
export const OVERRIDE_REASON_MIN = 10;

/**
 * Izuzetak bez obrazloženja je izuzetak koji za pola godine niko ne ume da
 * objasni. Zato je obrazloženje uslov čuvanja, ne preporuka.
 */
export function overrideProblems(rows: PermissionOverrideDraft[]): string[] {
  return rows
    .filter((r) => r.choice !== 'NONE' && r.reason.trim().length < OVERRIDE_REASON_MIN)
    .map((r) => `Izuzetak ${r.permission_code} zahteva obrazloženje `
      + `(najmanje ${OVERRIDE_REASON_MIN} znakova).`);
}

/** Which of the changes being saved widen access in a way worth confirming. */
export function sensitiveChanges(input: {
  currentRoles: string[];
  nextRoles: string[];
  sensitivePermissions: string[];
  nextOverrides: Array<{ permission_code: string; mode: string }>;
  /** Šta je već bilo dodeljeno — potvrda se traži samo za NOVO širenje prava. */
  currentOverrides?: Array<{ permission_code: string; mode: string }>;
  currentCenters?: Array<{ code: string; write: boolean }>;
  nextCenters?: Array<{ code: string; write: boolean }>;
  privilegedRoles?: string[];
}): string[] {
  const privileged = input.privilegedRoles ?? ['SUPER_ADMIN_BA', 'FINANCE'];
  const out: string[] = [];

  for (const r of input.nextRoles) {
    if (!input.currentRoles.includes(r) && privileged.includes(r)) {
      out.push(`Dodaje se privilegovana uloga ${r}.`);
    }
  }

  const alreadyGranted = new Set(
    (input.currentOverrides ?? [])
      .filter((o) => o.mode === 'GRANT')
      .map((o) => o.permission_code),
  );
  for (const o of input.nextOverrides) {
    // REVOKE sužava prava — to nije širenje i ne traži potvrdu.
    if (o.mode !== 'GRANT') continue;
    if (!input.sensitivePermissions.includes(o.permission_code)) continue;
    if (alreadyGranted.has(o.permission_code)) continue;
    out.push(`Dodeljuje se osetljiva permisija ${o.permission_code}.`);
  }

  // Širenje pristupa centrima je relevantno samo kada se stvarno širi.
  if (input.nextCenters) {
    const before = new Map((input.currentCenters ?? []).map((c) => [c.code, c.write]));
    for (const c of input.nextCenters) {
      if (!before.has(c.code)) {
        out.push(`Dodaje se pristup centru ${c.code}${c.write ? ' sa pravom upisa' : ''}.`);
      } else if (c.write && before.get(c.code) === false) {
        out.push(`Centar ${c.code} dobija pravo upisa.`);
      }
    }
  }

  return out;
}
