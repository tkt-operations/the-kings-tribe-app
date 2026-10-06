import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** Brand type sizes (text-display/title/section) are font sizes, not colours. */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["display", "title", "section"] }] } },
});

/** Join class names; later utilities override conflicting earlier ones (e.g. w-32 over w-full). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
