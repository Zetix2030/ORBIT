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

type PriceConfidence = "confirmed" | "indexed" | "none";
type ImageConfidence = "confirmed" | "indexed" | "none";

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
  imageConfidence: ImageConfidence;
  discoveryPrice?: number;
  discoveryImage?: string;
  cityMatched: boolean;
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
const MAX_RESULTS = 260;
const MAX_ENRICH = 100;
const BATCH = 8;

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
  "agence.immo",
];

const PRIORITY_PORTALS = [
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
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((key) => parsed.searchParams.delete(key));
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
  return matches.length ? numeric(matches[matches.length - 1]?.[1]) : undefined;
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
  const propertyType = overrides.propertyType ?? (/\b(appartement|studio)\b/.test(q) ? "apartment" : /\b(maison|villa|pavillon|longere)\b/.test(q) ? "house" : undefined);
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
    const around = norm(text.slice(Math.max(0, index - 100), index + match[0].length + 100));
    if (/terrain|parcelle|jardin de|surface terrain|terrain de/.test(around)) continue;
    let score = /habitable|surface habitable|carrez|surface utile/.test(around) ? 14 : 5;
    if (preferred) score += Math.max(0, 5 - Math.abs(value - preferred) / Math.max(35, preferred * 0.35));
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
  if (/\b(appartement|studio)\b/.test(q)) return "apartment";
  if (/\bvilla\b/.test(q)) return "villa";
  if (/programme neuf|construction neuve|neuf a construire/.test(q)) return "new_build_project";
  if (/\b(maison|pavillon|longere|propriete)\b/.test(q)) return "existing_house";
  return "unknown";
}

function isFrenchPortal(url: string) {
  const domain = host(url);
  return FRENCH_PORTALS.some((portal) => domain === portal || domain.endsWith(`.${portal}`));
}

function looksCollection(result: SearchResult) {
  const title = norm(result.title);
  const content = norm(result.content);
  const combined = `${title} ${content}`;
  if (/\b\d{2,6}\s+(annonces|biens|maisons|appartements|resultats)\b/.test(combined)) return true;
  if (/maisons? a vendre|appartements? a vendre|annonces immobilieres|resultats de recherche|immobilier a vendre/.test(title) && !/\b(ref|reference|mandat|id|\d{5,})\b/.test(title)) return true;
  try {
    const parts = new URL(result.url ?? "").pathname.split("/").filter(Boolean);
    if (parts.length <= 1 && /vente|acheter|immobilier|maison|appartement/.test(title)) return true;
  } catch {}
  return false;
}

function validImageUrl(value: string | undefined, pageUrl?: string) {
  if (!value) return undefined;
  try {
    const absolute = new URL(value, pageUrl).toString();
    const q = norm(absolute);
    if (!/^https?:\/\//i.test(absolute)) return undefined;
    if (/logo|favicon|sprite|placeholder|no[-_]?image|default|avatar|agent|agence|profil|tracking|pixel|banner|advert|cookie|map|floorplan|plan[-_]|icone|icon/.test(q)) return undefined;
    return absolute;
  } catch {
    return undefined;
  }
}

function strictSnippetPrice(text: string, surface?: number) {
  const parsed = parsePriceFromText(text, "EUR");
  if (!parsed.value || parsed.currency !== "EUR") return undefined;
  if (parsed.confidence === "none") return undefined;
  return sanitizePropertyPrice(parsed.value, "EUR", surface, parsed.confidence === "confirmed" ? "confirmed" : "snippet");
}

function candidateFromSearch(result: SearchResult, criteria: Criteria): Listing | null {
  if (!result.url || !isFrenchPortal(result.url) || looksCollection(result)) return null;
  const title = clean(result.title) || "Annonce immobilière";
  const description = clean(result.content);
  const text = `${title} ${description}`;
  const normalized = norm(text);
  if (/location vacances|airbnb|hotel|emploi|actualite|programme tv/.test(normalized)) return null;

  const surface = parseSurface(text, criteria.minSurface);
  const bedrooms = parseBedrooms(text);
  const bathrooms = parseBathrooms(text);
  const propertyKind = kindOf(text);
  const discoveryPrice = strictSnippetPrice(text, surface);
  const discoveryImage = validImageUrl(result.img_src ?? result.thumbnail, result.url);
  const cityMatched = criteria.city ? norm(`${text} ${result.url}`).includes(norm(criteria.city)) : true;
  const domain = host(result.url);

  let matchScore = 52;
  matchScore += cityMatched ? 20 : -10;
  if (criteria.propertyType === "house") {
    if (propertyKind === "apartment") matchScore -= 38;
    if (propertyKind === "existing_house" || propertyKind === "villa") matchScore += 15;
  }
  if (criteria.propertyType === "apartment") {
    if (propertyKind === "existing_house" || propertyKind === "villa") matchScore -= 38;
    if (propertyKind === "apartment") matchScore += 15;
  }
  if (criteria.minSurface && surface) {
    const ratio = surface / criteria.minSurface;
    matchScore += ratio >= 1 ? 11 : ratio >= 0.85 ? 5 : ratio >= 0.7 ? -3 : -10;
  }
  if (criteria.minBedrooms && bedrooms) matchScore += bedrooms >= criteria.minBedrooms ? 8 : -5 * (criteria.minBedrooms - bedrooms);
  if (discoveryPrice) matchScore += 6;
  if (discoveryImage) matchScore += 4;
  matchScore = Math.max(0, Math.min(100, matchScore));

  const trust = PRIORITY_PORTALS.includes(domain) ? 68 : 58;
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
    valueScore: trust,
    orbitScore: Math.round(matchScore * 0.78 + trust * 0.22),
    reasons: [],
    compromises: [],
    extractedAt: new Date().toISOString(),
    priceConfidence: "none",
    imageConfidence: "none",
    discoveryPrice,
    discoveryImage,
    cityMatched,
  };
}

async function searx(query: string, page: number) {
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
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return [] as SearchResult[];
    const payload = (await response.json()) as { results?: SearchResult[] };
    return Array.isArray(payload.results) ? payload.results : [];
  } catch {
    return [] as SearchResult[];
  }
}

function queriesFor(criteria: Criteria, original: string) {
  const city = criteria.city ?? "France";
  const type = criteria.propertyType === "apartment" ? "appartement à vendre" : "maison à vendre";
  const surface = criteria.minSurface ? `${criteria.minSurface} m2` : "";
  const bedrooms = criteria.minBedrooms ? `${criteria.minBedrooms} chambres` : "";
  const budget = criteria.budgetMax ? `${Math.round(criteria.budgetMax)} euros` : "";
  const equipment = [criteria.garden ? "jardin" : "", criteria.garage ? "garage" : "", criteria.pool ? "piscine" : "", criteria.terrace ? "terrasse" : ""].filter(Boolean).join(" ");
  const core = [city, type, surface, bedrooms, budget, equipment].filter(Boolean).join(" ");
  const relaxedSurface = criteria.minSurface
    ? [0.7, 0.85, 1, 1.15, 1.3].map((factor) => `${city} ${type} ${Math.round(criteria.minSurface! * factor)} m2 ${bedrooms}`)
    : [];
  const broad = [
    `${city} ${type}`,
    `${city} immobilier vente maison`,
    `${city} maison vente ${bedrooms}`,
    `${city} maison vente ${surface}`,
    `${city} maison ${budget}`,
  ];
  const portalQueries = FRENCH_PORTALS.map((domain) => `site:${domain} ${core}`);
  return [...new Set([original, core, ...broad, ...relaxedSurface, ...portalQueries])]
    .map(clean)
    .filter(Boolean)
    .slice(0, 30);
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
      signal: AbortSignal.timeout(7500),
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

function collectImage(value: unknown, out: string[], pageUrl: string) {
  if (typeof value === "string") {
    const url = validImageUrl(value, pageUrl);
    if (url) out.push(url);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImage(item, out, pageUrl);
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    collectImage(obj.url, out, pageUrl);
    collectImage(obj.contentUrl, out, pageUrl);
    collectImage(obj.thumbnailUrl, out, pageUrl);
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
    const relevant = /house|residence|singlefamily|apartment|realestate|product|accommodation|offer|place/.test(type);
    if (relevant) {
      const offersRaw = obj.offers as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
      const offer = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
      if (!price) price = structuredPrice(offer?.price ?? offer?.lowPrice ?? obj.price, surface);
      const floor = (obj.floorSize ?? obj.livingArea ?? obj.area) as Record<string, unknown> | string | number | undefined;
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

  if (!price) {
    const metaPrice = meta(html, "product:price:amount") ?? meta(html, "og:price:amount") ?? meta(html, "price");
    price = structuredPrice(metaPrice, surface);
  }

  if (!price) {
    const patterns = [
      /["'](?:price|prix|salePrice|sellingPrice|listingPrice|askingPrice)["']\s*:\s*["']?([\d\s.,]{4,12})["']?/gi,
      /(?:prix|price)[^\d]{0,25}([\d\s.,]{4,12})\s*(?:€|EUR)/gi,
    ];
    for (const pattern of patterns) {
      for (const match of html.matchAll(pattern)) {
        const index = match.index ?? 0;
        const around = norm(html.slice(Math.max(0, index - 140), index + match[0].length + 140));
        if (/loyer|mensuel|mois|taxe|honoraire|charges|prix.?m2|price.?m2|estimation/.test(around)) continue;
        const candidate = structuredPrice(match[1], surface);
        if (candidate) {
          price = candidate;
          break;
        }
      }
      if (price) break;
    }
  }

  const ogImage = meta(html, "og:image") ?? meta(html, "twitter:image") ?? meta(html, "image");
  if (ogImage) collectImage(ogImage, images, pageUrl);
  for (const match of html.matchAll(/<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi)) {
    const url = validImageUrl(match[1], pageUrl);
    if (url) images.push(url);
    if (images.length >= 12) break;
  }

  const textPrice = strictSnippetPrice(visible, surface);
  if (!price && textPrice) price = textPrice;
  bedrooms = bedrooms ?? parseBedrooms(visible);
  bathrooms = bathrooms ?? parseBathrooms(visible);

  return {
    price,
    surface,
    bedrooms,
    bathrooms,
    images: [...new Set(images)].slice(0, 8),
    canonical: meta(html, "og:url"),
    text: visible,
  };
}

async function imageReachable(url: string) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Range: "bytes=0-1024",
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(3000),
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
  let details: PageDetails | undefined;
  if (html) details = parsePage(html, listing.url, criteria);

  const surface = details?.surface ?? listing.surface;
  let price = details?.price;
  let priceConfidence: PriceConfidence = price ? "confirmed" : "none";
  if (!price && listing.discoveryPrice) {
    price = listing.discoveryPrice;
    priceConfidence = "indexed";
  }
  if (price && criteria.budgetMax && price > criteria.budgetMax * 1.15) {
    price = undefined;
    priceConfidence = "none";
  }
  if (price && criteria.budgetMin && price < criteria.budgetMin * 0.85) {
    price = undefined;
    priceConfidence = "none";
  }

  const directImages = details?.images ?? [];
  const checked: string[] = [];
  for (const image of directImages.slice(0, 5)) {
    if (await imageReachable(image)) checked.push(image);
    else if (validImageUrl(image, listing.url)) checked.push(image);
    if (checked.length >= 2) break;
  }

  let imageConfidence: ImageConfidence = checked.length ? "confirmed" : "none";
  if (!checked.length && listing.discoveryImage) {
    const indexed = validImageUrl(listing.discoveryImage, listing.url);
    if (indexed) {
      checked.push(indexed);
      imageConfidence = "indexed";
    }
  }

  const combined = `${listing.title} ${listing.description} ${details?.text ?? ""}`;
  const cityMatched = criteria.city ? norm(`${combined} ${listing.url}`).includes(norm(criteria.city)) : true;
  const bedrooms = details?.bedrooms ?? listing.bedrooms;
  const bathrooms = details?.bathrooms ?? listing.bathrooms;
  const propertyKind = kindOf(combined) === "unknown" ? listing.propertyKind : kindOf(combined);

  return {
    ...listing,
    price,
    surface,
    bedrooms,
    bathrooms,
    images: checked,
    propertyKind,
    pricePerM2: price && surface ? Math.round(price / surface) : undefined,
    priceConfidence,
    imageConfidence,
    cityMatched,
    garden: listing.garden || /\bjardin\b/i.test(combined),
    garage: listing.garage || /\bgarage\b/i.test(combined),
    pool: listing.pool || /\bpiscine\b/i.test(combined),
    terrace: listing.terrace || /\bterrasse\b/i.test(combined),
    parking: listing.parking || /\bparking|stationnement\b/i.test(combined),
    reasons: [
      ...(priceConfidence === "confirmed" ? ["Prix vérifié sur la fiche de l'annonce"] : priceConfidence === "indexed" ? ["Prix recoupé sur le résultat exact de l'annonce"] : []),
      ...(imageConfidence === "confirmed" ? ["Photo récupérée depuis la fiche du bien"] : imageConfidence === "indexed" ? ["Photo rattachée au résultat exact de l'annonce"] : []),
    ],
    compromises: [
      ...(price ? [] : ["Prix non confirmé"]),
      ...(checked.length ? [] : ["Photo non disponible"]),
      ...(criteria.minSurface && surface && surface < criteria.minSurface ? [`Surface inférieure au souhait (${surface} m²)`] : []),
      ...(criteria.minBedrooms && bedrooms && bedrooms < criteria.minBedrooms ? [`${bedrooms} chambre(s) au lieu de ${criteria.minBedrooms}`] : []),
    ],
  };
}

function qualityScore(listing: Listing, criteria: Criteria) {
  let value = listing.orbitScore;
  if (listing.priceConfidence === "confirmed") value += 26;
  else if (listing.priceConfidence === "indexed") value += 14;
  if (listing.imageConfidence === "confirmed") value += 18;
  else if (listing.imageConfidence === "indexed") value += 9;
  if (listing.cityMatched) value += 10;
  if (listing.surface) value += 4;
  if (listing.bedrooms) value += 3;
  if (criteria.minSurface && listing.surface) value -= Math.min(18, Math.abs(listing.surface - criteria.minSurface) / 5);
  if (criteria.minBedrooms && listing.bedrooms) value -= Math.max(0, criteria.minBedrooms - listing.bedrooms) * 5;
  return value;
}

function typeCompatible(listing: Listing, criteria: Criteria) {
  if (criteria.propertyType === "house" && listing.propertyKind === "apartment") return false;
  if (criteria.propertyType === "apartment" && (listing.propertyKind === "existing_house" || listing.propertyKind === "villa")) return false;
  return true;
}

function hardAccept(listing: Listing, criteria: Criteria) {
  if (!listing.price || !typeCompatible(listing, criteria)) return false;
  if (!listing.cityMatched) return false;
  if (criteria.budgetMax && listing.price > criteria.budgetMax * 1.08) return false;
  if (criteria.budgetMin && listing.price < criteria.budgetMin * 0.92) return false;
  return true;
}

function relaxedAccept(listing: Listing, criteria: Criteria) {
  if (!listing.price || !typeCompatible(listing, criteria)) return false;
  if (criteria.budgetMax && listing.price > criteria.budgetMax * 1.15) return false;
  if (criteria.budgetMin && listing.price < criteria.budgetMin * 0.85) return false;
  return listing.cityMatched || qualityScore(listing, criteria) >= 72;
}

function sortFinal(listings: Listing[], criteria: Criteria) {
  if (criteria.sortPriority === "lowest_price") return [...listings].sort((a, b) => (a.price ?? 1e15) - (b.price ?? 1e15));
  if (criteria.sortPriority === "largest") return [...listings].sort((a, b) => (b.surface ?? 0) - (a.surface ?? 0));
  return [...listings].sort((a, b) => qualityScore(b, criteria) - qualityScore(a, criteria));
}

function uniqueListings(listings: Listing[]) {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const output: Listing[] = [];
  for (const listing of listings) {
    const url = normalizeUrl(listing.url);
    const titleKey = norm(listing.title).replace(/\d+/g, "#").slice(0, 110);
    if (seenUrls.has(url)) continue;
    if (titleKey.length > 25 && seenTitles.has(titleKey)) continue;
    seenUrls.add(url);
    if (titleKey.length > 25) seenTitles.add(titleKey);
    output.push(listing);
  }
  return output;
}

export async function franceSearchProxyV2(request: NextRequest) {
  try {
    const body = await request.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const filters = body?.filters && typeof body.filters === "object" ? (body.filters as Filters) : {};
    if (!query) return NextResponse.json({ success: false, error: "La recherche est vide." }, { status: 400 });

    const criteria = await parseCriteria(query, filters);
    const queries = queriesFor(criteria, query);
    let raw: SearchResult[] = [];

    for (let page = 1; page <= 5; page += 1) {
      const active = page <= 2 ? queries : queries.slice(0, 18);
      const batches = await Promise.all(active.map((q) => searx(q, page)));
      raw = dedupeResults([...raw, ...batches.flat()]);
      if (raw.length >= MAX_RESULTS) break;
    }

    let candidates = raw
      .map((result) => candidateFromSearch(result, criteria))
      .filter((item): item is Listing => Boolean(item));
    candidates = uniqueListings(candidates).sort((a, b) => qualityScore(b, criteria) - qualityScore(a, criteria));

    const enriched: Listing[] = [];
    for (let i = 0; i < Math.min(MAX_ENRICH, candidates.length); i += BATCH) {
      const batch = await Promise.all(candidates.slice(i, i + BATCH).map((listing) => enrich(listing, criteria)));
      enriched.push(...batch);
      const currentStrong = uniqueListings(enriched).filter((item) => hardAccept(item, criteria));
      if (currentStrong.filter((item) => item.images.length > 0).length >= TARGET) break;
    }

    const all = uniqueListings(enriched);
    const strongWithImages = sortFinal(all.filter((item) => hardAccept(item, criteria) && item.images.length > 0), criteria);
    const strongWithoutImages = sortFinal(all.filter((item) => hardAccept(item, criteria) && !item.images.length), criteria);
    const relaxedWithImages = sortFinal(all.filter((item) => !hardAccept(item, criteria) && relaxedAccept(item, criteria) && item.images.length > 0), criteria);
    const relaxedWithoutImages = sortFinal(all.filter((item) => !hardAccept(item, criteria) && relaxedAccept(item, criteria) && !item.images.length), criteria);

    let listings = uniqueListings([
      ...strongWithImages,
      ...relaxedWithImages,
      ...strongWithoutImages,
      ...relaxedWithoutImages,
    ]).slice(0, TARGET);

    if (listings.length < TARGET) {
      const fallback = sortFinal(
        candidates.filter((item) => item.discoveryPrice && typeCompatible(item, criteria) && (item.cityMatched || !criteria.city)),
        criteria,
      ).map((item) => ({
        ...item,
        price: item.discoveryPrice,
        priceConfidence: item.discoveryPrice ? "indexed" as const : "none" as const,
        images: item.discoveryImage ? [item.discoveryImage] : [],
        imageConfidence: item.discoveryImage ? "indexed" as const : "none" as const,
        reasons: [
          ...(item.discoveryPrice ? ["Prix recoupé sur le résultat exact de l'annonce"] : []),
          ...(item.discoveryImage ? ["Photo rattachée au résultat exact de l'annonce"] : []),
        ],
      }));
      listings = uniqueListings([...listings, ...fallback]).slice(0, TARGET);
    }

    listings = listings.map((listing, index) => ({
      ...listing,
      id: `listing-${index}`,
      orbitScore: Math.max(0, Math.min(100, Math.round(qualityScore(listing, criteria))))
    }));

    const sourcePool = raw.filter((source) => source.url && isFrenchPortal(source.url));
    const sources = sourcePool.slice(0, 40).map((source, index) => ({
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
      analyzedCandidateCount: enriched.length,
      snippetListingCount: candidates.length,
      enrichedListingCount: enriched.length,
      recoveryPoolCount: all.length,
      verifiedListingCount: listings.length,
      targetListingCount: TARGET,
      confirmedPriceCount: listings.filter((listing) => listing.priceConfidence === "confirmed").length,
      indexedPriceCount: listings.filter((listing) => listing.priceConfidence === "indexed").length,
      photoCount: listings.filter((listing) => listing.images.length > 0).length,
      confirmedPhotoCount: listings.filter((listing) => listing.imageConfidence === "confirmed").length,
      creditsUsed: null,
      sources,
      listings,
      searchEngineVersion: "FR-2.0",
      searchProvider: "SearXNG-France",
      scope: "France-only",
    });
  } catch (error) {
    console.error("ORBIT France v2 search error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "ORBIT France n'a pas pu effectuer la recherche.",
        sourceCount: 0,
        candidateCount: 0,
        listingCount: 0,
        sources: [],
        listings: [],
        searchProvider: "SearXNG-France",
        creditsUsed: null,
      },
      { status: 503 },
    );
  }
}
