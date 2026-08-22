import { NextRequest, NextResponse } from "next/server";

import { detectLocationWithAI } from "@/lib/search/location";
import { parseLocalizedInteger, parsePriceFromText, sanitizePropertyPrice } from "@/lib/search/price";

type SearchResult = {
  url?: string;
  title?: string;
  content?: string;
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

type SourceDetails = {
  price?: number;
  currency?: string;
  surface?: number;
  bedrooms?: number;
  bathrooms?: number;
  images: string[];
};

const TARGET = 10;
const ENRICH_LIMIT = 24;

const COUNTRY_DOMAINS: Record<string, string[]> = {
  France: ["seloger.com", "bienici.com", "ouestfrance-immo.com", "leboncoin.fr", "orpi.com", "century21.fr", "fnaim.fr", "logic-immo.com", "iadfrance.fr"],
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
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "web"; }
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
  const minSurface = lastMatchNumber(q, /(?:surface\s*)?(?:minimum|min\.?|au moins|at least)\s*(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|sqm|sq\s*m)/gi);
  const maxSurface = lastMatchNumber(q, /(?:surface\s*)?(?:maximum|max\.?|jusqu(?:a|')a|up to)\s*(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|sqm|sq\s*m)/gi);
  const anySurface = lastMatchNumber(q, /(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|metres? carres?|sqm|sq\s*m)/gi);
  const bedrooms = lastMatchNumber(q, /(\d{1,2})\s*(?:chambres?|bedrooms?|beds?)/gi);
  const bathrooms = lastMatchNumber(q, /(\d{1,2})\s*(?:sdb|salles? de bain|bathrooms?|baths?)/gi);
  const budgetMin = lastMatchNumber(q, /(?:prix\s*)?(?:minimum|min\.?|au moins|at least)\s*([\d\s.,]+)\s*(?:€|eur|euros?|\$|usd|£|gbp)?/gi);
  const budgetMax = lastMatchNumber(q, /(?:moins de|sous|budget(?: max)?|prix\s*max(?:imum)?|maximum|max\.?|under|below|up to)\s*([\d\s.,]+)\s*(?:€|eur|euros?|\$|usd|£|gbp)?/gi);
  const bareBudget = lastMatchNumber(q, /([\d\s.,]{4,})\s*(?:€|eur|euros?|\$|usd|£|gbp)/gi);
  const house = /\b(maison|maisons|house|houses|villa|villas|home|homes|haus|casa|huis)\b/i.test(q);
  const sortPriority: Criteria["sortPriority"] = /prix\s+croissant|lowest price|prix le plus bas/i.test(q)
    ? "lowest_price"
    : /plus grande surface|largest/i.test(q)
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
    budgetMin: numeric(overrides.budgetMin) ?? budgetMin,
    budgetMax: numeric(overrides.budgetMax) ?? budgetMax ?? (budgetMin ? undefined : bareBudget),
    minSurface: numeric(overrides.minSurface) ?? minSurface ?? (maxSurface ? undefined : anySurface),
    maxSurface: numeric(overrides.maxSurface) ?? maxSurface,
    minBedrooms: numeric(overrides.minBedrooms) ?? bedrooms,
    minBathrooms: numeric(overrides.minBathrooms) ?? bathrooms,
    garden: overrides.garden ?? /\b(jardin|garden)\b/i.test(q),
    garage: overrides.garage ?? /\bgarage\b/i.test(q),
    pool: overrides.pool ?? /\b(piscine|pool|swimming pool)\b/i.test(q),
    terrace: overrides.terrace ?? /\b(terrasse|terrace)\b/i.test(q),
    parking: overrides.parking ?? /\b(parking|stationnement|carport)\b/i.test(q),
    requirements: [],
    preferences: [],
    sortPriority: overrides.sortPriority ?? sortPriority,
  };
}

function parseSurface(text: string, criteria: Criteria) {
  const candidates: Array<{ value: number; score: number }> = [];
  for (const match of text.matchAll(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|sqm|sq\s*m)\b/gi)) {
    const value = numeric(match[1]);
    if (!value || value < 15 || value > 1000) continue;
    const index = match.index ?? 0;
    const context = norm(text.slice(Math.max(0, index - 100), index + match[0].length + 100));
    if (/\b(terrain|parcelle|land|plot|lot|acre|hectare|garden size|jardin de)\b/.test(context)) continue;
    let score = /\b(surface habitable|living area|living space|interior|floor area|habitable)\b/.test(context) ? 10 : 3;
    if (criteria.minSurface) score += Math.max(0, 3 - Math.abs(value - criteria.minSurface) / Math.max(50, criteria.minSurface));
    candidates.push({ value: Math.round(value * 10) / 10, score });
  }
  for (const match of text.matchAll(/([\d,]{3,7})\s*(?:sq\.?\s*ft|square\s*feet|sqft)\b/gi)) {
    const sqft = Number((match[1] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(sqft) || sqft < 150 || sqft > 20000) continue;
    const index = match.index ?? 0;
    const context = norm(text.slice(Math.max(0, index - 100), index + match[0].length + 100));
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

function toListing(result: SearchResult, criteria: Criteria): Listing | null {
  if (!result.url || looksLikeCollectionPage(result)) return null;
  const title = clean(result.title) || "Annonce immobilière";
  const description = clean(result.content);
  const combined = `${title} ${description}`;
  if (clearlyIrrelevant(combined)) return null;

  const surface = parseSurface(combined, criteria);
  const snippetPrice = parsePriceFromText(combined, criteria.currency);
  const snippetValue = snippetPrice.confidence === "confirmed"
    ? sanitizePropertyPrice(snippetPrice.value, snippetPrice.currency ?? criteria.currency, surface, "confirmed")
    : undefined;
  const bedrooms = parseBedrooms(combined);
  const bathrooms = parseBathrooms(combined);
  const kind = detectKind(combined);
  const domain = host(result.url);
  const garden = /\b(jardin|garden|yard)\b/i.test(combined);
  const garage = /\bgarage\b/i.test(combined);
  const pool = /\b(piscine|pool|swimming pool)\b/i.test(combined);
  const terrace = /\b(terrasse|terrace|patio)\b/i.test(combined);
  const parking = /\b(parking|stationnement|carport|driveway)\b/i.test(combined);

  let matchScore = 44;
  let valueScore = 50 + sourceTrust(domain, criteria.country);
  if (criteria.city) matchScore += norm(`${combined} ${result.url}`).includes(norm(criteria.city)) ? 23 : -8;
  if (criteria.propertyType === "house") matchScore += kind === "existing_house" || kind === "villa" ? 18 : kind === "apartment" ? -30 : 0;
  if (criteria.minSurface && surface !== undefined) matchScore += surface >= criteria.minSurface ? 14 : -10;
  if (criteria.budgetMax && snippetValue !== undefined) {
    if (snippetValue <= criteria.budgetMax) { matchScore += 10; valueScore += 8; }
    else matchScore -= 12;
  }
  if (criteria.minBedrooms && bedrooms !== undefined) matchScore += bedrooms >= criteria.minBedrooms ? 8 : -8;
  if (criteria.minBathrooms && bathrooms !== undefined) matchScore += bathrooms >= criteria.minBathrooms ? 5 : -5;
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
    price: snippetValue,
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
    pricePerM2: snippetValue && surface ? Math.round(snippetValue / surface) : undefined,
    propertyKind: kind,
    matchScore,
    valueScore,
    orbitScore,
    reasons: [],
    compromises: snippetValue === undefined ? ["Prix en cours de vérification"] : [],
    extractedAt: new Date().toISOString(),
    priceConfidence: snippetValue !== undefined ? "snippet" : "none",
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
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(6500) });
    if (!response.ok) return [];
    const payload = (await response.json()) as { results?: SearchResult[] };
    return Array.isArray(payload.results) ? payload.results : [];
  } catch { return []; }
}

async function fetchListingHtml(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return undefined;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return undefined;
    return (await response.text()).slice(0, 2_000_000);
  } catch { return undefined; }
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
  if (/logo|favicon|icon|avatar|sprite|placeholder|no[-_]?image|default|brand|cookie|tracking|pixel|banner|advert|ads?\b|social-share|og-default/.test(q)) return false;
  try {
    const imageHost = host(url);
    const sameFamily = imageHost === pageHost || imageHost.endsWith(`.${pageHost}`) || /cloudfront|akamai|cdn|imgix|images|media|static/.test(imageHost);
    return sameFamily;
  } catch { return false; }
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
  }
}

function candidateStructuredPrice(rawPrice: unknown, currency: unknown, criteria: Criteria, surface?: number) {
  const value = numeric(rawPrice);
  const cur = typeof currency === "string" && currency.length <= 5 ? currency.toUpperCase() : criteria.currency;
  const price = sanitizePropertyPrice(value, cur, surface, "confirmed");
  if (!price) return undefined;
  if (criteria.budgetMax && price > criteria.budgetMax * 8) return undefined;
  return { price, currency: cur };
}

function parseSourceDetails(html: string, criteria: Criteria, pageUrl: string): SourceDetails {
  const details: SourceDetails = { images: [] };
  const pageHost = host(pageUrl);

  const visit = (value: unknown) => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    const type = norm(Array.isArray(obj["@type"]) ? (obj["@type"] as unknown[]).join(" ") : obj["@type"]);
    const isRealEstate = /house|residence|singlefamily|apartment|accommodation|realestate|product|offer|place/.test(type);

    if (isRealEstate) {
      const offers = obj.offers as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
      const offer = Array.isArray(offers) ? offers[0] : offers;
      const specification = offer?.priceSpecification as Record<string, unknown> | undefined;
      const rawPrice = offer?.price ?? offer?.lowPrice ?? specification?.price ?? obj.price;
      const rawCurrency = offer?.priceCurrency ?? specification?.priceCurrency ?? obj.priceCurrency;
      if (!details.price) {
        const parsed = candidateStructuredPrice(rawPrice, rawCurrency, criteria, details.surface);
        if (parsed) { details.price = parsed.price; details.currency = parsed.currency; }
      }

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

      const beds = numeric(obj.numberOfBedrooms);
      const baths = numeric(obj.numberOfBathroomsTotal ?? obj.numberOfBathrooms);
      if (!details.bedrooms && beds && beds <= 20) details.bedrooms = Math.round(beds);
      if (!details.bathrooms && baths && baths <= 15) details.bathrooms = Math.round(baths);
      collectImage(obj.image, details.images, pageHost);
      collectImage(obj.photo, details.images, pageHost);
      collectImage(obj.primaryImageOfPage, details.images, pageHost);
    }

    if (obj["@graph"]) visit(obj["@graph"]);
    if (obj.mainEntity) visit(obj.mainEntity);
    if (obj.itemListElement) visit(obj.itemListElement);
  };

  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(decodeHtml(match[1] ?? ""))); } catch {}
  }

  // Common commerce/real-estate meta tags.
  if (!details.price) {
    const metaAmount = metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount") ?? metaContent(html, "price");
    const metaCurrency = metaContent(html, "product:price:currency") ?? metaContent(html, "og:price:currency") ?? criteria.currency;
    const parsed = candidateStructuredPrice(metaAmount, metaCurrency, criteria, details.surface);
    if (parsed) { details.price = parsed.price; details.currency = parsed.currency; }
  }

  // Conservative embedded JSON fallback used by many React/Next portals.
  if (!details.price) {
    const patterns = [
      /["'](?:price|salePrice|listingPrice|askingPrice)["']\s*:\s*["']?([\d\s.,]{4,15})["']?/gi,
      /["'](?:amount|value)["']\s*:\s*["']?([\d\s.,]{4,15})["']?\s*,\s*["'](?:currency|priceCurrency)["']\s*:\s*["']([A-Z]{3})["']/gi,
    ];
    for (const pattern of patterns) {
      for (const match of html.matchAll(pattern)) {
        const index = match.index ?? 0;
        const context = norm(html.slice(Math.max(0, index - 150), index + match[0].length + 150));
        if (/monthly|per month|rent|loyer|hoa|tax|mortgage|priceper|price_per|sqm|sqft/.test(context)) continue;
        const parsed = candidateStructuredPrice(match[1], match[2] ?? criteria.currency, criteria, details.surface);
        if (parsed) { details.price = parsed.price; details.currency = parsed.currency; break; }
      }
      if (details.price) break;
    }
  }

  const ogImage = metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
  if (validSourceImage(ogImage, pageHost)) details.images.push(ogImage!);
  details.images = [...new Set(details.images)].slice(0, 10);
  return details;
}

function sourceText(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? "").join(" ");
  const metas = [...html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1] ?? "").join(" ");
  return decodeHtml(`${title} ${metas} ${jsonLd}`).replace(/\s+/g, " ").slice(0, 300_000);
}

function titleTokens(title: string) {
  return norm(title).split(/[^a-z0-9]+/).filter((x) => x.length >= 4).slice(0, 8);
}

async function confirmPriceFromIndex(listing: Listing, criteria: Criteria) {
  const tokens = titleTokens(listing.title);
  const query = `site:${listing.source} "${listing.title.slice(0, 100)}"`;
  const results = await searxngSearch(query, 1);
  const candidates: Array<{ value: number; currency?: string }> = [];
  for (const result of results.slice(0, 8)) {
    if (!result.url || host(result.url) !== listing.source) continue;
    const text = `${clean(result.title)} ${clean(result.content)}`;
    const score = tokens.filter((token) => norm(text).includes(token)).length;
    if (tokens.length >= 3 && score < Math.min(3, tokens.length)) continue;
    const parsed = parsePriceFromText(text, listing.currency ?? criteria.currency);
    const value = sanitizePropertyPrice(parsed.value, parsed.currency ?? criteria.currency, listing.surface, parsed.confidence);
    if (value && parsed.confidence === "confirmed") candidates.push({ value, currency: parsed.currency });
  }
  if (!candidates.length) return undefined;
  const groups = new Map<number, Array<{ value: number; currency?: string }>>();
  for (const candidate of candidates) {
    const bucket = Math.round(candidate.value / Math.max(1000, candidate.value * 0.01));
    const list = groups.get(bucket) ?? [];
    list.push(candidate);
    groups.set(bucket, list);
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  return best?.[0];
}

async function enrichListing(listing: Listing, criteria: Criteria): Promise<Listing> {
  const html = await fetchListingHtml(listing.url);
  let details: SourceDetails = { images: [] };
  let text = "";
  if (html) {
    details = parseSourceDetails(html, criteria, listing.url);
    text = sourceText(html);
  }

  const surface = details.surface ?? (text ? parseSurface(text, criteria) : undefined) ?? listing.surface;
  let price = details.price;
  let currency = details.currency ?? listing.currency ?? criteria.currency;
  let confidence: PriceConfidence = price ? "confirmed" : "none";

  if (!price && text) {
    const parsed = parsePriceFromText(text, currency);
    const value = sanitizePropertyPrice(parsed.value, parsed.currency ?? currency, surface, parsed.confidence);
    // Source-page text is accepted only with a strong explicit price signal.
    if (value && parsed.confidence === "confirmed") {
      price = value;
      currency = parsed.currency ?? currency;
      confidence = "confirmed";
    }
  }

  if (!price) {
    const indexed = await confirmPriceFromIndex(listing, criteria);
    if (indexed?.value) {
      price = indexed.value;
      currency = indexed.currency ?? currency;
      confidence = "snippet";
    }
  }

  if (!price && listing.price && listing.priceConfidence === "snippet") {
    price = listing.price;
    confidence = "snippet";
  }

  if (criteria.budgetMax && price && confidence !== "confirmed" && price > criteria.budgetMax * 1.75) {
    price = undefined;
    confidence = "none";
  }

  return {
    ...listing,
    price,
    currency,
    surface,
    bedrooms: details.bedrooms ?? (text ? parseBedrooms(text) : undefined) ?? listing.bedrooms,
    bathrooms: details.bathrooms ?? (text ? parseBathrooms(text) : undefined) ?? listing.bathrooms,
    images: details.images,
    pricePerM2: price && surface ? Math.round(price / surface) : undefined,
    priceConfidence: confidence,
    reasons: [
      ...(confidence === "confirmed" ? ["Prix vérifié sur la page source"] : []),
      ...(details.images.length ? ["Photo provenant de la page de l'annonce"] : []),
    ],
    compromises: [
      ...(price ? [] : ["Prix non confirmé par la source"]),
      ...(details.images.length ? [] : ["Photo non disponible depuis la source"]),
    ],
  };
}

async function enrichListings(listings: Listing[], criteria: Criteria) {
  const selected = listings.slice(0, ENRICH_LIMIT);
  const output: Listing[] = [];
  // Small batches avoid hammering property portals and improve success rate.
  for (let i = 0; i < selected.length; i += 6) {
    const batch = await Promise.all(selected.slice(i, i + 6).map((listing) => enrichListing(listing, criteria)));
    output.push(...batch);
  }
  return [...output, ...listings.slice(ENRICH_LIMIT)];
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
  const portalQueries = domains.slice(0, 7).map((domain) => `site:${domain} ${location} ${terms} ${details}`);
  return [...new Set([original, `${location} ${terms} ${details}`, `${location} ${criteria.propertyType ?? "house"} ${details} for sale`, ...portalQueries])]
    .map(clean).filter(Boolean).slice(0, 10);
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
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((p) => u.searchParams.delete(p));
      key = `${u.origin}${u.pathname}${u.search}`.replace(/\/$/, "");
    } catch {}
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(result);
  }
  return output;
}

function applyFilters(listings: Listing[], criteria: Criteria) {
  return listings.filter((listing) => {
    if (criteria.propertyType === "house" && listing.propertyKind === "apartment") return false;
    if (criteria.budgetMin && listing.price !== undefined && listing.price < criteria.budgetMin) return false;
    if (criteria.budgetMax && listing.price !== undefined && listing.price > criteria.budgetMax * 1.15) return false;
    if (criteria.minSurface && listing.surface !== undefined && listing.surface < criteria.minSurface * 0.72) return false;
    if (criteria.maxSurface && listing.surface !== undefined && listing.surface > criteria.maxSurface * 1.18) return false;
    if (criteria.minBedrooms && listing.bedrooms !== undefined && listing.bedrooms < Math.max(1, criteria.minBedrooms - 1)) return false;
    return true;
  });
}

function quality(listing: Listing) {
  let score = listing.orbitScore;
  if (listing.priceConfidence === "confirmed") score += 30;
  else if (listing.price !== undefined) score += 8;
  if (listing.images.length > 0) score += 20;
  if (listing.surface !== undefined) score += 5;
  return score;
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
    const page1 = await Promise.all(queries.map((q) => searxngSearch(q, 1)));
    let unique = dedupeResults(page1.flat());
    if (unique.length < 35) {
      const page2 = await Promise.all(queries.slice(0, 7).map((q) => searxngSearch(q, 2)));
      unique = dedupeResults([...unique, ...page2.flat()]);
    }
    if (unique.length < 20) {
      const page3 = await Promise.all(queries.slice(0, 4).map((q) => searxngSearch(q, 3)));
      unique = dedupeResults([...unique, ...page3.flat()]);
    }

    let listings = unique.map((result) => toListing(result, criteria)).filter((item): item is Listing => Boolean(item));
    listings.sort((a, b) => b.orbitScore - a.orbitScore);
    listings = await enrichListings(listings.slice(0, 32), criteria);

    const filtered = applyFilters(listings, criteria);
    if (filtered.length >= 4) listings = filtered;

    if (criteria.sortPriority === "lowest_price") {
      listings.sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER) || quality(b) - quality(a));
    } else if (criteria.sortPriority === "largest") {
      listings.sort((a, b) => (b.surface ?? 0) - (a.surface ?? 0) || quality(b) - quality(a));
    } else {
      listings.sort((a, b) => quality(b) - quality(a));
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
      enrichedListingCount: listings.filter((listing) => listing.priceConfidence === "confirmed" || listing.images.length > 0).length,
      recoveryPoolCount: listings.length,
      verifiedListingCount: listings.filter((listing) => listing.priceConfidence === "confirmed").length,
      targetListingCount: TARGET,
      confirmedPriceCount: listings.filter((listing) => listing.priceConfidence === "confirmed").length,
      photoCount: listings.filter((listing) => listing.images.length > 0).length,
      creditsUsed: null,
      sources,
      listings,
      searchEngineVersion: "14.0-source-first-price-media",
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
