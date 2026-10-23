import { describe, expect, it, vi } from "vitest";
import { senseToday, senseRequestSchema } from "@/lib/ludios-sense-types";
import configuration from "@/vercel.json";
describe("WIB daily reporting calendar",()=>{
  it("keeps Sense schedules paused during IO recovery",()=>{
    expect(configuration.crons.some(c=>c.path.startsWith("/api/cron/ludios-sense"))).toBe(false);
  });
  it("maps 21:00 UTC to the following WIB reporting day",()=>{
    expect(senseToday(new Date("2026-10-01T21:00:00Z"))).toBe("2026-10-02");
    expect(senseToday(new Date("2026-10-01T16:59:59Z"))).toBe("2026-10-01");
  });
  it("accepts the current WIB date before UTC midnight but rejects tomorrow",()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-01T21:00:00Z"));
    try {
      expect(senseRequestSchema.safeParse({date:"2026-10-02",countries:["US"]}).success).toBe(true);
      expect(senseRequestSchema.safeParse({date:"2026-10-03",countries:["US"]}).success).toBe(false);
    } finally {vi.useRealTimers();}
  });
});
