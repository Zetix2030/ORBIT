import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import FranceOnlyUiGuard from "@/components/FranceOnlyUiGuard";
import OrbitLandingIntro from "@/components/OrbitLandingIntro";
import OrbitSearchFilters from "@/components/OrbitSearchFilters";
import OrbitSortDropdown from "@/components/OrbitSortDropdown";
import OrbitPagination from "@/components/OrbitPagination";
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
    "ORBIT France — recherche immobilière intelligente et moteur de décision.",
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
        <OrbitLandingIntro />
        {children}
        <FranceOnlyUiGuard />
        <OrbitSearchFilters />
        <OrbitSortDropdown />
        <OrbitPagination />
      </body>
    </html>
  );
}
