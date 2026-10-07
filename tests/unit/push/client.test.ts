/** Browser push helpers, badge helper and dispatch scheduling. */
import { describe, expect, it, vi } from "vitest";
import { deviceLabel, isIos, pushSupport, sameServerKey, urlBase64ToUint8Array } from "@/lib/push/client";
import { updateAppBadge } from "@/components/notifications/badge";

const fakeWindow = (opts: { sw?: boolean; push?: boolean; notification?: boolean; ua?: string; platform?: string; touch?: number; standalone?: boolean }) =>
  ({
    navigator: { ...(opts.sw ? { serviceWorker: {} } : {}), userAgent: opts.ua ?? "Mozilla/5.0 (Macintosh)", platform: opts.platform ?? "MacIntel", maxTouchPoints: opts.touch ?? 0, standalone: opts.standalone },
    ...(opts.push ? { PushManager: function () {} } : {}),
    ...(opts.notification ? { Notification: function () {} } : {}),
    matchMedia: () => ({ matches: Boolean(opts.standalone) }),
  }) as unknown as Window;

describe("push support detection", () => {
  it("supported when service worker, PushManager and Notification exist", () => {
    expect(pushSupport(fakeWindow({ sw: true, push: true, notification: true }))).toBe("supported");
  });
  it("iPhone/iPad Safari outside the Home Screen app must install first", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
    expect(pushSupport(fakeWindow({ sw: true, ua: iphone, platform: "iPhone" }))).toBe("ios_needs_install");
    expect(pushSupport(fakeWindow({ sw: true, ua: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", touch: 5 }))).toBe("ios_needs_install"); // iPadOS
    expect(isIos({ userAgent: "x", platform: "MacIntel", maxTouchPoints: 0 } as Navigator)).toBe(false);
  });
  it("otherwise unsupported", () => {
    expect(pushSupport(fakeWindow({ sw: true }))).toBe("unsupported");
  });
});

describe("keys and labels", () => {
  it("decodes base64url application server keys and compares them", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID_-8"))).toEqual([1, 2, 3, 255, 239]);
    const sub = (bytes: number[] | null) => ({ options: { applicationServerKey: bytes ? new Uint8Array(bytes).buffer : null } }) as unknown as PushSubscription;
    expect(sameServerKey(sub([1, 2, 3, 255, 239]), "AQID_-8")).toBe(true);
    expect(sameServerKey(sub([1, 2, 3]), "AQID_-8")).toBe(false);
    expect(sameServerKey(sub(null), "AQID_-8")).toBe(true);
  });
  it("labels devices coarsely without identifying data", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0")).toBe("Windows · Edge");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe("Mac · Firefox");
  });
});

describe("app badge", () => {
  it("sets and clears the badge where supported", () => {
    const nav = { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) } as unknown as Navigator;
    updateAppBadge(3, nav);
    updateAppBadge(0, nav);
    expect((nav as unknown as { setAppBadge: ReturnType<typeof vi.fn> }).setAppBadge).toHaveBeenCalledWith(3);
    expect((nav as unknown as { clearAppBadge: ReturnType<typeof vi.fn> }).clearAppBadge).toHaveBeenCalled();
  });
  it("is a silent no-op where unsupported, rejected or throwing", () => {
    expect(() => updateAppBadge(2, {} as Navigator)).not.toThrow();
    expect(() => updateAppBadge(2, undefined)).not.toThrow();
    expect(() => updateAppBadge(2, { setAppBadge: () => { throw new Error("nope"); }, clearAppBadge: () => {} } as unknown as Navigator)).not.toThrow();
    expect(() => updateAppBadge(2, { setAppBadge: () => Promise.reject(new Error("denied")), clearAppBadge: async () => {} } as unknown as Navigator)).not.toThrow();
  });
});
