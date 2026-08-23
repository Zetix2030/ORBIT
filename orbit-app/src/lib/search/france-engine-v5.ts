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

type Criteria = {
  city?: string;
  location?: string;
  propertyType?: string;
  budgetMax?: number;
  minSurface?: number;
  minBedrooms?: number;
};

type Listing = {
  id?: string;
  url?: string;
  source?: string;
  parentSource?: string;
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
  matchScore?: number;
  valueScore?: number;
  orbitScore?: number;
  reasons?: string[];
  compromises?: string[];
  extractedAt?: string;
  priceConfidence?: string;
  imageConfidence?: string;
};

type Source = {
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  position?: number;
  source?: string;
  sourceScore?: number;
};

type Payload = Record<string, unknown> & {
  success?: boolean;
  query?: string;
  criteria?: Criteria;
  listings?: Listing[];
  sources?: Source[];
  sourceCount?: number;
  candidateCount?: number;
};

const TARGET = 45;

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

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((key) => parsed.searchParams.delete(key));
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}

function looksLikeCollection(listing: Listing) {
  const title = norm(listing.title);
  const description = norm(listing.description);
  const combined = `${title} ${description}`;
  const url = listing.url ?? "";

  if (/^\d{1,6}\s+(maisons?|appartements?|biens?|annonces?)\b/.test(title)) return true;
  if (/\b\d{1,6}\s+(maisons?|appartements?|biens?|annonces?|resultats?)\s+(a|en)\b/.test(title)) return true;
  if (/\b(resultats? de recherche|toutes les annonces|nos biens|liste des biens|immobilier a vendre)\b/.test(combined)) return true;
  if (/\b(maisons?|appartements?)\s+a\s+vendre\b/.test(title) && !/\b(ref|reference|mandat|exclusivite|\d{5,})\b/.test(title)) return true;

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
  return delta <= 0.1;
}

function validListing(listing: Listing) {
  if (!listing.url || !/^https?:\/\//i.test(listing.url)) return false;
  if (!listing.price || listing.price < 20_000 || listing.price > 15_000_000) return false;
  if (looksLikeCollection(listing)) return false;
  if (!titlePriceMatches(listing)) return false;
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

function dedupeListings(listings: Listing[]) {
  const seenUrls = new Set<string>();
  const seenFingerprints = new Set<string>();
  const output: Listing[] = [];

  for (const listing of listings) {
    const url = normalizeUrl(listing.url ?? "");
    const fingerprint = [
      norm(listing.title).replace(/\d+/g, "#").slice(0, 120),
      listing.price ? Math.round(listing.price / 1000) : "",
      listing.surface ? Math.round(listing.surface) : "",
    ].join("|");

    if (!url || seenUrls.has(url)) continue;
    if (fingerprint.length > 20 && seenFingerprints.has(fingerprint)) continue;
    seenUrls.add(url);
    seenFingerprints.add(fingerprint);
    output.push(listing);
  }

  return output;
}

function quality(listing: Listing, criteria?: Criteria) {
  let score = listing.orbitScore ?? 50;
  if (listing.priceConfidence === "confirmed") score += 12;
  else if (listing.priceConfidence === "indexed") score += 5;
  if (listing.imageConfidence === "confirmed") score += 10;
  else if (listing.imageConfidence === "indexed") score += 4;
  if (listing.images?.length) score += 4;
  if (listing.surface) score += 2;
  if (listing.bedrooms) score += 2;
  if (criteria?.minSurface && listing.surface) {
    const ratio = listing.surface / criteria.minSurface;
    if (ratio >= 1) score += 4;
    else if (ratio >= 0.85) score += 1;
    else score -= 4;
  }
  if (criteria?.minBedrooms && listing.bedrooms) {
    score += listing.bedrooms >= criteria.minBedrooms ? 3 : -3;
  }
  if (criteria?.budgetMax && listing.price) {
    if (listing.price <= criteria.budgetMax) score += 4;
    else if (listing.price <= criteria.budgetMax * 1.12) score -= 1;
    else score -= 10;
  }
  return score;
}

function variants(query: string, criteria?: Criteria) {
  const city = criteria?.city ?? criteria?.location?.replace(/,?\s*France$/i, "") ?? "France";
  const type = criteria?.propertyType === "apartment" ? "appartement" : "maison";
  const budget = criteria?.budgetMax ? `moins de ${Math.round(criteria.budgetMax)} euros` : "";
  const surface = criteria?.minSurface ? `${Math.round(criteria.minSurface)} m2` : "";
  const bedrooms = criteria?.minBedrooms ? `${criteria.minBedrooms} chambres` : "";

  return [
    query,
    `${type} à vendre ${city} ${budget}`,
    `${type} ${city} ${bedrooms}`,
    `${type} ${city} ${surface}`,
    `${type} ${city} Finistère ${budget} ${bedrooms}`,
    `${type} ${city} ${surface} ${bedrooms} immobilier`,
  ].map((value) => value.replace(/\s+/g, " ").trim());
}

function makeRequest(base: NextRequest, body: Record<string, unknown>) {
  return new NextRequest(base.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function runV3(base: NextRequest, body: Record<string, unknown>) {
  const response = await franceSearchProxyV3(makeRequest(base, body));
  if (!response.ok) return null;
  return (await response.json()) as Payload;
}

export async function franceSearchProxyV5(request: NextRequest) {
  try {
    const body = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return NextResponse.json({ success: false, error: "La recherche est vide." }, { status: 400 });

    const filters = body.filters && typeof body.filters === "object" ? (body.filters as Filters) : {};

    const first = await runV3(request, { ...body, query });
    if (!first?.success) {
      return NextResponse.json(first ?? { success: false, error: "ORBIT France n'a pas pu effectuer la recherche." }, { status: 503 });
    }

    const criteria = first.criteria;
    const queryVariants = variants(query, criteria);
    const jobs: Array<Promise<Payload | null>> = [];

    const sortModes = ["best_match", "lowest_price", "largest"] as const;
    for (const variant of queryVariants.slice(1)) {
      const mode = sortModes[jobs.length % sortModes.length];
      jobs.push(runV3(request, {
        ...body,
        query: variant,
        filters: { ...filters, sortPriority: mode },
      }));
    }

    const extra = await Promise.all(jobs);
    const payloads = [first, ...extra.filter((item): item is Payload => Boolean(item?.success))];

    const mergedListings = dedupeListings(
      payloads
        .flatMap((payload) => Array.isArray(payload.listings) ? payload.listings : [])
        .filter(validListing)
        .filter((listing) => passesExplicitFilters(listing, filters)),
    )
      .sort((a, b) => quality(b, criteria) - quality(a, criteria))
      .slice(0, TARGET)
      .map((listing, index) => ({
        ...listing,
        id: `listing-${index}`,
        orbitScore: Math.max(0, Math.min(100, Math.round(quality(listing, criteria)))),
      }));

    const sourceMap = new Map<string, Source>();
    for (const payload of payloads) {
      for (const source of Array.isArray(payload.sources) ? payload.sources : []) {
        if (!source.url) continue;
        const key = normalizeUrl(source.url);
        if (!sourceMap.has(key)) sourceMap.set(key, source);
      }
    }
    const sources = [...sourceMap.values()].slice(0, 80).map((source, index) => ({
      ...source,
      id: `source-${index}`,
      position: index + 1,
    }));

    const candidateCount = Math.max(
      mergedListings.length,
      payloads.reduce((sum, payload) => sum + (typeof payload.candidateCount === "number" ? payload.candidateCount : 0), 0),
    );

    return NextResponse.json({
      ...first,
      query,
      criteria,
      listings: mergedListings,
      listingCount: mergedListings.length,
      verifiedListingCount: mergedListings.length,
      targetListingCount: TARGET,
      pageSize: 15,
      totalPages: Math.max(1, Math.ceil(mergedListings.length / 15)),
      candidateCount,
      sourceCount: sources.length,
      sources,
      confirmedPriceCount: mergedListings.filter((item) => item.priceConfidence === "confirmed").length,
      indexedPriceCount: mergedListings.filter((item) => item.priceConfidence === "indexed").length,
      photoCount: mergedListings.filter((item) => item.images?.length).length,
      confirmedPhotoCount: mergedListings.filter((item) => item.imageConfidence === "confirmed").length,
      searchEngineVersion: "FR-5.0",
      searchProvider: "SearXNG-France",
      scope: "France-only",
    });
  } catch (error) {
    console.error("ORBIT France v5 search error:", error);
    return NextResponse.json({
      success: false,
      error: "ORBIT France n'a pas pu effectuer la recherche.",
      listings: [],
      sources: [],
      listingCount: 0,
    }, { status: 503 });
  }
}
