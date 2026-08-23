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
  propertyType?: string;
  sortPriority?: "best_match" | "lowest_price" | "largest";
};

type Criteria = {
  category: "real_estate";
  intent: "buy";
  propertyType?: string;
  city?: string;
  country: "France";
  location?: string;
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

type PriceConfidence = "confirmed" | "indexed" | "none";

type Listing = {
  id: string;
  url: string;
  source: string;
  parentSource: string;
  title: string;
  description: string;
  price?: number;
  currency: "EUR";
  surface?: number;
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
  images: string[];
  pricePerM2?: number;
  propertyKind: "existing_house" | "new_build_project" | "apartment" | "villa" | "unknown";
  matchScore: number;
  valueScore: number;
  orbitScore: number;
  reasons: string[];
  compromises: string[];
  extractedAt: string;
  priceConfidence: PriceConfidence;
  discoveryPrice?: number;
};

type PageDetails = {
  price?: number;
  surface?: number;
  bedrooms?: number;
  bathrooms?: number;
  images: string[];
  canonical?: string;
  text: string;
};

const TARGET = 10;
const MAX_ENRICH = 120;
const BATCH = 10;

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
];

const PRIORITY_PORTALS = [
  "safti.fr",
  "iadfrance.fr",
  "orpi.com",
  "efficity.com",
  "proprietes-privees.com",
  "ouestfrance-immo.com",
  "century21.fr",
  "fnaim.fr",
];

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

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((key) =>
      parsed.searchParams.delete(key),
    );
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return undefined;
  return parseLocalizedInteger(value);
}

function lastNumber(query: string, regex: RegExp) {
  const matches = [...query.matchAll(regex)];
  return matches.length ? numeric(matches.at(-1)?.[1]) : undefined;
}

async function parseCriteria(query: string, overrides: Filters): Promise<Criteria> {
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
  const propertyType = overrides.propertyType ?? (/\b(appartement|studio)\b/.test(q) ? "apartment" : /\b(maison|villa|pavillon)\b/.test(q) ? "house" : undefined);

  return {
    category: "real_estate",
    intent: "buy",
    propertyType,
    city: location.city,
    country: "France",
    location: location.city ? `${location.city}, France` : "France",
    language: "fr",
    currency: "EUR",
    budgetMin: numeric(overrides.budgetMin) ?? minBudget,
    budgetMax: numeric(overrides.budgetMax) ?? maxBudget ?? (minBudget ? undefined : bareBudget),
    minSurface: numeric(overrides.minSurface) ?? minSurface ?? (maxSurface ? undefined : anySurface),
    maxSurface: numeric(overrides.maxSurface) ?? maxSurface,
    minBedrooms: numeric(overrides.minBedrooms) ?? minBedrooms,
    minBathrooms: numeric(overrides.minBathrooms) ?? minBathrooms,
    garden: overrides.garden ?? /\bjardin\b/.test(q),
    garage: overrides.garage ?? /\bgarage\b/.test(q),
    pool: overrides.pool ?? /\bpiscine\b/.test(q),
    terrace: overrides.terrace ?? /\bterrasse\b/.test(q),
    parking: overrides.parking ?? /\bparking|stationnement\b/.test(q),
    requirements: [],
    preferences: [],
    sortPriority: overrides.sortPriority ?? "best_match",
  };
}

function parseSurface(text: string, preferred?: number) {
  const candidates: Array<{ value: number; score: number }> = [];
  for (const match of text.matchAll(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|sqm)\b/gi)) {
    const value = numeric(match[1]);
    if (!value || value < 15 || value > 700) continue;
    const index = match.index ?? 0;
    const around = norm(text.slice(Math.max(0, index - 90), index + match[0].length + 90));
    if (/terrain|parcelle|jardin de|terrain de|surface terrain/.test(around)) continue;
    let score = /habitable|surface habitable|loi carrez|surface carrez/.test(around) ? 12 : 4;
    if (preferred) score += Math.max(0, 4 - Math.abs(value - preferred) / Math.max(40, preferred));
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

function kindOf(text: string): Listing["propertyKind"] {
  const q = norm(text);
  if (/\bappartement|studio\b/.test(q)) return "apartment";
  if (/\bvilla\b/.test(q)) return "villa";
  if (/programme neuf|neuf a construire|construction neuve/.test(q)) return "new_build_project";
  if (/\bmaison|pavillon|longere|propriete\b/.test(q)) return "existing_house";
  return "unknown";
}

function isFrenchPortal(url: string) {
  const domain = host(url);
  return FRENCH_PORTALS.some((portal) => domain === portal || domain.endsWith(`.${portal}`));
}

function collectionLike(result: SearchResult) {
  const title = norm(result.title);
  const url = result.url ?? "";
  if (/\b\d{2,5}\s+(annonces|biens|maisons|resultats)\b/.test(title)) return true;
  if (/maisons? a vendre|immobilier a vendre|annonces immobilieres|resultats de recherche/.test(title) && !/\b(ref|reference|mandat|\d{5,})\b/.test(title)) return true;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length <= 1 && /vente|immobilier|maison/.test(title);
  } catch {
    return false;
  }
}

function candidateFromSearch(result: SearchResult, criteria: Criteria): Listing | null {
  if (!result.url || !isFrenchPortal(result.url) || collectionLike(result)) return null;
  const title = clean(result.title) || "Annonce immobilière";
  const description = clean(result.content);
  const text = `${title} ${description}`;
  if (/location vacances|airbnb|hotel|emploi|actualite/.test(norm(text))) return null;
  const surface = parseSurface(text, criteria.minSurface);
  const bedrooms = parseBedrooms(text);
  const bathrooms = parseBathrooms(text);
  const propertyKind = kindOf(text);
  const parsed = parsePriceFromText(text, "EUR");
  const discoveryPrice = parsed.confidence === "confirmed" ? sanitizePropertyPrice(parsed.value, "EUR", surface, parsed.confidence) : undefined;
  const cityMatch = criteria.city ? norm(`${text} ${result.url}`).includes(norm(criteria.city)) : true;
  let matchScore = 50 + (cityMatch ? 20 : -8);
  if (criteria.propertyType === "house") matchScore += propertyKind === "apartment" ? -35 : propertyKind === "existing_house" || propertyKind === "villa" ? 16 : 0;
  if (criteria.minSurface && surface) matchScore += surface >= criteria.minSurface ? 12 : Math.max(-12, -Math.round((criteria.minSurface - surface) / 8));
  if (criteria.minBedrooms && bedrooms) matchScore += bedrooms >= criteria.minBedrooms ? 8 : -8;
  const domain = host(result.url);
  const trust = PRIORITY_PORTALS.includes(domain) ? 14 : 7;
  matchScore = Math.max(0, Math.min(100, matchScore));
  const valueScore = Math.min(100, 50 + trust);
  return {
    id: "",
    url: normalizeUrl(result.url),
    source: domain,
    parentSource: domain,
    title,
    description,
    price: undefined,
    currency: "EUR",
    surface,
    bedrooms,
    bathrooms,
    location: criteria.location,
    garden: /\bjardin\b/i.test(text),
    garage: /\bgarage\b/i.test(text),
    pool: /\bpiscine\b/i.test(text),
    terrace: /\bterrasse\b/i.test(text),
    parking: /\bparking|stationnement\b/i.test(text),
    images: [],
    propertyKind,
    matchScore,
    valueScore,
    orbitScore: Math.round(matchScore * 0.8 + valueScore * 0.2),
    reasons: [],
    compromises: [],
    extractedAt: new Date().toISOString(),
    priceConfidence: "none",
    discoveryPrice,
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
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(6500) });
    if (!response.ok) return [] as SearchResult[];
    const payload = (await response.json()) as { results?: SearchResult[] };
    return Array.isArray(payload.results) ? payload.results : [];
  } catch {
    return [] as SearchResult[];
  }
}

function queriesFor(criteria: Criteria, original: string) {
  const city = criteria.city ?? "France";
  const surface = criteria.minSurface ? `${criteria.minSurface} m2` : "";
  const bedrooms = criteria.minBedrooms ? `${criteria.minBedrooms} chambres` : "";
  const budget = criteria.budgetMax ? `moins de ${criteria.budgetMax} euros` : "";
  const equipment = [criteria.garden ? "jardin" : "", criteria.garage ? "garage" : "", criteria.pool ? "piscine" : "", criteria.terrace ? "terrasse" : ""].filter(Boolean).join(" ");
  const base = [city, criteria.propertyType === "apartment" ? "appartement à vendre" : "maison à vendre", surface, bedrooms, budget, equipment].filter(Boolean).join(" ");
  const domainQueries = PRIORITY_PORTALS.map((domain) => `site:${domain} ${base}`);
  const broadDomains = FRENCH_PORTALS.slice(PRIORITY_PORTALS.length).map((domain) => `site:${domain} ${city} immobilier vente ${surface} ${bedrooms}`);
  const relaxed = criteria.minSurface ? [
    `${city} maison à vendre ${Math.max(30, Math.round(criteria.minSurface * 0.8))} m2 ${bedrooms}`,
    `${city} maison à vendre ${Math.round(criteria.minSurface * 1.2)} m2 ${bedrooms}`,
  ] : [];
  return [...new Set([original, base, `${city} immobilier maison vente`, ...relaxed, ...domainQueries, ...broadDomains])].map(clean).filter(Boolean).slice(0, 18);
}

function dedupe(results: SearchResult[]) {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const result of results) {
    if (!result.url) continue;
    const key = normalizeUrl(result.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result);
  }
  return out;
}

async function fetchHtml(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) return undefined;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return undefined;
    return (await response.text()).slice(0, 2_500_000);
  } catch {
    return undefined;
  }
}

function absoluteUrl(value: string, pageUrl: string) {
  try {
    return new URL(value, pageUrl).toString();
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

function validImage(url: string | undefined, pageUrl: string) {
  if (!url) return false;
  const absolute = absoluteUrl(url, pageUrl);
  if (!absolute || !/^https?:\/\//i.test(absolute)) return false;
  const q = norm(absolute);
  if (/logo|favicon|sprite|placeholder|no[-_]?image|default|avatar|agent|agence|profil|tracking|pixel|banner|advert|cookie|map|floorplan|plan[-_]/.test(q)) return false;
  return /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(absolute) || /image|photo|media|cdn/.test(q);
}

function collectImages(value: unknown, out: string[], pageUrl: string) {
  if (typeof value === "string") {
    const url = absoluteUrl(value, pageUrl);
    if (url && validImage(url, pageUrl)) out.push(url);
  } else if (Array.isArray(value)) {
    for (const item of value) collectImages(item, out, pageUrl);
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    collectImages(obj.url, out, pageUrl);
    collectImages(obj.contentUrl, out, pageUrl);
    collectImages(obj.thumbnailUrl, out, pageUrl);
  }
}

function structuredPrice(raw: unknown, surface?: number) {
  const value = numeric(raw);
  return sanitizePropertyPrice(value, "EUR", surface, "confirmed");
}

function parsePage(html: string, pageUrl: string, criteria: Criteria): PageDetails {
  const images: string[] = [];
  let price: number | undefined;
  let surface: number | undefined;
  let bedrooms: number | undefined;
  let bathrooms: number | undefined;

  const visit = (value: unknown, depth = 0) => {
    if (depth > 6) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    const type = norm(Array.isArray(obj["@type"]) ? (obj["@type"] as unknown[]).join(" ") : obj["@type"]);
    const relevant = /house|residence|singlefamily|apartment|realestate|product|accommodation|offer/.test(type);
    if (relevant) {
      const offers = obj.offers as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
      const offer = Array.isArray(offers) ? offers[0] : offers;
      if (!price) price = structuredPrice(offer?.price ?? offer?.lowPrice ?? obj.price, surface);
      const floor = (obj.floorSize ?? obj.livingArea) as Record<string, unknown> | string | number | undefined;
      const floorValue = floor && typeof floor === "object" ? (floor as Record<string, unknown>).value : floor;
      const floorNumber = numeric(floorValue);
      if (!surface && floorNumber && floorNumber >= 15 && floorNumber <= 700) surface = floorNumber;
      const beds = numeric(obj.numberOfBedrooms);
      const baths = numeric(obj.numberOfBathroomsTotal ?? obj.numberOfBathrooms);
      if (!bedrooms && beds && beds <= 15) bedrooms = Math.round(beds);
      if (!bathrooms && baths && baths <= 10) bathrooms = Math.round(baths);
      collectImages(obj.image, images, pageUrl);
      collectImages(obj.photo, images, pageUrl);
      collectImages(obj.primaryImageOfPage, images, pageUrl);
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
  const metas = [...html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1] ?? "").join(" ");
  const visible = decodeHtml(`${title} ${metas}`);
  surface = surface ?? parseSurface(visible, criteria.minSurface);

  if (!price) {
    const metaPrice = meta(html, "product:price:amount") ?? meta(html, "og:price:amount") ?? meta(html, "price");
    price = structuredPrice(metaPrice, surface);
  }

  if (!price) {
    const jsonPatterns = [
      /["'](?:price|prix|salePrice|sellingPrice|listingPrice|askingPrice)["']\s*:\s*["']?([\d\s.,]{4,12})["']?/gi,
      /["'](?:priceValue|price_value)["']\s*:\s*["']?([\d\s.,]{4,12})["']?/gi,
    ];
    for (const pattern of jsonPatterns) {
      for (const match of html.matchAll(pattern)) {
        const index = match.index ?? 0;
        const around = norm(html.slice(Math.max(0, index - 120), index + match[0].length + 120));
        if (/loyer|mensuel|month|taxe|honoraire|charges|prix.?m2|price.?m2/.test(around)) continue;
        const candidate = structuredPrice(match[1], surface);
        if (candidate) {
          price = candidate;
          break;
        }
      }
      if (price) break;
    }
  }

  const ogImage = meta(html, "og:image") ?? meta(html, "twitter:image");
  if (ogImage) collectImages(ogImage, images, pageUrl);

  const textPrice = parsePriceFromText(visible, "EUR");
  if (!price && textPrice.confidence === "confirmed") price = sanitizePropertyPrice(textPrice.value, "EUR", surface, textPrice.confidence);

  bedrooms = bedrooms ?? parseBedrooms(visible);
  bathrooms = bathrooms ?? parseBathrooms(visible);

  return {
    price,
    surface,
    bedrooms,
    bathrooms,
    images: [...new Set(images)].slice(0, 6),
    canonical: meta(html, "og:url"),
    text: visible,
  };
}

async function verifyImage(url: string) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", Range: "bytes=0-2048", "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok && response.status !== 206) return false;
    const type = response.headers.get("content-type") ?? "";
    return type.startsWith("image/") && !/svg|icon/.test(type);
  } catch {
    return false;
  }
}

async function enrich(listing: Listing, criteria: Criteria): Promise<Listing> {
  const html = await fetchHtml(listing.url);
  if (!html) return listing;
  const details = parsePage(html, listing.url, criteria);
  const surface = details.surface ?? listing.surface;
  let price = details.price;
  let confidence: PriceConfidence = price ? "confirmed" : "none";
  if (!price && listing.discoveryPrice) {
    price = listing.discoveryPrice;
    confidence = "indexed";
  }
  if (price && criteria.budgetMax && price > criteria.budgetMax * 1.05) return { ...listing, price: undefined, priceConfidence: "none", images: [] };
  const checked: string[] = [];
  for (const image of details.images.slice(0, 4)) {
    if (await verifyImage(image)) checked.push(image);
    if (checked.length >= 2) break;
  }
  const text = `${listing.title} ${listing.description} ${details.text}`;
  return {
    ...listing,
    price,
    surface,
    bedrooms: details.bedrooms ?? listing.bedrooms,
    bathrooms: details.bathrooms ?? listing.bathrooms,
    images: checked,
    pricePerM2: price && surface ? Math.round(price / surface) : undefined,
    priceConfidence: confidence,
    garden: listing.garden || /\bjardin\b/i.test(text),
    garage: listing.garage || /\bgarage\b/i.test(text),
    pool: listing.pool || /\bpiscine\b/i.test(text),
    terrace: listing.terrace || /\bterrasse\b/i.test(text),
    parking: listing.parking || /\bparking|stationnement\b/i.test(text),
    reasons: [
      ...(confidence === "confirmed" ? ["Prix vérifié sur la fiche française"] : confidence === "indexed" ? ["Prix recoupé dans l'index"] : []),
      ...(checked.length ? ["Photo provenant de la fiche du bien"] : []),
    ],
    compromises: [
      ...(price ? [] : ["Prix non confirmé"]),
      ...(checked.length ? [] : ["Photo non confirmée"]),
    ],
  };
}

function score(listing: Listing, criteria: Criteria) {
  let score = listing.orbitScore;
  if (listing.priceConfidence === "confirmed") score += 28;
  else if (listing.priceConfidence === "indexed") score += 16;
  if (listing.images.length) score += 22;
  if (listing.surface) score += 4;
  if (criteria.minSurface && listing.surface) score -= Math.min(18, Math.abs(listing.surface - criteria.minSurface) / 4);
  if (criteria.minBedrooms && listing.bedrooms) score -= Math.max(0, criteria.minBedrooms - listing.bedrooms) * 5;
  return score;
}

function acceptable(listing: Listing, criteria: Criteria) {
  if (!listing.price || !listing.images.length) return false;
  if (criteria.propertyType === "house" && listing.propertyKind === "apartment") return false;
  if (criteria.propertyType === "apartment" && listing.propertyKind === "existing_house") return false;
  if (criteria.city && !norm(`${listing.title} ${listing.description} ${listing.location} ${listing.url}`).includes(norm(criteria.city))) return false;
  if (criteria.budgetMin && listing.price < criteria.budgetMin) return false;
  if (criteria.budgetMax && listing.price > criteria.budgetMax * 1.05) return false;
  if (criteria.maxSurface && listing.surface && listing.surface > criteria.maxSurface * 1.15) return false;
  return true;
}

function sortFinal(listings: Listing[], criteria: Criteria) {
  if (criteria.sortPriority === "lowest_price") return [...listings].sort((a, b) => (a.price ?? 1e15) - (b.price ?? 1e15));
  if (criteria.sortPriority === "largest") return [...listings].sort((a, b) => (b.surface ?? 0) - (a.surface ?? 0));
  return [...listings].sort((a, b) => score(b, criteria) - score(a, criteria));
}

export async function franceSearchProxy(request: NextRequest) {
  try {
    const body = await request.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const filters = body?.filters && typeof body.filters === "object" ? (body.filters as Filters) : {};
    if (!query) return NextResponse.json({ success: false, error: "La recherche est vide." }, { status: 400 });

    const criteria = await parseCriteria(query, filters);
    const queries = queriesFor(criteria, query);
    let raw: SearchResult[] = [];
    for (let page = 1; page <= 4; page += 1) {
      const active = page <= 2 ? queries : queries.slice(0, 12);
      const batches = await Promise.all(active.map((q) => searx(q, page)));
      raw = dedupe([...raw, ...batches.flat()]);
      if (raw.length >= 180) break;
    }

    let candidates = raw.map((result) => candidateFromSearch(result, criteria)).filter((item): item is Listing => Boolean(item));
    candidates.sort((a, b) => score(b, criteria) - score(a, criteria));

    const verified: Listing[] = [];
    const enriched: Listing[] = [];
    for (let i = 0; i < Math.min(candidates.length, MAX_ENRICH); i += BATCH) {
      const batch = await Promise.all(candidates.slice(i, i + BATCH).map((listing) => enrich(listing, criteria)));
      enriched.push(...batch);
      for (const item of batch) {
        if (acceptable(item, criteria) && !verified.some((existing) => normalizeUrl(existing.url) === normalizeUrl(item.url))) verified.push(item);
      }
      if (verified.length >= TARGET) break;
    }

    let listings = sortFinal(verified, criteria).slice(0, TARGET);
    listings = listings.map((listing, index) => ({ ...listing, id: `listing-${index}` }));

    const sources = raw.slice(0, 40).map((source, index) => ({
      id: `source-${index}`,
      title: clean(source.title) || host(source.url ?? ""),
      description: clean(source.content),
      url: source.url ?? "",
      position: index + 1,
      source: host(source.url ?? ""),
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
      analyzedCandidateCount: Math.min(candidates.length, MAX_ENRICH),
      snippetListingCount: candidates.length,
      enrichedListingCount: enriched.length,
      recoveryPoolCount: enriched.length,
      verifiedListingCount: verified.length,
      targetListingCount: TARGET,
      confirmedPriceCount: listings.filter((listing) => listing.priceConfidence === "confirmed").length,
      photoCount: listings.filter((listing) => listing.images.length > 0).length,
      creditsUsed: null,
      sources,
      listings,
      searchEngineVersion: "FR-1.0",
      searchProvider: "SearXNG-France",
      scope: "France-only",
    });
  } catch (error) {
    console.error("ORBIT France search error:", error);
    return NextResponse.json({ success: false, error: "ORBIT France n'a pas pu effectuer la recherche.", sourceCount: 0, candidateCount: 0, listingCount: 0, sources: [], listings: [], searchProvider: "SearXNG-France", creditsUsed: null }, { status: 503 });
  }
}
