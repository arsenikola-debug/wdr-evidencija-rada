import type { OvertimeComponentInput, OvertimeComponentResult } from './types';
import { WdrApiError, type WdrApi } from './WdrApi';
import { decidePeriodReuse } from '../../features/periods/reuse';
import type {
  AdminAttendanceStatus,
  AdminReadiness,
  VerificationKind,
  ControlFindingDetail,
  ControlFindingStatus,
  ControlFindingRow,
  ControlFindings,
  ControlRunResponse,
  ControlSeverity,
  BaCenters,
  BaDaily,
  BaEmployeeSort,
  BaEmployees,
  BaFinanceTimeline,
  BaOverview,
  BaPaymentBreakdown,
  BaTransport,
  EmployeeDuplicateCheck,
  EmployeeFormReference,
  EmployeeList,
  EmployeeProfile,
  NewEmployeeInput,
  AdminCenter,
  AdminConfig,
  AdminPaymentType,
  AdminShiftTemplate,
  Adjustment,
  AdjustmentCalculation,
  AdjustmentDirection,
  AdjustmentInput,
  AdjustmentPreview,
  AdjustmentQueue,
  AdjustmentStatus,
  AssistanceSegmentInput,
  CalcLine,
  FinanceApproveResult,
  FinanceHistory,
  FinanceQueue,
  FinanceQueueStatus,
  FinanceRecap,
  FinanceSubmissionDetail,
  PreviewWarning,
  AssistanceSegmentResult,
  BulkEntryInput,
  BulkRowResult,
  BulkUpsertResult,
  GridCellPayload,
  GridPayload,
  GridSegment,
  IsoDate,
  NotificationItem,
  PreviewLine,
  SessionProfile,
  SubmissionListItem,
  CreatePeriodSubmissionResult,
  SubmissionPreview,
  SubmitPeriodResult,
  Uuid,
} from './types';

/**
 * Development adapter. Implements the WdrApi interface exactly, so swapping it
 * for SupabaseWdrApi requires no component change.
 *
 * It deliberately reproduces the behaviour the real database has on day one:
 * NO compensation rules are configured, so the preview returns MISSING_RULE for
 * every monetary line and `can_submit = false`. Set `VITE_WDR_MOCK_RATES=demo`
 * to see the "complete" preview path; those numbers are clearly marked DEMO in
 * the UI and are not seed data.
 */

const CENTER_B6 = '10000000-0000-0000-0000-0000000000b6';
const CENTER_BZ = '10000000-0000-0000-0000-0000000000bz'.replace('bz', 'b2');
const SUBMISSION_B6 = '66666666-6666-6666-6666-666666666601';
const SUBMISSION_BZ = '66666666-6666-6666-6666-666666666602';
const PERIOD = '55555555-5555-5555-5555-555555555501';

// DEMO podaci za modul „Stopovi kurira". Sve ispod je sintetičko i postoji
// isključivo radi lokalnog pregleda toka bez baze.
const STOP_DEMO_CENTERS = [
  { id: CENTER_B6, code: 'B6', name: 'Centar B6 (DEMO)' },
  { id: CENTER_BZ, code: 'BZ', name: 'Centar BZ (DEMO)' },
];
const STOP_DEMO_PERIODS = [
  { id: PERIOD, label: '06.07.–12.07.2026. (DEMO)',
    period_start: '2026-07-06', period_end: '2026-07-12' },
];

const SHIFTS = [
  { id: 's1', code: '06-14', label: '06:00–14:00', shift_start: '06:00:00', shift_end: '14:00:00', crosses_midnight: false },
  { id: 's2', code: '14-22', label: '14:00–22:00', shift_start: '14:00:00', shift_end: '22:00:00', crosses_midnight: false },
  { id: 's3', code: '22-06', label: '22:00–06:00', shift_start: '22:00:00', shift_end: '06:00:00', crosses_midnight: true },
  { id: 's4', code: '12-20', label: '12:00–20:00', shift_start: '12:00:00', shift_end: '20:00:00', crosses_midnight: false },
];

const PT_KARNET = 'pt-karnet';
const PT_OBUKA = 'pt-obuka';
const PT_PREKOVREMENI = 'pt-prekovremeni';
const PT_ISPOMOC = 'pt-ispomoc';

interface MockEmployee {
  employee_id: Uuid;
  full_name: string;
  employee_code: string;
  center_id: Uuid;
  primary_payment_type_id: Uuid;
  primary_payment_type_code: string;
  default_shift_template_id: Uuid;
  transport_required: boolean | null;
  transport_provider_code: string | null;
}

const EMPLOYEES: MockEmployee[] = [
  { employee_id: 'e1', full_name: 'Marković Marko', employee_code: 'E-001', center_id: CENTER_B6, primary_payment_type_id: PT_KARNET, primary_payment_type_code: 'KARNET', default_shift_template_id: 's1', transport_required: false, transport_provider_code: null },
  { employee_id: 'e2', full_name: 'Jovanović Ana', employee_code: 'E-003', center_id: CENTER_B6, primary_payment_type_id: PT_KARNET, primary_payment_type_code: 'KARNET', default_shift_template_id: 's1', transport_required: true, transport_provider_code: 'GAMZED' },
  { employee_id: 'e3', full_name: 'Ilić Dragana', employee_code: 'E-007', center_id: CENTER_B6, primary_payment_type_id: PT_OBUKA, primary_payment_type_code: 'OBUKA', default_shift_template_id: 's2', transport_required: true, transport_provider_code: 'GAMZED' },
  { employee_id: 'e4', full_name: 'Nikolić Stefan', employee_code: 'E-011', center_id: CENTER_B6, primary_payment_type_id: PT_KARNET, primary_payment_type_code: 'KARNET', default_shift_template_id: 's1', transport_required: null, transport_provider_code: null },
  { employee_id: 'e5', full_name: 'Petrović Petar', employee_code: 'E-002', center_id: CENTER_BZ, primary_payment_type_id: PT_OBUKA, primary_payment_type_code: 'OBUKA', default_shift_template_id: 's2', transport_required: true, transport_provider_code: 'KNEZEVIC' },
];

interface MockEntry {
  work_entry_id: Uuid;
  employee_id: Uuid;
  work_date: IsoDate;
  attendance_status: GridCellPayload['attendance_status'];
  owner_submission_id: Uuid;
  notes: string | null;
  segments: GridSegment[];
  components?: GridCellPayload['components'];
}

function datesOf(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const d = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export class MockWdrApi implements WdrApi {
  private signedIn = false;
  private entries: MockEntry[] = [];
  private nextSegmentId = 100;
  private listeners = new Set<() => void>();
  private readonly demoRates: boolean;
  /**
   * The mock session is an operator by default. VITE_WDR_MOCK_ROLE=finance
   * switches it to Finance so the /finansije screens can be developed without a
   * database — it does NOT widen the seeded role matrix, it picks a different
   * seeded role.
   */
  private readonly role: 'operator' | 'finance' | 'admin';
  private approval: FinanceApproveResult | null = null;
  private adjustments: Adjustment[] = [];
  private nextAdjustmentId = 1;
  /**
   * Expected working dates come from the server in production. The mock mirrors
   * the seeded default pattern: Monday–Saturday, Sunday not expected.
   */
  // Mirrors the per-center production configuration: Monday–Friday. Saturday is
  // NOT a standing expected day; it is added per week through setExpectedDate.
  private expectedDates: IsoDate[] = [
    '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10',
  ];
  /** Prijave koje je operater sam otvorio kroz createPeriodSubmission. */
  private createdSubmissions: SubmissionListItem[] = [];
  private acks = new Set<string>();
  private status: GridPayload['submission']['status'] = 'DRAFT';
  private submittedAt: string | null = null;

  constructor(opts: { demoRates?: boolean; role?: 'operator' | 'finance' | 'admin' } = {}) {
    this.demoRates = opts.demoRates ?? false;
    this.role = opts.role ?? 'operator';
    // One pre-existing foreign assistance segment, so the read-only indicator is
    // visible without having to create it first.
    this.entries.push({
      work_entry_id: 'we-seed-1',
      employee_id: 'e2',
      work_date: '2026-07-07',
      attendance_status: 'WORK',
      owner_submission_id: SUBMISSION_B6,
      notes: null,
      segments: [
        { id: 1, center_code: 'B6', cost_center_code: 'B6', segment_type: 'REGULAR', shift_template_id: 's1', shift_start: '06:00:00', shift_end: '14:00:00', crosses_midnight: false, worked_hours: 8, sequence_no: 1, in_this_submission: true, editable_here: true },
        { id: 2, center_code: 'BZ', cost_center_code: 'BZ', segment_type: 'ASSISTANCE', shift_template_id: null, shift_start: '14:00:00', shift_end: '18:00:00', crosses_midnight: false, worked_hours: 4, sequence_no: 2, in_this_submission: false, editable_here: false },
      ],
    });
  }

  // --- session -------------------------------------------------------------

  async signIn(email: string, password: string): Promise<void> {
    await delay(250);
    if (!email.includes('@') || password.length < 4) {
      throw new WdrApiError('Neispravna e-adresa ili šifra.', 'invalid_credentials');
    }
    this.signedIn = true;
    this.notify();
  }

  async signOut(): Promise<void> {
    this.signedIn = false;
    this.notify();
  }

  onAuthChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async getSession(): Promise<SessionProfile | null> {
    await delay(120);
    if (!this.signedIn) return null;

    if (this.role === 'admin') {
      return {
        profile_id: 'p4',
        full_name: 'Administrator (mock)',
        email: 'admin@wdr.local',
        roles: ['SUPER_ADMIN_BA'],
        permissions: [
          'entry.view', 'period.view_status', 'employee.view',
          'centers.manage', 'reference.manage', 'payment_types.manage',
          'rules.compensation.manage', 'rules.transport.manage', 'providers.manage',
          'users.manage', 'roles.manage', 'adjustment.create', 'adjustment.submit',
          'adjustment.manage_all', 'notification.view_own',
          'employee.view', 'employee.create', 'employee.edit', 'employee.assign_center',
          'transport.assign_employee',
          // BA nije finansijska funkcija; nosi je administrator/BA.
          'analytics.ba.view', 'analytics.employee.view', 'analytics.daily.view',
          'controls.view', 'controls.run', 'controls.review', 'controls.manage',
        ],
        centers: [{ center_id: CENTER_B6, center_code: 'B6', center_name: 'Rakovica',
                    can_write: true }],
      };
    }

    if (this.role === 'finance') {
      return {
        profile_id: 'p3',
        full_name: 'Finansije (mock)',
        email: 'finansije@wdr.local',
        roles: ['FINANCE'],
        permissions: [
          // Bez `employee.view`: finansije koriste Finance ekrane, ne Employee Master.
          'period.view_status',
          'finance.queue.view', 'finance.approve', 'finance.return',
          'finance.history.view', 'finance.export',
          'adjustment.approve', 'comment.write', 'notification.view_own',
        ],
        centers: [],
      };
    }

    return {
      profile_id: 'p1',
      full_name: 'Operater B6 (mock)',
      email: 'operater@wdr.local',
      roles: ['DATA_ENTRY_OPERATOR'],
      permissions: [
        'entry.view', 'entry.edit_draft', 'entry.bulk_apply',
        'period.submit', 'period.view_status', 'employee.view',
        'employee.create', 'employee.edit', 'employee.assign_center',
        'transport.assign_employee',
        'comment.write', 'notification.view_own',
      ],
      centers: [{ center_id: CENTER_B6, center_code: 'B6', center_name: 'Rakovica', can_write: true }],
    };
  }

  // --- submissions ---------------------------------------------------------

  async listSubmissions(): Promise<SubmissionListItem[]> {
    await delay(120);
    return [
      { id: SUBMISSION_B6, center_id: CENTER_B6, center_code: 'B6', period_id: PERIOD, period_label: '2026-W28 (06.07–12.07)', period_start: '2026-07-06', period_end: '2026-07-12', status: this.status },
      ...this.createdSubmissions,
    ];
  }

  /**
   * Ogledalo predloženog `api.rpc_create_period_submission`. Mock sprovodi ISTE
   * provere kao predložena migracija kako bi ekran mogao da se razvija bez baze:
   * pravo nad centrom, from <= to, dužina raspona i preklapanje po centru.
   * U produkciji je baza ta koja odlučuje — ovo nije zamena za nju.
   */
  async createPeriodSubmission(
    centerId: Uuid,
    periodStart: IsoDate,
    periodEnd: IsoDate,
  ): Promise<CreatePeriodSubmissionResult> {
    await delay(200);

    const session = await this.getSession();
    if (!session) throw new WdrApiError('Nije prijavljen korisnik.', '42501');

    const allowed = session.centers.find((c) => c.center_id === centerId && c.can_write);
    if (!allowed) {
      throw new WdrApiError('Nemate pravo unosa za izabrani centar.', 'CENTER_NOT_ALLOWED');
    }
    if (periodEnd < periodStart) {
      throw new WdrApiError('Datum „do" ne sme biti pre datuma „od".', 'PERIOD_RANGE_INVALID');
    }

    const days =
      Math.round(
        (Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) / 86400000,
      ) + 1;
    if (days > 62) {
      throw new WdrApiError('Period je duži od 62 dana.', 'PERIOD_RANGE_TOO_LONG');
    }

    const existing = await this.listSubmissions();
    const same = existing.find(
      (x) => x.center_id === centerId && x.period_start === periodStart && x.period_end === periodEnd,
    );
    if (same) {
      // Ponovni izbor istog raspona nije uvek nastavak rada — poslata i
      // odobrena prijava se NE otvaraju kroz „Novi unos".
      const decision = decidePeriodReuse(same.status);
      if (decision.kind === 'blocked') {
        throw new WdrApiError(decision.message, decision.code);
      }
      return {
        submission_id: same.id, center_id: same.center_id, center_code: same.center_code,
        period_id: same.period_id, period_label: same.period_label,
        period_start: same.period_start, period_end: same.period_end,
        status: same.status, created: false,
      };
    }
    const overlaps = existing.some(
      (x) => x.center_id === centerId && x.period_start <= periodEnd && x.period_end >= periodStart,
    );
    if (overlaps) {
      throw new WdrApiError(
        `Za centar ${allowed.center_code} već postoji prijava koja se preklapa sa tim periodom.`,
        'PERIOD_OVERLAPS_EXISTING',
      );
    }

    const item: SubmissionListItem = {
      id: `77777777-7777-7777-7777-${String(this.createdSubmissions.length + 1).padStart(12, '0')}`,
      center_id: centerId,
      center_code: allowed.center_code,
      period_id: `55555555-5555-5555-5555-${String(this.createdSubmissions.length + 900).padStart(12, '0')}`,
      period_label: `${periodStart} – ${periodEnd}`,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'DRAFT',
    };
    this.createdSubmissions.push(item);

    return {
      submission_id: item.id, center_id: item.center_id, center_code: item.center_code,
      period_id: item.period_id, period_label: item.period_label,
      period_start: item.period_start, period_end: item.period_end,
      status: 'DRAFT', created: true,
    };
  }

  // --- daily entry ---------------------------------------------------------

  async getGrid(submissionId: Uuid): Promise<GridPayload> {
    await delay(200);

    const created = this.createdSubmissions.find((x) => x.id === submissionId);
    if (created) return this.gridForCreated(created);

    if (submissionId !== SUBMISSION_B6) {
      throw new WdrApiError('Nemate pristup centru ove prijave.', '42501');
    }
    const dates = datesOf('2026-07-06', '2026-07-12');

    return {
      submission: {
        id: SUBMISSION_B6, center_id: CENTER_B6, center_code: 'B6', center_name: 'Rakovica',
        period_id: PERIOD, period_start: '2026-07-06', period_end: '2026-07-12',
        status: this.status,
        review_confirmed: this.status !== 'DRAFT',
        editable: this.status === 'DRAFT' || this.status === 'RETURNED',
        can_write: true,
      },
      dates,
      reference: {
        attendance_statuses: [
          { code: 'WORK', name: 'Rad', allows_segments: true },
          { code: 'GO', name: 'Godišnji odmor', allows_segments: false },
          { code: 'BO', name: 'Bolovanje', allows_segments: false },
          { code: 'OFF', name: 'Slobodan dan', allows_segments: false },
          { code: 'NOT_WORKING', name: 'Ne radi', allows_segments: false },
          { code: 'OTHER', name: 'Ostalo', allows_segments: false },
        ],
        shift_templates: SHIFTS,
        payment_types: [
          { id: PT_KARNET, code: 'KARNET', name: 'Karnet', kind: 'PRIMARY', default_unit_type: 'PER_WORKED_DAY', requires_units: false, allows_cost_center_override: false },
          { id: PT_OBUKA, code: 'OBUKA', name: 'Obuka', kind: 'PRIMARY', default_unit_type: 'PER_WORKED_DAY', requires_units: false, allows_cost_center_override: false },
          { id: PT_PREKOVREMENI, code: 'PREKOVREMENI', name: 'Prekovremeni rad', kind: 'COMPONENT', default_unit_type: 'PER_HOUR', requires_units: true, allows_cost_center_override: true },
          { id: PT_ISPOMOC, code: 'ISPOMOC', name: 'Ispomoć', kind: 'COMPONENT', default_unit_type: 'PER_EVENT', requires_units: true, allows_cost_center_override: true },
        ],
        segment_types: [
          { code: 'REGULAR', name: 'Redovan rad', counts_as_worked_day: true },
          { code: 'ASSISTANCE', name: 'Ispomoć', counts_as_worked_day: true },
          { code: 'OVERTIME', name: 'Prekovremeni rad', counts_as_worked_day: false },
          { code: 'OTHER', name: 'Ostalo', counts_as_worked_day: false },
        ],
        centers: [
          { id: CENTER_B6, code: 'B6', name: 'Rakovica' },
          { id: CENTER_BZ, code: 'BZ', name: 'Bežanija' },
        ],
      },
      employees: EMPLOYEES.filter((e) => e.center_id === CENTER_B6).map((e) => ({
        employee_id: e.employee_id,
        full_name: e.full_name,
        employee_code: e.employee_code,
        home_center_code: 'B6',
        primary_payment_type_id: e.primary_payment_type_id,
        primary_payment_type_code: e.primary_payment_type_code,
        default_shift_template_id: e.default_shift_template_id,
        transport_required: e.transport_required,
        transport_provider_code: e.transport_provider_code,
      })),
      cells: this.entries.map((e) => this.toCell(e)),
      validation: this.validate(),
    };
  }

  /**
   * Prazan grid za prijavu koju je operater sam otvorio. Isti referentni podaci,
   * ali datumi i centar dolaze iz same prijave. Nema ćelija — period je nov.
   */
  private gridForCreated(item: SubmissionListItem): GridPayload {
    const dates = datesOf(item.period_start, item.period_end);
    return {
      submission: {
        id: item.id,
        center_id: item.center_id,
        center_code: item.center_code,
        center_name: item.center_code === 'B6' ? 'Rakovica' : 'Bežanija',
        period_id: item.period_id,
        period_start: item.period_start,
        period_end: item.period_end,
        status: item.status,
        review_confirmed: false,
        editable: item.status === 'DRAFT' || item.status === 'RETURNED',
        can_write: true,
      },
      dates,
      reference: {
        attendance_statuses: [
          { code: 'WORK', name: 'Rad', allows_segments: true },
          { code: 'GO', name: 'Godišnji odmor', allows_segments: false },
          { code: 'BO', name: 'Bolovanje', allows_segments: false },
          { code: 'OFF', name: 'Slobodan dan', allows_segments: false },
          { code: 'NOT_WORKING', name: 'Ne radi', allows_segments: false },
          { code: 'OTHER', name: 'Ostalo', allows_segments: false },
        ],
        shift_templates: SHIFTS,
        payment_types: [
          { id: PT_KARNET, code: 'KARNET', name: 'Karnet', kind: 'PRIMARY', default_unit_type: 'PER_WORKED_DAY', requires_units: false, allows_cost_center_override: false },
          { id: PT_OBUKA, code: 'OBUKA', name: 'Obuka', kind: 'PRIMARY', default_unit_type: 'PER_WORKED_DAY', requires_units: false, allows_cost_center_override: false },
          { id: PT_PREKOVREMENI, code: 'PREKOVREMENI', name: 'Prekovremeni rad', kind: 'COMPONENT', default_unit_type: 'PER_HOUR', requires_units: true, allows_cost_center_override: true },
          { id: PT_ISPOMOC, code: 'ISPOMOC', name: 'Ispomoć', kind: 'COMPONENT', default_unit_type: 'PER_EVENT', requires_units: true, allows_cost_center_override: true },
        ],
        segment_types: [
          { code: 'REGULAR', name: 'Redovan rad', counts_as_worked_day: true },
          { code: 'ASSISTANCE', name: 'Ispomoć', counts_as_worked_day: true },
          { code: 'OVERTIME', name: 'Prekovremeni rad', counts_as_worked_day: false },
          { code: 'OTHER', name: 'Ostalo', counts_as_worked_day: false },
        ],
        centers: [
          { id: CENTER_B6, code: 'B6', name: 'Rakovica' },
          { id: CENTER_BZ, code: 'BZ', name: 'Bežanija' },
        ],
      },
      employees: EMPLOYEES.filter((e) => e.center_id === item.center_id).map((e) => ({
        employee_id: e.employee_id,
        full_name: e.full_name,
        employee_code: e.employee_code,
        home_center_code: item.center_code,
        primary_payment_type_id: e.primary_payment_type_id,
        primary_payment_type_code: e.primary_payment_type_code,
        default_shift_template_id: e.default_shift_template_id,
        transport_required: e.transport_required,
        transport_provider_code: e.transport_provider_code,
      })),
      cells: [],
      validation: { errors: 0, warnings: 0 },
    };
  }

  async bulkUpsert(
    submissionId: Uuid,
    entries: BulkEntryInput[],
    atomic: boolean,
  ): Promise<BulkUpsertResult> {
    await delay(180);
    const results: BulkRowResult[] = [];
    const snapshot = structuredClone(this.entries);
    let ok = 0;
    let failed = 0;

    for (const item of entries) {
      try {
        results.push(this.applyOne(submissionId, item));
        ok += 1;
      } catch (err) {
        const e = err as WdrApiError;
        if (atomic) {
          this.entries = snapshot;
          throw e;
        }
        failed += 1;
        results.push({
          employee_id: item.employee_id,
          work_date: item.work_date,
          status: 'ERROR',
          error_code: e.code ?? 'UNKNOWN',
          error_message: e.message,
        });
      }
    }

    return {
      submission_id: submissionId,
      atomic,
      succeeded: ok,
      failed,
      results,
      validation: this.validate(),
    };
  }

  async setOvertimeComponent(
    input: OvertimeComponentInput,
  ): Promise<OvertimeComponentResult> {
    await delay(120);

    const entry = this.entries.find(
      (e) => e.employee_id === input.p_employee_id && e.work_date === input.p_work_date,
    );

    if (!entry) throw new WdrApiError('Za zaposlenog i datum prvo mora postojati dnevni unos.', 'P0002');
    if (entry.attendance_status !== 'WORK') {
      throw new WdrApiError('Prekovremeni sati mogu se uneti samo za radni dan.', '22023');
    }
    if (input.p_units != null && input.p_units < 0) {
      throw new WdrApiError('Broj prekovremenih sati ne može biti negativan.', '22023');
    }

    entry.components = (entry.components ?? []).filter(
      (c) => !(c.payment_type_code === 'PREKOVREMENI' && c.work_segment_id == null),
    );

    if ((input.p_units ?? 0) > 0) {
      const nextId = Math.max(0, ...entry.components.map((c) => c.id)) + 1;
      entry.components.push({
        id: nextId,
        payment_type_id: PT_PREKOVREMENI,
        payment_type_code: 'PREKOVREMENI',
        work_segment_id: null,
        units: input.p_units!,
        cost_center_code: null,
        in_this_submission: true,
      });
    }

    return {
      work_entry_id: entry.work_entry_id,
      employee_id: entry.employee_id,
      work_date: entry.work_date,
      payment_type_id: PT_PREKOVREMENI,
      units: input.p_units ?? 0,
    };
  }

  async addAssistanceSegment(input: AssistanceSegmentInput): Promise<AssistanceSegmentResult> {
    await delay(180);
    const emp = EMPLOYEES.find((e) => e.employee_id === input.p_employee_id);
    if (!emp) throw new WdrApiError('Zaposleni ne postoji.', 'P0002');
    if (input.p_cost_center_id && input.p_cost_center_id !== input.p_work_center_id) {
      throw new WdrApiError(
        'Prebacivanje troška na drugi centar zahteva permisiju cost_center.override (COST_CENTER_OVERRIDE_DENIED).',
        'COST_CENTER_OVERRIDE_DENIED',
      );
    }

    let entry = this.entries.find(
      (e) => e.employee_id === input.p_employee_id && e.work_date === input.p_work_date,
    );
    const createdEntry = !entry;
    if (!entry) {
      entry = {
        work_entry_id: `we-${input.p_employee_id}-${input.p_work_date}`,
        employee_id: input.p_employee_id,
        work_date: input.p_work_date,
        attendance_status: 'WORK',
        owner_submission_id: SUBMISSION_B6,
        notes: null,
        segments: [],
      };
      this.entries.push(entry);
    }

    const start = input.p_shift_start ?? '00:00:00';
    const end = input.p_shift_end ?? '00:00:00';
    const centerCode = input.p_work_center_id === CENTER_BZ ? 'BZ' : 'B6';

    const existing = entry.segments.find(
      (s) =>
        s.center_code === centerCode &&
        s.shift_start === start &&
        s.shift_end === end &&
        s.segment_type === (input.p_segment_type ?? 'ASSISTANCE'),
    );

    const seg: GridSegment =
      existing ??
      {
        id: this.nextSegmentId++,
        center_code: centerCode,
        cost_center_code: centerCode,
        segment_type: input.p_segment_type ?? 'ASSISTANCE',
        shift_template_id: input.p_shift_template_id ?? null,
        shift_start: start,
        shift_end: end,
        crosses_midnight: end <= start,
        worked_hours: hoursBetween(start, end),
        sequence_no: entry.segments.length + 1,
        in_this_submission: centerCode === 'B6',
        editable_here: centerCode === 'B6',
      };
    if (!existing) entry.segments.push(seg);

    return {
      work_entry_id: entry.work_entry_id,
      work_segment_id: seg.id,
      created_work_entry: createdEntry,
      created_work_segment: !existing,
      employee_id: entry.employee_id,
      work_date: entry.work_date,
      segment_type: seg.segment_type,
      shift_start: seg.shift_start,
      shift_end: seg.shift_end,
      sequence_no: seg.sequence_no,
      worked_hours: seg.worked_hours,
      crosses_midnight: seg.crosses_midnight,
      home_center_code: 'B6',
      work_center_code: seg.center_code,
      cost_center_code: seg.cost_center_code,
      home_submission_id: SUBMISSION_B6,
      work_submission_id: seg.center_code === 'B6' ? SUBMISSION_B6 : SUBMISSION_BZ,
    };
  }

  // --- preview -------------------------------------------------------------

  async getSubmissionPreview(submissionId: Uuid): Promise<SubmissionPreview> {
    await delay(200);
    const lines: PreviewLine[] = [];

    for (const e of this.entries) {
      const emp = EMPLOYEES.find((x) => x.employee_id === e.employee_id);
      if (!emp) continue;
      const resolved = this.demoRates;
      const rate = resolved ? (emp.primary_payment_type_code === 'OBUKA' ? 2000 : 4000) : null;

      lines.push({
        work_entry_id: e.work_entry_id,
        employee_id: e.employee_id,
        employee_name: emp.full_name,
        work_date: e.work_date,
        line_kind: 'PRIMARY',
        payment_type_code: emp.primary_payment_type_code,
        basis: 'HOME_CENTER',
        center_code: 'B6',
        rule_id: resolved ? 'demo-rule' : null,
        rule_version: resolved ? 1 : null,
        rate,
        unit_type: 'PER_WORKED_DAY',
        units: 1,
        calculated_amount: rate,
        status: resolved ? 'RESOLVED' : 'MISSING_RULE',
      });

      if (emp.transport_required && e.attendance_status === 'WORK') {
        const tRate = resolved ? 500 : null;
        lines.push({
          work_entry_id: e.work_entry_id,
          employee_id: e.employee_id,
          employee_name: emp.full_name,
          work_date: e.work_date,
          line_kind: 'TRANSPORT',
          payment_type_code: emp.transport_provider_code,
          basis: 'HOME_CENTER',
          center_code: 'B6',
          rule_id: resolved ? 'demo-transport' : null,
          rule_version: resolved ? 1 : null,
          rate: tRate,
          unit_type: 'PER_ELIGIBLE_WORKED_DAY',
          units: 1,
          calculated_amount: tRate,
          status: resolved ? 'RESOLVED' : 'MISSING_RULE',
        });
      }
    }

    const blocking = lines.filter(
      (l) => l.status === 'MISSING_RULE' || l.status === 'MISSING_PAYMENT_TYPE',
    );
    const completeness = this.completeness();
    const warnings = this.warnings();
    const hardErrors = this.hardErrors(completeness);
    const unack = warnings.filter((w) => !w.acknowledged).length;
    const subtotal = lines.reduce((s, l) => s + (l.calculated_amount ?? 0), 0);
    const byKind: Record<string, number> = {};
    for (const l of lines) {
      byKind[l.line_kind] = (byKind[l.line_kind] ?? 0) + (l.calculated_amount ?? 0);
    }
    return {
      submission: {
        id: submissionId, center_id: CENTER_B6, center_code: 'B6',
        period_start: '2026-07-06', period_end: '2026-07-12',
        status: this.status,
        editable: this.status === 'DRAFT' || this.status === 'RETURNED',
      },
      completeness,
      lines,
      totals: {
        by_line_kind: byKind,
        resolved_subtotal: subtotal,
        total_calculated_amount: blocking.length === 0 ? subtotal : null,
        is_complete: blocking.length === 0,
        blocking_line_count: blocking.length,
      },
      resolved_by_center: { B6: subtotal },
      blocking,
      hard_errors: hardErrors,
      hard_error_count: hardErrors.length,
      warnings,
      unacknowledged_warning_count: unack,
      incomplete_override: null,
      ready_to_submit: blocking.length === 0 && hardErrors.length === 0 && unack === 0,
      can_submit: blocking.length === 0 && hardErrors.length === 0 && unack === 0,
      is_estimate: true,
      note: 'Procena po važećim pravilima. Ne upisuje se u bazu i nije odobrenje.',
    };
  }

  async acknowledgeWarnings(
    _submissionId: Uuid,
    fingerprints: string[],
  ): Promise<number> {
    await delay(120);
    const live = new Set(this.warnings().map((w) => w.fingerprint));
    let n = 0;
    for (const f of fingerprints) {
      // Only a warning that exists right now can be acknowledged, exactly as the
      // database behaves.
      if (live.has(f) && !this.acks.has(f)) {
        this.acks.add(f);
        n += 1;
      }
    }
    return n;
  }

  async submitPeriod(
    submissionId: Uuid,
    reviewConfirmed: boolean,
    incompleteReason?: string | null,
  ): Promise<SubmitPeriodResult> {
    await delay(250);
    if (!reviewConfirmed) {
      throw new WdrApiError('Potvrda pregleda je obavezna pre slanja.', '23514');
    }

    const c = this.completeness();
    if (c.missing_count > 0) {
      if (!incompleteReason) {
        throw new WdrApiError(
          `Nije pregledano ${c.missing_count} od ${c.expected_count} očekivanih employee-dana (INCOMPLETE_EXPECTED_ENTRIES).`,
          'INCOMPLETE_EXPECTED_ENTRIES',
        );
      }
      // The mock operator has no period.submit_incomplete permission, matching
      // the seeded role matrix.
      throw new WdrApiError(
        'Slanje nepotpunog perioda zahteva permisiju period.submit_incomplete (INCOMPLETE_OVERRIDE_DENIED).',
        'INCOMPLETE_OVERRIDE_DENIED',
      );
    }

    const hard = this.hardErrors(c);
    if (hard.length > 0) {
      throw new WdrApiError(
        `Prijava sadrži ${hard.length} blokirajuću(ih) grešku(a); slanje nije moguće.`,
        '23514',
      );
    }

    const unack = this.warnings().filter((w) => !w.acknowledged).length;
    if (unack > 0) {
      throw new WdrApiError(
        `Postoji ${unack} nepotvrđeno(ih) upozorenja; potvrdite ih pre slanja.`,
        '23514',
      );
    }

    // An unresolved monetary rule blocks submission just like a hard error does.
    const preview = await this.getSubmissionPreview(submissionId);
    if (preview.totals.blocking_line_count > 0) {
      throw new WdrApiError(
        `Prijava sadrži ${preview.totals.blocking_line_count} stavku(e) bez konfigurisanog pravila obračuna.`,
        'MISSING_COMPENSATION_RULE',
      );
    }

    this.status = 'SUBMITTED';
    this.submittedAt = new Date().toISOString();
    this.notify();

    return {
      submission_id: submissionId,
      status: 'SUBMITTED',
      submitted_at: this.submittedAt,
      expected_count: c.expected_count,
      reviewed_count: c.reviewed_count,
      missing_count: 0,
      incomplete_override: false,
      notified_approvers: 1,
      acknowledged_warnings: this.warnings().map((w) => ({
        code: w.code, message: w.message, fingerprint: w.fingerprint,
      })),
    };
  }

  async setExpectedDate(
    _submissionId: Uuid,
    _date: IsoDate,
    _isExpected: boolean,
    reason: string,
  ): Promise<void> {
    await delay(120);
    // The mock session is an operator, and only centers.manage may change this.
    if (reason.trim().length < 5) {
      throw new WdrApiError('Izuzetak zahteva obrazloženje (najmanje 5 znakova).', '22023');
    }
    if (this.status !== 'DRAFT' && this.status !== 'RETURNED') {
      throw new WdrApiError(
        `Očekivani dani se ne mogu menjati u statusu ${this.status} (EXPECTED_DATES_WINDOW_CLOSED).`,
        'EXPECTED_DATES_WINDOW_CLOSED',
      );
    }
    throw new WdrApiError(
      'Nedovoljna prava: potrebna permisija centers.manage.',
      '42501',
    );
    // Reference implementation for an administrator session:
    //   isExpected ? this.expectedDates.push(date) : remove(date)
  }

  // --- finance -------------------------------------------------------------

  async getFinanceQueue(
    statuses: FinanceQueueStatus[] = ['SUBMITTED'],
  ): Promise<FinanceQueue> {
    await delay(180);
    if (this.role !== 'finance') {
      throw new WdrApiError(
        'Nedovoljna prava: potrebna permisija finance.queue.view.', '42501',
      );
    }

    const queueStatuses: string[] = ['SUBMITTED', 'RETURNED', 'FINANCE_APPROVED', 'CLOSED'];
    const bad = statuses.filter((st) => !queueStatuses.includes(st));
    if (bad.length > 0) {
      throw new WdrApiError(
        `Nedozvoljen status u filteru reda za odobrenje: ${bad.join(', ')}.`, '22023',
      );
    }

    const visible = statuses.includes(this.status as FinanceQueueStatus);
    const recap = await this.financeRecap();
    const items = visible
      ? [{
          submission_id: SUBMISSION_B6,
          center_id: CENTER_B6,
          center_code: 'B6',
          center_name: 'Rakovica',
          period_id: PERIOD,
          period_label: '2026-W28 (06.07–12.07)',
          period_start: '2026-07-06',
          period_end: '2026-07-12',
          status: this.status as FinanceQueueStatus,
          submitted_at: this.submittedAt,
          submitted_by: 'Operater B6 (mock)',
          waiting_hours: this.waitingHours(),
          waiting_days: this.waitingHours() === null
            ? null
            : Math.floor((this.waitingHours() as number) / 24),
          hard_error_count: this.hardErrors(this.completeness()).length,
          overridden_error_count: 0,
          unacknowledged_warning_count:
            this.warnings().filter((w) => !w.acknowledged).length,
          incomplete_override: false,
          recap,
          approved: this.approval
            ? {
                approved_at: this.approval.approved_at,
                approved_by: 'Finansije (mock)',
                approved_amount: this.approval.approved_amount,
                payable_amount: this.approval.payable_amount,
                snapshot_id: this.approval.snapshot_id,
                content_hash: this.approval.content_hash,
                submitted_incomplete: false,
              }
            : null,
        }]
      : [];

    return {
      filters: { statuses, center_ids: [], date_from: null, date_to: null },
      items,
      totals: {
        count: items.length,
        by_status: items.length > 0 ? { [this.status]: 1 } : {},
        approvable_total: items
          .filter((i) => i.recap.is_complete)
          .reduce((sum, i) => sum + (i.recap.ukupno_za_odobrenje ?? 0), 0),
        blocked_count: items.filter(
          (i) => !i.recap.is_complete || i.hard_error_count > 0,
        ).length,
        incomplete_override_count: 0,
      },
      engine_version: 'wdr-calc-1.0.0 (mock)',
    };
  }

  async getFinanceSubmission(submissionId: Uuid): Promise<FinanceSubmissionDetail> {
    await delay(200);
    if (submissionId !== SUBMISSION_B6) {
      throw new WdrApiError('Nemate pristup ovoj prijavi.', '42501');
    }

    const preview = await this.getSubmissionPreview(submissionId);
    const recap = await this.financeRecap();
    const lines: CalcLine[] = preview.lines.map((l, i) => ({
      line_no: i + 1,
      work_entry_id: l.work_entry_id,
      employee_id: l.employee_id,
      employee_name: l.employee_name,
      employee_code: null,
      work_date: l.work_date,
      attendance_status: 'WORK',
      segment_type: null,
      shift_start: null,
      shift_end: null,
      crosses_midnight: null,
      worked_hours: null,
      line_kind: l.line_kind,
      payment_type_code: l.line_kind === 'TRANSPORT' ? 'PREVOZ' : l.payment_type_code,
      basis: l.basis,
      center_code: l.center_code,
      cost_center_code: null,
      unit_type: l.unit_type,
      units: l.units,
      rate: l.rate,
      amount: l.calculated_amount,
      transport_provider_code: l.line_kind === 'TRANSPORT' ? l.payment_type_code : null,
      responsible_person_code: l.line_kind === 'TRANSPORT' ? 'GAMZED_RESP' : null,
      liters: null,
      status: l.status === 'RESOLVED' ? 'RESOLVED' : l.status,
      pricing_problem: null,
    }));

    const days = new Map<string, CalcLine[]>();
    for (const l of lines) {
      const key = `${l.employee_id}|${l.work_date}`;
      days.set(key, [...(days.get(key) ?? []), l]);
    }

    const transportLines = lines.filter((l) => l.line_kind === 'TRANSPORT');
    const transportAmount = transportLines.reduce((s, l) => s + (l.amount ?? 0), 0);
    const blockers: FinanceSubmissionDetail['approval_blockers'] = [];
    if (this.status !== 'SUBMITTED') blockers.push('WRONG_STATUS');
    if (preview.hard_error_count > 0) blockers.push('HARD_ERRORS');
    if (preview.unacknowledged_warning_count > 0) blockers.push('UNACKNOWLEDGED_WARNINGS');
    if (!recap.is_complete) blockers.push('INCOMPLETE_CALCULATION');
    if (this.role !== 'finance') blockers.push('NO_PERMISSION');

    return {
      submission: {
        id: SUBMISSION_B6,
        center_id: CENTER_B6,
        center_code: 'B6',
        center_name: 'Rakovica',
        period_id: PERIOD,
        period_label: '2026-W28 (06.07–12.07)',
        period_start: '2026-07-06',
        period_end: '2026-07-12',
        status: this.status,
        submitted_at: this.submittedAt,
        submitted_by: 'Operater B6 (mock)',
        returned_at: null,
        approved_at: this.approval?.approved_at ?? null,
        closed_at: null,
        crosses_month: false,
      },
      engine_version: 'wdr-calc-1.0.0 (mock)',
      rounding_config: { mode: 'HALF_UP', scale: 2, level: 'LINE' },
      recap,
      employee_days: Array.from(days.entries()).map(([key, dayLines]) => {
        const [employeeId, workDate] = key.split('|');
        const blocking = dayLines.filter((l) => l.status !== 'RESOLVED' && l.amount === null
          && l.status !== 'NOT_ELIGIBLE' && l.status !== 'NO_TRANSPORT_ASSIGNMENT').length;
        const subtotal = dayLines.reduce((s, l) => s + (l.amount ?? 0), 0);
        return {
          employee_id: employeeId,
          employee_name: dayLines[0].employee_name,
          employee_code: null,
          work_date: workDate,
          attendance_status: 'WORK' as const,
          worked_hours: null,
          day_amount: blocking === 0 ? subtotal : null,
          day_resolved_subtotal: subtotal,
          blocking_line_count: blocking,
          lines: dayLines,
        };
      }),
      transport: {
        groups: transportLines.length > 0
          ? [{
              transport_provider_code: 'GAMZED',
              responsible_person_code: 'GAMZED_RESP',
              center_code: 'B6',
              rate: transportLines[0].rate,
              liters_per_unit: null,
              eligible_employee_days: transportLines.length,
              units: transportLines.length,
              amount: recap.is_complete ? transportAmount : null,
              blocking_line_count: recap.is_complete ? 0 : transportLines.length,
              status: recap.is_complete ? 'RESOLVED' : 'MISSING_RULE',
            }]
          : [],
        by_provider: recap.is_complete ? { GAMZED: transportAmount } : {},
        by_responsible_person: recap.is_complete ? { GAMZED_RESP: transportAmount } : {},
        not_eligible_count: 0,
        no_assignment_count: 0,
      },
      lines,
      blocking: lines.filter((l) => l.status === 'MISSING_RULE'
        || l.status === 'MISSING_PAYMENT_TYPE' || l.status === 'RULE_NOT_PRICEABLE'),
      hard_errors: preview.hard_errors,
      hard_error_count: preview.hard_error_count,
      // Mock nikada ne šalje nepotpun period (operater nema tu permisiju), pa
      // nema ni neutralizovanih grešaka.
      overridden_errors: [],
      completeness: {
        expected_count: preview.completeness.expected_count,
        reviewed_count: preview.completeness.reviewed_count,
        missing_count: preview.completeness.missing_count,
        dates_configured: preview.completeness.dates_configured,
      },
      warnings: preview.warnings.map((w) => ({
        ...w,
        acknowledged_by: w.acknowledged ? 'Operater B6 (mock)' : null,
        acknowledged_at: w.acknowledged ? '2026-07-13T07:00:00Z' : null,
        note: null,
      })),
      unacknowledged_warning_count: preview.unacknowledged_warning_count,
      incomplete_override: null,
      comments: [],
      approval_mode: 'CONFIRMATION_ONLY',
      amount_editable: false,
      can_approve: blockers.length === 0,
      can_return: this.status === 'SUBMITTED' && this.role === 'finance',
      approval_blockers: blockers,
      approval: this.approval
        ? {
            snapshot_id: this.approval.snapshot_id,
            approved_at: this.approval.approved_at,
            approved_by: 'Finansije (mock)',
            approved_amount: this.approval.approved_amount,
            payable_amount: this.approval.payable_amount,
            finance_comment: null,
            content_hash: this.approval.content_hash,
            engine_version: this.approval.engine_version,
            rounding_config: { mode: 'HALF_UP', scale: 2, level: 'LINE' },
            employee_calculated_amount: recap.naknade_zaposlenima,
            overtime_calculated_amount: recap.prekovremeni,
            other_calculated_amount: recap.radna_subota + recap.ispomoc + recap.dodatne_stavke,
            transport_calculated_amount: recap.prevoz,
            total_calculated_amount: this.approval.approved_amount,
          }
        : null,
    };
  }

  async financeApprove(submissionId: Uuid): Promise<FinanceApproveResult> {
    await delay(300);
    if (this.role !== 'finance') {
      throw new WdrApiError('Nedovoljna prava: potrebna permisija finance.approve.', '42501');
    }
    if (this.status !== 'SUBMITTED') {
      throw new WdrApiError(
        `Prijava je u statusu ${this.status}; odobrenje je moguće samo iz SUBMITTED (APPROVAL_WRONG_STATUS).`,
        'APPROVAL_WRONG_STATUS',
      );
    }

    const recap = await this.financeRecap();
    if (!recap.is_complete || recap.ukupno_za_odobrenje === null) {
      throw new WdrApiError(
        `Obračun nije kompletan: ${recap.blocking_line_count} stavka(e) bez upotrebljivog pravila (INCOMPLETE_CALCULATION).`,
        'INCOMPLETE_CALCULATION',
      );
    }

    this.status = 'FINANCE_APPROVED';
    this.approval = {
      submission_id: submissionId,
      status: 'FINANCE_APPROVED',
      snapshot_id: 'snap-mock-1',
      approved_at: new Date().toISOString(),
      approval_mode: 'CONFIRMATION_ONLY',
      approved_amount: recap.ukupno_za_odobrenje,
      payable_amount: recap.ukupno_za_odobrenje,
      recap: {
        naknade_zaposlenima: recap.naknade_zaposlenima,
        prekovremeni: recap.prekovremeni,
        radna_subota: recap.radna_subota,
        ispomoc: recap.ispomoc,
        dodatne_stavke: recap.dodatne_stavke,
        prevoz: recap.prevoz,
        ukupno_za_odobrenje: recap.ukupno_za_odobrenje,
      },
      snapshot_lines: recap.line_count,
      transport_lines: 0,
      employee_count: recap.employee_count,
      worked_employee_days: recap.worked_employee_days,
      content_hash: 'a'.repeat(64),
      engine_version: 'wdr-calc-1.0.0 (mock)',
      notified_submitter: 1,
      note: 'FINANCE_APPROVED znači odobren iznos. Ne znači izvršenu isplatu.',
    };
    this.notify();
    return this.approval;
  }

  async financeReturn(_submissionId: Uuid, comment: string): Promise<void> {
    await delay(200);
    if (this.role !== 'finance') {
      throw new WdrApiError('Nedovoljna prava: potrebna permisija finance.return.', '42501');
    }
    if (comment.trim().length < 10) {
      throw new WdrApiError(
        'Vraćanje na ispravku zahteva komentar (najmanje 10 znakova).', '23514',
      );
    }
    if (this.status !== 'SUBMITTED') {
      throw new WdrApiError(`Prijava je u statusu ${this.status}.`, '42501');
    }
    this.status = 'RETURNED';
    this.notify();
  }

  async getFinanceHistory(
    _centerIds?: Uuid[],
    _from?: string | null,
    _to?: string | null,
    types?: Array<'PERIOD' | 'ADJUSTMENT' | 'COURIER_STOPS' | 'COURIER_STOP_ADJUSTMENT'> | null,
  ): Promise<FinanceHistory> {
    await delay(150);
    if (this.role !== 'finance') {
      throw new WdrApiError(
        'Nedovoljna prava: potrebna permisija finance.history.view.', '42501',
      );
    }
    const periodItems: FinanceHistory['items'] = this.approval
      ? [{
            transaction_type: 'PERIOD' as const,
            transaction_type_label: 'Obračun perioda',
            adjustment_request_id: null,
            economic_period_start: '2026-07-06',
            economic_period_end: '2026-07-12',
            submitted_incomplete: false,
            adjustment: null,
            approval_id: 'appr-mock-1',
            snapshot_id: this.approval.snapshot_id,
            submission_id: SUBMISSION_B6,
            center_id: CENTER_B6,
            center_code: 'B6',
            period_start: '2026-07-06',
            period_end: '2026-07-12',
            approved_at: this.approval.approved_at,
            approved_by: 'Finansije (mock)',
            approved_amount: this.approval.approved_amount,
            payable_amount: this.approval.payable_amount,
            employee_calculated_amount: this.approval.recap.naknade_zaposlenima,
            overtime_calculated_amount: this.approval.recap.prekovremeni,
            other_calculated_amount:
              this.approval.recap.radna_subota + this.approval.recap.ispomoc
              + this.approval.recap.dodatne_stavke,
            transport_calculated_amount: this.approval.recap.prevoz,
            total_calculated_amount: this.approval.approved_amount,
            employee_count: this.approval.employee_count,
            worked_employee_days: this.approval.worked_employee_days,
            engine_version: this.approval.engine_version,
            content_hash: this.approval.content_hash,
            submission_status: 'FINANCE_APPROVED' as const,
          }]
      : [];

    const adjustmentItems: FinanceHistory['items'] = this.adjustments
      .filter((a) => a.status === 'APPROVED' && a.approval)
      .map((a) => ({
        transaction_type: 'ADJUSTMENT' as const,
        transaction_type_label: 'Dodatni zahtev',
        approval_id: `appr-${a.id}`,
        snapshot_id: a.approval!.snapshot_id,
        submission_id: a.original_submission_id,
        adjustment_request_id: a.id,
        center_id: a.center_id,
        center_code: a.center_code,
        // Ekonomska pripadnost je datum rada; transakcija je datum odobrenja.
        economic_period_start: a.related_work_date,
        economic_period_end: a.related_work_date,
        period_start: a.related_work_date,
        period_end: a.related_work_date,
        approved_at: a.approval!.approved_at,
        approved_by: a.approval!.approved_by,
        approved_amount: a.approval!.approved_amount,
        payable_amount: a.approval!.payable_amount,
        employee_calculated_amount: 0,
        overtime_calculated_amount: a.approval!.approved_amount,
        other_calculated_amount: 0,
        transport_calculated_amount: 0,
        total_calculated_amount: a.approval!.total_calculated_amount,
        employee_count: 1,
        worked_employee_days: 0,
        submitted_incomplete: false,
        engine_version: a.approval!.engine_version,
        content_hash: a.approval!.content_hash,
        submission_status: null,
        adjustment: {
          direction: a.direction,
          direction_label: a.direction_label,
          employee_name: a.employee_name,
          related_work_date: a.related_work_date,
          payment_type_code: a.payment_type_code,
          units: a.units,
          reason: a.reason,
          original_submission_id: a.original_submission_id,
        },
      }));

    // Stopovi kurira: koriste ZAMRZNUTE odobrene demo vrednosti iz snapshot-a,
    // ne tekuću demo cenu. Zato `stopLines(..., true)` i `approved_total`.
    const courierItems: FinanceHistory['items'] = [...this.stopState.submissions.values()]
      .filter((sub) => sub.status === 'FINANCE_APPROVED')
      .map((sub) => {
        const lines = this.stopLines(sub.id, true);
        return {
          transaction_type: 'COURIER_STOPS' as const,
          transaction_type_label: 'Stopovi kurira',
          source_type: 'COURIER_STOPS' as const,
          approval_id: `appr-stops-${sub.id}`,
          snapshot_id: `${sub.id}|snap`,
          submission_id: sub.id,
          adjustment_request_id: null,
          center_id: sub.center_id,
          center_code: this.stopCenter(sub.center_id)?.code ?? '—',
          // Ekonomska pripadnost ide po stvarnim datumima rada iz snapshot linija.
          economic_period_start: lines.length > 0
            ? lines.map((l) => l.work_date).sort()[0] : sub.period_start,
          economic_period_end: lines.length > 0
            ? lines.map((l) => l.work_date).sort().slice(-1)[0] : sub.period_end,
          period_start: sub.period_start,
          period_end: sub.period_end,
          approved_at: sub.approved_at ?? new Date().toISOString(),
          approved_by: 'Finansije (mock)',
          approved_amount: sub.approved_total ?? 0,
          payable_amount: sub.approved_total ?? 0,
          total_stops: sub.approved_stops ?? 0,
          employee_calculated_amount: 0,
          overtime_calculated_amount: 0,
          other_calculated_amount: 0,
          transport_calculated_amount: 0,
          total_calculated_amount: sub.approved_total ?? 0,
          employee_count: new Set(lines.map((l) => l.employee_id)).size,
          worked_employee_days: 0,
          submitted_incomplete: false,
          engine_version: 'mock-demo',
          content_hash: `${sub.id}|demo-hash`,
          submission_status: 'FINANCE_APPROVED' as const,
          adjustment: null,
        };
      });

    // Korekcije količine: datum transakcije je datum ODOBRENJA, a ekonomski
    // datum ostaje ORIGINALNI datum rada.
    const correctionItems: FinanceHistory['items'] = this.stopCorrections
      .filter((c) => c.status === 'FINANCE_APPROVED')
      .map((c) => ({
        transaction_type: 'COURIER_STOP_ADJUSTMENT' as const,
        transaction_type_label: 'Korekcija stopova',
        source_type: 'COURIER_STOP_ADJUSTMENT' as const,
        approval_id: `appr-${c.id}`,
        snapshot_id: `${c.snapshot_line_id}|line`,
        submission_id: null,
        adjustment_request_id: null,
        center_id: c.center_id,
        center_code: c.center_code,
        economic_period_start: c.related_work_date,
        economic_period_end: c.related_work_date,
        period_start: c.related_work_date,
        period_end: c.related_work_date,
        approved_at: c.approved_at ?? new Date().toISOString(),
        approved_by: 'Finansije (mock)',
        approved_amount: c.calculated_amount,
        payable_amount: c.calculated_amount,
        total_stops: c.delta_stop_count,
        employee_calculated_amount: 0,
        overtime_calculated_amount: 0,
        other_calculated_amount: 0,
        transport_calculated_amount: 0,
        total_calculated_amount: c.calculated_amount,
        employee_count: 1,
        worked_employee_days: 0,
        submitted_incomplete: false,
        engine_version: 'correction',
        content_hash: null,
        submission_status: 'FINANCE_APPROVED' as const,
        adjustment: null,
      }));

    const all = [...periodItems, ...adjustmentItems, ...courierItems,
                 ...correctionItems].filter(
      (i) => !types || types.length === 0 || types.includes(i.transaction_type),
    );

    return {
      items: all.sort((a, b) => b.approved_at.localeCompare(a.approved_at)),
      note: 'Istorija finansija se gradi iz odobrenja (finance_approvals). '
        + 'Datum transakcije je datum odobrenja; ekonomska pripadnost je datum rada.',
    };
  }

  // --- dodatni zahtevi -----------------------------------------------------

  /**
   * Mock cenovnik: bez `VITE_WDR_MOCK_RATES=demo` nema ni jednog pravila, tačno
   * kao baza prvog dana — pa dodatni zahtev ne može ni da se pošalje.
   */
  private priceAdjustment(
    paymentTypeId: Uuid,
    units: number,
    direction: AdjustmentDirection,
  ): AdjustmentCalculation {
    const rates: Record<string, number> = {
      [PT_PREKOVREMENI]: 400,
      [PT_ISPOMOC]: 500,
    };
    const rate = this.demoRates ? rates[paymentTypeId] : undefined;
    const sign = direction === 'CREDIT' ? -1 : 1;
    const abs = rate === undefined ? null : Math.round(rate * units * 100) / 100;

    return {
      attendance_status: 'WORK',
      rate_center_code: 'B6',
      rate_center_basis: 'HOME_CENTER',
      rule_id: rate === undefined ? null : 'demo-rule',
      rule_version: rate === undefined ? null : 1,
      rate: rate ?? null,
      unit_type: paymentTypeId === PT_PREKOVREMENI ? 'PER_HOUR' : 'PER_EVENT',
      units,
      units_signed: units * sign,
      amount_abs: abs,
      amount_signed: abs === null ? null : abs * sign,
      sign,
      status: rate === undefined ? 'MISSING_RULE' : 'RESOLVED',
      pricing_problem: null,
      amount_editable: false,
      note: 'Iznos se izračunava iz pravila važećeg na datum na koji se zahtev odnosi.',
    };
  }

  private adjustmentErrors(calc: AdjustmentCalculation) {
    return calc.status === 'MISSING_RULE'
      ? [{
          code: 'ADJ_MISSING_RULE',
          message: 'Nema pravilo naknade za taj datum i vrstu isplate. '
            + 'Bez pravila nema iznosa — iznos se ne unosi ručno.',
        }]
      : [];
  }

  async previewAdjustment(
    _employeeId: Uuid,
    workDate: IsoDate,
    _centerId: Uuid,
    paymentTypeId: Uuid,
    units: number,
    direction: AdjustmentDirection,
    _costCenterId?: Uuid | null,
    _workSegmentId?: number | null,
  ): Promise<AdjustmentPreview> {
    await delay(150);
    if (units <= 0) {
      throw new WdrApiError('Količina mora biti veća od nule.', '23514');
    }
    const c = this.priceAdjustment(paymentTypeId, units, direction);
    return {
      related_work_date: workDate,
      direction,
      direction_label: direction === 'DEBIT' ? 'Doplata' : 'Umanjenje / Povraćaj',
      attendance_status: c.attendance_status,
      rate_center_code: 'B6',
      rate_center_basis: 'HOME_CENTER',
      rule_id: c.rule_id,
      rule_version: c.rule_version,
      rate: c.rate,
      unit_type: c.unit_type,
      units: c.units,
      amount_abs: c.amount_abs,
      amount_signed: c.amount_signed,
      status: c.status,
      pricing_problem: c.pricing_problem,
      amount_editable: false,
      is_estimate: true,
      note: 'Procena po pravilu koje je važilo na datum rada. Ne upisuje se i nije odobrenje.',
    };
  }

  async upsertAdjustment(input: AdjustmentInput): Promise<Adjustment> {
    await delay(200);
    if (input.reason.trim().length < 10) {
      throw new WdrApiError('Obrazloženje je obavezno (najmanje 10 znakova).', '23514');
    }
    const emp = EMPLOYEES.find((e) => e.employee_id === input.employee_id);
    const calc = this.priceAdjustment(input.payment_type_id, input.units, input.direction);
    const existing = input.id ? this.adjustments.find((a) => a.id === input.id) : undefined;

    if (existing && !existing.editable) {
      throw new WdrApiError(
        `Dodatni zahtev u statusu ${existing.status} nije izmenljiv (ADJUSTMENT_NOT_EDITABLE).`,
        'ADJUSTMENT_NOT_EDITABLE',
      );
    }

    const row: Adjustment = {
      id: existing?.id ?? `adj-${this.nextAdjustmentId++}`,
      status: existing?.status ?? 'DRAFT',
      direction: input.direction,
      direction_label: input.direction === 'DEBIT' ? 'Doplata' : 'Umanjenje / Povraćaj',
      employee_id: input.employee_id,
      employee_name: emp?.full_name ?? '—',
      related_work_date: input.related_work_date,
      center_id: input.center_id,
      center_code: 'B6',
      cost_center_code: null,
      payment_type_id: input.payment_type_id,
      payment_type_code: input.payment_type_id === PT_PREKOVREMENI
        ? 'PREKOVREMENI' : 'ISPOMOC',
      units: input.units,
      reason: input.reason.trim(),
      original_submission_id: input.original_submission_id ?? null,
      requested_by: 'Operater B6 (mock)',
      requested_at: existing?.requested_at ?? new Date().toISOString(),
      submitted_at: existing?.submitted_at ?? null,
      reviewed_by: null,
      reviewed_at: null,
      finance_comment: existing?.finance_comment ?? null,
      editable: true,
      calculation: calc,
      errors: this.adjustmentErrors(calc),
      warnings: [],
      can_submit: this.adjustmentErrors(calc).length === 0,
      can_approve: false,
      can_decide: false,
      approval: null,
    };

    this.adjustments = existing
      ? this.adjustments.map((a) => (a.id === row.id ? row : a))
      : [...this.adjustments, row];
    return row;
  }

  async submitAdjustment(adjustmentId: Uuid): Promise<Adjustment> {
    await delay(200);
    const a = this.requireAdjustment(adjustmentId);
    if (!['DRAFT', 'RETURNED'].includes(a.status)) {
      throw new WdrApiError(
        `Dodatni zahtev je u statusu ${a.status} i ne može se poslati.`, '42501',
      );
    }
    if (a.errors.length > 0) {
      throw new WdrApiError(
        `Dodatni zahtev sadrži ${a.errors.length} blokirajuću(ih) grešku(a); slanje nije moguće.`,
        '23514',
      );
    }
    Object.assign(a, {
      status: 'SUBMITTED' as AdjustmentStatus,
      submitted_at: new Date().toISOString(),
      finance_comment: null,
      editable: false,
      can_submit: false,
      can_approve: this.role === 'finance',
      can_decide: this.role === 'finance',
    });
    this.notify();
    return a;
  }

  async getMyAdjustments(statuses?: AdjustmentStatus[] | null): Promise<Adjustment[]> {
    await delay(120);
    return this.adjustments.filter((a) => !statuses || statuses.includes(a.status));
  }

  async getAdjustment(adjustmentId: Uuid): Promise<Adjustment> {
    await delay(100);
    return this.requireAdjustment(adjustmentId);
  }

  async getAdjustmentQueue(
    statuses: AdjustmentStatus[] = ['SUBMITTED'],
  ): Promise<AdjustmentQueue> {
    await delay(150);
    if (this.role !== 'finance') {
      throw new WdrApiError(
        'Nedovoljna prava: potrebna permisija adjustment.approve.', '42501',
      );
    }
    const items = this.adjustments.filter((a) => statuses.includes(a.status));
    const resolved = items.filter((a) => a.calculation.status === 'RESOLVED');
    return {
      filters: { statuses },
      items,
      totals: {
        count: items.length,
        doplata_total: resolved
          .filter((a) => a.direction === 'DEBIT')
          .reduce((s, a) => s + (a.calculation.amount_abs ?? 0), 0),
        umanjenje_total: resolved
          .filter((a) => a.direction === 'CREDIT')
          .reduce((s, a) => s + (a.calculation.amount_abs ?? 0), 0),
        net_total: resolved.reduce((s, a) => s + (a.calculation.amount_signed ?? 0), 0),
        blocked_count: items.filter((a) => a.errors.length > 0).length,
      },
    };
  }

  async approveAdjustment(
    adjustmentId: Uuid,
    comment?: string | null,
    _acknowledgeNoWorkEntry = false,
  ) {
    await delay(250);
    if (this.role !== 'finance') {
      throw new WdrApiError(
        'Nedovoljna prava: potrebna permisija adjustment.approve.', '42501',
      );
    }
    const a = this.requireAdjustment(adjustmentId);
    if (a.status !== 'SUBMITTED') {
      throw new WdrApiError(
        `Dodatni zahtev je u statusu ${a.status}; odobrenje je moguće samo iz SUBMITTED `
        + '(ADJUSTMENT_WRONG_STATUS).',
        'ADJUSTMENT_WRONG_STATUS',
      );
    }
    if (a.calculation.amount_signed === null) {
      throw new WdrApiError('Obračun dodatnog zahteva nije moguć.', '23514');
    }
    Object.assign(a, {
      status: 'APPROVED' as AdjustmentStatus,
      reviewed_by: 'Finansije (mock)',
      reviewed_at: new Date().toISOString(),
      finance_comment: comment ?? a.finance_comment,
      can_approve: false,
      can_decide: false,
      approval: {
        snapshot_id: `snap-${a.id}`,
        approved_at: new Date().toISOString(),
        approved_by: 'Finansije (mock)',
        approved_amount: a.calculation.amount_signed,
        payable_amount: a.calculation.amount_signed,
        content_hash: 'b'.repeat(64),
        engine_version: 'wdr-calc-1.0.0 (mock)',
        economic_date: a.related_work_date,
        total_calculated_amount: a.calculation.amount_signed,
      },
    });
    this.notify();
    return a;
  }

  async returnAdjustment(adjustmentId: Uuid, comment: string): Promise<Adjustment> {
    await delay(200);
    return this.decideAdjustment(adjustmentId, 'RETURNED', comment);
  }

  async rejectAdjustment(adjustmentId: Uuid, comment: string): Promise<Adjustment> {
    await delay(200);
    return this.decideAdjustment(adjustmentId, 'REJECTED', comment);
  }

  private decideAdjustment(
    adjustmentId: Uuid,
    status: 'RETURNED' | 'REJECTED',
    comment: string,
  ): Adjustment {
    if (this.role !== 'finance') {
      throw new WdrApiError(
        'Nedovoljna prava: potrebna permisija adjustment.approve.', '42501',
      );
    }
    if (comment.trim().length < 10) {
      throw new WdrApiError('Ova odluka zahteva obrazloženje (najmanje 10 znakova).', '23514');
    }
    const a = this.requireAdjustment(adjustmentId);
    if (a.status !== 'SUBMITTED') {
      throw new WdrApiError(`Dodatni zahtev je u statusu ${a.status}.`, '42501');
    }
    Object.assign(a, {
      status,
      finance_comment: comment.trim(),
      reviewed_by: 'Finansije (mock)',
      reviewed_at: new Date().toISOString(),
      editable: status === 'RETURNED',
      can_submit: status === 'RETURNED' && a.errors.length === 0,
      can_approve: false,
      can_decide: false,
    });
    this.notify();
    return a;
  }

  private requireAdjustment(id: Uuid): Adjustment {
    const a = this.adjustments.find((x) => x.id === id);
    if (!a) throw new WdrApiError(`Dodatni zahtev ${id} ne postoji.`, 'P0002');
    return a;
  }

  private waitingHours(): number | null {
    if (!this.submittedAt || this.status !== 'SUBMITTED') return null;
    return Math.round(
      ((Date.now() - new Date(this.submittedAt).getTime()) / 3600000) * 10,
    ) / 10;
  }

  /** Recap derived from the same preview lines the operator sees. */
  private async financeRecap(): Promise<FinanceRecap> {
    const preview = await this.getSubmissionPreview(SUBMISSION_B6);
    const sumOf = (kind: string) =>
      preview.lines
        .filter((l) => l.line_kind === kind)
        .reduce((s, l) => s + (l.calculated_amount ?? 0), 0);

    const complete = preview.totals.blocking_line_count === 0;
    return {
      naknade_zaposlenima: sumOf('PRIMARY'),
      prekovremeni: 0,
      radna_subota: 0,
      ispomoc: 0,
      dodatne_stavke: sumOf('COMPONENT'),
      prevoz: sumOf('TRANSPORT'),
      resolved_subtotal: preview.totals.resolved_subtotal,
      ukupno_za_odobrenje: complete ? preview.totals.resolved_subtotal : null,
      is_complete: complete,
      blocking_line_count: preview.totals.blocking_line_count,
      line_count: preview.lines.length,
      employee_count: new Set(preview.lines.map((l) => l.employee_id)).size,
      worked_employee_days: new Set(
        preview.lines.map((l) => `${l.employee_id}|${l.work_date}`),
      ).size,
    };
  }


  // --- administracija ------------------------------------------------------

  private adminConfig: AdminConfig | null = null;

  private requireAdmin() {
    if (this.role !== 'admin') {
      throw new WdrApiError('Nedovoljna prava za administraciju.', '42501');
    }
  }

  async getAdminConfig(): Promise<AdminConfig> {
    await delay(200);
    this.requireAdmin();
    if (!this.adminConfig) {
      this.adminConfig = {
        can: {
          centers: true, reference: true, payment_types: true, comp_rules: true,
          transport: true, providers: true, users: true, roles: true, employees: true,
          controls: true,
        },
        attendance_behaviors: [
          { behavior_key: 'PRESENT_WORK', name: 'Prisutan na radu',
            description: 'Dan se računa kao radni.', sort_order: 10,
            allows_segments: true, counts_as_present: true },
          { behavior_key: 'ANNUAL_LEAVE', name: 'Godišnji odmor', allows_segments: false,
            counts_as_present: false,
            description: 'Odsustvo po godišnjem odmoru.', sort_order: 20 },
          { behavior_key: 'SICK_LEAVE', name: 'Bolovanje', allows_segments: false,
            counts_as_present: false,
            description: 'Odsustvo po bolovanju.', sort_order: 30 },
          { behavior_key: 'NON_WORKING', name: 'Neradni dan', allows_segments: false,
            counts_as_present: false,
            description: 'Dan koji se ne očekuje kao radni.', sort_order: 40 },
          { behavior_key: 'OTHER', name: 'Ostalo', allows_segments: false,
            counts_as_present: false,
            description: 'Bez posebnog ponašanja u obračunu.', sort_order: 50 },
        ],
        payment_behaviors: [
          { behavior_key: 'PRIMARY_DAILY', name: 'Osnovna dnevna naknada',
            description: 'Jedna jedinica po employee-danu.', kind: 'PRIMARY', sort_order: 10,
            allowed_unit_types: ['PER_WORKED_DAY'], requires_units: false,
            allows_cost_center_override: false },
          { behavior_key: 'OVERTIME_HOURS', name: 'Prekovremeni sati',
            description: 'Količina je eksplicitan unos u satima.', kind: 'COMPONENT',
            sort_order: 20, allowed_unit_types: ['PER_HOUR'], requires_units: true,
            allows_cost_center_override: true },
          { behavior_key: 'SATURDAY_WORK', name: 'Radna subota',
            description: 'Komponenta vezana za segment.', kind: 'COMPONENT', sort_order: 30,
            allowed_unit_types: ['PER_EVENT', 'PER_WORKED_DAY'], requires_units: false,
            allows_cost_center_override: false },
          { behavior_key: 'ASSISTANCE', name: 'Ispomoć',
            description: 'Trošak nosi centar ispomoći.', kind: 'COMPONENT', sort_order: 40,
            allowed_unit_types: ['PER_EVENT'], requires_units: true,
            allows_cost_center_override: true },
          { behavior_key: 'ADDITIONAL_ALLOWANCE', name: 'Dodatna naknada',
            description: 'Eksplicitan trošak ili matični centar.', kind: 'COMPONENT',
            sort_order: 50, allowed_unit_types: ['PER_EVENT', 'FIXED'],
            requires_units: false, allows_cost_center_override: false },
          { behavior_key: 'GENERIC_COMPONENT', name: 'Opšta komponenta',
            description: 'Dokumentovano podrazumevano ponašanje.', kind: 'COMPONENT',
            sort_order: 60, allowed_unit_types: ['PER_EVENT', 'PER_HOUR', 'FIXED'],
            requires_units: true, allows_cost_center_override: true },
        ],
        centers: [
          { id: CENTER_B6, code: 'B6', name: 'Rakovica', active: true, sort_order: 10 },
          { id: 'c-bz', code: 'BZ', name: 'Zemun', active: true, sort_order: 20 },
        ],
        shift_templates: [
          { id: 's1', code: '06-14', label: 'Prva', shift_start: '06:00', shift_end: '14:00',
            crosses_midnight: false, center_id: null, active: true, sort_order: 10 },
          { id: 's2', code: '22-06', label: 'Noćna', shift_start: '22:00', shift_end: '06:00',
            crosses_midnight: true, center_id: null, active: true, sort_order: 30 },
        ],
        attendance_statuses: [
          { code: 'WORK', name: 'Rad', behavior_key: 'PRESENT_WORK', allows_segments: true,
            counts_as_present: true, active: true, sort_order: 10, short_label: 'R',
            shortcut_key: 'r', color_token: null, in_use: true },
          { code: 'GO', name: 'Godišnji odmor', behavior_key: 'ANNUAL_LEAVE',
            allows_segments: false, counts_as_present: false, active: true, sort_order: 20,
            short_label: 'GO', shortcut_key: 'g', color_token: null, in_use: false },
        ],
        payment_types: [
          { id: PT_PREKOVREMENI, code: 'PREKOVREMENI', name: 'Prekovremeni rad',
            behavior_key: 'OVERTIME_HOURS', kind: 'COMPONENT', default_unit_type: 'PER_HOUR',
            requires_units: true, allows_cost_center_override: true, active: true,
            sort_order: 60, notes: null, in_use: false },
          { id: PT_ISPOMOC, code: 'ISPOMOC', name: 'Ispomoć', behavior_key: 'ASSISTANCE',
            kind: 'COMPONENT', default_unit_type: 'PER_EVENT', requires_units: true,
            allows_cost_center_override: true, active: true, sort_order: 40, notes: null,
            in_use: false },
        ],
        compensation_rules: [],
        transport_providers: [],
        responsible_persons: [],
        transport_rules: [],
        transport_rule_types_allowed: ['PER_ELIGIBLE_WORKED_DAY', 'LITERS_PER_EMPLOYEE_DAY'],
        employee_transport_assignments: [],
        expected_date_patterns: [],
        employees: EMPLOYEES.map((e) => ({
          id: e.employee_id, full_name: e.full_name, employee_code: null,
        })),
        roles: [],
        permissions: [],
        sensitive_permissions: [
          'finance.approve', 'period.submit_incomplete', 'cost_center.override',
          'adjustment.manage_all', 'users.manage', 'roles.manage',
        ],
        users: [],
        control_rules: this.controlRules(),
        control_rule_history: [],
        control_severities: ['INFO', 'WARNING', 'HIGH', 'CRITICAL'],
        system_settings_readonly: {
          timezone: 'Europe/Belgrade',
          rounding: { mode: 'HALF_UP', scale: 2, level: 'LINE' },
          night_shift_attribution: 'SHIFT_START_DATE',
          note: 'Fiksno za MVP (Q28). Prikazuje se, ne uređuje.',
        },
      };
    }
    return this.adminConfig;
  }

  async adminUpsertCenter(i: {
    id?: Uuid | null; code: string; name: string; active: boolean; sort_order: number;
  }): Promise<AdminCenter> {
    await delay(150);
    this.requireAdmin();
    const cfg = await this.getAdminConfig();
    const row: AdminCenter = {
      id: i.id ?? `c-${cfg.centers.length + 1}`,
      code: i.code.toUpperCase(),
      name: i.name,
      active: i.active,
      sort_order: i.sort_order,
    };
    cfg.centers = i.id
      ? cfg.centers.map((c) => (c.id === i.id ? row : c))
      : [...cfg.centers, row];
    return row;
  }

  async adminUpsertShiftTemplate(i: {
    id?: Uuid | null; code: string; label: string; start: string; end: string;
    center_id?: Uuid | null; active: boolean; sort_order: number;
  }): Promise<AdminShiftTemplate> {
    await delay(150);
    this.requireAdmin();
    const cfg = await this.getAdminConfig();
    const row: AdminShiftTemplate = {
      id: i.id ?? `s-${cfg.shift_templates.length + 1}`,
      code: i.code.toUpperCase(),
      label: i.label,
      shift_start: i.start,
      shift_end: i.end,
      // Prelazak ponoći je izveden, ne unet — isto kao u bazi.
      crosses_midnight: i.end <= i.start,
      center_id: i.center_id ?? null,
      active: i.active,
      sort_order: i.sort_order,
    };
    cfg.shift_templates = i.id
      ? cfg.shift_templates.map((t) => (t.id === i.id ? row : t))
      : [...cfg.shift_templates, row];
    return row;
  }

  async adminUpsertAttendanceStatus(i: {
    code: string; name: string; behavior_key: string; active: boolean; sort_order: number;
    short_label?: string | null; shortcut_key?: string | null; color_token?: string | null;
  }): Promise<AdminAttendanceStatus> {
    await delay(150);
    this.requireAdmin();
    const cfg = await this.getAdminConfig();
    const behavior = cfg.attendance_behaviors.find((b) => b.behavior_key === i.behavior_key);
    const existing = cfg.attendance_statuses.find((a) => a.code === i.code.toUpperCase());
    if (existing && existing.behavior_key !== i.behavior_key) {
      throw new WdrApiError(
        'Ključ ponašanja se ne menja (BEHAVIOR_KEY_IMMUTABLE).', '42501',
      );
    }
    if (!cfg.attendance_behaviors.some((b) => b.behavior_key === i.behavior_key)) {
      throw new WdrApiError(`Ponašanje ${i.behavior_key} nije podržano.`, '23514');
    }
    const row = {
      ...(existing ?? {}),
      code: i.code.toUpperCase(),
      name: i.name,
      behavior_key: i.behavior_key,
      // Izvedeno iz ponašanja, kao u bazi — ne prima se kao ulaz.
      allows_segments: behavior?.allows_segments ?? false,
      counts_as_present: behavior?.counts_as_present ?? false,
      active: i.active,
      sort_order: i.sort_order,
      short_label: i.short_label ?? null,
      shortcut_key: i.shortcut_key ?? null,
      color_token: i.color_token ?? null,
      in_use: existing?.in_use ?? false,
    } as AdminAttendanceStatus;
    cfg.attendance_statuses = existing
      ? cfg.attendance_statuses.map((a) => (a.code === row.code ? row : a))
      : [...cfg.attendance_statuses, row];
    return row;
  }

  async adminUpsertPaymentType(i: {
    id?: Uuid | null; code: string; name: string; behavior_key: string;
    kind: 'PRIMARY' | 'COMPONENT'; default_unit_type: string;
    active: boolean; sort_order: number; notes?: string | null;
  }): Promise<AdminPaymentType> {
    await delay(150);
    this.requireAdmin();
    const cfg = await this.getAdminConfig();
    const behavior = cfg.payment_behaviors.find((b) => b.behavior_key === i.behavior_key);
    if (!behavior) {
      throw new WdrApiError(
        `Ponašanje obračuna ${i.behavior_key} nije podržano. Nova aritmetika je `
        + 'softverska izmena, ne konfiguracija.', '23514',
      );
    }
    if (behavior.kind !== i.kind) {
      throw new WdrApiError(
        `Ponašanje ${i.behavior_key} pripada vrsti ${behavior.kind}.`, '23514',
      );
    }
    if (i.default_unit_type === 'OTHER') {
      throw new WdrApiError('Jedinica OTHER nije podržana (Q24).', '23514');
    }
    if (behavior.allowed_unit_types
        && !behavior.allowed_unit_types.includes(i.default_unit_type)) {
      throw new WdrApiError(
        `Jedinica ${i.default_unit_type} nije dozvoljena za ponašanje ${i.behavior_key}.`,
        '23514',
      );
    }
    const row: AdminPaymentType = {
      id: i.id ?? `pt-${cfg.payment_types.length + 1}`,
      code: i.code.toUpperCase(),
      name: i.name,
      behavior_key: i.behavior_key as AdminPaymentType['behavior_key'],
      kind: i.kind,
      default_unit_type: i.default_unit_type,
      // Izvedeno iz ponašanja obračuna.
      requires_units: behavior.requires_units ?? true,
      allows_cost_center_override: behavior.allows_cost_center_override ?? false,
      active: i.active,
      sort_order: i.sort_order,
      notes: null,
      in_use: false,
    };
    cfg.payment_types = i.id
      ? cfg.payment_types.map((p) => (p.id === i.id ? row : p))
      : [...cfg.payment_types, row];
    return row;
  }

  async adminCreateCompRule() {
    await delay(150);
    this.requireAdmin();
    throw new WdrApiError(
      'Unos pravila naknada nije dostupan u mock režimu — potrebna je baza.', 'MOCK',
    );
  }

  async adminSupersedeCompRule(): Promise<Uuid> {
    await delay(150);
    this.requireAdmin();
    throw new WdrApiError(
      'Nova verzija pravila nije dostupna u mock režimu — potrebna je baza.', 'MOCK',
    );
  }

  async adminUpsertTransportProvider(): Promise<unknown> {
    await delay(150);
    this.requireAdmin();
    throw new WdrApiError(
      'Unos prevoznika nije dostupan u mock režimu — potrebna je baza.', 'MOCK',
    );
  }

  async adminUpsertResponsiblePerson(): Promise<unknown> {
    await delay(150);
    this.requireAdmin();
    throw new WdrApiError(
      'Unos odgovornog lica nije dostupan u mock režimu — potrebna je baza.', 'MOCK',
    );
  }

  async adminCreateTransportRule(i: { rule_type: string }) {
    await delay(150);
    this.requireAdmin();
    if (!['PER_ELIGIBLE_WORKED_DAY', 'LITERS_PER_EMPLOYEE_DAY'].includes(i.rule_type)) {
      throw new WdrApiError(
        `Model prevoza ${i.rule_type} se ne obračunava u MVP-u (Q22).`, '23514',
      );
    }
    throw new WdrApiError(
      'Unos pravila prevoza nije dostupan u mock režimu — potrebna je baza.', 'MOCK',
    );
  }

  async adminSetExpectedPattern() {
    await delay(150);
    this.requireAdmin();
    throw new WdrApiError(
      'Radni kalendar nije dostupan u mock režimu — potrebna je baza.', 'MOCK',
    );
  }

  // ------------------------------------------------- Stopovi kurira (DEMO) --
  // SVE vrednosti ispod su DEMO i ne smeju se čitati kao poslovni podaci.
  // DEMO cena po stopu postoji samo da bi se tok mogao pregledati bez baze;
  // produkcioni seed je NE sadrži i produkcioni režim je NIKADA ne koristi.
  private stopState = {
    DEMO_RATE_PER_STOP: 120,
    submissions: new Map<string, {
      id: string; center_id: string; period_id: string;
      period_start: string; period_end: string;
      status: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'FINANCE_APPROVED';
      return_reason: string | null; submitted_at: string | null; approved_at: string | null;
      approved_total: number | null; approved_stops: number | null;
    }>(),
    entries: new Map<string, {
      submission_id: string; employee_id: string; employee_name: string;
      center_id: string; center_code: string; work_date: string; stop_count: number;
      // Popunjava se tek pri odobrenju: odobrena istorija se ne preračunava.
      approved_rate: number | null;
    }>(),
  };

  private stopCenter(id: string) {
    return STOP_DEMO_CENTERS.find((c) => c.id === id);
  }

  /** Mock nema sopstvenu sesiju osim uloge; ovo samo odbija odjavljen slučaj. */
  private requireSession() {
    if (!this.role) {
      throw new WdrApiError('Niste prijavljeni.', '42501');
    }
  }

  private stopLines(submissionId: string, approved: boolean) {
    return [...this.stopState.entries.values()]
      .filter((e) => e.submission_id === submissionId)
      .sort((a, b) => a.employee_name.localeCompare(b.employee_name)
        || a.work_date.localeCompare(b.work_date))
      .map((e) => {
        const rate = approved ? e.approved_rate : this.stopState.DEMO_RATE_PER_STOP;
        return {
          employee_id: e.employee_id, center_id: e.center_id,
          employee_name: e.employee_name, employee_code: null,
          center_code: e.center_code, work_date: e.work_date,
          stop_count: e.stop_count, rate_used: rate,
          calculated_amount: rate === null ? null : Math.round(e.stop_count * rate),
          source: approved ? 'SNAPSHOT' : 'CALCULATED',
        };
      });
  }

  async courierStopContext() {
    await delay(60);
    this.requireSession();
    return {
      centers: STOP_DEMO_CENTERS,
      periods: STOP_DEMO_PERIODS,
      employees: EMPLOYEES.map((e) => ({
        id: e.employee_id, full_name: e.full_name, employee_code: e.employee_code,
      })),
    };
  }

  async courierStopOpenSubmission(periodId: Uuid, centerId: Uuid) {
    await delay(80);
    this.requireSession();
    const key = `${periodId}|${centerId}`;
    let sub = this.stopState.submissions.get(key);
    if (!sub) {
      const p = STOP_DEMO_PERIODS.find((x) => x.id === periodId);
      sub = {
        id: key, center_id: centerId, period_id: periodId,
        period_start: p?.period_start ?? '2026-07-06',
        period_end: p?.period_end ?? '2026-07-12',
        status: 'DRAFT', return_reason: null, submitted_at: null, approved_at: null,
        approved_total: null, approved_stops: null,
      };
      this.stopState.submissions.set(key, sub);
    }
    return { ...sub };
  }

  async courierStopSetEntry(
    submissionId: Uuid, employeeId: Uuid, workDate: IsoDate, stopCount: number,
  ) {
    await delay(60);
    this.requireSession();
    const sub = this.stopState.submissions.get(submissionId);
    if (!sub) throw new WdrApiError('Prijava stopova ne postoji.', 'P0002');
    if (!['DRAFT', 'RETURNED'].includes(sub.status)) {
      throw new WdrApiError(
        'Prijava stopova je poslata i više se ne menja.', 'COURIER_STOP_SUBMISSION_LOCKED');
    }
    // Ista semantika kao na serveru: negativno je greška, nula briše.
    if (stopCount < 0) {
      throw new WdrApiError('Broj stopova ne može biti negativan.', 'INVALID_STOP_COUNT');
    }
    const key = `${submissionId}|${employeeId}|${workDate}`;
    if (stopCount === 0) {
      this.stopState.entries.delete(key);
      return { deleted: true };
    }
    const emp = EMPLOYEES.find((e) => e.employee_id === employeeId);
    this.stopState.entries.set(key, {
      submission_id: submissionId, employee_id: employeeId,
      employee_name: emp?.full_name ?? 'Nepoznat kurir',
      center_id: sub.center_id,
      center_code: this.stopCenter(sub.center_id)?.code ?? '—',
      work_date: workDate, stop_count: stopCount, approved_rate: null,
    });
    return { id: key, stop_count: stopCount };
  }

  async courierStopSubmit(submissionId: Uuid) {
    await delay(80);
    this.requireSession();
    const sub = this.stopState.submissions.get(submissionId);
    if (!sub) throw new WdrApiError('Prijava stopova ne postoji.', 'P0002');
    if (this.stopLines(submissionId, false).length === 0) {
      throw new WdrApiError('Prijava ne sadrži ni jedan zapis o stopovima.',
        'EMPTY_COURIER_STOP_SUBMISSION');
    }
    sub.status = 'SUBMITTED';
    sub.submitted_at = new Date().toISOString();
    sub.return_reason = null;
    return { ...sub };
  }

  async courierStopFinanceReturn(submissionId: Uuid, comment: string) {
    await delay(80);
    this.requireSession();
    const sub = this.stopState.submissions.get(submissionId);
    if (!sub) throw new WdrApiError('Prijava stopova ne postoji.', 'P0002');
    if (sub.status !== 'SUBMITTED') {
      throw new WdrApiError('Vraćanje je moguće samo iz statusa „poslato".', 'INVALID_STATE');
    }
    if (comment.trim() === '') {
      throw new WdrApiError('Razlog vraćanja je obavezan.', 'RETURN_REASON_REQUIRED');
    }
    sub.status = 'RETURNED';
    sub.return_reason = comment.trim();
    return { ...sub };
  }

  async courierStopFinanceApprove(submissionId: Uuid) {
    await delay(120);
    this.requireSession();
    const sub = this.stopState.submissions.get(submissionId);
    if (!sub) throw new WdrApiError('Prijava stopova ne postoji.', 'P0002');
    if (sub.status !== 'SUBMITTED') {
      throw new WdrApiError('Odobrenje je moguće samo iz statusa „poslato".', 'INVALID_STATE');
    }
    // Zamrzavanje cene: posle ovoga izmena DEMO cene ne menja odobrenu prošlost.
    let stops = 0;
    let total = 0;
    for (const e of this.stopState.entries.values()) {
      if (e.submission_id !== submissionId) continue;
      e.approved_rate = this.stopState.DEMO_RATE_PER_STOP;
      stops += e.stop_count;
      total += Math.round(e.stop_count * e.approved_rate);
    }
    sub.status = 'FINANCE_APPROVED';
    sub.approved_at = new Date().toISOString();
    sub.approved_stops = stops;
    sub.approved_total = total;
    return { snapshot_id: `${submissionId}|snap`, total_stops: stops, approved_amount: total };
  }

  async courierStopFinanceQueue() {
    await delay(60);
    this.requireSession();
    return [...this.stopState.submissions.values()]
      .filter((s) => s.status === 'SUBMITTED' || s.status === 'RETURNED')
      .map((s) => {
        const lines = this.stopLines(s.id, false);
        return {
          submission_type: 'COURIER_STOPS' as const,
          submission_id: s.id,
          center_code: this.stopCenter(s.center_id)?.code ?? '—',
          period_start: s.period_start, period_end: s.period_end, status: s.status,
          submitted_at: s.submitted_at,
          total_stops: lines.reduce((a, l) => a + l.stop_count, 0),
          total_calculated_amount: lines.reduce((a, l) => a + (l.calculated_amount ?? 0), 0),
          blocking_line_count: 0,
          can_approve: s.status === 'SUBMITTED',
          can_return: s.status === 'SUBMITTED',
        };
      });
  }

  async courierStopFinanceDetail(submissionId: Uuid) {
    await delay(60);
    this.requireSession();
    const sub = this.stopState.submissions.get(submissionId);
    if (!sub) throw new WdrApiError('Prijava stopova ne postoji.', 'P0002');
    const approved = sub.status === 'FINANCE_APPROVED';
    const lines = this.stopLines(submissionId, approved);
    const errors = lines.length === 0
      ? [{ severity: 'ERROR', code: 'EMPTY_COURIER_STOP_SUBMISSION',
           message: 'Prijava ne sadrži ni jedan zapis o stopovima.' }]
      : [];
    return {
      submission_type: 'COURIER_STOPS' as const,
      submission: {
        id: sub.id, center_id: sub.center_id, period_id: sub.period_id,
        period_start: sub.period_start, period_end: sub.period_end,
        status: sub.status, return_reason: sub.return_reason,
        submitted_at: sub.submitted_at, approved_at: sub.approved_at,
      },
      is_approved: approved,
      totals: {
        total_stops: approved ? sub.approved_stops ?? 0
          : lines.reduce((a, l) => a + l.stop_count, 0),
        total_amount: approved ? sub.approved_total
          : lines.reduce((a, l) => a + (l.calculated_amount ?? 0), 0),
        line_count: lines.length,
        employee_count: new Set(lines.map((l) => l.employee_name)).size,
        blocking_line_count: 0,
        is_complete: errors.length === 0,
        source: approved ? 'SNAPSHOT' as const : 'CALCULATED' as const,
      },
      errors: approved ? [] : errors,
      lines,
    };
  }

  /** BA nad ODOBRENIM demo stopovima. Cena se izvodi iz odobrenih iznosa. */
  async baCourierStops(
    from?: string | null, to?: string | null, centerIds?: string[] | null,
  ) {
    await delay(80);
    this.requireSession();
    // Filteri se STVARNO primenjuju: demo koji ih ignoriše uči korisnika da im
    // ne veruje, pa se greška u pravom režimu ne primeti.
    const inRange = (workDate: string, centerId: string) =>
      (!from || workDate >= from)
      && (!to || workDate <= to)
      && (!centerIds || centerIds.length === 0 || centerIds.includes(centerId));

    const lines = [
      ...[...this.stopState.submissions.values()]
        .filter((s) => s.status === 'FINANCE_APPROVED')
        .flatMap((s) => this.stopLines(s.id, true))
        .filter((l) => inRange(l.work_date, l.center_id ?? '')),
      // Odobrene korekcije ulaze u BA po ORIGINALNOM datumu rada.
      ...this.stopCorrections
        .filter((c) => c.status === 'FINANCE_APPROVED'
          && inRange(c.related_work_date, c.center_id))
        .map((c) => ({
          employee_id: c.employee_id, center_id: c.center_id,
          employee_name: c.employee_name, employee_code: null,
          center_code: c.center_code, work_date: c.related_work_date,
          stop_count: c.delta_stop_count, rate_used: c.original_rate_used,
          calculated_amount: c.calculated_amount, source: 'SNAPSHOT' as const,
        })),
    ];

    const stops = lines.reduce((a, l) => a + l.stop_count, 0);
    const cost = lines.reduce((a, l) => a + (l.calculated_amount ?? 0), 0);
    const days = new Set(lines.map((l) => `${l.employee_id}|${l.work_date}`));

    const group = <K extends string>(key: (l: typeof lines[number]) => K) => {
      const m = new Map<K, { stops: number; approved_cost: number }>();
      for (const l of lines) {
        const k = key(l);
        const cur = m.get(k) ?? { stops: 0, approved_cost: 0 };
        cur.stops += l.stop_count;
        cur.approved_cost += l.calculated_amount ?? 0;
        m.set(k, cur);
      }
      return m;
    };

    return {
      totals: {
        total_stops: stops,
        approved_cost: cost,
        cost_per_stop: stops > 0 ? Math.round((cost / stops) * 100) / 100 : null,
        courier_count: new Set(lines.map((l) => l.employee_id)).size,
        active_courier_days: days.size,
        avg_stops_per_courier_day: days.size > 0
          ? Math.round((stops / days.size) * 100) / 100 : null,
      },
      by_courier: [...group((l) => l.employee_id ?? '—')].map(([id, v]) => ({
        employee_id: id,
        employee_name: lines.find((l) => l.employee_id === id)?.employee_name ?? '—',
        ...v,
      })),
      by_center: [...group((l) => l.center_code)].map(([center_code, v]) => ({
        center_code, ...v })),
      by_work_date: [...group((l) => l.work_date)].map(([work_date, v]) => ({
        work_date, ...v })).sort((a, b) => a.work_date.localeCompare(b.work_date)),
      by_month: [...group((l) => l.work_date.slice(0, 7))].map(([month, v]) => ({
        month, ...v })).sort((a, b) => a.month.localeCompare(b.month)),
      note: 'DEMO podaci. Novac dolazi iz odobrenih demo snapshot-a.',
    };
  }

  // ---------------------------------------------- Korekcije stopova (DEMO) --
  private stopCorrections: Array<{
    id: string; snapshot_line_id: number; employee_id: string; employee_name: string;
    center_id: string; center_code: string; related_work_date: string;
    original_stop_count: number; delta_stop_count: number; original_rate_used: number;
    calculated_amount: number; reason: string;
    status: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'FINANCE_APPROVED';
    return_reason: string | null; approved_at: string | null;
  }> = [];

  /** Odobrene linije dostupne za korekciju, sa svojim rednim brojem kao ID. */
  private approvedStopLines() {
    return [...this.stopState.submissions.values()]
      .filter((s) => s.status === 'FINANCE_APPROVED')
      .flatMap((s) => this.stopLines(s.id, true))
      .map((l, i) => ({ ...l, snapshot_line_id: i + 1 }));
  }

  private effectiveStops(lineId: number): number {
    const line = this.approvedStopLines().find((l) => l.snapshot_line_id === lineId);
    const delta = this.stopCorrections
      .filter((c) => c.snapshot_line_id === lineId && c.status === 'FINANCE_APPROVED')
      .reduce((a, c) => a + c.delta_stop_count, 0);
    return (line?.stop_count ?? 0) + delta;
  }

  async courierStopCorrectionSet(
    id: string | null, snapshotLineId: number | null, delta: number, reason: string,
  ) {
    await delay(60);
    this.requireSession();
    if (!delta) {
      throw new WdrApiError('Korekcija mora da menja količinu.', 'CORRECTION_DELTA_ZERO');
    }
    if (reason.trim().length < 5) {
      throw new WdrApiError('Obrazloženje korekcije je obavezno.',
        'CORRECTION_REASON_REQUIRED');
    }

    if (id) {
      const cur = this.stopCorrections.find((c) => c.id === id);
      if (!cur) throw new WdrApiError('Korekcija ne postoji.', 'P0002');
      if (!['DRAFT', 'RETURNED'].includes(cur.status)) {
        throw new WdrApiError('Korekcija se više ne menja.', 'LOCKED');
      }
      cur.delta_stop_count = delta;
      cur.reason = reason.trim();
      // Cena ostaje ZAMRZNUTA; menja se samo količina.
      cur.calculated_amount = Math.round(delta * cur.original_rate_used);
      return { ...cur };
    }

    const line = this.approvedStopLines().find((l) => l.snapshot_line_id === snapshotLineId);
    if (!line) {
      throw new WdrApiError(
        'Korekcija se pravi samo nad ODOBRENIM stopovima.', 'SOURCE_NOT_APPROVED');
    }
    const rec = {
      id: `corr-${this.stopCorrections.length + 1}`,
      snapshot_line_id: line.snapshot_line_id,
      employee_id: line.employee_id ?? '—',
      employee_name: line.employee_name,
      center_id: line.center_id ?? '—',
      center_code: line.center_code,
      related_work_date: line.work_date,
      original_stop_count: line.stop_count,
      delta_stop_count: delta,
      original_rate_used: line.rate_used ?? 0,
      calculated_amount: Math.round(delta * (line.rate_used ?? 0)),
      reason: reason.trim(),
      status: 'DRAFT' as const,
      return_reason: null,
      approved_at: null,
    };
    this.stopCorrections.push(rec);
    return { ...rec };
  }

  async courierStopCorrectionSubmit(id: string) {
    await delay(60);
    this.requireSession();
    const c = this.stopCorrections.find((x) => x.id === id);
    if (!c) throw new WdrApiError('Korekcija ne postoji.', 'P0002');
    if (!['DRAFT', 'RETURNED'].includes(c.status)) {
      throw new WdrApiError('Slanje nije moguće.', 'INVALID_STATE');
    }
    c.status = 'SUBMITTED';
    return { ...c };
  }

  async courierStopCorrectionFinanceReturn(id: string, comment: string) {
    await delay(60);
    this.requireSession();
    const c = this.stopCorrections.find((x) => x.id === id);
    if (!c) throw new WdrApiError('Korekcija ne postoji.', 'P0002');
    if (c.status !== 'SUBMITTED') {
      throw new WdrApiError('Vraćanje je moguće samo iz „poslato".', 'INVALID_STATE');
    }
    if (comment.trim() === '') {
      throw new WdrApiError('Razlog vraćanja je obavezan.', 'RETURN_REASON_REQUIRED');
    }
    c.status = 'RETURNED';
    c.return_reason = comment.trim();
    return { ...c };
  }

  async courierStopCorrectionFinanceApprove(id: string) {
    await delay(80);
    this.requireSession();
    const c = this.stopCorrections.find((x) => x.id === id);
    if (!c) throw new WdrApiError('Korekcija ne postoji.', 'P0002');
    if (c.status === 'FINANCE_APPROVED') {
      throw new WdrApiError('Korekcija je već odobrena.', 'DOUBLE_APPROVAL_BLOCKED');
    }
    if (c.status !== 'SUBMITTED') {
      throw new WdrApiError('Odobrenje je moguće samo iz „poslato".', 'INVALID_STATE');
    }
    if (this.effectiveStops(c.snapshot_line_id) + c.delta_stop_count < 0) {
      throw new WdrApiError(
        'Zbir odobrenih korekcija bi dao negativnu količinu.', 'CORRECTION_BELOW_ZERO');
    }
    c.status = 'FINANCE_APPROVED';
    c.approved_at = new Date().toISOString();
    return { ...c };
  }

  async courierStopCorrectionQueue() {
    await delay(60);
    this.requireSession();
    return this.stopCorrections
      .filter((c) => c.status === 'SUBMITTED' || c.status === 'RETURNED')
      .map((c) => ({
        submission_type: 'COURIER_STOP_ADJUSTMENT' as const,
        correction_id: c.id, center_code: c.center_code,
        employee_name: c.employee_name, related_work_date: c.related_work_date,
        status: c.status, submitted_by: 'Operater (mock)', submitted_at: null,
        original_stop_count: c.original_stop_count,
        delta_stop_count: c.delta_stop_count,
        original_rate_used: c.original_rate_used,
        calculated_amount: c.calculated_amount,
        direction_label: c.delta_stop_count > 0 ? 'Doplata' : 'Umanjenje',
        reason: c.reason,
        can_approve: c.status === 'SUBMITTED' && this.role === 'finance',
        can_return: c.status === 'SUBMITTED' && this.role === 'finance',
      }));
  }

  async courierStopCorrectionDetail(id: string) {
    await delay(60);
    this.requireSession();
    const c = this.stopCorrections.find((x) => x.id === id);
    if (!c) throw new WdrApiError('Korekcija ne postoji.', 'P0002');
    const line = this.approvedStopLines().find(
      (l) => l.snapshot_line_id === c.snapshot_line_id);
    return {
      submission_type: 'COURIER_STOP_ADJUSTMENT' as const,
      correction: { ...c },
      direction_label: c.delta_stop_count > 0 ? 'Doplata' : 'Umanjenje',
      original: {
        snapshot_line_id: c.snapshot_line_id,
        employee_name: c.employee_name,
        center_code: c.center_code,
        work_date: c.related_work_date,
        stop_count: c.original_stop_count,
        rate_used: c.original_rate_used,
        calculated_amount: line?.calculated_amount ?? null,
      },
      already_approved_delta: this.stopCorrections
        .filter((x) => x.snapshot_line_id === c.snapshot_line_id
          && x.status === 'FINANCE_APPROVED' && x.id !== c.id)
        .reduce((a, x) => a + x.delta_stop_count, 0),
      effective_stops_now: this.effectiveStops(c.snapshot_line_id),
      effective_stops_after: this.effectiveStops(c.snapshot_line_id)
        + (c.status === 'FINANCE_APPROVED' ? 0 : c.delta_stop_count),
    };
  }

  async adminStopRates() {
    await delay(60);
    this.requireAdmin();
    return {
      current: STOP_DEMO_CENTERS.map((c) => ({
        id: `demo-${c.id}`, center_code: c.code,
        amount_per_stop: this.stopState.DEMO_RATE_PER_STOP,
        unit_type: 'PER_STOP', valid_from: '2026-01-01', valid_to: null,
        version: 1, active: true, notes: 'DEMO — nije poslovni podatak',
      })),
      history: [],
      centers_without_rate: [],
    };
  }

  async adminCreateStopRate() {
    await delay(60);
    this.requireAdmin();
    throw new WdrApiError(
      'Unos cene po stopu zahteva bazu — mock ne čuva finansijska pravila.', 'MOCK');
  }

  async adminSupersedeStopRate() {
    await delay(60);
    this.requireAdmin();
    throw new WdrApiError(
      'Izmena cene po stopu zahteva bazu — mock ne čuva finansijska pravila.', 'MOCK');
  }

  async adminLinkUser() {
    await delay(150);
    this.requireAdmin();
    throw new WdrApiError(
      'Povezivanje novog korisnika nije dostupno u mock režimu — potrebna je baza.', 'MOCK',
    );
  }

  async adminSetUserAccess() {
    await delay(150);
    this.requireAdmin();
    throw new WdrApiError(
      'Upravljanje korisnicima nije dostupno u mock režimu — potrebna je baza.', 'MOCK',
    );
  }


  // --- zaposleni -----------------------------------------------------------

  async getEmployeeFormReference(): Promise<EmployeeFormReference> {
    await delay(80);
    const session = await this.getSession();
    const writable = new Set((session?.centers ?? []).filter((c) => c.can_write).map((c) => c.center_id));
    const centers = this.role === 'admin'
      ? [
          { id: CENTER_B6, code: 'B6', name: 'Rakovica' },
          { id: CENTER_BZ, code: 'BZ', name: 'Zemun' },
        ]
      : [
          { id: CENTER_B6, code: 'B6', name: 'Rakovica' },
          { id: CENTER_BZ, code: 'BZ', name: 'Zemun' },
        ].filter((c) => writable.has(c.id));

    return {
      centers,
      shift_templates: SHIFTS.map((s) => ({ ...s, center_id: null })),
      payment_types: [
        { id: PT_KARNET, code: 'KARNET', name: 'Karnet', kind: 'PRIMARY' as const },
        { id: PT_OBUKA, code: 'OBUKA', name: 'Obuka', kind: 'PRIMARY' as const },
      ],
      transport_providers: [
        { id: 'tp-gamzed', code: 'GAMZED', name: 'Gamzed' },
        { id: 'tp-knezevic', code: 'KNEZEVIC', name: 'Knežević' },
      ],
    };
  }

  private employeeRows: EmployeeProfile[] = EMPLOYEES.map((e, i) => ({
    employee: {
      id: e.employee_id,
      employee_code: `E-00${i + 1}`,
      first_name: e.full_name.split(' ')[1] ?? e.full_name,
      last_name: e.full_name.split(' ')[0] ?? e.full_name,
      full_name: e.full_name,
      active: true,
      employment_start_date: '2026-01-01',
      employment_end_date: null,
      notes: null,
    },
    can: { edit: true, assign: true, transport: true },
    history_guard: {
      first_approved_work_date: null,
      last_approved_work_date: null,
      note: 'Raspodele i prevoz se menjaju samo kao buduće izmene.',
    },
    assignments: [{
      id: `as-${i + 1}`,
      center_code: 'B6',
      center_id: CENTER_B6,
      valid_from: '2026-01-01',
      valid_to: null,
      primary_payment_type_code: 'KARNET',
      default_shift_code: '06-14',
      is_current: true,
      notes: null,
    }],
    transport: [{
      id: `tr-${i + 1}`,
      transport_required: i === 1,
      provider_code: i === 1 ? 'GAMZED' : null,
      provider_id: null,
      valid_from: '2026-01-01',
      valid_to: null,
      is_current: true,
    }],
    period: { from: '2026-01-01', to: '2026-12-31' },
    operational_summary: [],
    approved_payments: [],
    adjustments: [],
  }));

  private requireEmployeeAdmin() {
    if (this.role !== 'admin' && this.role !== 'operator') {
      throw new WdrApiError('Nedovoljna prava za matične podatke zaposlenih.', '42501');
    }
  }

  async getEmployees(
    search?: string | null, active?: boolean | null, _centerId?: Uuid | null,
    limit = 50, offset = 0,
  ): Promise<EmployeeList> {
    await delay(180);
    const q = (search ?? '').trim().toLowerCase();
    const rows = this.employeeRows
      .filter((r) => (active === null || active === undefined
        || r.employee.active === active))
      .filter((r) => q === ''
        || r.employee.full_name.toLowerCase().includes(q)
        || (r.employee.employee_code ?? '').toLowerCase().includes(q));

    return {
      items: rows.slice(offset, offset + limit).map((r) => ({
        id: r.employee.id,
        employee_code: r.employee.employee_code,
        full_name: r.employee.full_name,
        active: r.employee.active,
        employment_start_date: r.employee.employment_start_date,
        employment_end_date: r.employee.employment_end_date,
        current_center_code: r.assignments.find((a) => a.is_current)?.center_code ?? null,
        current_center_id: r.assignments.find((a) => a.is_current)?.center_id ?? null,
        primary_payment_type_code:
          r.assignments.find((a) => a.is_current)?.primary_payment_type_code ?? null,
        default_shift_code: r.assignments.find((a) => a.is_current)?.default_shift_code ?? null,
        transport_required: r.transport.find((t) => t.is_current)?.transport_required ?? null,
        transport_provider_code: r.transport.find((t) => t.is_current)?.provider_code ?? null,
      })),
      limit,
      offset,
      total: rows.length,
    };
  }

  async getEmployeeProfile(employeeId: Uuid): Promise<EmployeeProfile> {
    await delay(150);
    const row = this.employeeRows.find((r) => r.employee.id === employeeId);
    if (!row) throw new WdrApiError(`Zaposleni ${employeeId} ne postoji.`, 'P0002');
    return row;
  }

  async checkEmployeeDuplicates(
    employeeCode: string | null, firstName: string, lastName: string,
  ): Promise<EmployeeDuplicateCheck> {
    await delay(120);
    const full = `${lastName.trim()} ${firstName.trim()}`.toLowerCase();
    const byCode = employeeCode
      ? this.employeeRows.find((r) => r.employee.employee_code === employeeCode.trim())
      : undefined;
    return {
      exact_code: byCode
        ? {
            id: byCode.employee.id,
            full_name: byCode.employee.full_name,
            employee_code: byCode.employee.employee_code,
            active: byCode.employee.active,
          }
        : null,
      exact_name: this.employeeRows
        .filter((r) => r.employee.full_name.toLowerCase() === full)
        .map((r) => ({
          id: r.employee.id,
          full_name: r.employee.full_name,
          employee_code: r.employee.employee_code,
          active: r.employee.active,
          employment_start_date: r.employee.employment_start_date,
        })),
      // Mock ne radi trigram sličnost — poredi se samo prezime.
      similar: this.employeeRows
        .filter((r) => r.employee.full_name.toLowerCase() !== full
          && r.employee.last_name.toLowerCase() === lastName.trim().toLowerCase())
        .map((r) => ({
          id: r.employee.id,
          full_name: r.employee.full_name,
          employee_code: r.employee.employee_code,
          active: r.employee.active,
          similarity: 0.8,
        })),
      note: 'Ista šifra je greška. Isto ili slično ime je upozorenje koje se potvrđuje.',
    };
  }

  async createEmployee(i: NewEmployeeInput): Promise<EmployeeProfile> {
    await delay(250);
    this.requireEmployeeAdmin();
    const dupes = await this.checkEmployeeDuplicates(
      i.employee_code, i.first_name, i.last_name,
    );
    if (dupes.exact_code) {
      throw new WdrApiError(
        `Šifra zaposlenog ${i.employee_code} već postoji (EMPLOYEE_CODE_DUPLICATE).`,
        '23505',
      );
    }
    if (!i.confirm_similar
        && (dupes.exact_name.length > 0 || dupes.similar.length > 0)) {
      throw new WdrApiError(
        'Postoji zaposleni sa istim ili sličnim imenom; potrebna je izričita potvrda '
        + '(EMPLOYEE_SIMILAR_NAME_UNCONFIRMED).',
        '23514',
      );
    }
    if (i.transport_required && !i.transport_provider_id) {
      throw new WdrApiError('Ako je prevoz potreban, prevoznik je obavezan.', '23514');
    }

    const id = `emp-${this.employeeRows.length + 1}`;
    const row: EmployeeProfile = {
      employee: {
        id,
        employee_code: i.employee_code,
        first_name: i.first_name.trim(),
        last_name: i.last_name.trim(),
        full_name: `${i.last_name.trim()} ${i.first_name.trim()}`,
        active: true,
        employment_start_date: i.employment_start_date,
        employment_end_date: null,
        notes: i.notes ?? null,
      },
      can: { edit: true, assign: true, transport: true },
      history_guard: {
        first_approved_work_date: null, last_approved_work_date: null,
        note: 'Nema odobrene istorije.',
      },
      assignments: [{
        id: `as-${id}`,
        center_code: 'B6',
        center_id: i.center_id,
        valid_from: i.employment_start_date,
        valid_to: null,
        primary_payment_type_code: 'KARNET',
        default_shift_code: null,
        is_current: true,
        notes: i.notes ?? null,
      }],
      transport: [{
        id: `tr-${id}`,
        transport_required: i.transport_required,
        provider_code: i.transport_required ? 'GAMZED' : null,
        provider_id: i.transport_provider_id ?? null,
        valid_from: i.transport_valid_from ?? i.employment_start_date,
        valid_to: null,
        is_current: true,
      }],
      period: { from: i.employment_start_date, to: i.employment_start_date },
      operational_summary: [],
      approved_payments: [],
      adjustments: [],
    };
    this.employeeRows = [...this.employeeRows, row];
    return row;
  }

  async updateEmployee(i: {
    employee_id: Uuid; first_name: string; last_name: string;
    employee_code?: string | null; notes?: string | null; active?: boolean | null;
  }): Promise<EmployeeProfile> {
    await delay(180);
    this.requireEmployeeAdmin();
    const row = await this.getEmployeeProfile(i.employee_id);
    row.employee.first_name = i.first_name.trim();
    row.employee.last_name = i.last_name.trim();
    row.employee.full_name = `${i.last_name.trim()} ${i.first_name.trim()}`;
    if (i.employee_code) row.employee.employee_code = i.employee_code;
    if (i.notes !== undefined && i.notes !== null) row.employee.notes = i.notes;
    if (i.active !== undefined && i.active !== null) row.employee.active = i.active;
    return row;
  }

  async setEmploymentDates(
    employeeId: Uuid, start: IsoDate, end?: IsoDate | null,
  ): Promise<EmployeeProfile> {
    await delay(150);
    this.requireEmployeeAdmin();
    const row = await this.getEmployeeProfile(employeeId);
    row.employee.employment_start_date = start;
    row.employee.employment_end_date = end ?? null;
    return row;
  }

  async transferEmployee(i: {
    employee_id: Uuid; new_center_id: Uuid; from_date: IsoDate;
  }): Promise<EmployeeProfile> {
    await delay(220);
    this.requireEmployeeAdmin();
    const row = await this.getEmployeeProfile(i.employee_id);
    const current = row.assignments.find((a) => a.is_current);
    if (current && current.valid_from >= i.from_date) {
      throw new WdrApiError(
        `Nova raspodela mora početi posle ${current.valid_from}.`, '22007',
      );
    }
    if (current) {
      // Stara se ZATVARA, ne prepisuje.
      const dayBefore = new Date(new Date(i.from_date).getTime() - 86400000)
        .toISOString().slice(0, 10);
      current.valid_to = dayBefore;
      current.is_current = false;
    }
    row.assignments = [{
      id: `as-${row.assignments.length + 1}`,
      center_code: i.new_center_id === CENTER_B6 ? 'B6' : 'BZ',
      center_id: i.new_center_id,
      valid_from: i.from_date,
      valid_to: null,
      primary_payment_type_code: current?.primary_payment_type_code ?? 'KARNET',
      default_shift_code: current?.default_shift_code ?? null,
      is_current: true,
      notes: null,
    }, ...row.assignments];
    return row;
  }

  async closeEmployeeAssignment(assignmentId: Uuid, validTo: IsoDate): Promise<EmployeeProfile> {
    await delay(150);
    this.requireEmployeeAdmin();
    const row = this.employeeRows.find((r) => r.assignments.some((a) => a.id === assignmentId));
    if (!row) throw new WdrApiError('Raspodela ne postoji.', 'P0002');
    const a = row.assignments.find((x) => x.id === assignmentId)!;
    a.valid_to = validTo;
    a.is_current = false;
    return row;
  }

  async setEmployeeTransport(i: {
    employee_id: Uuid; transport_required: boolean; transport_provider_id?: Uuid | null;
    valid_from: IsoDate;
  }): Promise<EmployeeProfile> {
    await delay(200);
    this.requireEmployeeAdmin();
    if (i.transport_required && !i.transport_provider_id) {
      throw new WdrApiError('Ako je prevoz potreban, prevoznik je obavezan.', '23514');
    }
    const row = await this.getEmployeeProfile(i.employee_id);
    const current = row.transport.find((t) => t.is_current);
    if (current) {
      const dayBefore = new Date(new Date(i.valid_from).getTime() - 86400000)
        .toISOString().slice(0, 10);
      current.valid_to = dayBefore;
      current.is_current = false;
    }
    row.transport = [{
      id: `tr-${row.transport.length + 1}`,
      transport_required: i.transport_required,
      provider_code: i.transport_required ? 'GAMZED' : null,
      provider_id: i.transport_provider_id ?? null,
      valid_from: i.valid_from,
      valid_to: null,
      is_current: true,
    }, ...row.transport];
    return row;
  }

  async terminateEmployee(
    employeeId: Uuid, endDate: IsoDate,
  ): Promise<EmployeeProfile> {
    await delay(200);
    this.requireEmployeeAdmin();
    const row = await this.getEmployeeProfile(employeeId);
    row.employee.employment_end_date = endDate;
    row.employee.active = false;
    for (const a of row.assignments) {
      if (a.valid_to === null) { a.valid_to = endDate; a.is_current = false; }
    }
    for (const t of row.transport) {
      if (t.valid_to === null) { t.valid_to = endDate; t.is_current = false; }
    }
    return row;
  }


  // --- BA analitika --------------------------------------------------------

  private requireBa() {
    // BA nije finansijska funkcija; u mock-u je vezana za admin rolu, kao što je
    // u bazi vezana za analytics.ba.view (koju FINANCE ne dobija).
    if (this.role !== 'admin') {
      throw new WdrApiError(
        'Nedovoljna prava: BA analitika zahteva permisiju analytics.ba.view.', '42501',
      );
    }
  }

  /** Mock KPI: bez demo stopa nema odobrenog troška, isto kao u bazi. */
  private baKpi(current: number) {
    return {
      current,
      previous_period: 0,
      previous_year: null,
      absolute_change: current,
      // Prethodni period je nula → procenat ne postoji.
      percentage_change: null,
      absolute_change_year: null,
      percentage_change_year: null,
    };
  }

  async baOverview(from: IsoDate, to: IsoDate, centerIds?: Uuid[] | null): Promise<BaOverview> {
    await delay(220);
    this.requireBa();
    const approved = this.approval?.approved_amount ?? 0;
    const days = Math.max(
      1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1,
    );
    const workedDays = approved > 0 ? 2 : 0;

    return {
      basis: 'ECONOMIC_WORK_DATE',
      basis_label: 'Ekonomski trošak po datumu rada',
      period: { from, to, days },
      comparison: {
        mode: 'PREVIOUS_EQUAL_PERIOD',
        previous_period: { from, to },
        previous_year: { from, to },
        previous_period_has_data: false,
        previous_year_has_data: false,
      },
      center_ids: centerIds ?? [],
      kpi: {
        total_calculated_amount: this.baKpi(approved),
        employee_calculated_amount: this.baKpi(approved > 0 ? approved - 500 : 0),
        transport_calculated_amount: this.baKpi(approved > 0 ? 500 : 0),
        adjustment_calculated_amount: this.baKpi(0),
        worked_employee_days: this.baKpi(workedDays),
        worked_hours: this.baKpi(workedDays * 8),
        go_days: this.baKpi(0),
        bo_days: this.baKpi(0),
        overtime_hours: this.baKpi(0),
        distinct_employees: this.baKpi(workedDays),
        cost_per_worked_employee_day: {
          ...this.baKpi(workedDays > 0 ? approved / workedDays : 0),
          // NULL kada nema radnih dana — ne nula.
          current: workedDays > 0 ? approved / workedDays : null,
        },
      },
      economic_reconciliation: {
        regular_approved_amount: approved,
        net_adjustment_amount: 0,
        final_economic_amount: approved,
      },
      definitions: {
        cost_per_worked_employee_day:
          'total_calculated_amount / worked_employee_days; NULL kada je imenilac nula',
      },
      approved_snapshots: approved > 0 ? 1 : 0,
    };
  }

  async baDaily(from: IsoDate, to: IsoDate): Promise<BaDaily> {
    await delay(200);
    this.requireBa();
    const approved = this.approval?.approved_amount ?? 0;
    return {
      basis: 'ECONOMIC_WORK_DATE',
      period: { from, to },
      grouped_by_center: false,
      items: approved > 0
        ? [{
            work_date: '2026-07-06',
            center_code: null,
            distinct_employees: 2,
            worked_employee_days: 2,
            go_days: 0,
            bo_days: 0,
            overtime_hours: 0,
            employee_calculated_amount: approved - 500,
            transport_calculated_amount: 500,
            adjustment_calculated_amount: 0,
            total_calculated_amount: approved,
            cost_per_worked_employee_day: approved / 2,
          }]
        : [],
    };
  }

  async baCenters(from: IsoDate, to: IsoDate): Promise<BaCenters> {
    await delay(180);
    this.requireBa();
    const approved = this.approval?.approved_amount ?? 0;
    return {
      basis: 'ECONOMIC_WORK_DATE',
      period: { from, to },
      previous_period: { from, to },
      total_calculated_amount: approved,
      items: approved > 0
        ? [{
            center_code: 'B6',
            worked_employee_days: 2,
            distinct_employees: 2,
            employee_calculated_amount: approved - 500,
            transport_calculated_amount: 500,
            adjustment_calculated_amount: 0,
            total_calculated_amount: approved,
            overtime_hours: 0,
            cost_per_worked_employee_day: approved / 2,
            share_of_total: 100,
            previous_total_calculated_amount: 0,
            absolute_change: approved,
            percentage_change: null,
          }]
        : [],
    };
  }

  async baPaymentBreakdown(from: IsoDate, to: IsoDate): Promise<BaPaymentBreakdown> {
    await delay(180);
    this.requireBa();
    const approved = this.approval?.approved_amount ?? 0;
    return {
      basis: 'ECONOMIC_WORK_DATE',
      period: { from, to },
      total_calculated_amount: approved,
      items: approved > 0
        ? [
            { group_key: 'PRIMARY_DAILY', label: 'Naknade zaposlenima',
              payment_behavior_key: 'PRIMARY_DAILY', units: 2, amount: approved - 500,
              share_of_total: 100 * (approved - 500) / approved,
              payment_type_codes: ['KARNET'] },
            { group_key: 'PREVOZ', label: 'Prevoz', payment_behavior_key: null,
              units: 1, amount: 500, share_of_total: 100 * 500 / approved,
              payment_type_codes: ['PREVOZ'] },
          ]
        : [],
    };
  }

  async baTransport(from: IsoDate, to: IsoDate): Promise<BaTransport> {
    await delay(180);
    this.requireBa();
    const approved = this.approval?.approved_amount ?? 0;
    return {
      basis: 'ECONOMIC_WORK_DATE',
      period: { from, to },
      transport_total_amount: approved > 0 ? 500 : 0,
      items: approved > 0
        ? [{
            center_code: 'B6',
            transport_provider_code: 'GAMZED',
            responsible_person_code: 'GAMZED_RESP',
            employee_days: 1,
            units: 1,
            amount: 500,
            share_of_transport: 100,
            distinct_rate_count: 1,
            min_rate: 500,
            max_rate: 500,
            single_rate: 500,
          }]
        : [],
      by_provider: approved > 0 ? { GAMZED: 500 } : {},
    };
  }

  async baEmployees(
    from: IsoDate, to: IsoDate, _centerIds?: Uuid[] | null, _search?: string | null,
    sort: BaEmployeeSort = 'TOTAL', limit = 50, offset = 0,
  ): Promise<BaEmployees> {
    await delay(200);
    this.requireBa();
    const approved = this.approval?.approved_amount ?? 0;
    const items = approved > 0
      ? EMPLOYEES.slice(0, 2).map((e, i) => ({
          employee_id: e.employee_id,
          employee_name_snapshot: e.full_name,
          employee_current_name: e.full_name,
          worked_days: 1,
          go_days: 0,
          bo_days: 0,
          overtime_hours: 0,
          employee_calculated_amount: (approved - 500) / 2,
          transport_calculated_amount: i === 1 ? 500 : 0,
          adjustment_calculated_amount: 0,
          total_calculated_amount: (approved - 500) / 2 + (i === 1 ? 500 : 0),
          cost_per_worked_day: (approved - 500) / 2 + (i === 1 ? 500 : 0),
        }))
      : [];
    return {
      basis: 'ECONOMIC_WORK_DATE',
      period: { from, to },
      sort,
      limit,
      offset,
      total_rows: items.length,
      items,
    };
  }

  async baEmployeeDetail(): Promise<unknown> {
    await delay(150);
    this.requireBa();
    return { by_month: [], lines: [] };
  }

  async baFinanceTimeline(from: IsoDate, to: IsoDate): Promise<BaFinanceTimeline> {
    await delay(180);
    this.requireBa();
    const approved = this.approval?.approved_amount ?? 0;
    return {
      basis: 'FINANCE_APPROVAL_DATE',
      basis_label: 'Finansijski tok po datumu odobrenja',
      note: 'Nije isto kao ekonomski trošak po datumu rada.',
      period: { from, to },
      totals: {
        approval_count: approved > 0 ? 1 : 0,
        regular_approved_amount: approved,
        adjustment_approved_amount: 0,
        total_approved_amount: approved,
      },
      items: approved > 0
        ? [{
            approval_date: (this.approval?.approved_at ?? '').slice(0, 10),
            approval_count: 1,
            regular_approved_amount: approved,
            adjustment_approved_amount: 0,
            total_approved_amount: approved,
          }]
        : [],
    };
  }


  // --- kontrolni centar ----------------------------------------------------

  private controlFindings: ControlFindingRow[] = [];
  private controlRun: ControlRunResponse['run'] = null;

  /** Katalog je sistemski i u mock-u: nova kontrola je softverska izmena. */
  private controlRules(): ControlRunResponse['rules'] {
    return [
      { rule_code: 'COST_VARIANCE_CENTER', name: 'Odstupanje troška po centru',
        description: 'Odobreni trošak centra prema prethodnom jednakom periodu.',
        entity_type: 'CENTER', basis: 'ECONOMIC_WORK_DATE', requires_threshold: true,
        threshold_unit: 'PERCENT', default_severity: 'WARNING', enabled: false,
        threshold_value: null, severity: 'WARNING', valid_from: '2026-01-01',
        config_version: 1, notes: 'Prag nije potvrđen.', status: 'NOT_CONFIGURED' },
      { rule_code: 'OVERTIME_EMPLOYEE_WEEK', name: 'Prekovremeni sati po zaposlenom',
        description: 'Odobreni prekovremeni sati po ISO nedelji.',
        entity_type: 'EMPLOYEE', basis: 'ECONOMIC_WORK_DATE', requires_threshold: true,
        threshold_unit: 'HOURS', default_severity: 'HIGH', enabled: false,
        threshold_value: null, severity: 'HIGH', valid_from: '2026-01-01',
        config_version: 1, notes: 'Prag nije potvrđen.', status: 'NOT_CONFIGURED' },
      { rule_code: 'APPROVED_INCOMPLETE_OVERRIDE',
        name: 'Odobreno uz izuzetak za nepotpunu evidenciju',
        description: 'Kontrolisani izuzetak, ne greška.',
        entity_type: 'SUBMISSION', basis: 'ECONOMIC_WORK_DATE', requires_threshold: false,
        threshold_unit: null, default_severity: 'WARNING', enabled: true,
        threshold_value: null, severity: 'WARNING', valid_from: '2026-01-01',
        config_version: 1, notes: null, status: 'ACTIVE' },
      { rule_code: 'ACTIVE_EMPLOYEE_WITHOUT_ASSIGNMENT', name: 'Zaposleni bez raspodele',
        description: 'Kvalitet podataka; centar se ne pretpostavlja.',
        entity_type: 'EMPLOYEE_MASTER', basis: 'MASTER_DATA', requires_threshold: false,
        threshold_unit: null, default_severity: 'WARNING', enabled: true,
        threshold_value: null, severity: 'WARNING', valid_from: '2026-01-01',
        config_version: 1, notes: null, status: 'ACTIVE' },
    ];
  }

  private controlSummary(): ControlRunResponse['summary'] {
    const by = (s: string) => this.controlFindings.filter((f) => f.status === s).length;
    const sev = (s: ControlSeverity) =>
      this.controlFindings.filter((f) => f.severity === s && f.status === 'OPEN').length;
    return {
      open: by('OPEN'), acknowledged: by('ACKNOWLEDGED'), resolved: by('RESOLVED'),
      dismissed: by('DISMISSED'),
      critical: sev('CRITICAL'), high: sev('HIGH'), warning: sev('WARNING'),
      info: sev('INFO'),
    };
  }

  async runControlScan(
    from: IsoDate, to: IsoDate, centerIds?: Uuid[] | null,
  ): Promise<ControlRunResponse> {
    await delay(400);
    this.requireBa();

    // Deterministički: kontrolisani izuzeci samo ako ih ima u mock podacima.
    if (this.controlFindings.length === 0 && this.approval) {
      this.controlFindings = [{
        id: 'cf-1',
        rule_code: 'APPROVED_INCOMPLETE_OVERRIDE',
        rule_name: 'Odobreno uz izuzetak za nepotpunu evidenciju',
        severity: 'WARNING',
        status: 'OPEN',
        entity_type: 'SUBMISSION',
        employee_id: null,
        employee_name: null,
        center_code: 'B6',
        provider_code: null,
        related_date: to,
        period_from: from,
        period_to: to,
        iso_week: null,
        current_value: this.approval.approved_amount,
        comparison_value: null,
        threshold_value: null,
        variance_pct: null,
        classification: 'NOT_APPLICABLE',
        message: 'Odobren obračun B6 poslat je uz odobren izuzetak za nepotpunu '
          + 'evidenciju. Kontrolisani izuzetak; nije dokaz nepravilnosti.',
        seen_count: 1,
        created_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      }];
    } else {
      // Ponovljeni skan iste situacije NE pravi duplikate.
      this.controlFindings = this.controlFindings.map((f) => ({
        ...f, seen_count: f.seen_count + 1, last_seen_at: new Date().toISOString(),
      }));
    }

    const s = this.controlSummary();
    this.controlRun = {
      id: 'cr-1',
      period_from: from,
      period_to: to,
      center_ids: centerIds ?? [],
      filter_snapshot: { from, to, skipped_rules: [
        { rule_code: 'COST_VARIANCE_CENTER', reason: 'NOT_CONFIGURED' },
        { rule_code: 'OVERTIME_EMPLOYEE_WEEK', reason: 'NOT_CONFIGURED' },
      ] },
      started_by: 'Administrator (mock)',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      engine_version: 'wdr-controls-1.0.0 (mock)',
      config_hash: 'mock',
      status: 'COMPLETED',
      finding_count: this.controlFindings.length,
      info_count: 0, warning_count: s.warning, high_count: s.high,
      critical_count: s.critical,
      rules_evaluated: 2, rules_skipped: 2,
    };
    this.notify();
    return {
      run: this.controlRun,
      summary: s,
      current_run_summary: s,
      backlog_summary: { open: 0, acknowledged: 0, critical: 0, high: 0, warning: 0, info: 0 },
      rules: this.controlRules(),
      can_review: true, can_run: true, can_manage: true,
    };
  }

  async getControlRun(): Promise<ControlRunResponse> {
    await delay(180);
    this.requireBa();
    return {
      run: this.controlRun,
      summary: this.controlSummary(),
      current_run_summary: this.controlSummary(),
      backlog_summary: { open: 0, acknowledged: 0, critical: 0, high: 0, warning: 0, info: 0 },
      rules: this.controlRules(),
      can_review: true, can_run: true, can_manage: true,
      note: this.controlRun
        ? undefined
        : 'Nema završene kontrole. Pokrenite kontrolu za izabrani period.',
    };
  }

  async getControlFindings(f: {
    status?: ControlFindingStatus[] | null; severity?: ControlSeverity[] | null;
    limit?: number; offset?: number;
  } = {}): Promise<ControlFindings> {
    await delay(200);
    this.requireBa();
    const status = f.status ?? ['OPEN'];
    const items = this.controlFindings
      .filter((x) => status.includes(x.status))
      .filter((x) => !f.severity || f.severity.length === 0
        || f.severity.includes(x.severity));
    return {
      limit: f.limit ?? 100, offset: f.offset ?? 0,
      run_id: null, latest_run_id: this.controlRun?.id ?? null,
      total_rows: items.length,
      items: items.map((i) => ({ ...i, in_selected_run: true })),
    };
  }

  async getControlFinding(findingId: Uuid): Promise<ControlFindingDetail> {
    await delay(150);
    this.requireBa();
    const f = this.controlFindings.find((x) => x.id === findingId);
    if (!f) throw new WdrApiError(`Nalaz ${findingId} ne postoji.`, 'P0002');
    return {
      finding: {
        ...f,
        context: { note: 'Kontrolisani izuzetak; nije dokaz nepravilnosti.' },
        status_comment: null,
        acknowledged_by: null, acknowledged_at: null,
        resolved_by: null, resolved_at: null,
        dismissed_by: null, dismissed_at: null,
      },
      rule: {
        rule_code: f.rule_code, name: f.rule_name,
        description: 'Kontrola definisana u sistemu.',
        entity_type: f.entity_type, basis: 'ECONOMIC_WORK_DATE', threshold_unit: null,
      },
      config_used: {
        id: 'cfg-1', version: 1, enabled: true, threshold_value: null,
        severity: f.severity, valid_from: '2026-01-01', valid_to: null, notes: null,
      },
      run: this.controlRun
        ? {
            id: this.controlRun.id, period_from: this.controlRun.period_from,
            period_to: this.controlRun.period_to, started_at: this.controlRun.started_at,
            engine_version: this.controlRun.engine_version,
            config_hash: this.controlRun.config_hash,
          }
        : null,
      allowed_transitions: f.status === 'OPEN'
        ? [
            { to_status: 'ACKNOWLEDGED' as const, requires_comment: false,
              description: 'Nalaz je primljen na znanje' },
            { to_status: 'RESOLVED' as const, requires_comment: true,
              description: 'Nalaz je rešen' },
            { to_status: 'DISMISSED' as const, requires_comment: true,
              description: 'Nalaz je odbačen' },
          ]
        : f.status === 'ACKNOWLEDGED'
          ? [
              { to_status: 'RESOLVED' as const, requires_comment: true,
                description: 'Nalaz je rešen' },
              { to_status: 'DISMISSED' as const, requires_comment: true,
                description: 'Nalaz je odbačen' },
            ]
          : [],
      can_decide: true,
    };
  }

  async setControlFindingStatus(
    findingId: Uuid, status: ControlFindingStatus, comment?: string | null,
  ): Promise<ControlFindingDetail> {
    await delay(180);
    this.requireBa();
    if ((status === 'DISMISSED' || status === 'RESOLVED')
        && (comment ?? '').trim().length < 10) {
      throw new WdrApiError('Ova odluka zahteva obrazloženje (najmanje 10 znakova).',
        '23514');
    }
    const f = this.controlFindings.find((x) => x.id === findingId);
    if (!f) throw new WdrApiError(`Nalaz ${findingId} ne postoji.`, 'P0002');
    // RESOLVED i DISMISSED su terminalni, kao u bazi.
    if (f.status === 'RESOLVED' || f.status === 'DISMISSED') {
      throw new WdrApiError(
        `Nalaz je u terminalnom statusu ${f.status} (CONTROL_FINDING_TERMINAL).`, '42501',
      );
    }
    f.status = status;
    return this.getControlFinding(findingId);
  }

  async adminSetControlRule(): Promise<unknown> {
    await delay(150);
    this.requireBa();
    throw new WdrApiError(
      'Konfiguracija kontrolnih pravila nije dostupna u mock režimu — potrebna je baza.',
      'MOCK',
    );
  }

  // --- spremnost sistema ---------------------------------------------------

  private verifications: Partial<Record<VerificationKind, {
    at: string; note: string; environment: string | null; reference: string | null;
  }>> = {};

  async adminReadiness(): Promise<AdminReadiness> {
    await delay(250);
    this.requireAdmin();
    const kinds: VerificationKind[] = [
      'BACKUP_RESTORE_TESTED', 'HTTP_SMOKE_TEST',
      'BACKUP_LOCATION_CONFIRMED', 'LEGAL_PRIVACY_REVIEW',
    ];
    return {
      generated_at: new Date().toISOString(),
      note: 'Informativni pregled. Ne menja obračun i ne označava sam ništa kao '
        + 'urađeno: ručne i eksterne obaveze su potvrđene samo ako postoji zapis.',
      configuration: {
        active_centers: 2,
        centers_without_expected_pattern: [],
        active_payment_types: 2,
        active_attendance_statuses: 2,
        active_shift_templates: 2,
        active_employees: EMPLOYEES.length,
      },
      compensation: {
        rules_total: this.demoRates ? 3 : 0,
        // Bez demo stopa nema pravila — i to se prikazuje kao konfiguracija koja
        // nedostaje, ne kao greška.
        primary_types_without_rule: this.demoRates ? [] : ['KARNET'],
        component_types_without_rule: this.demoRates ? [] : ['PREKOVREMENI', 'ISPOMOC'],
        rules_with_unsupported_shape: 0,
      },
      transport: {
        active_providers: 1,
        active_responsible_persons: 1,
        active_rules: this.demoRates ? 1 : 0,
        providers_without_rule: this.demoRates ? [] : ['GAMZED'],
        employees_with_transport_but_no_rule: this.demoRates ? 0 : 1,
      },
      data_quality: {
        active_employees_without_assignment: 0,
        employees_without_primary_payment_type: 0,
      },
      controls: {
        rules_total: 4,
        active: 2,
        not_configured: ['COST_VARIANCE_CENTER', 'OVERTIME_EMPLOYEE_WEEK'],
        last_run_at: this.controlRun?.completed_at ?? null,
        open_findings: this.controlFindings.filter((f) => f.status === 'OPEN').length,
      },
      verifications: Object.fromEntries(kinds.map((k) => {
        const v = this.verifications[k];
        return [k, {
          confirmed: Boolean(v),
          verified_at: v?.at ?? null,
          verified_by: v ? 'Administrator (mock)' : null,
          environment: v?.environment ?? null,
          reference: v?.reference ?? null,
          note: v?.note ?? null,
          label: v ? 'Potvrđeno' : 'Nije potvrđeno',
        }];
      })) as AdminReadiness['verifications'],
      operations: {
        submissions_draft: 1,
        submissions_waiting_finance: this.approval ? 0 : 1,
        approved_snapshots: this.approval ? 1 : 0,
        adjustments_waiting: 0,
      },
    };
  }

  async adminRecordVerification(i: {
    kind: VerificationKind; note: string; environment?: string | null;
    reference?: string | null;
  }): Promise<unknown> {
    await delay(180);
    this.requireAdmin();
    if (i.note.trim().length < 10) {
      throw new WdrApiError(
        'Zapis o proveri zahteva belešku (najmanje 10 znakova).', '23514',
      );
    }
    this.verifications[i.kind] = {
      at: new Date().toISOString(),
      note: i.note.trim(),
      environment: i.environment ?? null,
      reference: i.reference ?? null,
    };
    return { kind: i.kind };
  }

  // --- notifications -------------------------------------------------------

  async listNotifications(): Promise<NotificationItem[]> {
    await delay(100);
    return [
      { id: 1, type: 'SUBMISSION_RETURNED', text: 'Prijava za 29.06–05.07 je vraćena na ispravku.', created_at: '2026-07-06T08:12:00Z', read_at: null },
      { id: 2, type: 'PERIOD_DEADLINE', text: 'Rok za slanje perioda 06.07–12.07 je ponedeljak 13.07.', created_at: '2026-07-06T06:00:00Z', read_at: null },
    ];
  }

  async markNotificationsRead(): Promise<number> {
    await delay(80);
    return 2;
  }

  // --- internals -----------------------------------------------------------

  private applyOne(submissionId: Uuid, item: BulkEntryInput): BulkRowResult {
    const emp = EMPLOYEES.find((e) => e.employee_id === item.employee_id);
    if (!emp) throw new WdrApiError('Zaposleni ne postoji.', '23503');
    if (emp.center_id !== CENTER_B6) {
      throw new WdrApiError(
        'Zaposleni ne pripada centru ove prijave — koristite unos ispomoći (EMPLOYEE_NOT_IN_CENTER).',
        'EMPLOYEE_NOT_IN_CENTER',
      );
    }

    const idx = this.entries.findIndex(
      (e) => e.employee_id === item.employee_id && e.work_date === item.work_date,
    );

    if (item.delete) {
      if (idx < 0) {
        return { employee_id: item.employee_id, work_date: item.work_date, status: 'NOOP' };
      }
      const foreign = this.entries[idx].segments.some((s) => !s.in_this_submission);
      if (foreign) {
        throw new WdrApiError(
          'Dan sadrži segment drugog centra (FOREIGN_SEGMENT_PRESENT).',
          'FOREIGN_SEGMENT_PRESENT',
        );
      }
      this.entries.splice(idx, 1);
      return { employee_id: item.employee_id, work_date: item.work_date, status: 'DELETED' };
    }

    if (!item.attendance_status) {
      throw new WdrApiError('attendance_status je obavezan.', '22023');
    }
    const known = ['WORK', 'GO', 'BO', 'OFF', 'NOT_WORKING', 'OTHER'];
    if (!known.includes(item.attendance_status)) {
      throw new WdrApiError(`Nepoznat attendance_status ${item.attendance_status}.`, '23503');
    }

    const allowsSegments = item.attendance_status === 'WORK';
    const tpl = SHIFTS.find((s) => s.id === item.shift_template_id);
    const start = item.shift_start ?? tpl?.shift_start ?? null;
    const end = item.shift_end ?? tpl?.shift_end ?? null;
    if (allowsSegments && (!start || !end)) {
      throw new WdrApiError('Radni dan zahteva šablon smene ili vremena.', '22023');
    }

    let entry = idx >= 0 ? this.entries[idx] : undefined;
    const created = !entry;
    if (!entry) {
      entry = {
        work_entry_id: `we-${item.employee_id}-${item.work_date}`,
        employee_id: item.employee_id,
        work_date: item.work_date,
        attendance_status: item.attendance_status,
        owner_submission_id: submissionId,
        notes: item.notes ?? null,
        segments: [],
      };
      this.entries.push(entry);
    }

    if (!allowsSegments && entry.segments.some((s) => !s.in_this_submission)) {
      throw new WdrApiError(
        'Dan sadrži segment drugog centra (FOREIGN_SEGMENT_PRESENT).',
        'FOREIGN_SEGMENT_PRESENT',
      );
    }

    entry.attendance_status = item.attendance_status;
    if (item.notes !== undefined) entry.notes = item.notes;

    if (!allowsSegments) {
      entry.segments = entry.segments.filter((s) => !s.in_this_submission);
    } else {
      entry.segments = entry.segments.filter(
        (s) => !(s.in_this_submission && s.segment_type === 'REGULAR'),
      );
      entry.segments.push({
        id: this.nextSegmentId++,
        center_code: 'B6',
        cost_center_code: 'B6',
        segment_type: 'REGULAR',
        shift_template_id: tpl?.id ?? null,
        shift_start: start!,
        shift_end: end!,
        crosses_midnight: end! <= start!,
        worked_hours: hoursBetween(start!, end!),
        sequence_no: entry.segments.length + 1,
        in_this_submission: true,
        editable_here: true,
      });
    }

    return {
      employee_id: item.employee_id,
      work_date: item.work_date,
      status: created ? 'CREATED' : 'UPDATED',
      work_entry_id: entry.work_entry_id,
    };
  }

  private toCell(e: MockEntry): GridCellPayload {
    return {
      work_entry_id: e.work_entry_id,
      employee_id: e.employee_id,
      work_date: e.work_date,
      attendance_status: e.attendance_status,
      primary_payment_type_id:
        EMPLOYEES.find((x) => x.employee_id === e.employee_id)?.primary_payment_type_id ?? null,
      home_center_code: 'B6',
      owner_submission_id: e.owner_submission_id,
      owned_by_this_submission: e.owner_submission_id === SUBMISSION_B6,
      notes: e.notes,
      segments: e.segments,
      components: [],
      has_assistance: e.segments.some((s) => s.segment_type === 'ASSISTANCE'),
      has_foreign_segment: e.segments.some((s) => s.center_code !== 'B6'),
    };
  }

  /** Expected employee-days = expected dates × employees of this center. */
  private completeness() {
    const staff = EMPLOYEES.filter((e) => e.center_id === CENTER_B6);
    const missing: Array<{ employee_id: string; employee_name: string; work_date: IsoDate }> = [];
    let reviewed = 0;
    for (const e of staff) {
      for (const d of this.expectedDates) {
        const has = this.entries.some(
          (x) => x.employee_id === e.employee_id && x.work_date === d,
        );
        if (has) reviewed += 1;
        else {
          missing.push({
            employee_id: e.employee_id,
            employee_name: e.full_name,
            work_date: d,
          });
        }
      }
    }
    return {
      expected_count: staff.length * this.expectedDates.length,
      reviewed_count: reviewed,
      missing_count: missing.length,
      dates_configured: this.expectedDates.length > 0,
      expected_dates: [...this.expectedDates],
      missing,
    };
  }

  private fingerprint(parts: string[]): string {
    // Not a real sha256 — the mock only needs a stable, content-derived key so
    // that changing the data invalidates the acknowledgement, as in the database.
    const raw = parts.join('|');
    let h = 0n;
    for (const ch of raw) h = (h * 131n + BigInt(ch.codePointAt(0) ?? 0)) % (2n ** 64n);
    return h.toString(16).padStart(64, '0');
  }

  private warnings(): PreviewWarning[] {
    const out: PreviewWarning[] = [];
    for (const e of this.entries) {
      const emp = EMPLOYEES.find((x) => x.employee_id === e.employee_id);
      if (!emp || emp.transport_required !== null) continue;
      const message = `${emp.full_name}: nema evidenciju o prevozu na ${e.work_date} (ni DA ni NE).`;
      const fp = this.fingerprint([
        'MISSING_TRANSPORT_ASSIGNMENT', e.employee_id, e.work_date, message,
      ]);
      out.push({
        code: 'MISSING_TRANSPORT_ASSIGNMENT',
        message,
        employee_id: e.employee_id,
        work_date: e.work_date,
        fingerprint: fp,
        acknowledged: this.acks.has(fp),
      });
    }
    return out;
  }

  private hardErrors(c: ReturnType<MockWdrApi['completeness']>) {
    const out: Array<{ code: string; message: string; employee_id: string | null; work_date: IsoDate | null }> = [];

    if (this.entries.length === 0) {
      out.push({
        code: 'EMPTY_SUBMISSION',
        message: 'Prijava ne sadrži ni jedan zapis.',
        employee_id: null, work_date: null,
      });
    }
    if (c.missing_count > 0) {
      out.push({
        code: 'INCOMPLETE_EXPECTED_ENTRIES',
        message: `Nije pregledano ${c.missing_count} od ${c.expected_count} očekivanih employee-dana (pregledano ${c.reviewed_count}).`,
        employee_id: null, work_date: null,
      });
    }
    for (const e of this.entries) {
      if (e.attendance_status === 'WORK' && e.segments.length === 0) {
        const emp = EMPLOYEES.find((x) => x.employee_id === e.employee_id);
        out.push({
          code: 'MISSING_WORK_SEGMENT',
          message: `${emp?.full_name ?? e.employee_id}: ${e.work_date} je označen kao rad, ali nema ni jedan segment rada.`,
          employee_id: e.employee_id, work_date: e.work_date,
        });
      }
    }
    return out;
  }

  private validate(): { errors: number; warnings: number } {
    let errors = 0;
    let warnings = 0;
    for (const e of this.entries) {
      if (e.attendance_status === 'WORK' && e.segments.length === 0) errors += 1;
      const emp = EMPLOYEES.find((x) => x.employee_id === e.employee_id);
      if (emp && emp.transport_required === null) warnings += 1;
    }
    return { errors, warnings };
  }

  private notify() {
    for (const cb of this.listeners) cb();
  }
}

function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
