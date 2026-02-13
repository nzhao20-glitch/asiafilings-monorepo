import type { Metadata } from "next";
import localFont from "next/font/local";
import { AuthProvider } from "@/src/lib/auth-context";
import { QueryProvider } from "@/src/lib/query-provider";
import { ExchangeProvider } from "@/src/contexts/ExchangeContext";
import { AppNavigation } from "@/src/components/layout/AppNavigation";
import { BackgroundEffects } from "@/src/components/layout/BackgroundEffects";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "AsiaFilings",
  description: "Enterprise web application for institutional investors to view Asian market filings with intelligent analysis",
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
        <BackgroundEffects />
        <QueryProvider>
          <AuthProvider>
            <ExchangeProvider>
              <AppNavigation />
              {children}
            </ExchangeProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
