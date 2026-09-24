import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
export type CatalogProduct = { id: string; name: string; notes: string; noAds: "temporary" | "permanent" | "none"; expectedCoins?: number };
export function parseCatalog(csv: string): Record<string, CatalogProduct> {
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
  const catalog: Record<string, CatalogProduct> = {};
  // Explicit values from the supplied catalog, not arbitrary instructions from the notes column.
  const knownNotes = new Set(["Coin + Items Bundle", "Coin + Items + No Ads Bundle", "Season Pass + Limited Time No Ads", "Season Pass", "No Ads + Item Bundle", "Coins Only", "No Ads Only"]);
  for (const row of rows) {
    const id = row.ID?.trim(); const name = row["Game Product Name"]?.trim(); const notes = row["Notes for Slackbot"]?.trim();
    if (!/^\d+$/.test(id ?? "") || !name || !knownNotes.has(notes) || catalog[id]) throw new Error("Invalid or ambiguous product catalog");
    const coins = notes === "Coins Only" ? /^Coin Pack ([\d,]+)$/.exec(name)?.[1] : undefined;
    catalog[id] = { id, name, notes, noAds: notes.includes("Limited Time No Ads") ? "temporary" : notes.includes("No Ads") ? "permanent" : "none", ...(coins ? { expectedCoins: Number(coins.replaceAll(",", "")) } : {}) };
  }
  return catalog;
}
let cached: Record<string, CatalogProduct> | undefined;
export function productCatalog() {
  return cached ??= parseCatalog(fs.readFileSync(path.join(process.cwd(), "data/refund-review/products.csv"), "utf8"));
}
