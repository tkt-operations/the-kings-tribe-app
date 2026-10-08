import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { groupByPeriod, type Period } from "@/lib/analytics";
import { toCsv } from "@/lib/csv";
import { loadRequisitionItemRows, loadRequisitionRows, loadServiceData } from "@/lib/data/reports";
import { getChurchSettings } from "@/lib/data/settings";
import { requisitionItemsCsv, requisitionsCsv } from "@/lib/report-csv";
import { isIsoDate } from "@/lib/dates";
import { centsToDecimal } from "@/lib/money";

const PERIODS: Period[] = ["week", "month", "quarter", "year"];

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!user.permissions.has("reports.view")) return new NextResponse("Forbidden", { status: 403 });

  const sp = request.nextUrl.searchParams;
  const type = sp.get("type");
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const period = (PERIODS.includes(sp.get("period") as Period) ? sp.get("period") : "week") as Period;
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new NextResponse("Invalid date range", { status: 400 });

  let csv: string;
  if (type === "attendance" || type === "finance") {
    const allowed = type === "attendance" ? user.permissions.has("attendance.view") : user.permissions.has("finance.view");
    if (!allowed) return new NextResponse("Forbidden", { status: 403 });
    const data = await loadServiceData(from, to);
    const rows = groupByPeriod(data.points, period);
    if (type === "attendance") {
      const cats = data.attendanceCategories;
      csv = toCsv(
        ["Period start", "Services", ...cats.map((c) => c.name), "Total attendance"],
        rows.map((r) => [r.period, r.services, ...cats.map((c) => r.attendance.get(c.id) ?? 0), r.attendanceTotal]),
      );
    } else {
      const cats = data.financeCategories;
      csv = toCsv(
        ["Period start", "Services", ...cats.map((c) => c.name), "Total finance received"],
        rows.map((r) => [r.period, r.services, ...cats.map((c) => ({ number: centsToDecimal(r.finance.get(c.id) ?? 0n) })), { number: centsToDecimal(r.financeTotal) }]),
      );
    }
  } else if (type === "requisitions") {
    if (!user.permissions.has("requisitions.view")) return new NextResponse("Forbidden", { status: 403 });
    csv = requisitionsCsv(await loadRequisitionRows(from, to), (await getChurchSettings())?.timezone ?? "UTC");
  } else if (type === "requisition-items") {
    if (!user.permissions.has("requisitions.view")) return new NextResponse("Forbidden", { status: 403 });
    csv = requisitionItemsCsv(await loadRequisitionItemRows(from, to), (await getChurchSettings())?.timezone ?? "UTC");
  } else {
    return new NextResponse("Unknown report", { status: 400 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tkt-${type}-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

