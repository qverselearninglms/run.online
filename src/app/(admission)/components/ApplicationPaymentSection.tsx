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
import { useInitiateApplicationPayment } from "../hooks/useAdmissionQueries"
import { CreditCard, ExternalLink, Loader2, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import type { StepSectionProps } from "../types/admission"
import {
  parsePendingPaymentError,
  type PendingPaymentDetail,
} from "../lib/pendingPaymentError"

export function ApplicationPaymentSection({ student, fees }: StepSectionProps) {
  const appFee = fees.fees.find((f) => f.slug === "application-fee")
  const initPayment = useInitiateApplicationPayment()
  const [pendingPayment, setPendingPayment] =
    useState<PendingPaymentDetail | null>(null)

  const handlePay = async () => {
    try {
      const result = await initPayment.mutateAsync()
      if (result.success && result.gateway_url) {
        toast.success("Redirecting to payment gateway…")
        // Small delay so toast is visible
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
      // Found live 2026-10-27: a 409 here used to just be a dead-end toast
      // ("already in progress") with no way to see or get out of whatever
      // it was blocking on. PendingPaymentPanel below replaces the CTA
      // once this is set, with a Resume/Cancel path instead.
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
        {/* Gradient top bar */}
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/40 via-primary to-primary/40" />

        <CardHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 dark:bg-primary/20">
              <CreditCard className="size-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Application Fee Payment</CardTitle>
              <CardDescription>
                Step 1 — Pay the application fee to access the admission form
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Status row */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadgeWidget
              label={
                student.application_payment_status === "paid"
                  ? "Payment Confirmed"
                  : "Payment Required"
              }
              status={
                student.application_payment_status === "paid"
                  ? "success"
                  : "warning"
              }
            />
            <StatusBadgeWidget
              label={student.has_applied ? "Applied" : "Not Applied"}
              status={student.has_applied ? "success" : "info"}
            />
            <StatusBadgeWidget
              label={
                student.is_admitted
                  ? "Admitted"
                  : student.admission_status === "rejected"
                    ? "Not Admitted"
                    : "Pending"
              }
              status={
                student.is_admitted
                  ? "success"
                  : student.admission_status === "rejected"
                    ? "failed"
                    : "pending"
              }
            />
          </div>

          <Separator />

          {/* Fee details */}
          {appFee && <FeeInfoCard fee={appFee} />}

          {/* Info callout */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 dark:bg-amber-500/10"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Payment Required
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                You must pay the application fee of{" "}
                <span className="font-semibold text-foreground">
                  ₦{appFee?.amount.toLocaleString() ?? "10,000"}
                </span>{" "}
                to gain access to the admission application form. This fee is
                non-refundable and will be processed securely via our online
                payment gateway.
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
                  Pay ₦{appFee?.amount.toLocaleString() ?? "10,000"} Now
                  <ExternalLink className="size-4" />
                </>
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
