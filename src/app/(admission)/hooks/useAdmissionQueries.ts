/* ------------------------------------------------------------------ */
/*  Admission Module — React Query Hooks                               */
/* ------------------------------------------------------------------ */

"use client"

import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"
import {
  admissionKeys,
  admissionMutationOptions,
  admissionQueryOptions,
  admissionService,
} from "../services/admissionService"
import { useAdmissionStore } from "../store/admissionStore"
import type { AdmissionStudent } from "../types/admission"

// Real bug, found 2026-09-16: every mutation below that changes admission
// progress (program choice, any payment, accept/decline, every dev-simulate
// action) called this to resync the legacy `admission/student` aggregate —
// but GET /admission/me/stages (the source `/process-admission` actually
// runs on, once it's live) was never invalidated alongside it, anywhere.
// Confirmed live: accepting an offer updated `admission_status` correctly,
// but the step indicator stayed stuck on "Admission Status" as the current
// stage — `currentStageKey` only comes from the stages cache, which nothing
// had told to refetch. Centralized here once, rather than patching each of
// the 15+ call sites (and missing a 16th later) — every one of them needs
// this, not just accept/decline.
async function syncAdmissionStudent(
  queryClient: QueryClient,
  setStudent: (student: AdmissionStudent) => void,
  nextStudent?: AdmissionStudent
) {
  const student =
    nextStudent ?? (await admissionService.fetchStudentAdmission())
  setStudent(student)
  queryClient.setQueryData(admissionKeys.student(), student)
  await queryClient.invalidateQueries({ queryKey: admissionKeys.stages() })
  return student
}

/* ------------------------------------------------------------------ */
/*  Fetch Fees                                                          */
/* ------------------------------------------------------------------ */

export function useFees() {
  const setFees = useAdmissionStore((s) => s.setFees)

  return useQuery({
    ...admissionQueryOptions.fees(),
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const data = await admissionService.fetchFees()
      setFees(data)
      return data
    },
  })
}

/* ------------------------------------------------------------------ */
/*  Fetch Student Admission Data                                        */
/* ------------------------------------------------------------------ */

export function useStudentAdmission() {
  const setStudent = useAdmissionStore((s) => s.setStudent)

  return useQuery({
    ...admissionQueryOptions.student(),
    staleTime: 1000 * 60,
    queryFn: async () => {
      const data = await admissionService.fetchStudentAdmission()
      setStudent(data)
      return data
    },
  })
}

/* ------------------------------------------------------------------ */
/*  Submit Pre-Application Program Choice                               */
/* ------------------------------------------------------------------ */

export function useSubmitProgramChoice() {
  const setStudent = useAdmissionStore((s) => s.setStudent)
  const queryClient = useQueryClient()

  return useMutation({
    ...admissionMutationOptions.submitProgramChoice(),
    onSuccess: async (data) => {
      await syncAdmissionStudent(queryClient, setStudent, data)
    },
  })
}

/* ------------------------------------------------------------------ */
/*  Initiate Application Payment                                        */
/* ------------------------------------------------------------------ */

export function useInitiateApplicationPayment() {
  return useMutation({
    ...admissionMutationOptions.initiateApplicationPayment(),
  })
}

/* ------------------------------------------------------------------ */
/*  Verify Application Payment                                          */
/* ------------------------------------------------------------------ */

export function useVerifyApplicationPayment(reference: string) {
  const setStudent = useAdmissionStore((s) => s.setStudent)
  const queryClient = useQueryClient()

  return useQuery({
    ...admissionQueryOptions.verifyApplicationPayment(reference),
    queryFn: async () => {
      const result = await admissionService.verifyApplicationPayment(reference)
      await syncAdmissionStudent(queryClient, setStudent)
      return result
    },
    enabled: !!reference,
    retry: 2,
    staleTime: Infinity,
  })
}

/* ------------------------------------------------------------------ */
/*  Initiate Acceptance Fee Payment                                      */
/* ------------------------------------------------------------------ */

export function useInitiateAcceptanceFeePayment() {
  return useMutation({
    ...admissionMutationOptions.initiateAcceptanceFeePayment(),
  })
}

/* ------------------------------------------------------------------ */
/*  Verify Acceptance Fee Payment                                        */
/* ------------------------------------------------------------------ */

export function useVerifyAcceptanceFeePayment(reference: string) {
  const setStudent = useAdmissionStore((s) => s.setStudent)
  const queryClient = useQueryClient()

  return useQuery({
    ...admissionQueryOptions.verifyAcceptanceFeePayment(reference),
    queryFn: async () => {
      const result =
        await admissionService.verifyAcceptanceFeePayment(reference)
      await syncAdmissionStudent(queryClient, setStudent)
      return result
    },
    enabled: !!reference,
    retry: 2,
    staleTime: Infinity,
  })
}

/* ------------------------------------------------------------------ */
/*  Initiate Tuition Payment                                             */
/* ------------------------------------------------------------------ */

export function useInitiateTuitionPayment() {
  return useMutation({
    ...admissionMutationOptions.initiateTuitionPayment(),
  })
}

/* ------------------------------------------------------------------ */
/*  Cancel a stuck PENDING gateway payment                              */
/* ------------------------------------------------------------------ */

export function useCancelPendingPayment() {
  return useMutation({
    ...admissionMutationOptions.cancelPendingPayment(),
  })
}

/* ------------------------------------------------------------------ */
/*  Verify Tuition Payment                                               */
/* ------------------------------------------------------------------ */

export function useVerifyTuitionPayment(reference: string) {
  const setStudent = useAdmissionStore((s) => s.setStudent)
  const queryClient = useQueryClient()

  return useQuery({
    ...admissionQueryOptions.verifyTuitionPayment(reference),
    queryFn: async () => {
      const result = await admissionService.verifyTuitionPayment(reference)
      await syncAdmissionStudent(queryClient, setStudent)
      return result
    },
    enabled: !!reference,
    retry: 2,
    staleTime: Infinity,
  })
}

/* ------------------------------------------------------------------ */
/*  Verify a dynamic/custom PAYMENT stage (any fee type outside the      */
/*  three legacy fixed ones — e.g. Certificate's "Access Fee")           */
/* ------------------------------------------------------------------ */

export function useVerifyGenericPayment(reference: string) {
  const setStudent = useAdmissionStore((s) => s.setStudent)
  const queryClient = useQueryClient()

  return useQuery({
    ...admissionQueryOptions.verifyGenericPayment(reference),
    queryFn: async () => {
      const result = await admissionService.verifyGenericPayment(reference)
      // syncAdmissionStudent now invalidates the stages cache too (see its
      // own comment) — was a one-off fix here before that centralization.
      await syncAdmissionStudent(queryClient, setStudent)
      return result
    },
    enabled: !!reference,
    retry: 2,
    staleTime: Infinity,
  })
}

/* ------------------------------------------------------------------ */
/*  Dev-only mutations                                                   */
/* ------------------------------------------------------------------ */

// Local preview only: each action patches the applicant's own, real
// record (read from the React Query cache) and nothing is sent to the
// server (see admissionService.ts "Dev-only local preview"). resetAll
// discards the preview by refetching the real record.
export function useDevSimulate() {
  const setStudent = useAdmissionStore((s) => s.setStudent)
  const queryClient = useQueryClient()
  const getRealStudent = () =>
    queryClient.getQueryData<AdmissionStudent>(admissionKeys.student())

  const simulateProgramChosen = useMutation({
    ...admissionMutationOptions.simulateProgramChosen(getRealStudent),
    onSuccess: async (data) => {
      await syncAdmissionStudent(queryClient, setStudent, data)
    },
  })

  const simulateAppPaymentPaid = useMutation({
    ...admissionMutationOptions.simulateAppPaymentPaid(getRealStudent),
    onSuccess: async (data) => {
      await syncAdmissionStudent(queryClient, setStudent, data)
    },
  })

  const simulateApplied = useMutation({
    ...admissionMutationOptions.simulateApplied(getRealStudent),
    onSuccess: async (data) => {
      await syncAdmissionStudent(queryClient, setStudent, data)
    },
  })

  const simulateOffered = useMutation({
    ...admissionMutationOptions.simulateOffered(getRealStudent),
    onSuccess: async (data) => {
      await syncAdmissionStudent(queryClient, setStudent, data)
    },
  })

  const simulateAccepted = useMutation({
    ...admissionMutationOptions.simulateAccepted(getRealStudent),
    onSuccess: async (data) => {
      await syncAdmissionStudent(queryClient, setStudent, data)
    },
  })

  const simulateDeclined = useMutation({
    ...admissionMutationOptions.simulateDeclined(getRealStudent),
    onSuccess: async (data) => {
      await syncAdmissionStudent(queryClient, setStudent, data)
    },
  })

  const simulateExpired = useMutation({
    ...admissionMutationOptions.simulateExpired(getRealStudent),
    onSuccess: async (data) => {
      await syncAdmissionStudent(queryClient, setStudent, data)
    },
  })

  const simulateTuitionPaid = useMutation({
    ...admissionMutationOptions.simulateTuitionPaid(getRealStudent),
    onSuccess: async (data) => {
      await syncAdmissionStudent(queryClient, setStudent, data)
    },
  })

  const resetAll = useMutation({
    ...admissionMutationOptions.resetAll(),
    onSuccess: async (data) => {
      await syncAdmissionStudent(queryClient, setStudent, data)
    },
  })

  return {
    simulateProgramChosen,
    simulateAppPaymentPaid,
    simulateApplied,
    simulateOffered,
    simulateAccepted,
    simulateDeclined,
    simulateExpired,
    simulateTuitionPaid,
    resetAll,
  }
}

/* ------------------------------------------------------------------ */
/*  Accept Admission                                                     */
/* ------------------------------------------------------------------ */

export function useAcceptAdmission() {
  const setStudent = useAdmissionStore((s) => s.setStudent)
  const queryClient = useQueryClient()

  return useMutation({
    ...admissionMutationOptions.acceptAdmission(),
    onSuccess: async (data) => {
      await syncAdmissionStudent(queryClient, setStudent, data)
    },
  })
}

/* ------------------------------------------------------------------ */
/*  Decline Admission                                                    */
/* ------------------------------------------------------------------ */

export function useDeclineAdmission() {
  const setStudent = useAdmissionStore((s) => s.setStudent)
  const queryClient = useQueryClient()

  return useMutation({
    ...admissionMutationOptions.declineAdmission(),
    onSuccess: async (data) => {
      await syncAdmissionStudent(queryClient, setStudent, data)
    },
  })
}
