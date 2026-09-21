import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solar Ops WhatsApp Ingestion",
  description: "Secure WhatsApp Cloud API ingestion for Solar Ops.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
