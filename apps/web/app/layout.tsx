import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/queries/Providers";

export const metadata: Metadata = {
  title: "Surge",
  description: "Live xG alerts, bot management and trading for Surge.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0E1116",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-app text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
