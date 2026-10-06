import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";

describe("cn", () => {
  it("lets later utilities win and keeps brand sizes separate from colours", () => {
    expect(cn("block w-full", "w-32")).toBe("block w-32");
    expect(cn("text-navy", "text-title")).toBe("text-navy text-title");
    expect(cn("text-title", "text-display")).toBe("text-display");
    expect(cn("bg-navy text-gold", false && "x", "text-white")).toBe("bg-navy text-white");
  });
});
