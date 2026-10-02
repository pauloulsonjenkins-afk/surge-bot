import type { Metadata, Viewport } from "next";
import { Archivo, Inter } from "next/font/google";
import "./globals.css";
import Providers from "@/queries/Providers";
import ThemeSync from "@/components/ui/ThemeSync";

// Runs before the page is painted, so a saved light theme never flashes dark first.
const THEME_BOOT = `try{var s=JSON.parse(localStorage.getItem("surge-ui")||"{}");var t=s&&s.state&&s.state.theme;document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark");}catch(e){}`;

// One typeface on every device, served with the app rather than falling back to each system's own font.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });
// The brand's display face: page titles and key numbers, set wide. Variable in weight and width.
const archivo = Archivo({ subsets: ["latin"], display: "swap", variable: "--font-display", axes: ["wdth"] });

export const metadata: Metadata = {
  title: "Goal Brewing Alerts",
  description: "Live in-play football alerts.",
  applicationName: "Goal Brewing Alerts",
  // Opened from the home screen, iOS shows it full screen under a black status bar (not see-through, so nothing hides behind the notch).
  appleWebApp: { capable: true, title: "Goal Brewing", statusBarStyle: "black" },
  icons: {
    icon: [
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0E1116",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${archivo.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="bg-app font-sans text-ink antialiased">
        <ThemeSync />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
