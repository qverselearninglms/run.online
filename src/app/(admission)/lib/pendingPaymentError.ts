/* ------------------------------------------------------------------ */
/*  Pending-payment 409 — PaymentRoutingException's structured detail   */
/*  (run_api PaymentService::initiatePayment()'s in-flight guard,       */
/*  2026-10-27). A blocked retry used to surface as a bare toast with   */
/*  no way to resume or cancel the attempt it's blocking on — this      */
/*  parses the same error into something a screen can act on.          */
/* ------------------------------------------------------------------ */

import { ApiClientError } from "@/lib/clients/apiClient"
import type { VirtualAccount } from "@/modules/fee-management/types"

// No exported BankAccount type alongside VirtualAccount in fee-management's
// types — same three fields (payment.schema.ts's BankAccountSchema), so
// shaped inline rather than adding one there just for this.
export interface PendingPaymentBankAccount {
  bank: string
  accountName: string
  accountNumber: string
}

export interface PendingPaymentCheckout {
  checkoutUrl: string | null
  virtualAccount: VirtualAccount | null
  bankAccount: PendingPaymentBankAccount | null
  otpRequired: boolean | null
  authUrl: string | null
}

export interface PendingPaymentDetail {
  id: number
  referenceNumber: string
  method: string
  amount: number
  status: string
  createdAt: string
  /** ISO timestamp — null only for the ALREADY_PAID variant, which has nothing to retry. */
  retryAfter: string | null
  checkout: PendingPaymentCheckout | null
}

interface ErrorBody {
  code?: string
  details?: { existingPayment?: unknown }
}

function errorBody(err: unknown): ErrorBody | null {
  if (!(err instanceof ApiClientError)) return null
  if (err.status !== 409) return null
  if (typeof err.data !== "object" || err.data === null) return null
  return err.data as ErrorBody
}

/** PAYMENT_IN_PROGRESS — resumable/cancellable, still within the 30-minute staleness window. */
export function parsePendingPaymentError(
  err: unknown
): PendingPaymentDetail | null {
  const body = errorBody(err)
  if (body?.code !== "PAYMENT_IN_PROGRESS") return null

  const existing = body.details?.existingPayment
  if (!existing || typeof existing !== "object") return null

  return existing as PendingPaymentDetail
}

/** ALREADY_PAID — the invoice is settled; nothing to resume or cancel, just re-sync and move on. */
export function isAlreadyPaidError(err: unknown): boolean {
  return errorBody(err)?.code === "ALREADY_PAID"
}
