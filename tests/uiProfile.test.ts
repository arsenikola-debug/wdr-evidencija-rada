import { describe, expect, it } from 'vitest';
import { isVisibleForProfile, resolveProfile } from '../src/features/auth/profile';

/**
 * Greška koju ovi testovi čuvaju: početna i navigacija su se birale po
 * permisijama, pa je `SUPER_ADMIN_BA` — koji legitimno ima `finance.queue.view`
 * — bio prikazan kao Finansije. Uloga određuje identitet ekrana; permisija
 * određuje akcije. Baza i dalje odlučuje o pristupu.
 */

describe('resolveProfile — uloga, ne permisija', () => {
  it('SUPER_ADMIN_BA je Admin/BA, nikad Finance', () => {
    const r = resolveProfile(['SUPER_ADMIN_BA']);
    expect(r.primary).toBe('admin');
    expect(r.profiles.has('finance')).toBe(false);
    expect(r.profiles.has('operator')).toBe(false);
    expect(r.unmapped).toBe(false);
  });

  it('FINANCE je Finance', () => {
    expect(resolveProfile(['FINANCE']).primary).toBe('finance');
  });

  it('DATA_ENTRY_OPERATOR je Operator', () => {
    expect(resolveProfile(['DATA_ENTRY_OPERATOR']).primary).toBe('operator');
  });

  it('više uloga daje uniju modula, a Admin nosi početnu', () => {
    const r = resolveProfile(['FINANCE', 'DATA_ENTRY_OPERATOR', 'SUPER_ADMIN_BA']);
    expect(r.primary).toBe('admin');
    expect([...r.profiles].sort()).toEqual(['admin', 'finance', 'operator']);
  });

  it('nalog samo sa nepoznatom ulogom pada na permisije', () => {
    const r = resolveProfile(['REVIZOR']);
    expect(r.primary).toBeNull();
    expect(r.unmapped).toBe(true);
    expect(r.unknownRoles).toEqual(['REVIZOR']);
  });

  it('nalog bez uloga je nepoznat, ne prazan', () => {
    expect(resolveProfile([]).unmapped).toBe(true);
    expect(resolveProfile(undefined).unmapped).toBe(true);
  });

  it('poznata uloga uz nepoznatu OSTAJE profilno filtrirana', () => {
    // Regresija koju ovaj test čuva: jedna nepoznata uloga je ranije gasila
    // profilno filtriranje i vraćala širu navigaciju nego što nalogu pripada.
    const r = resolveProfile(['FINANCE', 'REVIZOR']);
    expect(r.primary).toBe('finance');
    expect(r.unmapped).toBe(false);
    expect(r.unknownRoles).toEqual(['REVIZOR']);
  });

  it('nepoznata uloga se beleži, ali ne širi profile', () => {
    const r = resolveProfile(['SUPER_ADMIN_BA', 'REVIZOR', 'AUDIT']);
    expect([...r.profiles]).toEqual(['admin']);
    expect(r.unmapped).toBe(false);
    expect(r.unknownRoles).toEqual(['REVIZOR', 'AUDIT']);
  });

  it('samo nepoznate uloge znače fallback na permisije', () => {
    const r = resolveProfile(['REVIZOR', 'AUDIT']);
    expect(r.primary).toBeNull();
    expect(r.unmapped).toBe(true);
    expect(r.unknownRoles).toEqual(['REVIZOR', 'AUDIT']);
  });
});

describe('isVisibleForProfile — modul po ulozi, akcija po permisiji', () => {
  const admin = resolveProfile(['SUPER_ADMIN_BA']);
  const finance = resolveProfile(['FINANCE']);
  const operator = resolveProfile(['DATA_ENTRY_OPERATOR']);
  const unknown = resolveProfile(['REVIZOR']);
  const financeWithUnknown = resolveProfile(['FINANCE', 'REVIZOR']);

  it('stavka bez profila pripada svima', () => {
    for (const r of [admin, finance, operator, unknown]) {
      expect(isVisibleForProfile(r, undefined)).toBe(true);
      expect(isVisibleForProfile(r, [])).toBe(true);
    }
  });

  it('superadminu se ne nude operaterski ni finansijski moduli', () => {
    expect(isVisibleForProfile(admin, ['operator'])).toBe(false);
    expect(isVisibleForProfile(admin, ['finance'])).toBe(false);
    expect(isVisibleForProfile(admin, ['admin'])).toBe(true);
  });

  it('deljeni modul je vidljiv svakom navedenom profilu', () => {
    expect(isVisibleForProfile(admin, ['operator', 'admin'])).toBe(true);
    expect(isVisibleForProfile(operator, ['operator', 'admin'])).toBe(true);
    expect(isVisibleForProfile(finance, ['operator', 'admin'])).toBe(false);
  });

  it('nalogu bez ijedne poznate uloge se ništa ne oduzima — odlučuje permisija', () => {
    expect(isVisibleForProfile(unknown, ['admin'])).toBe(true);
    expect(isVisibleForProfile(unknown, ['finance'])).toBe(true);
    expect(isVisibleForProfile(unknown, ['operator'])).toBe(true);
  });

  it('FINANCE + nepoznata uloga i dalje vidi samo finansijske module', () => {
    expect(isVisibleForProfile(financeWithUnknown, ['finance'])).toBe(true);
    expect(isVisibleForProfile(financeWithUnknown, ['operator'])).toBe(false);
    expect(isVisibleForProfile(financeWithUnknown, ['admin'])).toBe(false);
  });
});
