import type { MetadataRoute } from "next";

/**
 * The web app manifest (served at /manifest.webmanifest), so the site installs to a phone's home screen and opens
 * full screen like an app. Colours match the dark theme in globals.css; the icons are drawn by scripts/make-icons.ps1.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "GoalBrew",
    short_name: "GoalBrew",
    description: "Live in-play football alerts.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#17120E",
    theme_color: "#17120E",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the installed app's icon: straight to these pages (admin pages ask for the sign-in as usual).
    shortcuts: [
      { name: "Today", short_name: "Today", description: "Betting status, today's result and what needs attention", url: "/more/admin/today", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Live", short_name: "Live", url: "/live", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
