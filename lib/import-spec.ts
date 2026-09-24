import path from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

import { canonicalFieldName } from "@/lib/canonical";
import type { GeneratedEvent, GeneratedPayloadField, GeneratedSpec, GameIntake } from "@/lib/types";

type CellRow = {
  rowNumber: number;
  values: string[];
};

type ParsedSheet = {
  name: string;
  rows: CellRow[];
};

type HeaderMatch = {
  rowIndex: number;
  columns: Map<string, number>;
};

type ImportInput = {
  fileName: string;
  buffer: Buffer;
  gameTitle?: string;
  genre?: string;
};

const SUPPORTED_STANDARD_SHEETS = new Set(["gameplay", "transaction", "economy", "iap"]);
const ATHENA_NOTE_HEADER = "athena sizzle team note";

class ImportSpecError extends Error {
  status = 400;
}

function fail(message: string): never {
  throw new ImportSpecError(message);
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanCell(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function baseName(fileName: string) {
  return path.basename(fileName).replace(/\.(xlsx|csv)$/i, "").trim() || "Imported Analytics Spec";
}

function columnNumber(ref: string) {
  const letters = ref.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
}

function textFromRichText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => textFromRichText(item)).join("");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("#text" in record) return textFromRichText(record["#text"]);
    if ("t" in record) return textFromRichText(record.t);
    if ("r" in record) return textFromRichText(record.r);
  }
  return "";
}

function findHeader(rows: CellRow[], requiredHeaders: string[]): HeaderMatch | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const columns = new Map<string, number>();
    rows[rowIndex].values.forEach((value, index) => {
      const normalized = normalizeHeader(value);
      if (normalized && normalized !== ATHENA_NOTE_HEADER) columns.set(normalized, index);
    });
    if (requiredHeaders.every((header) => columns.has(normalizeHeader(header)))) {
      return { rowIndex, columns };
    }
  }
  return null;
}

function valueFor(row: CellRow, header: HeaderMatch, name: string) {
  const index = header.columns.get(normalizeHeader(name));
  return index == null ? "" : cleanCell(row.values[index]);
}

function inferType(example: string) {
  const trimmed = example.trim();
  if (!trimmed) return "string";
  if (/^(true|false)$/i.test(trimmed)) return "Boolean";
  if (/^-?\d+(\.\d+)?$/.test(trimmed.replace(/^"|"$/g, ""))) return "Number";
  return "string";
}

function featurePackForSheet(sheetName: string) {
  const normalized = normalizeHeader(sheetName);
  if (normalized === "gameplay") return "Imported Gameplay";
  if (normalized === "transaction" || normalized === "economy") return "Imported Economy";
  if (normalized === "iap") return "Imported IAP";
  return `Imported ${sheetName}`;
}

function categoryForSheet(sheetName: string) {
  const normalized = normalizeHeader(sheetName);
  if (normalized === "transaction" || normalized === "economy") return "Economy";
  if (normalized === "iap") return "IAP";
  if (normalized === "gameplay") return "Gameplay";
  return sheetName || "Imported";
}

function makePayload(name: string, description: string, example: string): GeneratedPayloadField {
  const canonical = canonicalFieldName(name);
  return {
    fieldName: name,
    canonicalFieldName: canonical,
    type: inferType(example),
    requiredness: "Recommended",
    description,
    example,
    notes: "Imported from existing analytics spec.",
  };
}

function parseStandardSheet(sheet: ParsedSheet, sourceFileName: string) {
  const header = findHeader(sheet.rows, [
    "Event Name",
    "Description",
    "Argument Type",
    "Argument Value",
    "Arg Value Example",
    "Payload Name",
    "Payload Value",
    "Payload Value Example",
  ]);
  if (!header) return [];

  const events: GeneratedEvent[] = [];
  let currentEvent: GeneratedEvent | null = null;

  for (const row of sheet.rows.slice(header.rowIndex + 1)) {
    const eventName = valueFor(row, header, "Event Name");
    const payloadName = valueFor(row, header, "Payload Name");

    if (eventName) {
      currentEvent = {
        eventName,
        category: categoryForSheet(sheet.name),
        featurePack: featurePackForSheet(sheet.name),
        trigger: valueFor(row, header, "Description"),
        argumentName: valueFor(row, header, "Argument Type"),
        argumentDescription: valueFor(row, header, "Argument Value"),
        argumentExamples: valueFor(row, header, "Arg Value Example"),
        payloadFields: [],
        sourceReferences: [`${sourceFileName} · ${sheet.name} row ${row.rowNumber}`],
        generationReason: "Imported from an existing analytics spec.",
        status: "Draft",
      };
      events.push(currentEvent);
    }

    if (currentEvent && payloadName) {
      currentEvent.payloadFields.push(
        makePayload(payloadName, valueFor(row, header, "Payload Value"), valueFor(row, header, "Payload Value Example")),
      );
    }
  }

  return events;
}

function adFamilyFromEventName(eventName: string) {
  if (/rewarded/i.test(eventName)) return "Rewarded";
  if (/interstitial/i.test(eventName)) return "Interstitial";
  return "";
}

function parseIaaSheet(sheet: ParsedSheet) {
  const header = findHeader(sheet.rows, ["Event Name", "Description", "Payload Name", "Payload Value", "Payload Value Example"]);
  if (!header) return [];

  return sheet.rows
    .slice(header.rowIndex + 1)
    .map((row) => {
      const platformEventName = valueFor(row, header, "Event Name");
      const payloadName = valueFor(row, header, "Payload Name");
      if (!platformEventName || !payloadName) return null;
      const canonical = canonicalFieldName(payloadName);
      const adFamily = adFamilyFromEventName(platformEventName);
      return {
        platformEventName,
        adFamily,
        payloadName,
        canonicalPayloadName: canonical,
        description: valueFor(row, header, "Payload Value"),
        example: valueFor(row, header, "Payload Value Example"),
        requiredness: "Recommended",
      };
    })
    .filter((row): row is GeneratedSpec["platformAdPayloads"][number] => Boolean(row));
}

function sheetNameFromCsvRow(row: CellRow, header: HeaderMatch) {
  return valueFor(row, header, "Sheet") || valueFor(row, header, "Category");
}

function parseCsvSheets(fileName: string, buffer: Buffer): ParsedSheet[] {
  const records = parseCsv(buffer.toString("utf8"), {
    relax_column_count: true,
    skip_empty_lines: false,
  }) as unknown[][];
  const rows = records
    .map((values, index): CellRow => ({ rowNumber: index + 1, values: values.map(cleanCell) }))
    .filter((row) => row.values.some(Boolean));
  const header = findHeader(rows, ["Event Name", "Payload Name"]);
  if (!header) return [{ name: "Imported", rows }];

  const groups = new Map<string, CellRow[]>();
  let activeGroup = "";
  const headerRow = rows[header.rowIndex];

  for (const row of rows.slice(header.rowIndex + 1)) {
    const explicitGroup = sheetNameFromCsvRow(row, header);
    if (explicitGroup) activeGroup = explicitGroup;
    const name = activeGroup || inferCsvSheetName(headerRow);
    if (!groups.has(name)) groups.set(name, [headerRow]);
    groups.get(name)?.push(row);
  }

  return groups.size ? [...groups].map(([name, groupedRows]) => ({ name, rows: groupedRows })) : [{ name: inferCsvSheetName(headerRow), rows }];
}

function inferCsvSheetName(headerRow: CellRow) {
  const normalized = new Set(headerRow.values.map(normalizeHeader));
  if (normalized.has("payload value") && normalized.has("payload value example") && !normalized.has("argument type")) {
    return "IAA";
  }
  return "Imported";
}

function parseSharedStrings(workbook: Record<string, Uint8Array>, parser: XMLParser) {
  const sharedStringsXml = workbook["xl/sharedStrings.xml"];
  if (!sharedStringsXml) return [];
  const parsed = parser.parse(strFromU8(sharedStringsXml)) as Record<string, unknown>;
  return asArray((parsed.sst as Record<string, unknown> | undefined)?.si).map(textFromRichText);
}

function xlsxCellValue(cell: Record<string, unknown>, sharedStrings: string[]) {
  if (cell.t === "s") {
    const index = Number(cell.v ?? 0);
    return sharedStrings[index] ?? "";
  }
  if (cell.is) return textFromRichText(cell.is);
  return cleanCell(cell.v);
}

function parseXlsxSheets(buffer: Buffer): ParsedSheet[] {
  const workbook = unzipSync(new Uint8Array(buffer));
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: false,
    parseAttributeValue: false,
  });

  const workbookXml = workbook["xl/workbook.xml"];
  const relationshipsXml = workbook["xl/_rels/workbook.xml.rels"];
  if (!workbookXml || !relationshipsXml) fail("The uploaded XLSX is missing workbook metadata.");

  const sharedStrings = parseSharedStrings(workbook, parser);
  const workbookData = parser.parse(strFromU8(workbookXml)) as Record<string, unknown>;
  const relsData = parser.parse(strFromU8(relationshipsXml)) as Record<string, unknown>;
  const relationships = new Map(
    asArray((relsData.Relationships as Record<string, unknown> | undefined)?.Relationship).map((rel) => [
      String((rel as Record<string, unknown>).Id),
      String((rel as Record<string, unknown>).Target),
    ]),
  );
  const sheets = asArray(
    ((workbookData.workbook as Record<string, unknown> | undefined)?.sheets as Record<string, unknown> | undefined)?.sheet,
  ) as Array<Record<string, unknown>>;

  return sheets.map((sheet) => {
    const sheetName = cleanCell(sheet.name);
    const relationId = cleanCell(sheet.id);
    const target = relationships.get(relationId);
    if (!target) fail(`Could not locate worksheet data for ${sheetName}.`);
    const targetPath = target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join("xl", target));
    const worksheetXml = workbook[targetPath];
    if (!worksheetXml) fail(`Could not read worksheet data for ${sheetName}.`);
    const worksheet = parser.parse(strFromU8(worksheetXml)) as Record<string, unknown>;
    const rawRows = asArray(
      ((worksheet.worksheet as Record<string, unknown> | undefined)?.sheetData as Record<string, unknown> | undefined)?.row,
    ) as Array<Record<string, unknown>>;

    const rows = rawRows
      .map((rawRow): CellRow => {
        const cells = asArray(rawRow.c) as Array<Record<string, unknown>>;
        const values: string[] = [];
        for (const cell of cells) {
          const ref = cleanCell(cell.r);
          const index = columnNumber(ref) - 1;
          if (index >= 0) values[index] = xlsxCellValue(cell, sharedStrings);
        }
        return {
          rowNumber: Number(rawRow.r ?? 0),
          values,
        };
      })
      .filter((row) => row.values.some(Boolean));

    return { name: sheetName, rows };
  });
}

function titleFromRows(sheets: ParsedSheet[], fallback: string) {
  for (const sheet of sheets) {
    const header = findHeader(sheet.rows, ["Game Title"]);
    if (!header) continue;
    for (const row of sheet.rows.slice(header.rowIndex + 1)) {
      const title = valueFor(row, header, "Game Title");
      if (title) return title;
    }
  }
  return fallback;
}

function intakeForImport(
  gameTitle: string,
  genre: string,
  fileName: string,
  platformAdPayloads: GeneratedSpec["platformAdPayloads"],
): GameIntake {
  const adFamilies = new Set(platformAdPayloads.map((payload) => payload.adFamily).filter(Boolean));
  const ads = [
    adFamilies.has("Rewarded") ? "Rewarded Ads" : "",
    adFamilies.has("Interstitial") ? "Interstitial Ads" : "",
  ].filter(Boolean);
  const placementExamples = (adFamily: string) =>
    platformAdPayloads
      .filter((payload) => payload.adFamily === adFamily && payload.canonicalPayloadName === "placement")
      .map((payload) => payload.example)
      .filter(Boolean)
      .join(", ");

  return {
    gameTitle,
    genre,
    coreLoop: "",
    gameModes: "",
    mechanics: "",
    winConditions: "",
    loseConditions: "",
    economy: "",
    itemsOrPowerups: "",
    powerupNames: "",
    iap: "",
    ads: ads.join(", "),
    rewardedAdPlacements: placementExamples("Rewarded"),
    interstitialAdPlacements: placementExamples("Interstitial"),
    liveOps: "",
    notes: `Imported from ${fileName}.`,
  };
}

function selectedFeaturePacks(events: GeneratedEvent[], platformAdPayloads: GeneratedSpec["platformAdPayloads"]) {
  const packs = new Set(events.map((event) => event.featurePack).filter(Boolean));
  if (platformAdPayloads.length) packs.add("Platform Ad Payload Enrichment");
  return [...packs];
}

// Cerebral workbooks use editable tables; IDs keep duplicate event names distinct.
function parseCerebralWorkbook(sheets: ParsedSheet[], fileName: string): GeneratedSpec | null {
  const metadata = sheets.find((sheet) => sheet.name === "Spec Metadata");
  if (!metadata) return null;
  const records = (name: string): Record<string, string>[] => {
    const sheet = sheets.find((item) => item.name === name);
    if (!sheet?.rows.length) return [];
    const headers = sheet.rows[0].values;
    return sheet.rows.slice(1).map((row) => Object.fromEntries(headers.map((key, index) => [key, row.values[index] ?? ""])));
  };
  const meta = Object.fromEntries(records("Spec Metadata").map((row) => [row.Key, row.Value]));
  if (meta["Format Version"] !== "1") fail("Unsupported Cerebral spreadsheet version.");
  try {
    const intake = intakeForImport(baseName(fileName), "", fileName, []);
    for (const key of Object.keys(intake) as Array<keyof GameIntake>) {
      if (meta[`intake.${key}`] !== undefined) {
        const value: unknown = JSON.parse(meta[`intake.${key}`]);
        if (typeof value !== "string") fail(`Invalid intake field: ${key}.`);
        intake[key] = value;
      }
    }
    const events = new Map<string, GeneratedEvent>();
    for (const row of records("Generated Events")) {
      if (!row["Event ID"] || events.has(row["Event ID"])) fail("Event IDs must be present and unique.");
      const sources: unknown = JSON.parse(row.Sources || "[]");
      if (!Array.isArray(sources) || sources.some((source) => typeof source !== "string")) fail("Sources must be a JSON list of strings.");
      events.set(row["Event ID"], {
        eventName: row["Event Name"] ?? "", category: row.Category ?? "", featurePack: row["Feature Pack"] ?? "",
        trigger: row.Trigger ?? "", argumentName: row.Argument ?? "", argumentDescription: row["Argument Description"] ?? "",
        argumentExamples: row["Argument Examples"] ?? "", status: row.Status ?? "", generationReason: row["Generation Reason"] ?? "",
        sourceReferences: sources as string[], payloadFields: [],
      });
    }
    for (const row of records("Payload Fields")) {
      const event = events.get(row["Event ID"]);
      if (!event) fail("A payload references an unknown Event ID.");
      event.payloadFields.push({ fieldName: row["Payload Name"] ?? "", canonicalFieldName: row["Canonical Payload Name"] ?? "",
        type: row.Type ?? "", requiredness: row.Requiredness ?? "", description: row.Description ?? "", example: row.Example ?? "", notes: row.Notes ?? "" });
    }
    const icon = Object.keys(meta).filter((key) => key.startsWith("icon.")).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))).map((key) => meta[key]).join("");
    return {
      id: `import-${randomUUID()}`, generatedAt: new Date().toISOString(), intake,
      ...(icon ? { appIconDataUrl: icon } : {}),
      generatedEvents: [...events.values()],
      selectedFeaturePacks: records("Feature Packs Used").map((row) => row["Feature Pack"]),
      assumptions: records("Assumptions").map((row) => row.Assumption),
      platformAdPayloads: records("Platform Ad Payloads").map((row) => ({
        platformEventName: row["Platform Event"] ?? "", adFamily: row["Ad Family"] ?? "", payloadName: row["Payload Name"] ?? "",
        canonicalPayloadName: row["Canonical Payload Name"] ?? "", description: row.Description ?? "", example: row.Example ?? "", requiredness: row.Requiredness ?? "",
      })),
    };
  } catch (error) {
    if (error instanceof ImportSpecError) throw error;
    fail("Invalid Cerebral spreadsheet metadata. Export the spec again and retry.");
  }
}

export function isImportSpecError(error: unknown): error is ImportSpecError {
  return error instanceof ImportSpecError;
}

export function parseAnalyticsSpecFile({ fileName, buffer, gameTitle: gameTitleOverride, genre: genreOverride }: ImportInput): GeneratedSpec {
  const extension = path.extname(fileName).toLowerCase();
  if (!buffer.length) fail("Upload a non-empty XLSX or CSV file.");
  if (extension !== ".xlsx" && extension !== ".csv") fail("Only .xlsx and .csv analytics spec files are supported.");

  const sheets = extension === ".xlsx" ? parseXlsxSheets(buffer) : parseCsvSheets(fileName, buffer);
  const cerebral = extension === ".xlsx" ? parseCerebralWorkbook(sheets, fileName) : null;
  if (cerebral) {
    if (gameTitleOverride?.trim()) cerebral.intake.gameTitle = gameTitleOverride.trim();
    if (genreOverride?.trim()) cerebral.intake.genre = genreOverride.trim();
    return cerebral;
  }
  const generatedEvents: GeneratedEvent[] = [];
  const platformAdPayloads: GeneratedSpec["platformAdPayloads"] = [];

  for (const sheet of sheets) {
    const normalizedName = normalizeHeader(sheet.name);
    if (normalizedName === "iaa") {
      platformAdPayloads.push(...parseIaaSheet(sheet));
      continue;
    }
    if (extension === ".xlsx" && !SUPPORTED_STANDARD_SHEETS.has(normalizedName)) continue;
    generatedEvents.push(...parseStandardSheet(sheet, fileName));
  }

  const payloadCount =
    generatedEvents.reduce((total, event) => total + event.payloadFields.length, 0) + platformAdPayloads.length;
  if (!generatedEvents.length && !platformAdPayloads.length) {
    fail("No importable analytics events or platform ad payload rows were found.");
  }
  if (!payloadCount) fail("No importable payload rows were found.");

  const gameTitle = gameTitleOverride?.trim() || titleFromRows(sheets, baseName(fileName));
  const genre = genreOverride === undefined ? "Imported analytics spec" : genreOverride.trim();
  const generatedAt = new Date().toISOString();

  return {
    id: `import-${Date.now()}`,
    generatedAt,
    intake: intakeForImport(gameTitle, genre, fileName, platformAdPayloads),
    selectedFeaturePacks: selectedFeaturePacks(generatedEvents, platformAdPayloads),
    generatedEvents,
    platformAdPayloads,
    assumptions: [
      "Imported from an existing analytics spec file and should be reviewed before implementation.",
      "Canonical field aliases are normalized where this platform has a known mapping.",
    ],
  };
}
