import { NextResponse } from "next/server";
import { fetchDirectExport } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

// Admin only. Every direct betting record as a CSV file that opens in Excel.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) {
    return unauthorized();
  }
  try {
    const csv = await fetchDirectExport();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="goalbrew-direct-betting-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
