import { describe, expect, it } from 'vitest';
import { isOperatorFixable, messageForCode } from '../src/features/grid/errors';
import { extractCode } from '../src/lib/api/supabaseApi';

describe('error messages for the operator', () => {
  it('translates named database codes', () => {
    expect(messageForCode('EMPLOYEE_NOT_IN_CENTER')).toContain('ispomoć');
    expect(messageForCode('COST_CENTER_OVERRIDE_DENIED')).toContain('drugi centar');
    expect(messageForCode('ASSISTANCE_SEGMENT_CONFLICT')).toContain('troškovnim centrom');
  });

  it('never shows a raw message containing a UUID', () => {
    const raw = 'Prijava 66666666-6666-6666-6666-666666666601 je zakljucana';
    expect(messageForCode(null, raw)).not.toContain('66666666');
  });

  it('recognises a locked period from the message text', () => {
    expect(messageForCode(null, 'Prijava nije u stanju za izmenu')).toBe('Period je zaključan za unos.');
  });

  it('falls back to a generic message with nothing to go on', () => {
    expect(messageForCode(null)).toContain('neočekivane');
  });

  it('separates what the operator can fix from what needs an administrator', () => {
    expect(isOperatorFixable('SEGMENT_OVERLAP')).toBe(true);
    expect(isOperatorFixable('MISSING_COMPENSATION_RULE')).toBe(false);
    expect(isOperatorFixable(null)).toBe(false);
  });
});

describe('code extraction from database messages', () => {
  it('pulls the named token out', () => {
    expect(extractCode('… (SEGMENT_OVERLAP).')).toBe('SEGMENT_OVERLAP');
  });
  it('returns null when there is no token', () => {
    expect(extractCode('obicna poruka bez koda')).toBeNull();
    expect(extractCode(undefined)).toBeNull();
  });
  it('extracts business codes from PostgreSQL hint text too', () => {
    expect(extractCode('PERIOD_ALREADY_SUBMITTED')).toBe('PERIOD_ALREADY_SUBMITTED');
    expect(extractCode('PERIOD_LOCKED_APPROVED')).toBe('PERIOD_LOCKED_APPROVED');
  });
});
