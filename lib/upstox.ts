import { gunzipSync } from "zlib";

const INSTRUMENT_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
const API = "https://api.upstox.com";

export type Instrument = {
  segment: string;
  instrument_type: string;
  instrument_key: string;
  trading_symbol: string;
  underlying_key?: string;
  underlying_symbol?: string;
  expiry?: number;
};

export type ScanRow = {
  symbol: string;
  score: number;
  rvol: number;
  change: number;
  vwapGap: number;
  breakout: boolean;
  relativeStrength: number;
  volumeRatio: number;
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

async function getFnoUniverse(): Promise<Instrument[]> {
  if (cachedUniverse && cachedUniverse.expires > Date.now()) return cachedUniverse.instruments;

  const response = await fetch(INSTRUMENT_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Instrument master failed: ${response.status}`);
  const compressed = Buffer.from(await response.arrayBuffer());
  const json = gunzipSync(compressed).toString("utf8");
  const all = JSON.parse(json) as Instrument[];

  const now = Date.now();
  const futures = all
    .filter((x) => x.segment === "NSE_FO" && x.instrument_type === "FUT" && x.underlying_key)
    .filter((x) => !x.expiry || x.expiry >= now)
    .sort((a, b) => (a.expiry ?? 0) - (b.expiry ?? 0));

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

function scoreRow(change: number, volumeRatio: number, vwapGap: number, rangePosition: number, breakout: boolean, relativeStrength: number) {
  const momentumScore = clamp((change + 0.5) / 3.5 * 25);
  const volumeScore = clamp((volumeRatio - 0.7) / 2.8 * 25);
  const vwapScore = clamp((vwapGap + 0.1) / 1.1 * 15);
  const trendScore = clamp((rangePosition - 0.45) / 0.55 * 15);
  const breakoutScore = breakout ? 10 : 0;
  const rsScore = clamp((relativeStrength + 1) / 3 * 10);
  return Math.round(momentumScore + volumeScore + vwapScore + trendScore + breakoutScore + rsScore);
}

export async function runScan(token: string) {
  const universe = await getFnoUniverse();
  const symbols = universe.slice(0, 500);
  const instrumentKeys = symbols.map((x) => x.instrument_key);
  const niftyKey = "NSE_INDEX|Nifty 50";
  const keys = [...instrumentKeys, niftyKey];
  const encoded = encodeURIComponent(keys.join(","));

  const [quotes, ohlc] = await Promise.all([
    fetchJson(`${API}/v2/market-quote/quotes?instrument_key=${encoded}`, token),
    fetchJson(`${API}/v3/market-quote/ohlc?instrument_key=${encoded}&interval=1d`, token),
  ]);

  const quoteMap = new Map<string, any>();
  for (const value of Object.values(quotes.data ?? {}) as any[]) {
    if (value?.instrument_token) quoteMap.set(value.instrument_token, value);
  }

  const ohlcMap = new Map<string, any>();
  for (const value of Object.values(ohlc.data ?? {}) as any[]) {
    if (value?.instrument_token) ohlcMap.set(value.instrument_token, value);
  }

  const niftyQuote = quoteMap.get(niftyKey);
  const niftyClose = Number(niftyQuote?.ohlc?.close ?? 0);
  const niftyChange = niftyQuote?.last_price && niftyClose > 0
    ? ((Number(niftyQuote.last_price) / niftyClose) - 1) * 100
    : 0;

  const rows: ScanRow[] = [];
  for (const instrument of symbols) {
    const q = quoteMap.get(instrument.instrument_key);
    const h = ohlcMap.get(instrument.instrument_key);
    if (!q?.last_price) continue;

    const price = Number(q.last_price);
    const cp = Number(q.ohlc?.close ?? 0);
    const change = cp > 0 ? (price / cp - 1) * 100 : 0;
    const avgPrice = Number(q.average_price ?? 0);
    const vwapGap = avgPrice > 0 ? (price / avgPrice - 1) * 100 : 0;
    const live = h?.live_ohlc;
    const previous = h?.prev_ohlc;
    const dayHigh = Number(live?.high ?? q.ohlc?.high ?? price);
    const dayLow = Number(live?.low ?? q.ohlc?.low ?? price);
    const rangePosition = dayHigh > dayLow ? (price - dayLow) / (dayHigh - dayLow) : 0.5;
    const currentVolume = Number(q.volume ?? live?.volume ?? 0);
    const previousVolume = Number(previous?.volume ?? 0);
    const volumeRatio = previousVolume > 0 ? currentVolume / previousVolume : 0;
    const breakout = Number(previous?.high ?? 0) > 0 && price >= Number(previous.high);
    const relativeStrength = change - niftyChange;

    // Quality gate: don't flood the dashboard with random low-momentum names.
    if (change < 0.15 && volumeRatio < 1.25) continue;

    const score = scoreRow(change, volumeRatio, vwapGap, rangePosition, breakout, relativeStrength);
    rows.push({
      symbol: instrument.trading_symbol,
      score,
      rvol: Number(volumeRatio.toFixed(2)),
      change: Number(change.toFixed(2)),
      vwapGap: Number(vwapGap.toFixed(2)),
      breakout,
      relativeStrength: Number(relativeStrength.toFixed(2)),
      volumeRatio: Number(volumeRatio.toFixed(2)),
      price: Number(price.toFixed(2)),
    });
  }

  rows.sort((a, b) => b.score - a.score || b.change - a.change || b.volumeRatio - a.volumeRatio);
  return {
    status: "live",
    source: "Upstox",
    universe: symbols.length,
    niftyChange: Number(niftyChange.toFixed(2)),
    generatedAt: new Date().toISOString(),
    rows: rows.slice(0, 15),
  };
}
