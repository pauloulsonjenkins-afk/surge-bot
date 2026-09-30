import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "@/queries/Providers";
import ThemeSync from "@/components/ui/ThemeSync";

// Runs before the page is painted, so a saved light theme never flashes dark first.
const THEME_BOOT = `try{var s=JSON.parse(localStorage.getItem("surge-ui")||"{}");var t=s&&s.state&&s.state.theme;document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark");}catch(e){}`;

// One typeface on every device, served with the app rather than falling back to each system's own font.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Goal Brewing Alerts",
  description: "Live in-play football alerts.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0E1116",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={inter.variable} suppressHydrationWarning>
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
