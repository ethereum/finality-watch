import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://finality.watch"),
  title: {
    default: "finality.watch — Ethereum finality explorer",
    template: "%s · finality.watch",
  },
  description:
    "Explore how consolidation, networking improvements, shorter slots, and one-round finality could shorten Ethereum’s path from inclusion to finality.",
  applicationName: "finality.watch",
  keywords: [
    "Ethereum",
    "validator consolidation",
    "fast finality",
    "EIP-7251",
    "consensus",
  ],
  openGraph: {
    type: "website",
    url: "/",
    siteName: "finality.watch",
    title: "Ethereum finality explorer",
    description:
      "An interactive two-level model of full-set round time and expected time to finality under decoupled consensus.",
    images: [
      {
        url: "/og-finality.png",
        width: 1727,
        height: 911,
        alt: "finality.watch expected finality explorer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "finality.watch",
    description:
      "See how fewer duties, shorter slots, and one-round finality change Ethereum’s expected time to finality.",
    images: ["/og-finality.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f7f2e8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
