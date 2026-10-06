import { describe, it, expect } from "vitest";
import { createTestDatabase } from "./harness";

describe("migrations", () => {
  it("apply cleanly on a fresh database", async () => {
    const db = await createTestDatabase();
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.request_types");
    expect(rows[0].n).toBe(5);
  });
});
