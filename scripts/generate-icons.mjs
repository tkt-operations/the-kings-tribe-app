/**
 * Generates PWA / Apple touch icons by placing the OFFICIAL gold logomark
 * (public/brand/logomark-gold.png, unmodified) on a solid Deep Navy (#12172D)
 * canvas — the approved gold-on-navy pairing from the brand guidelines.
 *
 * The logo is only scaled proportionally (fit: "inside"); it is never cropped,
 * stretched, recolored or redrawn.
 *
 * Run: npm run icons
 */
import sharp from "sharp";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "public/brand/logomark-gold.png");
const OUT = path.join(ROOT, "public/icons");
const NAVY = { r: 0x12, g: 0x17, b: 0x2d, alpha: 1 };

// logoShare = fraction of the canvas height the logomark may occupy (clear space around it)
const targets = [
  { file: "icon-192.png", size: 192, logoShare: 0.62 },
  { file: "icon-512.png", size: 512, logoShare: 0.62 },
  { file: "apple-touch-icon.png", size: 180, logoShare: 0.6 },
  // Maskable icons may be cropped to a circle: keep the logo within the 80% safe zone.
  { file: "icon-maskable-512.png", size: 512, logoShare: 0.5 },
  { file: "favicon-32.png", size: 32, logoShare: 0.78 },
  { file: "favicon-48.png", size: 48, logoShare: 0.76 },
];

for (const { file, size, logoShare } of targets) {
  const box = Math.round(size * logoShare);
  const logo = await sharp(SOURCE).resize({ width: box, height: box, fit: "inside" }).png().toBuffer();
  const meta = await sharp(logo).metadata();
  await sharp({ create: { width: size, height: size, channels: 4, background: NAVY } })
    .composite([{ input: logo, left: Math.round((size - meta.width) / 2), top: Math.round((size - meta.height) / 2) }])
    .png()
    .toFile(path.join(OUT, file));
  console.log(`✓ ${file} (${size}×${size}, logo ${meta.width}×${meta.height})`);
}
