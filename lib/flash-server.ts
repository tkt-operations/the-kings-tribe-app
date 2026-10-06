import "server-only";
import { cookies } from "next/headers";
import { FLASH_COOKIE, type FlashKey } from "@/lib/flash";

/** Queue a success toast to show after the redirect that follows. */
export async function setFlash(key: FlashKey) {
  const store = await cookies();
  store.set(FLASH_COOKIE, key, {
    path: "/",
    maxAge: 60,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false, // read and cleared by the browser
  });
}
