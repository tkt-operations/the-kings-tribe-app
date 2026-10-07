import "server-only";

import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const KEY = /^[A-Za-z0-9_-]{40,100}$/;

/**
 * VAPID application-server identity, or null when not configured — in which
 * case push is simply off (the inbox, Realtime and email are unaffected).
 * The private key is read only here, in server-only code.
 */
export function vapidConfig(): VapidConfig | null {
  const publicKey = publicEnv().vapidPublicKey;
  const { vapidPrivateKey: privateKey, vapidSubject: subject } = serverEnv();
  if (!KEY.test(publicKey) || !KEY.test(privateKey)) return null;
  if (!/^(mailto:[^@\s]+@[^@\s]+|https:\/\/[^\s]+)$/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}
