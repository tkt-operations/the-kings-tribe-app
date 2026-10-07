import { hostMatches } from "@/lib/product/url";
import { amazon, amazonShortLink } from "./amazon";
import { bestBuy } from "./best-buy";
import { bhPhoto } from "./bh-photo";
import { generic } from "./generic";
import { guitarCenter } from "./guitar-center";
import { sweetwater } from "./sweetwater";
import type { VendorAdapter } from "./types";
import { walmart } from "./walmart";

export type { VendorAdapter } from "./types";

/** The only place vendor knowledge lives. Order does not matter (domains are disjoint). */
export const ADAPTERS: readonly VendorAdapter[] = [sweetwater, amazon, amazonShortLink, bhPhoto, guitarCenter, bestBuy, walmart];

export function findAdapter(host: string): VendorAdapter {
  return ADAPTERS.find((a) => a.domains.some((d) => hostMatches(host, d))) ?? generic;
}

export { generic };
