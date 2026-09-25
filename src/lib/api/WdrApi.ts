import type { OvertimeComponentInput, OvertimeComponentResult } from './types';
import type {
  AdminAttendanceStatus,
  AdminReadiness,
  VerificationKind,
  ControlFindingDetail,
  ControlFindingStatus,
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
  AdjustmentDirection,
  AdjustmentInput,
  AdjustmentPreview,
  AdjustmentQueue,
  AdjustmentStatus,
  AssistanceSegmentInput,
  CreatePeriodSubmissionResult,
  FinanceApproveResult,
  FinanceHistory,
  FinanceQueue,
  FinanceQueueStatus,
  FinanceSubmissionDetail,
  IsoDate,
  AssistanceSegmentResult,
  BulkEntryInput,
  BulkUpsertResult,
  GridPayload,
  NotificationItem,
  SessionProfile,
  SubmissionListItem,
  SubmissionPreview,
  SubmitPeriodResult,
  Uuid,
} from './types';

/**
 * The only backend boundary the UI knows about.
 *
 * Both the Supabase adapter and the development mock implement this exact
 * interface, so switching between them requires no component change.
 */
export interface WdrApi {
  // --- session -------------------------------------------------------------
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;

  updatePassword(password: string): Promise<void>;
  /** Resolves the current session, or null when nobody is signed in. */
  getSession(): Promise<SessionProfile | null>;
  onAuthChange(cb: () => void): () => void;

  // --- submissions ---------------------------------------------------------
  listSubmissions(centerIds?: Uuid[]): Promise<SubmissionListItem[]>;
  /**
   * Operater sam otvara obračunski raspon. Kontrolisan RPC, nikad slobodan
   * INSERT iz browsera. Server proverava permisiju, pravo nad centrom,
   * `from <= to` i preklapanje sa postojećom prijavom istog centra.
   *
   * Zahteva PREDLOŽENU migraciju `supabase/proposed/20260923090053_*`. Dok ona
   * nije primenjena, Supabase adapter vraća `PERIOD_CREATE_RPC_MISSING`.
   */
  createPeriodSubmission(
    centerId: Uuid,
    periodStart: IsoDate,
    periodEnd: IsoDate,
  ): Promise<CreatePeriodSubmissionResult>;

  // --- daily entry ---------------------------------------------------------
  getGrid(submissionId: Uuid): Promise<GridPayload>;
  bulkUpsert(
    submissionId: Uuid,
    entries: BulkEntryInput[],
    atomic: boolean,
  ): Promise<BulkUpsertResult>;
  addAssistanceSegment(input: AssistanceSegmentInput): Promise<AssistanceSegmentResult>;
  setOvertimeComponent(input: OvertimeComponentInput): Promise<OvertimeComponentResult>;

  // --- pre-submit review ---------------------------------------------------
  getSubmissionPreview(submissionId: Uuid): Promise<SubmissionPreview>;
  acknowledgeWarnings(
    submissionId: Uuid,
    fingerprints: string[],
    note?: string | null,
  ): Promise<number>;
  /**
   * The only supported submission path. `incompleteReason` is the controlled
   * exception and requires the period.submit_incomplete permission server-side.
   */
  submitPeriod(
    submissionId: Uuid,
    reviewConfirmed: boolean,
    incompleteReason?: string | null,
  ): Promise<SubmitPeriodResult>;
  /**
   * Mark one date as an exceptional working / non-working day. Requires the
   * `centers.manage` permission server-side, so the grid offers it only to
   * administrators.
   */
  setExpectedDate(
    submissionId: Uuid,
    date: IsoDate,
    isExpected: boolean,
    reason: string,
  ): Promise<void>;

  // --- finance -------------------------------------------------------------
  /** Finance queue. Requires finance.queue.view server-side. */
  getFinanceQueue(
    statuses?: FinanceQueueStatus[],
    centerIds?: Uuid[],
    dateFrom?: IsoDate | null,
    dateTo?: IsoDate | null,
  ): Promise<FinanceQueue>;
  getFinanceSubmission(submissionId: Uuid): Promise<FinanceSubmissionDetail>;
  /**
   * Confirms the calculated amount. There is deliberately NO amount parameter:
   * Q16 MODEL A means approved = payable = the calculated snapshot total, and
   * the database refuses anything else.
   */
  /** Stopovi kurira — bez ijednog monetarnog parametra (0038). */
  courierStopContext(): Promise<unknown>;
  /** Korekcije količine: nikada cena ni iznos kao ulaz. */
  courierStopCorrectionSet(
    id: Uuid | null, snapshotLineId: number | null, delta: number, reason: string,
  ): Promise<unknown>;
  courierStopCorrectionSubmit(id: Uuid): Promise<unknown>;
  courierStopCorrectionFinanceReturn(id: Uuid, comment: string): Promise<unknown>;
  courierStopCorrectionFinanceApprove(id: Uuid): Promise<unknown>;
  courierStopCorrectionQueue(): Promise<unknown>;
  courierStopCorrectionDetail(id: Uuid): Promise<unknown>;
  baCourierStops(
    from?: IsoDate | null, to?: IsoDate | null, centerIds?: Uuid[] | null,
  ): Promise<unknown>;
  courierStopOpenSubmission(periodId: Uuid, centerId: Uuid): Promise<unknown>;
  courierStopSetEntry(
    submissionId: Uuid, employeeId: Uuid, workDate: IsoDate, stopCount: number,
  ): Promise<unknown>;
  courierStopSubmit(submissionId: Uuid): Promise<unknown>;
  courierStopFinanceReturn(submissionId: Uuid, comment: string): Promise<unknown>;
  courierStopFinanceApprove(submissionId: Uuid, comment?: string | null): Promise<unknown>;
  courierStopFinanceQueue(): Promise<unknown>;
  courierStopFinanceDetail(submissionId: Uuid): Promise<unknown>;
  adminStopRates(): Promise<unknown>;
  adminCreateStopRate(
    centerId: Uuid, amount: number, validFrom: IsoDate,
    validTo?: IsoDate | null, notes?: string | null,
  ): Promise<unknown>;
  adminSupersedeStopRate(
    rateId: Uuid, newAmount: number, validFrom: IsoDate, notes?: string | null,
  ): Promise<unknown>;

  financeApprove(submissionId: Uuid, comment?: string | null): Promise<FinanceApproveResult>;
  /** The only sanctioned alternative to approval. Comment is mandatory. */
  financeReturn(submissionId: Uuid, comment: string): Promise<void>;
  getFinanceHistory(
    centerIds?: Uuid[],
    from?: IsoDate | null,
    to?: IsoDate | null,
    types?: Array<'PERIOD' | 'ADJUSTMENT' | 'COURIER_STOPS' | 'COURIER_STOP_ADJUSTMENT'> | null,
  ): Promise<FinanceHistory>;

  // --- dodatni zahtevi (Doplata / Umanjenje) -------------------------------
  /**
   * Calculated preview BEFORE saving. There is no amount parameter anywhere in
   * this group: the engine resolves the rule in force on the work date.
   */
  previewAdjustment(
    employeeId: Uuid,
    workDate: IsoDate,
    centerId: Uuid,
    paymentTypeId: Uuid,
    units: number,
    direction: AdjustmentDirection,
    costCenterId?: Uuid | null,
    workSegmentId?: number | null,
  ): Promise<AdjustmentPreview>;
  upsertAdjustment(input: AdjustmentInput): Promise<Adjustment>;
  submitAdjustment(adjustmentId: Uuid): Promise<Adjustment>;
  getMyAdjustments(statuses?: AdjustmentStatus[] | null): Promise<Adjustment[]>;
  getAdjustment(adjustmentId: Uuid): Promise<Adjustment>;
  getAdjustmentQueue(
    statuses?: AdjustmentStatus[],
    centerIds?: Uuid[],
  ): Promise<AdjustmentQueue>;
  /**
   * `acknowledgeNoWorkEntry` is the Q26 exception: Finance must explicitly
   * confirm a correction for a day that was never recorded.
   */
  approveAdjustment(
    adjustmentId: Uuid,
    comment?: string | null,
    acknowledgeNoWorkEntry?: boolean,
  ): Promise<Adjustment | { status: string }>;
  returnAdjustment(adjustmentId: Uuid, comment: string): Promise<Adjustment>;
  rejectAdjustment(adjustmentId: Uuid, comment: string): Promise<Adjustment>;

  // --- administracija ------------------------------------------------------
  getAdminConfig(): Promise<AdminConfig>;
  adminUpsertCenter(input: {
    id?: Uuid | null; code: string; name: string; active: boolean; sort_order: number;
  }): Promise<AdminCenter>;
  adminUpsertShiftTemplate(input: {
    id?: Uuid | null; code: string; label: string; start: string; end: string;
    center_id?: Uuid | null; active: boolean; sort_order: number;
  }): Promise<AdminShiftTemplate>;
  /**
   * `allows_segments` and `counts_as_present` are NOT parameters: they are derived
   * from the chosen behavior (migration 0026) and cannot be set independently.
   */
  adminUpsertAttendanceStatus(input: {
    code: string; name: string; behavior_key: string; active: boolean; sort_order: number;
    short_label?: string | null; shortcut_key?: string | null; color_token?: string | null;
  }): Promise<AdminAttendanceStatus>;
  /** `requires_units` and `allows_cost_center_override` are derived from the behavior. */
  adminUpsertPaymentType(input: {
    id?: Uuid | null; code: string; name: string; behavior_key: string;
    kind: 'PRIMARY' | 'COMPONENT'; default_unit_type: string;
    active: boolean; sort_order: number; notes?: string | null;
  }): Promise<AdminPaymentType>;
  adminCreateCompRule(input: {
    center_id: Uuid | null; payment_type_id: Uuid; attendance_status: string | null;
    amount: number; unit_type: string; valid_from: IsoDate; valid_to?: IsoDate | null;
    notes?: string | null;
  }): Promise<unknown>;
  adminSupersedeCompRule(
    ruleId: Uuid, newAmount: number, validFrom: IsoDate, notes?: string | null,
  ): Promise<Uuid>;
  adminUpsertTransportProvider(input: {
    id?: Uuid | null; code: string; name: string;
    responsible_person_id?: Uuid | null; contact?: string | null; active: boolean;
  }): Promise<unknown>;
  adminUpsertResponsiblePerson(input: {
    id?: Uuid | null; code: string; full_name: string; contact?: string | null;
    active: boolean;
  }): Promise<unknown>;
  adminCreateTransportRule(input: {
    transport_provider_id: Uuid; center_id: Uuid | null; rule_type: string;
    valid_from: IsoDate; amount_per_unit?: number | null; liters_per_unit?: number | null;
    price_per_liter?: number | null; eligible_attendance_statuses?: string[] | null;
    responsible_person_id?: Uuid | null;
  }): Promise<unknown>;
  adminSetExpectedPattern(
    centerId: Uuid | null, weekdays: number[], validFrom: IsoDate,
  ): Promise<unknown>;
  adminLinkUser(input: {
    auth_user_id: Uuid; full_name: string; email: string; active?: boolean;
    role_codes?: string[] | null;
    center_access?: Array<{ center_code: string; can_write: boolean }> | null;
    permission_overrides?: Array<{
      permission_code: string; mode: string; reason?: string | null;
    }> | null;
  }): Promise<unknown>;

  adminSetUserAccess(input: {
    profile_id: Uuid; active: boolean; role_codes?: string[] | null;
    center_access?: Array<{ center_code: string; can_write: boolean }> | null;
    /** Semantika ZAMENE: null = ne diraj, niz = PUN nameravani skup. */
    permission_overrides?: Array<{
      permission_code: string; mode: string; reason?: string | null;
    }> | null;
  }): Promise<unknown>;

  // --- zaposleni (Employee Master) -----------------------------------------
  /** Read-only reference data scoped to centers the caller may operate on. */
  getEmployeeFormReference(): Promise<EmployeeFormReference>;
  getEmployees(
    search?: string | null, active?: boolean | null, centerId?: Uuid | null,
    limit?: number, offset?: number,
  ): Promise<EmployeeList>;
  getEmployeeProfile(
    employeeId: Uuid, from?: IsoDate | null, to?: IsoDate | null,
  ): Promise<EmployeeProfile>;
  /** Same code = hard error; same/similar name = warning to confirm explicitly. */
  checkEmployeeDuplicates(
    employeeCode: string | null, firstName: string, lastName: string, excludeId?: Uuid | null,
  ): Promise<EmployeeDuplicateCheck>;
  createEmployee(input: NewEmployeeInput): Promise<EmployeeProfile>;
  updateEmployee(input: {
    employee_id: Uuid; first_name: string; last_name: string;
    employee_code?: string | null; notes?: string | null; active?: boolean | null;
  }): Promise<EmployeeProfile>;
  setEmploymentDates(
    employeeId: Uuid, start: IsoDate, end?: IsoDate | null,
  ): Promise<EmployeeProfile>;
  /** Closes the current assignment and opens the new one, atomically. */
  transferEmployee(input: {
    employee_id: Uuid; new_center_id: Uuid; from_date: IsoDate;
    primary_payment_type_id?: Uuid | null; default_shift_template_id?: Uuid | null;
    notes?: string | null;
  }): Promise<EmployeeProfile>;
  closeEmployeeAssignment(assignmentId: Uuid, validTo: IsoDate): Promise<EmployeeProfile>;
  setEmployeeTransport(input: {
    employee_id: Uuid; transport_required: boolean; transport_provider_id?: Uuid | null;
    valid_from: IsoDate; notes?: string | null;
  }): Promise<EmployeeProfile>;
  terminateEmployee(
    employeeId: Uuid, endDate: IsoDate, notes?: string | null,
  ): Promise<EmployeeProfile>;

  // --- BA analitika --------------------------------------------------------
  /** Economic cost by work_date. Requires analytics.ba.view server-side. */
  baOverview(from: IsoDate, to: IsoDate, centerIds?: Uuid[] | null): Promise<BaOverview>;
  baDaily(
    from: IsoDate, to: IsoDate, centerIds?: Uuid[] | null, groupByCenter?: boolean,
  ): Promise<BaDaily>;
  baCenters(from: IsoDate, to: IsoDate, centerIds?: Uuid[] | null): Promise<BaCenters>;
  baPaymentBreakdown(
    from: IsoDate, to: IsoDate, centerIds?: Uuid[] | null,
  ): Promise<BaPaymentBreakdown>;
  baTransport(
    from: IsoDate, to: IsoDate, centerIds?: Uuid[] | null,
    provider?: string | null, responsible?: string | null,
  ): Promise<BaTransport>;
  baEmployees(
    from: IsoDate, to: IsoDate, centerIds?: Uuid[] | null, search?: string | null,
    sort?: BaEmployeeSort, limit?: number, offset?: number,
  ): Promise<BaEmployees>;
  baEmployeeDetail(employeeId: Uuid, from: IsoDate, to: IsoDate): Promise<unknown>;
  /** Approval-date view. Deliberately a separate concept from economic cost. */
  baFinanceTimeline(
    from: IsoDate, to: IsoDate, centerIds?: Uuid[] | null,
  ): Promise<BaFinanceTimeline>;

  // --- kontrolni centar ----------------------------------------------------
  /** Explicit, user-triggered scan. Never runs automatically on render. */
  runControlScan(
    from: IsoDate, to: IsoDate, centerIds?: Uuid[] | null,
  ): Promise<ControlRunResponse>;
  getControlRun(runId?: Uuid | null): Promise<ControlRunResponse>;
  getControlFindings(filters?: {
    /** Limit to findings SEEN in this run; omit for backlog too. */
    run_id?: Uuid | null;
    status?: ControlFindingStatus[] | null;
    severity?: ControlSeverity[] | null;
    rule_codes?: string[] | null;
    center_ids?: Uuid[] | null;
    from?: IsoDate | null;
    to?: IsoDate | null;
    search?: string | null;
    limit?: number;
    offset?: number;
  }): Promise<ControlFindings>;
  getControlFinding(findingId: Uuid): Promise<ControlFindingDetail>;
  setControlFindingStatus(
    findingId: Uuid, status: ControlFindingStatus, comment?: string | null,
  ): Promise<ControlFindingDetail>;
  adminSetControlRule(input: {
    rule_code: string; enabled: boolean; threshold_value: number | null;
    severity: ControlSeverity; valid_from: IsoDate; notes?: string | null;
  }): Promise<unknown>;

  // --- spremnost sistema ---------------------------------------------------
  /** Read-only configuration checks. Changes nothing; assumes nothing. */
  adminReadiness(): Promise<AdminReadiness>;
  /** Records that a manual/external check actually happened. */
  adminRecordVerification(input: {
    kind: VerificationKind; note: string; environment?: string | null;
    reference?: string | null;
  }): Promise<unknown>;

  // --- notifications -------------------------------------------------------
  listNotifications(): Promise<NotificationItem[]>;
  markNotificationsRead(ids?: number[]): Promise<number>;
}

/** Error shape the UI can map to a Serbian message without parsing prose. */
export class WdrApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'WdrApiError';
  }
}
