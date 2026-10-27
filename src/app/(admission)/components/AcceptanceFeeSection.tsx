"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { FeeInfoCard } from "./FeeInfoCard"
import { StatusBadgeWidget } from "./StatusBadgeWidget"
import { PendingPaymentPanel } from "./PendingPaymentPanel"
import {
  useInitiateAcceptanceFeePayment,
  useDevSimulate,
} from "../hooks/useAdmissionQueries"
import { BadgeCheck, ExternalLink, CheckCircle, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { StepSectionProps } from "../types/admission"
import {
  parsePendingPaymentError,
  type PendingPaymentDetail,
} from "../lib/pendingPaymentError"

export function AcceptanceFeeSection({ student, fees }: StepSectionProps) {
  const accFee = fees.fees.find((f) => f.slug === "acceptance-fee")
  const initPayment = useInitiateAcceptanceFeePayment()
  const { simulateAccepted } = useDevSimulate()
  const [pendingPayment, setPendingPayment] =
    useState<PendingPaymentDetail | null>(null)

  const handlePay = async () => {
    try {
      const result = await initPayment.mutateAsync()
      if (result.success && result.gateway_url) {
        toast.success("Redirecting to payment gateway…")
        setTimeout(() => {
          window.location.href = result.gateway_url
        }, 800)
      } else {
        // Gateway-agnostic guard: never leave "Pay" as a silent no-op if the
        // active gateway (Credo or FCMB) answered without a checkout URL.
        toast.error(
          "The payment gateway did not return a checkout link. Please try again, or contact support if this continues."
        )
      }
    } catch (err) {
      // See ApplicationPaymentSection.tsx's own comment on this — a 409
      // here used to be a dead-end toast with no way to resume or clear
      // whatever it was blocking on.
      const pending = parsePendingPaymentError(err)
      if (pending) {
        setPendingPayment(pending)
        return
      }
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to initiate payment. Please try again."
      )
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <Card className="relative overflow-hidden border-border/50 shadow-lg">
        <div className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-emerald-400/40 via-emerald-500 to-emerald-400/40" />

        <CardHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-500/10 p-2.5 dark:bg-emerald-500/20">
              <BadgeCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-lg">Acceptance Fee Payment</CardTitle>
              <CardDescription>
                Step 4 — Pay the acceptance fee to confirm your admission
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadgeWidget label="Admission Offered" status="success" />
            <StatusBadgeWidget
              label={
                student.acceptance_payment_status === "paid"
                  ? "Acceptance Confirmed"
                  : "Acceptance Pending"
              }
              status={
                student.acceptance_payment_status === "paid"
                  ? "success"
                  : "warning"
              }
            />
          </div>

          <Separator />

          {accFee && <FeeInfoCard fee={accFee} />}

          {/* Info */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 dark:bg-primary/10"
          >
            <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Confirm Your Admission
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Congratulations on your admission! To secure your spot, please
                pay the acceptance fee of{" "}
                <span className="font-semibold text-foreground">
                  ₦{accFee?.amount.toLocaleString() ?? "30,000"}
                </span>
                . Payment will be processed securely via our online payment
                gateway.
              </p>
            </div>
          </motion.div>

          {/* CTA — replaced by the in-progress panel once a 409 blocks it */}
          {pendingPayment ? (
            <PendingPaymentPanel
              detail={pendingPayment}
              onCancelled={() => setPendingPayment(null)}
            />
          ) : (
            <Button
              onClick={handlePay}
              disabled={initPayment.isPending}
              className="btn-glow w-full gap-2"
              size="lg"
            >
              {initPayment.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  Pay ₦{accFee?.amount.toLocaleString() ?? "30,000"} Now
                  <ExternalLink className="size-4" />
                </>
              )}
            </Button>
          )}

          {/* Dev toolbar */}
          {process.env.NODE_ENV === "development" && (
            <div className="rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 p-3">
              <p className="mb-2 text-[10px] font-bold tracking-wider text-amber-600 uppercase">
                🛠 Dev Controls — local preview only, nothing is sent to the
                server
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => simulateAccepted.mutate()}
                disabled={simulateAccepted.isPending}
                className="gap-1.5 text-xs"
              >
                {simulateAccepted.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <CheckCircle className="size-3" />
                )}
                Simulate: Acceptance Fee Paid
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
