import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intraday Winner Scanner",
  description: "Live NSE intraday momentum and volume scanner"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
