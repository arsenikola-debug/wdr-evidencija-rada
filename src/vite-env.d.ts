/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WDR_API?: 'mock' | 'supabase';
  readonly VITE_WDR_API_SCHEMA?: string;
  readonly VITE_WDR_MOCK_RATES?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
