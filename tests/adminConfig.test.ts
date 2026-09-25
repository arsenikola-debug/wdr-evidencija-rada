import { describe, expect, it } from 'vitest';
import {
  behaviorsForKind,
  sensitiveChanges,
  userAccessPayload,
  editableFields,
  isBehaviorSupported,
  isSensitivePermission,
  transportRuleOptions,
  weekdayPatternLabel,
} from '../src/features/admin/config';
import type { AdminConfig, BehaviorCatalogItem } from '../src/lib/api/types';

const catalog: BehaviorCatalogItem[] = [
  { behavior_key: 'PRIMARY_DAILY', name: 'Osnovna dnevna naknada', description: '',
    kind: 'PRIMARY', sort_order: 10 },
  { behavior_key: 'OVERTIME_HOURS', name: 'Prekovremeni sati', description: '',
    kind: 'COMPONENT', sort_order: 20 },
  { behavior_key: 'ASSISTANCE', name: 'Ispomoć', description: '',
    kind: 'COMPONENT', sort_order: 40 },
];

describe('ponašanja obračuna', () => {
  it('nudi samo ponašanja koja odgovaraju vrsti', () => {
    expect(behaviorsForKind(catalog, 'PRIMARY').map((b) => b.behavior_key))
      .toEqual(['PRIMARY_DAILY']);
    expect(behaviorsForKind(catalog, 'COMPONENT').map((b) => b.behavior_key))
      .toEqual(['OVERTIME_HOURS', 'ASSISTANCE']);
  });

  it('ponašanje koje server nije poslao nije podržano', () => {
    expect(isBehaviorSupported(catalog, 'OVERTIME_HOURS')).toBe(true);
    expect(isBehaviorSupported(catalog, 'FIELD_BONUS_SPECIAL')).toBe(false);
  });
});

describe('modeli prevoza', () => {
  it('nudi samo naplative modele (Q22)', () => {
    const opts = transportRuleOptions({
      transport_rule_types_allowed: ['PER_ELIGIBLE_WORKED_DAY', 'LITERS_PER_EMPLOYEE_DAY'],
    });
    expect(opts.map((o) => o.value)).toEqual([
      'PER_ELIGIBLE_WORKED_DAY', 'LITERS_PER_EMPLOYEE_DAY',
    ]);
    expect(opts.map((o) => o.value)).not.toContain('FIXED_MONTHLY');
  });

  it('nepoznat model prikazuje kao svoju šifru, ne izmišlja naziv', () => {
    const opts = transportRuleOptions({ transport_rule_types_allowed: ['NESTO_NOVO'] });
    expect(opts[0].label).toBe('NESTO_NOVO');
  });
});

describe('šta se sme menjati', () => {
  it('ponašanje se nikada ne menja', () => {
    expect(editableFields({ in_use: false }).behavior).toBe(false);
    expect(editableFields({ in_use: true }).behavior).toBe(false);
  });

  it('šifra u odobrenom obračunu postaje istorija', () => {
    expect(editableFields({ in_use: true }).code).toBe(false);
    expect(editableFields({ in_use: false }).code).toBe(true);
  });

  it('prikaz ostaje izmenljiv i kada je stavka u upotrebi', () => {
    expect(editableFields({ in_use: true }).presentation).toBe(true);
  });
});

describe('osetljive permisije', () => {
  it('prepoznaje permisije koje pomeraju novac ili granice pristupa', () => {
    const cfg = {
      sensitive_permissions: ['finance.approve', 'users.manage'],
    } as unknown as AdminConfig;
    expect(isSensitivePermission(cfg, 'finance.approve')).toBe(true);
    expect(isSensitivePermission(cfg, 'entry.view')).toBe(false);
  });
});

describe('radni kalendar', () => {
  it('ispisuje obrazac radnih dana', () => {
    expect(weekdayPatternLabel([1, 2, 3, 4, 5])).toBe('Pon, Uto, Sre, Čet, Pet');
    expect(weekdayPatternLabel([6, 1])).toBe('Pon, Sub');
    expect(weekdayPatternLabel([])).toBe('—');
  });
});

describe('pristup korisnika — semantika zamene', () => {
  it('šalje PUN skup centara, ne samo poslednji izabrani', () => {
    const p = userAccessPayload({
      profileId: 'u1', active: true, roles: ['DATA_ENTRY_OPERATOR'],
      centers: [{ code: 'B6', write: true }, { code: 'BZ', write: false }],
      canManageRoles: true,
    });
    expect(p.center_access).toEqual([
      { center_code: 'B6', can_write: true },
      { center_code: 'BZ', can_write: false },
    ]);
  });

  it('izmena jednog centra ne briše drugi', () => {
    const centers = [{ code: 'B6', write: false }, { code: 'BZ', write: true }];
    const next = centers.map((c) => (c.code === 'B6' ? { ...c, write: true } : c));
    const p = userAccessPayload({
      profileId: 'u1', active: true, roles: [], centers: next, canManageRoles: false,
    });
    expect(p.center_access.map((c) => c.center_code)).toEqual(['B6', 'BZ']);
    expect(p.center_access[0].can_write).toBe(true);
  });

  it('bez roles.manage uloge se NE šalju (null = ne diraj)', () => {
    const p = userAccessPayload({
      profileId: 'u1', active: true, roles: ['SUPER_ADMIN_BA'],
      centers: [], canManageRoles: false,
    });
    expect(p.role_codes).toBeNull();
  });

  it('sa roles.manage šalje se pun skup uloga', () => {
    const p = userAccessPayload({
      profileId: 'u1', active: true, roles: ['FINANCE', 'DATA_ENTRY_OPERATOR'],
      centers: [], canManageRoles: true,
    });
    expect(p.role_codes).toEqual(['FINANCE', 'DATA_ENTRY_OPERATOR']);
  });
});

describe('potvrda osetljivih izmena', () => {
  const sensitive = ['finance.approve', 'roles.manage', 'controls.review'];

  it('upozorava na dodavanje privilegovane uloge', () => {
    expect(sensitiveChanges({
      currentRoles: ['DATA_ENTRY_OPERATOR'], nextRoles: ['SUPER_ADMIN_BA'],
      sensitivePermissions: sensitive, nextOverrides: [],
    })[0]).toContain('SUPER_ADMIN_BA');
  });

  it('upozorava na GRANT osetljive permisije', () => {
    expect(sensitiveChanges({
      currentRoles: [], nextRoles: [], sensitivePermissions: sensitive,
      nextOverrides: [{ permission_code: 'finance.approve', mode: 'GRANT' }],
    })).toHaveLength(1);
  });

  it('REVOKE i obične permisije ne traže potvrdu', () => {
    expect(sensitiveChanges({
      currentRoles: [], nextRoles: [], sensitivePermissions: sensitive,
      nextOverrides: [
        { permission_code: 'finance.approve', mode: 'REVOKE' },
        { permission_code: 'entry.view', mode: 'GRANT' },
      ],
    })).toEqual([]);
  });

  it('zadržavanje postojeće uloge nije nova privilegija', () => {
    expect(sensitiveChanges({
      currentRoles: ['SUPER_ADMIN_BA'], nextRoles: ['SUPER_ADMIN_BA'],
      sensitivePermissions: sensitive, nextOverrides: [],
    })).toEqual([]);
  });
});
