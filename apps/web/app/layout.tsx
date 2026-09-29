import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import Providers from "@/queries/Providers";
import ThemeSync from "@/components/ui/ThemeSync";

// Runs before the page is painted, so a saved light theme never flashes dark first.
const THEME_BOOT = `try{var s=JSON.parse(localStorage.getItem("surge-ui")||"{}");var t=s&&s.state&&s.state.theme;document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark");}catch(e){}`;

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
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="bg-app text-ink antialiased">
        <ClerkProvider>
          <ThemeSync />
          <Providers>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}