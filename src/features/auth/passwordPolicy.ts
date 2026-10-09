/**
 * Pravila za lozinku koju korisnik SAM postavlja (prvi login ili promena).
 *
 * Isto pravilo sprovodi server (Edge Function `wdr-admin-users`, logic.ts →
 * newPasswordProblem); Supabase Auth dodatno primenjuje pravila jačine
 * podešena na projektu. Ovde je samo da korisnik grešku vidi pre slanja.
 */
export const MIN_PASSWORD_LENGTH = 10;
/** bcrypt (Supabase Auth) koristi najviše 72 bajta. */
export const MAX_PASSWORD_BYTES = 72;

export type PasswordProblem =
  | 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG' | 'SAME_PASSWORD' | 'PASSWORD_CONTAINS_EMAIL';

export function newPasswordProblem(next: string, current: string, email: string | null): PasswordProblem | null {
  if (next.length < MIN_PASSWORD_LENGTH) return 'PASSWORD_TOO_SHORT';
  if (new TextEncoder().encode(next).length > MAX_PASSWORD_BYTES) return 'PASSWORD_TOO_LONG';
  if (next === current) return 'SAME_PASSWORD';
  const local = (email ?? '').split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && next.toLowerCase().includes(local)) return 'PASSWORD_CONTAINS_EMAIL';
  return null;
}

export const PASSWORD_PROBLEM_TEXT: Record<PasswordProblem, string> = {
  PASSWORD_TOO_SHORT: `Nova lozinka mora imati najmanje ${MIN_PASSWORD_LENGTH} znakova.`,
  PASSWORD_TOO_LONG: 'Nova lozinka je predugačka (najviše 72 bajta).',
  SAME_PASSWORD: 'Nova lozinka mora biti različita od trenutne.',
  PASSWORD_CONTAINS_EMAIL: 'Nova lozinka ne sme da sadrži vaš email (deo pre @).',
};

/** Provera forme pre slanja: pravila + ponovljena lozinka. */
export function passwordFormError(
  next: string, repeat: string, current: string, email: string | null,
): string | null {
  const p = newPasswordProblem(next, current, email);
  if (p) return PASSWORD_PROBLEM_TEXT[p];
  if (next !== repeat) return 'Unete nove lozinke se ne poklapaju.';
  return null;
}

/** Jedini ekran dostupan dok je must_change_password = true. */
export const SET_PASSWORD_PATH = '/postavi-lozinku';
