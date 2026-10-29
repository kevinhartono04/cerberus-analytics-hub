import { AsyncLocalStorage } from "node:async_hooks";

type Transfer = { operation: string; readBytes: number; reads: number; immutable: Map<string, {payload:string;expiresAt?:string}>; cacheBytes: number };
const context = new AsyncLocalStorage<Transfer>();
const CACHE_LIMIT = 32 * 1024 * 1024;
const READ_LIMIT = 256 * 1024 * 1024;
export const SENSE_RUN_READ_LIMIT = 1024 * 1024 * 1024;
export function senseReadBytes() { return context.getStore()?.readBytes ?? 0; }

/** Per invocation only: mutable checkpoints and controls are never cached. */
export async function measureSenseTransfer<T>(operation: string, work: () => Promise<T>): Promise<T> {
  if (context.getStore()) return work();
  const transfer: Transfer = { operation, readBytes: 0, reads: 0, immutable: new Map(), cacheBytes: 0 };
  return context.run(transfer, async () => {
    try { return await work(); }
    finally { console.info("[ludios-sense]", JSON.stringify({event:"database_transfer", operation, readBytes:transfer.readBytes, reads:transfer.reads})); }
  });
}

export function countSenseRead(payload: string) {
  const transfer = context.getStore();
  if (!transfer) return;
  transfer.readBytes += Buffer.byteLength(payload);
  transfer.reads++;
  // Bounds subsequent application reads; this is payload accounting, not billed wire bytes.
  if (transfer.readBytes > READ_LIMIT) throw new Error("Sense database transfer budget reached; pause and review this run.");
}

export function cachedSensePage(key: string) {
  const transfer=context.getStore(),entry=transfer?.immutable.get(key);
  if(entry?.expiresAt && entry.expiresAt<=new Date().toISOString()){
    transfer!.immutable.delete(key);transfer!.cacheBytes-=Buffer.byteLength(entry.payload);return undefined;
  }
  return entry?.payload;
}
export function rememberSensePage(key: string, payload: string, expiresAt?:string) {
  const transfer = context.getStore();
  if (!transfer || !/^sense:(page:v4|games:v4|blob:v4|chart-blob:v4):[a-f0-9]{64}$/.test(key)) return;
  if (transfer.immutable.has(key)) return;
  const bytes = Buffer.byteLength(payload);
  if (bytes > CACHE_LIMIT) return;
  while (transfer.cacheBytes + bytes > CACHE_LIMIT && transfer.immutable.size) {
    const oldest = transfer.immutable.keys().next().value!;
    transfer.cacheBytes -= Buffer.byteLength(transfer.immutable.get(oldest)!.payload);
    transfer.immutable.delete(oldest);
  }
  transfer.immutable.set(key, {payload,expiresAt}); transfer.cacheBytes += bytes;
}
