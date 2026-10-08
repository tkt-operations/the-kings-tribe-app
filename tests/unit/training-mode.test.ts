/**
 * Training mode (NEXT_PUBLIC_APP_ENVIRONMENT=training): banner, names and the
 * refusal to use the production Supabase project — and proof that nothing
 * changes when training mode is off.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/fonts", () => ({ satoshi: { variable: "font-satoshi" }, dmSerif: { variable: "font-dm-serif" } }));
vi.mock("@/components/pwa/service-worker-registration", () => ({ ServiceWorkerRegistration: () => null }));
vi.mock("@/components/ui/toast", () => ({ ToastProvider: ({ children }: { children: unknown }) => children }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
// Stand-in Supabase clients: creating them must succeed or fail only because of the training guard.
const fakeClient = () => ({ auth: { getClaims: async () => ({ data: null }) } });
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => fakeClient(), createBrowserClient: () => fakeClient() }));

const PROD_URL = "https://xxemwgdmibhneefnfiyr.supabase.co";
const TRAINING_URL = "https://abcdefghijklmnopqrst.supabase.co";

async function load(env: { mode?: string; url?: string; secret?: string }) {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (env.mode !== undefined) vi.stubEnv("NEXT_PUBLIC_APP_ENVIRONMENT", env.mode);
  else vi.stubEnv("NEXT_PUBLIC_APP_ENVIRONMENT", undefined as unknown as string);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", env.url ?? "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", env.secret ?? "");
  return {
    training: await import("@/lib/training"),
    layout: await import("@/app/layout"),
    manifest: (await import("@/app/manifest")).default,
  };
}

const renderLayout = (Layout: (p: { children: React.ReactNode }) => React.ReactElement) =>
  renderToStaticMarkup(createElement(Layout, null, createElement("main", null, "page")));

afterEach(() => vi.unstubAllEnvs());

describe("production (training mode off)", () => {
  it.each([[undefined], [""], ["production"], ["Training"], ["TRAINING"], ["training "]])("NEXT_PUBLIC_APP_ENVIRONMENT=%j leaves everything unchanged", async (mode) => {
    const { training, layout, manifest } = await load({ mode, url: PROD_URL, secret: "sb_secret_test" });
    expect(training.isTrainingMode()).toBe(false);

    const html = renderLayout(layout.default);
    expect(html).not.toMatch(/training/i);
    expect(html).toBe('<html lang="en" class="font-satoshi font-dm-serif"><head></head><body class="min-h-dvh"><main>page</main></body></html>');

    expect(layout.metadata.title).toEqual({ default: "The Kings Tribe — Finance & Operations", template: "%s · The Kings Tribe" });
    expect(layout.metadata.applicationName).toBe("TKT Operations");
    expect(layout.metadata.appleWebApp).toEqual({ capable: true, title: "TKT Operations", statusBarStyle: "black-translucent" });
    expect(manifest()).toMatchObject({ name: "The Kings Tribe — Finance & Operations", short_name: "TKT Operations", start_url: "/dashboard" });

    // Production with the production database is allowed.
    expect(training.trainingDatabaseRefusal(PROD_URL)).toBeNull();
    expect(() => training.assertTrainingDatabaseIsSafe(PROD_URL)).not.toThrow();
  });

  it("the Supabase clients still work against production when training mode is off", async () => {
    await load({ url: PROD_URL, secret: "sb_secret_test" });
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { createSupabaseAnonClient, createSupabaseServerClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseAdminClient()).not.toThrow();
    expect(() => createSupabaseAnonClient()).not.toThrow();
    await expect(createSupabaseServerClient()).resolves.toBeTruthy();
  });

  it("the global CSS only changes anything under the training attribute", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("app/globals.css", "utf8");
    const rule = css.slice(css.indexOf(":root[data-environment=\"training\"]"));
    expect(rule.indexOf("--safe-top")).toBeGreaterThan(0);
    // The only other new selector is the banner's own class, which nothing renders outside training mode.
    expect(css.match(/--training-banner-height/g)?.length).toBeGreaterThan(1);
    expect(css).toMatch(/:root \{\n  color-scheme: light;\n  --safe-top: env\(safe-area-inset-top, 0px\);/);
  });
});

describe("training mode", () => {
  it("shows the banner on every page, marks the document and keeps the page content", async () => {
    const { layout } = await load({ mode: "training", url: TRAINING_URL });
    const html = renderLayout(layout.default);
    expect(html).toContain('<html lang="en" class="font-satoshi font-dm-serif" data-environment="training">');
    expect(html).toContain('<div class="training-banner" role="note" aria-label="Training environment"><span>Training environment · fictional data</span></div>');
    expect(html.indexOf("training-banner")).toBeLessThan(html.indexOf("<main>page</main>"));
  });

  it("names the installed app TKT Training and prefixes page titles", async () => {
    const { layout, manifest } = await load({ mode: "training", url: TRAINING_URL });
    expect(layout.metadata.title).toEqual({ default: "Training · The Kings Tribe — Finance & Operations", template: "Training · %s · The Kings Tribe" });
    expect(layout.metadata.applicationName).toBe("TKT Training");
    expect(layout.metadata.appleWebApp).toMatchObject({ title: "TKT Training" });
    const m = manifest();
    expect(m).toMatchObject({ name: "The Kings Tribe — Training", short_name: "TKT Training" });
    // The official icons are unchanged.
    expect(m.icons).toEqual((await load({ url: PROD_URL })).manifest().icons);
  });

  it("allows a non-production Supabase project", async () => {
    const { training } = await load({ mode: "training", url: TRAINING_URL, secret: "sb_secret_test" });
    expect(training.trainingDatabaseRefusal()).toBeNull();
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    expect(() => createSupabaseAdminClient()).not.toThrow();
  });

  it.each([
    PROD_URL,
    `${PROD_URL}/`,
    "https://XXEMWGDMIBHNEEFNFIYR.supabase.co",
    "https://proxy.example.org/xxemwgdmibhneefnfiyr",
  ])("refuses the production project (%s) everywhere a Supabase client is created", async (url) => {
    const { training } = await load({ mode: "training", url, secret: "sb_secret_test" });
    expect(training.trainingDatabaseRefusal()).toBe("Training environment is configured with the production database. Application startup refused.");
    expect(() => training.assertTrainingDatabaseIsSafe()).toThrow(training.TrainingConfigurationError);

    const { register } = await import("@/instrumentation");
    expect(() => register()).toThrow("Application startup refused");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { createSupabaseAnonClient, createSupabaseServerClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseAdminClient()).toThrow("Application startup refused");
    expect(() => createSupabaseAnonClient()).toThrow("Application startup refused");
    await expect(createSupabaseServerClient()).rejects.toThrow("Application startup refused");
    const { createSupabaseBrowserClient } = await import("@/lib/supabase/browser");
    expect(() => createSupabaseBrowserClient()).toThrow("Application startup refused");
  });

  it("the refusal message never contains keys or the database URL", async () => {
    const { training } = await load({ mode: "training", url: PROD_URL, secret: "sb_secret_should_never_appear" });
    const message = training.trainingDatabaseRefusal() ?? "";
    expect(message).not.toContain("supabase.co");
    expect(message).not.toContain("sb_");
    expect(message).not.toContain("xxemwg");
  });
});

describe("proxy", () => {
  async function proxyResponse(env: { mode?: string; url: string }, pathname = "/dashboard") {
    await load(env);
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    return proxy(new NextRequest(`https://training.example.org${pathname}`));
  }

  it.each(["/dashboard", "/login", "/request/abc"])("serves nothing (503) on %s when training mode points at production", async (pathname) => {
    const res = await proxyResponse({ mode: "training", url: PROD_URL }, pathname);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Training environment is configured with the production database. Application startup refused.");
  });

  it("behaves as before in production mode (an unauthenticated visitor is sent to sign in)", async () => {
    const res = await proxyResponse({ url: PROD_URL });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
