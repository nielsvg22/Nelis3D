import type { Metadata, Viewport } from "next";
import { Header } from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nelis3D – turn real objects into printable 3D models",
  description: "Scan an object, tell the AI what you want, get a real 3D model ready for your Creality K1 Max.",
  appleWebApp: { capable: true, title: "Nelis3D", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f7f7f8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Header />
        {children}
      </body>
    </html>
  );
}
