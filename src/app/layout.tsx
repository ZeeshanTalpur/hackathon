import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Daily Transit",
  description: "Find a bus, see when it arrives, and follow it on the map.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} h-full`}>
      <body className={`${sans.className} min-h-full bg-[#f3efe6] text-[#141820] antialiased`}>
        {children}
      </body>
    </html>
  );
}
