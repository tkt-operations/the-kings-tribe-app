/* eslint-disable @next/next/no-img-element -- official logo files are served as-is, never processed */

/**
 * The official The Kings Tribe logo files, rendered unmodified via <img> so
 * the SVG is never re-colored, cropped or re-drawn. Only height is set; width
 * follows the file's own aspect ratio.
 */
const FILES = {
  "landscape-gold-on-navy": { src: "/brand/logo-landscape-gold-on-navy.svg", ratio: 670.85 / 327.08 },
  "landscape-navy": { src: "/brand/logo-landscape-navy.svg", ratio: 670.85 / 327.08 },
  "landscape-white": { src: "/brand/logo-landscape-white.svg", ratio: 670.85 / 327.08 },
  "primary-gold-on-navy": { src: "/brand/logo-primary-gold-on-navy.svg", ratio: 615.24 / 550.14 },
  "primary-navy": { src: "/brand/logo-primary-navy.svg", ratio: 615.24 / 550.14 },
  "primary-white": { src: "/brand/logo-primary-white.svg", ratio: 615.24 / 550.14 },
  "logomark-gold": { src: "/brand/logomark-gold.svg", ratio: 315.9 / 425.68 },
  "logomark-navy": { src: "/brand/logomark-navy.svg", ratio: 315.9 / 425.68 },
  "logomark-white": { src: "/brand/logomark-white.svg", ratio: 315.9 / 425.68 },
} as const;

export type LogoVariant = keyof typeof FILES;

export function Logo({ variant, height, className, alt = "The Kings Tribe" }: {
  variant: LogoVariant;
  height: number;
  className?: string;
  alt?: string;
}) {
  const file = FILES[variant];
  return (
    <img
      src={file.src}
      alt={alt}
      height={height}
      width={Math.round(height * file.ratio)}
      className={className}
      style={{ height, width: "auto", aspectRatio: String(file.ratio) }}
      draggable={false}
    />
  );
}
