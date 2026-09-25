/**
 * Efektivne permisije za PRIKAZ.
 *
 * Kanonsko pravilo živi u bazi (`app.profile_has_perm`):
 *
 *     prava uloga  ∪  izričiti GRANT  ∖  izričiti REVOKE
 *
 * REVOKE pobeđuje i kada uloga permisiju daje. Ovaj modul ponavlja isto pravilo
 * na frontendu — ali SAMO da bi se znalo šta prikazati. Bezbednost ostaje na
 * serveru: sakriveno dugme nije kontrola pristupa, a svaki RPC ionako ponovo
 * proverava prava.
 *
 * Razlog zašto je izdvojeno u zaseban, čist modul: logika je ranije živela
 * usred `getSession()` i tamo je imala tihu grešku (upit nije vraćao `role_id`,
 * pa je presek uloga i prava uvek bio prazan). Takvu grešku je nemoguće
 * testirati bez baze dok je uklještena između mrežnih poziva.
 */

export interface RoleRow {
  /** Stabilan identitet uloge. Šifra NIJE identitet kada `role_id` postoji. */
  role_id: string | null;
  code: string | null;
}

export interface RolePermissionRow {
  role_id: string;
  code: string | null;
}

export type OverrideMode = 'GRANT' | 'REVOKE';

export interface OverrideRow {
  permission_code: string;
  mode: string;
}

/**
 * Isti redosled kao u bazi: prvo unija (uloge + GRANT), pa oduzimanje REVOKE.
 * Obrnut redosled bi značio da GRANT može da poništi REVOKE, što je suprotno
 * od onoga što administrator očekuje kada nekome izričito oduzme pravo.
 */
export function effectivePermissions(
  roleRows: RoleRow[],
  rolePermissions: RolePermissionRow[],
  overrides: OverrideRow[] = [],
): string[] {
  const roleIds = new Set(
    roleRows.map((r) => r.role_id).filter((id): id is string => Boolean(id)),
  );

  const granted = new Set<string>();

  // Bez ijedne dodeljene uloge, prava iz uloga nema. Ranije se ovde padalo na
  // „ako je skup prazan, uzmi sve" — što je korisniku bez uloge davalo pun
  // katalog permisija u prikazu.
  for (const rp of rolePermissions) {
    if (!rp.code) continue;
    if (roleIds.has(rp.role_id)) granted.add(rp.code);
  }

  for (const o of overrides) {
    if (o.mode === 'GRANT') granted.add(o.permission_code);
  }
  for (const o of overrides) {
    if (o.mode === 'REVOKE') granted.delete(o.permission_code);
  }

  return [...granted].sort();
}

export function roleCodes(roleRows: RoleRow[]): string[] {
  return roleRows.map((r) => r.code).filter((c): c is string => Boolean(c));
}
