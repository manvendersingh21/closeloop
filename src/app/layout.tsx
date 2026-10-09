import type { Metadata } from "next";
import { Bungee, Plus_Jakarta_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const bungee = Bungee({
  variable: "--font-bungee",
  subsets: ["latin"],
  weight: ["400"],
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const ibmMono = IBM_Plex_Mono({
  variable: "--font-ibm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "CloseLoop — Find. Fix. Prove. Ship.",
  description:
    "Verified autonomous remediation. Close the gap between AI patches and production-safe deployment.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bungee.variable} ${jakarta.variable} ${ibmMono.variable} h-full antialiased`}
    >
      <body className="relative min-h-full flex flex-col">{children}</body>
    </html>
  );
}
