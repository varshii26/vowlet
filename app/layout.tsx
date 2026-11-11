import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { SessionWatcher } from "@/components/Auth/SessionWatcher";
import { PayPalProvider } from "@/components/Payments/PayButton";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The soft serif for headings.
const fraunces = Fraunces({
  variable: "--font-fraunces",
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
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* One PayPal SDK load shared by every Pay button on the page. */}
        <PayPalProvider>
          <ToastProvider>{children}</ToastProvider>
          <SessionWatcher />
        </PayPalProvider>
      </body>
    </html>
  );
}
