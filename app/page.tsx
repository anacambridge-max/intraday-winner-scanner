"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  symbol: string;
  score: number;
  rvol: number;
  volumeAcceleration: number;
  change: number;
  vwapGap: number;
  relativeStrength: number;
  breakout: boolean;
  ema9: number;
  ema20: number;
  rsi: number;
  price: number;
};

type ScanResponse = {
  status: string;
  source?: string;
  universe?: number;
  analyzed?: number;
  niftyChange?: number;
  generatedAt?: string;
  rows?: Row[];
  message?: string;
  diagnostics?: {
    candleSuccess?: number;
    candleFailures?: number;
    tooFewCandles?: number;
    lastFailure?: string;
  };
};

function fmt(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

export default function Home() {
  const [data, setData] = useState<ScanResponse>({ status: "connecting" });
  const [loading, setLoading] = useState(true);

  const scan = useCallback(async () => {
    try {
      const response = await fetch(`/api/scan?t=${Date.now()}`, { cache: "no-store" });
      const json = await response.json();
      setData(json);
    } catch (error) {
      setData({ status: "error", message: error instanceof Error ? error.message : "Network error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    scan();
    const timer = window.setInterval(scan, 15000);
    return () => window.clearInterval(timer);
  }, [scan]);

  const live = data.status === "live";
  const rows = data.rows ?? [];
  const success = data.diagnostics?.candleSuccess ?? 0;
  const failures = data.diagnostics?.candleFailures ?? 0;

  return (
    <main className="shell">
      <header className="header">
        <div>
          <h1 className="title">Intraday Winner Scanner</h1>
          <p className="subtitle">NSE F&amp;O • live Upstox • 5-min RVOL + VWAP + EMA + RSI + breakout + relative strength</p>
        </div>
        <div className="status">
          <span className={`dot ${live ? "liveDot" : ""}`} />
          {loading ? "Connecting…" : live ? "LIVE • Upstox connected" : "Feed error"}
        </div>
      </header>

      <section className="stats">
        <div className="card"><div className="label">Market</div><div className="value">NSE</div></div>
        <div className="card"><div className="label">F&amp;O Universe</div><div className="value">{data.universe ?? "--"}</div></div>
        <div className="card"><div className="label">5-min Analyzed</div><div className="value">{data.analyzed ?? "--"}</div></div>
        <div className="card"><div className="label">NIFTY</div><div className="value">{data.niftyChange != null ? `${data.niftyChange >= 0 ? "+" : ""}${fmt(data.niftyChange)}%` : "--"}</div></div>
      </section>

      {!live && data.message && (
        <section className="errorPanel"><strong>Scanner connection:</strong> {data.message}</section>
      )}

      <section className="panel">
        <div className="panelHead">
          <div>
            <h2 className="panelTitle">Live Winner Candidates</h2>
            <div className="panelHint">5-min candle engine • RVOL vs prior 20 candles • volume acceleration • VWAP • EMA 9/20 • RSI 14 • breakout • RS vs NIFTY</div>
          </div>
          <span className={`badge ${live ? "badgeLive" : ""}`}>{live ? "LIVE FEED" : "WAITING"}</span>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>#</th><th>Stock</th><th>Score</th><th>RVOL</th><th>Vol Accel</th><th>Change</th><th>VWAP</th><th>RS</th><th>RSI</th><th>EMA</th><th>Breakout</th><th>Signal</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={12} className="empty">{live ? "No qualified candidate in this refresh." : "Waiting for Upstox market data…"}</td></tr>
              ) : rows.map((row, index) => (
                <tr key={row.symbol}>
                  <td className="rank">{index + 1}</td>
                  <td className="symbol">{row.symbol}</td>
                  <td className="score">{row.score}</td>
                  <td>{fmt(row.rvol)}x</td>
                  <td>{fmt(row.volumeAcceleration)}x</td>
                  <td className={row.change >= 0 ? "green" : "red"}>{row.change >= 0 ? "+" : ""}{fmt(row.change)}%</td>
                  <td className={row.vwapGap >= 0 ? "green" : "red"}>{row.vwapGap >= 0 ? "+" : ""}{fmt(row.vwapGap)}%</td>
                  <td className={row.relativeStrength >= 0 ? "green" : "red"}>{row.relativeStrength >= 0 ? "+" : ""}{fmt(row.relativeStrength)}%</td>
                  <td>{fmt(row.rsi, 1)}</td>
                  <td>{row.ema9 >= row.ema20 ? <span className="yes">9&gt;20</span> : <span className="muted">9&lt;20</span>}</td>
                  <td>{row.breakout ? <span className="yes">YES</span> : <span className="muted">—</span>}</td>
                  <td><span className={`signal ${row.score >= 85 ? "strong" : row.score >= 70 ? "watch" : "neutral"}`}>{row.score >= 85 ? "A+ SETUP" : row.score >= 70 ? "A SETUP" : "EARLY"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="footerLine">
        Candle health: {success}/{data.analyzed ?? 0} successful{failures ? ` • ${failures} failed` : ""} · Last update: {data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString("en-IN") : "—"} · Scanner is a research tool, not an execution signal.
      </div>
      {data.diagnostics?.lastFailure && (
        <div className="footerLine">Last candle API issue: {data.diagnostics.lastFailure}</div>
      )}
    </main>
  );
}
