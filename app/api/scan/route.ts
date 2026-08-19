import { NextResponse } from "next/server";
import { runScan } from "@/lib/upstox";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ status: "error", message: "UPSTOX_ACCESS_TOKEN is not configured" }, { status: 500 });
  }

  try {
    const result = await runScan(token);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("scanner_error", error);
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "Unknown scanner error" },
      { status: 502 }
    );
  }
}
