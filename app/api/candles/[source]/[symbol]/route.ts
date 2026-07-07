/**
 * /api/candles/[source]/[symbol]
 *
 * Server-side REST proxy. Runs on Vercel's nodejs runtime.
 * For yfinance: fetches via Yahoo Finance public chart API.
 */

import { NextRequest, NextResponse } from "next/server";
import { Timeframe } from "@/lib/data_sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YF_INTERVAL_MAP: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "1h", // 4h unsupported by Yahoo
  "1d": "1d",
  "1w": "1wk",
};

const YF_PERIOD_MAP: Record<Timeframe, string> = {
  "1m": "7d",
  "5m": "1mo",
  "15m": "1mo",
  "1h": "3mo",
  "4h": "3mo",
  "1d": "6mo",
  "1w": "2y",
};

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
      };
    }>;
    error: any;
  };
}

async function fetchYahooFinance(symbol: string, timeframe: Timeframe, since: number, limit: number): Promise<{ candles: any[]; last_price: number | null }> {
  const interval = YF_INTERVAL_MAP[timeframe] || "1d";
  const range = YF_PERIOD_MAP[timeframe] || "6mo";

  // Yahoo Finance chart API: query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval={interval}&range={range}
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    return { candles: [], last_price: null };
  }

  const data: YahooChartResponse = await res.json();

  if (!data.chart?.result?.[0]) {
    return { candles: [], last_price: null };
  }

  const result = data.chart.result[0];
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0];

  if (!quote) {
    return { candles: [], last_price: null };
  }

  const candles: any[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    const v = quote.volume?.[i];

    if (ts < since) continue;
    if (o == null || h == null || l == null || c == null) continue;

    candles.push({
      time: ts,
      open: round(o),
      high: round(h),
      low: round(l),
      close: round(c),
      volume: v != null ? round(v) : 0,
    });
  }

  const trimmed = candles.slice(-limit);
  let lastPrice: number | null = null;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (trimmed[i].close != null) {
      lastPrice = trimmed[i].close;
      break;
    }
  }

  return { candles: trimmed, last_price: lastPrice };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ source: string; symbol: string }> }
) {
  const { source, symbol } = await params;
  const tf = (req.nextUrl.searchParams.get("tf") || "1d") as Timeframe;
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "500", 10);
  const since = parseFloat(
    req.nextUrl.searchParams.get("since") || String(Date.now() / 1000 - 7 * 86400)
  );

  if (source !== "yfinance") {
    return NextResponse.json(
      { error: "REST polling only supported for yfinance. Use WebSocket for hyperliquid." },
      { status: 400 }
    );
  }

  try {
    const result = await fetchYahooFinance(symbol, tf, since, limit);
    return NextResponse.json({
      source,
      symbol,
      timeframe: tf,
      candles: result.candles,
      last_price: result.last_price,
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
