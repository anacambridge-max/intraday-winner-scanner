import { gunzipSync } from "zlib";

const INSTRUMENT_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
const API = "https://api.upstox.com";
const NIFTY_KEY = "NSE_INDEX|Nifty 50";
const MAX_UNIVERSE = 214;
const MAX_CANDIDATES = 30;

export type Instrument = {
  segment: string;
  instrument_type: string;
  instrument_key: string;
  trading_symbol: string;
  underlying_key?: string;
  underlying_symbol?: string;
  underlying_type?: string;
  expiry?: number | string;
};

type Candle = [string, number, number, number, number, number, number];

export type ScanRow = {
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

let cachedUniverse: { expires: number; instruments: Instrument[] } | null = null;

function authHeaders(token: string) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function expiryMs(value: number | string | undefined) {
  if (value == null) return 0;
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getFnoUniverse(): Promise<Instrument[]> {
  if (cachedUniverse && cachedUniverse.expires > Date.now()) return cachedUniverse.instruments;

  const response = await fetch(INSTRUMENT_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Instrument master failed: ${response.status}`);
  const compressed = Buffer.from(await response.arrayBuffer());
  const all = JSON.parse(gunzipSync(compressed).toString("utf8")) as Instrument[];

  // Upstox's current BOD JSON identifies stock futures with NSE_FO + FUT and
  // underlying_type=EQUITY. We map the nearest non-expired future to its NSE_EQ key.
  const futures = all
    .filter(
      (x) =>
        x.segment === "NSE_FO" &&
        x.instrument_type === "FUT" &&
        x.underlying_type === "EQUITY" &&
        Boolean(x.underlying_key),
    )
    .filter((x) => expiryMs(x.expiry) === 0 || expiryMs(x.expiry) >= Date.now())
    .sort((a, b) => expiryMs(a.expiry) - expiryMs(b.expiry));

  const seen = new Set<string>();
  const universe: Instrument[] = [];
  for (const future of futures) {
    if (!future.underlying_key || seen.has(future.underlying_key)) continue;
    seen.add(future.underlying_key);
    universe.push({
      segment: "NSE_EQ",
      instrument_type: "EQ",
      instrument_key: future.underlying_key,
      trading_symbol: future.underlying_symbol ?? future.trading_symbol.split(" ")[0],
    });
  }

  if (universe.length < 150) {
    throw new Error(`F&O universe unexpectedly small: ${universe.length}`);
  }

  cachedUniverse = { expires: Date.now() + 6 * 60 * 60 * 1000, instruments: universe };
  return universe;
}

async function fetchJson(url: string, token: string) {
  const response = await fetch(url, { headers: authHeaders(token), cache: "no-store" });
  const body = await response.text();
  if (!response.ok) throw new Error(`Upstox ${response.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function ema(values: number[], period: number) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i++) result = values[i] * k + result * (1 - k);
  return result;
}

function rsi(values: number[], period = 14) {
  if (values.length < 2) return 50;
  const start = Math.max(1, values.length - period);
  let gains = 0;
  let losses = 0;
  for (let i = start; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const count = values.length - start || 1;
  const avgGain = gains / count;
  const avgLoss = losses / count;
  if (avgLoss === 0) return avgGain > 0 ? 100 : 50;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function metrics(candles: Candle[]) {
  const ordered = [...candles].sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
  const closes = ordered.map((c) => Number(c[4]));
  const latest = ordered[ordered.length - 1];
  const previous = ordered.slice(0, -1);
  const price = Number(latest[4]);

  const latestStart = Date.parse(latest[0]);
  const now = Date.now();
  const elapsedFraction = Number.isFinite(latestStart)
    ? clamp((now - latestStart) / 300_000, 0.20, 1)
    : 1;
  const latestVolume = Number(latest[5]);

  const priorVolumes = previous.slice(-20).map((c) => Number(c[5])).filter((v) => v > 0);
  const avg20Volume = priorVolumes.length ? priorVolumes.reduce((a, b) => a + b, 0) / priorVolumes.length : 0;
  // Normalize the live, partially formed 5-min candle by elapsed time. This prevents
  // a 1-minute-old candle from looking artificially weak versus completed candles.
  const expectedPartial20 = avg20Volume * elapsedFraction;
  const rvol = expectedPartial20 > 0 ? latestVolume / expectedPartial20 : 0;

  const prior5 = previous.slice(-5).map((c) => Number(c[5])).filter((v) => v > 0);
  const avg5Volume = prior5.length ? prior5.reduce((a, b) => a + b, 0) / prior5.length : 0;
  const expectedPartial5 = avg5Volume * elapsedFraction;
  const volumeAcceleration = expectedPartial5 > 0 ? latestVolume / expectedPartial5 : 0;

  let pv = 0;
  let vol = 0;
  for (const c of ordered) {
    const typical = (Number(c[2]) + Number(c[3]) + Number(c[4])) / 3;
    const v = Number(c[5]);
    pv += typical * v;
    vol += v;
  }
  const vwap = vol > 0 ? pv / vol : price;

  const completed = previous.slice(-6);
  const recentBreakoutHigh = completed.length ? Math.max(...completed.map((c) => Number(c[2]))) : -Infinity;
  const breakout = completed.length >= 3 && price > recentBreakoutHigh;

  return {
    price,
    rvol,
    volumeAcceleration,
    vwapGap: vwap > 0 ? (price / vwap - 1) * 100 : 0,
    breakout,
    ema9: ema(closes, 9),
    ema20: ema(closes, 20),
    rsi: rsi(closes, 14),
    candleCount: ordered.length,
  };
}

function scoreRow(m: ReturnType<typeof metrics>, change: number, relativeStrength: number) {
  const volumeScore = clamp((m.rvol - 1) / 5.5 * 25);
  const accelerationScore = clamp((m.volumeAcceleration - 1) / 3 * 10);
  const momentumScore = clamp((change + 0.10) / 2.90 * 20);
  const vwapScore = clamp((m.vwapGap + 0.40) / 1.60 * 15);
  const trendScore = m.ema9 >= m.ema20 ? 10 : 0;
  const breakoutScore = m.breakout ? 10 : 0;
  const rsScore = clamp((relativeStrength + 0.25) / 2.25 * 10);
  const rsiBonus = m.rsi >= 55 && m.rsi <= 78 ? 5 : 0;
  return Math.round(clamp(volumeScore + accelerationScore + momentumScore + vwapScore + trendScore + breakoutScore + rsScore + rsiBonus));
}

export async function runScan(token: string) {
  const universe = await getFnoUniverse();
  const symbols = universe.slice(0, MAX_UNIVERSE);
  const instrumentKeys = symbols.map((x) => x.instrument_key);
  const encoded = encodeURIComponent([...instrumentKeys, NIFTY_KEY].join(","));

  // Full Market Quotes supports up to 500 instrument keys in one request, so the
  // complete 214-stock F&O universe can be ranked before requesting candles. citeturn0search0
  const quotes = await fetchJson(`${API}/v2/market-quote/quotes?instrument_key=${encoded}`, token);
  const quoteMap = new Map<string, any>();
  for (const [key, value] of Object.entries(quotes.data ?? {}) as [string, any][]) {
    if (!value) continue;
    if (value.instrument_token) quoteMap.set(value.instrument_token, value);
    quoteMap.set(key.replace(":", "|"), value);
  }

  const nifty = quoteMap.get(NIFTY_KEY);
  const niftyClose = Number(nifty?.ohlc?.close ?? 0);
  const niftyChange = nifty?.last_price && niftyClose > 0 ? (Number(nifty.last_price) / niftyClose - 1) * 100 : 0;

  // Never choose stocks because they are already the top gainers. Use a broad,
  // liquid candidate pool and let 5-min volume/price action determine the rank.
  const candidates = symbols
    .map((instrument) => {
      const q = quoteMap.get(instrument.instrument_key);
      if (!q?.last_price) return null;
      const close = Number(q.ohlc?.close ?? 0);
      const change = close > 0 ? (Number(q.last_price) / close - 1) * 100 : 0;
      const tradedValue = Number(q.volume ?? 0) * Number(q.last_price ?? 0);
      return { instrument, change, tradedValue };
    })
    .filter((x): x is { instrument: Instrument; change: number; tradedValue: number } => Boolean(x))
    .filter((x) => x.change >= -1.0)
    .sort((a, b) => b.tradedValue - a.tradedValue || b.change - a.change)
    .slice(0, MAX_CANDIDATES);

  const rows: ScanRow[] = [];
  let candleSuccess = 0;
  let candleFailures = 0;
  let tooFewCandles = 0;
  let lastFailure = "";

  const queue = [...candidates];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      const { instrument, change } = item;
      try {
        const key = encodeURIComponent(instrument.instrument_key);
        // Upstox V3 explicitly supports 5-minute intraday candles with OHLC + volume. citeturn0search2turn0search3
        const data = await fetchJson(`${API}/v3/historical-candle/intraday/${key}/minutes/5`, token);
        const candles = (data.data?.candles ?? []) as Candle[];
        if (candles.length < 5) {
          tooFewCandles++;
          continue;
        }

        candleSuccess++;
        const m = metrics(candles);
        const relativeStrength = change - niftyChange;
        const score = scoreRow(m, change, relativeStrength);

        // Early-quality gate: it can catch a developing move, but it must have
        // unusual volume/acceleration or a fresh breakout plus price structure.
        const qualifies =
          change >= 0.05 &&
          m.price >= m.ema20 * 0.985 &&
          m.vwapGap >= -0.55 &&
          (m.rvol >= 1.10 || m.volumeAcceleration >= 1.20 || m.breakout) &&
          relativeStrength >= -0.35 &&
          m.rsi >= 48 &&
          m.rsi <= 82 &&
          score >= 40;

        if (!qualifies) continue;

        rows.push({
          symbol: instrument.trading_symbol,
          score,
          rvol: Number(m.rvol.toFixed(2)),
          volumeAcceleration: Number(m.volumeAcceleration.toFixed(2)),
          change: Number(change.toFixed(2)),
          vwapGap: Number(m.vwapGap.toFixed(2)),
          relativeStrength: Number(relativeStrength.toFixed(2)),
          breakout: m.breakout,
          ema9: Number(m.ema9.toFixed(2)),
          ema20: Number(m.ema20.toFixed(2)),
          rsi: Number(m.rsi.toFixed(1)),
          price: Number(m.price.toFixed(2)),
        });
      } catch (error) {
        candleFailures++;
        if (!lastFailure) lastFailure = error instanceof Error ? error.message : "Unknown candle error";
      }
    }
  });

  await Promise.all(workers);
  rows.sort((a, b) => b.score - a.score || b.rvol - a.rvol || b.change - a.change);

  return {
    status: "live",
    source: "Upstox",
    universe: symbols.length,
    analyzed: candidates.length,
    niftyChange: Number(niftyChange.toFixed(2)),
    generatedAt: new Date().toISOString(),
    rows: rows.slice(0, 15),
    diagnostics: {
      candleSuccess,
      candleFailures,
      tooFewCandles,
      lastFailure: lastFailure || undefined,
    },
  };
}
