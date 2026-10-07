/**
 * Installed-app badge (Badging API) showing the unread count, where supported.
 * Feature-detected and fully guarded: it can never affect notifications.
 */
type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

export function updateAppBadge(count: number, nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator) {
  const n = nav as BadgeNavigator | undefined;
  try {
    if (!n?.setAppBadge || !n.clearAppBadge) return;
    const result = count > 0 ? n.setAppBadge(count) : n.clearAppBadge();
    void result?.catch?.(() => {});
  } catch {
    // Unsupported or not permitted: ignore.
  }
}
