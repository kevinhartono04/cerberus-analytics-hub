import fs from "node:fs";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { specToWorkbookBuffer } from "@/lib/export";
import { parseAnalyticsSpecFile } from "@/lib/import-spec";

const reimport = (spec: ReturnType<typeof parseAnalyticsSpecFile>) => parseAnalyticsSpecFile({
  fileName: "export.xlsx", buffer: specToWorkbookBuffer(spec),
});

describe("Cerebral spreadsheet round trip", () => {
  it.each(["Word Chain", "Sizzle Sort", "DotPaint"])("preserves %s spec content", (name) => {
    const spec = parseAnalyticsSpecFile({fileName: `${name}.xlsx`, buffer: fs.readFileSync(`../${name} - Analytics Spec.xlsx`)});
    spec.appIconDataUrl = `data:image/png;base64,${"A".repeat(60000)}`;
    const imported = reimport(spec);
    expect(imported).toEqual({...spec, id: imported.id, generatedAt: imported.generatedAt});
    expect(imported.id).not.toBe(spec.id);
  });

  it("preserves duplicate names, empty events, exact strings", () => {
    const spec = parseAnalyticsSpecFile({fileName: "Word Chain.xlsx", buffer: fs.readFileSync("../Word Chain - Analytics Spec.xlsx")});
    spec.generatedEvents = [structuredClone(spec.generatedEvents[0]), structuredClone(spec.generatedEvents[0])];
    spec.generatedEvents[0].payloadFields = [];
    spec.generatedEvents[1].payloadFields[0].example = '  =SUM(A1:A2) & <text>\n00123  ';
    spec.generatedEvents[1].status = "Approved";
    const imported = reimport(spec);
    expect(imported.generatedEvents).toEqual(spec.generatedEvents);
  });

  it("imports edits from visible spreadsheet cells", () => {
    const spec = parseAnalyticsSpecFile({fileName: "Word Chain.xlsx", buffer: fs.readFileSync("../Word Chain - Analytics Spec.xlsx")});
    const files = unzipSync(specToWorkbookBuffer(spec));
    files["xl/worksheets/sheet2.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet2.xml"]).replace(spec.generatedEvents[0].eventName, "Edited_Event"));
    const imported = parseAnalyticsSpecFile({fileName: "edited.xlsx", buffer: Buffer.from(zipSync(files))});
    expect(imported.generatedEvents[0].eventName).toBe("Edited_Event");
    expect(imported.generatedEvents[0].payloadFields).toEqual(spec.generatedEvents[0].payloadFields);
  });

  it("supports IAA-only and empty specs", () => {
    const spec = parseAnalyticsSpecFile({fileName: "Word Chain.xlsx", buffer: fs.readFileSync("../Word Chain - Analytics Spec.xlsx")});
    spec.generatedEvents = [];
    expect(reimport(spec).platformAdPayloads).toEqual(spec.platformAdPayloads);
    spec.platformAdPayloads = [];
    spec.assumptions = [];
    spec.selectedFeaturePacks = [];
    expect(reimport(spec)).toEqual({...spec, id: expect.any(String), generatedAt: expect.any(String)});
  });
});
