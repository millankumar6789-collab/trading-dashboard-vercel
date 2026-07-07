"use client";

/**
 * Pane.tsx — single chart pane with independent controls.
 *
 * Features:
 *   - Lightweight Charts v5 candlestick series (imperative ref)
 *   - Hyperliquid WebSocket for crypto (client → hyperliquid directly)
 *   - yfinance via /api/candles REST (Next.js serverless proxy)
 *   - Green/red ticker strip flash on price changes
 *   - Resize observer for responsive chart sizing
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
} from "lightweight-charts";
import { SOURCES, Timeframe, Candle } from "@/lib/data_sources";
import { PaneState } from "./dashboard";

interface PaneProps {
  pane: PaneState;
  onChange: (patch: Partial<PaneState>) => void;
}

export default function Pane({ pane, onChange }: PaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPriceRef = useRef<number | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tickerClass, setTickerClass] = useState<string>("");
  const [priceDisplay, setPriceDisplay] = useState<string>("--");
  const [changeDisplay, setChangeDisplay] = useState<string>("--");

  // ── Chart initialisation ──
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const chart = createChart(el, {
      layout: {
        background: { type: 1, color: "#161b22" },
        textColor: "#8b949e",
      },
      grid: {
        vertLines: { color: "#21262d" },
        horzLines: { color: "#21262d" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#30363d" },
      timeScale: {
        borderColor: "#30363d",
        timeVisible: true,
        secondsVisible: pane.timeframe === "1m",
      },
      width: el.clientWidth,
      height: el.clientHeight,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderDownColor: "#ef4444",
      borderUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      wickUpColor: "#22c55e",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      chart.resize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // ── Data feed lifecycle ──
  useEffect(() => {
    if (!chartRef.current) return;

    seriesRef.current?.setData([]);
    lastPriceRef.current = null;
    prevPriceRef.current = null;

    // Clear old feeds
    killFeeds();

    if (pane.source === "hyperliquid") {
      connectHyperliquid(pane.symbol, pane.timeframe);
    } else if (pane.source === "yfinance") {
      pollYFinance(pane.symbol, pane.timeframe);
    }

    return () => {
      killFeeds();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.source, pane.symbol, pane.timeframe]);

  // ── Hyperliquid WebSocket feed (client → HL directly) ──
  function connectHyperliquid(symbol: string, timeframe: Timeframe) {
    const intervalSec: Record<Timeframe, number> = {
      "1m": 60, "5m": 300, "15m": 900,
      "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800,
    };
    const sec = intervalSec[timeframe] || 60;

    const ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "trades", coin: symbol }));
    };

    let currentInterval: number | null = null;
    let bucket: Array<{ ts: number; price: number; size: number }> = [];

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.channel !== "trades" || !msg.data) return;

      msg.data.forEach((trade: any) => {
        const price = parseFloat(trade.px);
        const size = parseFloat(trade.sz);
        const ts = trade.time / 1e9;
        const intervalStart = Math.floor(ts / sec) * sec;

        if (currentInterval === null) {
          currentInterval = intervalStart;
          bucket = [{ ts, price, size }];
        } else if (intervalStart === currentInterval) {
          bucket.push({ ts, price, size });
        } else if (intervalStart > currentInterval) {
          emitCandle(bucket, currentInterval);
          currentInterval = intervalStart;
          bucket = [{ ts, price, size }];
        }
      });
    };

    ws.onclose = () => {
      reconnectTimerRef.current = setTimeout(() => {
        connectHyperliquid(symbol, timeframe);
      }, 3000);
    };

    ws.onerror = () => ws.close();

    function emitCandle(trades: typeof bucket, interval: number) {
      if (!trades.length) return;
      const prices = trades.map((t) => t.price);
      const candle: Candle = {
        time: interval,
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1],
        volume: trades.reduce((sum, t) => sum + t.size, 0),
      };
      seriesRef.current?.update(candle as any);
      updateTicker(candle.close, candle);
    }
  }

  // ── yfinance REST polling feed (proxied through /api/candles) ──
  async function pollYFinance(symbol: string, timeframe: Timeframe) {
    let lastTs = Date.now() / 1000 - 7 * 86400;

    const poll = async () => {
      try {
        const qs = new URLSearchParams({
          tf: timeframe,
          since: String(lastTs),
          limit: "500",
        });
        const resp = await fetch(`/api/candles/yfinance/${encodeURIComponent(symbol)}?${qs}`);
        const data = await resp.json();

        if (data.candles?.length) {
          for (const c of data.candles) {
            if (c.time > lastTs) {
              lastTs = c.time;
              const candle: Candle = {
                time: c.time,
                open: c.open ?? c.close,
                high: c.high ?? c.close,
                low: c.low ?? c.close,
                close: c.close,
                volume: c.volume ?? 0,
              };
              seriesRef.current?.update(candle as any);
              updateTicker(candle.close, candle);
            }
          }
        }
      } catch (e) {
        // ignore poll errors — next interval will retry
      }
    };

    await poll();

    const intervalMs = ["1m", "5m"].includes(timeframe) ? 15000 : 30000;
    pollTimerRef.current = setInterval(poll, intervalMs);
  }

  // ── Kill all active feeds ──
  function killFeeds() {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  // ── Ticker update (green/red flash) ──
  const updateTicker = useCallback((price: number, candle: Candle) => {
    if (price === null || isNaN(price)) return;

    prevPriceRef.current = lastPriceRef.current;
    lastPriceRef.current = price;

    // Flash
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }
    setTickerClass("");

    requestAnimationFrame(() => {
      const prev = prevPriceRef.current;
      if (prev !== null && price !== prev) {
        if (price > prev) setTickerClass("uptick ticker-flash");
        else if (price < prev) setTickerClass("downtick ticker-flash");
      }
      flashTimerRef.current = setTimeout(() => setTickerClass(""), 1500);
    });

    // Format price display
    const decimals = price > 100 ? 2 : price > 1 ? 4 : 6;
    setPriceDisplay(price.toFixed(decimals));

    // Change %
    if (candle && candle.open) {
      const changePct = ((price - candle.open) / candle.open) * 100;
      const sign = changePct >= 0 ? "+" : "";
      setChangeDisplay(`${sign}${changePct.toFixed(2)}%`);
    }
  }, []);

  // ── Dropdown handlers ──
  const handleSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSource = e.target.value;
    const feed = SOURCES[newSource];
    onChange({
      source: newSource,
      symbol: feed.symbols[0],
      timeframe: feed.defaultTimeframe as Timeframe,
    });
  };

  // ── Render ──
  const feed = SOURCES[pane.source];
  const isYFinance = pane.source === "yfinance";

  return (
    <div className="pane">
      <div className="pane-header">
        <div className="pane-header-left">
          <select
            className="pane-select"
            value={pane.source}
            onChange={handleSourceChange}
          >
            {Object.entries(SOURCES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name}
              </option>
            ))}
          </select>

          <select
            className="pane-select"
            value={pane.symbol}
            onChange={(e) => onChange({ symbol: e.target.value })}
          >
            {feed.symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            className="pane-select"
            value={pane.timeframe}
            onChange={(e) => onChange({ timeframe: e.target.value as Timeframe })}
          >
            {[
              { k: "1m", v: "1 Minute" },
              { k: "5m", v: "5 Minutes" },
              { k: "15m", v: "15 Minutes" },
              { k: "1h", v: "1 Hour" },
              { k: "4h", v: "4 Hours" },
              { k: "1d", v: "1 Day" },
              { k: "1w", v: "1 Week" },
            ].map((t) => (
              <option key={t.k} value={t.k}>
                {t.v}
              </option>
            ))}
          </select>
        </div>
        <div className="pane-header-right">
          <span className={`source-badge ${isYFinance ? "yfinance" : ""}`}>
            {feed.name}
          </span>
        </div>
      </div>

      <div className={`ticker-strip ${tickerClass}`}>
        <span className="price">{priceDisplay}</span>
        <span className="change" style={{ color: tickerClass.includes("uptick") ? "var(--green)" : tickerClass.includes("downtick") ? "var(--red)" : undefined }}>
          {changeDisplay}
        </span>
      </div>

      <div ref={containerRef} className="chart-container" />
    </div>
  );
}
