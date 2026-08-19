const rows = [
  { symbol: "LIVE FEED", score: "--", rvol: "--", change: "--", vwap: "WAIT", breakout: "WAIT", signal: "CONNECT UPSTOX" }
];

export default function Home() {
  return (
    <main className="shell">
      <header className="header">
        <div>
          <h1 className="title">Intraday Winner Scanner</h1>
          <p className="subtitle">NSE F&O • 5-minute engine • Volume + VWAP + momentum + relative strength</p>
        </div>
        <div className="status"><span className="dot" /> Scanner engine ready</div>
      </header>

      <section className="stats">
        <div className="card"><div className="label">Market</div><div className="value">NSE</div></div>
        <div className="card"><div className="label">Universe</div><div className="value">F&amp;O</div></div>
        <div className="card"><div className="label">Timeframe</div><div className="value">5 min</div></div>
        <div className="card"><div className="label">Data</div><div className="value">Upstox</div></div>
      </section>

      <section className="panel">
        <div className="panelHead">
          <h2 className="panelTitle">Live Winner Candidates</h2>
          <span className="badge">AWAITING LIVE FEED</span>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr><th>Stock</th><th>Score</th><th>RVOL</th><th>Change</th><th>VWAP</th><th>Breakout</th><th>Signal</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.symbol}>
                  <td className="symbol">{row.symbol}</td>
                  <td className="score">{row.score}</td>
                  <td>{row.rvol}</td>
                  <td className="green">{row.change}</td>
                  <td className="muted">{row.vwap}</td>
                  <td className="muted">{row.breakout}</td>
                  <td>{row.signal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
