import type { MetadataRoute } from "next";
import { appIdentity } from "@/lib/app-identity";

export default function manifest(): MetadataRoute.Manifest {
  const identity = appIdentity();
  return {
    id: "/",
    name: identity.name,
    short_name: identity.shortName,
    description: "Sunday reporting, requisitions and purchasing for The Kings Tribe.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#12172D",
    theme_color: "#12172D",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
