import { MockWdrApi } from './mockApi';
import { SupabaseWdrApi } from './supabaseApi';
import type { WdrApi } from './WdrApi';

export interface ApiInfo {
  api: WdrApi;
  kind: 'mock' | 'supabase';
  /** Mock only: rates are clearly-marked demo values, never seed data. */
  demoRates: boolean;
}

let cached: ApiInfo | null = null;

export function getApi(): ApiInfo {
  if (cached) return cached;

  const kind = (import.meta.env.VITE_WDR_API ?? 'mock') as 'mock' | 'supabase';

  if (kind === 'supabase') {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const schema = import.meta.env.VITE_WDR_API_SCHEMA ?? 'api';
    if (!url || !key) {
      throw new Error(
        'VITE_SUPABASE_URL i VITE_SUPABASE_ANON_KEY su obavezni kada je VITE_WDR_API=supabase.',
      );
    }
    cached = { api: new SupabaseWdrApi(url, key, schema), kind, demoRates: false };
    return cached;
  }

  const demoRates = import.meta.env.VITE_WDR_MOCK_RATES === 'demo';
  // Picks which seeded role the mock session represents; it never grants more
  // than that role has in supabase/seed.sql.
  const envRole = import.meta.env.VITE_WDR_MOCK_ROLE;
  const role = envRole === 'finance' ? 'finance' : envRole === 'admin' ? 'admin' : 'operator';
  cached = { api: new MockWdrApi({ demoRates, role }), kind: 'mock', demoRates };
  return cached;
}

export type { WdrApi } from './WdrApi';
export { WdrApiError } from './WdrApi';
