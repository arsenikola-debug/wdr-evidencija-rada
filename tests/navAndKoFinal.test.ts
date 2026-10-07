import { describe, expect, it } from 'vitest';
import { NAV_GROUPS } from '../src/components/navConfig';
import { MockWdrApi } from '../src/lib/api/mockApi';

/** Završne korekcije pre testiranja sa kolegama (2026-10-01). */
const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));
const groupOf = (to: string) => all.find((i) => i.to === to)?.group;

describe('navigacija', () => {
  it('nema zasebnog unosa Stopova; ruta ostaje dostupna kroz Dodatne isplate', () => {
    expect(all.some((i) => i.to === '/stopovi-kurira')).toBe(false);
    expect(NAV_GROUPS.some((g) => g.title === 'Stopovi kurira')).toBe(false);
    expect(all.find((i) => i.to === '/dodatne-isplate')?.alsoActiveOn).toContain('/stopovi-kurira');
  });

  it('Finansije: Stopovi su deo objedinjenih „Dodatnih isplata" (nema zasebne stavke)', () => {
    const fin = all.find((i) => i.to === '/finansije/dodatne-isplate');
    expect(fin?.group).toBe('Finansije');
    expect(fin?.alsoActiveOn).toContain('/finansije/stopovi-kurira');
    expect(all.some((i) => i.to === '/finansije/stopovi-kurira')).toBe(false);
  });

  it('Uvoz zaposlenih, Zaposleni i Tarife su u Administraciji, ne u Analitici', () => {
    expect(groupOf('/administracija/uvoz-zaposlenih')).toBe('Administracija');
    expect(groupOf('/zaposleni')).toBe('Administracija');
    expect(groupOf('/administracija/dodatne-isplate')).toBe('Administracija');
    const analytics = NAV_GROUPS.find((g) => g.title === 'Analitika')!.items.map((i) => i.to);
    expect(analytics).not.toContain('/administracija/uvoz-zaposlenih');
  });

  it('operater ne vidi Admin stranice u meniju', () => {
    const adminPages = all.filter((i) => i.group === 'Administracija');
    expect(adminPages.length).toBeGreaterThan(0);
    for (const i of adminPages) expect(i.profiles).toEqual(['admin']);
  });
});

describe('neopredeljeni zaposleni', () => {
  it('Admin vidi listu filtriranu po centru i naknadno dodeljuje Karnet/Obuka', async () => {
    const admin = new MockWdrApi({ role: 'admin' });
    await admin.signIn('admin@wdr.local', 'mock1234');
    const b6 = '10000000-0000-0000-0000-0000000000b6';
    expect((await admin.adminEmployeesWithoutBaseType(b6)).every((e) => e.center_id === b6)).toBe(true);
    expect((await admin.adminEmployeesWithoutBaseType('drugi-centar')).length).toBe(0);
    const r = await admin.adminBulkAssignBaseType(['imp-2'], 'OBUKA', '2026-08-01');
    expect(r.assigned).toBe(1);
  });

  it('operater nema pristup listi neopredeljenih ni dodeli', async () => {
    const op = new MockWdrApi({ role: 'operator' });
    await op.signIn('operater@wdr.local', 'mock1234');
    await expect(op.adminEmployeesWithoutBaseType()).rejects.toBeTruthy();
  });
});
