"use client"

import { useMemo } from "react"
import { Clock, ExternalLink, Loader2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useCancelPendingPayment } from "../hooks/useAdmissionQueries"
import type { PendingPaymentDetail } from "../lib/pendingPaymentError"

const METHOD_LABELS: Record<string, string> = {
  GATEWAY: "Card / Transfer",
  GATEWAY_TRANSFER: "Bank Transfer",
  GATEWAY_CARD: "Card",
}

function minutesRemaining(retryAfter: string | null): number | null {
  if (!retryAfter) return null
  const ms = new Date(retryAfter).getTime() - Date.now()
  return ms > 0 ? Math.ceil(ms / 60000) : 0
}

/**
 * Found live 2026-10-27: initiatePayment()'s in-flight guard (409
 * PAYMENT_IN_PROGRESS) is correct — never let a retry race a charge that
 * might have actually gone through — but was a dead end on the frontend:
 * a toast with no way to see, resume, or clear the attempt it was
 * blocking on. Shown instead of (or alongside) the normal "Pay" CTA once
 * a section's own handlePay() parses this error via
 * parsePendingPaymentError().
 */
export function PendingPaymentPanel({
  detail,
  onCancelled,
}: {
  detail: PendingPaymentDetail
  onCancelled: () => void
}) {
  const cancel = useCancelPendingPayment()
  const minutesLeft = useMemo(
    () => minutesRemaining(detail.retryAfter),
    [detail.retryAfter]
  )

  const checkout = detail.checkout
  const resumeUrl = checkout?.checkoutUrl || checkout?.authUrl || null
  const account = checkout?.virtualAccount ?? checkout?.bankAccount ?? null

  const handleCancel = async () => {
    try {
      await cancel.mutateAsync(detail.id)
      toast.success("Cancelled. You can start a fresh payment now.")
      onCancelled()
    } catch (err) {
      // cancelPendingPayment() refuses (502) when the gateway can't be
      // reached right now, or (409) when it turns out to have actually
      // completed — either way, surfacing the real reason beats a bare
      // "failed" since the payer needs to know which one it was.
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not cancel this payment. Try again shortly."
      )
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            A payment is already in progress
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            You started a {METHOD_LABELS[detail.method] ?? "payment"} of ₦
            {detail.amount.toLocaleString()} and it hasn&apos;t been confirmed
            yet. Resume it below if you still have the gateway page open, or
            cancel it if you&apos;re sure you abandoned it, to start over.
          </p>
        </div>
      </div>

      {/* Resumable checkout — a hosted gateway link */}
      {resumeUrl && (
        <Button
          onClick={() => {
            window.location.href = resumeUrl
          }}
          className="w-full gap-2"
        >
          Resume Payment
          <ExternalLink className="size-4" />
        </Button>
      )}

      {/* Resumable checkout — a virtual/bank account to transfer into */}
      {!resumeUrl && account && (
        <dl className="space-y-2 rounded-lg border border-border bg-background/60 p-3 text-sm">
          {Object.entries({
            Bank: account.bank,
            "Account Name": account.accountName,
            "Account Number": account.accountNumber,
            Reference: detail.referenceNumber,
          }).map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium break-all">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Neither captured (e.g. a pre-fix attempt, or OTP mid-flow) — nothing to resume, only cancel or wait */}
      {!resumeUrl && !account && (
        <p className="text-xs text-muted-foreground">
          Reference: <span className="font-mono">{detail.referenceNumber}</span>
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {minutesLeft !== null && minutesLeft > 0
            ? `Or wait ~${minutesLeft} min${minutesLeft === 1 ? "" : "s"} and it'll clear automatically.`
            : "You can also just try again — it should clear automatically now."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCancel}
          disabled={cancel.isPending}
          className="shrink-0 gap-1.5 text-destructive hover:text-destructive"
        >
          {cancel.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <XCircle className="size-3.5" />
          )}
          Cancel this payment
        </Button>
      </div>
    </div>
  )
}
