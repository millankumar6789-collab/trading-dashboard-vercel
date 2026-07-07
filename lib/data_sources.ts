/**
 * data_sources.ts — Pluggable data abstraction layer.
 *
 * Mirrors the data_source.py module so the same plug-and-play architecture
 * exists on both local Flask and Vercel Next.js deployments.
 *
 * To add a new broker/exchange (Alpaca, Binance, Zerodha, Polygon, etc.):
 *   1. Add a DataFeed implementation (REST or WebSocket).
 *   2. Register it in the SOURCES map below.
 *   3. The frontend auto-discovers it via /api/sources — no other changes.
 */

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

export interface Candle {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DataFeed {
  name: string;
  symbols: string[];
  defaultTimeframe: Timeframe;
  type: "websocket" | "rest_poll";
}

// ──────────────────────────────────────────────
// Hyperliquid (WebSocket — crypto)
// ──────────────────────────────────────────────

export const HL_SYMBOLS = [
  "BTC", "ETH", "SOL", "ARB", "DOGE", "LINK", "MATIC",
  "AVAX", "ATOM", "INJ", "TIA", "OP", "RNDR",
  "WIF", "PEPE", "SUI", "SEI",
];

// ──────────────────────────────────────────────
// yfinance / NSE (REST poll — Indian equities)
// ──────────────────────────────────────────────

export const NSE_SYMBOLS = [
  "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
  "ITC.NS", "BHARTIARTL.NS", "SBIN.NS", "TATAMOTORS.NS", "MARUTI.NS",
  "LT.NS", "HINDUNILVR.NS", "BAJFINANCE.NS", "WIPRO.NS", "AXISBANK.NS",
  "TATASTEEL.NS", "NTPC.NS", "ADANIENT.NS", "ADANIPORTS.NS", "POWERGRID.NS",
];

// ──────────────────────────────────────────────
// Source registry
// ──────────────────────────────────────────────

export const SOURCES: Record<string, DataFeed> = {
  hyperliquid: {
    name: "Hyperliquid (Crypto)",
    symbols: HL_SYMBOLS,
    defaultTimeframe: "1m",
    type: "websocket",
  },
  yfinance: {
    name: "Yahoo Finance (NSE)",
    symbols: NSE_SYMBOLS,
    defaultTimeframe: "1d",
    type: "rest_poll",
  },
};

export const TIMEFRAMES: Array<{ value: Timeframe; label: string }> = [
  { value: "1m", label: "1 Minute" },
  { value: "5m", label: "5 Minutes" },
  { value: "15m", label: "15 Minutes" },
  { value: "1h", label: "1 Hour" },
  { value: "4h", label: "4 Hours" },
  { value: "1d", label: "1 Day" },
  { value: "1w", label: "1 Week" },
];

// ──────────────────────────────────────────────
// yfinance interval/period mapping (TS mirror of Python)
// ──────────────────────────────────────────────

export const YF_INTERVAL_MAP: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "1h",       // 4h unsupported by yfinance — fall back to 1h
  "1d": "1d",
  "1w": "1wk",
};

export const YF_PERIOD_MAP: Record<Timeframe, string> = {
  "1m": "7d",
  "5m": "1mo",
  "15m": "1mo",
  "1h": "3mo",
  "4h": "3mo",
  "1d": "6mo",
  "1w": "2y",
};