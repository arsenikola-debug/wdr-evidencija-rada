import type { SubmissionStatus } from '../../lib/api/types';

/**
 * Šta se dešava kada operater u „Novi unos" ponovo izabere centar i raspon za
 * koji prijava VEĆ postoji.
 *
 * Ponovni izbor nije uvek isto što i nastavak rada. Prijava koja je već poslata
 * ili odobrena ne sme da se otvori kroz „Novi unos" — to bi zamaskiralo stvarno
 * stanje i navelo operatera da misli da može da menja nešto što je zaključano.
 *
 * Granica prati postojeći životni ciklus iz `submission_transitions`:
 *   DRAFT / RETURNED / READY_FOR_REVIEW  -> rad se nastavlja nad ISTOM prijavom;
 *   SUBMITTED                            -> čeka finansije, ispravka ide kroz vraćanje;
 *   FINANCE_APPROVED / CLOSED            -> zaključano, izmene idu kroz Korekcije.
 *
 * Ovo je prikaz i rana poruka. Konačnu odluku i dalje donosi baza.
 */

export type PeriodReuse =
  | { kind: 'reuse'; message: string }
  | { kind: 'blocked'; code: string; message: string };

export function decidePeriodReuse(status: SubmissionStatus): PeriodReuse {
  switch (status) {
    case 'DRAFT':
      return {
        kind: 'reuse',
        message: 'Prijava za taj centar i raspon već postoji — nastavite rad na njoj.',
      };
    case 'RETURNED':
      return {
        kind: 'reuse',
        message:
          'Prijava za taj centar i raspon je vraćena na ispravku — nastavite ispravku iste prijave.',
      };
    case 'READY_FOR_REVIEW':
      return {
        kind: 'reuse',
        message:
          'Prijava za taj centar i raspon je spremna za pregled — otvorena je postojeća prijava.',
      };
    case 'SUBMITTED':
      return {
        kind: 'blocked',
        code: 'PERIOD_ALREADY_SUBMITTED',
        message:
          'Period za taj centar i raspon je već poslat finansijama. Nov unos se ne otvara — '
          + 'sačekajte odluku ili vraćanje na ispravku.',
      };
    case 'FINANCE_APPROVED':
    case 'CLOSED':
      return {
        kind: 'blocked',
        code: 'PERIOD_LOCKED_APPROVED',
        message:
          'Period za taj centar i raspon je odobren i zaključan. Naknadne izmene idu isključivo '
          + 'kroz modul Korekcije.',
      };
    default:
      // Nepoznat status se ne tumači kao „slobodno" — blokira se i prijavljuje.
      return {
        kind: 'blocked',
        code: 'PERIOD_STATUS_UNKNOWN',
        message: `Prijava za taj centar i raspon je u statusu ${String(status)} i ne može se otvoriti kao nov unos.`,
      };
  }
}
