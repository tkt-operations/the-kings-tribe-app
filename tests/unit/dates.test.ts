import { describe, expect, it } from "vitest";
import { addDays, formatDate, isIsoDate, mostRecentSunday, startOfQuarter, todayInTimezone } from "@/lib/dates";

describe("dates", () => {
  it("validates ISO dates", () => {
    expect(isIsoDate("2026-10-04")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("10/04/2026")).toBe(false);
  });
  it("finds the most recent Sunday", () => {
    expect(mostRecentSunday("2026-10-04")).toBe("2026-10-04"); // a Sunday
    expect(mostRecentSunday("2026-10-07")).toBe("2026-10-04");
    expect(mostRecentSunday("2026-10-10")).toBe("2026-10-04");
  });
  it("handles month/quarter boundaries", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(startOfQuarter("2026-08-15")).toBe("2026-07-01");
  });
  it("computes today in the church timezone", () => {
    const instant = new Date("2026-10-05T02:30:00Z"); // still Oct 4 in New York
    expect(todayInTimezone("America/New_York", instant)).toBe("2026-10-04");
    expect(todayInTimezone("Europe/London", instant)).toBe("2026-10-05");
  });
  it("never shifts calendar dates", () => {
    expect(formatDate("2026-10-04")).toBe("Oct 4, 2026");
  });
});
