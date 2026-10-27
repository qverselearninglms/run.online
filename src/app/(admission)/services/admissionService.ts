/* ------------------------------------------------------------------ */
/*  Admission Module — API Service                                     */
/*                                                                     */
/*  fetchFees/fetchStudentAdmission/initiate*Payment/verify*Payment/    */
/*  declineAdmission all call the real backend — see sandbox/admission/ */
/*  student_admission_workflow.md for the spec these were built from.  */
/*  devPreview*() are dev-only local previews: they patch the REAL     */
/*  applicant record (gated on NODE_ENV === "development" at the call  */
/*  sites), never call the backend and never change server state.     */
/* ------------------------------------------------------------------ */

import apiClient, {
  createApiMutationOptions,
  createApiQueryOptions,
  type RequestOptions,
} from "@/lib/clients/apiClient"
import type {
  AdmissionStudent,
  EntryMode,
  FeeSchedule,
  PaymentInitiationResponse,
  PaymentOtpPayload,
  PaymentVerificationResponse,
  PaymentStatus,
  StudyMode,
} from "../types/admission"
import type {
  AdmissionStagesPayload,
  ResolvedStage,
} from "../types/admission-stages"
import type { VirtualAccount } from "@/modules/fee-management/types"
const AUTH = { access_token: true } as const

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */
// POST /fees/payments/verify/:reference (fee_README.md "Payments" table) returns
// a payment/invoice-shaped body, not the frontend's PaymentVerificationResponse —
// adapt it here. Shared by all three verify*Payment() methods below since the
// wrapped payment/invoice shape is identical regardless of fee type.
// Payment status is the fee module's PENDING | COMPLETED | FAILED | REFUNDED
// (bruno/fee/Payments - List.bru); the invoice can also be CANCELLED/WAIVED.
interface RealVerifyPaymentResponse {
  paymentId: number
  status: "COMPLETED" | "FAILED" | "PENDING" | "REFUNDED"
  invoice: {
    id: number
    amountPaid: string
    status:
      | "PENDING"
      | "PARTIALLY_PAID"
      | "PAID"
      | "OVERDUE"
      | "CANCELLED"
      | "WAIVED"
  }
}

const VERIFY_STATUS_MAP: Partial<
  Record<RealVerifyPaymentResponse["status"], PaymentStatus>
> = {
  COMPLETED: "paid",
  FAILED: "failed",
  PENDING: "pending",
  REFUNDED: "failed",
}

const VERIFY_MESSAGE_MAP: Partial<
  Record<RealVerifyPaymentResponse["status"], string>
> = {
  COMPLETED: "Payment verified successfully",
  FAILED: "Payment failed. Please try again.",
  PENDING: "Payment is still pending confirmation.",
  REFUNDED: "This payment was refunded. Please contact the bursary.",
}

async function verifyGatewayPayment(
  reference: string
): Promise<PaymentVerificationResponse> {
  // Body is only consulted for non-GATEWAY (manual) verification — a GATEWAY
  // payment (the only kind this student-facing flow ever creates) is
  // re-checked server-to-server against whichever gateway (Credo or FCMB) that
  // payment row started on, regardless — so no body is sent.
  const result = await apiClient.post<RealVerifyPaymentResponse>(
    `/fees/payments/verify/${reference}`,
    undefined,
    AUTH
  )
  return {
    success: result.status === "COMPLETED",
    // An unrecognised status reads as still pending rather than crashing.
    status: VERIFY_STATUS_MAP[result.status] ?? "pending",
    reference,
    amount: Number(result.invoice.amountPaid),
    message:
      VERIFY_MESSAGE_MAP[result.status] ??
      "Payment is still pending confirmation.",
  }
}

/* ------------------------------------------------------------------ */
/*  Dev-only local preview                                              */
/*                                                                      */
/*  Found 2026-10-05 in a live browser test: these used to edit a       */
/*  module-level `mockStudent` fixture ("Chukwuemeka Okonkwo"), and the */
/*  result was written over the signed-in applicant in Zustand and the  */
/*  React Query cache, so the page showed a fake student with no        */
/*  backend call behind it. They now patch the applicant's own, real    */
/*  record (`current`), so identity and every untouched field stay      */
/*  real. Nothing is sent to the server: the preview lasts until the    */
/*  next refetch of GET /admission/student (or a reload), and while     */
/*  GET /admission/me/stages is live the stage list keeps following the */
/*  server, not the preview. No backend "simulate" endpoint exists or   */
/*  is meant to.                                                        */
/* ------------------------------------------------------------------ */

export type CurrentStudentGetter = () => AdmissionStudent | undefined

function requireRealStudent(
  getCurrent: CurrentStudentGetter
): AdmissionStudent {
  const current = getCurrent()
  if (!current) {
    throw new Error(
      "Dev preview: the applicant's real admission record hasn't loaded yet, so there is nothing to preview against."
    )
  }
  return current
}

/* ------------------------------------------------------------------ */
/*  Stage normalisation                                                 */
/*                                                                      */
/*  Live GET /admission/me/stages (probed 2026-10-05) serialises an     */
/*  empty `state`/`config` as a JSON array `[]` (PHP's empty array), not */
/*  `{}`. Normalise here so components can read typed fields — e.g. a    */
/*  DOCUMENT_UPLOAD stage with nothing uploaded yet gets               */
/*  `state.documents: []` instead of crashing on `[].documents.map`.    */
/* ------------------------------------------------------------------ */

function normaliseStage(stage: ResolvedStage): ResolvedStage {
  const config = Array.isArray(stage.config) ? {} : stage.config
  const rawState: object = Array.isArray(stage.state) ? {} : stage.state
  switch (stage.type) {
    case "DOCUMENT_UPLOAD": {
      const docs = "documents" in rawState ? rawState.documents : undefined
      return {
        ...stage,
        config: config as typeof stage.config,
        state: { documents: Array.isArray(docs) ? docs : [] },
      }
    }
    case "CONTENT": {
      const at = "acknowledgedAt" in rawState ? rawState.acknowledgedAt : null
      return {
        ...stage,
        config: config as typeof stage.config,
        state: { acknowledgedAt: typeof at === "string" ? at : null },
      }
    }
    default:
      return {
        ...stage,
        config,
        state: rawState,
      } as ResolvedStage
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

// GET /admission/student with caller-chosen request options (see the two
// fetchStudentAdmission* methods below).
async function getStudentAdmission(
  opts: RequestOptions
): Promise<AdmissionStudent> {
  // Real API: GET /admission/student — Bruno: admission/Admission - Student Aggregate.bru
  // Student Admission Progress spec §3. Composed server-side, wrapped in `data`.
  //
  // has_selected_program/program_*/entry_mode/study_mode/start_term (and A16's
  // major_program_*) are live on QHUB (probed 2026-10-05). Still defaulted
  // defensively for a backend that predates them, so the "Choice Program" step
  // degrades to "not yet chosen" instead of throwing.
  const { data } = await apiClient.get<{
    data: Omit<
      AdmissionStudent,
      | "has_selected_program"
      | "program_id"
      | "program_name"
      | "entry_mode"
      | "study_mode"
      | "start_term"
    > &
      Partial<
        Pick<
          AdmissionStudent,
          | "has_selected_program"
          | "program_id"
          | "program_name"
          | "entry_mode"
          | "study_mode"
          | "start_term"
        >
      >
  }>("/admission/student", opts)
  return {
    has_selected_program: false,
    program_id: null,
    program_name: null,
    entry_mode: null,
    study_mode: null,
    start_term: null,
    ...data,
  }
}

export const admissionService = {
  /* ---------- Fees ---------- */
  async fetchFees(): Promise<FeeSchedule> {
    // Real API: GET /fees/types?scope=admission — Bruno: fee/Fee Types - List (Admission Scope).bru
    // Student Admission Progress spec §2. Returns {session, fees[]} directly (no data envelope).
    return apiClient.get<FeeSchedule>("/fees/types", {
      ...AUTH,
      params: { scope: "admission" },
    })
  },

  /* ---------- Student Data ---------- */
  async fetchStudentAdmission(): Promise<AdmissionStudent> {
    return getStudentAdmission(AUTH)
  },

  // Same call with an explicit bearer token, for code that runs before the
  // token has been stored in apiClient — the sign-in redirect decides where
  // a STUDENT lands right after login (lib/auth/post-sign-in.ts). A separate
  // method rather than an optional parameter, because fetchStudentAdmission
  // is passed directly as a React Query queryFn (which calls it with a
  // context object).
  async fetchStudentAdmissionWithToken(
    accessToken: string
  ): Promise<AdmissionStudent> {
    return getStudentAdmission({
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  },

  /* ---------- Admission stages (sandbox/dynamic-admission/ §4) ---------- */
  // GET /admission/me/stages — confirmed live (bruno/admission/My Stages -
  // List.bru) — the applicant's resolved, typed stages with status.
  // useAdmissionStages still composes the same shape client-side as a
  // fallback for whenever this 404s/errors, per CLAUDE.md §14.
  async fetchMyStages(): Promise<AdmissionStagesPayload> {
    const { data } = await apiClient.get<{ data: AdmissionStagesPayload }>(
      "/admission/me/stages",
      AUTH
    )
    return { ...data, stages: data.stages.map(normaliseStage) }
  },

  async acknowledgeStage(key: string): Promise<ResolvedStage> {
    const { data } = await apiClient.post<{ data: ResolvedStage }>(
      `/admission/me/stages/${encodeURIComponent(key)}/acknowledge`,
      undefined,
      AUTH
    )
    return normaliseStage(data)
  },

  async uploadStageDocuments(
    key: string,
    documents: Record<string, File>
  ): Promise<ResolvedStage> {
    const { data } = await apiClient.post<{ data: ResolvedStage }>(
      `/admission/me/stages/${encodeURIComponent(key)}/documents`,
      { documents },
      { ...AUTH, contentType: "multipart" }
    )
    return normaliseStage(data)
  },

  async removeStageDocument(
    key: string,
    docKey: string
  ): Promise<ResolvedStage> {
    const { data } = await apiClient.delete<{ data: ResolvedStage }>(
      `/admission/me/stages/${encodeURIComponent(key)}/documents/${encodeURIComponent(docKey)}`,
      AUTH
    )
    return normaliseStage(data)
  },

  async initiateStagePayment(
    key: string,
    amount?: number
  ): Promise<PaymentInitiationResponse> {
    // Bruno: admission/My Stages - Initiate Payment.bru — this route's wire
    // shape is `{ data: { authorizationUrl, reference, virtualAccount,
    // otpRequired, authUrl } }` (NOT the wrappers' `gateway_url`). The same
    // shape comes back whichever gateway is active (credo|fcmb, GET/PATCH
    // /fees/gateway); `authUrl` is only a fallback in case a gateway hands
    // its checkout link back there instead. An empty result is caught by
    // PaymentStageSection so "Pay now" never silently does nothing.
    const { data } = await apiClient.post<{
      data: {
        authorizationUrl: string | null
        reference: string
        // Only set for method "GATEWAY_TRANSFER" (B30 item 4); this route is
        // called without a method, so a hosted checkout is expected and this
        // stays null. Not surfaced: nothing here offers a transfer yet.
        virtualAccount?: VirtualAccount | null
        otpRequired?: boolean | null
        authUrl?: string | null
      }
    }>(
      `/admission/me/stages/${encodeURIComponent(key)}/payments/initiate`,
      amount ? { amount } : undefined,
      AUTH
    )
    return {
      success: true,
      reference: data.reference,
      gateway_url: data.authorizationUrl || data.authUrl || "",
      otp_required: data.otpRequired === true,
    }
  },

  /* ---------- Payment OTP challenge (FCMB direct-card channel) ---------- */
  // bruno/fee/Payments - OTP Authenticate.bru / - OTP Resend.bru (QHUB
  // collection only). Only reachable when an initiate answers
  // `otpRequired: true` with no checkout link; a hosted checkout (Credo or
  // FCMB) collects its PIN/OTP on the gateway's own page, outside this API.
  // FCMB's result payload is returned as-is, so callers re-read the stages
  // rather than interpreting this body.
  async authenticatePaymentOtp({
    reference,
    otp,
  }: PaymentOtpPayload): Promise<void> {
    await apiClient.post<object, { otp: string }>(
      `/fees/payments/${encodeURIComponent(reference)}/otp/authenticate`,
      { otp },
      AUTH
    )
  },

  async resendPaymentOtp(reference: string): Promise<void> {
    await apiClient.post<object, undefined>(
      `/fees/payments/${encodeURIComponent(reference)}/otp/resend`,
      undefined,
      AUTH
    )
  },

  /* ---------- Submit pre-application program choice ---------- */
  async submitProgramChoice(payload: {
    programId: number
    entryMode: EntryMode
    studyMode: StudyMode
    startTerm: string
  }): Promise<AdmissionStudent> {
    // POST /admission/program-choice — bruno/admission/Admission - Submit Program Choice.bru;
    // contract in sandbox/REFACTOR_BACKEND_APIS.md (MISSING_BACKEND_APIS.md §2.17).
    const { data } = await apiClient.post<{ data: AdmissionStudent }>(
      "/admission/program-choice",
      payload,
      AUTH
    )
    return data
  },

  /* ---------- Submit major program choice (one tier above program choice) ---------- */
  async submitMajorProgramChoice(payload: {
    majorProgramId: number
  }): Promise<AdmissionStudent> {
    // POST /admission/major-program-choice — confirmed live 2026-09-15/16,
    // bruno/admission/Admission - Submit Major Program Choice.bru
    // (BACKEND_DEVIATIONS_2026-09-14.md A16). Upserts on (userId, active
    // session); re-submitting the same id is a no-op success. 409
    // MAJOR_PROGRAM_CHOICE_LOCKED if a program has already been chosen
    // under a different major program this session; 422
    // INVALID_MAJOR_PROGRAM for an unknown/inactive id — both surface via
    // apiClient's normal error message extraction, same as every other
    // mutation here.
    const { data } = await apiClient.post<{ data: AdmissionStudent }>(
      "/admission/major-program-choice",
      payload,
      AUTH
    )
    return data
  },

  /* ---------- Dev-only local preview: program choice made ---------- */
  devPreviewProgramChosen(
    current: AdmissionStudent,
    payload: {
      programId: number
      programName: string
      entryMode: EntryMode
      studyMode: StudyMode
      startTerm: string
    }
  ): AdmissionStudent {
    return {
      ...current,
      has_selected_program: true,
      program_id: payload.programId,
      program_name: payload.programName,
      entry_mode: payload.entryMode,
      study_mode: payload.studyMode,
      start_term: payload.startTerm,
    }
  },

  /* ---------- Initiate Application Payment ---------- */
  async initiateApplicationPayment(): Promise<PaymentInitiationResponse> {
    // Real API: POST /fees/payments/application/initiate — Bruno: fee/Payments - Initiate Application.bru
    return apiClient.post<PaymentInitiationResponse>(
      "/fees/payments/application/initiate",
      { method: "GATEWAY" },
      AUTH
    )
  },

  /* ---------- Verify Application Payment ---------- */
  async verifyApplicationPayment(
    reference: string
  ): Promise<PaymentVerificationResponse> {
    // Real API: POST /fees/payments/verify/:reference — Bruno: fee/Payments - Verify.bru
    return verifyGatewayPayment(reference)
  },

  /* ---------- Initiate Acceptance Fee Payment ---------- */
  async initiateAcceptanceFeePayment(): Promise<PaymentInitiationResponse> {
    // Real API: POST /fees/payments/acceptance/initiate — Bruno: fee/Payments - Initiate Acceptance.bru
    return apiClient.post<PaymentInitiationResponse>(
      "/fees/payments/acceptance/initiate",
      { method: "GATEWAY" },
      AUTH
    )
  },

  /* ---------- Verify Acceptance Fee Payment ---------- */
  async verifyAcceptanceFeePayment(
    reference: string
  ): Promise<PaymentVerificationResponse> {
    // Real API: POST /fees/payments/verify/:reference — Bruno: fee/Payments - Verify.bru
    return verifyGatewayPayment(reference)
  },

  /* ---------- Initiate Tuition Payment ---------- */
  async initiateTuitionPayment(
    amount: number
  ): Promise<PaymentInitiationResponse> {
    // Real API: POST /fees/payments/tuition/initiate — Bruno: fee/Payments - Initiate Tuition.bru
    // The bruno example body only shows {method: "GATEWAY"} (Tuition Fee has no
    // partial-payment example there) — `amount` is sent defensively so the
    // frontend's half/custom installment plan (TuitionPaymentSection.tsx) has a
    // chance of working; if the backend's DTO doesn't accept it yet, it should
    // either start accepting it or this needs a follow-up spec update.
    return apiClient.post<PaymentInitiationResponse>(
      "/fees/payments/tuition/initiate",
      { method: "GATEWAY", amount },
      AUTH
    )
  },

  /* ---------- Verify Tuition Payment ---------- */
  async verifyTuitionPayment(
    reference: string
  ): Promise<PaymentVerificationResponse> {
    // Real API: POST /fees/payments/verify/:reference — Bruno: fee/Payments - Verify.bru
    return verifyGatewayPayment(reference)
  },

  /* ---------- Cancel a stuck PENDING gateway payment ---------- */
  // Real API: POST /fees/payments/:id/cancel (run_api, 2026-10-27) —
  // re-verifies against the gateway server-side before cancelling, so
  // this never clears a payment that actually completed. Used by
  // PendingPaymentPanel once a 409 PAYMENT_IN_PROGRESS is parsed (see
  // lib/pendingPaymentError.ts) to get the payer out of
  // initiatePayment()'s in-flight guard without waiting out the window.
  async cancelPendingPayment(paymentId: number): Promise<{ status: string }> {
    const { data } = await apiClient.post<{ data: { status: string } }>(
      `/fees/payments/${paymentId}/cancel`,
      undefined,
      AUTH
    )
    return data
  },

  /* ---------- Verify a dynamic/custom PAYMENT stage ---------- */
  // Same endpoint as the three verify*Payment() methods above — it was
  // already generic and reference-only (no fee-type-specific variant
  // exists), confirmed 2026-09-16 tracing a real "Unable to determine
  // payment type" failure back to verify-payments/page.tsx's own routing
  // logic, not this call. Exists only so a custom PAYMENT stage (e.g.
  // Certificate's "Access Fee") gets its own query cache key instead of
  // having no verify path at all.
  async verifyGenericPayment(
    reference: string
  ): Promise<PaymentVerificationResponse> {
    return verifyGatewayPayment(reference)
  },

  /* ---------- Dev-only local preview: status changes ---------- */
  devPreviewAppPaymentPaid(current: AdmissionStudent): AdmissionStudent {
    return { ...current, application_payment_status: "paid" }
  },

  devPreviewApplied(current: AdmissionStudent): AdmissionStudent {
    return {
      ...current,
      has_applied: true,
      application_status: "submitted",
    }
  },

  devPreviewAdmissionOffered(current: AdmissionStudent): AdmissionStudent {
    // Set expiry to 14 days from now
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + 14)
    return {
      ...current,
      admission_status: "offered",
      is_admitted: true,
      offer_expiry_date: expiry.toISOString(),
    }
  },

  devPreviewAdmissionAccepted(current: AdmissionStudent): AdmissionStudent {
    return {
      ...current,
      admission_status: "accepted",
      acceptance_payment_status: "paid",
    }
  },

  devPreviewTuitionPaid(current: AdmissionStudent): AdmissionStudent {
    return {
      ...current,
      tuition_payment_status: "paid",
      tuition_amount_paid: 195_000,
    }
  },

  /* ---------- Accept Admission ---------- */
  async acceptAdmission(): Promise<AdmissionStudent> {
    // Real API: PATCH /admissions/:id/accept — admission_README.md "Admissions" table
    // (Bruno: admission/Admissions - Accept.bru). Same admissionId-resolution pattern
    // as declineAdmission() below. On success the backend auto-creates the applicant's
    // acceptance-fee invoice, so a fresh fetchStudentAdmission() picks that up too.
    const { data: admission } = await apiClient.get<{
      data: { id: number }
    }>("/admissions/my", AUTH)
    await apiClient.patch<{ data: unknown }>(
      `/admissions/${admission.id}/accept`,
      undefined,
      AUTH
    )
    return admissionService.fetchStudentAdmission()
  },

  /* ---------- Decline Admission ---------- */
  async declineAdmission(): Promise<AdmissionStudent> {
    // Real API: PATCH /admissions/:id/decline — admission_README.md "Admissions" table,
    // already a full match (Student Admission Progress spec §6) — the only reason this
    // couldn't be called before was not knowing the applicant's own admissionId, which
    // GET /admissions/my (Bruno: admission/Admissions - My.bru) now resolves.
    const { data: admission } = await apiClient.get<{
      data: { id: number }
    }>("/admissions/my", AUTH)
    await apiClient.patch<{ data: unknown }>(
      `/admissions/${admission.id}/decline`,
      undefined,
      AUTH
    )
    return admissionService.fetchStudentAdmission()
  },

  /* ---------- Dev-only local preview: declined ---------- */
  devPreviewDeclined(current: AdmissionStudent): AdmissionStudent {
    return {
      ...current,
      admission_status: "declined",
      is_admitted: false,
      offer_expiry_date: null,
    }
  },

  /* ---------- Dev-only local preview: expired ---------- */
  devPreviewExpired(current: AdmissionStudent): AdmissionStudent {
    return {
      ...current,
      admission_status: "expired",
      is_admitted: false,
      offer_expiry_date: new Date(Date.now() - 86400000).toISOString(), // yesterday
    }
  },
}

export const admissionKeys = {
  all: ["admission"] as const,
  fees: () => [...admissionKeys.all, "fees"] as const,
  student: () => [...admissionKeys.all, "student"] as const,
  stages: () => [...admissionKeys.all, "stages"] as const,
  verifyAppPayment: (reference: string) =>
    [...admissionKeys.all, "verify-app", reference] as const,
  verifyAccPayment: (reference: string) =>
    [...admissionKeys.all, "verify-acc", reference] as const,
  verifyTuiPayment: (reference: string) =>
    [...admissionKeys.all, "verify-tui", reference] as const,
  // Any PAYMENT stage that isn't one of the three legacy fixed fee types
  // (a custom step an admin created, e.g. "Access Fee" — Dynamic Admission)
  // — same underlying call as the three above (verifyGatewayPayment is
  // already generic, reference-only), just its own cache key.
  verifyGenericPayment: (reference: string) =>
    [...admissionKeys.all, "verify-generic", reference] as const,
}

export const admissionQueryOptions = {
  fees: () =>
    createApiQueryOptions({
      queryKey: admissionKeys.fees(),
      queryFn: admissionService.fetchFees,
    }),

  student: () =>
    createApiQueryOptions({
      queryKey: admissionKeys.student(),
      queryFn: admissionService.fetchStudentAdmission,
    }),

  stages: () =>
    createApiQueryOptions({
      queryKey: admissionKeys.stages(),
      queryFn: admissionService.fetchMyStages,
      retry: false,
      staleTime: 1000 * 30,
    }),

  verifyApplicationPayment: (reference: string) =>
    createApiQueryOptions({
      queryKey: admissionKeys.verifyAppPayment(reference),
      queryFn: () => admissionService.verifyApplicationPayment(reference),
    }),

  verifyAcceptanceFeePayment: (reference: string) =>
    createApiQueryOptions({
      queryKey: admissionKeys.verifyAccPayment(reference),
      queryFn: () => admissionService.verifyAcceptanceFeePayment(reference),
    }),

  verifyTuitionPayment: (reference: string) =>
    createApiQueryOptions({
      queryKey: admissionKeys.verifyTuiPayment(reference),
      queryFn: () => admissionService.verifyTuitionPayment(reference),
    }),

  verifyGenericPayment: (reference: string) =>
    createApiQueryOptions({
      queryKey: admissionKeys.verifyGenericPayment(reference),
      queryFn: () => admissionService.verifyGenericPayment(reference),
    }),
}

export const admissionMutationOptions = {
  acknowledgeStage: () =>
    createApiMutationOptions<ResolvedStage, string>({
      mutationKey: [...admissionKeys.all, "stages", "acknowledge"],
      mutationFn: (key) => admissionService.acknowledgeStage(key),
    }),

  uploadStageDocuments: () =>
    createApiMutationOptions<
      ResolvedStage,
      { key: string; documents: Record<string, File> }
    >({
      mutationKey: [...admissionKeys.all, "stages", "documents", "upload"],
      mutationFn: ({ key, documents }) =>
        admissionService.uploadStageDocuments(key, documents),
    }),

  removeStageDocument: () =>
    createApiMutationOptions<ResolvedStage, { key: string; docKey: string }>({
      mutationKey: [...admissionKeys.all, "stages", "documents", "remove"],
      mutationFn: ({ key, docKey }) =>
        admissionService.removeStageDocument(key, docKey),
    }),

  initiateStagePayment: () =>
    createApiMutationOptions<
      PaymentInitiationResponse,
      { key: string; amount?: number }
    >({
      mutationKey: [...admissionKeys.all, "stages", "payments", "initiate"],
      mutationFn: ({ key, amount }) =>
        admissionService.initiateStagePayment(key, amount),
    }),

  authenticatePaymentOtp: () =>
    createApiMutationOptions<void, PaymentOtpPayload>({
      mutationKey: [...admissionKeys.all, "payments", "otp", "authenticate"],
      mutationFn: (payload) => admissionService.authenticatePaymentOtp(payload),
    }),

  resendPaymentOtp: () =>
    createApiMutationOptions<void, string>({
      mutationKey: [...admissionKeys.all, "payments", "otp", "resend"],
      mutationFn: (reference) => admissionService.resendPaymentOtp(reference),
    }),

  submitProgramChoice: () =>
    createApiMutationOptions<
      AdmissionStudent,
      {
        programId: number
        entryMode: EntryMode
        studyMode: StudyMode
        startTerm: string
      }
    >({
      mutationKey: [...admissionKeys.all, "program-choice"],
      mutationFn: (payload) => admissionService.submitProgramChoice(payload),
    }),

  submitMajorProgramChoice: () =>
    createApiMutationOptions<AdmissionStudent, { majorProgramId: number }>({
      mutationKey: [...admissionKeys.all, "major-program-choice"],
      mutationFn: (payload) =>
        admissionService.submitMajorProgramChoice(payload),
    }),

  initiateApplicationPayment: () =>
    createApiMutationOptions<PaymentInitiationResponse, void>({
      mutationKey: [
        ...admissionKeys.all,
        "payments",
        "application",
        "initiate",
      ],
      mutationFn: () => admissionService.initiateApplicationPayment(),
    }),

  initiateAcceptanceFeePayment: () =>
    createApiMutationOptions<PaymentInitiationResponse, void>({
      mutationKey: [...admissionKeys.all, "payments", "acceptance", "initiate"],
      mutationFn: () => admissionService.initiateAcceptanceFeePayment(),
    }),

  initiateTuitionPayment: () =>
    createApiMutationOptions<PaymentInitiationResponse, number>({
      mutationKey: [...admissionKeys.all, "payments", "tuition", "initiate"],
      mutationFn: admissionService.initiateTuitionPayment,
    }),

  cancelPendingPayment: () =>
    createApiMutationOptions<{ status: string }, number>({
      mutationKey: [...admissionKeys.all, "payments", "cancel"],
      mutationFn: (paymentId) =>
        admissionService.cancelPendingPayment(paymentId),
    }),

  simulateProgramChosen: (getCurrent: CurrentStudentGetter) =>
    createApiMutationOptions<
      AdmissionStudent,
      {
        programId: number
        programName: string
        entryMode: EntryMode
        studyMode: StudyMode
        startTerm: string
      }
    >({
      mutationKey: [...admissionKeys.all, "dev", "program-chosen"],
      mutationFn: async (payload) =>
        admissionService.devPreviewProgramChosen(
          requireRealStudent(getCurrent),
          payload
        ),
    }),

  simulateAppPaymentPaid: (getCurrent: CurrentStudentGetter) =>
    createApiMutationOptions<AdmissionStudent, void>({
      mutationKey: [...admissionKeys.all, "dev", "app-paid"],
      mutationFn: async () =>
        admissionService.devPreviewAppPaymentPaid(
          requireRealStudent(getCurrent)
        ),
    }),

  simulateApplied: (getCurrent: CurrentStudentGetter) =>
    createApiMutationOptions<AdmissionStudent, void>({
      mutationKey: [...admissionKeys.all, "dev", "applied"],
      mutationFn: async () =>
        admissionService.devPreviewApplied(requireRealStudent(getCurrent)),
    }),

  simulateOffered: (getCurrent: CurrentStudentGetter) =>
    createApiMutationOptions<AdmissionStudent, void>({
      mutationKey: [...admissionKeys.all, "dev", "offered"],
      mutationFn: async () =>
        admissionService.devPreviewAdmissionOffered(
          requireRealStudent(getCurrent)
        ),
    }),

  simulateAccepted: (getCurrent: CurrentStudentGetter) =>
    createApiMutationOptions<AdmissionStudent, void>({
      mutationKey: [...admissionKeys.all, "dev", "accepted"],
      mutationFn: async () =>
        admissionService.devPreviewAdmissionAccepted(
          requireRealStudent(getCurrent)
        ),
    }),

  simulateDeclined: (getCurrent: CurrentStudentGetter) =>
    createApiMutationOptions<AdmissionStudent, void>({
      mutationKey: [...admissionKeys.all, "dev", "declined"],
      mutationFn: async () =>
        admissionService.devPreviewDeclined(requireRealStudent(getCurrent)),
    }),

  simulateExpired: (getCurrent: CurrentStudentGetter) =>
    createApiMutationOptions<AdmissionStudent, void>({
      mutationKey: [...admissionKeys.all, "dev", "expired"],
      mutationFn: async () =>
        admissionService.devPreviewExpired(requireRealStudent(getCurrent)),
    }),

  acceptAdmission: () =>
    createApiMutationOptions<AdmissionStudent, void>({
      mutationKey: [...admissionKeys.all, "accept"],
      mutationFn: () => admissionService.acceptAdmission(),
    }),

  declineAdmission: () =>
    createApiMutationOptions<AdmissionStudent, void>({
      mutationKey: [...admissionKeys.all, "decline"],
      mutationFn: () => admissionService.declineAdmission(),
    }),

  simulateTuitionPaid: (getCurrent: CurrentStudentGetter) =>
    createApiMutationOptions<AdmissionStudent, void>({
      mutationKey: [...admissionKeys.all, "dev", "tuition-paid"],
      mutationFn: async () =>
        admissionService.devPreviewTuitionPaid(requireRealStudent(getCurrent)),
    }),

  // Dev-only "Discard preview": refetches the applicant's real record
  // from the server, replacing any local preview in the cache.
  resetAll: () =>
    createApiMutationOptions<AdmissionStudent, void>({
      mutationKey: [...admissionKeys.all, "dev", "discard-preview"],
      mutationFn: () => admissionService.fetchStudentAdmission(),
    }),
}
