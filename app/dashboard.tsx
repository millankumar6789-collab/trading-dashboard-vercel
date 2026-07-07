"use client";

/**
 * Dashboard — main client component.
 *
 * Architecture mirrors the local Flask/HTML dashboard:
 *   - Grid auto-arranges based on user-selected pane count (1, 2, 4, 6, 8)
 *   - Each pane is independent: own symbol, timeframe, chart, data feed
 *   - Ticker strip flashes green/red on price changes
 *   - Pane count + per-pane config persisted in localStorage
 *
 * Data layer:
 *   - Hyperliquid: client connects DIRECTLY to Hyperliquid's WebSocket
 *     (no proxy needed — public API, saves Vercel serverless invocations)
 *   - yfinance: fetches via /api/candles (Next.js server-side proxy running
 *     on Vercel's nodejs runtime)
 */

import { useEffect, useState } from "react";
import Pane from "./Pane";
import { SOURCES, Timeframe } from "@/lib/data_sources";

function makeDefaultPanes(count: number): PaneState[] {
  const symbols = SOURCES.hyperliquid.symbols;
  const initial: PaneState[] = [];
  for (let i = 0; i < count; i++) {
    initial.push({
      id: i,
      source: "hyperliquid",
      symbol: symbols[i % symbols.length],
      timeframe: "1m",
    });
  }
  return initial;
}

interface PaneConfig {
  source: string;
  symbol: string;
  timeframe: Timeframe;
}

export interface PaneState extends PaneConfig {
  id: number;
}

export default function Dashboard() {
  const [paneCount, setPaneCount] = useState<number>(4);
  const [panes, setPanes] = useState<PaneState[]>(() => {
    // Hydration-safe defaults — we update from localStorage in useEffect
    return makeDefaultPanes(4);
  });
  const [hydrated, setHydrated] = useState(false);

  // Load config from localStorage on mount
  useEffect(() => {
    try {
      const savedCount = parseInt(localStorage.getItem("dashboard-panes") || "4", 10);
      const validCount = [1, 2, 4, 6, 8].includes(savedCount) ? savedCount : 4;
      const savedConfigRaw = localStorage.getItem("dashboard-pane-config");
      const savedConfig: PaneConfig[] = savedConfigRaw
        ? JSON.parse(savedConfigRaw)
        : [];

      setPaneCount(validCount);

      const initial: PaneState[] = [];
      for (let i = 0; i < validCount; i++) {
        const saved = savedConfig[i] || {};
        const sourceKey = SOURCES[saved.source ?? ""] ? saved.source : "hyperliquid";
        const feed = SOURCES[sourceKey];
        const symbol =
          saved.symbol && feed.symbols.includes(saved.symbol)
            ? saved.symbol
            : feed.symbols[0];
        const timeframe: Timeframe = saved.timeframe || feed.defaultTimeframe;

        initial.push({
          id: i,
          source: sourceKey,
          symbol,
          timeframe,
        });
      }
      setPanes(initial);
    } catch (err) {
      console.warn("Failed to load saved config:", err);
    }
    setHydrated(true);
  }, []);

  // Persist pane configuration
  useEffect(() => {
    if (!hydrated) return;
    try {
      const config = panes.map((p) => ({
        source: p.source,
        symbol: p.symbol,
        timeframe: p.timeframe,
      }));
      localStorage.setItem("dashboard-pane-config", JSON.stringify(config));
    } catch {}
  }, [panes, hydrated]);

  // Update pane (called from <Pane> when dropdowns change)
  const updatePane = (id: number, patch: Partial<PaneConfig>) => {
    setPanes((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  // Pane count change → rebuild the panes array with sensible defaults
  const changePaneCount = (count: number) => {
    setPaneCount(count);
    localStorage.setItem("dashboard-panes", String(count));

    setPanes((prev) => {
      const next: PaneState[] = [];
      for (let i = 0; i < count; i++) {
        if (i < prev.length) {
          next.push(prev[i]);
        } else {
          // New pane — pick a different default symbol than existing panes for variety
          const sourceKey = count > 4 ? "yfinance" : "hyperliquid";
          const feed = SOURCES[sourceKey];
          next.push({
            id: i,
            source: sourceKey,
            symbol: feed.symbols[i % feed.symbols.length],
            timeframe: feed.defaultTimeframe,
          });
        }
      }
      return next;
    });
  };

  if (!hydrated) {
    return <div className="page-loading">Loading dashboard…</div>;
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">📊 Trading Dashboard</div>
        <div className="topbar-center">
          <span className="label">Panes:</span>
          <div className="grid-selector">
            {[1, 2, 4, 6, 8].map((n) => (
              <button
                key={n}
                className={`grid-btn ${paneCount === n ? "active" : ""}`}
                onClick={() => changePaneCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="topbar-right">
          <span className="label" style={{ display: "none" }} id="presence-hint">
            Live data
          </span>
        </div>
      </div>

      <div className={`grid-container grid-${paneCount}`}>
        {panes.map((p) => (
          <Pane key={p.id} pane={p} onChange={(patch) => updatePane(p.id, patch)} />
        ))}
      </div>
    </>
  );
}
