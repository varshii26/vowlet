import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PayPalProvider } from "@/components/Payments/PayButton";
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
  title: "Vowlet",
  description:
    "Wedding payment coordinator: contracts, timeline and PayPal payments in one place.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* One PayPal SDK load shared by every Pay button on the page. */}
        <PayPalProvider>{children}</PayPalProvider>
      </body>
    </html>
  );
}
