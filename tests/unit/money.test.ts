import { describe, expect, it } from "vitest";
import {
  centsToDecimal, formatCents, formatMoney, lineTotal, numericToCents, parseMoney, parseQuantity, quantityToDecimal, sumCents,
} from "@/lib/money";

describe("money", () => {
  it("parses strictly", () => {
    expect(parseMoney("12.34")).toBe(1234n);
    expect(parseMoney("12")).toBe(1200n);
    expect(parseMoney("0.5")).toBe(50n);
    expect(parseMoney("1,234.50")).toBe(123450n);
    expect(parseMoney("$9.99")).toBe(999n);
    expect(parseMoney("1.234")).toBeNull();
    expect(parseMoney("1e3")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("-5")).toBeNull();
    expect(parseMoney("-5", { allowNegative: true })).toBe(-500n);
  });

  it("avoids floating point errors", () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004
    expect(centsToDecimal(sumCents([parseMoney("0.1")!, parseMoney("0.2")!]))).toBe("0.30");
    expect(centsToDecimal(sumCents(Array(10).fill(parseMoney("0.10")!)))).toBe("1.00");
  });

  it("computes line totals with the same rounding as PostgreSQL", () => {
    expect(centsToDecimal(lineTotal(parseQuantity("3")!, parseMoney("19.99")!))).toBe("59.97");
    expect(centsToDecimal(lineTotal(parseQuantity("2.5")!, parseMoney("10.01")!))).toBe("25.03"); // 25.025 → 25.03
    expect(centsToDecimal(lineTotal(parseQuantity("0.33")!, parseMoney("0.05")!))).toBe("0.02"); // 0.0165 → 0.02
    expect(centsToDecimal(lineTotal(parseQuantity("1.5")!, parseMoney("0.01")!))).toBe("0.02"); // 0.015 → 0.02
  });

  it("parses quantities", () => {
    expect(parseQuantity("2.5")).toBe(250n);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(parseQuantity("1.234")).toBeNull();
    expect(quantityToDecimal(250n)).toBe("2.5");
    expect(quantityToDecimal(300n)).toBe("3");
    expect(quantityToDecimal(205n)).toBe("2.05");
  });

  it("converts PostgreSQL numerics and formats currency", () => {
    expect(numericToCents("1234.5")).toBe(123450n);
    expect(numericToCents("-3")).toBe(-300n);
    expect(numericToCents(null)).toBe(0n);
    expect(formatCents(123450n)).toBe("$1,234.50");
    expect(formatCents(-5n)).toBe("-$0.05");
    expect(formatCents(100000000000n)).toBe("$1,000,000,000.00");
    expect(formatMoney("85")).toBe("$85.00");
    expect(formatCents(123450n, "GBP", "en-GB")).toBe("£1,234.50");
  });
});
