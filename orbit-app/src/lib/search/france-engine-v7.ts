import { NextRequest, NextResponse } from "next/server";
import { detectLocationWithAI } from "@/lib/search/location";
import {
  parseLocalizedInteger,
  parsePriceFromText,
  sanitizePropertyPrice,
} from "@/lib/search/price";

type SearchResult = {
  url?: string;
  title?: string;
  content?: string;
  thumbnail?: string;
  img_src?: string;
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
  sortPriority?: "best_match" | "lowest_price" | "largest";
};

type Criteria = {
  category: "real_estate";
  intent: "buy";
  propertyType?: string;
  city?: string;
  country: "France";
  location: string;
  language: "fr";
  currency: "EUR";
  budgetMin?: number;
  budgetMax?: number;
  minSurface?: number;
  maxSurface?: number;
  minBedrooms?: number;
  minBathrooms?: number;
  garden?: boolean;
  garage?: boolean;
  pool?: boolean;
  terrace?: boolean;
  parking?: boolean;
  requirements: string[];
  preferences: string[];
  sortPriority: "best_match" | "lowest_price" | "largest";
};

type Listing = {
  id: string;
  url: string;
  source: string;
  parentSource: string;
  title: string;
  description: string;
  price: number;
  currency: "EUR";
  surface?: number;
  bedrooms?: number;
  bathrooms?: number;
  location: string;
  garden?: boolean;
  garage?: boolean;
  pool?: boolean;
  terrace?: boolean;
  parking?: boolean;
  images: string[];
  propertyKind: "existing_house" | "new_build_project" | "apartment" | "villa" | "unknown";
  matchScore: number;
  valueScore: number;
  orbitScore: number;
  reasons: string[];
  compromises: string[];
  extractedAt: string;
  priceConfidence: "confirmed" | "indexed";
  imageConfidence: "confirmed" | "none";
  pricePerM2?: number;
};

type Candidate = {
  url: string;
  title: string;
  description: string;
  source: string;
  snippetPrice?: number;
  snippetSurface?: number;
  snippetBedrooms?: number;
  snippetBathrooms?: number;
  propertyKind: Listing["propertyKind"];
  cityMatched: boolean;
  discoveryScore: number;
};

type PageDetails = {
  price?: number;
  surface?: number;
  bedrooms?: number;
  bathrooms?: number;
  images: string[];
  text: string;
};

const TARGET = 45;
const MAX_CANDIDATES = 180;
const MAX_ENRICH = 140;
const ENRICH_BATCH = 10;

const FRENCH_PORTALS = [
  "safti.fr",
  "iadfrance.fr",
  "orpi.com",
  "efficity.com",
  "proprietes-privees.com",
  "ouestfrance-immo.com",
  "century21.fr",
  "fnaim.fr",
  "logic-immo.com",
  "bienici.com",
  "seloger.com",
  "leboncoin.fr",
  "guy-hoquet.com",
  "laforet.com",
  "nestenn.com",
  "squarehabitat.fr",
  "human-immobilier.fr",
  "optimhome.com",
  "capifrance.fr",
  "3gimmobilier.com",
  "megagence.com",
  "proprietes.lefigaro.fr",
];

const PRIORITY_PORTALS = new Set([
  "safti.fr",
  "iadfrance.fr",
  "orpi.com",
  "efficity.com",
  "proprietes-privees.com",
  "ouestfrance-immo.com",
  "century21.fr",
  "laforet.com",
  "nestenn.com",
  "human-immobilier.fr",
  "optimhome.com",
  "capifrance.fr",
]);

const FOREIGN_MARKERS = /\b(miami|londres|london|new york|los angeles|dubai|madrid|barcelone|barcelona|berlin|rome|milan|lisbonne|lisbon|tokyo|sydney|toronto|usa|etats[- ]unis|états[- ]unis|royaume[- ]uni|uk|espagne|allemagne|italie|portugal|suisse|belgique|canada|australie)\b/i;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value: unknown) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return undefined;
  return parseLocalizedInteger(value);
}

function filterNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function lastNumber(query: string, regex: RegExp) {
  const matches = [...query.matchAll(regex)];
  return matches.length ? numeric(matches[matches.length - 1]?.[1]) : undefined;
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

function isFrenchPortal(url: string) {
  const domain = host(url);
  return FRENCH_PORTALS.some((portal) => domain === portal || domain.endsWith(`.${portal}`));
}

function looksCollection(result: Pick<SearchResult, "url" | "title" | "content">) {
  const title = norm(result.title);
  const content = norm(result.content);
  const combined = `${title} ${content}`;
  if (/^\d{1,6}\s+(maisons?|appartements?|biens?|annonces?|resultats?)\b/.test(title)) return true;
  if (/\b\d{2,6}\s+(annonces|biens|maisons|appartements|resultats)\b/.test(combined)) return true;
  if (/\b(resultats? de recherche|toutes les annonces|nos biens|liste des biens|voir les annonces|immobilier a vendre)\b/.test(combined)) return true;
  if (/\b(maisons?|appartements?)\s+a\s+vendre\b/.test(title) && !/\b(ref|reference|mandat|exclusivite|\d{5,})\b/.test(title)) return true;
  try {
    const parsed = new URL(result.url ?? "");
    const path = parsed.pathname.toLowerCase();
    const parts = path.split("/").filter(Boolean);
    if (/\/(recherche|search|annonces|biens|acheter|vente)\/?$/.test(path)) return true;
    if (parts.length <= 1 && /vente|acheter|immobilier|maison|appartement/.test(title)) return true;
  } catch {
    return true;
  }
  return false;
}

function kindOf(text: string): Listing["propertyKind"] {
  const q = norm(text);
  if (/\b(appartement|studio|duplex)\b/.test(q)) return "apartment";
  if (/\bvilla\b/.test(q)) return "villa";
  if (/programme neuf|construction neuve|neuf a construire/.test(q)) return "new_build_project";
  if (/\b(maison|pavillon|longere|propriete|demeure)\b/.test(q)) return "existing_house";
  return "unknown";
}

function typeCompatible(kind: Listing["propertyKind"], criteria: Criteria) {
  if (criteria.propertyType === "house" && kind === "apartment") return false;
  if (criteria.propertyType === "apartment" && (kind === "existing_house" || kind === "villa")) return false;
  return true;
}

function parseSurface(text: string, preferred?: number) {
  const candidates: Array<{ value: number; score: number }> = [];
  for (const match of text.matchAll(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|sqm|metres? carres?)\b/gi)) {
    const value = Number(String(match[1]).replace(",", "."));
    if (!Number.isFinite(value) || value < 15 || value > 700) continue;
    const index = match.index ?? 0;
    const around = norm(text.slice(Math.max(0, index - 100), index + match[0].length + 100));
    if (/terrain|parcelle|jardin de|surface terrain|terrain de/.test(around)) continue;
    let score = /habitable|surface habitable|carrez|surface utile/.test(around) ? 15 : 5;
    if (preferred) score += Math.max(0, 8 - Math.abs(value - preferred) / Math.max(25, preferred * 0.25));
    candidates.push({ value: Math.round(value * 10) / 10, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value;
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

function validImageUrl(value: string | undefined, pageUrl?: string) {
  if (!value) return undefined;
  try {
    const absolute = new URL(value, pageUrl).toString();
    const q = norm(absolute);
    if (!/^https?:\/\//i.test(absolute)) return undefined;
    if (/logo|favicon|sprite|placeholder|no[-_]?image|default|avatar|agent|agence|profil|tracking|pixel|banner|advert|cookie|map|floorplan|plan[-_]|icone|icon|portrait/.test(q)) return undefined;
    return absolute;
  } catch {
    return undefined;
  }
}

function strictSnippetPrice(text: string, surface?: number) {
  const parsed = parsePriceFromText(text, "EUR");
  if (!parsed.value || parsed.currency !== "EUR" || parsed.confidence === "none") return undefined;
  return sanitizePropertyPrice(parsed.value, "EUR", surface, parsed.confidence === "confirmed" ? "confirmed" : "snippet");
}

async function parseCriteria(query: string, filters: Filters): Promise<Criteria> {
  const q = norm(query);
  const location = await detectLocationWithAI(query, process.env.OPENAI_API_KEY);
  const minSurface = lastNumber(q, /(?:minimum|min\.?|au moins)\s*(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|sqm)/gi);
  const maxSurface = lastNumber(q, /(?:maximum|max\.?|jusqu(?:a|')a)\s*(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|sqm)/gi);
  const anySurface = lastNumber(q, /(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|sqm|metres? carres?)/gi);
  const minBedrooms = lastNumber(q, /(\d{1,2})\s*(?:chambres?|chambre)/gi);
  const minBathrooms = lastNumber(q, /(\d{1,2})\s*(?:sdb|salles? de bain)/gi);
  const minBudget = lastNumber(q, /(?:prix\s*)?(?:minimum|min\.?|au moins)\s*([\d\s.,]+)\s*(?:€|eur|euros?)?/gi);
  const maxBudget = lastNumber(q, /(?:moins de|sous|budget(?: max)?|prix\s*max(?:imum)?|maximum|max\.?)\s*([\d\s.,]+)\s*(?:€|eur|euros?)?/gi);
  const bareBudget = lastNumber(q, /([\d\s.,]{4,})\s*(?:€|eur|euros?)/gi);
  const propertyType = filters.propertyType ?? (/\b(appartement|studio)\b/.test(q) ? "apartment" : /\b(maison|villa|pavillon|longere)\b/.test(q) ? "house" : undefined);
  const city = location.city;

  return {
    category: "real_estate",
    intent: "buy",
    propertyType,
    city,
    country: "France",
    location: city ? `${city}, France` : "France",
    language: "fr",
    currency: "EUR",
    budgetMin: filterNumber(filters.budgetMin) ?? minBudget,
    budgetMax: filterNumber(filters.budgetMax) ?? maxBudget ?? (minBudget ? undefined : bareBudget),
    minSurface: filterNumber(filters.minSurface) ?? minSurface ?? (maxSurface ? undefined : anySurface),
    maxSurface: filterNumber(filters.maxSurface) ?? maxSurface,
    minBedrooms: filterNumber(filters.minBedrooms) ?? minBedrooms,
    minBathrooms: filterNumber(filters.minBathrooms) ?? minBathrooms,
    garden: filters.garden ?? /\bjardin\b/.test(q),
    garage: filters.garage ?? /\bgarage\b/.test(q),
    pool: filters.pool ?? /\bpiscine\b/.test(q),
    terrace: filters.terrace ?? /\bterrasse\b/.test(q),
    parking: filters.parking ?? /\bparking|stationnement\b/.test(q),
    requirements: [],
    preferences: [],
    sortPriority: filters.sortPriority ?? "best_match",
  };
}

async function searx(query: string, page = 1) {
  const base = (process.env.SEARXNG_URL ?? "http://localhost:8080").replace(/\/$/, "");
  try {
    const url = new URL(`${base}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("pageno", String(page));
    url.searchParams.set("language", "fr-FR");
    url.searchParams.set("safesearch", "0");
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(7500),
    });
    if (!response.ok) return [] as SearchResult[];
    const payload = (await response.json()) as { results?: SearchResult[] };
    return Array.isArray(payload.results) ? payload.results : [];
  } catch {
    return [] as SearchResult[];
  }
}

function searchQueries(criteria: Criteria, original: string) {
  const city = criteria.city ?? "France";
  const type = criteria.propertyType === "apartment" ? "appartement à vendre" : "maison à vendre";
  const budget = criteria.budgetMax ? `${Math.round(criteria.budgetMax)} euros` : "";
  const surface = criteria.minSurface ? `${Math.round(criteria.minSurface)} m2` : "";
  const bedrooms = criteria.minBedrooms ? `${criteria.minBedrooms} chambres` : "";
  const equipment = [criteria.garden ? "jardin" : "", criteria.garage ? "garage" : "", criteria.pool ? "piscine" : "", criteria.terrace ? "terrasse" : "", criteria.parking ? "parking" : ""].filter(Boolean).join(" ");

  const relaxedSurfaces = criteria.minSurface
    ? [0.65, 0.75, 0.85, 0.95, 1, 1.1, 1.2].map((factor) => `${city} ${type} ${Math.round(criteria.minSurface! * factor)} m2`)
    : [];
  const broad = [
    original,
    `${type} ${city}`,
    `${type} ${city} ${budget}`,
    `${type} ${city} ${bedrooms}`,
    `${type} ${city} ${surface}`,
    `${type} ${city} ${budget} ${bedrooms}`,
    `${type} ${city} ${surface} ${bedrooms}`,
    `immobilier ${city} ${type}`,
    `vente ${type} ${city} ${equipment}`,
  ];
  const portalQueries = FRENCH_PORTALS.slice(0, 16).map((domain) => `site:${domain} ${city} ${type}`);
  return [...new Set([...broad, ...relaxedSurfaces, ...portalQueries].map(clean).filter(Boolean))].slice(0, 30);
}

function dedupeResults(results: SearchResult[]) {
  const seen = new Set<string>();
  const output: SearchResult[] = [];
  for (const result of results) {
    if (!result.url) continue;
    const key = normalizeUrl(result.url);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(result);
  }
  return output;
}

function candidateFromResult(result: SearchResult, criteria: Criteria): Candidate | null {
  if (!result.url || !isFrenchPortal(result.url) || looksCollection(result)) return null;
  const url = normalizeUrl(result.url);
  const title = clean(result.title) || "Annonce immobilière";
  const description = clean(result.content);
  const text = `${title} ${description}`;
  const combined = norm(`${text} ${url}`);
  if (/location vacances|airbnb|hotel|emploi|actualite|programme tv/.test(combined)) return null;

  const kind = kindOf(text);
  if (!typeCompatible(kind, criteria)) return null;

  const surface = parseSurface(text, criteria.minSurface);
  const bedrooms = parseBedrooms(text);
  const bathrooms = parseBathrooms(text);
  const snippetPrice = strictSnippetPrice(text, surface);
  const cityMatched = criteria.city ? combined.includes(norm(criteria.city)) : true;
  const domain = host(url);

  let discoveryScore = PRIORITY_PORTALS.has(domain) ? 70 : 60;
  if (cityMatched) discoveryScore += 22;
  if (snippetPrice) discoveryScore += 10;
  if (criteria.budgetMax && snippetPrice) discoveryScore += snippetPrice <= criteria.budgetMax ? 8 : -18;
  if (criteria.minSurface && surface) discoveryScore += surface >= criteria.minSurface ? 8 : surface >= criteria.minSurface * 0.8 ? 2 : -6;
  if (criteria.minBedrooms && bedrooms) discoveryScore += bedrooms >= criteria.minBedrooms ? 6 : -4;

  return {
    url,
    title,
    description,
    source: domain,
    snippetPrice,
    snippetSurface: surface,
    snippetBedrooms: bedrooms,
    snippetBathrooms: bathrooms,
    propertyKind: kind,
    cityMatched,
    discoveryScore,
  };
}

async function fetchHtml(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return undefined;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return undefined;
    return (await response.text()).slice(0, 3_000_000);
  } catch {
    return undefined;
  }
}

function meta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return decodeHtml(value);
  }
  return undefined;
}

function structuredPrice(raw: unknown, surface?: number) {
  const value = numeric(raw);
  return sanitizePropertyPrice(value, "EUR", surface, "confirmed");
}

function collectImage(value: unknown, output: string[], pageUrl: string) {
  if (typeof value === "string") {
    const safe = validImageUrl(value, pageUrl);
    if (safe) output.push(safe);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImage(item, output, pageUrl);
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    collectImage(obj.url, output, pageUrl);
    collectImage(obj.contentUrl, output, pageUrl);
    collectImage(obj.thumbnailUrl, output, pageUrl);
  }
}

function parsePage(html: string, pageUrl: string, criteria: Criteria): PageDetails {
  const images: string[] = [];
  let price: number | undefined;
  let surface: number | undefined;
  let bedrooms: number | undefined;
  let bathrooms: number | undefined;

  const visit = (value: unknown, depth = 0) => {
    if (depth > 7) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    const rawType = Array.isArray(obj["@type"]) ? (obj["@type"] as unknown[]).join(" ") : obj["@type"];
    const type = norm(rawType);
    if (/itemlist|searchresults|collectionpage|breadcrumb/.test(type)) return;
    const relevant = /house|residence|singlefamily|apartment|realestate|product|accommodation|offer/.test(type);
    if (relevant) {
      const offersRaw = obj.offers as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
      const offer = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
      if (!price) price = structuredPrice(offer?.price ?? offer?.lowPrice ?? obj.price, surface);
      const floor = (obj.floorSize ?? obj.livingArea) as Record<string, unknown> | string | number | undefined;
      const floorValue = floor && typeof floor === "object" ? (floor as Record<string, unknown>).value : floor;
      const floorNumber = numeric(floorValue);
      if (!surface && floorNumber && floorNumber >= 15 && floorNumber <= 700) surface = floorNumber;
      const beds = numeric(obj.numberOfBedrooms);
      const baths = numeric(obj.numberOfBathroomsTotal ?? obj.numberOfBathrooms);
      if (!bedrooms && beds && beds <= 15) bedrooms = Math.round(beds);
      if (!bathrooms && baths && baths <= 10) bathrooms = Math.round(baths);
      collectImage(obj.image, images, pageUrl);
      collectImage(obj.photo, images, pageUrl);
      collectImage(obj.primaryImageOfPage, images, pageUrl);
    }
    if (obj["@graph"]) visit(obj["@graph"], depth + 1);
    if (obj.mainEntity) visit(obj.mainEntity, depth + 1);
  };

  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(decodeHtml(match[1] ?? "")));
    } catch {}
  }

  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = meta(html, "description") ?? meta(html, "og:description") ?? "";
  const visible = decodeHtml(`${title} ${description}`);
  surface = surface ?? parseSurface(visible, criteria.minSurface);
  bedrooms = bedrooms ?? parseBedrooms(visible);
  bathrooms = bathrooms ?? parseBathrooms(visible);

  if (!price) {
    const metaPrice = meta(html, "product:price:amount") ?? meta(html, "og:price:amount") ?? meta(html, "price");
    price = structuredPrice(metaPrice, surface);
  }
  if (!price) price = strictSnippetPrice(visible, surface);

  const ogImage = meta(html, "og:image") ?? meta(html, "twitter:image") ?? meta(html, "image");
  if (ogImage) collectImage(ogImage, images, pageUrl);

  return {
    price,
    surface,
    bedrooms,
    bathrooms,
    images: [...new Set(images)].slice(0, 8),
    text: visible,
  };
}

function passesHardFilters(listing: Listing, criteria: Criteria, filters: Filters) {
  const budgetMin = filterNumber(filters.budgetMin);
  const budgetMax = filterNumber(filters.budgetMax);
  const minSurface = filterNumber(filters.minSurface);
  const maxSurface = filterNumber(filters.maxSurface);
  const minBedrooms = filterNumber(filters.minBedrooms);
  const minBathrooms = filterNumber(filters.minBathrooms);

  const effectiveBudgetMin = budgetMin ?? criteria.budgetMin;
  const effectiveBudgetMax = budgetMax ?? criteria.budgetMax;
  if (effectiveBudgetMin !== undefined && listing.price < effectiveBudgetMin) return false;
  if (effectiveBudgetMax !== undefined && listing.price > effectiveBudgetMax) return false;

  if (minSurface !== undefined && (!listing.surface || listing.surface < minSurface)) return false;
  if (maxSurface !== undefined && (!listing.surface || listing.surface > maxSurface)) return false;
  if (minBedrooms !== undefined && (!listing.bedrooms || listing.bedrooms < minBedrooms)) return false;
  if (minBathrooms !== undefined && (!listing.bathrooms || listing.bathrooms < minBathrooms)) return false;
  if (filters.garden && !listing.garden) return false;
  if (filters.garage && !listing.garage) return false;
  if (filters.pool && !listing.pool) return false;
  if (filters.terrace && !listing.terrace) return false;
  if (filters.parking && !listing.parking) return false;
  return true;
}

function scoreListing(listing: Listing, criteria: Criteria) {
  let score = 55;
  if (listing.priceConfidence === "confirmed") score += 18;
  else score += 10;
  if (listing.images.length) score += 10;
  if (listing.surface) score += 4;
  if (listing.bedrooms) score += 4;
  if (criteria.minSurface && listing.surface) {
    const ratio = listing.surface / criteria.minSurface;
    score += ratio >= 1 ? 8 : ratio >= 0.85 ? 4 : -5;
  }
  if (criteria.minBedrooms && listing.bedrooms) score += listing.bedrooms >= criteria.minBedrooms ? 7 : -4;
  if (criteria.budgetMax) score += listing.price <= criteria.budgetMax ? 8 : -15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function enrichCandidate(candidate: Candidate, criteria: Criteria): Promise<Listing | null> {
  const html = await fetchHtml(candidate.url);
  const details = html ? parsePage(html, candidate.url, criteria) : undefined;
  const surface = details?.surface ?? candidate.snippetSurface;
  const bedrooms = details?.bedrooms ?? candidate.snippetBedrooms;
  const bathrooms = details?.bathrooms ?? candidate.snippetBathrooms;
  const pagePrice = details?.price;
  const price = pagePrice ?? candidate.snippetPrice;
  if (!price) return null;

  const pageText = `${candidate.title} ${candidate.description} ${details?.text ?? ""}`;
  const cityMatched = criteria.city ? norm(`${pageText} ${candidate.url}`).includes(norm(criteria.city)) : true;
  if (!cityMatched) return null;

  const detectedKind = kindOf(pageText);
  const kind = detectedKind === "unknown" ? candidate.propertyKind : detectedKind;
  if (!typeCompatible(kind, criteria)) return null;

  const images = details?.images ?? [];
  const listing: Listing = {
    id: "",
    url: candidate.url,
    source: candidate.source,
    parentSource: candidate.source,
    title: candidate.title,
    description: candidate.description,
    price,
    currency: "EUR",
    surface,
    bedrooms,
    bathrooms,
    location: criteria.location,
    garden: /\bjardin\b/i.test(pageText),
    garage: /\bgarage\b/i.test(pageText),
    pool: /\bpiscine\b/i.test(pageText),
    terrace: /\bterrasse\b/i.test(pageText),
    parking: /\bparking|stationnement\b/i.test(pageText),
    images,
    propertyKind: kind,
    matchScore: 0,
    valueScore: PRIORITY_PORTALS.has(candidate.source) ? 75 : 65,
    orbitScore: 0,
    reasons: [
      pagePrice ? "Prix vérifié sur la fiche de l'annonce" : "Prix présent sur le résultat exact de l'annonce",
      ...(images.length ? ["Photo récupérée depuis la fiche du bien"] : []),
    ],
    compromises: [
      ...(!surface ? ["Surface non indiquée"] : []),
      ...(!bedrooms ? ["Nombre de chambres non indiqué"] : []),
      ...(!images.length ? ["Photo non disponible"] : []),
    ],
    extractedAt: new Date().toISOString(),
    priceConfidence: pagePrice ? "confirmed" : "indexed",
    imageConfidence: images.length ? "confirmed" : "none",
    pricePerM2: surface ? Math.round(price / surface) : undefined,
  };
  listing.orbitScore = scoreListing(listing, criteria);
  listing.matchScore = listing.orbitScore;
  return listing;
}

function dedupeCandidates(candidates: Candidate[]) {
  const seen = new Set<string>();
  const output: Candidate[] = [];
  for (const candidate of candidates.sort((a, b) => b.discoveryScore - a.discoveryScore)) {
    const key = normalizeUrl(candidate.url);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(candidate);
  }
  return output;
}

function dedupeListings(listings: Listing[]) {
  const seen = new Set<string>();
  const output: Listing[] = [];
  for (const listing of listings) {
    const key = normalizeUrl(listing.url);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(listing);
  }
  return output;
}

function sortListings(listings: Listing[], criteria: Criteria) {
  if (criteria.sortPriority === "lowest_price") return [...listings].sort((a, b) => a.price - b.price);
  if (criteria.sortPriority === "largest") return [...listings].sort((a, b) => (b.surface ?? 0) - (a.surface ?? 0));
  return [...listings].sort((a, b) => b.orbitScore - a.orbitScore);
}

export async function franceSearchProxyV7(request: NextRequest) {
  try {
    const body = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return NextResponse.json({ success: false, error: "La recherche est vide." }, { status: 400 });
    if (FOREIGN_MARKERS.test(query) && !/\bfrance\b/i.test(query)) {
      return NextResponse.json({ success: false, error: "ORBIT recherche uniquement des biens situés en France." }, { status: 400 });
    }

    const filters = body.filters && typeof body.filters === "object" ? (body.filters as Filters) : {};
    const criteria = await parseCriteria(query, filters);
    const queries = searchQueries(criteria, query);

    let raw: SearchResult[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const active = page === 1 ? queries : queries.slice(0, 14);
      const batches = await Promise.all(active.map((search) => searx(search, page)));
      raw = dedupeResults([...raw, ...batches.flat()]);
      if (raw.length >= 500) break;
    }

    const candidates = dedupeCandidates(
      raw
        .map((result) => candidateFromResult(result, criteria))
        .filter((item): item is Candidate => Boolean(item)),
    ).slice(0, MAX_CANDIDATES);

    const accepted: Listing[] = [];
    let analyzed = 0;
    for (let index = 0; index < Math.min(MAX_ENRICH, candidates.length); index += ENRICH_BATCH) {
      const batchCandidates = candidates.slice(index, index + ENRICH_BATCH);
      const batch = await Promise.all(batchCandidates.map((candidate) => enrichCandidate(candidate, criteria)));
      analyzed += batchCandidates.length;
      for (const listing of batch) {
        if (!listing) continue;
        if (!passesHardFilters(listing, criteria, filters)) continue;
        accepted.push(listing);
      }
      const unique = dedupeListings(accepted);
      if (unique.length >= TARGET) break;
    }

    const listings = sortListings(dedupeListings(accepted), criteria)
      .slice(0, TARGET)
      .map((listing, index) => ({ ...listing, id: `listing-${index}` }));

    const sources = raw
      .filter((result) => result.url && isFrenchPortal(result.url))
      .slice(0, 120)
      .map((result, index) => ({
        id: `source-${index}`,
        title: clean(result.title) || host(result.url ?? ""),
        description: clean(result.content),
        url: result.url ?? "",
        position: index + 1,
        source: host(result.url ?? ""),
        sourceScore: Math.max(1, 100 - index),
      }));

    return NextResponse.json({
      success: true,
      query,
      searchQuery: queries[0] ?? query,
      criteria,
      sourceCount: sources.length,
      candidateCount: candidates.length,
      listingCount: listings.length,
      analyzedCandidateCount: analyzed,
      verifiedListingCount: listings.length,
      targetListingCount: TARGET,
      pageSize: 15,
      totalPages: Math.max(1, Math.ceil(listings.length / 15)),
      confirmedPriceCount: listings.filter((listing) => listing.priceConfidence === "confirmed").length,
      indexedPriceCount: listings.filter((listing) => listing.priceConfidence === "indexed").length,
      unconfirmedPriceCount: 0,
      photoCount: listings.filter((listing) => listing.images.length > 0).length,
      confirmedPhotoCount: listings.filter((listing) => listing.imageConfidence === "confirmed").length,
      sources,
      listings,
      searchEngineVersion: "FR-7.0",
      searchProvider: "SearXNG-France",
      scope: "France-only",
      pricePolicy: "Aucun résultat sans prix exploitable",
    });
  } catch (error) {
    console.error("ORBIT France v7 search error:", error);
    return NextResponse.json({
      success: false,
      error: "ORBIT France n'a pas pu effectuer la recherche.",
      sourceCount: 0,
      candidateCount: 0,
      listingCount: 0,
      sources: [],
      listings: [],
      searchProvider: "SearXNG-France",
    }, { status: 503 });
  }
}
