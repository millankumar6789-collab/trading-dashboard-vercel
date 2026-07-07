import { NextResponse } from "next/server";
import { SOURCES, TIMEFRAMES } from "@/lib/data_sources";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    sources: SOURCES,
    timeframes: TIMEFRAMES,
  });
}