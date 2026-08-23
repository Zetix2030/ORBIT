import { NextRequest, NextResponse } from "next/server";
import { franceSearchProxyV3 } from "@/lib/search/france-engine-v3";
import { parsePriceFromText } from "@/lib/search/price";

type Filters = {
  budgetMin?: string | number;
  budgetMax?: string | number;
  minSurface?: string | number;
  maxSurface?: string | number;
  minBedrooms?: string | number;
  minBathrooms?: string | number;
  garden?: boolean;
  garage?: boolean;
  pool?: boolean;
  terrace?: boolean;
  parking?: boolean;
  propertyType?: string;
};

type Listing = {
  id?: string;
  url?: string;
  source?: string;
  title?: string;
  description?: string;
  price?: number;
  currency?: string;
  surface?: number;
  bedrooms?: number;
  bathrooms?: number;
  garden?: boolean;
  garage?: boolean;
  pool?: boolean;
  terrace?: boolean;
  parking?: boolean;
  propertyKind?: string;
  images?: string[];
  orbitScore?: number;
  priceConfidence?: string;
  imageConfidence?: string;
};

type SearchPayload = Record<string, unknown> & {
  success?: boolean;
  listings?: Listing[];
  listingCount?: number;
  verifiedListingCount?: number;
  confirmedPriceCount?: number;
  indexedPriceCount?: number;
  photoCount?: number;
  confirmedPhotoCount?: number;
};

function norm(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function num(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function looksLikeCollection(listing: Listing) {
  const title = norm(listing.title);
  const description = norm(listing.description);
  const combined = `${title} ${description}`;
  const url = listing.url ?? "";

  if (/^\d{1,6}\s+(maisons?|appartements?|biens?|annonces?)\b/.test(title)) return true;
  if (/\b\d{1,6}\s+(maisons?|appartements?|biens?|annonces?|resultats?)\s+(a|à|en)\b/.test(title)) return true;
  if (/\b(maisons?|appartements?)\s+a\s+vendre\b/.test(title) && !/\b(ref|reference|mandat|exclusivite|\d{5,})\b/.test(title)) return true;
  if (/\b(resultats? de recherche|toutes les annonces|nos biens|liste des biens|immobilier a vendre)\b/.test(combined)) return true;

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const parts = path.split("/").filter(Boolean);
    if (/\/(recherche|search|annonces|biens|acheter|vente)\/?$/.test(path)) return true;
    if (parts.length <= 2 && /vente|acheter|immobilier|maison|appartement/.test(title) && !/\d{4,}/.test(path)) return true;
    if (host(url).endsWith("iadfrance.fr") && /(?:acheter|vente|annonces|immobilier)/.test(path) && !/\d{5,}/.test(path)) return true;
  } catch {
    return true;
  }

  return false;
}

function titlePriceMatches(listing: Listing) {
  if (!listing.price || !listing.title) return true;
  const parsed = parsePriceFromText(listing.title, "EUR");
  if (!parsed.value || parsed.currency !== "EUR") return true;
  const delta = Math.abs(parsed.value - listing.price) / Math.max(parsed.value, listing.price);
  return delta <= 0.08;
}

function validListingLink(listing: Listing) {
  if (!listing.url || !/^https?:\/\//i.test(listing.url)) return false;
  if (looksLikeCollection(listing)) return false;
  return true;
}

function passesExplicitFilters(listing: Listing, filters: Filters) {
  const budgetMin = num(filters.budgetMin);
  const budgetMax = num(filters.budgetMax);
  const minSurface = num(filters.minSurface);
  const maxSurface = num(filters.maxSurface);
  const minBedrooms = num(filters.minBedrooms);
  const minBathrooms = num(filters.minBathrooms);

  if (budgetMin !== undefined && (!listing.price || listing.price < budgetMin)) return false;
  if (budgetMax !== undefined && (!listing.price || listing.price > budgetMax)) return false;
  if (minSurface !== undefined && (!listing.surface || listing.surface < minSurface)) return false;
  if (maxSurface !== undefined && (!listing.surface || listing.surface > maxSurface)) return false;
  if (minBedrooms !== undefined && (!listing.bedrooms || listing.bedrooms < minBedrooms)) return false;
  if (minBathrooms !== undefined && (!listing.bathrooms || listing.bathrooms < minBathrooms)) return false;
  if (filters.garden && !listing.garden) return false;
  if (filters.garage && !listing.garage) return false;
  if (filters.pool && !listing.pool) return false;
  if (filters.terrace && !listing.terrace) return false;
  if (filters.parking && !listing.parking) return false;
  if (filters.propertyType === "house" && listing.propertyKind === "apartment") return false;
  if (filters.propertyType === "apartment" && ["existing_house", "villa"].includes(listing.propertyKind ?? "")) return false;
  return true;
}

function dedupe(listings: Listing[]) {
  const seen = new Set<string>();
  return listings.filter((listing) => {
    const key = `${listing.url ?? ""}|${norm(listing.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function franceSearchProxyV4(request: NextRequest) {
  const body = await request.clone().json().catch(() => ({} as Record<string, unknown>));
  const filters = body && typeof body === "object" && body.filters && typeof body.filters === "object"
    ? (body.filters as Filters)
    : {};

  const response = await franceSearchProxyV3(request);
  if (!response.ok) return response;

  const payload = (await response.json()) as SearchPayload;
  if (!payload.success || !Array.isArray(payload.listings)) {
    return NextResponse.json(payload, { status: response.status });
  }

  const listings = dedupe(payload.listings)
    .filter(validListingLink)
    .filter(titlePriceMatches)
    .filter((listing) => passesExplicitFilters(listing, filters))
    .map((listing, index) => ({ ...listing, id: `listing-${index}` }));

  return NextResponse.json({
    ...payload,
    listings,
    listingCount: listings.length,
    verifiedListingCount: listings.length,
    confirmedPriceCount: listings.filter((listing) => listing.priceConfidence === "confirmed").length,
    indexedPriceCount: listings.filter((listing) => listing.priceConfidence === "indexed").length,
    photoCount: listings.filter((listing) => Array.isArray(listing.images) && listing.images.length > 0).length,
    confirmedPhotoCount: listings.filter((listing) => listing.imageConfidence === "confirmed").length,
    searchEngineVersion: "FR-4.0",
  });
}
