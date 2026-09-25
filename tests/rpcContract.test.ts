import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

/**
 * Frontend ↔ PostgREST ugovor.
 *
 * Ovaj test postoji zato što je stvarna greška prošla kroz 951 pgTAP i 178 Vitest
 * testa: React adapter je i dalje slao parametre koje `api.*` funkcija više ne
 * prima. TypeScript to ne vidi (objekat je slobodnog oblika), a mock ga prihvata —
 * pukao bi tek prvi poziv prema pravom PostgREST-u.
 *
 * Zato se ovde parsira POSLEDNJA definicija svake `api.rpc_*` funkcije iz
 * migracija i poredi sa imenovanim parametrima koje `supabaseApi.ts` šalje.
 * Bez ijedne zavisnosti, radi lokalno i u CI-ju, bez baze.
 *
 * Ovo NE zamenjuje pravi HTTP smoke test pred pilot (Q12).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const PROPOSED = join(ROOT, 'supabase', 'proposed');

/**
 * RPC-ovi koje frontend već poziva, a koji još NISU primenjena migracija.
 *
 * Spisak je namerno kratak i eksplicitan: svaki naziv ovde mora biti definisan
 * u `supabase/proposed/`, inače test pada. Time se dozvoljava predlog u toku
 * review-a, ali se i dalje ne dozvoljava poziv ka nepostojećoj funkciji.
 */
const PENDING_API_FNS = new Set<string>();
const ADAPTER = join(HERE, '..', 'src', 'lib', 'api', 'supabaseApi.ts');

interface ApiFn {
  name: string;
  params: string[];
  required: string[];
  file: string;
}

/** Sve `create ... function api.name(...)` definicije, redom po migracijama. */
function parseApiFunctions(dir: string = MIGRATIONS): Map<string, ApiFn> {
  const out = new Map<string, ApiFn>();
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f: string) => f.endsWith('.sql'))
      .sort();
  } catch {
    return out;
  }

  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const re = /create\s+(?:or\s+replace\s+)?function\s+api\.(\w+)\s*\(/gi;
    let m: RegExpExecArray | null;

    while ((m = re.exec(sql)) !== null) {
      const name = m[1];
      // Uravnotežene zagrade od otvaranja liste parametara.
      let depth = 1;
      let i = re.lastIndex;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '(') depth += 1;
        else if (sql[i] === ')') depth -= 1;
        i += 1;
      }
      const raw = sql.slice(re.lastIndex, i - 1);

      const params: string[] = [];
      const required: string[] = [];
      // Parametri su na prvom nivou zagrada, razdvojeni zarezom.
      let level = 0;
      let current = '';
      for (const ch of raw) {
        if (ch === '(') level += 1;
        if (ch === ')') level -= 1;
        if (ch === ',' && level === 0) {
          params.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
      if (current.trim() !== '') params.push(current);

      const names = params
        .map((p) => p.trim())
        .filter((p) => p !== '')
        .map((p) => {
          const pname = p.split(/\s+/)[0];
          if (!/default/i.test(p)) required.push(pname);
          return pname;
        });

      // Poslednja definicija u redosledu migracija je važeća.
      out.set(name, { name, params: names, required: [...required], file });
    }
  }
  return out;
}

/** `this.rpc<...>('name', { p_x: ..., p_y: ... })` iz adaptera. */
function parseAdapterCalls(): Array<{ name: string; params: string[]; line: number }> {
  const src = readFileSync(ADAPTER, 'utf8');
  const calls: Array<{ name: string; params: string[]; line: number }> = [];
  const re = /this\.rpc<[^>]*>\(\s*'([\w]+)'\s*,\s*(\{|this\.)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const line = src.slice(0, m.index).split('\n').length;

    if (m[2] === 'this.') {
      // Poziv koji prosleđuje helper objekat (npr. `...this.baArgs(...)`).
      // Uzima se ceo argument-blok do zatvaranja poziva.
      let depth = 1;
      let i = m.index + m[0].length;
      let body = '';
      while (i < src.length && depth > 0) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') depth -= 1;
        if (depth > 0) body += src[i];
        i += 1;
      }
      calls.push({ name, params: extractParamNames(body), line });
      continue;
    }

    let depth = 1;
    let i = m.index + m[0].length;
    let body = '';
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
      if (depth > 0) body += src[i];
      i += 1;
    }
    calls.push({ name, params: extractParamNames(body), line });
  }
  return calls;
}

function extractParamNames(body: string): string[] {
  const names = new Set<string>();
  const re = /(^|[\s,{])(p_[a-z0-9_]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) names.add(m[2]);
  // Helper `baArgs` (prosleđen ili spread-ovan) uvek daje p_from/p_to/p_center_ids.
  if (/baArgs\(/.test(body)) {
    names.add('p_from');
    names.add('p_to');
    names.add('p_center_ids');
  }
  return [...names];
}

const apiFns = parseApiFunctions();
const proposedFns = parseApiFunctions(PROPOSED);
/** Ugovor koji adapter sme da gađa: primenjeno + eksplicitno predloženo. */
const contractFns = new Map<string, ApiFn>([...apiFns, ...proposedFns]);
const calls = parseAdapterCalls();

describe('RPC ugovor: frontend ↔ api.*', () => {
  it('parsira api funkcije iz migracija', () => {
    expect(apiFns.size).toBeGreaterThan(50);
    expect(apiFns.has('rpc_finance_approve')).toBe(true);
  });

  it('parsira pozive iz supabase adaptera', () => {
    expect(calls.length).toBeGreaterThan(40);
  });

  it('svaki poziv gađa postojeću api funkciju', () => {
    const missing = calls
      .filter((c) => !contractFns.has(c.name))
      .map((c) => `${c.name} (linija ${c.line})`);
    expect(missing).toEqual([]);
  });

  it('nijedan poziv ne gađa nepostojeću funkciju mimo eksplicitnog spiska', () => {
    const notApplied = calls
      .filter((c) => !apiFns.has(c.name))
      .map((c) => c.name);
    for (const name of notApplied) {
      expect(PENDING_API_FNS.has(name)).toBe(true);
    }
  });

  it('svaki najavljeni RPC zaista postoji u supabase/proposed', () => {
    for (const name of PENDING_API_FNS) {
      expect(proposedFns.has(name)).toBe(true);
    }
  });

  it('predlog nije potajno primenjen niti obrnuto', () => {
    // Ako predlog postane migracija, ime mora da izađe iz PENDING spiska.
    for (const name of PENDING_API_FNS) {
      expect(apiFns.has(name)).toBe(false);
    }
  });

  it('ne šalje ni jedan parametar koji api funkcija ne prima', () => {
    const stale: string[] = [];
    for (const c of calls) {
      const fn = contractFns.get(c.name);
      if (!fn) continue;
      for (const p of c.params) {
        if (!fn.params.includes(p)) {
          stale.push(`${c.name}: nepoznat parametar ${p} (linija ${c.line})`);
        }
      }
    }
    expect(stale).toEqual([]);
  });

  it('ne izostavlja obavezan parametar bez podrazumevane vrednosti', () => {
    const missing: string[] = [];
    for (const c of calls) {
      const fn = contractFns.get(c.name);
      if (!fn) continue;
      for (const p of fn.required) {
        if (!c.params.includes(p)) {
          missing.push(`${c.name}: nedostaje obavezan parametar ${p} (linija ${c.line})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

/**
 * Pilot smoke harness ↔ PostgREST ugovor.
 *
 * Ovaj blok postoji zbog konkretne greške: `scripts/pilot_smoke.mjs` je zvao
 * `rpc_get_session_profile` i `rpc_list_submissions` — dva endpointa koja ne
 * postoje ni u `api` ni u `app`, i koja aplikacija nikada nije koristila.
 * Harness bi zato prijavio LAŽNE greške na ispravno podešenom projektu, a to je
 * gore od nikakvog testa: tera čoveka da traži kvar tamo gde ga nema.
 *
 * Ovde se zato iz harnessa vade STVARNA mesta poziva i porede sa kanonskom
 * površinom `api`. Obična PostgREST čitanja tabela (`tableRead`) se namerno NE
 * tretiraju kao RPC — to su različite putanje, sa različitim zaglavljima.
 */
describe('pilot_smoke.mjs ↔ api površina', () => {
  const HARNESS = join(ROOT, 'scripts', 'pilot_smoke.mjs');

  /** Samo stvarni pozivi: rpc(sesija, 'ime') i rpcMustFail(sesija, 'ime'). */
  function harnessRpcNames(): string[] {
    const src = readFileSync(HARNESS, 'utf8');
    const re = /\b(?:rpc|rpcMustFail)\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*'([a-z0-9_]+)'/g;
    const out = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.add(m[1]);
    return [...out].sort();
  }

  it('harness uopšte zove neke RPC-ove (inače test ništa ne štiti)', () => {
    expect(harnessRpcNames().length).toBeGreaterThan(5);
  });

  it('svaki RPC koji harness zove postoji u `api`', () => {
    const api = parseApiFunctions();
    const missing = harnessRpcNames().filter((n) => !api.has(n));
    expect(missing).toEqual([]);
  });

  it('harness ne zove uklonjene endpointe koji nikada nisu postojali', () => {
    const names = harnessRpcNames();
    expect(names).not.toContain('rpc_get_session_profile');
    expect(names).not.toContain('rpc_list_submissions');
  });

  it('imenovani parametri koje harness šalje postoje u potpisu funkcije', () => {
    const api = parseApiFunctions();
    const src = readFileSync(HARNESS, 'utf8');
    // rpc(sesija, 'ime', { p_x: …, p_y: … })
    const re = /\b(?:rpc|rpcMustFail)\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*'([a-z0-9_]+)'\s*,\s*\{([^}]*)\}/g;
    const problems: string[] = [];
    let m: RegExpExecArray | null;

    while ((m = re.exec(src)) !== null) {
      const fn = api.get(m[1]);
      if (!fn) continue; // pokriveno testom iznad
      const sent = [...m[2].matchAll(/(p_[a-z0-9_]+)\s*:/g)].map((x) => x[1]);
      for (const p of sent) {
        if (!fn.params.includes(p)) {
          problems.push(`${m[1]}: šalje se ${p}, a potpis ima [${fn.params.join(', ')}]`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('obična čitanja tabela se ne mešaju sa RPC-ovima', () => {
    const src = readFileSync(HARNESS, 'utf8');
    // `tableRead` ne sme da gađa /rpc/ putanju.
    const tableCalls = [...src.matchAll(/tableRead\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*\n?\s*'([^']+)'/g)]
      .map((x) => x[1]);
    expect(tableCalls.length).toBeGreaterThan(0);
    expect(tableCalls.some((t) => t.startsWith('rpc/'))).toBe(false);
  });
});

/**
 * Sastavljanje sesije u pravom režimu ↔ pilot harness.
 *
 * Čist proračun prava pokriven je u `sessionPermissions.test.ts`. Ovde se čuva
 * ono što taj test ne može da vidi: da adapter zaista PROČITA sve što proračunu
 * treba. Greška koja je pokrenula ovaj blok bila je upravo u upitu — `role_id`
 * nije bio u `select`-u, pa je presek uloga i prava uvek ispadao prazan, a
 * ispravno dodeljen korisnik dobijao zaključane ekrane.
 */
describe('getSession ↔ stvarne PostgREST putanje', () => {
  const HARNESS = join(ROOT, 'scripts', 'pilot_smoke.mjs');

  function sessionSource(): string {
    const src = readFileSync(ADAPTER, 'utf8');
    const start = src.indexOf('async getSession(');
    const end = src.indexOf('async listSubmissions(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it('upit za uloge vraća role_id, a ne samo šifru', () => {
    const body = sessionSource();
    const m = body.match(/from\('user_roles'\)\s*\.select\('([^']+)'\)/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('role_id');
  });

  it('čita izuzetke permisija korisnika', () => {
    const body = sessionSource();
    expect(body).toContain("from('user_permission_overrides')");
    const m = body.match(/from\('user_permission_overrides'\)\s*\.select\('([^']+)'\)/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('mode');
    expect(m![1]).toContain('permissions(code)');
  });

  it('koristi zajednički proračun prava, bez druge kopije pravila', () => {
    const body = sessionSource();
    expect(body).toContain('effectivePermissions(');
    // Presek po ulogama ne sme da se ponovo piše u adapteru.
    expect(body).not.toMatch(/roleIds\s*\.\s*has\(/);
  });

  it('greška bilo kog čitanja pristupa se ne guta', () => {
    const body = sessionSource();
    for (const table of [
      'profiles', 'user_roles', 'role_permissions',
      'user_permission_overrides', 'user_center_access',
    ]) {
      expect(body).toContain(`'${table}'`);
    }
    // Sva čitanja se proveravaju u jednoj petlji koja baca WdrApiError.
    expect(body).toMatch(/if \(res\.error\)[\s\S]{0,200}throw new WdrApiError/);
  });

  it('pilot harness čita ISTE tabele kao adapter', () => {
    const harness = readFileSync(HARNESS, 'utf8');
    for (const table of [
      'profiles', 'user_roles', 'role_permissions',
      'user_permission_overrides', 'user_center_access',
    ]) {
      expect(harness).toContain(table);
    }
  });

  it('pilot harness proverava da efektivne permisije nisu prazne', () => {
    const harness = readFileSync(HARNESS, 'utf8');
    expect(harness).toContain("mode === 'GRANT'");
    expect(harness).toContain("mode === 'REVOKE'");
    expect(harness).toMatch(/eff\.size === 0/);
  });
});
