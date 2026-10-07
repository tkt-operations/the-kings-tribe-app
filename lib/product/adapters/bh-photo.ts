import { cleanFields, titleFromSlug } from "@/lib/product/normalize";
import type { VendorAdapter } from "./types";

/** bhphotovideo.com/c/product/{number}-{REG|USA|GREY…}/{Name}.html — blocks automated retrieval. */
export const bhPhoto: VendorAdapter = {
  id: "bh-photo",
  displayName: "B&H Photo",
  domains: ["bhphotovideo.com"],
  fetchPage: false,
  hints(url) {
    const m = /^\/c\/product\/(\d+-[A-Za-z]+)(?:\/([^/?]+))?/.exec(url.pathname);
    if (!m) return {};
    return cleanFields({ sku: m[1].toUpperCase(), title: titleFromSlug(m[2], /_+/) });
  },
};
