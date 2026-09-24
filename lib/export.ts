import { strToU8, zipSync } from "fflate";

import type { GeneratedSpec } from "@/lib/types";

type Row = Record<string, string | number>;

function escapeXml(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - remainder) / 26);
  }
  return name;
}

function worksheetXml(rows: Row[]) {
  const headers = rows.length ? Object.keys(rows[0]) : ["No rows"];
  const matrix = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
  const rowXml = matrix
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => {
          const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function rowsFromEvents(spec: GeneratedSpec): Row[] {
  return spec.generatedEvents.map((event, index) => ({
    "Event ID": String(index + 1),
    "Event Name": event.eventName,
    Category: event.category,
    "Feature Pack": event.featurePack,
    Trigger: event.trigger,
    Argument: event.argumentName,
    "Argument Description": event.argumentDescription,
    "Argument Examples": event.argumentExamples,
    Status: event.status,
    "Generation Reason": event.generationReason,
    Sources: JSON.stringify(event.sourceReferences),
  }));
}

function rowsFromPayloads(spec: GeneratedSpec): Row[] {
  return spec.generatedEvents.flatMap((event, index) =>
    event.payloadFields.map((payload) => ({
      "Event Name": event.eventName,
      "Event ID": String(index + 1),
      "Payload Name": payload.fieldName,
      "Canonical Payload Name": payload.canonicalFieldName,
      Type: payload.type,
      Requiredness: payload.requiredness,
      Description: payload.description,
      Example: payload.example,
      Notes: payload.notes,
    })),
  );
}

function contentTypes(sheetCount: number) {
  const sheets = Array.from({ length: sheetCount }, (_, index) => {
    const sheetNumber = index + 1;
    return `<Override PartName="/xl/worksheets/sheet${sheetNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheets}
</Types>`;
}

function workbookXml(sheetNames: string[]) {
  const sheets = sheetNames
    .map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets}</sheets>
</workbook>`;
}

function workbookRels(sheetCount: number) {
  const rels = Array.from({ length: sheetCount }, (_, index) => {
    const sheetNumber = index + 1;
    return `<Relationship Id="rId${sheetNumber}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNumber}.xml"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

export function specToWorkbookBuffer(spec: GeneratedSpec) {
  const sheets: Array<{ name: string; rows: Row[] }> = [
    { name: "Spec Metadata", rows: [
      { Key: "Format Version", Value: "1" },
      ...Object.entries(spec.intake).map(([key, value]) => ({ Key: `intake.${key}`, Value: JSON.stringify(value) })),
      ...(spec.appIconDataUrl?.match(/.{1,30000}/g) ?? []).map((chunk, index) => ({ Key: `icon.${index}`, Value: chunk })),
    ] },
    { name: "Generated Events", rows: rowsFromEvents(spec) },
    { name: "Payload Fields", rows: rowsFromPayloads(spec) },
    { name: "Feature Packs Used", rows: spec.selectedFeaturePacks.map((pack) => ({ "Feature Pack": pack })) },
    {
      name: "Platform Ad Payloads",
      rows: spec.platformAdPayloads.map((payload) => ({
        "Platform Event": payload.platformEventName,
        "Ad Family": payload.adFamily,
        "Payload Name": payload.payloadName,
        "Canonical Payload Name": payload.canonicalPayloadName,
        Description: payload.description,
        Example: payload.example,
        Requiredness: payload.requiredness,
      })),
    },
    { name: "Assumptions", rows: spec.assumptions.map((assumption) => ({ Assumption: assumption })) },
  ];

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes(sheets.length)),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(workbookXml(sheets.map((sheet) => sheet.name))),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels(sheets.length)),
  };

  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet.rows));
  });

  return Buffer.from(zipSync(files));
}
