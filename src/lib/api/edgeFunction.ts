import { WdrApiError } from './WdrApi';

/**
 * Edge Function `wdr-admin-users` — ime je jedno mesto istine za adapter i testove.
 *
 * Funkcija se poziva KORISNIKOVIM JWT-om (supabase-js ga sam dodaje u
 * Authorization). Frontend nikada nema service-role ključ; privilegovane
 * Auth operacije postoje samo na serveru, posle provere prava u bazi.
 */
export const ADMIN_USERS_FUNCTION = 'wdr-admin-users';

interface InvokeErrorLike {
  name?: string;
  message?: string;
  context?: { status?: number; json?: () => Promise<unknown>; clone?: () => unknown };
}

/**
 * Greška iz `functions.invoke` → WdrApiError sa serverskom šifrom.
 *
 *  * FunctionsHttpError  — funkcija je odgovorila ne-2xx; telo je
 *    `{ error: { code, message, ... } }`.
 *  * FunctionsFetchError / FunctionsRelayError — funkcija nije dostupna (nije
 *    deployovana, mreža, CORS). To je stanje rollout-a, ne greška korisnika.
 */
export async function edgeErrorToWdr(error: unknown): Promise<WdrApiError> {
  const e = (error ?? {}) as InvokeErrorLike;
  if (e.name === 'FunctionsHttpError' && e.context) {
    const status = e.context.status ?? 0;
    let body: unknown = null;
    try {
      body = typeof e.context.json === 'function' ? await e.context.json() : null;
    } catch {
      body = null;
    }
    const err = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (err && typeof err.code === 'string') {
      return new WdrApiError(
        typeof err.message === 'string' ? err.message : 'Greška administracije korisnika.',
        err.code,
        { status, ...(err as Record<string, unknown>) },
      );
    }
    if (status === 404) {
      return new WdrApiError(
        'Server funkcija za upravljanje korisnicima nije deployovana.',
        'ADMIN_USERS_FN_UNAVAILABLE', { status },
      );
    }
    return new WdrApiError('Server funkcija za korisnike je vratila grešku.', 'ADMIN_USERS_FN_ERROR', { status });
  }
  return new WdrApiError(
    'Server funkcija za upravljanje korisnicima nije dostupna.',
    'ADMIN_USERS_FN_UNAVAILABLE', { name: e.name ?? null },
  );
}
