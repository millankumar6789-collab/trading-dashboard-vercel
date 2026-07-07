/**
 * /api/candles/[source]/[symbol]
 *
 * Server-side REST proxy for yfinance. Runs on Vercel's nodejs runtime
 * (NOT edge — edge intercepts outbound fetches and returns redirects).
 *
 * For yfinance sources, fetches historical candles via yfinance and
 * returns them as JSON. For WebSocket-type sources (hyperliquid),
 * the browser connects directly to Hyperliquid — no proxy needed.
 */

import { NextRequest, NextResponse } from "next/server";
import { SOURCES, YF_INTERVAL_MAP, YF_PERIOD_MAP, Timeframe } from "@/lib/data_sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ source: string; symbol: string }> }
) {
  const { source, symbol } = await ctx.params;
  const tf = (req.nextUrl.searchParams.get("tf") || "1d") as Timeframe;
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "500", 10);
  const since = parseFloat(
    req.nextUrl.searchParams.get("since") || String(Date.now() / 1000 - 7 * 86400)
  );

  if (!SOURCES[source]) {
    return NextResponse.json({ error: `Unknown source: ${source}` }, { status: 404 });
  }

  if (source !== "yfinance") {
    return NextResponse.json(
      { error: "REST polling only supported for yfinance. Use WebSocket directly." },
      { status: 400 }
    );
  }

  try {
    // Dynamic import to avoid bundling yfinance for client builds
    const yf = await import("yfinance");
    const yfInterval = YF_INTERVAL_MAP[tf];
    const yfPeriod = YF_PERIOD_MAP[tf];

    const ticker = new yf.Ticker(symbol);
    const df = await ticker.history({ period: yfPeriod, interval: yfInterval });

    if (!df || df.isEmpty || df.isEmpty()) {
      return NextResponse.json({
        source,
        symbol,
        timeframe: tf,
        candles: [],
        last_price: null,
      });
    }

    const candles = [];
    const dates = df.index.toArray();
    for (let i = 0; i < dates.length; i++) {
      const d = new Date(dates[i] as any);
      const ts = d.getTime() / 1000;
      if (ts < since) continue;

      const openVal = df.Open?.[i];
      const highVal = df.High?.[i];
      const lowVal = df.Low?.[i];
      const closeVal = df.Close?.[i];
      const volVal = df.Volume?.[i];

      // Skip rows where any OHLC value is NaN/missing (incomplete bars)
      if (
        openVal == null || isNaN(Number(openVal)) ||
        highVal == null || isNaN(Number(highVal)) ||
        lowVal == null || isNaN(Number(lowVal)) ||
        closeVal == null || isNaN(Number(closeVal))
      ) {
        continue;
      }

      candles.push({
        time: Math.floor(ts),
        open: round(Number(openVal)),
        high: round(Number(highVal)),
        low: round(Number(lowVal)),
        close: round(Number(closeVal)),
        volume: volVal != null && !isNaN(Number(volVal)) ? round(Number(volVal)) : 0,
      });
    }

    candles.sort((a, b) => a.time - b.time);
    const trimmed = candles.slice(-limit);

    // last_price: most recent valid close
    let lastPrice: number | null = null;
    for (let i = trimmed.length - 1; i >= 0; i--) {
      if (trimmed[i].close != null) {
        lastPrice = trimmed[i].close;
        break;
      }
    }

    return NextResponse.json({
      source,
      symbol,
      timeframe: tf,
      candles: trimmed,
      last_price: lastPrice,
    });
  } catch (err: any) {
    return NextResponse.json({
      source,
      symbol,
      timeframe: tf,
      candles: [],
      last_price: null,
      error: String(err?.message || err),
    });
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}