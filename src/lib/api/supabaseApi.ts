import type { OvertimeComponentInput, OvertimeComponentResult } from './types';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { effectivePermissions, roleCodes } from '../../features/auth/permissions';
import { WdrApiError, type WdrApi } from './WdrApi';
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
  AssistanceSegmentResult,
  BulkEntryInput,
  BulkUpsertResult,
  FinanceApproveResult,
  FinanceHistory,
  FinanceQueue,
  FinanceQueueStatus,
  FinanceSubmissionDetail,
  GridPayload,
  NotificationItem,
  SessionProfile,
  SubmissionListItem,
  CreatePeriodSubmissionResult,
  SubmissionPreview,
  SubmitPeriodResult,
  IsoDate,
  Uuid,
} from './types';

/**
 * Supabase / PostgREST adapter.
 *
 * Two schemas are used, and the split is deliberate:
 *   `api`    — the four approved RPC endpoints (every write goes here)
 *   `public` — reference and status tables, read directly under RLS
 * The private `app` schema is never touched from the browser; it is not even
 * exposed through the Data API (see docs/API-SURFACE.md).
 */
export class SupabaseWdrApi implements WdrApi {
  private readonly db: SupabaseClient;
  private readonly rest: SupabaseClient;

  constructor(url: string, anonKey: string, apiSchema = 'api') {
    this.rest = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    // Same auth session, different default schema for RPC calls.
    this.db = this.rest.schema(apiSchema) as unknown as SupabaseClient;
  }

  // --- session -------------------------------------------------------------

  async signIn(email: string, password: string): Promise<void> {
    const { data, error } = await this.rest.auth.signInWithPassword({ email, password });
    if (error) throw new WdrApiError(error.message, error.code ?? null, error);
    if (!data.session) {
      throw new WdrApiError(
        'Supabase prijava je prošla, ali nije vraćena aktivna sesija.',
        'AUTH_SESSION_MISSING',
      );
    }

    const { data: check } = await this.rest.auth.getSession();
    if (!check.session) {
      throw new WdrApiError(
        'Supabase je vratio prijavu, ali browser nije sačuvao sesiju.',
        'AUTH_SESSION_NOT_STORED',
      );
    }
  }

  async signOut(): Promise<void> {
    await this.rest.auth.signOut();
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.rest.auth.updateUser({ password });
    if (error) throw new WdrApiError(error.message, error.code ?? null, error);
  }

  onAuthChange(cb: () => void): () => void {
    const { data } = this.rest.auth.onAuthStateChange(() => {
      setTimeout(cb, 0);
    });
    return () => data.subscription.unsubscribe();
  }

  async getSession(): Promise<SessionProfile | null> {
    const { data: sess, error: sessionError } = await this.rest.auth.getSession();

    if (sessionError) {
      throw new WdrApiError(
        sessionError.message,
        sessionError.code ?? null,
        sessionError,
      );
    }

    if (!sess.session) return null;

    const profileRes = await this.rest
      .from('profiles')
      .select('id, full_name, email')
      .eq('auth_user_id', sess.session.user.id)
      .maybeSingle();

    if (profileRes.error) {
      throw new WdrApiError(
        `Čitanje pristupa (profiles) nije uspelo: ${profileRes.error.message}`,
        profileRes.error.code ?? null,
        profileRes.error,
      );
    }

    if (!profileRes.data) {
      throw new WdrApiError(
        'Prijavljeni korisnik nema povezan profil. Bootstrap nije završen.',
        'PROFILE_NOT_LINKED',
      );
    }

    const profileId = profileRes.data.id;

    const [rolesRes, permsRes, overridesRes, centersRes] =
      await Promise.all([
        this.rest
          .from('user_roles')
          .select('role_id, roles(code)')
          .eq('profile_id', profileId),

        this.rest
          .from('role_permissions')
          .select('permissions(code), role_id'),

        this.rest
          .from('user_permission_overrides')
          .select('mode, permissions(code)')
          .eq('profile_id', profileId),

        this.rest
          .from('user_center_access')
          .select('center_id, can_write, centers(code, name)')
          .eq('profile_id', profileId),
      ]);

    for (const [what, res] of [
      ['user_roles', rolesRes],
      ['role_permissions', permsRes],
      ['user_permission_overrides', overridesRes],
      ['user_center_access', centersRes],
    ] as const) {
      if (res.error) {
        throw new WdrApiError(
          `Čitanje pristupa (${what}) nije uspelo: ${res.error.message}`,
          res.error.code ?? null,
          res.error,
        );
      }
    }

    const roleRows = ((rolesRes.data ?? []) as unknown as Array<{
      role_id?: string | null;
      roles?: { code: string } | { code: string }[] | null;
    }>).map((r) => ({
      role_id: r.role_id ?? null,
      code: firstOf(r.roles)?.code ?? null,
    }));

    const rolePermissions = ((permsRes.data ?? []) as unknown as Array<{
      role_id: string;
      permissions?: { code: string } | { code: string }[] | null;
    }>).map((rp) => ({
      role_id: rp.role_id,
      code: firstOf(rp.permissions)?.code ?? null,
    }));

    const overrides = ((overridesRes.data ?? []) as unknown as Array<{
      mode: string;
      permissions?: { code: string } | { code: string }[] | null;
    }>)
      .map((o) => ({
        permission_code: firstOf(o.permissions)?.code ?? '',
        mode: o.mode,
      }))
      .filter((o) => o.permission_code !== '');

    const centers = ((centersRes.data ?? []) as unknown as Array<{
      center_id: string;
      can_write: boolean;
      centers?:
        | { code: string; name: string }
        | { code: string; name: string }[]
        | null;
    }>).map((c) => ({
      center_id: c.center_id,
      center_code: firstOf(c.centers)?.code ?? '?',
      center_name: firstOf(c.centers)?.name ?? '?',
      can_write: c.can_write,
    }));

    return {
      profile_id: profileRes.data.id,
      full_name: profileRes.data.full_name,
      email: profileRes.data.email,
      roles: roleCodes(roleRows),
      permissions: effectivePermissions(
        roleRows,
        rolePermissions,
        overrides,
      ),
      centers,
    };
  }

  // --- submissions ---------------------------------------------------------

  async listSubmissions(centerIds?: Uuid[]): Promise<SubmissionListItem[]> {
    let q = this.rest
      .from('period_submissions')
      .select(
        'id, center_id, period_id, period_start, period_end, status, centers(code), submission_periods(label)',
      )
      .order('period_start', { ascending: false });

    if (centerIds && centerIds.length > 0) q = q.in('center_id', centerIds);

    const { data, error } = await q;
    if (error) throw new WdrApiError(error.message, error.code ?? null);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const returnedIds = rows
      .filter((r) => r.status === 'RETURNED')
      .map((r) => r.id as string);

    const returnReasons = new Map<string, string>();

    if (returnedIds.length > 0) {
      const { data: comments, error: commentsError } = await this.rest
        .from('comments')
        .select('entity_id, message, created_at')
        .eq('entity_type', 'PERIOD_SUBMISSION')
        .in('entity_id', returnedIds)
        .order('created_at', { ascending: false });

      if (commentsError) {
        throw new WdrApiError(commentsError.message, commentsError.code ?? null);
      }

      for (const comment of (comments ?? []) as Array<Record<string, unknown>>) {
        const entityId = comment.entity_id as string;
        if (!returnReasons.has(entityId)) {
          returnReasons.set(entityId, comment.message as string);
        }
      }
    }

    return rows.map((r) => ({
      id: r.id as string,
      center_id: r.center_id as string,
      center_code: firstOf(r.centers as { code?: string } | { code?: string }[] | null)?.code ?? '?',
      period_id: r.period_id as string,
      period_label:
        firstOf(r.submission_periods as { label?: string } | { label?: string }[] | null)?.label ??
        `${r.period_start} – ${r.period_end}`,
      period_start: r.period_start as string,
      period_end: r.period_end as string,
      status: r.status as SubmissionListItem['status'],
      return_reason: returnReasons.get(r.id as string) ?? null,
    }));
  }

  /**
   * Zavisi od PREDLOŽENE migracije 0053. Dok RPC ne postoji u bazi, PostgREST
   * vraća PGRST202 / "function ... does not exist"; to se prevodi u jasan kod
   * umesto u sirovu Postgres poruku.
   */
  async createPeriodSubmission(
    centerId: Uuid,
    periodStart: IsoDate,
    periodEnd: IsoDate,
  ): Promise<CreatePeriodSubmissionResult> {
    try {
      return await this.rpc<CreatePeriodSubmissionResult>('rpc_create_period_submission', {
        p_center_id: centerId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });
    } catch (err) {
      if (err instanceof WdrApiError) {
        const missing =
          err.code === 'PGRST202' ||
          /does not exist|could not find the function|schema cache/i.test(err.message);
        if (missing) {
          throw new WdrApiError(
            'Otvaranje perioda još nije aktivirano na serveru. Potrebno je primeniti predloženu migraciju za rpc_create_period_submission.',
            'PERIOD_CREATE_RPC_MISSING',
            err,
          );
        }
      }
      throw err;
    }
  }

  // --- daily entry ---------------------------------------------------------

  async getGrid(submissionId: Uuid): Promise<GridPayload> {
    return this.rpc<GridPayload>('rpc_get_grid', { p_submission_id: submissionId });
  }

  async bulkUpsert(
    submissionId: Uuid,
    entries: BulkEntryInput[],
    atomic: boolean,
  ): Promise<BulkUpsertResult> {
    return this.rpc<BulkUpsertResult>('rpc_bulk_upsert_work_entries', {
      p_submission_id: submissionId,
      p_entries: entries,
      p_atomic: atomic,
    });
  }

  async addAssistanceSegment(
    input: AssistanceSegmentInput,
  ): Promise<AssistanceSegmentResult> {
    return this.rpc<AssistanceSegmentResult>(
      'rpc_add_assistance_segment',
      input as unknown as Record<string, unknown>,
    );
  }

  async setOvertimeComponent(
    input: OvertimeComponentInput,
  ): Promise<OvertimeComponentResult> {
    return this.rpc<OvertimeComponentResult>(
      'rpc_set_overtime_component',
      input as unknown as Record<string, unknown>,
    );
  }

  async getSubmissionPreview(submissionId: Uuid): Promise<SubmissionPreview> {
    return this.rpc<SubmissionPreview>('rpc_get_submission_preview', {
      p_submission_id: submissionId,
    });
  }

  async acknowledgeWarnings(
    submissionId: Uuid,
    fingerprints: string[],
    note?: string | null,
  ): Promise<number> {
    return this.rpc<number>('rpc_acknowledge_warnings', {
      p_submission_id: submissionId,
      p_fingerprints: fingerprints,
      p_note: note ?? null,
    });
  }

  async submitPeriod(
    submissionId: Uuid,
    reviewConfirmed: boolean,
    incompleteReason?: string | null,
  ): Promise<SubmitPeriodResult> {
    return this.rpc<SubmitPeriodResult>('rpc_submit_period', {
      p_submission_id: submissionId,
      p_review_confirmed: reviewConfirmed,
      p_incomplete_reason: incompleteReason ?? null,
    });
  }

  async setExpectedDate(
    submissionId: Uuid,
    date: string,
    isExpected: boolean,
    reason: string,
  ): Promise<void> {
    await this.rpc<null>('rpc_set_expected_date', {
      p_submission_id: submissionId,
      p_date: date,
      p_is_expected: isExpected,
      p_reason: reason,
    });
  }

  // --- finance -------------------------------------------------------------

  async getFinanceQueue(
    statuses: FinanceQueueStatus[] = ['SUBMITTED'],
    centerIds?: Uuid[],
    dateFrom?: string | null,
    dateTo?: string | null,
  ): Promise<FinanceQueue> {
    return this.rpc<FinanceQueue>('rpc_get_finance_queue', {
      p_statuses: statuses,
      p_center_ids: centerIds && centerIds.length > 0 ? centerIds : null,
      p_date_from: dateFrom ?? null,
      p_date_to: dateTo ?? null,
    });
  }

  async getFinanceSubmission(submissionId: Uuid): Promise<FinanceSubmissionDetail> {
    return this.rpc<FinanceSubmissionDetail>('rpc_get_finance_submission', {
      p_submission_id: submissionId,
    });
  }

  async financeApprove(
    submissionId: Uuid,
    comment?: string | null,
  ): Promise<FinanceApproveResult> {
    return this.rpc<FinanceApproveResult>('rpc_finance_approve', {
      p_submission_id: submissionId,
      p_comment: comment ?? null,
    });
  }

  // --------------------------------------------------------- Stopovi kurira --
  // Adapter namerno NEMA ni jedan monetarni parametar: cena i iznos se izvode na
  // serveru iz efektivno datiranog pravila i ne mogu stići iz pretraživača.

  async baCourierStops(
    from?: IsoDate | null, to?: IsoDate | null, centerIds?: Uuid[] | null,
  ): Promise<unknown> {
    return this.rpc<unknown>('rpc_ba_courier_stops', {
      p_from: from ?? null, p_to: to ?? null, p_center_ids: centerIds ?? null,
    });
  }

  // ---------------------------------------------- Korekcije količine stopova --
  // Nijedan metod ne prima cenu ni iznos: iznos je delta × ZAMRZNUTA originalna
  // cena i računa se na serveru.
  async courierStopCorrectionSet(
    id: Uuid | null, snapshotLineId: number | null, delta: number, reason: string,
  ): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_correction_set', {
      p_id: id, p_snapshot_line_id: snapshotLineId,
      p_delta: delta, p_reason: reason,
    });
  }

  async courierStopCorrectionSubmit(id: Uuid): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_correction_submit', { p_id: id });
  }

  async courierStopCorrectionFinanceReturn(id: Uuid, comment: string): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_correction_finance_return', {
      p_id: id, p_comment: comment,
    });
  }

  async courierStopCorrectionFinanceApprove(id: Uuid): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_correction_finance_approve', { p_id: id });
  }

  async courierStopCorrectionQueue(): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_correction_queue', {});
  }

  async courierStopCorrectionDetail(id: Uuid): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_correction_detail', { p_id: id });
  }

  async courierStopContext(): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_context', {});
  }

  async courierStopOpenSubmission(periodId: Uuid, centerId: Uuid): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_open_submission', {
      p_period_id: periodId,
      p_center_id: centerId,
    });
  }

  async courierStopSetEntry(
    submissionId: Uuid,
    employeeId: Uuid,
    workDate: IsoDate,
    stopCount: number,
  ): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_set_entry', {
      p_submission_id: submissionId,
      p_employee_id: employeeId,
      p_work_date: workDate,
      p_stop_count: stopCount,
    });
  }

  async courierStopSubmit(submissionId: Uuid): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_submit', {
      p_submission_id: submissionId,
    });
  }

  async courierStopFinanceReturn(submissionId: Uuid, comment: string): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_finance_return', {
      p_submission_id: submissionId,
      p_comment: comment,
    });
  }

  async courierStopFinanceApprove(
    submissionId: Uuid,
    comment?: string | null,
  ): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_finance_approve', {
      p_submission_id: submissionId,
      p_comment: comment ?? null,
    });
  }

  async courierStopFinanceQueue(): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_finance_queue', {});
  }

  async courierStopFinanceDetail(submissionId: Uuid): Promise<unknown> {
    return this.rpc<unknown>('rpc_courier_stop_finance_detail', {
      p_submission_id: submissionId,
    });
  }

  async adminStopRates(): Promise<unknown> {
    return this.rpc<unknown>('rpc_admin_stop_rates', {});
  }

  async adminCreateStopRate(
    centerId: Uuid,
    amount: number,
    validFrom: IsoDate,
    validTo?: IsoDate | null,
    notes?: string | null,
  ): Promise<unknown> {
    return this.rpc<unknown>('rpc_admin_create_stop_rate', {
      p_center_id: centerId,
      p_amount: amount,
      p_valid_from: validFrom,
      p_valid_to: validTo ?? null,
      p_notes: notes ?? null,
    });
  }

  async adminSupersedeStopRate(
    rateId: Uuid,
    newAmount: number,
    validFrom: IsoDate,
    notes?: string | null,
  ): Promise<unknown> {
    return this.rpc<unknown>('rpc_admin_supersede_stop_rate', {
      p_rate_id: rateId,
      p_new_amount: newAmount,
      p_valid_from: validFrom,
      p_notes: notes ?? null,
    });
  }

  async financeReturn(submissionId: Uuid, comment: string): Promise<void> {
    await this.rpc<null>('rpc_finance_return', {
      p_submission_id: submissionId,
      p_comment: comment,
    });
  }

  async getFinanceHistory(
    centerIds?: Uuid[],
    from?: string | null,
    to?: string | null,
    types?: Array<'PERIOD' | 'ADJUSTMENT' | 'COURIER_STOPS' | 'COURIER_STOP_ADJUSTMENT'> | null,
  ): Promise<FinanceHistory> {
    return this.rpc<FinanceHistory>('rpc_get_finance_history', {
      p_center_ids: centerIds && centerIds.length > 0 ? centerIds : null,
      p_from: from ?? null,
      p_to: to ?? null,
      p_limit: 200,
      p_types: types && types.length > 0 ? types : null,
    });
  }

  // --- dodatni zahtevi -----------------------------------------------------

  async previewAdjustment(
    employeeId: Uuid,
    workDate: string,
    centerId: Uuid,
    paymentTypeId: Uuid,
    units: number,
    direction: AdjustmentDirection,
    costCenterId?: Uuid | null,
    workSegmentId?: number | null,
  ): Promise<AdjustmentPreview> {
    return this.rpc<AdjustmentPreview>('rpc_preview_adjustment', {
      p_employee_id: employeeId,
      p_work_date: workDate,
      p_center_id: centerId,
      p_payment_type_id: paymentTypeId,
      p_units: units,
      p_direction: direction,
      p_cost_center_id: costCenterId ?? null,
      p_work_segment_id: workSegmentId ?? null,
    });
  }

  async upsertAdjustment(input: AdjustmentInput): Promise<Adjustment> {
    return this.rpc<Adjustment>('rpc_upsert_adjustment', {
      p_id: input.id ?? null,
      p_employee_id: input.employee_id,
      p_related_work_date: input.related_work_date,
      p_center_id: input.center_id,
      p_payment_type_id: input.payment_type_id,
      p_units: input.units,
      p_direction: input.direction,
      p_reason: input.reason,
      p_original_submission_id: input.original_submission_id ?? null,
      p_cost_center_id: input.cost_center_id ?? null,
      p_work_segment_id: input.work_segment_id ?? null,
    });
  }

  async submitAdjustment(adjustmentId: Uuid): Promise<Adjustment> {
    return this.rpc<Adjustment>('rpc_submit_adjustment', {
      p_adjustment_id: adjustmentId,
    });
  }

  async getMyAdjustments(statuses?: AdjustmentStatus[] | null): Promise<Adjustment[]> {
    const res = await this.rpc<{ items: Adjustment[] }>('rpc_get_my_adjustments', {
      p_statuses: statuses && statuses.length > 0 ? statuses : null,
    });
    return res.items ?? [];
  }

  async getAdjustment(adjustmentId: Uuid): Promise<Adjustment> {
    return this.rpc<Adjustment>('rpc_get_adjustment', {
      p_adjustment_id: adjustmentId,
    });
  }

  async getAdjustmentQueue(
    statuses: AdjustmentStatus[] = ['SUBMITTED'],
    centerIds?: Uuid[],
  ): Promise<AdjustmentQueue> {
    return this.rpc<AdjustmentQueue>('rpc_get_adjustment_queue', {
      p_statuses: statuses,
      p_center_ids: centerIds && centerIds.length > 0 ? centerIds : null,
    });
  }

  async approveAdjustment(
    adjustmentId: Uuid,
    comment?: string | null,
    acknowledgeNoWorkEntry = false,
  ) {
    return this.rpc<{ status: string }>('rpc_approve_adjustment', {
      p_adjustment_id: adjustmentId,
      p_comment: comment ?? null,
      p_acknowledge_no_work_entry: acknowledgeNoWorkEntry,
    });
  }

  // --- administracija ------------------------------------------------------

  async getAdminConfig(): Promise<AdminConfig> {
    return this.rpc<AdminConfig>('rpc_admin_get_config', {});
  }

  async adminUpsertCenter(i: {
    id?: Uuid | null; code: string; name: string; active: boolean; sort_order: number;
  }): Promise<AdminCenter> {
    return this.rpc<AdminCenter>('rpc_admin_upsert_center', {
      p_id: i.id ?? null, p_code: i.code, p_name: i.name,
      p_active: i.active, p_sort_order: i.sort_order,
    });
  }

  async adminUpsertShiftTemplate(i: {
    id?: Uuid | null; code: string; label: string; start: string; end: string;
    center_id?: Uuid | null; active: boolean; sort_order: number;
  }): Promise<AdminShiftTemplate> {
    return this.rpc<AdminShiftTemplate>('rpc_admin_upsert_shift_template', {
      p_id: i.id ?? null, p_code: i.code, p_label: i.label,
      p_start: i.start, p_end: i.end, p_center_id: i.center_id ?? null,
      p_active: i.active, p_sort_order: i.sort_order,
    });
  }

  async adminUpsertAttendanceStatus(i: {
    code: string; name: string; behavior_key: string; active: boolean; sort_order: number;
    short_label?: string | null; shortcut_key?: string | null; color_token?: string | null;
  }): Promise<AdminAttendanceStatus> {
    // Semantika (nosi segmente, računa se kao prisustvo) se NE šalje: izvodi se iz
    // ponašanja u bazi (migracija 0026).
    return this.rpc<AdminAttendanceStatus>('rpc_admin_upsert_attendance_status', {
      p_code: i.code, p_name: i.name, p_behavior_key: i.behavior_key,
      p_active: i.active, p_sort_order: i.sort_order,
      p_short_label: i.short_label ?? null, p_shortcut_key: i.shortcut_key ?? null,
      p_color_token: i.color_token ?? null,
    });
  }

  async adminUpsertPaymentType(i: {
    id?: Uuid | null; code: string; name: string; behavior_key: string;
    kind: 'PRIMARY' | 'COMPONENT'; default_unit_type: string;
    active: boolean; sort_order: number; notes?: string | null;
  }): Promise<AdminPaymentType> {
    // `requires_units` i dozvola troška se izvode iz ponašanja obračuna.
    return this.rpc<AdminPaymentType>('rpc_admin_upsert_payment_type', {
      p_id: i.id ?? null, p_code: i.code, p_name: i.name,
      p_behavior_key: i.behavior_key, p_kind: i.kind,
      p_default_unit_type: i.default_unit_type,
      p_active: i.active, p_sort_order: i.sort_order, p_notes: i.notes ?? null,
    });
  }

  async adminCreateCompRule(i: {
    center_id: Uuid | null; payment_type_id: Uuid; attendance_status: string | null;
    amount: number; unit_type: string; valid_from: string; valid_to?: string | null;
    notes?: string | null;
  }) {
    return this.rpc<unknown>('rpc_admin_create_comp_rule', {
      p_center_id: i.center_id, p_payment_type_id: i.payment_type_id,
      p_attendance_status: i.attendance_status, p_amount: i.amount,
      p_unit_type: i.unit_type, p_valid_from: i.valid_from,
      p_valid_to: i.valid_to ?? null, p_notes: i.notes ?? null,
    });
  }

  async adminSupersedeCompRule(
    ruleId: Uuid, newAmount: number, validFrom: string, notes?: string | null,
  ): Promise<Uuid> {
    return this.rpc<Uuid>('rpc_supersede_compensation_rule', {
      p_rule_id: ruleId, p_new_amount: newAmount, p_valid_from: validFrom,
      p_notes: notes ?? null,
    });
  }

  async adminUpsertTransportProvider(i: {
    id?: Uuid | null; code: string; name: string;
    responsible_person_id?: Uuid | null; contact?: string | null; active: boolean;
  }): Promise<unknown> {
    return this.rpc<unknown>('rpc_admin_upsert_transport_provider', {
      p_id: i.id ?? null, p_code: i.code, p_name: i.name,
      p_responsible_person_id: i.responsible_person_id ?? null,
      p_contact: i.contact ?? null, p_active: i.active,
    });
  }

  async adminUpsertResponsiblePerson(i: {
    id?: Uuid | null; code: string; full_name: string; contact?: string | null;
    active: boolean;
  }): Promise<unknown> {
    return this.rpc<unknown>('rpc_admin_upsert_responsible_person', {
      p_id: i.id ?? null, p_code: i.code, p_full_name: i.full_name,
      p_contact: i.contact ?? null, p_active: i.active,
    });
  }

  async adminCreateTransportRule(i: {
    transport_provider_id: Uuid; center_id: Uuid | null; rule_type: string;
    valid_from: string; amount_per_unit?: number | null; liters_per_unit?: number | null;
    price_per_liter?: number | null; eligible_attendance_statuses?: string[] | null;
    responsible_person_id?: Uuid | null;
  }) {
    return this.rpc<unknown>('rpc_admin_create_transport_rule', {
      p_transport_provider_id: i.transport_provider_id, p_center_id: i.center_id,
      p_rule_type: i.rule_type, p_valid_from: i.valid_from,
      p_amount_per_unit: i.amount_per_unit ?? null,
      p_liters_per_unit: i.liters_per_unit ?? null,
      p_price_per_liter: i.price_per_liter ?? null,
      p_eligible_attendance_statuses: i.eligible_attendance_statuses ?? null,
      p_responsible_person_id: i.responsible_person_id ?? null,
    });
  }

  async adminSetExpectedPattern(centerId: Uuid | null, weekdays: number[], validFrom: string) {
    return this.rpc<unknown>('rpc_admin_set_expected_pattern', {
      p_center_id: centerId, p_weekdays: weekdays, p_valid_from: validFrom,
    });
  }

  async adminLinkUser(i: {
    auth_user_id: Uuid; full_name: string; email: string; active?: boolean;
    role_codes?: string[] | null;
    center_access?: Array<{ center_code: string; can_write: boolean }> | null;
    permission_overrides?: Array<{
      permission_code: string; mode: string; reason?: string | null;
    }> | null;
  }) {
    return this.rpc<unknown>('rpc_admin_link_user', {
      p_auth_user_id: i.auth_user_id,
      p_full_name: i.full_name,
      p_email: i.email,
      p_active: i.active ?? true,
      p_role_codes: i.role_codes ?? null,
      p_center_access: i.center_access ?? null,
      p_permission_overrides: i.permission_overrides ?? null,
    });
  }

  async adminSetUserAccess(i: {
    profile_id: Uuid; active: boolean; role_codes?: string[] | null;
    center_access?: Array<{ center_code: string; can_write: boolean }> | null;
    permission_overrides?: Array<{
      permission_code: string; mode: string; reason?: string | null;
    }> | null;
  }) {
    return this.rpc<unknown>('rpc_admin_set_user_access', {
      p_profile_id: i.profile_id, p_active: i.active,
      p_role_codes: i.role_codes ?? null,
      p_center_access: i.center_access ?? null,
      p_permission_overrides: i.permission_overrides ?? null,
    });
  }

  async returnAdjustment(adjustmentId: Uuid, comment: string): Promise<Adjustment> {
    return this.rpc<Adjustment>('rpc_return_adjustment', {
      p_adjustment_id: adjustmentId,
      p_comment: comment,
    });
  }

  async rejectAdjustment(adjustmentId: Uuid, comment: string): Promise<Adjustment> {
    return this.rpc<Adjustment>('rpc_reject_adjustment', {
      p_adjustment_id: adjustmentId,
      p_comment: comment,
    });
  }

  // --- zaposleni -----------------------------------------------------------

  async getEmployeeFormReference(): Promise<EmployeeFormReference> {
    return this.rpc<EmployeeFormReference>('rpc_employee_form_reference', {});
  }

  async getEmployees(
    search?: string | null, active?: boolean | null, centerId?: Uuid | null,
    limit = 50, offset = 0,
  ): Promise<EmployeeList> {
    return this.rpc<EmployeeList>('rpc_get_employees', {
      p_search: search ?? null, p_active: active ?? null,
      p_center_id: centerId ?? null, p_limit: limit, p_offset: offset,
    });
  }

  async getEmployeeProfile(
    employeeId: Uuid, from?: string | null, to?: string | null,
  ): Promise<EmployeeProfile> {
    return this.rpc<EmployeeProfile>('rpc_get_employee', {
      p_employee_id: employeeId, p_from: from ?? null, p_to: to ?? null,
    });
  }

  async checkEmployeeDuplicates(
    employeeCode: string | null, firstName: string, lastName: string,
    excludeId?: Uuid | null,
  ): Promise<EmployeeDuplicateCheck> {
    return this.rpc<EmployeeDuplicateCheck>('rpc_check_employee_duplicates', {
      p_employee_code: employeeCode, p_first_name: firstName,
      p_last_name: lastName, p_exclude_id: excludeId ?? null,
    });
  }

  async createEmployee(i: NewEmployeeInput): Promise<EmployeeProfile> {
    return this.rpc<EmployeeProfile>('rpc_create_employee', {
      p_employee_code: i.employee_code,
      p_first_name: i.first_name,
      p_last_name: i.last_name,
      p_employment_start_date: i.employment_start_date,
      p_center_id: i.center_id,
      p_primary_payment_type_id: i.primary_payment_type_id,
      p_default_shift_template_id: i.default_shift_template_id ?? null,
      p_transport_required: i.transport_required,
      p_transport_provider_id: i.transport_provider_id ?? null,
      p_transport_valid_from: i.transport_valid_from ?? null,
      p_notes: i.notes ?? null,
      p_confirm_similar: i.confirm_similar ?? false,
    });
  }

  async updateEmployee(i: {
    employee_id: Uuid; first_name: string; last_name: string;
    employee_code?: string | null; notes?: string | null; active?: boolean | null;
  }): Promise<EmployeeProfile> {
    return this.rpc<EmployeeProfile>('rpc_update_employee', {
      p_employee_id: i.employee_id, p_first_name: i.first_name,
      p_last_name: i.last_name, p_employee_code: i.employee_code ?? null,
      p_notes: i.notes ?? null, p_active: i.active ?? null,
    });
  }

  async setEmploymentDates(
    employeeId: Uuid, start: string, end?: string | null,
  ): Promise<EmployeeProfile> {
    return this.rpc<EmployeeProfile>('rpc_set_employment_dates', {
      p_employee_id: employeeId, p_start: start, p_end: end ?? null,
    });
  }

  async transferEmployee(i: {
    employee_id: Uuid; new_center_id: Uuid; from_date: string;
    primary_payment_type_id?: Uuid | null; default_shift_template_id?: Uuid | null;
    notes?: string | null;
  }): Promise<EmployeeProfile> {
    return this.rpc<EmployeeProfile>('rpc_transfer_employee', {
      p_employee_id: i.employee_id, p_new_center_id: i.new_center_id,
      p_from_date: i.from_date,
      p_primary_payment_type_id: i.primary_payment_type_id ?? null,
      p_default_shift_template_id: i.default_shift_template_id ?? null,
      p_notes: i.notes ?? null,
    });
  }

  async closeEmployeeAssignment(assignmentId: Uuid, validTo: string): Promise<EmployeeProfile> {
    return this.rpc<EmployeeProfile>('rpc_close_employee_assignment', {
      p_assignment_id: assignmentId, p_valid_to: validTo,
    });
  }

  async setEmployeeTransport(i: {
    employee_id: Uuid; transport_required: boolean; transport_provider_id?: Uuid | null;
    valid_from: string; notes?: string | null;
  }): Promise<EmployeeProfile> {
    return this.rpc<EmployeeProfile>('rpc_set_employee_transport', {
      p_employee_id: i.employee_id, p_transport_required: i.transport_required,
      p_transport_provider_id: i.transport_provider_id ?? null,
      p_valid_from: i.valid_from, p_notes: i.notes ?? null,
    });
  }

  async terminateEmployee(
    employeeId: Uuid, endDate: string, notes?: string | null,
  ): Promise<EmployeeProfile> {
    return this.rpc<EmployeeProfile>('rpc_terminate_employee', {
      p_employee_id: employeeId, p_end_date: endDate, p_notes: notes ?? null,
    });
  }

  // --- BA analitika --------------------------------------------------------

  private baArgs(from: string, to: string, centerIds?: Uuid[] | null) {
    return {
      p_from: from,
      p_to: to,
      p_center_ids: centerIds && centerIds.length > 0 ? centerIds : null,
    };
  }

  async baOverview(from: string, to: string, centerIds?: Uuid[] | null): Promise<BaOverview> {
    return this.rpc<BaOverview>('rpc_ba_overview', this.baArgs(from, to, centerIds));
  }

  async baDaily(
    from: string, to: string, centerIds?: Uuid[] | null, groupByCenter = false,
  ): Promise<BaDaily> {
    return this.rpc<BaDaily>('rpc_ba_daily', {
      ...this.baArgs(from, to, centerIds), p_group_by_center: groupByCenter,
    });
  }

  async baCenters(from: string, to: string, centerIds?: Uuid[] | null): Promise<BaCenters> {
    return this.rpc<BaCenters>('rpc_ba_centers', this.baArgs(from, to, centerIds));
  }

  async baPaymentBreakdown(
    from: string, to: string, centerIds?: Uuid[] | null,
  ): Promise<BaPaymentBreakdown> {
    return this.rpc<BaPaymentBreakdown>(
      'rpc_ba_payment_breakdown', this.baArgs(from, to, centerIds),
    );
  }

  async baTransport(
    from: string, to: string, centerIds?: Uuid[] | null,
    provider?: string | null, responsible?: string | null,
  ): Promise<BaTransport> {
    return this.rpc<BaTransport>('rpc_ba_transport', {
      ...this.baArgs(from, to, centerIds),
      p_provider: provider ?? null, p_responsible: responsible ?? null,
    });
  }

  async baEmployees(
    from: string, to: string, centerIds?: Uuid[] | null, search?: string | null,
    sort: BaEmployeeSort = 'TOTAL', limit = 50, offset = 0,
  ): Promise<BaEmployees> {
    return this.rpc<BaEmployees>('rpc_ba_employees', {
      ...this.baArgs(from, to, centerIds),
      p_search: search ?? null, p_sort: sort, p_limit: limit, p_offset: offset,
    });
  }

  async baEmployeeDetail(employeeId: Uuid, from: string, to: string): Promise<unknown> {
    return this.rpc<unknown>('rpc_ba_employee_detail', {
      p_employee_id: employeeId, p_from: from, p_to: to,
    });
  }

  async baFinanceTimeline(
    from: string, to: string, centerIds?: Uuid[] | null,
  ): Promise<BaFinanceTimeline> {
    return this.rpc<BaFinanceTimeline>(
      'rpc_ba_finance_timeline', this.baArgs(from, to, centerIds),
    );
  }

  // --- kontrolni centar ----------------------------------------------------

  async runControlScan(
    from: string, to: string, centerIds?: Uuid[] | null,
  ): Promise<ControlRunResponse> {
    return this.rpc<ControlRunResponse>('rpc_run_control_scan', {
      p_from: from, p_to: to,
      p_center_ids: centerIds && centerIds.length > 0 ? centerIds : null,
    });
  }

  async getControlRun(runId?: Uuid | null): Promise<ControlRunResponse> {
    return this.rpc<ControlRunResponse>('rpc_get_control_run', {
      p_run_id: runId ?? null,
    });
  }

  async getControlFindings(f: {
    run_id?: Uuid | null;
    status?: ControlFindingStatus[] | null; severity?: ControlSeverity[] | null;
    rule_codes?: string[] | null; center_ids?: Uuid[] | null;
    from?: string | null; to?: string | null; search?: string | null;
    limit?: number; offset?: number;
  } = {}): Promise<ControlFindings> {
    return this.rpc<ControlFindings>('rpc_get_control_findings', {
      p_status: f.status ?? ['OPEN'],
      p_severity: f.severity && f.severity.length > 0 ? f.severity : null,
      p_rule_codes: f.rule_codes && f.rule_codes.length > 0 ? f.rule_codes : null,
      p_center_ids: f.center_ids && f.center_ids.length > 0 ? f.center_ids : null,
      p_from: f.from ?? null, p_to: f.to ?? null,
      p_search: f.search ?? null,
      p_limit: f.limit ?? 100, p_offset: f.offset ?? 0,
      p_run_id: f.run_id ?? null,
    });
  }

  async getControlFinding(findingId: Uuid): Promise<ControlFindingDetail> {
    return this.rpc<ControlFindingDetail>('rpc_get_control_finding', {
      p_finding_id: findingId,
    });
  }

  async setControlFindingStatus(
    findingId: Uuid, status: ControlFindingStatus, comment?: string | null,
  ): Promise<ControlFindingDetail> {
    return this.rpc<ControlFindingDetail>('rpc_set_control_finding_status', {
      p_finding_id: findingId, p_status: status, p_comment: comment ?? null,
    });
  }

  async adminSetControlRule(i: {
    rule_code: string; enabled: boolean; threshold_value: number | null;
    severity: ControlSeverity; valid_from: string; notes?: string | null;
  }): Promise<unknown> {
    return this.rpc<unknown>('rpc_admin_set_control_rule', {
      p_rule_code: i.rule_code, p_enabled: i.enabled,
      p_threshold_value: i.threshold_value, p_severity: i.severity,
      p_valid_from: i.valid_from, p_notes: i.notes ?? null,
    });
  }

  // --- spremnost sistema ---------------------------------------------------

  async adminReadiness(): Promise<AdminReadiness> {
    return this.rpc<AdminReadiness>('rpc_admin_readiness', {});
  }

  async adminRecordVerification(i: {
    kind: VerificationKind; note: string; environment?: string | null;
    reference?: string | null;
  }): Promise<unknown> {
    return this.rpc<unknown>('rpc_admin_record_verification', {
      p_kind: i.kind, p_note: i.note,
      p_environment: i.environment ?? null, p_reference: i.reference ?? null,
    });
  }

  // --- notifications -------------------------------------------------------

  async listNotifications(): Promise<NotificationItem[]> {
    const { data, error } = await this.rest
      .from('notifications')
      .select('id, type, text, created_at, read_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new WdrApiError(error.message, error.code ?? null);
    return (data ?? []) as NotificationItem[];
  }

  async markNotificationsRead(ids?: number[]): Promise<number> {
    // rpc_mark_notifications_read is not part of the exposed api surface yet,
    // so the read flag is set directly — the column-level grant on
    // notifications.read_at plus RLS restrict it to the caller's own rows.
    let q = this.rest
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null);
    if (ids && ids.length > 0) q = q.in('id', ids);
    const { data, error } = await q.select('id');
    if (error) throw new WdrApiError(error.message, error.code ?? null);
    return (data ?? []).length;
  }

  // --- plumbing ------------------------------------------------------------

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) {
      throw new WdrApiError(
        error.message,
        extractCode(error.message) ?? extractCode(error.hint) ?? error.code ?? null,
        error,
      );
    }
    return data as T;
  }
}

/** PostgREST returns an embedded relation as an object or an array of one. */
function firstOf<T>(v: T | T[] | null | undefined): T | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The database raises named codes inside the message (SEGMENT_OVERLAP,
 * COST_CENTER_OVERRIDE_DENIED, ...). Pulling the token out lets the UI show a
 * Serbian message instead of the raw error, which contains UUIDs.
 */
export function extractCode(message: string | undefined): string | null {
  if (!message) return null;
  const m = message.match(/\b([A-Z][A-Z0-9_]{4,})\b/);
  return m ? m[1] : null;
}
