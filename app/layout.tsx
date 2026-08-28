import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const CUSTOM_ORIGIN = "https://finality.watch";

async function metadataBaseForRequest() {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = (forwardedHost ?? requestHeaders.get("host"))
    ?.trim()
    .toLowerCase()
    .replace(/\.$/, "");

  if (requestHost === "finality.watch" || requestHost === "www.finality.watch") {
    return new URL(CUSTOM_ORIGIN);
  }

  if (requestHost?.startsWith("localhost:") || requestHost?.startsWith("127.0.0.1:")) {
    return new URL(`http://${requestHost}`);
  }

  return new URL(CUSTOM_ORIGIN);
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: await metadataBaseForRequest(),
    title: {
      default: "finality.watch — Ethereum finality explorer",
      template: "%s · finality.watch",
    },
    description:
      "A work-in-progress research preview exploring how consolidation, networking improvements, shorter slots, and one-round finality could shorten Ethereum’s path from inclusion to finality. This simplified model is not a forecast.",
    applicationName: "finality.watch",
    robots: {
      index: false,
      follow: false,
    },
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
        "A work-in-progress interactive model of full-set round time and expected time to finality under decoupled consensus—not a forecast.",
      images: [
        {
          url: "/og-wip.png",
          width: 1734,
          height: 907,
          alt: "finality.watch Ethereum finality explorer with modeled round-time curves",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "finality.watch",
      description:
        "Work-in-progress research preview: explore how fewer duties, shorter slots, and one-round finality change modeled Ethereum finality timing.",
      images: ["/og-wip.png"],
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
  };
}

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
