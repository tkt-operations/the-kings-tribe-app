/**
 * Shared setup for component tests (files start with `// @vitest-environment jsdom`).
 * Import this first in each component test file.
 */
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// React 19 act() support outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const routerMock = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// jsdom lacks the modal API used by components/ui/dialog.tsx.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.cookie.split("; ").forEach((c) => {
    const name = c.split("=")[0];
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
});
