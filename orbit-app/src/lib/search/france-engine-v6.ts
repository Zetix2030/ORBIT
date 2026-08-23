import { NextRequest, NextResponse } from "next/server";
import { franceSearchProxyV3 } from "@/lib/search/france-engine-v3";
import { parsePriceFromText, sanitizePropertyPrice } from "@/lib/search/price";

type Criteria = {
  city?: string;
  location?: string;
  propertyType?: string;
  budgetMin?: number;
  budgetMax?: number;
  minSurface?: number;
  maxSurface?: number;
  minBedrooms?: number;
  minBathrooms?: number;
};

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

type Source = {
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  position?: number;
  source?: string;
  sourceScore?: number;
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
  landSurface?: number;
  bedrooms?: number;
  bathrooms?: number;
  rooms?: number;
  location?: string;
  garden?: boolean;
  garage?: boolean;
  pool?: boolean;
  terrace?: boolean;
  parking?: boolean;
  dpe?: string;
  images?: string[];
  pricePerM2?: number;
  propertyKind?: "existing_house" | "new_build_project" | "apartment" | "villa" | "unknown";
  matchScore?: number;
  valueScore?: number;
  orbitScore?: number;
  reasons?: string[];
  compromises?: string[];
  extractedAt?: string;
  priceConfidence?: "confirmed" | "indexed" | "none" | string;
  imageConfidence?: "confirmed" | "indexed" | "none" | string;
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

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value: unknown) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

function collectionLike(titleValue: unknown, descriptionValue: unknown, urlValue: unknown) {
  const title = norm(titleValue);
  const description = norm(descriptionValue);
  const combined = `${title} ${description}`;
  const url = String(urlValue ?? "");

  if (/^\d{1,6}\s+(maisons?|appartements?|biens?|annonces?)\b/.test(title)) return true;
  if (/\b\d{1,6}\s+(maisons?|appartements?|biens?|annonces?|resultats?)\s+(a|en)\b/.test(title)) return true;
  if (/\b(resultats? de recherche|toutes les annonces|nos biens|liste des biens|voir les annonces|immobilier a vendre)\b/.test(combined)) return true;
  if (/\b(maisons?|appartements?)\s+a\s+vendre\b/.test(title) && !/\b(ref|reference|mandat|exclusivite|\d{5,})\b/.test(title)) return true;

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const parts = path.split("/").filter(Boolean);
    if (/\/(recherche|search|annonces|biens|acheter|vente)\/?$/.test(path)) return true;
    if (parts.length <= 2 && /vente|acheter|immobilier|maison|appartement/.test(title) && !/\d{4,}/.test(path)) return true;
  } catch {
    return true;
  }

  return false;
}

function parseSurface(text: string) {
  const values = [...text.matchAll(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|metres? carres?)\b/gi)]
    .map((match) => Number(String(match[1]).replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value >= 15 && value <= 700);
  return values[0];
}

function parseBedrooms(text: string) {
  const match = text.match(/(\d{1,2})\s*(?:chambres?|chambre)\b/i);
  const value = match ? Number(match[1]) : undefined;
  return value && value <= 15 ? value : undefined;
}

function parseBathrooms(text: string) {
  const match = text.match(/(\d{1,2})\s*(?:sdb|salles? de bain)\b/i);
  const value = match ? Number(match[1]) : undefined;
  return value && value <= 10 ? value : undefined;
}

function propertyKind(text: string): Listing["propertyKind"] {
  const value = norm(text);
  if (/\b(appartement|studio)\b/.test(value)) return "apartment";
  if (/\bvilla\b/.test(value)) return "villa";
  if (/programme neuf|construction neuve|neuf a construire/.test(value)) return "new_build_project";
  if (/\b(maison|pavillon|longere|propriete)\b/.test(value)) return "existing_house";
  return "unknown";
}

function sourceToListing(source: Source, criteria?: Criteria): Listing | null {
  const url = source.url ? normalizeUrl(source.url) : "";
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (collectionLike(source.title, source.description, url)) return null;

  const title = clean(source.title) || "Annonce immobilière";
  const description = clean(source.description);
  const text = `${title} ${description}`;
  const normalized = norm(`${text} ${url}`);
  const city = criteria?.city ? norm(criteria.city) : "";
  if (city && !normalized.includes(city)) return null;

  const kind = propertyKind(text);
  if (criteria?.propertyType === "house" && kind === "apartment") return null;
  if (criteria?.propertyType === "apartment" && (kind === "existing_house" || kind === "villa")) return null;

  const surface = parseSurface(text);
  const bedrooms = parseBedrooms(text);
  const bathrooms = parseBathrooms(text);
  const parsed = parsePriceFromText(text, "EUR");
  const price = parsed.value
    ? sanitizePropertyPrice(parsed.value, "EUR", surface, parsed.confidence === "confirmed" ? "confirmed" : "snippet")
    : undefined;

  const budgetMax = criteria?.budgetMax;
  const safePrice = price && (!budgetMax || price <= budgetMax * 1.2) ? price : undefined;
  const domain = host(url);

  return {
    id: "",
    url,
    source: domain,
    parentSource: domain,
    title,
    description,
    price: safePrice,
    currency: "EUR",
    surface,
    bedrooms,
    bathrooms,
    location: criteria?.location ?? (criteria?.city ? `${criteria.city}, France` : "France"),
    garden: /\bjardin\b/i.test(text),
    garage: /\bgarage\b/i.test(text),
    pool: /\bpiscine\b/i.test(text),
    terrace: /\bterrasse\b/i.test(text),
    parking: /\bparking|stationnement\b/i.test(text),
    images: [],
    propertyKind: kind,
    matchScore: 55,
    valueScore: 50,
    orbitScore: 55,
    reasons: safePrice ? ["Prix lu sur le résultat exact de l'annonce"] : [],
    compromises: [
      ...(safePrice ? [] : ["Prix à confirmer sur la fiche"]),
      ...(!surface ? ["Surface non confirmée"] : []),
      ...(!bedrooms ? ["Nombre de chambres non confirmé"] : []),
      "Photo à récupérer depuis la fiche",
    ],
    extractedAt: new Date().toISOString(),
    priceConfidence: safePrice ? "indexed" : "none",
    imageConfidence: "none",
  };
}

function passesExplicitFilters(listing: Listing, filters: Filters) {
  const budgetMin = num(filters.budgetMin);
  const budgetMax = num(filters.budgetMax);
  const minSurface = num(filters.minSurface);
  const maxSurface = num(filters.maxSurface);
  const minBedrooms = num(filters.minBedrooms);
  const minBathrooms = num(filters.minBathrooms);

  if (budgetMin !== undefined && listing.price !== undefined && listing.price < budgetMin) return false;
  if (budgetMax !== undefined && listing.price !== undefined && listing.price > budgetMax) return false;
  if (minSurface !== undefined && listing.surface !== undefined && listing.surface < minSurface) return false;
  if (maxSurface !== undefined && listing.surface !== undefined && listing.surface > maxSurface) return false;
  if (minBedrooms !== undefined && listing.bedrooms !== undefined && listing.bedrooms < minBedrooms) return false;
  if (minBathrooms !== undefined && listing.bathrooms !== undefined && listing.bathrooms < minBathrooms) return false;
  if (filters.garden && listing.garden === false) return false;
  if (filters.garage && listing.garage === false) return false;
  if (filters.pool && listing.pool === false) return false;
  if (filters.terrace && listing.terrace === false) return false;
  if (filters.parking && listing.parking === false) return false;
  if (filters.propertyType === "house" && listing.propertyKind === "apartment") return false;
  if (filters.propertyType === "apartment" && ["existing_house", "villa"].includes(listing.propertyKind ?? "")) return false;
  return true;
}

function dedupe(listings: Listing[]) {
  const seen = new Set<string>();
  const output: Listing[] = [];
  for (const listing of listings) {
    const key = normalizeUrl(listing.url ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(listing);
  }
  return output;
}

function score(listing: Listing, criteria?: Criteria) {
  let value = listing.orbitScore ?? 50;
  const city = criteria?.city ? norm(criteria.city) : "";
  const combined = norm(`${listing.title} ${listing.description} ${listing.location}`);

  if (city && combined.includes(city)) value += 18;
  if (listing.priceConfidence === "confirmed") value += 14;
  else if (listing.priceConfidence === "indexed") value += 6;
  if (listing.imageConfidence === "confirmed") value += 10;
  else if (listing.imageConfidence === "indexed") value += 4;
  if (listing.surface) value += 4;
  if (listing.bedrooms) value += 4;

  if (criteria?.budgetMax && listing.price) {
    if (listing.price <= criteria.budgetMax) value += 8;
    else if (listing.price <= criteria.budgetMax * 1.1) value -= 3;
    else value -= 16;
  }
  if (criteria?.minSurface && listing.surface) {
    const ratio = listing.surface / criteria.minSurface;
    if (ratio >= 1) value += 8;
    else if (ratio >= 0.85) value += 3;
    else value -= 5;
  }
  if (criteria?.minBedrooms && listing.bedrooms) {
    value += listing.bedrooms >= criteria.minBedrooms ? 6 : -4 * (criteria.minBedrooms - listing.bedrooms);
  }
  return value;
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

function searchVariants(query: string, criteria?: Criteria) {
  const city = criteria?.city ?? criteria?.location?.replace(/,?\s*France$/i, "") ?? "France";
  const type = criteria?.propertyType === "apartment" ? "appartement" : "maison";
  const budget = criteria?.budgetMax ? `moins de ${Math.round(criteria.budgetMax)} euros` : "";
  const surface = criteria?.minSurface ? `${Math.round(criteria.minSurface)} m2` : "";
  const bedrooms = criteria?.minBedrooms ? `${criteria.minBedrooms} chambres` : "";
  return [...new Set([
    query,
    `${type} à vendre ${city}`,
    `${type} à vendre ${city} ${budget}`,
    `${type} à vendre ${city} ${surface}`,
    `${type} à vendre ${city} ${bedrooms}`,
    `${type} ${city} immobilier ${budget} ${surface} ${bedrooms}`,
  ].map((value) => value.replace(/\s+/g, " ").trim()))];
}

export async function franceSearchProxyV6(request: NextRequest) {
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
    const variants = searchVariants(query, criteria);
    const extraPayloads = await Promise.all(
      variants.slice(1, 4).map((variant, index) => runV3(request, {
        ...body,
        query: variant,
        filters: {
          ...filters,
          sortPriority: index === 1 ? "lowest_price" : index === 2 ? "largest" : "best_match",
        },
      })),
    );
    const payloads = [first, ...extraPayloads.filter((item): item is Payload => Boolean(item?.success))];

    const enriched = payloads.flatMap((payload) => Array.isArray(payload.listings) ? payload.listings : []);
    const sourceFallbacks = payloads.flatMap((payload) =>
      (Array.isArray(payload.sources) ? payload.sources : [])
        .map((source) => sourceToListing(source, criteria))
        .filter((item): item is Listing => Boolean(item)),
    );

    const listings = dedupe([...enriched, ...sourceFallbacks])
      .filter((listing) => !collectionLike(listing.title, listing.description, listing.url))
      .filter((listing) => passesExplicitFilters(listing, filters))
      .sort((a, b) => score(b, criteria) - score(a, criteria))
      .slice(0, TARGET)
      .map((listing, index) => ({
        ...listing,
        id: `listing-${index}`,
        orbitScore: Math.max(0, Math.min(100, Math.round(score(listing, criteria)))),
      }));

    const sourceMap = new Map<string, Source>();
    for (const payload of payloads) {
      for (const source of Array.isArray(payload.sources) ? payload.sources : []) {
        if (!source.url) continue;
        const key = normalizeUrl(source.url);
        if (!sourceMap.has(key)) sourceMap.set(key, source);
      }
    }
    const sources = [...sourceMap.values()].slice(0, 120).map((source, index) => ({
      ...source,
      id: `source-${index}`,
      position: index + 1,
    }));

    const candidateCount = Math.max(
      listings.length,
      payloads.reduce((sum, payload) => sum + (typeof payload.candidateCount === "number" ? payload.candidateCount : 0), 0),
    );

    return NextResponse.json({
      ...first,
      query,
      criteria,
      listings,
      listingCount: listings.length,
      verifiedListingCount: listings.length,
      targetListingCount: TARGET,
      pageSize: 15,
      totalPages: Math.max(1, Math.ceil(listings.length / 15)),
      candidateCount,
      sourceCount: sources.length,
      sources,
      confirmedPriceCount: listings.filter((item) => item.priceConfidence === "confirmed").length,
      indexedPriceCount: listings.filter((item) => item.priceConfidence === "indexed").length,
      photoCount: listings.filter((item) => item.images?.length).length,
      confirmedPhotoCount: listings.filter((item) => item.imageConfidence === "confirmed").length,
      searchEngineVersion: "FR-6.0",
      searchProvider: "SearXNG-France",
      scope: "France-only",
    });
  } catch (error) {
    console.error("ORBIT France v6 search error:", error);
    return NextResponse.json({
      success: false,
      error: "ORBIT France n'a pas pu effectuer la recherche.",
      listings: [],
      sources: [],
      listingCount: 0,
    }, { status: 503 });
  }
}
