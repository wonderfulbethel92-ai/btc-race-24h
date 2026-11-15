// EMA crossover bot for make.fun BTC race (long only)
import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 8;
const SLOW_BARS = 21;
const ROI = [3n, 2n] as const;     // 50% profit target
const STOP = [4n, 5n] as const;    // 20% stop loss
const MAX_SLIPPAGE_BPS = 100;

interface Ema {
  sum: bigint;
  count: number;
  value: number | null;
  prev: number | null;
}

const emas = new Map<string, { fast: Ema; slow: Ema }>();

function updateEma(ema: Ema, close: number, span: number): number {
  if (ema.value === null) {
    ema.sum += BigInt(Math.round(close));
    ema.count++;
    if (ema.count >= span) {
      ema.value = Number(ema.sum) / ema.count;
    }
    return ema.value ?? close;
  }
  const k = 2 / (span + 1);
  ema.prev = ema.value;
  ema.value = ema.value * (1 - k) + close * k;
  return ema.value;
}

await runBars({
  async onBatch(state: BarsState, batch: { bars: Bar[] }) {
    const orders: (BuyInput | SellInput)[] = [];
    const symbol = 'CBBTC';
    const bar = batch.bars.find(b => b.symbol === symbol);
    if (!bar) return orders;

    const close = Number(bar.c) / 1e6; // USDC scale
    if (!emas.has(symbol)) {
      emas.set(symbol, {
        fast: { sum: 0n, count: 0, value: null, prev: null },
        slow: { sum: 0n, count: 0, value: null, prev: null },
      });
    }
    const e = emas.get(symbol)!;
    const fast = updateEma(e.fast, close, FAST_BARS);
    const slow = updateEma(e.slow, close, SLOW_BARS);

    const pos = state.account.positions.find(p => p.symbol === symbol);
    const hasPosition = !!pos;

    // Entry
    if (!hasPosition && e.fast.prev !== null && e.slow.prev !== null &&
        e.fast.prev <= e.slow.prev && fast > slow) {
      const stake = state.account.cash_quote_units / 2n;
      if (stake > 10_000_000n) { // min notional-ish
        orders.push({
          side: 'buy',
          symbol,
          notional_quote_units: stake,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        });
      }
    }

    // Exit
    if (hasPosition && pos) {
      const cost = Number(pos.cost_quote_units) / 1e6;
      const value = Number(pos.qty) * close / 1e8; // rough
      const pnl = value / cost;
      if ((e.slow.prev !== null && e.fast.prev !== null && e.slow.prev <= e.fast.prev && slow > fast) ||
          pnl >= 1.5 || pnl <= 0.8) {
        orders.push({
          side: 'sell',
          symbol,
          qty: pos.qty,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        });
      }
    }

    return orders;
  },
});
