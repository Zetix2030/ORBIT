import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import OrbitSearchFilters from "@/components/OrbitSearchFilters";
import OrbitSortDropdown from "@/components/OrbitSortDropdown";
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
  title: "ORBIT",
  description:
    "ORBIT — intelligent search and decision engine.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="fr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <OrbitSearchFilters />
        <OrbitSortDropdown />
      </body>
    </html>
  );
}
