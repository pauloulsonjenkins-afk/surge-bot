import type { MetadataRoute } from "next";

/**
 * The web app manifest (served at /manifest.webmanifest), so the site installs to a phone's home screen and opens
 * full screen like an app. Colours match the dark theme in globals.css; the icons are drawn by scripts/make-icons.ps1.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Goal Brewing Alerts",
    short_name: "Goal Brewing",
    description: "Live in-play football alerts.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0E1116",
    theme_color: "#0E1116",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
