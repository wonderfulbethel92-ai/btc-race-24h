// agent-fun/bars-replay/v1 bot shim for Node 22
import * as readline from 'node:readline';

export const BPS = 10_000n;

export type U64 = bigint | string;

export interface Bar {
  symbol: string;
  t: number;
  o: U64;
  h: U64;
  l: U64;
  c: U64;
  v: U64 | null;
  o_depth: U64[];
  c_depth: U64[];
}

export interface Position {
  symbol: string;
  qty: U64;
  cost_quote_units: U64;
}

export interface Account {
  cash_quote_units: U64;
  positions: Position[];
  equity_quote_units: U64;
}

export interface BarsState {
  account: Account;
  // other fields exist but not needed for basic use
}

export interface BuyInput {
  side: 'buy';
  symbol: string;
  notional_quote_units: U64 | number | string;
  max_slippage_bps: number;
  client_id?: string;
}

export interface SellInput {
  side: 'sell';
  symbol: string;
  qty: U64 | number | string;
  max_slippage_bps: number;
  client_id?: string;
}

export type OrderInput = BuyInput | SellInput;

export async function runBars(opts: {
  onBatch(state: BarsState, batch: { bars: Bar[]; seq: number }): Promise<OrderInput[]> | OrderInput[];
}): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let state: BarsState = { account: { cash_quote_units: 1_000_000_000n, positions: [], equity_quote_units: 1_000_000_000n } };

  for await (const line of rl) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.type === 'batch') {
      const orders = await opts.onBatch(state, msg);
      const reply = {
        type: 'reply',
        seq: msg.seq,
        orders: (orders || []).map((o, i) => ({
          ...o,
          client_id: o.client_id ?? `o${msg.seq}-${i}`,
        })),
      };
      console.log(JSON.stringify(reply));
      // update state roughly from fills if present
      if (msg.account) state.account = msg.account;
    } else if (msg.type === 'done') {
      break;
    }
  }
}
