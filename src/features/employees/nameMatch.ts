/**
 * Ogledalo serverskog poređenja imena (migracija 0057) — koristi ga mock adapter
 * i testovi. U produkciji odlučuje ISKLJUČIVO baza (`app.find_similar_employees`);
 * ovaj modul ne sme da postane druga istina.
 *
 *  normalizePersonName — bez dijakritika (č/ć→c, š→s, ž→z, đ→dj, dž→dz),
 *                        bez interpunkcije, mala slova, sažeti razmaci
 *  personNameKey       — normalizovani tokeni sortirani abecedno
 *                        (redosled imena i prezimena nije bitan)
 *  classifyNameMatch   — EXACT_CODE / EXACT_NAME / SIMILAR_NAME / null
 */

const MAP: Record<string, string> = {
  č: 'c', ć: 'c', š: 's', ž: 'z', đ: 'dj', ð: 'dj',
  á: 'a', à: 'a', â: 'a', ä: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i', ó: 'o', ò: 'o', ô: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u', ý: 'y', ñ: 'n',
};

export function normalizePersonName(name: string | null | undefined): string {
  const lower = (name ?? '').toLowerCase().replace(/dž/g, 'dz');
  let out = '';
  for (const ch of lower) out += MAP[ch] ?? ch;
  return out.replace(/[^a-z0-9]+/g, ' ').trim();
}

export function personNameKey(name: string | null | undefined): string {
  return normalizePersonName(name)
    .split(' ')
    .filter((t) => t !== '')
    .sort()
    .join(' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** pg_trgm: trigrami po reči, reč dopunjena sa dva razmaka napred i jednim nazad. */
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.split(' ').filter(Boolean)) {
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i += 1) out.add(p.slice(i, i + 3));
  }
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common += 1;
  return common / (ta.size + tb.size - common);
}

export type NameMatchReason = 'EXACT_CODE' | 'EXACT_NAME' | 'SIMILAR_NAME';

export function classifyNameMatch(args: {
  candidateFullName: string;
  candidateCode?: string | null;
  existingFullName: string;
  existingCode?: string | null;
  threshold?: number;
}): { reason: NameMatchReason; score: number } | null {
  const threshold = args.threshold ?? 0.75;
  const code = args.candidateCode?.trim() || null;
  if (code && args.existingCode === code) return { reason: 'EXACT_CODE', score: 1 };

  const k = personNameKey(args.candidateFullName);
  const ek = personNameKey(args.existingFullName);
  if (!k || !ek) return null;
  if (k === ek) return { reason: 'EXACT_NAME', score: 1 };

  const sim = trigramSimilarity(ek, k);
  const lev = levenshtein(ek, k);
  const len = Math.max(ek.length, k.length, 1);
  const maxLev = k.length <= 12 ? 1 : 2;
  if (sim >= threshold || lev <= maxLev) {
    return {
      reason: 'SIMILAR_NAME',
      score: Math.round(Math.max(sim, 1 - lev / len) * 1000) / 1000,
    };
  }
  return null;
}
