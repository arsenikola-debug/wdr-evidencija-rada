import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { WdrApiError } from '../lib/api';
import type { IsoDate, SubmissionListItem } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';
import { decidePeriodReuse } from '../features/periods/reuse';

/**
 * Novi osnovni unos.
 *
 * Operater sam bira obračunski raspon — ne mora da čeka da administrator otvori
 * period. Ekran ne pretpostavlja mesečni obračun: raspon je proizvoljan.
 *
 * Sve provere su serverske (`api.rpc_create_period_submission`): pravo nad
 * centrom, `od <= do`, dužina raspona i preklapanje sa postojećom prijavom.
 * Provere ispod su samo da korisnik ne šalje očigledno pogrešan zahtev; one
 * ništa ne garantuju i ne zamenjuju bazu.
 */

/**
 * Poruka za slučaj kada prijava za izabrani raspon već postoji.
 *
 * Statusi koji ne dozvoljavaju nastavak (SUBMITTED, FINANCE_APPROVED, CLOSED)
 * ovde ne stižu — server, odnosno mock, ih odbija kao grešku, pa se poruka
 * „otvorena je postojeća" nikada ne pojavljuje za zaključan period.
 */
function reuseMessage(status: SubmissionListItem['status']): string {
  const d = decidePeriodReuse(status);
  return d.message;
}

/** Ponedeljak tekuće nedelje — najčešća početna tačka, ali samo predlog. */
function mondayOfThisWeek(): IsoDate {
  const d = new Date();
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: IsoDate, n: number): IsoDate {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayCount(from: IsoDate, to: IsoDate): number {
  if (!from || !to) return 0;
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

function formatDay(iso: IsoDate): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}.`;
}

export function NewPeriod() {
  const { api, session } = useAuth();
  const navigate = useNavigate();

  /** Samo centri u kojima korisnik zaista sme da unosi. Nikad ceo spisak. */
  const writableCenters = useMemo(
    () => (session?.centers ?? []).filter((c) => c.can_write),
    [session],
  );
  const singleCenter = writableCenters.length === 1 ? writableCenters[0] : null;

  const [centerId, setCenterId] = useState<string>(singleCenter?.center_id ?? '');
  const [from, setFrom] = useState<IsoDate>(mondayOfThisWeek());
  const [to, setTo] = useState<IsoDate>(addDays(mondayOfThisWeek(), 6));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ item: SubmissionListItem; reused: boolean } | null>(null);

  /**
   * Svaka promena raspona ili centra briše prethodni ishod. Bez toga bi poruka
   * o već otvorenom periodu ostala na ekranu dok korisnik bira novi raspon, pa
   * bi dugme „Otvori evidenciju" vodilo na pogrešnu prijavu.
   */
  function changeInput(apply: () => void) {
    setCreated(null);
    setError(null);
    apply();
  }

  const days = dayCount(from, to);
  const rangeInvalid = Boolean(from && to && to < from);
  const tooLong = days > 62;
  const canSubmit = Boolean(centerId && from && to) && !rangeInvalid && !tooLong && !busy;

  async function create() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await api.createPeriodSubmission(centerId, from, to);
      setCreated({
        item: {
          id: res.submission_id,
          center_id: res.center_id,
          center_code: res.center_code,
          period_id: res.period_id,
          period_label: res.period_label,
          period_start: res.period_start,
          period_end: res.period_end,
          status: res.status,
        },
        reused: !res.created,
      });
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    } finally {
      setBusy(false);
    }
  }

  if (writableCenters.length === 0) {
    return (
      <div className="page page-narrow">
        <div className="preview-head">
          <div>
            <h1>Novi unos</h1>
            <p className="muted">Otvaranje novog obračunskog perioda.</p>
          </div>
        </div>
        <Banner kind="warning">
          Vaš nalog nema nijedan centar sa pravom unosa, pa period ne može da se otvori.
          Obratite se administratoru.
        </Banner>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <div className="preview-head">
        <div>
          <h1>Novi unos</h1>
          <p className="muted">
            Izaberite obračunski raspon i centar. Raspon ne mora biti mesečni —
            unesite onaj po kome se zaista obračunava.
          </p>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {created && (
        <Banner kind={created.reused ? 'info' : 'success'}>
          {created.reused ? reuseMessage(created.item.status) : 'Period je otvoren.'}{' '}
          {created.item.center_code} · {formatDay(created.item.period_start)} –{' '}
          {formatDay(created.item.period_end)}
        </Banner>
      )}

      <section className="control-section">
        <h2>Obračunski raspon</h2>

        <div className="form-grid">
          <label>
            <span>Period od</span>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => changeInput(() => setFrom(e.target.value))}
              disabled={busy}
            />
          </label>
          <label>
            <span>Period do</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => changeInput(() => setTo(e.target.value))}
              disabled={busy}
            />
          </label>

          {singleCenter ? (
            <label>
              <span>Centar</span>
              <input value={`${singleCenter.center_code} · ${singleCenter.center_name}`} readOnly />
            </label>
          ) : (
            <label>
              <span>Centar</span>
              <select value={centerId} onChange={(e) => changeInput(() => setCenterId(e.target.value))} disabled={busy}>
                <option value="">— izaberite —</option>
                {writableCenters.map((c) => (
                  <option key={c.center_id} value={c.center_id}>
                    {c.center_code} · {c.center_name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="range-summary">
          <span className="metric-label">Izabrani period</span>
          <strong>
            {formatDay(from)} – {formatDay(to)}
          </strong>
          <span className="muted small">
            {rangeInvalid
              ? 'Datum „do" je pre datuma „od".'
              : `${days} ${days === 1 ? 'dan' : 'dana'} ukupno`}
          </span>
        </div>

        {rangeInvalid && (
          <Banner kind="error">Datum „do" mora biti isti ili posle datuma „od".</Banner>
        )}
        {tooLong && (
          <Banner kind="error">
            Raspon je duži od 62 dana. Podelite ga na više obračunskih perioda.
          </Banner>
        )}

        <p className="muted small">
          Server odbija raspon koji se preklapa sa već postojećom prijavom istog centra.
          Odobren period se ne otvara ponovo — ispravke idu kroz modul Korekcije.
        </p>

        <div className="preview-actions">
          {created ? (
            <button
              type="button"
              className="btn btn-primary btn-submit"
              onClick={() => navigate(`/unos?prijava=${created.item.id}`)}
            >
              {created.item.status === 'RETURNED' ? 'Nastavi ispravku' : 'Otvori evidenciju'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-submit"
              disabled={!canSubmit}
              onClick={() => void create()}
            >
              {busy ? 'Otvaranje…' : 'Otvori period'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
