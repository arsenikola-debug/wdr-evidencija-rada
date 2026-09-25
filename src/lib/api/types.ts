/**
 * TypeScript contracts for the WDR database API.
 *
 * These types mirror `docs/RPC-CONTRACTS.md` exactly. They are the boundary of the
 * application: no calculation logic lives on this side. PostgreSQL resolves every
 * rate, total and validation result; the browser only formats what it receives.
 */

export type Uuid = string;
/** `YYYY-MM-DD` in the business timezone (Europe/Belgrade). */
export type IsoDate = string;
/** `HH:MM:SS` local clock time. */
export type ClockTime = string;

export type AttendanceStatusCode =
  | 'WORK'
  | 'GO'
  | 'BO'
  | 'OFF'
  | 'NOT_WORKING'
  | 'OTHER';

export type SegmentTypeCode = 'REGULAR' | 'ASSISTANCE' | 'OVERTIME' | 'OTHER';

export type SubmissionStatus =
  | 'DRAFT'
  | 'READY_FOR_REVIEW'
  | 'SUBMITTED'
  | 'RETURNED'
  | 'FINANCE_APPROVED'
  | 'CLOSED';

// ---------------------------------------------------------------------------
// api.rpc_get_grid
// ---------------------------------------------------------------------------

export interface GridSubmission {
  id: Uuid;
  center_id: Uuid;
  center_code: string;
  center_name: string;
  period_id: Uuid;
  period_start: IsoDate;
  period_end: IsoDate;
  status: SubmissionStatus;
  review_confirmed: boolean;
  editable: boolean;
  can_write: boolean;
}

export interface AttendanceStatusRef {
  code: AttendanceStatusCode;
  name: string;
  allows_segments: boolean;
}

export interface ShiftTemplateRef {
  id: Uuid;
  code: string;
  label: string;
  shift_start: ClockTime;
  shift_end: ClockTime;
  crosses_midnight: boolean;
}

export interface PaymentTypeRef {
  id: Uuid;
  code: string;
  name: string;
  kind: 'PRIMARY' | 'COMPONENT';
  default_unit_type: string;
  requires_units: boolean;
  allows_cost_center_override: boolean;
}

export interface SegmentTypeRef {
  code: SegmentTypeCode;
  name: string;
  counts_as_worked_day: boolean;
}

export interface CenterRef {
  id: Uuid;
  code: string;
  name: string;
}

export interface GridReference {
  attendance_statuses: AttendanceStatusRef[];
  shift_templates: ShiftTemplateRef[];
  payment_types: PaymentTypeRef[];
  segment_types: SegmentTypeRef[];
  centers: CenterRef[];
}

export interface GridEmployee {
  employee_id: Uuid;
  full_name: string;
  employee_code: string | null;
  home_center_code: string | null;
  primary_payment_type_id: Uuid | null;
  primary_payment_type_code: string | null;
  default_shift_template_id: Uuid | null;
  transport_required: boolean | null;
  transport_provider_code: string | null;
}

export interface GridSegment {
  id: number;
  center_code: string;
  cost_center_code: string | null;
  segment_type: SegmentTypeCode;
  shift_template_id: Uuid | null;
  shift_start: ClockTime;
  shift_end: ClockTime;
  crosses_midnight: boolean;
  worked_hours: number;
  sequence_no: number;
  in_this_submission: boolean;
  /** false = entered through another center's submission; read-only here. */
  editable_here: boolean;
}

export interface GridComponent {
  id: number;
  payment_type_id: Uuid;
  payment_type_code: string;
  work_segment_id: number | null;
  units: number;
  cost_center_code: string | null;
  in_this_submission: boolean;
}

export interface GridCellPayload {
  work_entry_id: Uuid;
  employee_id: Uuid;
  work_date: IsoDate;
  attendance_status: AttendanceStatusCode;
  primary_payment_type_id: Uuid | null;
  home_center_code: string;
  owner_submission_id: Uuid;
  owned_by_this_submission: boolean;
  notes: string | null;
  segments: GridSegment[];
  components: GridComponent[];
  has_assistance: boolean;
  has_foreign_segment: boolean;
}

export interface GridValidationSummary {
  errors: number;
  warnings: number;
}

export interface GridPayload {
  submission: GridSubmission;
  dates: IsoDate[];
  reference: GridReference;
  employees: GridEmployee[];
  cells: GridCellPayload[];
  validation: GridValidationSummary;
}

// ---------------------------------------------------------------------------
// api.rpc_bulk_upsert_work_entries
// ---------------------------------------------------------------------------

export interface BulkComponentInput {
  payment_type_id: Uuid;
  units: number;
  cost_center_id?: Uuid | null;
  notes?: string | null;
}

export interface BulkEntryInput {
  employee_id: Uuid;
  work_date: IsoDate;
  /** Required unless `delete` is true. */
  attendance_status?: AttendanceStatusCode;
  shift_template_id?: Uuid | null;
  shift_start?: ClockTime | null;
  shift_end?: ClockTime | null;
  primary_payment_type_id?: Uuid | null;
  notes?: string | null;
  /** Replaces every segment-less component of this submission when present. */
  components?: BulkComponentInput[];
  delete?: boolean;
}

export type BulkRowStatus = 'CREATED' | 'UPDATED' | 'DELETED' | 'NOOP' | 'ERROR';

export interface BulkRowResult {
  employee_id: Uuid;
  work_date: IsoDate;
  status: BulkRowStatus;
  work_entry_id?: Uuid | null;
  error_code?: string;
  error_message?: string;
}

export interface BulkUpsertResult {
  submission_id: Uuid;
  atomic: boolean;
  succeeded: number;
  failed: number;
  results: BulkRowResult[];
  validation: GridValidationSummary;
}

// ---------------------------------------------------------------------------
// api.rpc_add_assistance_segment
// ---------------------------------------------------------------------------

export interface AssistanceSegmentInput {
  p_employee_id: Uuid;
  p_work_date: IsoDate;
  p_work_center_id: Uuid;
  p_shift_start?: ClockTime | null;
  p_shift_end?: ClockTime | null;
  p_shift_template_id?: Uuid | null;
  p_segment_type?: SegmentTypeCode;
  /**
   * Requires the `cost_center.override` permission AND write access to the
   * receiving center. For MVP only SUPER_ADMIN_BA has it, so the grid does not
   * offer this field to operators.
   */
  p_cost_center_id?: Uuid | null;
  p_notes?: string | null;
}

/** Every field is read back from the persisted row, never from the request. */
export interface AssistanceSegmentResult {
  work_entry_id: Uuid;
  work_segment_id: number;
  created_work_entry: boolean;
  created_work_segment: boolean;
  employee_id: Uuid;
  work_date: IsoDate;
  segment_type: SegmentTypeCode;
  shift_start: ClockTime;
  shift_end: ClockTime;
  sequence_no: number;
  worked_hours: number;
  crosses_midnight: boolean;
  home_center_code: string;
  work_center_code: string;
  cost_center_code: string | null;
  home_submission_id: Uuid;
  work_submission_id: Uuid;
}

// ---------------------------------------------------------------------------
// api.rpc_set_overtime_component
// ---------------------------------------------------------------------------

export interface OvertimeComponentInput {
  p_submission_id: Uuid;
  p_employee_id: Uuid;
  p_work_date: IsoDate;
  /** Explicit overtime hours. null/0 clears overtime for the day. */
  p_units: number | null;
}

export interface OvertimeComponentResult {
  work_entry_id: Uuid;
  employee_id: Uuid;
  work_date: IsoDate;
  payment_type_id: Uuid;
  units: number;
}

// ---------------------------------------------------------------------------
// api.rpc_get_submission_preview
// ---------------------------------------------------------------------------

export type PreviewLineKind = 'PRIMARY' | 'COMPONENT' | 'TRANSPORT';

export type PreviewLineStatus =
  | 'RESOLVED'
  | 'MISSING_RULE'
  | 'MISSING_PAYMENT_TYPE'
  | 'NOT_ELIGIBLE'
  | 'NO_TRANSPORT_ASSIGNMENT';

export interface PreviewLine {
  work_entry_id: Uuid;
  employee_id: Uuid;
  employee_name: string;
  work_date: IsoDate;
  line_kind: PreviewLineKind;
  payment_type_code: string | null;
  basis: string;
  center_code: string | null;
  rule_id: Uuid | null;
  rule_version: number | null;
  rate: number | null;
  unit_type: string | null;
  units: number;
  /** null when the line cannot be priced. Never 0 as a substitute. */
  calculated_amount: number | null;
  status: PreviewLineStatus;
}

export interface PreviewTotals {
  by_line_kind: Record<string, number>;
  /** Sum of RESOLVED lines. Always present — but partial when is_complete is false. */
  resolved_subtotal: number;
  /** null while any blocking monetary line exists. Never render a partial sum here. */
  total_calculated_amount: number | null;
  is_complete: boolean;
  blocking_line_count: number;
}

// ---------------------------------------------------------------------------
// A. Evidencija — expected vs reviewed employee-days (server-side control)
// ---------------------------------------------------------------------------

export interface MissingEntry {
  employee_id: Uuid;
  employee_name: string;
  work_date: IsoDate;
}

export interface PreviewCompleteness {
  expected_count: number;
  reviewed_count: number;
  missing_count: number;
  /**
   * false = no expected working dates configured for this submission, which is
   * itself a hard error: the control cannot be verified.
   */
  dates_configured: boolean;
  /** Expected working dates as decided by the server, for the progress display. */
  expected_dates: IsoDate[];
  missing: MissingEntry[];
}

// ---------------------------------------------------------------------------
// C. Kontrole — hard errors and warning acknowledgements
// ---------------------------------------------------------------------------

export interface PreviewHardError {
  code: string;
  message: string;
  employee_id: Uuid | null;
  work_date: IsoDate | null;
}

export interface PreviewWarning {
  code: string;
  message: string;
  employee_id: Uuid | null;
  work_date: IsoDate | null;
  /**
   * Stable fingerprint of this exact warning instance. It includes the message,
   * so when the underlying data changes the fingerprint changes and an earlier
   * acknowledgement no longer satisfies it.
   */
  fingerprint: string;
  acknowledged: boolean;
}

export interface IncompleteOverride {
  reason: string;
  by: string | null;
  at: string;
  /** Present on the Finance detail: an authorized override is not a blocker. */
  authorized?: boolean;
  expected_count?: number;
  reviewed_count?: number;
  missing_count?: number;
}

export interface PreviewValidationItem {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  employee_id: Uuid | null;
  work_date: IsoDate | null;
}

export interface SubmissionPreview {
  submission: {
    id: Uuid;
    center_id: Uuid;
    center_code: string;
    period_start: IsoDate;
    period_end: IsoDate;
    status: SubmissionStatus;
    editable: boolean;
  };

  /** A. Evidencija */
  completeness: PreviewCompleteness;

  /** B. Obračun */
  lines: PreviewLine[];
  totals: PreviewTotals;
  /** Sums of RESOLVED lines only — deliberately not called `by_center`. */
  resolved_by_center: Record<string, number>;
  blocking: PreviewLine[];

  /** C. Kontrole */
  hard_errors: PreviewHardError[];
  hard_error_count: number;
  warnings: PreviewWarning[];
  unacknowledged_warning_count: number;
  incomplete_override: IncompleteOverride | null;

  /** The server's answer. The button follows this, never a client calculation. */
  ready_to_submit: boolean;
  can_submit: boolean;
  is_estimate: boolean;
  note: string;
}

// ---------------------------------------------------------------------------
// api.rpc_submit_period
// ---------------------------------------------------------------------------

export interface SubmitPeriodResult {
  submission_id: Uuid;
  status: SubmissionStatus;
  submitted_at: string;
  expected_count: number;
  reviewed_count: number;
  missing_count: number;
  incomplete_override: boolean;
  notified_approvers: number;
  acknowledged_warnings: Array<{ code: string; message: string; fingerprint: string }>;
}

// ---------------------------------------------------------------------------
// Session / identity (read from public tables under RLS, not an RPC)
// ---------------------------------------------------------------------------

export interface CenterAccess {
  center_id: Uuid;
  center_code: string;
  center_name: string;
  can_write: boolean;
}

export interface SessionProfile {
  profile_id: Uuid;
  full_name: string;
  email: string;
  roles: string[];
  permissions: string[];
  centers: CenterAccess[];
}

export interface SubmissionListItem {
  id: Uuid;
  center_id: Uuid;
  center_code: string;
  period_id: Uuid;
  period_label: string;
  period_start: IsoDate;
  period_end: IsoDate;
  status: SubmissionStatus;
  /** Poslednji Finance komentar dok je prijava RETURNED. */
  return_reason?: string | null;
}

/**
 * Rezultat api.rpc_create_period_submission (PREDLOŽENA migracija 0053).
 * `created=false` znači da je prijava za taj centar i raspon već postojala.
 */
export interface CreatePeriodSubmissionResult {
  submission_id: Uuid;
  center_id: Uuid;
  center_code: string;
  period_id: Uuid;
  period_label: string;
  period_start: IsoDate;
  period_end: IsoDate;
  status: SubmissionStatus;
  created: boolean;
}

export interface NotificationItem {
  id: number;
  type: string;
  text: string;
  created_at: string;
  read_at: string | null;
}

// ---------------------------------------------------------------------------
// Finance surface (api.rpc_get_finance_queue / _submission / _history,
// api.rpc_calculate_submission, api.rpc_finance_approve, api.rpc_finance_return)
// ---------------------------------------------------------------------------

/** Statuses a submission can have once it has left the center. */
export type FinanceQueueStatus = 'SUBMITTED' | 'RETURNED' | 'FINANCE_APPROVED' | 'CLOSED';

export type CalcLineKind = 'PRIMARY' | 'COMPONENT' | 'TRANSPORT';

export type CalcLineStatus =
  | 'RESOLVED'
  | 'MISSING_RULE'
  | 'MISSING_PAYMENT_TYPE'
  | 'RULE_NOT_PRICEABLE'
  | 'NOT_ELIGIBLE'
  | 'NO_TRANSPORT_ASSIGNMENT';

/**
 * The recap the Finance screen renders. `ukupno_za_odobrenje` is null whenever
 * the engine could not price every monetary line — never render a partial sum
 * in its place.
 */
export interface FinanceRecap {
  naknade_zaposlenima: number;
  prekovremeni: number;
  radna_subota: number;
  ispomoc: number;
  dodatne_stavke: number;
  prevoz: number;
  resolved_subtotal: number;
  ukupno_za_odobrenje: number | null;
  is_complete: boolean;
  blocking_line_count: number;
  line_count: number;
  employee_count: number;
  worked_employee_days: number;
}

export interface CalcLine {
  line_no: number;
  work_entry_id: Uuid;
  employee_id: Uuid;
  employee_name: string;
  employee_code: string | null;
  work_date: IsoDate;
  attendance_status: AttendanceStatusCode;
  segment_type: SegmentTypeCode | null;
  shift_start: ClockTime | null;
  shift_end: ClockTime | null;
  crosses_midnight: boolean | null;
  worked_hours: number | null;
  line_kind: CalcLineKind;
  payment_type_code: string | null;
  basis: string;
  center_code: string | null;
  cost_center_code: string | null;
  unit_type: string | null;
  units: number;
  rate: number | null;
  /** null when the line cannot be priced. Never 0 as a substitute. */
  amount: number | null;
  transport_provider_code: string | null;
  responsible_person_code: string | null;
  liters: number | null;
  status: CalcLineStatus;
  pricing_problem: string | null;
}

export interface CalcEmployeeDay {
  employee_id: Uuid;
  employee_name: string;
  employee_code: string | null;
  work_date: IsoDate;
  attendance_status: AttendanceStatusCode;
  worked_hours: number | null;
  day_amount: number | null;
  day_resolved_subtotal: number;
  blocking_line_count: number;
  lines: Array<Pick<
    CalcLine,
    | 'line_kind'
    | 'payment_type_code'
    | 'center_code'
    | 'cost_center_code'
    | 'basis'
    | 'unit_type'
    | 'units'
    | 'rate'
    | 'amount'
    | 'transport_provider_code'
    | 'status'
    | 'pricing_problem'
  >>;
}

/** Transport grouped as Q18 requires: center, provider, responsible person. */
export interface TransportGroup {
  transport_provider_code: string | null;
  responsible_person_code: string | null;
  center_code: string | null;
  rate: number | null;
  liters_per_unit: number | null;
  eligible_employee_days: number;
  units: number;
  amount: number | null;
  blocking_line_count: number;
  status: CalcLineStatus;
}

export interface TransportBreakdown {
  groups: TransportGroup[];
  by_provider: Record<string, number>;
  by_responsible_person: Record<string, number>;
  not_eligible_count: number;
  no_assignment_count: number;
}

export interface FinanceQueueItem {
  submission_id: Uuid;
  center_id: Uuid;
  center_code: string;
  center_name: string;
  period_id: Uuid;
  period_label: string;
  period_start: IsoDate;
  period_end: IsoDate;
  status: FinanceQueueStatus;
  submitted_at: string | null;
  submitted_by: string | null;
  waiting_hours: number | null;
  waiting_days: number | null;
  /** EFFECTIVE blocking errors: an authorized override is not counted here. */
  hard_error_count: number;
  overridden_error_count: number;
  unacknowledged_warning_count: number;
  incomplete_override: boolean;
  recap: FinanceRecap;
  approved: {
    approved_at: string;
    approved_by: string | null;
    approved_amount: number;
    payable_amount: number;
    snapshot_id: Uuid;
    content_hash: string | null;
    submitted_incomplete: boolean;
  } | null;
}

export interface FinanceQueue {
  filters: {
    statuses: FinanceQueueStatus[];
    center_ids: Uuid[];
    date_from: IsoDate | null;
    date_to: IsoDate | null;
  };
  items: FinanceQueueItem[];
  totals: {
    count: number;
    by_status: Record<string, number>;
    approvable_total: number;
    blocked_count: number;
    incomplete_override_count: number;
  };
  engine_version: string;
}

export interface FinanceWarning {
  code: string;
  message: string;
  employee_id: Uuid | null;
  work_date: IsoDate | null;
  fingerprint: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  note: string | null;
}

export type ApprovalBlocker =
  | 'WRONG_STATUS'
  | 'HARD_ERRORS'
  | 'UNACKNOWLEDGED_WARNINGS'
  | 'INCOMPLETE_CALCULATION'
  | 'NO_PERMISSION';

export interface FinanceSubmissionDetail {
  submission: {
    id: Uuid;
    center_id: Uuid;
    center_code: string;
    center_name: string;
    period_id: Uuid;
    period_label: string;
    period_start: IsoDate;
    period_end: IsoDate;
    status: SubmissionStatus;
    submitted_at: string | null;
    submitted_by: string | null;
    returned_at: string | null;
    approved_at: string | null;
    closed_at: string | null;
    /** A period crossing two months stays ONE submission and ONE snapshot. */
    crosses_month: boolean;
  };
  engine_version: string;
  rounding_config: Record<string, unknown>;
  recap: FinanceRecap;
  employee_days: CalcEmployeeDay[];
  transport: TransportBreakdown;
  lines: CalcLine[];
  blocking: CalcLine[];
  hard_errors: PreviewHardError[];
  hard_error_count: number;
  /**
   * Errors an authorized incomplete override neutralised. They are NOT blocking,
   * but they are returned so the exception stays visible to Finance.
   */
  overridden_errors: PreviewHardError[];
  completeness: {
    expected_count: number;
    reviewed_count: number;
    missing_count: number;
    dates_configured: boolean;
  };
  warnings: FinanceWarning[];
  unacknowledged_warning_count: number;
  incomplete_override: IncompleteOverride | null;
  comments: Array<{ author: string | null; message: string; created_at: string }>;
  /** Q16 MODEL A: Finance confirms the calculated amount, it cannot edit it. */
  approval_mode: 'CONFIRMATION_ONLY';
  amount_editable: false;
  can_approve: boolean;
  can_return: boolean;
  approval_blockers: ApprovalBlocker[];
  approval: {
    snapshot_id: Uuid;
    approved_at: string;
    approved_by: string | null;
    approved_amount: number;
    payable_amount: number;
    finance_comment: string | null;
    content_hash: string;
    engine_version: string;
    rounding_config: Record<string, unknown>;
    employee_calculated_amount: number;
    overtime_calculated_amount: number;
    other_calculated_amount: number;
    transport_calculated_amount: number;
    total_calculated_amount: number;
  } | null;
}

export interface FinanceApproveResult {
  submission_id: Uuid;
  status: 'FINANCE_APPROVED';
  snapshot_id: Uuid;
  approved_at: string;
  approval_mode: 'CONFIRMATION_ONLY';
  approved_amount: number;
  payable_amount: number;
  recap: Omit<
    FinanceRecap,
    | 'resolved_subtotal'
    | 'is_complete'
    | 'blocking_line_count'
    | 'line_count'
    | 'employee_count'
    | 'worked_employee_days'
  >;
  snapshot_lines: number;
  transport_lines: number;
  employee_count: number;
  worked_employee_days: number;
  content_hash: string;
  engine_version: string;
  notified_submitter: number;
  note: string;
}

export interface FinanceHistoryItem {
  /**
   * PERIOD = redovan obračun perioda, ADJUSTMENT = odobren dodatni zahtev,
   * COURIER_STOPS = odobreni stopovi kurira (migracija 0042). Jedna istorija za
   * sve izvore; `transaction_type` je jedini kriterijum razdvajanja.
   */
  transaction_type: 'PERIOD' | 'ADJUSTMENT' | 'COURIER_STOPS' | 'COURIER_STOP_ADJUSTMENT';
  transaction_type_label: string;
  source_type?: 'REGULAR_WDR' | 'ADJUSTMENT' | 'COURIER_STOPS' | 'COURIER_STOP_ADJUSTMENT';
  /** Samo za COURIER_STOPS. */
  total_stops?: number | null;
  approval_id: Uuid;
  snapshot_id: Uuid;
  submission_id: Uuid | null;
  adjustment_request_id: Uuid | null;
  /** Economic attribution (work dates); the transaction date is approved_at. */
  economic_period_start: IsoDate;
  economic_period_end: IsoDate;
  submitted_incomplete: boolean;
  adjustment: {
    direction: 'DEBIT' | 'CREDIT';
    direction_label: string;
    employee_name: string;
    related_work_date: IsoDate;
    payment_type_code: string;
    units: number;
    reason: string;
    original_submission_id: Uuid | null;
  } | null;
  center_id: Uuid;
  center_code: string;
  period_start: IsoDate;
  period_end: IsoDate;
  approved_at: string;
  approved_by: string | null;
  approved_amount: number;
  payable_amount: number;
  employee_calculated_amount: number;
  overtime_calculated_amount: number;
  other_calculated_amount: number;
  transport_calculated_amount: number;
  total_calculated_amount: number;
  employee_count: number;
  worked_employee_days: number;
  engine_version: string;
  /** Korekcije nemaju sopstveni snapshot, pa ni hash. */
  content_hash: string | null;
  submission_status: SubmissionStatus | null;
}

export interface FinanceHistory {
  items: FinanceHistoryItem[];
  note: string;
}

// ---------------------------------------------------------------------------
// Dodatni zahtevi — Doplata / Umanjenje (api.rpc_*_adjustment)
// ---------------------------------------------------------------------------

/** Internal codes stay stable; the user-facing wording is Doplata / Umanjenje. */
export type AdjustmentDirection = 'DEBIT' | 'CREDIT';

export type AdjustmentStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'RETURNED'
  | 'APPROVED'
  | 'REJECTED';

export type AdjustmentCalcStatus = 'RESOLVED' | 'MISSING_RULE' | 'RULE_NOT_PRICEABLE';

/**
 * The amount the engine resolved from the rule in force on the WORK date.
 * `amount_editable` is always false: neither the operator nor Finance types money.
 */
export interface AdjustmentCalculation {
  attendance_status: AttendanceStatusCode | null;
  /** Which center's rate applies, and WHY that center (D-R5/D-R6). */
  rate_center_code: string | null;
  rate_center_basis: string | null;
  rule_id: Uuid | null;
  rule_version: number | null;
  rate: number | null;
  unit_type: string | null;
  units: number;
  units_signed: number;
  amount_abs: number | null;
  /** DEBIT = positive, CREDIT = negative. */
  amount_signed: number | null;
  sign: number;
  status: AdjustmentCalcStatus;
  pricing_problem: string | null;
  amount_editable: false;
  note: string;
}

export interface AdjustmentPreview {
  related_work_date: IsoDate;
  direction: AdjustmentDirection;
  direction_label: string;
  attendance_status: AttendanceStatusCode | null;
  rate_center_code: string | null;
  rate_center_basis: string | null;
  segment_problem?: string | null;
  rule_id: Uuid | null;
  rule_version: number | null;
  rate: number | null;
  unit_type: string | null;
  units: number;
  amount_abs: number | null;
  amount_signed: number | null;
  status: AdjustmentCalcStatus;
  pricing_problem: string | null;
  amount_editable: false;
  is_estimate: true;
  note: string;
}

export interface Adjustment {
  id: Uuid;
  status: AdjustmentStatus;
  direction: AdjustmentDirection;
  direction_label: string;
  employee_id: Uuid;
  employee_name: string;
  related_work_date: IsoDate;
  center_id: Uuid;
  center_code: string;
  cost_center_code: string | null;
  payment_type_id: Uuid;
  payment_type_code: string;
  units: number;
  reason: string;
  original_submission_id: Uuid | null;
  requested_by: string | null;
  requested_at: string;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  finance_comment: string | null;
  editable: boolean;
  calculation: AdjustmentCalculation;
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  can_submit: boolean;
  can_approve: boolean;
  can_decide: boolean;
  /** Q26: Finance must explicitly confirm a day that was never recorded. */
  no_work_entry_exception?: boolean;
  requires_no_work_entry_ack?: boolean;
  no_work_entry_ack?: { by: string | null; at: string } | null;
  work_segment_id?: number | null;
  requested_by_id?: Uuid | null;
  approval: {
    snapshot_id: Uuid;
    approved_at: string;
    approved_by: string | null;
    approved_amount: number;
    payable_amount: number;
    content_hash: string;
    engine_version: string;
    /** Economic attribution stays the work date, also after approval. */
    economic_date: IsoDate;
    total_calculated_amount: number;
  } | null;
}

export interface AdjustmentQueue {
  filters: { statuses: AdjustmentStatus[] };
  items: Adjustment[];
  totals: {
    count: number;
    doplata_total: number;
    umanjenje_total: number;
    /** Doplata − Umanjenje: the net effect on cost. */
    net_total: number;
    blocked_count: number;
  };
}

export interface AdjustmentInput {
  id?: Uuid | null;
  employee_id: Uuid;
  related_work_date: IsoDate;
  center_id: Uuid;
  payment_type_id: Uuid;
  units: number;
  direction: AdjustmentDirection;
  reason: string;
  original_submission_id?: Uuid | null;
  cost_center_id?: Uuid | null;
  /** Which work segment the correction refers to on a multi-center day. */
  work_segment_id?: number | null;
}

export type FinanceTransactionType = 'PERIOD' | 'ADJUSTMENT';

// ---------------------------------------------------------------------------
// Administracija / Konfiguracija (api.rpc_admin_*)
// ---------------------------------------------------------------------------

/**
 * Behavior keys are the IMMUTABLE identity the engine reads. Code, name, label,
 * colour, order and active state are editable presentation.
 */
export type AttendanceBehaviorKey =
  | 'PRESENT_WORK'
  | 'ANNUAL_LEAVE'
  | 'SICK_LEAVE'
  | 'NON_WORKING'
  | 'OTHER';

export type PaymentBehaviorKey =
  | 'PRIMARY_DAILY'
  | 'OVERTIME_HOURS'
  | 'SATURDAY_WORK'
  | 'ASSISTANCE'
  | 'ADDITIONAL_ALLOWANCE'
  | 'GENERIC_COMPONENT';

export interface BehaviorCatalogItem {
  behavior_key: string;
  name: string;
  description: string;
  kind?: 'PRIMARY' | 'COMPONENT';
  sort_order: number;
  /**
   * Derived semantics owned by the behavior (migration 0026). These are NOT
   * separately editable: a status/payment type inherits them by choosing a
   * behavior, so the Admin UI shows them read-only.
   */
  allows_segments?: boolean;
  counts_as_present?: boolean;
  allowed_unit_types?: string[];
  requires_units?: boolean;
  allows_cost_center_override?: boolean;
}

export interface AdminCenter {
  id: Uuid;
  code: string;
  name: string;
  active: boolean;
  sort_order: number;
}

export interface AdminShiftTemplate {
  /** True = already used in recorded work; times are then frozen. */
  in_use?: boolean;
  id: Uuid;
  code: string;
  label: string;
  shift_start: ClockTime;
  shift_end: ClockTime;
  crosses_midnight: boolean;
  center_id: Uuid | null;
  active: boolean;
  sort_order: number;
}

export interface AdminAttendanceStatus {
  code: string;
  name: string;
  behavior_key: AttendanceBehaviorKey;
  allows_segments: boolean;
  counts_as_present: boolean;
  active: boolean;
  sort_order: number;
  short_label: string | null;
  shortcut_key: string | null;
  color_token: string | null;
  in_use: boolean;
}

export interface AdminPaymentType {
  id: Uuid;
  code: string;
  name: string;
  behavior_key: PaymentBehaviorKey;
  kind: 'PRIMARY' | 'COMPONENT';
  default_unit_type: string;
  requires_units: boolean;
  allows_cost_center_override: boolean;
  active: boolean;
  sort_order: number;
  notes: string | null;
  in_use: boolean;
}

export interface AdminCompensationRule {
  id: Uuid;
  rule_group_id: Uuid;
  version: number;
  center_id: Uuid | null;
  center_code: string | null;
  payment_type_id: Uuid;
  payment_type_code: string;
  attendance_status: string | null;
  amount: number;
  unit_type: string;
  multiplier: number | null;
  valid_from: IsoDate;
  valid_to: IsoDate | null;
  active: boolean;
  notes: string | null;
  in_use: boolean;
}

export interface AdminTransportRule {
  id: Uuid;
  rule_group_id: Uuid;
  version: number;
  transport_provider_id: Uuid;
  provider_code: string;
  center_id: Uuid | null;
  center_code: string | null;
  rule_type: string;
  amount_per_unit: number | null;
  liters_per_unit: number | null;
  price_per_liter: number | null;
  eligible_attendance_statuses: string[];
  responsible_person_id: Uuid | null;
  valid_from: IsoDate;
  valid_to: IsoDate | null;
  active: boolean;
  in_use: boolean;
}

export interface AdminUser {
  profile_id: Uuid;
  full_name: string;
  email: string | null;
  active: boolean;
  roles: string[];
  centers: Array<{ center_code: string; can_write: boolean }>;
  permission_overrides: Array<{ permission_code: string; mode: string; reason: string | null }>;
}

export interface EmployeeFormReference {
  centers: Array<{ id: Uuid; code: string; name: string }>;
  shift_templates: Array<{
    id: Uuid; code: string; label: string; shift_start: ClockTime; shift_end: ClockTime;
    crosses_midnight: boolean; center_id: Uuid | null;
  }>;
  payment_types: Array<{ id: Uuid; code: string; name: string; kind: 'PRIMARY' }>;
  transport_providers: Array<{ id: Uuid; code: string; name: string }>;
}

export interface AdminConfig {
  /** What this caller may change. The database re-checks every call anyway. */
  can: {
    centers: boolean;
    reference: boolean;
    payment_types: boolean;
    comp_rules: boolean;
    transport: boolean;
    providers: boolean;
    users: boolean;
    roles: boolean;
    employees: boolean;
    controls: boolean;
    /** rules.courier_stops.manage (migracija 0038). */
    rates_stops?: boolean;
  };
  attendance_behaviors: BehaviorCatalogItem[];
  payment_behaviors: BehaviorCatalogItem[];
  centers: AdminCenter[];
  shift_templates: AdminShiftTemplate[];
  attendance_statuses: AdminAttendanceStatus[];
  payment_types: AdminPaymentType[];
  compensation_rules: AdminCompensationRule[];
  transport_providers: Array<{ id: Uuid; code: string; name: string; active: boolean;
    responsible_person_id: Uuid | null }>;
  responsible_persons: Array<{ id: Uuid; code: string; full_name: string; active: boolean }>;
  transport_rules: AdminTransportRule[];
  /** Q22: only these may be offered as active options. */
  transport_rule_types_allowed: string[];
  employee_transport_assignments: Array<{
    id: Uuid; employee_id: Uuid; employee_name: string; provider_code: string | null;
    transport_required: boolean; valid_from: IsoDate; valid_to: IsoDate | null;
  }>;
  expected_date_patterns: Array<{
    id: Uuid; code: string; name: string; center_id: Uuid | null; center_code: string | null;
    included_iso_weekdays: number[]; valid_from: IsoDate; valid_to: IsoDate | null;
    active: boolean;
  }>;
  employees: Array<{ id: Uuid; full_name: string; employee_code: string | null }>;
  roles: Array<{ id: Uuid; code: string; name: string }>;
  permissions: Array<{ id: Uuid; code: string; name: string; area: string }>;
  /** Permissions that move money or widen access — the UI warns explicitly. */
  sensitive_permissions: string[];
  /** Control rules and their effective configuration, editable from Admin. */
  control_rules: ControlRule[];
  control_rule_history: Array<{
    id: Uuid; rule_code: string; version: number; enabled: boolean;
    threshold_value: number | null; severity: ControlSeverity;
    valid_from: IsoDate; valid_to: IsoDate | null; notes: string | null;
  }>;
  control_severities: ControlSeverity[];
  users: AdminUser[];
  /** Q28: fixed for MVP — displayed, never edited here. */
  system_settings_readonly: {
    timezone: unknown; rounding: unknown; night_shift_attribution: unknown; note: string;
  };
}

// ---------------------------------------------------------------------------
// Employee Master (api.rpc_*_employee*)
// ---------------------------------------------------------------------------

export interface EmployeeDuplicateCheck {
  /** Non-null = hard error: the same employee code already exists. */
  exact_code: {
    id: Uuid; full_name: string; employee_code: string | null; active: boolean;
  } | null;
  /** Same name — a warning, never an automatic merge. */
  exact_name: Array<{
    id: Uuid; full_name: string; employee_code: string | null; active: boolean;
    employment_start_date: IsoDate;
  }>;
  similar: Array<{
    id: Uuid; full_name: string; employee_code: string | null; active: boolean;
    similarity: number;
  }>;
  note: string;
}

export interface EmployeeListItem {
  id: Uuid;
  employee_code: string | null;
  full_name: string;
  active: boolean;
  employment_start_date: IsoDate;
  employment_end_date: IsoDate | null;
  current_center_code: string | null;
  current_center_id: Uuid | null;
  primary_payment_type_code: string | null;
  default_shift_code: string | null;
  transport_required: boolean | null;
  transport_provider_code: string | null;
}

export interface EmployeeList {
  items: EmployeeListItem[];
  limit: number;
  offset: number;
  total: number;
}

export interface EmployeeAssignmentRow {
  id: Uuid;
  center_code: string | null;
  center_id: Uuid;
  valid_from: IsoDate;
  valid_to: IsoDate | null;
  primary_payment_type_code: string | null;
  default_shift_code: string | null;
  is_current: boolean;
  notes: string | null;
}

export interface EmployeeTransportRow {
  id: Uuid;
  transport_required: boolean;
  provider_code: string | null;
  provider_id: Uuid | null;
  valid_from: IsoDate;
  valid_to: IsoDate | null;
  is_current: boolean;
}

export interface EmployeeProfile {
  employee: {
    id: Uuid;
    employee_code: string | null;
    first_name: string;
    last_name: string;
    full_name: string;
    active: boolean;
    employment_start_date: IsoDate;
    employment_end_date: IsoDate | null;
    notes: string | null;
  };
  can: { edit: boolean; assign: boolean; transport: boolean };
  /**
   * The boundary of approved history. Assignments and transport are not editable
   * up to and including `last_approved_work_date` — changes are made forward.
   */
  history_guard: {
    first_approved_work_date: IsoDate | null;
    last_approved_work_date: IsoDate | null;
    note: string;
  };
  assignments: EmployeeAssignmentRow[];
  transport: EmployeeTransportRow[];
  period: { from: IsoDate; to: IsoDate };
  operational_summary: Array<{
    month: string; center_code: string | null; worked_days: number; go_days: number;
    bo_days: number; overtime_hours: number; employee_calculated_amount: number;
    transport_calculated_amount: number; adjustment_calculated_amount: number;
    total_calculated_amount: number;
  }>;
  /** Approved money comes from immutable snapshots, with snapshot semantics. */
  approved_payments: Array<{
    work_date: IsoDate; center_code: string; line_kind: string;
    payment_type_code: string; payment_behavior: string | null;
    attendance_behavior: string | null; units: number; rate_used: number;
    amount: number; is_adjustment: boolean;
  }>;
  adjustments: Array<{
    id: Uuid; status: string; direction: string; direction_label: string;
    related_work_date: IsoDate; payment_type_code: string; units: number;
    calculated_amount: number | null; reason: string;
  }>;
}

export interface NewEmployeeInput {
  employee_code: string | null;
  first_name: string;
  last_name: string;
  employment_start_date: IsoDate;
  center_id: Uuid;
  primary_payment_type_id: Uuid;
  default_shift_template_id?: Uuid | null;
  transport_required: boolean;
  transport_provider_id?: Uuid | null;
  transport_valid_from?: IsoDate | null;
  notes?: string | null;
  confirm_similar?: boolean;
}

// ---------------------------------------------------------------------------
// BA analitika (api.rpc_ba_*)
// ---------------------------------------------------------------------------

/** Which date concept a number is based on. Never mix the two in one KPI. */
export type BaBasis = 'ECONOMIC_WORK_DATE' | 'FINANCE_APPROVAL_DATE';

export interface BaKpi {
  current: number | null;
  previous_period: number | null;
  previous_year: number | null;
  absolute_change: number | null;
  /** NULL when the comparison denominator is zero — never a manufactured 0%. */
  percentage_change: number | null;
  absolute_change_year: number | null;
  percentage_change_year: number | null;
}

export type BaKpiKey =
  | 'total_calculated_amount'
  | 'employee_calculated_amount'
  | 'transport_calculated_amount'
  | 'adjustment_calculated_amount'
  | 'worked_employee_days'
  | 'worked_hours'
  | 'go_days'
  | 'bo_days'
  | 'overtime_hours'
  | 'distinct_employees'
  | 'cost_per_worked_employee_day';

export interface BaOverview {
  basis: BaBasis;
  basis_label: string;
  period: { from: IsoDate; to: IsoDate; days: number };
  comparison: {
    mode: 'PREVIOUS_EQUAL_PERIOD';
    previous_period: { from: IsoDate; to: IsoDate };
    previous_year: { from: IsoDate; to: IsoDate };
    previous_period_has_data: boolean;
    previous_year_has_data: boolean;
  };
  center_ids: Uuid[];
  kpi: Record<BaKpiKey, BaKpi>;
  economic_reconciliation: {
    regular_approved_amount: number;
    net_adjustment_amount: number;
    final_economic_amount: number;
  };
  definitions: Record<string, string>;
  approved_snapshots: number;
}

export interface BaDailyRow {
  work_date: IsoDate;
  center_code: string | null;
  distinct_employees: number;
  worked_employee_days: number;
  go_days: number;
  bo_days: number;
  overtime_hours: number;
  employee_calculated_amount: number;
  transport_calculated_amount: number;
  adjustment_calculated_amount: number;
  total_calculated_amount: number;
  cost_per_worked_employee_day: number | null;
}

export interface BaDaily {
  basis: BaBasis;
  period: { from: IsoDate; to: IsoDate };
  grouped_by_center: boolean;
  items: BaDailyRow[];
}

export interface BaCenterRow {
  center_code: string;
  worked_employee_days: number;
  distinct_employees: number;
  employee_calculated_amount: number;
  transport_calculated_amount: number;
  adjustment_calculated_amount: number;
  total_calculated_amount: number;
  overtime_hours: number;
  cost_per_worked_employee_day: number | null;
  share_of_total: number | null;
  previous_total_calculated_amount: number;
  absolute_change: number;
  percentage_change: number | null;
}

export interface BaCenters {
  basis: BaBasis;
  period: { from: IsoDate; to: IsoDate };
  previous_period: { from: IsoDate; to: IsoDate };
  total_calculated_amount: number;
  items: BaCenterRow[];
}

export interface BaPaymentRow {
  group_key: string;
  label: string;
  payment_behavior_key: string | null;
  units: number;
  amount: number;
  share_of_total: number | null;
  payment_type_codes: string[];
}

export interface BaPaymentBreakdown {
  basis: BaBasis;
  period: { from: IsoDate; to: IsoDate };
  total_calculated_amount: number;
  items: BaPaymentRow[];
}

export interface BaTransportRow {
  center_code: string | null;
  transport_provider_code: string | null;
  responsible_person_code: string | null;
  employee_days: number;
  units: number;
  amount: number;
  share_of_transport: number | null;
  /** More than one rate in a group: never present an average as "the rate". */
  distinct_rate_count: number;
  min_rate: number | null;
  max_rate: number | null;
  single_rate: number | null;
}

export interface BaTransport {
  basis: BaBasis;
  period: { from: IsoDate; to: IsoDate };
  transport_total_amount: number;
  items: BaTransportRow[];
  by_provider: Record<string, number>;
}

export interface BaEmployeeRow {
  employee_id: Uuid;
  employee_name_snapshot: string;
  employee_current_name: string | null;
  worked_days: number;
  go_days: number;
  bo_days: number;
  overtime_hours: number;
  employee_calculated_amount: number;
  transport_calculated_amount: number;
  adjustment_calculated_amount: number;
  total_calculated_amount: number;
  cost_per_worked_day: number | null;
}

export type BaEmployeeSort = 'TOTAL' | 'OVERTIME' | 'ADJUSTMENTS' | 'WORKED_DAYS' | 'NAME';

export interface BaEmployees {
  basis: BaBasis;
  period: { from: IsoDate; to: IsoDate };
  sort: BaEmployeeSort;
  limit: number;
  offset: number;
  total_rows: number;
  items: BaEmployeeRow[];
}

export interface BaFinanceTimeline {
  basis: 'FINANCE_APPROVAL_DATE';
  basis_label: string;
  note: string;
  period: { from: IsoDate; to: IsoDate };
  totals: {
    approval_count: number;
    regular_approved_amount: number;
    adjustment_approved_amount: number;
    total_approved_amount: number;
  };
  items: Array<{
    approval_date: IsoDate;
    approval_count: number;
    regular_approved_amount: number;
    adjustment_approved_amount: number;
    total_approved_amount: number;
  }>;
}

/** Shared, server-enforced BA filters. */
export interface BaFilters {
  from: IsoDate;
  to: IsoDate;
  center_ids: Uuid[];
}

// ---------------------------------------------------------------------------
// Kontrolni centar (api.rpc_*control*)
// ---------------------------------------------------------------------------

export type ControlSeverity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
export type ControlFindingStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';
/** NOT_CONFIGURED = supported, but no confirmed threshold — never guessed. */
export type ControlRuleStatus = 'ACTIVE' | 'DISABLED' | 'NOT_CONFIGURED';

export interface ControlRule {
  rule_code: string;
  name: string;
  description: string;
  entity_type: string;
  basis: string;
  requires_threshold: boolean;
  threshold_unit: string | null;
  default_severity: ControlSeverity;
  enabled: boolean | null;
  threshold_value: number | null;
  severity: ControlSeverity | null;
  valid_from: IsoDate | null;
  config_version: number | null;
  notes: string | null;
  status: ControlRuleStatus;
}

export interface ControlRunSummary {
  open: number;
  acknowledged: number;
  resolved: number;
  dismissed: number;
  critical: number;
  high: number;
  warning: number;
  info: number;
}

export interface ControlRun {
  id: Uuid;
  period_from: IsoDate;
  period_to: IsoDate;
  center_ids: Uuid[];
  filter_snapshot: Record<string, unknown>;
  started_by: string | null;
  started_at: string;
  completed_at: string | null;
  engine_version: string;
  config_hash: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  finding_count: number;
  info_count: number;
  warning_count: number;
  high_count: number;
  critical_count: number;
  rules_evaluated: number;
  rules_skipped: number;
}

export interface ControlRunResponse {
  run: ControlRun | null;
  summary: ControlRunSummary;
  /** Seen in THIS run vs. unresolved backlog from earlier runs. */
  current_run_summary: Partial<ControlRunSummary>;
  backlog_summary: Partial<ControlRunSummary>;
  rules: ControlRule[];
  can_review: boolean;
  can_run: boolean;
  can_manage: boolean;
  note?: string;
}

export interface ControlFindingRow {
  id: Uuid;
  rule_code: string;
  rule_name: string;
  severity: ControlSeverity;
  status: ControlFindingStatus;
  entity_type: string;
  employee_id: Uuid | null;
  employee_name: string | null;
  center_code: string | null;
  provider_code: string | null;
  related_date: IsoDate | null;
  period_from: IsoDate | null;
  period_to: IsoDate | null;
  iso_week: string | null;
  current_value: number | null;
  comparison_value: number | null;
  threshold_value: number | null;
  variance_pct: number | null;
  /** COMPARABLE | NEW_COST_BASE | NO_CURRENT_COST | NOT_APPLICABLE */
  classification: string | null;
  message: string;
  seen_count: number;
  last_run_id?: Uuid;
  /** false = backlog: unresolved, but not seen in the selected/latest run. */
  in_selected_run?: boolean;
  created_at: string;
  last_seen_at: string;
}

export interface ControlFindings {
  limit: number;
  offset: number;
  run_id: Uuid | null;
  latest_run_id: Uuid | null;
  total_rows: number;
  items: ControlFindingRow[];
}

export interface ControlFindingDetail {
  finding: ControlFindingRow & {
    context: Record<string, unknown>;
    status_comment: string | null;
    acknowledged_by: string | null;
    acknowledged_at: string | null;
    resolved_by: string | null;
    resolved_at: string | null;
    dismissed_by: string | null;
    dismissed_at: string | null;
  };
  rule: Pick<ControlRule, 'rule_code' | 'name' | 'description' | 'entity_type'
    | 'basis' | 'threshold_unit'>;
  /** The configuration version that WAS in force, not the current one. */
  config_used: {
    id: Uuid; version: number; enabled: boolean; threshold_value: number | null;
    severity: ControlSeverity; valid_from: IsoDate; valid_to: IsoDate | null;
    notes: string | null;
  } | null;
  run: Pick<ControlRun, 'id' | 'period_from' | 'period_to' | 'started_at'
    | 'engine_version' | 'config_hash'> | null;
  /** Allowed next steps come from the database state machine, not the UI. */
  allowed_transitions: Array<{
    to_status: ControlFindingStatus; requires_comment: boolean; description: string;
  }>;
  /** Requires `controls.review`; `controls.view` alone is read-only. */
  can_decide: boolean;
}

// ---------------------------------------------------------------------------
// Spremnost sistema (api.rpc_admin_readiness)
// ---------------------------------------------------------------------------

export interface VerificationStatus {
  /** False = "Nije potvrđeno". The system never assumes external work happened. */
  confirmed: boolean;
  verified_at: string | null;
  verified_by: string | null;
  environment: string | null;
  reference: string | null;
  note: string | null;
  label: string;
}

export type VerificationKind =
  | 'BACKUP_RESTORE_TESTED'
  | 'HTTP_SMOKE_TEST'
  | 'BACKUP_LOCATION_CONFIRMED'
  | 'LEGAL_PRIVACY_REVIEW';

export interface AdminReadiness {
  generated_at: string;
  note: string;
  configuration: {
    active_centers: number;
    centers_without_expected_pattern: string[];
    active_payment_types: number;
    active_attendance_statuses: number;
    active_shift_templates: number;
    active_employees: number;
  };
  compensation: {
    rules_total: number;
    primary_types_without_rule: string[];
    component_types_without_rule: string[];
    rules_with_unsupported_shape: number;
  };
  transport: {
    active_providers: number;
    active_responsible_persons: number;
    active_rules: number;
    providers_without_rule: string[];
    employees_with_transport_but_no_rule: number;
  };
  data_quality: {
    active_employees_without_assignment: number;
    employees_without_primary_payment_type: number;
  };
  controls: {
    rules_total: number;
    active: number;
    not_configured: string[];
    last_run_at: string | null;
    open_findings: number;
  };
  verifications: Record<VerificationKind, VerificationStatus>;
  operations: {
    submissions_draft: number;
    submissions_waiting_finance: number;
    approved_snapshots: number;
    adjustments_waiting: number;
  };
}
