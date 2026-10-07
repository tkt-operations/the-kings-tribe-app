/** schedulePushDispatch never affects the caller. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const after = vi.fn();
vi.mock("next/server", () => ({ after: (fn: () => unknown) => after(fn) }));
const dispatchPendingPushes = vi.fn();
vi.mock("@/lib/push/dispatch", () => ({ dispatchPendingPushes: () => dispatchPendingPushes() }));
const { schedulePushDispatch } = await import("@/lib/push/schedule");

describe("schedulePushDispatch", () => {
  it("queues the dispatch to run after the response", async () => {
    schedulePushDispatch();
    expect(after).toHaveBeenCalledTimes(1);
    dispatchPendingPushes.mockResolvedValue({ status: "done" });
    await after.mock.calls[0][0]();
    expect(dispatchPendingPushes).toHaveBeenCalledTimes(1);
  });
  it("swallows dispatch failures and works outside a request scope", async () => {
    after.mockReset();
    schedulePushDispatch();
    dispatchPendingPushes.mockRejectedValue(new Error("network down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(after.mock.calls[0][0]()).resolves.toBeUndefined();
    warn.mockRestore();
    after.mockImplementation(() => { throw new Error("outside request scope"); });
    expect(() => schedulePushDispatch()).not.toThrow();
  });
});
