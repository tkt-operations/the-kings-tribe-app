"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { CalendarDays, Check, MessageSquarePlus, Users, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FieldError, Input, RequiredNote } from "@/components/ui/field";
import { focusFirstInvalidSoon, REVIEW_FIELDS_MESSAGE } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { useAction } from "@/components/ui/use-action";
import { formatDate } from "@/lib/dates";
import { formatCents, parseMoney } from "@/lib/money";
import { saveSundayEntry } from "./actions";

export interface FinanceRowModel {
  key: string;
  categoryId: string;
  subcategoryId: string | null;
  label: string;
  groupLabel: string | null;
  allowsNegative: boolean;
  archived: boolean;
  amount: string;
  notes: string;
  isGroupHeader: boolean;
}

interface AttendanceRowModel {
  categoryId: string;
  name: string;
  archived: boolean;
  value: string;
}

interface FormValues {
  attendance: { category_id: string; count: string }[];
  finance: { category_id: string; subcategory_id: string | null; amount: string; notes: string }[];
}

export function SundayEntryForm(props: {
  serviceDate: string;
  serviceName: string;
  maxDate: string;
  currency: string;
  canAttendance: boolean;
  canFinance: boolean;
  attendanceRows: AttendanceRowModel[];
  financeRows: FinanceRowModel[];
  isExisting: boolean;
  canManageCategories: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const { pending, run } = useAction();
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [serviceNameError, setServiceNameError] = useState<string | null>(null);
  const [openNotes, setOpenNotes] = useState<Set<string>>(() => new Set(props.financeRows.filter((r) => r.notes).map((r) => r.key)));
  const [serviceName, setServiceName] = useState(props.serviceName);

  const { register, control, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: {
      attendance: props.attendanceRows.map((r) => ({ category_id: r.categoryId, count: r.value })),
      finance: props.financeRows.map((r) => ({ category_id: r.categoryId, subcategory_id: r.subcategoryId, amount: r.amount, notes: r.notes })),
    },
  });
  const attendance = useWatch({ control, name: "attendance" });
  const finance = useWatch({ control, name: "finance" });

  const attendanceTotal = useMemo(
    () => (attendance ?? []).reduce((sum, a) => sum + (/^\d+$/.test(a.count ?? "") ? Number(a.count) : 0), 0),
    [attendance],
  );
  const financeTotal = useMemo(() => {
    let cents = 0n;
    for (const [i, f] of (finance ?? []).entries()) {
      const parsed = parseMoney(f.amount, { allowNegative: props.financeRows[i]?.allowsNegative });
      if (parsed !== null) cents += parsed;
    }
    return cents;
  }, [finance, props.financeRows]);

  function navigate(date: string, name: string) {
    const params = new URLSearchParams({ date });
    if (name && name !== "Sunday Service") params.set("service", name);
    router.push(`/sunday?${params.toString()}`);
  }

  const save = (values: FormValues) => {
    if (!serviceName.trim()) {
      setServiceNameError("Service name is required.");
      toast.error(REVIEW_FIELDS_MESSAGE);
      focusFirstInvalidSoon(formRef.current);
      return;
    }
    setResult(null);
    run(
      () =>
        saveSundayEntry({
          service_date: props.serviceDate,
          service_name: props.serviceName,
          attendance: props.canAttendance ? values.attendance : undefined,
          finance: props.canFinance ? values.finance : undefined,
        }),
      {
        successMessage: "Sunday report saved successfully.",
        errorMessage: "Unable to save the Sunday report. Please try again.",
        onSuccess: () => setResult({ tone: "success", text: "Sunday report saved successfully." }),
        onError: (error) => setResult({ tone: "error", text: error }),
      },
    );
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) =>
    handleSubmit(save, () => {
      toast.error(REVIEW_FIELDS_MESSAGE);
      focusFirstInvalidSoon(formRef.current);
    })(event);

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-busy={pending || undefined}>
      <RequiredNote className="mb-3 px-1" />
      {/* Service selector */}
      <Card className="mb-6">
        <CardBody className="grid gap-4 pt-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:pt-6">
          <Field label="Service date" htmlFor="service_date" required>
            <div className="relative">
              <Input
                id="service_date"
                type="date"
                value={props.serviceDate}
                max={props.maxDate}
                onChange={(e) => e.target.value && navigate(e.target.value, props.serviceName)}
                className="pl-11"
              />
              <CalendarDays className="pointer-events-none absolute left-3.5 top-3.5 size-5 text-navy/50" aria-hidden />
            </div>
          </Field>
          <Field label="Service" htmlFor="service_name" required error={serviceNameError}>
            <Input
              id="service_name"
              value={serviceName}
              maxLength={80}
              onChange={(e) => { setServiceName(e.target.value); setServiceNameError(null); }}
              onBlur={() => serviceName.trim() && serviceName.trim() !== props.serviceName && navigate(props.serviceDate, serviceName.trim())}
              list="service-names"
            />
            <datalist id="service-names">
              <option value="Sunday Service" />
              <option value="Special Service" />
            </datalist>
          </Field>
          <div className="flex items-center gap-2 sm:pb-3">
            {props.isExisting ? <Badge tone="info">Editing saved entry</Badge> : <Badge>New entry</Badge>}
          </div>
          <p className="text-sm text-navy/60 sm:col-span-3">{formatDate(props.serviceDate, "long")}</p>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {props.canAttendance ? (
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><Users className="size-5 text-ministry-blue" aria-hidden /> Attendance</span>}
              description="Headcount per category."
              action={props.canManageCategories ? <Link href="/categories?type=attendance" className="text-sm font-medium underline decoration-gold decoration-2 underline-offset-4">Categories</Link> : null}
            />
            <CardBody className="space-y-3">
              {props.attendanceRows.length === 0 ? <p className="text-sm text-navy/60">No attendance categories are active.</p> : null}
              {props.attendanceRows.map((row, i) => {
                const countError = formState.errors.attendance?.[i]?.count?.message;
                return (
                <div key={row.categoryId}>
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor={`att-${row.categoryId}`} className="min-w-0 flex-1 text-[15px] font-medium">
                    {row.name}
                    {row.archived ? <span className="ml-2 text-xs text-navy/50">(archived)</span> : null}
                  </label>
                  <div className="w-32 shrink-0">
                  <Input
                    id={`att-${row.categoryId}`}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    placeholder="0"
                    className="tabular text-right text-lg"
                    {...register(`attendance.${i}.count`, { pattern: { value: /^\s*\d{0,7}\s*$/, message: `Enter a whole number for ${row.name}.` } })}
                    aria-invalid={countError ? true : undefined}
                    aria-describedby={countError ? `att-${row.categoryId}-error` : undefined}
                  />
                  </div>
                </div>
                <FieldError id={`att-${row.categoryId}-error`} message={countError} className="justify-end" />
                </div>
                );
              })}
              <div className="mt-2 flex items-center justify-between rounded-2xl bg-navy px-4 py-3 text-white">
                <span className="text-sm font-medium text-white/75">Total attendance</span>
                <span className="tabular font-serif text-3xl text-gold">{attendanceTotal.toLocaleString()}</span>
              </div>
            </CardBody>
          </Card>
        ) : null}

        {props.canFinance ? (
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><Wallet className="size-5 text-kingdom-green" aria-hidden /> Finance received</span>}
              description={`Amounts in ${props.currency}. Leave blank if nothing was received.`}
              action={props.canManageCategories ? <Link href="/categories?type=finance" className="text-sm font-medium underline decoration-gold decoration-2 underline-offset-4">Categories</Link> : null}
            />
            <CardBody className="space-y-3">
              {props.financeRows.length === 0 ? <p className="text-sm text-navy/60">No finance categories are active.</p> : null}
              {props.financeRows.map((row, i) => {
                const amount = finance?.[i]?.amount ?? "";
                const invalid = amount !== "" && parseMoney(amount, { allowNegative: row.allowsNegative }) === null;
                return (
                  <div key={row.key} className={row.subcategoryId ? "pl-4 sm:pl-6" : undefined}>
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor={`fin-${row.key}`} className="min-w-0 flex-1 text-[15px] font-medium">
                        {row.subcategoryId ? <span className="text-navy/45">↳ </span> : null}
                        {row.isGroupHeader ? `${row.label} (general)` : row.label}
                        {row.allowsNegative ? <span className="ml-2 text-xs text-navy/50">adjustment</span> : null}
                        {row.archived ? <span className="ml-2 text-xs text-navy/50">(archived)</span> : null}
                      </label>
                      <button
                        type="button"
                        className="flex size-11 items-center justify-center rounded-xl text-navy/50 hover:bg-navy/5 hover:text-navy"
                        aria-label={`Add a note for ${row.label}`}
                        onClick={() => setOpenNotes((prev) => new Set(prev).add(row.key))}
                      >
                        <MessageSquarePlus className="size-5" aria-hidden />
                      </button>
                      <div className="relative w-36 shrink-0 sm:w-40">
                        <span className="pointer-events-none absolute left-3.5 top-3 text-lg text-navy/40" aria-hidden>$</span>
                        <Input
                          id={`fin-${row.key}`}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0.00"
                          className="tabular pl-7 text-right text-lg"
                          aria-invalid={invalid ? true : undefined}
                          aria-describedby={invalid ? `fin-${row.key}-error` : undefined}
                          {...register(`finance.${i}.amount`, {
                            validate: (value) => value.trim() === "" || parseMoney(value, { allowNegative: row.allowsNegative }) !== null || "invalid",
                          })}
                        />
                      </div>
                    </div>
                    <FieldError id={`fin-${row.key}-error`} className="justify-end" message={invalid ? `Enter an amount like 125.50${row.allowsNegative ? " or -10.00" : ""}.` : null} />
                    {openNotes.has(row.key) ? (
                      <Input placeholder="Note (optional)" maxLength={1000} className="mt-2 h-11" {...register(`finance.${i}.notes`)} aria-label={`Note for ${row.label}`} />
                    ) : null}
                  </div>
                );
              })}
              <div className="mt-2 flex items-center justify-between rounded-2xl bg-navy px-4 py-3 text-white">
                <span className="text-sm font-medium text-white/75">Total finance received</span>
                <span className="tabular font-serif text-3xl text-gold">{formatCents(financeTotal, props.currency)}</span>
              </div>
            </CardBody>
          </Card>
        ) : null}
      </div>

      {/* Sticky save bar */}
      <div className="sticky bottom-[calc(4.25rem+var(--safe-bottom))] z-20 mt-6 lg:bottom-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-navy/10 bg-white/95 p-3 shadow-lg shadow-navy/10 backdrop-blur">
          <div className="min-w-0 flex-1 px-1 text-sm">
            {result ? (
              <span className="flex items-center gap-2 font-medium" role="status">
                {result.tone === "success" ? <Check className="size-4 text-kingdom-green" aria-hidden /> : <span className="size-2 rounded-full bg-energy-orange" aria-hidden />}
                {result.text}
              </span>
            ) : (
              <span className="text-navy/60">Totals are recalculated by the server when you save.</span>
            )}
          </div>
          <LoadingButton type="submit" variant="gold" size="lg" pending={pending} pendingLabel="Saving…" className="w-full sm:w-auto">
            Save Sunday entry
          </LoadingButton>
        </div>
      </div>
      {result?.tone === "error" ? <Alert tone="error" className="mt-4">{result.text}</Alert> : null}
    </form>
  );
}
