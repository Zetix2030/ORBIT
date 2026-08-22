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

type PriceConfidence = "confirmed" | "indexed" | "none";

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
  propertyKind:
    | "existing_house"
    | "new_build_project"
    | "apartment"
    | "villa"
    | "unknown";
  matchScore: number;
  valueScore: number;
  orbitScore: number;
  reasons: string[];
  compromises: string[];
  extractedAt: string;
  priceConfidence?: PriceConfidence;
  discoveryImage?: string;
  discoveryPrice?: number;
  discoveryCurrency?: string;
};

type SourceDetails = {
  price?: number;
  currency?: string;
  surface?: number;
  bedrooms?: number;
  bathrooms?: number;
  images: string[];
};

const TARGET = 10;
const MAX_ENRICH = 140;
const BATCH_SIZE = 8;

const COUNTRY_DOMAINS: Record<string, string[]> = {
  France: [
    "seloger.com",
    "bienici.com",
    "ouestfrance-immo.com",
    "leboncoin.fr",
    "orpi.com",
    "century21.fr",
    "fnaim.fr",
    "logic-immo.com",
    "iadfrance.fr",
    "safti.fr",
    "efficity.com",
    "proprietes-privees.com",
  ],
  "United States": [
    "zillow.com",
    "redfin.com",
    "realtor.com",
    "homes.com",
    "compass.com",
    "trulia.com",
  ],
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

function normalizedUrl(url: string) {
  try {
    const u = new URL(url);
    u.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((key) =>
      u.searchParams.delete(key),
    );
    return `${u.origin}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return undefined;
  return parseLocalizedInteger(value);
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

function parseSurface(text: string, criteria: Criteria) {
  const candidates: Array<{ value: number; score: number }> = [];
  for (const match of text.matchAll(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|sqm|sq\s*m)\b/gi)) {
    const value = numeric(match[1]);
    if (!value || value < 15 || value > 1000) continue;
    const index = match.index ?? 0;
    const context = norm(text.slice(Math.max(0, index - 90), index + match[0].length + 90));
    if (/\b(terrain|parcelle|land|plot|lot|acre|hectare|garden size|jardin de)\b/.test(context)) continue;
    let score = /\b(surface habitable|living area|living space|interior|floor area|habitable)\b/.test(context) ? 10 : 3;
    if (criteria.minSurface) score += Math.max(0, 3 - Math.abs(value - criteria.minSurface) / Math.max(50, criteria.minSurface));
    candidates.push({ value: Math.round(value * 10) / 10, score });
  }
  for (const match of text.matchAll(/([\d,]{3,7})\s*(?:sq\.?\s*ft|square\s*feet|sqft)\b/gi)) {
    const sqft = Number((match[1] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(sqft) || sqft < 150 || sqft > 20000) continue;
    const index = match.index ?? 0;
    const context = norm(text.slice(Math.max(0, index - 90), index + match[0].length + 90));
    if (/\b(lot|land|plot|acre|grounds?)\b/.test(context)) continue;
    const value = Math.round(sqft * 0.092903 * 10) / 10;
    let score = /\b(living|interior|heated|home size|house size)\b/.test(context) ? 10 : 3;
    if (criteria.minSurface) score += Math.max(0, 3 - Math.abs(value - criteria.minSurface) / Math.max(50, criteria.minSurface));
    candidates.push({ value, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value;
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

function detectKind(text: string): Listing["propertyKind"] {
  const q = norm(text);
  if (/\b(villa|villas)\b/.test(q)) return "villa";
  if (/\b(appartement|apartment|flat|studio|condo|condominium)\b/.test(q)) return "apartment";
  if (/\b(programme neuf|new build|new development)\b/.test(q)) return "new_build_project";
  if (/\b(maison|house|home|pavillon|detached|townhouse|haus|casa|huis)\b/.test(q)) return "existing_house";
  return "unknown";
}

function looksLikeCollectionPage(result: SearchResult) {
  const title = norm(result.title);
  const content = norm(result.content);
  const combined = `${title} ${content}`;
  if (/\b\d{2,6}\s+(?:listings|annonces|homes|maisons|properties|biens)\b/.test(combined)) return true;
  if (/\b(?:homes|houses|properties|maisons|biens)\s+(?:for sale|à vendre|a vendre)\b/.test(title) && !/\b(ref|mls|reference|réf|\d{5})\b/.test(title)) return true;
  if (/\b(?:search results|résultats de recherche|annonces immobilières|annonces immobilieres)\b/.test(title)) return true;
  return false;
}

function clearlyIrrelevant(text: string) {
  return /\b(vacation rental|location vacances|hotel|booking|airbnb|emploi|job|actualite|news|wikipedia|toy|doll|poupee|barbie)\b/i.test(norm(text));
}

function sourceTrust(domain: string, country?: string) {
  const preferred = country ? COUNTRY_DOMAINS[country] ?? [] : [];
  if (preferred.some((item) => domain === item || domain.endsWith(`.${item}`))) return 12;
  if (/properstar|jamesedition|sothebysrealty|engelvoelkers/.test(domain)) return 4;
  return 0;
}

function safeDiscoveryImage(result: SearchResult) {
  const value = result.img_src ?? result.thumbnail;
  if (!value || !/^https?:\/\//i.test(value)) return undefined;
  const q = norm(value);
  if (/logo|favicon|icon|avatar|sprite|placeholder|no[-_]?image|default|brand|cookie|tracking|pixel|banner|advert|ads?\b|social-share|og-default|map|floorplan/.test(q)) return undefined;
  return value;
}

function toListing(result: SearchResult, criteria: Criteria): Listing | null {
  if (!result.url || looksLikeCollectionPage(result)) return null;
  const title = clean(result.title) || "Annonce immobilière";
  const description = clean(result.content);
  const combined = `${title} ${description}`;
  if (clearlyIrrelevant(combined)) return null;

  const surface = parseSurface(combined, criteria);
  const bedrooms = parseBedrooms(combined);
  const bathrooms = parseBathrooms(combined);
  const kind = detectKind(combined);
  const domain = host(result.url);
  const garden = /\b(jardin|garden|yard)\b/i.test(combined);
  const garage = /\bgarage\b/i.test(combined);
  const pool = /\b(piscine|pool|swimming pool)\b/i.test(combined);
  const terrace = /\b(terrasse|terrace|patio)\b/i.test(combined);
  const parking = /\b(parking|stationnement|carport|driveway)\b/i.test(combined);
  const snippetPrice = parsePriceFromText(combined, criteria.currency);
  const discoveryPrice = sanitizePropertyPrice(
    snippetPrice.value,
    snippetPrice.currency ?? criteria.currency,
    surface,
    snippetPrice.confidence,
  );

  let matchScore = 44;
  let valueScore = 50 + sourceTrust(domain, criteria.country);
  if (criteria.city) matchScore += norm(`${combined} ${result.url}`).includes(norm(criteria.city)) ? 23 : -8;
  if (criteria.propertyType === "house") matchScore += kind === "existing_house" || kind === "villa" ? 18 : kind === "apartment" ? -30 : 0;
  if (criteria.minSurface && surface !== undefined) {
    const ratio = surface / criteria.minSurface;
    matchScore += ratio >= 1 ? 14 : ratio >= 0.82 ? 5 : -10;
  }
  if (criteria.minBedrooms && bedrooms !== undefined) matchScore += bedrooms >= criteria.minBedrooms ? 8 : bedrooms >= criteria.minBedrooms - 1 ? 2 : -8;
  if (criteria.budgetMax && discoveryPrice) matchScore += discoveryPrice <= criteria.budgetMax ? 8 : discoveryPrice <= criteria.budgetMax * 1.15 ? -2 : -12;

  for (const [wanted, present] of [[criteria.garden, garden], [criteria.garage, garage], [criteria.pool, pool], [criteria.terrace, terrace], [criteria.parking, parking]] as Array<[boolean | undefined, boolean]>) {
    if (wanted) matchScore += present ? 5 : -2;
  }

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
    currency: snippetPrice.currency ?? criteria.currency,
    surface,
    bedrooms,
    bathrooms,
    location: criteria.location,
    garden,
    garage,
    pool,
    terrace,
    parking,
    images: [],
    propertyKind: kind,
    matchScore,
    valueScore,
    orbitScore,
    reasons: [],
    compromises: [],
    extractedAt: new Date().toISOString(),
    priceConfidence: "none",
    discoveryImage: safeDiscoveryImage(result),
    discoveryPrice,
    discoveryCurrency: snippetPrice.currency ?? criteria.currency,
  };
}

async function searxngSearch(query: string, pageno = 1): Promise<SearchResult[]> {
  const base = (process.env.SEARXNG_URL ?? "http://localhost:8080").replace(/\/$/, "");
  try {
    const url = new URL(`${base}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("pageno", String(pageno));
    url.searchParams.set("safesearch", "0");
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(7000) });
    if (!response.ok) return [];
    const payload = (await response.json()) as { results?: SearchResult[] };
    return Array.isArray(payload.results) ? payload.results : [];
  } catch {
    return [];
  }
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

function metaContent(html: string, key: string) {
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

function validSourceImage(url: unknown, pageHost: string) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  const q = norm(url);
  if (/logo|favicon|icon|avatar|sprite|placeholder|no[-_]?image|default|brand|cookie|tracking|pixel|banner|advert|ads?\b|social-share|og-default|profile|agency|agent|map|floorplan|plan[-_]?image/.test(q)) return false;
  try {
    const imageHost = host(url);
    return imageHost === pageHost || imageHost.endsWith(`.${pageHost}`) || /cloudfront|akamai|cdn|imgix|images|media|static|cloudinary|fastly/.test(imageHost);
  } catch {
    return false;
  }
}

function collectImage(value: unknown, out: string[], pageHost: string) {
  if (typeof value === "string") {
    if (validSourceImage(value, pageHost)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImage(item, out, pageHost);
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    collectImage(obj.url, out, pageHost);
    collectImage(obj.contentUrl, out, pageHost);
    collectImage(obj.thumbnailUrl, out, pageHost);
  }
}

function sameListingUrl(a: string | undefined, b: string) {
  if (!a) return false;
  try {
    const ua = new URL(a, b);
    const ub = new URL(b);
    if (host(ua.toString()) !== host(ub.toString())) return false;
    const pa = ua.pathname.replace(/\/$/, "");
    const pb = ub.pathname.replace(/\/$/, "");
    return pa === pb || pa.includes(pb) || pb.includes(pa);
  } catch {
    return false;
  }
}

function entityUrl(obj: Record<string, unknown>) {
  const candidates = [
    obj.url,
    obj["@id"],
    (obj.mainEntityOfPage as Record<string, unknown> | undefined)?.["@id"],
    (obj.mainEntityOfPage as Record<string, unknown> | undefined)?.url,
  ];
  return candidates.find((item): item is string => typeof item === "string");
}

function structuredPrice(rawPrice: unknown, rawCurrency: unknown, criteria: Criteria, surface?: number) {
  const value = numeric(rawPrice);
  const currency = typeof rawCurrency === "string" && rawCurrency.length <= 5 ? rawCurrency.toUpperCase() : criteria.currency;
  const price = sanitizePropertyPrice(value, currency, surface, "confirmed");
  if (!price) return undefined;
  if (criteria.budgetMax && price > criteria.budgetMax * 3) return undefined;
  return { price, currency };
}

function parseSourceDetails(html: string, criteria: Criteria, pageUrl: string): SourceDetails {
  const details: SourceDetails = { images: [] };
  const pageHost = host(pageUrl);
  const roots: unknown[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      roots.push(JSON.parse(decodeHtml(match[1] ?? "")));
    } catch {}
  }

  const entities: Array<Record<string, unknown>> = [];
  const walk = (value: unknown, depth = 0) => {
    if (depth > 5) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    const type = norm(Array.isArray(obj["@type"]) ? (obj["@type"] as unknown[]).join(" ") : obj["@type"]);
    if (/house|residence|singlefamily|apartment|accommodation|realestate|product/.test(type)) entities.push(obj);
    if (obj["@graph"]) walk(obj["@graph"], depth + 1);
    if (obj.mainEntity) walk(obj.mainEntity, depth + 1);
    // Never walk itemListElement: it usually contains other listings.
  };
  for (const root of roots) walk(root);

  const matching = entities.filter((obj) => {
    const url = entityUrl(obj);
    return !url || sameListingUrl(url, pageUrl);
  });

  for (const obj of matching) {
    const offers = obj.offers as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
    const offer = Array.isArray(offers) ? offers[0] : offers;
    const spec = offer?.priceSpecification as Record<string, unknown> | undefined;
    const floor = (obj.floorSize ?? obj.livingArea) as Record<string, unknown> | number | string | undefined;
    let floorValue: unknown = floor;
    let unit = "";
    if (floor && typeof floor === "object") {
      floorValue = (floor as Record<string, unknown>).value;
      unit = norm((floor as Record<string, unknown>).unitCode ?? (floor as Record<string, unknown>).unitText);
    }
    const fv = numeric(floorValue);
    if (!details.surface && fv) {
      const sqm = /ft|sqf|square feet/.test(unit) ? fv * 0.092903 : fv;
      if (sqm >= 15 && sqm <= 1000) details.surface = Math.round(sqm * 10) / 10;
    }
    if (!details.price) {
      const parsed = structuredPrice(
        offer?.price ?? offer?.lowPrice ?? spec?.price ?? obj.price,
        offer?.priceCurrency ?? spec?.priceCurrency ?? obj.priceCurrency,
        criteria,
        details.surface,
      );
      if (parsed) {
        details.price = parsed.price;
        details.currency = parsed.currency;
      }
    }
    const beds = numeric(obj.numberOfBedrooms);
    const baths = numeric(obj.numberOfBathroomsTotal ?? obj.numberOfBathrooms);
    if (!details.bedrooms && beds && beds <= 20) details.bedrooms = Math.round(beds);
    if (!details.bathrooms && baths && baths <= 15) details.bathrooms = Math.round(baths);
    collectImage(obj.image, details.images, pageHost);
    collectImage(obj.photo, details.images, pageHost);
    collectImage(obj.primaryImageOfPage, details.images, pageHost);
  }

  if (!details.price) {
    const parsed = structuredPrice(
      metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount") ?? metaContent(html, "price"),
      metaContent(html, "product:price:currency") ?? metaContent(html, "og:price:currency") ?? criteria.currency,
      criteria,
      details.surface,
    );
    if (parsed) {
      details.price = parsed.price;
      details.currency = parsed.currency;
    }
  }

  const ogImage = metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
  if (validSourceImage(ogImage, pageHost)) details.images.push(ogImage!);
  details.images = [...new Set(details.images)].slice(0, 8);
  return details;
}

function sourceText(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const metas = [...html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1] ?? "").join(" ");
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? "").join(" ");
  return decodeHtml(`${title} ${metas} ${jsonLd}`).replace(/\s+/g, " ").slice(0, 300_000);
}

async function verifyImageUrl(url: string) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Range: "bytes=0-4096",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
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

async function confirmFromExactIndex(listing: Listing, criteria: Criteria) {
  const query = `site:${listing.source} "${listing.title.slice(0, 110)}"`;
  const results = await searxngSearch(query, 1);
  const exactUrl = normalizedUrl(listing.url);
  for (const result of results.slice(0, 12)) {
    if (!result.url || host(result.url) !== listing.source) continue;
    if (normalizedUrl(result.url) !== exactUrl) continue;
    const text = `${clean(result.title)} ${clean(result.content)}`;
    const parsed = parsePriceFromText(text, listing.currency ?? criteria.currency);
    const price = sanitizePropertyPrice(parsed.value, parsed.currency ?? criteria.currency, listing.surface, parsed.confidence);
    return {
      price,
      currency: parsed.currency ?? criteria.currency,
      image: safeDiscoveryImage(result),
    };
  }
  return undefined;
}

async function enrichListing(listing: Listing, criteria: Criteria): Promise<Listing> {
  const html = await fetchListingHtml(listing.url);
  const details = html ? parseSourceDetails(html, criteria, listing.url) : { images: [] };
  const text = html ? sourceText(html) : "";
  const surface = details.surface ?? (text ? parseSurface(text, criteria) : undefined) ?? listing.surface;

  let price = details.price;
  let currency = details.currency ?? listing.currency ?? criteria.currency;
  let confidence: PriceConfidence = price ? "confirmed" : "none";

  let indexRecovery: Awaited<ReturnType<typeof confirmFromExactIndex>>;
  if (!price || !details.images.length) {
    indexRecovery = await confirmFromExactIndex(listing, criteria);
  }

  if (!price && indexRecovery?.price) {
    price = indexRecovery.price;
    currency = indexRecovery.currency ?? currency;
    confidence = "indexed";
  }
  if (!price && listing.discoveryPrice) {
    price = listing.discoveryPrice;
    currency = listing.discoveryCurrency ?? currency;
    confidence = "indexed";
  }

  if (criteria.budgetMax && price && confidence !== "confirmed" && price > criteria.budgetMax * 1.25) {
    price = undefined;
    confidence = "none";
  }

  const imageCandidates = [
    ...details.images,
    indexRecovery?.image,
    listing.discoveryImage,
  ].filter((item): item is string => Boolean(item));
  const checkedImages: string[] = [];
  for (const image of [...new Set(imageCandidates)].slice(0, 6)) {
    if (await verifyImageUrl(image)) checkedImages.push(image);
    if (checkedImages.length >= 2) break;
  }

  return {
    ...listing,
    price,
    currency,
    surface,
    bedrooms: details.bedrooms ?? (text ? parseBedrooms(text) : undefined) ?? listing.bedrooms,
    bathrooms: details.bathrooms ?? (text ? parseBathrooms(text) : undefined) ?? listing.bathrooms,
    images: checkedImages,
    pricePerM2: price && surface ? Math.round(price / surface) : undefined,
    priceConfidence: confidence,
    reasons: [
      ...(confidence === "confirmed" ? ["Prix vérifié sur la page source"] : confidence === "indexed" ? ["Prix recoupé sur l'URL exacte"] : []),
      ...(checkedImages.length ? ["Photo liée à l'annonce et vérifiée"] : []),
    ],
    compromises: [
      ...(price ? [] : ["Prix non confirmé"]),
      ...(checkedImages.length ? [] : ["Photo non confirmée"]),
    ],
  };
}

function isUsableFinal(listing: Listing, criteria: Criteria) {
  if (!listing.price || !listing.images.length || listing.priceConfidence === "none") return false;
  if (criteria.propertyType === "house" && listing.propertyKind === "apartment") return false;
  if (criteria.city && !norm(`${listing.title} ${listing.description} ${listing.url}`).includes(norm(criteria.city))) return false;
  if (criteria.budgetMin && listing.price < criteria.budgetMin) return false;
  if (criteria.budgetMax && listing.price > criteria.budgetMax * 1.2) return false;
  return true;
}

function quality(listing: Listing, criteria: Criteria) {
  let score = listing.orbitScore;
  score += listing.priceConfidence === "confirmed" ? 30 : listing.priceConfidence === "indexed" ? 18 : 0;
  if (listing.images.length) score += 22;
  if (listing.surface !== undefined) {
    score += 4;
    if (criteria.minSurface) {
      const ratio = listing.surface / criteria.minSurface;
      if (ratio >= 1) score += 8;
      else if (ratio >= 0.85) score += 4;
    }
  }
  if (listing.bedrooms !== undefined && criteria.minBedrooms) {
    if (listing.bedrooms >= criteria.minBedrooms) score += 6;
    else if (listing.bedrooms >= criteria.minBedrooms - 1) score += 2;
  }
  return score;
}

async function enrichUntilTen(listings: Listing[], criteria: Criteria) {
  const cleanListings: Listing[] = [];
  const allEnriched: Listing[] = [];
  const selected = listings.slice(0, MAX_ENRICH);
  for (let i = 0; i < selected.length; i += BATCH_SIZE) {
    const batch = await Promise.all(selected.slice(i, i + BATCH_SIZE).map((listing) => enrichListing(listing, criteria)));
    allEnriched.push(...batch);
    for (const listing of batch) {
      if (isUsableFinal(listing, criteria)) cleanListings.push(listing);
    }
    if (cleanListings.length >= TARGET) break;
  }
  return { cleanListings, allEnriched };
}

function buildQueries(original: string, criteria: Criteria) {
  const location = criteria.location ?? criteria.city ?? "";
  const terms = COUNTRY_TERMS[criteria.country ?? ""] ?? "house property for sale real estate";
  const surface = criteria.minSurface;
  const ranges = surface
    ? [
        `${Math.max(20, Math.round(surface * 0.82))} ${Math.round(surface * 1.25)} m2`,
        `${Math.max(20, Math.round(surface * 0.7))} ${Math.round(surface * 1.4)} m2`,
      ]
    : [];
  const baseDetails = [
    criteria.budgetMax ? `moins de ${criteria.budgetMax} ${criteria.currency}` : "",
    criteria.minBedrooms ? `${criteria.minBedrooms} chambres` : "",
    criteria.pool ? "piscine" : "",
    criteria.garage ? "garage" : "",
    criteria.garden ? "jardin" : "",
  ].filter(Boolean).join(" ");
  const domains = criteria.country ? COUNTRY_DOMAINS[criteria.country] ?? [] : [];
  const queries = [
    original,
    `${location} ${terms} ${surface ? `${surface} m2` : ""} ${baseDetails}`,
    `${location} ${terms} ${ranges[0] ?? ""} ${baseDetails}`,
    `${location} ${terms} ${ranges[1] ?? ""} ${baseDetails}`,
    `${location} maison à vendre ${baseDetails}`,
    ...domains.flatMap((domain) => [
      `site:${domain} ${location} maison à vendre ${surface ? `${surface} m2` : ""} ${baseDetails}`,
      `site:${domain} ${location} maison à vendre ${ranges[0] ?? ""} ${baseDetails}`,
    ]),
  ];
  return [...new Set(queries.map(clean).filter(Boolean))].slice(0, 28);
}

function dedupeResults(results: SearchResult[]) {
  const seen = new Set<string>();
  const output: SearchResult[] = [];
  for (const result of results) {
    if (!result.url) continue;
    const key = normalizedUrl(result.url);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(result);
  }
  return output;
}

function sortListings(listings: Listing[], criteria: Criteria) {
  if (criteria.sortPriority === "lowest_price") {
    return [...listings].sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER) || quality(b, criteria) - quality(a, criteria));
  }
  if (criteria.sortPriority === "largest") {
    return [...listings].sort((a, b) => (b.surface ?? 0) - (a.surface ?? 0) || quality(b, criteria) - quality(a, criteria));
  }
  return [...listings].sort((a, b) => quality(b, criteria) - quality(a, criteria));
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname !== "/api/search" || request.method !== "POST") return NextResponse.next();

  try {
    const body = await request.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const filters = body?.filters && typeof body.filters === "object" ? (body.filters as FilterOverrides) : {};
    if (!query) return NextResponse.json({ success: false, error: "La recherche est vide." }, { status: 400 });

    const criteria = await parseCriteria(query, filters);
    const queries = buildQueries(query, criteria);
    let unique: SearchResult[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const limit = page <= 2 ? queries.length : Math.min(16, queries.length);
      const batches = await Promise.all(queries.slice(0, limit).map((q) => searxngSearch(q, page)));
      unique = dedupeResults([...unique, ...batches.flat()]);
      if (unique.length >= 220) break;
    }

    const candidates = unique
      .map((result) => toListing(result, criteria))
      .filter((item): item is Listing => Boolean(item))
      .sort((a, b) => b.orbitScore - a.orbitScore);

    const { cleanListings, allEnriched } = await enrichUntilTen(candidates, criteria);
    let listings = sortListings(cleanListings, criteria).slice(0, TARGET);

    if (listings.length < TARGET) {
      const reserve = allEnriched
        .filter((listing) => isUsableFinal(listing, criteria))
        .filter((listing) => !listings.some((existing) => normalizedUrl(existing.url) === normalizedUrl(listing.url)))
        .sort((a, b) => quality(b, criteria) - quality(a, criteria));
      listings = [...listings, ...reserve].slice(0, TARGET);
    }

    listings = listings.map((listing, index) => ({ ...listing, id: `listing-${index}` }));
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
      candidateCount: candidates.length,
      listingCount: listings.length,
      analyzedCandidateCount: Math.min(candidates.length, MAX_ENRICH),
      snippetListingCount: candidates.length,
      enrichedListingCount: allEnriched.length,
      recoveryPoolCount: allEnriched.length,
      verifiedListingCount: cleanListings.length,
      targetListingCount: TARGET,
      confirmedPriceCount: listings.filter((listing) => listing.priceConfidence === "confirmed").length,
      photoCount: listings.filter((listing) => listing.images.length > 0).length,
      creditsUsed: null,
      sources,
      listings,
      searchEngineVersion: "16.0-ten-complete-listings",
      searchProvider: "SearXNG",
    });
  } catch (error) {
    console.error("ORBIT search error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "SearXNG n'a pas pu effectuer la recherche.",
        sourceCount: 0,
        candidateCount: 0,
        listingCount: 0,
        sources: [],
        listings: [],
        searchProvider: "SearXNG",
        creditsUsed: null,
      },
      { status: 503 },
    );
  }
}

export const config = { matcher: ["/api/search"] };
