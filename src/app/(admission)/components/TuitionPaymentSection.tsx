"use client"

import { useState } from "react"
import Link from "next/link"
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
  useInitiateTuitionPayment,
  useDevSimulate,
} from "../hooks/useAdmissionQueries"
import {
  parsePendingPaymentError,
  type PendingPaymentDetail,
} from "../lib/pendingPaymentError"
import {
  GraduationCap,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle,
  CreditCard,
  LayoutDashboard,
} from "lucide-react"
import { roleDashboardPath, UserRole } from "@/config/nav.config"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { StepSectionProps } from "../types/admission"

type PaymentPlan = "full" | "half" | "custom"

export function TuitionPaymentSection({ student, fees }: StepSectionProps) {
  const tuiFee = fees.fees.find((f) => f.slug === "tuition-fee")
  const initPayment = useInitiateTuitionPayment()
  const { simulateTuitionPaid } = useDevSimulate()

  const totalAmount = tuiFee?.amount ?? 195_000
  const amountPaid = student.tuition_amount_paid ?? 0
  const remaining = totalAmount - amountPaid
  const isPartiallyPaid = amountPaid > 0 && remaining > 0
  const minimumPayment = Math.ceil(totalAmount / 2)

  const [selectedPlan, setSelectedPlan] = useState<PaymentPlan>(
    isPartiallyPaid ? "full" : "half"
  )
  const [customAmount, setCustomAmount] = useState<string>("")
  const [pendingPayment, setPendingPayment] =
    useState<PendingPaymentDetail | null>(null)

  const getPaymentAmount = (): number => {
    if (isPartiallyPaid) return remaining // Only option: pay the balance
    switch (selectedPlan) {
      case "full":
        return remaining
      case "half":
        return minimumPayment
      case "custom": {
        const parsed = parseInt(customAmount.replace(/,/g, ""), 10)
        return isNaN(parsed) ? 0 : parsed
      }
    }
  }

  const paymentAmount = getPaymentAmount()
  const isValidAmount =
    paymentAmount >= minimumPayment && paymentAmount <= remaining

  const handlePay = async () => {
    if (!isValidAmount) {
      toast.error(
        `Amount must be between ₦${minimumPayment.toLocaleString()} and ₦${remaining.toLocaleString()}`
      )
      return
    }
    try {
      const result = await initPayment.mutateAsync(paymentAmount)
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

  const paymentPlans = [
    {
      id: "full" as const,
      label: "Full Payment",
      description: "Pay the entire tuition at once",
      amount: remaining,
    },
    {
      id: "half" as const,
      label: "Half Payment",
      description: "Pay 50% now, complete later",
      amount: minimumPayment,
    },
    {
      id: "custom" as const,
      label: "Custom Amount",
      description: `Min ₦${minimumPayment.toLocaleString()}`,
      amount: null,
    },
  ]

  const progressPercent =
    totalAmount > 0 ? Math.round((amountPaid / totalAmount) * 100) : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <Card className="relative overflow-hidden border-border/50 shadow-lg">
        <div className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-primary/40 via-primary to-primary/40" />

        <CardHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 dark:bg-primary/20">
              <GraduationCap className="size-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Tuition Fee Payment</CardTitle>
              <CardDescription>
                Step 5 — Pay your tuition to unlock courses and LMS access
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadgeWidget label="Admission Confirmed" status="success" />
            <StatusBadgeWidget label="Acceptance Fee Paid" status="success" />
            <StatusBadgeWidget
              label={
                student.tuition_payment_status === "paid"
                  ? "Tuition Paid"
                  : isPartiallyPaid
                    ? `Partial — ₦${amountPaid.toLocaleString()} paid`
                    : "Tuition Unpaid"
              }
              status={
                student.tuition_payment_status === "paid"
                  ? "success"
                  : isPartiallyPaid
                    ? "warning"
                    : "info"
              }
            />
          </div>

          <Separator />

          {tuiFee && <FeeInfoCard fee={tuiFee} />}

          {/* Payment progress (visible when partially paid) */}
          {isPartiallyPaid && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 dark:bg-emerald-500/10"
            >
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  Payment Progress
                </span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {progressPercent}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="h-full rounded-full bg-emerald-500"
                />
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                <span>Paid: ₦{amountPaid.toLocaleString()}</span>
                <span>Remaining: ₦{remaining.toLocaleString()}</span>
              </div>
            </motion.div>
          )}

          {/* Payment plan selection (only for first payment) */}
          {!isPartiallyPaid && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">
                Choose a payment plan
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {paymentPlans.map((plan) => (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlan(plan.id)}
                    className={cn(
                      "relative flex flex-col items-start rounded-xl border p-3 text-left transition-all",
                      selectedPlan === plan.id
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30 dark:bg-primary/10"
                        : "border-border hover:border-primary/30 hover:bg-muted/30"
                    )}
                  >
                    {/* Radio indicator */}
                    <div className="mb-2 flex w-full items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        {plan.label}
                      </span>
                      <div
                        className={cn(
                          "flex size-4 items-center justify-center rounded-full border-2 transition-colors",
                          selectedPlan === plan.id
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/40"
                        )}
                      >
                        {selectedPlan === plan.id && (
                          <CheckCircle className="size-3 text-primary-foreground" />
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      {plan.description}
                    </p>
                    {plan.amount !== null && (
                      <p className="mt-1 text-sm font-bold text-foreground tabular-nums">
                        ₦{plan.amount.toLocaleString()}
                      </p>
                    )}
                  </button>
                ))}
              </div>

              {/* Custom amount input */}
              {selectedPlan === "custom" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Enter amount (min ₦{minimumPayment.toLocaleString()})
                    </label>
                    <div className="relative">
                      <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                        ₦
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={customAmount}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9]/g, "")
                          setCustomAmount(
                            raw ? parseInt(raw, 10).toLocaleString() : ""
                          )
                        }}
                        placeholder={minimumPayment.toLocaleString()}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2.5 pl-7 text-sm font-medium text-foreground tabular-nums ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      />
                    </div>
                    {customAmount && !isValidAmount && (
                      <p className="text-[10px] text-destructive">
                        Amount must be between ₦
                        {minimumPayment.toLocaleString()} and ₦
                        {remaining.toLocaleString()}
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {/* Balance callout for second payment */}
          {isPartiallyPaid && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 dark:bg-amber-500/10"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Balance Payment Required
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  You have a remaining balance of{" "}
                  <span className="font-semibold text-foreground">
                    ₦{remaining.toLocaleString()}
                  </span>
                  . Please complete this payment to unlock your courses and LMS
                  access.
                </p>
              </div>
            </motion.div>
          )}

          {/* Info callout for first payment */}
          {!isPartiallyPaid && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 dark:bg-primary/10"
            >
              <CreditCard className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Flexible Payment
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  You can pay the full tuition of{" "}
                  <span className="font-semibold text-foreground">
                    ₦{totalAmount.toLocaleString()}
                  </span>{" "}
                  at once, or pay at least half (₦
                  {minimumPayment.toLocaleString()}) now and complete the rest
                  later.
                </p>
              </div>
            </motion.div>
          )}

          {/* CTA — replaced by the in-progress panel once a 409 blocks it */}
          {pendingPayment ? (
            <PendingPaymentPanel
              detail={pendingPayment}
              onCancelled={() => setPendingPayment(null)}
            />
          ) : (
            <Button
              onClick={handlePay}
              disabled={
                initPayment.isPending || (!isPartiallyPaid && !isValidAmount)
              }
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
                  {isPartiallyPaid ? "Pay Balance" : "Pay"} ₦
                  {(isPartiallyPaid
                    ? remaining
                    : paymentAmount
                  ).toLocaleString()}{" "}
                  Now
                  <ExternalLink className="size-4" />
                </>
              )}
            </Button>
          )}

          {/* A partial payment already unlocks real portal access (see
              NavBar.tsx's dashboardHref logic) — give the applicant a direct
              way there instead of only the balance-payment CTA. */}
          {isPartiallyPaid && (
            <Button asChild variant="outline" className="w-full gap-2">
              <Link href={roleDashboardPath[UserRole.STUDENT]}>
                <LayoutDashboard className="size-4" />
                Go to Dashboard
              </Link>
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
                onClick={() => simulateTuitionPaid.mutate()}
                disabled={simulateTuitionPaid.isPending}
                className="gap-1.5 text-xs"
              >
                {simulateTuitionPaid.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <CheckCircle className="size-3" />
                )}
                Simulate: Tuition Fully Paid
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
