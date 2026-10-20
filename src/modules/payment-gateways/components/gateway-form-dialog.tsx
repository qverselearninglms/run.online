"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { AlertTriangle, Info, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { buildGatewayFormSchema } from "../schemas"
import {
  useCreatePaymentGateway,
  useUpdatePaymentGateway,
} from "../hooks/use-payment-gateway-mutations"
import type {
  DataSource,
  GatewayEnvironment,
  GatewayFormValues,
  GatewayInUseDetails,
  GatewayProvider,
  PaymentGateway,
} from "../types"
import { gatewayFormErrors, parseGatewayError } from "../lib/gateway-errors"
import { GatewayErrorAlert } from "./gateway-error-alert"
import { CopyButton } from "./copy-button"

interface GatewayFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present = edit, absent = add. */
  gateway: PaymentGateway | null
  providers: GatewayProvider[]
  providersSource: DataSource
  source: DataSource
  /** Providers that already have a gateway (fallback allows one each). */
  configuredProviders: string[]
}

interface FormField {
  field: string
  label: string
  secret: boolean
  required: boolean
  placeholder: string | null
  isSet: boolean
  maskedValue: string | null
  value: string | null
}

const EMPTY: GatewayFormValues = {
  provider: "",
  displayName: "",
  environment: "LIVE",
  isEnabled: true,
  credentials: {},
}

export function GatewayFormDialog({
  open,
  onOpenChange,
  gateway,
  providers,
  providersSource,
  source,
  configuredProviders,
}: GatewayFormDialogProps) {
  const isEdit = gateway !== null
  const isFallback = source === "fallback"
  const create = useCreatePaymentGateway()
  const update = useUpdatePaymentGateway()
  const isSaving = create.isPending || update.isPending

  // Kept in state (mirrored into the form) because the resolver's schema
  // depends on the provider, and must exist before useForm is called.
  const [providerSlug, setProviderSlug] = useState("")
  // Server errors that don't belong to a rendered field (unknown provider,
  // unknown credential key, isEnabled, non-422 failures).
  const [formErrors, setFormErrors] = useState<string[]>([])
  // 409 GATEWAY_IN_USE: saving with Enabled off while the gateway is assigned.
  const [inUse, setInUse] = useState<GatewayInUseDetails | null>(null)
  const provider = providers.find((p) => p.provider === providerSlug)

  // The provider's credential fields, merged with what the gateway has on
  // file (edit). Extra stored fields the catalog doesn't list come last.
  const fields = useMemo<FormField[]>(() => {
    const catalogFields = (provider?.credentialFields ?? []).map((f) => {
      const current = gateway?.credentials.find((c) => c.field === f.field)
      return {
        field: f.field,
        label: f.label,
        secret: f.secret || !!current?.secret,
        required: f.required,
        placeholder: f.placeholder ?? null,
        isSet: current?.isSet ?? false,
        maskedValue: current?.maskedValue ?? null,
        value: current?.value ?? null,
      }
    })
    const known = new Set(catalogFields.map((f) => f.field))
    const extra = (gateway?.credentials ?? [])
      .filter((c) => !known.has(c.field))
      .map((c) => ({
        field: c.field,
        label: c.label,
        secret: c.secret,
        required: false,
        placeholder: null,
        isSet: c.isSet,
        maskedValue: c.maskedValue,
        value: c.value,
      }))
    return [...catalogFields, ...extra]
  }, [provider, gateway])

  const schema = useMemo(
    () =>
      buildGatewayFormSchema(
        fields
          .filter((f) => f.required)
          .map((f) => ({ field: f.field, label: f.label, isSet: f.isSet }))
      ),
    [fields]
  )

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    control,
    formState: { errors },
  } = useForm<GatewayFormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  })
  const selectedProvider = providerSlug
  const environment = useWatch({ control, name: "environment" })
  const isEnabled = useWatch({ control, name: "isEnabled" })

  useEffect(() => {
    if (!open) return
    const initial: GatewayFormValues = gateway
      ? {
          provider: gateway.provider,
          displayName: gateway.displayName,
          environment: gateway.environment,
          isEnabled: gateway.isEnabled,
          credentials: Object.fromEntries(
            gateway.credentials.map((c) => [
              c.field,
              c.secret ? "" : (c.value ?? ""),
            ])
          ),
        }
      : EMPTY
    reset(initial)
    setProviderSlug(initial.provider)
    setFormErrors([])
    setInUse(null)
    create.reset()
    update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open, gateway])

  const pickProvider = (slug: string) => {
    const p = providers.find((x) => x.provider === slug)
    setProviderSlug(slug)
    setValue("provider", slug, { shouldValidate: true })
    setValue("credentials", {})
    if (p) {
      setValue("displayName", isFallback ? `${p.name} (from Settings)` : p.name)
    }
  }

  const onSubmit = async (values: GatewayFormValues) => {
    setFormErrors([])
    setInUse(null)
    try {
      if (gateway) {
        const saved = await update.mutateAsync({
          id: gateway.id,
          provider: gateway.provider,
          payload: {
            displayName: values.displayName,
            environment: values.environment,
            isEnabled: values.isEnabled,
            credentials: values.credentials,
          },
          // A plain (non-secret) field that had a value and is now blank was
          // emptied on purpose; the server clears it when sent "".
          clearKeys: gateway.credentials
            .filter(
              (c) =>
                !c.secret &&
                (c.value ?? "") !== "" &&
                !(values.credentials[c.field] ?? "").trim()
            )
            .map((c) => c.field),
        })
        toast.success(
          saved
            ? "Gateway updated"
            : "Credentials saved to Settings (the server reads them from there today)"
        )
      } else {
        const saved = await create.mutateAsync(values)
        toast.success(
          saved
            ? "Gateway added"
            : "Credentials saved to Settings. The gateway will show up here once they load."
        )
      }
      onOpenChange(false)
    } catch (err) {
      if (!(err instanceof Error)) {
        setFormErrors(["Couldn't save the gateway"])
        return
      }
      const inUseDetails = parseGatewayError(err).inUse
      if (inUseDetails) {
        setInUse(inUseDetails)
        setFormErrors(["Can't disable this gateway while it's in use:"])
        return
      }
      // 422 `errors.credentials.<key>` lands on that credential's input;
      // everything else is listed in the alert above the form fields.
      const mapped = gatewayFormErrors(
        err,
        fields.map((f) => f.field)
      )
      for (const f of mapped.fields)
        setError(f.name, { type: "server", message: f.message })
      setFormErrors(
        mapped.form.length > 0 || mapped.fields.length > 0
          ? mapped.form
          : ["Couldn't save the gateway"]
      )
    }
  }

  const providerDisabledReason = (p: GatewayProvider): string | null => {
    if (!isFallback || isEdit) return null
    return configuredProviders.includes(p.provider)
      ? "already configured, edit it instead"
      : null
  }

  const fallbackNoteId = "gateway-form-fallback-note"

  return (
    <Dialog open={open} onOpenChange={(o) => !isSaving && onOpenChange(o)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit gateway" : "Add gateway"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Blank secret fields keep the current value."
              : "Pick a provider, then enter its credentials."}
          </DialogDescription>
        </DialogHeader>

        <form
          id="gateway-form"
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          {formErrors.length > 0 && (
            <GatewayErrorAlert
              message={
                formErrors.length === 1
                  ? formErrors[0]
                  : "The server rejected this gateway:"
              }
              items={formErrors.length > 1 ? formErrors : undefined}
              inUse={inUse}
              action="disable"
            />
          )}

          {isFallback && (
            <div
              id={fallbackNoteId}
              role="note"
              className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
            >
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                The gateway API isn&apos;t on the server yet. Credentials are
                saved to Settings (<code>{"<provider>_<field>"}</code> rows),
                which is what the server reads today. Display name, environment
                and enabled can&apos;t be stored until the backend ships
                sandbox/payment-routing.
              </span>
            </div>
          )}

          {/* Provider */}
          <div className="space-y-1.5">
            <Label htmlFor="gateway-provider">Provider</Label>
            <Select
              value={selectedProvider}
              onValueChange={pickProvider}
              disabled={isEdit}
            >
              <SelectTrigger
                id="gateway-provider"
                className="w-full"
                aria-invalid={!!errors.provider}
              >
                <SelectValue placeholder="Select a provider…" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => {
                  const reason = providerDisabledReason(p)
                  return (
                    <SelectItem
                      key={p.provider}
                      value={p.provider}
                      disabled={reason !== null}
                    >
                      {p.name}
                      {reason ? ` (${reason})` : ""}
                      {!p.serverSupported ? " · no server client yet" : ""}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {errors.provider && (
              <p className="text-xs text-destructive">
                {errors.provider.message}
              </p>
            )}
            {providersSource === "fallback" && !isEdit && (
              <p className="text-xs text-muted-foreground">
                Provider list is the portal&apos;s built-in fallback catalog
                (the server&apos;s catalog isn&apos;t available yet).
              </p>
            )}
          </div>

          {provider && !provider.serverSupported && (
            <div
              role="note"
              className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>
                The server has no {provider.name} client yet. Keys will be
                saved, but payments can&apos;t route to it until the backend
                ships it.
              </span>
            </div>
          )}

          {selectedProvider && (
            <>
              {/* Display name */}
              <div className="space-y-1.5">
                <Label htmlFor="gateway-display-name">Display name</Label>
                <Input
                  id="gateway-display-name"
                  placeholder="e.g. Credo — Part-Time"
                  autoComplete="off"
                  disabled={isFallback}
                  aria-invalid={!!errors.displayName}
                  aria-describedby={isFallback ? fallbackNoteId : undefined}
                  {...register("displayName")}
                />
                {errors.displayName && (
                  <p className="text-xs text-destructive">
                    {errors.displayName.message}
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="gateway-environment">Environment</Label>
                  <Select
                    value={environment}
                    onValueChange={(v) =>
                      setValue("environment", v as GatewayEnvironment)
                    }
                    disabled={isFallback}
                  >
                    <SelectTrigger id="gateway-environment" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LIVE">Live</SelectItem>
                      <SelectItem value="TEST">Test</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gateway-enabled">Enabled</Label>
                  <div className="flex h-9 items-center">
                    <Switch
                      id="gateway-enabled"
                      checked={isEnabled}
                      onCheckedChange={(v) => setValue("isEnabled", v)}
                      disabled={isFallback}
                    />
                  </div>
                </div>
              </div>

              {/* Credentials */}
              <fieldset className="space-y-3 rounded-xl border border-border p-4">
                <legend className="px-1 text-xs font-semibold text-muted-foreground">
                  Credentials
                </legend>
                {fields.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    This provider has no credential fields.
                  </p>
                )}
                {fields.map((f) => {
                  const id = `gateway-cred-${f.field}`
                  const hintId = `${id}-hint`
                  const error = errors.credentials?.[f.field]?.message
                  const keepHint = f.secret && f.isSet
                  return (
                    <div key={f.field} className="space-y-1.5">
                      <Label htmlFor={id}>
                        {f.label}
                        {f.required && !f.isSet && (
                          <span className="text-destructive" aria-hidden="true">
                            {" "}
                            *
                          </span>
                        )}
                      </Label>
                      <Input
                        id={id}
                        type={f.secret ? "password" : "text"}
                        autoComplete={f.secret ? "new-password" : "off"}
                        placeholder={
                          keepHint
                            ? "Leave blank to keep the current value"
                            : (f.placeholder ?? "")
                        }
                        aria-invalid={!!error}
                        aria-required={f.required && !f.isSet}
                        aria-describedby={keepHint ? hintId : undefined}
                        {...register(`credentials.${f.field}`)}
                      />
                      {keepHint && (
                        <p
                          id={hintId}
                          className="text-xs text-muted-foreground"
                        >
                          Current:{" "}
                          <span className="font-mono text-foreground">
                            {f.maskedValue ?? "••••"}
                          </span>
                          . Secret: it can be replaced but is never shown.
                        </p>
                      )}
                      {error && (
                        <p className="text-xs text-destructive">{error}</p>
                      )}
                    </div>
                  )
                })}
              </fieldset>

              {/* Webhook URL — server-computed from the gateway's own id,
                  never an editable credential, but shown here (not just on
                  the display card) so it's visible side-by-side while
                  entering the matching value on the provider's own
                  dashboard. */}
              {isEdit && gateway && (
                <div className="space-y-1.5">
                  <Label>Webhook URL</Label>
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 py-1 pr-1 pl-2.5">
                    <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                      {gateway.webhookUrl}
                    </code>
                    <CopyButton
                      value={gateway.webhookUrl}
                      label={`${gateway.displayName} webhook URL`}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Set on {provider?.name ?? "the provider"}&apos;s own
                    dashboard — this app only tells you the URL, it can&apos;t
                    be changed here.
                  </p>
                </div>
              )}
            </>
          )}
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button type="submit" form="gateway-form" disabled={isSaving}>
            {isSaving && (
              <Loader2
                className="animate-spin"
                data-icon="inline-start"
                aria-hidden="true"
              />
            )}
            {isEdit ? "Save changes" : "Add gateway"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
