import localFont from "next/font/local";

/*
 * Brand typefaces, self-hosted from the ORIGINAL font files (unmodified, as the
 * ITF Free Font License requires). Header: DM Serif Display. Body: Satoshi.
 */
export const satoshi = localFont({
  src: [
    { path: "../assets/fonts/Satoshi-Regular.woff2", weight: "400", style: "normal" },
    { path: "../assets/fonts/Satoshi-Medium.woff2", weight: "500", style: "normal" },
    { path: "../assets/fonts/Satoshi-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-satoshi",
  display: "swap",
});

export const dmSerif = localFont({
  src: [{ path: "../assets/fonts/DMSerifDisplay-Regular.ttf", weight: "400", style: "normal" }],
  variable: "--font-dm-serif",
  display: "swap",
});
