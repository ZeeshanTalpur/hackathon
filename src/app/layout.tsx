import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Daily Transit",
  description: "Find a bus, see when it arrives, and follow it on the map.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} h-full`}>
      <body className={`${sans.className} min-h-full bg-[#f4f6f9] text-slate-900 antialiased`}>
        {children}
      </body>
    </html>
  );
}
