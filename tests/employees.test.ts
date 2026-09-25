import { describe, expect, it } from 'vitest';
import {
  currentOf,
  duplicateSeverity,
  guardLabel,
  isChangeBlockedByHistory,
  newEmployeeErrors,
  type NewEmployeeForm,
} from '../src/features/employees/model';
import type { EmployeeDuplicateCheck } from '../src/lib/api/types';

function form(over: Partial<NewEmployeeForm> = {}): NewEmployeeForm {
  return {
    employee_code: 'E-100',
    first_name: 'Jovan',
    last_name: 'Jovanović',
    employment_start_date: '2026-07-01',
    center_id: 'c1',
    primary_payment_type_id: 'pt1',
    default_shift_template_id: '',
    transport_required: 'ne',
    transport_provider_id: '',
    transport_valid_from: '',
    notes: '',
    ...over,
  };
}

const empty: EmployeeDuplicateCheck = {
  exact_code: null, exact_name: [], similar: [], note: '',
};

describe('novi zaposleni — obavezna polja', () => {
  it('prihvata potpun unos', () => {
    expect(newEmployeeErrors(form())).toEqual([]);
  });

  it('traži ime, prezime, datum, centar i osnovnu naknadu', () => {
    const errs = newEmployeeErrors(form({
      first_name: '', last_name: '', employment_start_date: '',
      center_id: '', primary_payment_type_id: '',
    }));
    expect(errs).toHaveLength(5);
  });

  it('„prevoz DA" bez prevoznika nije podatak nego rupa', () => {
    expect(newEmployeeErrors(form({ transport_required: 'da' })))
      .toContain('Ako je prevoz potreban, izaberite prevoznika.');
    expect(newEmployeeErrors(form({
      transport_required: 'da', transport_provider_id: 'p1',
    }))).toEqual([]);
  });
});

describe('duplikati', () => {
  it('ista šifra blokira', () => {
    const d = {
      ...empty,
      exact_code: { id: 'e1', full_name: 'Marković Marko', employee_code: 'E-001', active: true },
    };
    expect(duplicateSeverity(d)).toEqual({ kind: 'blocked', count: 1 });
  });

  it('isto ili slično ime je upozorenje, ne blokada', () => {
    const d = {
      ...empty,
      similar: [{ id: 'e2', full_name: 'Marković Marko', employee_code: null,
                  active: true, similarity: 0.8 }],
    };
    expect(duplicateSeverity(d)).toEqual({ kind: 'warning', count: 1 });
  });

  it('bez pronađenih duplikata je čisto', () => {
    expect(duplicateSeverity(empty)).toEqual({ kind: 'clear', count: 0 });
  });

  it('dok provera nije pokrenuta stanje je nepoznato — ne „čisto"', () => {
    expect(duplicateSeverity(null).kind).toBe('unknown');
  });
});

describe('zaštita odobrene istorije', () => {
  it('datum unutar odobrene istorije se blokira unaprijed', () => {
    expect(isChangeBlockedByHistory('2026-07-05', '2026-07-06')).toBe(true);
    expect(isChangeBlockedByHistory('2026-07-06', '2026-07-06')).toBe(true);
  });

  it('datum posle odobrene istorije je dozvoljen', () => {
    expect(isChangeBlockedByHistory('2026-07-07', '2026-07-06')).toBe(false);
  });

  it('bez odobrene istorije nema blokade', () => {
    expect(isChangeBlockedByHistory('2020-01-01', null)).toBe(false);
    expect(isChangeBlockedByHistory('', '2026-07-06')).toBe(false);
  });

  it('objašnjava granicu korisniku', () => {
    expect(guardLabel({
      first_approved_work_date: '2026-07-01',
      last_approved_work_date: '2026-07-06',
      note: '',
    })).toContain('2026-07-06');
    expect(guardLabel({
      first_approved_work_date: null, last_approved_work_date: null, note: '',
    })).toContain('Nema odobrene');
  });
});

describe('currentOf', () => {
  it('nalazi trenutni red efektivno datirane istorije', () => {
    expect(currentOf([
      { is_current: false, id: 'a' }, { is_current: true, id: 'b' },
    ])?.id).toBe('b');
    expect(currentOf([{ is_current: false, id: 'a' }])).toBeNull();
  });
});
