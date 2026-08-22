import { NextRequest, NextResponse } from "next/server";

import { detectLocationWithAI } from "@/lib/search/location";
import { parseLocalizedInteger, parsePriceFromText, sanitizePropertyPrice } from "@/lib/search/price";

type SearchResult = {
  url?: string;
  title?: string;
  content?: string;
  thumbnail?: string;
  img_src?: string;
};

type FilterOverrides = {
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
  country?: string;
  location?: string;
  currency: string;
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

type PriceConfidence = "confirmed" | "snippet" | "none";

type Listing = {
  id: string;
  url: string;
  source: string;
  parentSource: string;
  title: string;
  description: string;
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
  images: string[];
  pricePerM2?: number;
  propertyKind: "existing_house" | "new_build_project" | "apartment" | "villa" | "unknown";
  matchScore: number;
  valueScore: number;
  orbitScore: number;
  reasons: string[];
  compromises: string[];
  extractedAt: string;
  priceConfidence?: PriceConfidence;
};

type StructuredDetails = {
  price?: number;
  currency?: string;
  surface?: number;
  bedrooms?: number;
  bathrooms?: number;
  images: string[];
};

const TARGET = 10;
const PAGE_ENRICH_LIMIT = 16;

const COUNTRY_DOMAINS: Record<string, string[]> = {
  France: ["seloger.com", "bienici.com", "ouestfrance-immo.com", "leboncoin.fr", "orpi.com", "century21.fr", "fnaim.fr", "logic-immo.com"],
  "United States": ["zillow.com", "redfin.com", "realtor.com", "homes.com", "compass.com", "trulia.com"],
  "United Kingdom": ["rightmove.co.uk", "zoopla.co.uk", "onthemarket.com", "primelocation.com"],
  Canada: ["realtor.ca", "centris.ca", "royallepage.ca"],
  Germany: ["immobilienscout24.de", "immowelt.de", "immonet.de"],
  Spain: ["idealista.com", "fotocasa.es", "habitaclia.com"],
  Portugal: ["idealista.pt", "imovirtual.com", "casa.sapo.pt"],
  Italy: ["immobiliare.it", "idealista.it", "casa.it"],
  Belgium: ["immoweb.be", "zimmo.be"],
  Netherlands: ["funda.nl", "pararius.nl"],
  Switzerland: ["homegate.ch", "immoscout24.ch", "newhome.ch"],
  Austria: ["willhaben.at", "immobilienscout24.at"],
  Australia: ["realestate.com.au", "domain.com.au"],
  "New Zealand": ["trademe.co.nz", "realestate.co.nz"],
  Ireland: ["daft.ie", "myhome.ie"],
  "United Arab Emirates": ["propertyfinder.ae", "bayut.com", "dubizzle.com"],
  India: ["99acres.com", "magicbricks.com", "housing.com"],
  Singapore: ["propertyguru.com.sg", "99.co"],
};

const COUNTRY_TERMS: Record<string, string> = {
  France: "maison à vendre immobilier",
  "United States": "house for sale real estate",
  "United Kingdom": "house for sale property",
  Canada: "house for sale real estate",
  Germany: "haus kaufen immobilien",
  Spain: "casa en venta inmobiliaria",
  Portugal: "casa à venda imobiliário",
  Italy: "casa in vendita immobiliare",
  Belgium: "maison à vendre immobilier",
  Netherlands: "huis te koop woning",
  Switzerland: "haus kaufen immobilien",
  Austria: "haus kaufen immobilien",
  Australia: "house for sale property",
  "New Zealand": "house for sale property",
  Ireland: "house for sale property",
  "United Arab Emirates": "villa house for sale property",
  India: "house villa for sale property",
  Singapore: "house landed property for sale",
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value: unknown) {
  return clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/[\u00a0\u202f\s]/g, "").replace(/,/g, ".").replace(/[^\d.]/g, "");
  const parsed = Number(compact);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function lastMatchNumber(query: string, regex: RegExp) {
  const matches = [...query.matchAll(regex)];
  return matches.length ? numeric(matches[matches.length - 1]?.[1]) : undefined;
}

async function parseCriteria(query: string, overrides: FilterOverrides = {}): Promise<Criteria> {
  const q = norm(query);
  const location = await detectLocationWithAI(query, process.env.OPENAI_API_KEY);
  const explicitMinSurface = lastMatchNumber(q, /(?:surface\s*)?(?:minimum|min\.?|au moins|at least)\s*(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|sqm|sq\s*m)/gi);
  const explicitMaxSurface = lastMatchNumber(q, /(?:surface\s*)?(?:maximum|max\.?|jusqu(?:a|')a|up to)\s*(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|sqm|sq\s*m)/gi);
  const anySurface = lastMatchNumber(q, /(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|metres? carres?|sqm|sq\s*m)/gi);
  const bedrooms = lastMatchNumber(q, /(\d{1,2})\s*(?:chambres?|bedrooms?|beds?)/gi);
  const bathrooms = lastMatchNumber(q, /(\d{1,2})\s*(?:sdb|salles? de bain|bathrooms?|baths?)/gi);
  const explicitBudgetMin = lastMatchNumber(q, /(?:prix\s*)?(?:minimum|min\.?|au moins|at least)\s*([\d\s.,]+)\s*(?:€|eur|euros?|\$|usd|£|gbp)?/gi);
  const explicitBudgetMax = lastMatchNumber(q, /(?:moins de|sous|budget(?: max)?|prix\s*max(?:imum)?|maximum|max\.?|under|below|up to)\s*([\d\s.,]+)\s*(?:€|eur|euros?|\$|usd|£|gbp)?/gi);
  const bareCurrencyBudget = lastMatchNumber(q, /([\d\s.,]{4,})\s*(?:€|eur|euros?|\$|usd|£|gbp)/gi);
  const house = /\b(maison|maisons|house|houses|villa|villas|home|homes|haus|casa|huis)\b/i.test(q);
  const sortFromQuery: Criteria["sortPriority"] = /tri\s+prix\s+croissant|lowest price|prix le plus bas/i.test(q)
    ? "lowest_price"
    : /tri\s+plus grande surface|largest|plus grande surface/i.test(q)
      ? "largest"
      : "best_match";

  return {
    category: "real_estate",
    intent: "buy",
    propertyType: overrides.propertyType ?? (house ? "house" : undefined),
    city: location.city,
    country: location.country,
    location: [location.city, location.country].filter(Boolean).join(", ") || undefined,
    currency: location.currency ?? "EUR",
    budgetMin: numeric(overrides.budgetMin) ?? explicitBudgetMin,
    budgetMax: numeric(overrides.budgetMax) ?? explicitBudgetMax ?? (explicitBudgetMin ? undefined : bareCurrencyBudget),
    minSurface: numeric(overrides.minSurface) ?? explicitMinSurface ?? (explicitMaxSurface ? undefined : anySurface),
    maxSurface: numeric(overrides.maxSurface) ?? explicitMaxSurface,
    minBedrooms: numeric(overrides.minBedrooms) ?? bedrooms,
    minBathrooms: numeric(overrides.minBathrooms) ?? bathrooms,
    garden: overrides.garden ?? /\b(jardin|garden)\b/i.test(q),
    garage: overrides.garage ?? /\bgarage\b/i.test(q),
    pool: overrides.pool ?? /\b(piscine|pool|swimming pool)\b/i.test(q),
    terrace: overrides.terrace ?? /\b(terrasse|terrace)\b/i.test(q),
    parking: overrides.parking ?? /\b(parking|stationnement|carport)\b/i.test(q),
    requirements: [],
    preferences: [],
    sortPriority: overrides.sortPriority ?? sortFromQuery,
  };
}

function collectSurfaceCandidates(text: string, criteria: Criteria) {
  const candidates: Array<{ value: number; index: number; confidence: number }> = [];
  const metric = /(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|sqm|sq\s*m)\b/gi;

  for (const match of text.matchAll(metric)) {
    const value = numeric(match[1]);
    if (!value) continue;
    const index = match.index ?? 0;
    const context = norm(text.slice(Math.max(0, index - 70), Math.min(text.length, index + match[0].length + 70)));
    if (/\b(terrain|parcelle|land|plot|lot|garden size|jardin de|acre|hectare|grounds?)\b/.test(context)) continue;
    if (value < 10 || value > 1200) continue;
    let confidence = 2;
    if (/\b(surface habitable|living area|interior|habitable|floor area|living space|interior size)\b/.test(context)) confidence += 5;
    if (criteria.minSurface) confidence += Math.max(0, 3 - Math.abs(value - criteria.minSurface) / Math.max(50, criteria.minSurface));
    candidates.push({ value: Math.round(value * 10) / 10, index, confidence });
  }

  const imperial = /([\d,]{3,7})\s*(?:sq\.?\s*ft|square\s*feet|sqft)\b/gi;
  for (const match of text.matchAll(imperial)) {
    const sqft = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(sqft) || sqft < 150 || sqft > 30000) continue;
    const index = match.index ?? 0;
    const context = norm(text.slice(Math.max(0, index - 70), Math.min(text.length, index + match[0].length + 70)));
    if (/\b(lot|land|plot|acre|lot size|grounds?)\b/.test(context)) continue;
    const value = Math.round(sqft * 0.092903 * 10) / 10;
    if (value < 10 || value > 1200) continue;
    let confidence = 2;
    if (/\b(living|interior|heated|home size|house size|living area)\b/.test(context)) confidence += 5;
    if (criteria.minSurface) confidence += Math.max(0, 3 - Math.abs(value - criteria.minSurface) / Math.max(50, criteria.minSurface));
    candidates.push({ value, index, confidence });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence || a.index - b.index);
}

function parseSurface(text: string, criteria: Criteria) {
  return collectSurfaceCandidates(text, criteria)[0]?.value;
}

function parseBedrooms(text: string) {
  const match = text.match(/(\d{1,2})\s*(?:chambres?|bedrooms?|beds?|bed)\b/i);
  const value = match ? Number(match[1]) : undefined;
  return value && value <= 20 ? value : undefined;
}

function parseBathrooms(text: string) {
  const match = text.match(/(\d{1,2})\s*(?:sdb|salles? de bain|bathrooms?|baths?|bath)\b/i);
  const value = match ? Number(match[1]) : undefined;
  return value && value <= 15 ? value : undefined;
}

function has(text: string, words: RegExp) {
  return words.test(norm(text));
}

function detectKind(text: string): Listing["propertyKind"] {
  const q = norm(text);
  if (/\b(villa|villas)\b/.test(q)) return "villa";
  if (/\b(appartement|apartment|flat|studio|condo|condominium)\b/.test(q)) return "apartment";
  if (/\b(programme neuf|new build|new development)\b/.test(q)) return "new_build_project";
  if (/\b(maison|house|home|pavillon|detached|townhouse|haus|casa|huis)\b/.test(q)) return "existing_house";
  return "unknown";
}

function isClearlyIrrelevant(text: string) {
  const q = norm(text);
  return /\b(vacation rental|location vacances|hotel|booking|airbnb|emploi|job|actualite|news|wikipedia|definition|dictionary)\b/.test(q);
}

function sourceTrust(domain: string, country?: string) {
  const preferred = country ? COUNTRY_DOMAINS[country] ?? [] : [];
  if (preferred.some((item) => domain === item || domain.endsWith(`.${item}`))) return 12;
  if (/properstar|jamesedition|sothebysrealty|engelvoelkers/.test(domain)) return 6;
  return 0;
}

function likelyPropertyImage(url: string | undefined) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const q = norm(url);
  if (/logo|favicon|sprite|avatar|icon|badge|tracking|pixel|placeholder|default-image|\.svg(?:\?|$)/.test(q)) return false;
  return true;
}

function uniqueImages(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (!likelyPropertyImage(value)) continue;
    const key = value!.replace(/&amp;/g, "&");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(key);
    if (output.length >= 8) break;
  }
  return output;
}

function toListing(result: SearchResult, criteria: Criteria): Listing | null {
  if (!result.url) return null;
  const title = clean(result.title) || "Annonce immobilière";
  const description = clean(result.content);
  const combined = `${title} ${description}`;
  if (isClearlyIrrelevant(combined)) return null;

  const surface = parseSurface(combined, criteria);
  const priceResult = parsePriceFromText(combined, criteria.currency);
  const price = sanitizePropertyPrice(priceResult.value, priceResult.currency ?? criteria.currency, surface, priceResult.confidence);
  const bedrooms = parseBedrooms(combined);
  const bathrooms = parseBathrooms(combined);
  const kind = detectKind(combined);
  const domain = host(result.url);
  const garden = has(combined, /\b(jardin|garden|yard)\b/);
  const garage = has(combined, /\bgarage\b/);
  const pool = has(combined, /\b(piscine|pool|swimming pool)\b/);
  const terrace = has(combined, /\b(terrasse|terrace|patio)\b/);
  const parking = has(combined, /\b(parking|stationnement|carport|driveway)\b/);

  const reasons: string[] = [];
  const compromises: string[] = [];
  let matchScore = 44;
  let valueScore = 50 + sourceTrust(domain, criteria.country);

  if (criteria.city) {
    if (norm(`${combined} ${result.url}`).includes(norm(criteria.city))) {
      matchScore += 23;
      reasons.push(`${criteria.city} détecté dans l'annonce`);
    } else {
      matchScore -= 8;
      compromises.push(`${criteria.city} non confirmé dans l'extrait`);
    }
  }

  if (criteria.propertyType === "house") {
    if (kind === "existing_house" || kind === "villa") {
      matchScore += 18;
      reasons.push("Type maison détecté");
    } else if (kind === "apartment") {
      matchScore -= 30;
      compromises.push("Semble être un appartement");
    }
  }

  if (criteria.minSurface && surface !== undefined) {
    if (surface >= criteria.minSurface) matchScore += 14;
    else {
      const gap = (criteria.minSurface - surface) / criteria.minSurface;
      matchScore += gap <= 0.1 ? 4 : gap <= 0.25 ? -5 : -14;
      compromises.push(`${surface} m² sous le minimum souhaité`);
    }
  }
  if (criteria.maxSurface && surface !== undefined && surface > criteria.maxSurface) matchScore -= 10;

  if (criteria.budgetMax && price !== undefined) {
    if (price <= criteria.budgetMax) {
      matchScore += 10;
      valueScore += 8;
      reasons.push("Dans le budget");
    } else {
      const over = (price - criteria.budgetMax) / criteria.budgetMax;
      matchScore -= over <= 0.1 ? 2 : 12;
      compromises.push("Au-dessus du budget");
    }
  }

  if (criteria.minBedrooms && bedrooms !== undefined) matchScore += bedrooms >= criteria.minBedrooms ? 8 : -8;
  if (criteria.minBathrooms && bathrooms !== undefined) matchScore += bathrooms >= criteria.minBathrooms ? 5 : -5;

  const requestedFeatures: Array<[boolean | undefined, boolean, string]> = [
    [criteria.garden, garden, "jardin"],
    [criteria.garage, garage, "garage"],
    [criteria.pool, pool, "piscine"],
    [criteria.terrace, terrace, "terrasse"],
    [criteria.parking, parking, "parking"],
  ];
  for (const [wanted, present, label] of requestedFeatures) {
    if (!wanted) continue;
    if (present) {
      matchScore += 5;
      reasons.push(`${label} détecté`);
    } else {
      matchScore -= 2;
      compromises.push(`${label} non confirmé`);
    }
  }

  if (price !== undefined) reasons.push(priceResult.confidence === "confirmed" ? "Prix détecté avec devise explicite" : "Prix détecté dans l'extrait");
  else compromises.push("Prix à vérifier sur l'annonce source");

  matchScore = Math.max(0, Math.min(100, Math.round(matchScore)));
  valueScore = Math.max(0, Math.min(100, Math.round(valueScore)));
  const orbitScore = Math.max(0, Math.min(100, Math.round(matchScore * 0.78 + valueScore * 0.22)));

  return {
    id: "",
    url: result.url,
    source: domain,
    parentSource: domain,
    title,
    description: description || "Informations disponibles depuis le moteur de recherche.",
    price,
    currency: price !== undefined ? (priceResult.currency ?? criteria.currency) : criteria.currency,
    surface,
    bedrooms,
    bathrooms,
    location: criteria.location,
    garden,
    garage,
    pool,
    terrace,
    parking,
    images: uniqueImages([result.thumbnail, result.img_src]),
    pricePerM2: price && surface ? Math.round(price / surface) : undefined,
    propertyKind: kind,
    matchScore,
    valueScore,
    orbitScore,
    reasons: reasons.slice(0, 10),
    compromises: compromises.slice(0, 10),
    extractedAt: new Date().toISOString(),
    priceConfidence: price !== undefined ? priceResult.confidence : "none",
  };
}

async function fetchListingHtml(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return undefined;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return undefined;
    return (await response.text()).slice(0, 2_000_000);
  } catch {
    return undefined;
  }
}

function jsonLdObjects(html: string) {
  const objects: unknown[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = decodeHtml(match[1] ?? "").trim();
    if (!raw) continue;
    try {
      objects.push(JSON.parse(raw));
    } catch {
      // Some portals expose malformed JSON-LD. pageText still gets a chance below.
    }
  }
  return objects;
}

function walkJson(value: unknown, visit: (object: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, visit));
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  visit(object);
  Object.values(object).forEach((item) => walkJson(item, visit));
}

function normalizeStructuredSurface(value: unknown, unit?: unknown) {
  const amount = numeric(value);
  if (!amount) return undefined;
  const u = norm(unit);
  const surface = /sq\s*ft|square\s*feet|sqft/.test(u) ? amount * 0.092903 : amount;
  return surface >= 10 && surface <= 1200 ? Math.round(surface * 10) / 10 : undefined;
}

function imageValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(imageValues);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return imageValues(object.url ?? object.contentUrl ?? object.thumbnailUrl);
  }
  return [];
}

function extractStructuredDetails(html: string, criteria: Criteria): StructuredDetails {
  let price: number | undefined;
  let currency: string | undefined;
  let surface: number | undefined;
  let bedrooms: number | undefined;
  let bathrooms: number | undefined;
  const images: string[] = [];

  for (const root of jsonLdObjects(html)) {
    walkJson(root, (object) => {
      images.push(...imageValues(object.image), ...imageValues(object.photo), ...imageValues(object.thumbnailUrl));

      if (price === undefined) {
        const rawPrice = object.price ?? object.lowPrice ?? object.highPrice;
        const parsed = typeof rawPrice === "number" ? Math.round(rawPrice) : typeof rawPrice === "string" ? parseLocalizedInteger(rawPrice) : undefined;
        const candidateCurrency = clean(object.priceCurrency) || criteria.currency;
        const safe = sanitizePropertyPrice(parsed, candidateCurrency, surface, "confirmed");
        if (safe !== undefined) {
          price = safe;
          currency = candidateCurrency;
        }
      }

      if (surface === undefined) {
        const floor = object.floorSize;
        if (floor && typeof floor === "object") {
          const floorObject = floor as Record<string, unknown>;
          surface = normalizeStructuredSurface(floorObject.value, floorObject.unitText ?? floorObject.unitCode);
        }
        surface ??= normalizeStructuredSurface(object.livingArea ?? object.floorArea, object.unitText ?? object.unitCode);
      }

      if (bedrooms === undefined) bedrooms = numeric(object.numberOfBedrooms ?? object.numberOfRooms);
      if (bathrooms === undefined) bathrooms = numeric(object.numberOfBathroomsTotal ?? object.numberOfBathrooms);
    });
  }

  if (price !== undefined && surface !== undefined) {
    price = sanitizePropertyPrice(price, currency ?? criteria.currency, surface, "confirmed");
  }

  return {
    price,
    currency,
    surface,
    bedrooms: bedrooms && bedrooms <= 20 ? Math.round(bedrooms) : undefined,
    bathrooms: bathrooms && bathrooms <= 15 ? Math.round(bathrooms) : undefined,
    images: uniqueImages(images),
  };
}

function extractMetaImages(html: string) {
  const values: string[] = [];
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image|twitter:image:src)["']/gi,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) values.push(decodeHtml(match[1] ?? ""));
  }
  return uniqueImages(values);
}

function pageText(html: string) {
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1] ?? "")
    .join(" ");
  const meta = [...html.matchAll(/<meta[^>]+(?:content|value)=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1] ?? "")
    .join(" ");
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return decodeHtml(`${title} ${meta} ${jsonLd}`).replace(/\s+/g, " ").slice(0, 350_000);
}

async function searxngSearch(query: string, pageno = 1, categories?: string): Promise<SearchResult[]> {
  const base = (process.env.SEARXNG_URL ?? "http://localhost:8080").replace(/\/$/, "");
  try {
    const url = new URL(`${base}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("pageno", String(pageno));
    url.searchParams.set("safesearch", "0");
    if (categories) url.searchParams.set("categories", categories);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { results?: SearchResult[] };
    return Array.isArray(payload.results) ? payload.results : [];
  } catch {
    return [];
  }
}

function recoveryQuery(listing: Listing, criteria: Criteria) {
  const title = listing.title.replace(/[|•–—]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
  const domain = host(listing.url);
  const location = criteria.city ?? "";
  return `site:${domain} "${title}" ${location}`.trim();
}

async function recoverFromSearxng(listing: Listing, criteria: Criteria) {
  const query = recoveryQuery(listing, criteria);
  const [web, images] = await Promise.all([
    searxngSearch(query, 1),
    listing.images.length ? Promise.resolve([] as SearchResult[]) : searxngSearch(query, 1, "images"),
  ]);

  let price = listing.price;
  let currency = listing.currency;
  let confidence: PriceConfidence = listing.priceConfidence ?? "none";
  let surface = listing.surface;
  let bedrooms = listing.bedrooms;
  let bathrooms = listing.bathrooms;
  const imageCandidates: Array<string | undefined> = [...listing.images];

  const sameDomain = web.filter((result) => !result.url || host(result.url) === host(listing.url));
  for (const result of sameDomain.slice(0, 8)) {
    const text = `${result.title ?? ""} ${result.content ?? ""}`;
    if (price === undefined) {
      const parsed = parsePriceFromText(text, currency ?? criteria.currency);
      const safe = sanitizePropertyPrice(parsed.value, parsed.currency ?? currency ?? criteria.currency, surface, parsed.confidence);
      if (safe !== undefined) {
        price = safe;
        currency = parsed.currency ?? currency ?? criteria.currency;
        confidence = "snippet";
      }
    }
    surface ??= parseSurface(text, criteria);
    bedrooms ??= parseBedrooms(text);
    bathrooms ??= parseBathrooms(text);
    imageCandidates.push(result.thumbnail, result.img_src);
  }

  for (const result of images.slice(0, 12)) imageCandidates.push(result.img_src, result.thumbnail, result.url);

  return { price, currency, confidence, surface, bedrooms, bathrooms, images: uniqueImages(imageCandidates) };
}

async function enrichListing(listing: Listing, criteria: Criteria): Promise<Listing> {
  let price = listing.price;
  let currency = listing.currency;
  let priceConfidence: PriceConfidence = listing.priceConfidence ?? "none";
  let surface = listing.surface;
  let bedrooms = listing.bedrooms;
  let bathrooms = listing.bathrooms;
  let images = [...listing.images];
  const reasons = [...listing.reasons];

  const html = await fetchListingHtml(listing.url);
  if (html) {
    const structured = extractStructuredDetails(html, criteria);
    const text = pageText(html);
    surface = structured.surface ?? parseSurface(text, criteria) ?? surface;
    bedrooms = structured.bedrooms ?? parseBedrooms(text) ?? bedrooms;
    bathrooms = structured.bathrooms ?? parseBathrooms(text) ?? bathrooms;
    images = uniqueImages([...structured.images, ...extractMetaImages(html), ...images]);

    if (structured.price !== undefined) {
      price = structured.price;
      currency = structured.currency ?? currency ?? criteria.currency;
      priceConfidence = "confirmed";
      reasons.unshift("Prix vérifié dans les données structurées de l'annonce");
    } else {
      const pagePrice = parsePriceFromText(text, currency ?? criteria.currency);
      const candidate = sanitizePropertyPrice(pagePrice.value, pagePrice.currency ?? currency ?? criteria.currency, surface, pagePrice.confidence);
      if (candidate !== undefined && (price === undefined || priceConfidence !== "confirmed")) {
        price = candidate;
        currency = pagePrice.currency ?? currency ?? criteria.currency;
        priceConfidence = pagePrice.confidence === "confirmed" ? "confirmed" : "snippet";
        reasons.unshift(priceConfidence === "confirmed" ? "Prix vérifié sur la page source" : "Prix retrouvé sur la page source");
      }
    }
  }

  if (price === undefined || images.length === 0 || surface === undefined) {
    const recovery = await recoverFromSearxng({ ...listing, price, currency, priceConfidence, surface, bedrooms, bathrooms, images }, criteria);
    price = recovery.price;
    currency = recovery.currency;
    priceConfidence = recovery.confidence;
    surface = recovery.surface;
    bedrooms = recovery.bedrooms;
    bathrooms = recovery.bathrooms;
    images = recovery.images;
    if (price !== undefined && !reasons.some((reason) => /prix/i.test(reason))) reasons.unshift("Prix retrouvé via l'index SearXNG");
    if (images.length > 0) reasons.unshift("Photo récupérée depuis la source ou l'index");
  }

  price = sanitizePropertyPrice(price, currency ?? criteria.currency, surface, priceConfidence);
  if (price === undefined) priceConfidence = "none";

  return {
    ...listing,
    price,
    currency: currency ?? criteria.currency,
    surface,
    bedrooms,
    bathrooms,
    images,
    pricePerM2: price && surface ? Math.round(price / surface) : undefined,
    priceConfidence,
    reasons: [...new Set(reasons)].slice(0, 10),
  };
}

async function enrichListings(listings: Listing[], criteria: Criteria) {
  const selected = listings
    .map((listing, index) => ({ listing, index }))
    .filter(({ listing }) => listing.priceConfidence !== "confirmed" || listing.surface === undefined || listing.images.length === 0)
    .slice(0, PAGE_ENRICH_LIMIT);

  const enriched = await Promise.all(selected.map(({ listing }) => enrichListing(listing, criteria)));
  const output = [...listings];
  selected.forEach(({ index }, i) => {
    output[index] = enriched[i] ?? output[index];
  });
  return output;
}

function buildQueries(original: string, criteria: Criteria) {
  const location = criteria.location ?? criteria.city ?? "";
  const terms = COUNTRY_TERMS[criteria.country ?? ""] ?? "house property for sale real estate";
  const details = [
    criteria.minSurface ? `${criteria.minSurface} sqm` : "",
    criteria.budgetMax ? `under ${criteria.budgetMax} ${criteria.currency}` : "",
    criteria.minBedrooms ? `${criteria.minBedrooms} bedrooms` : "",
    criteria.pool ? "pool" : "",
    criteria.garage ? "garage" : "",
    criteria.garden ? "garden" : "",
  ].filter(Boolean).join(" ");
  const domains = criteria.country ? COUNTRY_DOMAINS[criteria.country] ?? [] : [];
  const portalQueries = domains.slice(0, 5).map((domain) => `site:${domain} ${location} ${terms} ${details}`);
  return [...new Set([original, `${location} ${terms} ${details}`, `${location} ${criteria.propertyType ?? "house"} ${details} for sale`, ...portalQueries])]
    .map(clean)
    .filter(Boolean)
    .slice(0, 8);
}

function dedupeResults(results: SearchResult[]) {
  const seen = new Set<string>();
  const output: SearchResult[] = [];
  for (const result of results) {
    if (!result.url) continue;
    let key = result.url;
    try {
      const u = new URL(result.url);
      u.hash = "";
      u.searchParams.delete("utm_source");
      u.searchParams.delete("utm_medium");
      u.searchParams.delete("utm_campaign");
      key = `${u.origin}${u.pathname}${u.search}`.replace(/\/$/, "");
    } catch {}
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(result);
  }
  return output;
}

function applyStrongFilters(listings: Listing[], criteria: Criteria) {
  return listings.filter((listing) => {
    if (criteria.propertyType === "house" && listing.propertyKind === "apartment") return false;
    if (criteria.budgetMin && listing.price !== undefined && listing.price < criteria.budgetMin) return false;
    if (criteria.budgetMax && listing.price !== undefined && listing.price > criteria.budgetMax * 1.18) return false;
    if (criteria.minSurface && listing.surface !== undefined && listing.surface < criteria.minSurface * 0.72) return false;
    if (criteria.maxSurface && listing.surface !== undefined && listing.surface > criteria.maxSurface * 1.18) return false;
    if (criteria.minBedrooms && listing.bedrooms !== undefined && listing.bedrooms < Math.max(1, criteria.minBedrooms - 1)) return false;
    if (criteria.minBathrooms && listing.bathrooms !== undefined && listing.bathrooms < Math.max(1, criteria.minBathrooms - 1)) return false;
    return true;
  });
}

function priceQuality(listing: Listing) {
  if (listing.price !== undefined && listing.priceConfidence === "confirmed") return 3;
  if (listing.price !== undefined && listing.priceConfidence === "snippet") return 2;
  return 0;
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname !== "/api/search" || request.method !== "POST") return NextResponse.next();

  try {
    const body = await request.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const filters = (body?.filters && typeof body.filters === "object" ? body.filters : {}) as FilterOverrides;
    if (!query) return NextResponse.json({ success: false, error: "La recherche est vide." }, { status: 400 });

    const criteria = await parseCriteria(query, filters);
    const queries = buildQueries(query, criteria);

    const firstPageJobs = await Promise.all(queries.map((searchQuery) => searxngSearch(searchQuery, 1)));
    let unique = dedupeResults(firstPageJobs.flat());

    if (unique.length < 30) {
      const secondPageJobs = await Promise.all(queries.slice(0, 6).map((searchQuery) => searxngSearch(searchQuery, 2)));
      unique = dedupeResults([...unique, ...secondPageJobs.flat()]);
    }

    if (unique.length < 15) {
      const thirdPageJobs = await Promise.all(queries.slice(0, 4).map((searchQuery) => searxngSearch(searchQuery, 3)));
      unique = dedupeResults([...unique, ...thirdPageJobs.flat()]);
    }

    if (unique.length === 0) {
      return NextResponse.json({
        success: true,
        query,
        searchQuery: queries[0] ?? query,
        criteria,
        sourceCount: 0,
        candidateCount: 0,
        listingCount: 0,
        analyzedCandidateCount: 0,
        snippetListingCount: 0,
        enrichedListingCount: 0,
        recoveryPoolCount: 0,
        verifiedListingCount: 0,
        targetListingCount: TARGET,
        confirmedPriceCount: 0,
        photoCount: 0,
        creditsUsed: null,
        sources: [],
        listings: [],
        searchEngineVersion: "13.0-searxng-enriched",
        searchProvider: "SearXNG",
      });
    }

    let listings = unique.map((result) => toListing(result, criteria)).filter((item): item is Listing => Boolean(item));
    listings.sort((a, b) => b.orbitScore - a.orbitScore);
    listings = await enrichListings(listings.slice(0, 28), criteria);

    const stronglyFiltered = applyStrongFilters(listings, criteria);
    if (stronglyFiltered.length >= 4) listings = stronglyFiltered;

    if (criteria.sortPriority === "lowest_price") {
      listings.sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER) || b.orbitScore - a.orbitScore);
    } else if (criteria.sortPriority === "largest") {
      listings.sort((a, b) => (b.surface ?? 0) - (a.surface ?? 0) || b.orbitScore - a.orbitScore);
    } else {
      listings.sort((a, b) => priceQuality(b) - priceQuality(a) || Number(b.images.length > 0) - Number(a.images.length > 0) || b.orbitScore - a.orbitScore);
    }

    listings = listings.slice(0, TARGET).map((listing, index) => ({ ...listing, id: `listing-${index}` }));
    const sources = unique.slice(0, 40).map((source, index) => ({
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
      candidateCount: unique.length,
      listingCount: listings.length,
      analyzedCandidateCount: unique.length,
      snippetListingCount: listings.length,
      enrichedListingCount: listings.filter((listing) => listing.reasons.some((reason) => /vérifié|source|récupérée/i.test(reason))).length,
      recoveryPoolCount: listings.length,
      verifiedListingCount: listings.filter((listing) => listing.priceConfidence === "confirmed").length,
      targetListingCount: TARGET,
      confirmedPriceCount: listings.filter((listing) => listing.price !== undefined).length,
      photoCount: listings.filter((listing) => listing.images.length > 0).length,
      creditsUsed: null,
      sources,
      listings,
      searchEngineVersion: "13.0-searxng-enriched",
      searchProvider: "SearXNG",
    });
  } catch (error) {
    console.error("ORBIT SearXNG search error:", error);
    return NextResponse.json({
      success: false,
      error: "SearXNG n'a pas pu effectuer la recherche.",
      sourceCount: 0,
      candidateCount: 0,
      listingCount: 0,
      sources: [],
      listings: [],
      searchProvider: "SearXNG",
      creditsUsed: null,
    }, { status: 503 });
  }
}

export const config = { matcher: ["/api/search"] };
