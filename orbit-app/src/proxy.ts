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
const PAGE_ENRICH_LIMIT = 18;

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

function collectSurfaceCandidates(text: string, criteria: Criteria) {
  const candidates: Array<{ value: number; index: number; confidence: number }> = [];
  const metric = /(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|sqm|sq\s*m)\b/gi;
  for (const match of text.matchAll(metric)) {
    const value = numeric(match[1]);
    if (!value) continue;
    const index = match.index ?? 0;
    const context = norm(text.slice(Math.max(0, index - 80), Math.min(text.length, index + match[0].length + 80)));
    if (/\b(terrain|parcelle|land|plot|lot|garden size|jardin de|acre|hectare|grounds?)\b/.test(context)) continue;
    if (value < 10 || value > 1000) continue;
    let confidence = 2;
    if (/\b(surface habitable|living area|interior|habitable|floor area|living space|interior size)\b/.test(context)) confidence += 6;
    if (criteria.minSurface) confidence += Math.max(0, 3 - Math.abs(value - criteria.minSurface) / Math.max(50, criteria.minSurface));
    candidates.push({ value: Math.round(value * 10) / 10, index, confidence });
  }

  const imperial = /([\d,]{3,7})\s*(?:sq\.?\s*ft|square\s*feet|sqft)\b/gi;
  for (const match of text.matchAll(imperial)) {
    const sqft = Number((match[1] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(sqft) || sqft < 150 || sqft > 20000) continue;
    const index = match.index ?? 0;
    const context = norm(text.slice(Math.max(0, index - 80), Math.min(text.length, index + match[0].length + 80)));
    if (/\b(lot|land|plot|acre|lot size|grounds?)\b/.test(context)) continue;
    const value = Math.round(sqft * 0.092903 * 10) / 10;
    if (value < 10 || value > 1000) continue;
    let confidence = 2;
    if (/\b(living|interior|heated|home size|house size|living area)\b/.test(context)) confidence += 6;
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
  return /\b(vacation rental|location vacances|hotel|booking|airbnb|emploi|job|actualite|news|wikipedia|definition|dictionary|toy|doll|poupee|barbie)\b/.test(q);
}

function sourceTrust(domain: string, country?: string) {
  const preferred = country ? COUNTRY_DOMAINS[country] ?? [] : [];
  if (preferred.some((item) => domain === item || domain.endsWith(`.${item}`))) return 12;
  if (/properstar|jamesedition|sothebysrealty|engelvoelkers/.test(domain)) return 5;
  return 0;
}

function looksLikeCollectionPage(result: SearchResult) {
  const title = norm(result.title);
  const content = norm(result.content);
  const combined = `${title} ${content}`;
  if (/\b\d{2,6}\s+(?:listings|annonces|homes|maisons|properties|biens)\b/.test(combined)) return true;
  if (/\b(?:homes|houses|properties|maisons|biens)\s+(?:for sale|à vendre|a vendre)\b/.test(title) && !/\b(ref|mls|reference|réf)\b/.test(title)) return true;
  if (/\b(?:search results|résultats de recherche|annonces immobilières|annonces immobilieres)\b/.test(title)) return true;
  try {
    const u = new URL(result.url ?? "");
    const path = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!path || path.split("/").length <= 1) {
      if (/\b(?:vente|buy|sale|immobilier|real estate|property|properties|maison|homes)\b/.test(title)) return true;
    }
  } catch {}
  return false;
}

function toListing(result: SearchResult, criteria: Criteria): Listing | null {
  if (!result.url || looksLikeCollectionPage(result)) return null;
  const title = clean(result.title) || "Annonce immobilière";
  const description = clean(result.content);
  const combined = `${title} ${description}`;
  if (isClearlyIrrelevant(combined)) return null;

  const surface = parseSurface(combined, criteria);
  const snippetPrice = parsePriceFromText(combined, criteria.currency);
  let price = sanitizePropertyPrice(snippetPrice.value, snippetPrice.currency ?? criteria.currency, surface, snippetPrice.confidence);
  if (criteria.budgetMax && price && snippetPrice.confidence !== "confirmed" && price > criteria.budgetMax * 2.5) price = undefined;

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
    if (kind === "existing_house" || kind === "villa") matchScore += 18;
    else if (kind === "apartment") matchScore -= 30;
  }

  if (criteria.minSurface && surface !== undefined) {
    if (surface >= criteria.minSurface) matchScore += 14;
    else matchScore += (criteria.minSurface - surface) / criteria.minSurface <= 0.1 ? 4 : -10;
  }
  if (criteria.maxSurface && surface !== undefined && surface > criteria.maxSurface) matchScore -= 10;

  if (criteria.budgetMax && price !== undefined) {
    if (price <= criteria.budgetMax) {
      matchScore += 10;
      valueScore += 8;
    } else {
      matchScore -= price <= criteria.budgetMax * 1.1 ? 2 : 12;
    }
  }

  if (criteria.minBedrooms && bedrooms !== undefined) matchScore += bedrooms >= criteria.minBedrooms ? 8 : -8;
  if (criteria.minBathrooms && bathrooms !== undefined) matchScore += bathrooms >= criteria.minBathrooms ? 5 : -5;

  const requestedFeatures: Array<[boolean | undefined, boolean]> = [
    [criteria.garden, garden], [criteria.garage, garage], [criteria.pool, pool], [criteria.terrace, terrace], [criteria.parking, parking],
  ];
  for (const [wanted, present] of requestedFeatures) {
    if (!wanted) continue;
    matchScore += present ? 5 : -2;
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
    price,
    currency: price !== undefined ? (snippetPrice.currency ?? criteria.currency) : criteria.currency,
    surface,
    bedrooms,
    bathrooms,
    location: criteria.location,
    garden,
    garage,
    pool,
    terrace,
    parking,
    // Deliberately ignore SearXNG thumbnails. They can belong to unrelated pages.
    images: [],
    pricePerM2: price && surface ? Math.round(price / surface) : undefined,
    propertyKind: kind,
    matchScore,
    valueScore,
    orbitScore,
    reasons: [],
    compromises: price === undefined ? ["Prix à vérifier sur l'annonce source"] : [],
    extractedAt: new Date().toISOString(),
    priceConfidence: price !== undefined ? snippetPrice.confidence : "none",
  };
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
      signal: AbortSignal.timeout(5500),
    });
    if (!response.ok) return undefined;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return undefined;
    return (await response.text()).slice(0, 1_500_000);
  } catch {
    return undefined;
  }
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return decodeHtml(value);
  }
  return undefined;
}

function validPropertyImage(url: unknown) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  const q = norm(url);
  if (/logo|favicon|icon|avatar|sprite|placeholder|no[-_]?image|default|brand|cookie|tracking|pixel|banner|advert|ads?\b/.test(q)) return false;
  return true;
}

function collectImageValue(value: unknown, out: string[]) {
  if (typeof value === "string") {
    if (validPropertyImage(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageValue(item, out);
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    collectImageValue(obj.url, out);
    collectImageValue(obj.contentUrl, out);
  }
}

function parseStructuredDetails(html: string, criteria: Criteria): StructuredDetails {
  const details: StructuredDetails = { images: [] };
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    const type = norm(Array.isArray(obj["@type"]) ? (obj["@type"] as unknown[]).join(" ") : obj["@type"]);
    const relevant = /house|residence|singlefamily|apartment|product|realestate|accommodation|offer/.test(type);

    if (relevant) {
      const offers = obj.offers as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
      const offer = Array.isArray(offers) ? offers[0] : offers;
      const rawPrice = offer?.price ?? offer?.lowPrice ?? (offer?.priceSpecification as Record<string, unknown> | undefined)?.price ?? obj.price;
      const rawCurrency = offer?.priceCurrency ?? (offer?.priceSpecification as Record<string, unknown> | undefined)?.priceCurrency ?? obj.priceCurrency;
      const p = numeric(rawPrice);
      if (!details.price && p && p >= 20_000 && p <= 250_000_000) {
        details.price = p;
        details.currency = typeof rawCurrency === "string" ? rawCurrency.toUpperCase() : criteria.currency;
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
        if (sqm >= 10 && sqm <= 1000) details.surface = Math.round(sqm * 10) / 10;
      }

      const beds = numeric(obj.numberOfBedrooms ?? obj.numberOfRooms);
      const baths = numeric(obj.numberOfBathroomsTotal ?? obj.numberOfBathrooms);
      if (!details.bedrooms && beds && beds <= 20) details.bedrooms = Math.round(beds);
      if (!details.bathrooms && baths && baths <= 15) details.bathrooms = Math.round(baths);

      collectImageValue(obj.image, details.images);
      collectImageValue(obj.photo, details.images);
      collectImageValue(obj.primaryImageOfPage, details.images);
    }

    if (obj["@graph"]) visit(obj["@graph"]);
    if (obj.mainEntity) visit(obj.mainEntity);
    if (obj.itemListElement) visit(obj.itemListElement);
  };

  for (const script of scripts) {
    try { visit(JSON.parse(decodeHtml(script[1] ?? ""))); } catch {}
  }

  const ogImage = metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
  if (validPropertyImage(ogImage)) details.images.push(ogImage!);
  details.images = [...new Set(details.images)].slice(0, 12);
  return details;
}

function pageText(html: string) {
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? "").join(" ");
  const meta = [...html.matchAll(/<meta[^>]+(?:content|value)=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1] ?? "").join(" ");
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return decodeHtml(`${title} ${meta} ${jsonLd}`).replace(/\s+/g, " ").slice(0, 260_000);
}

async function enrichListing(listing: Listing, criteria: Criteria): Promise<Listing> {
  const html = await fetchListingHtml(listing.url);
  if (!html) return { ...listing, images: [] };

  const structured = parseStructuredDetails(html, criteria);
  const text = pageText(html);
  const surface = structured.surface ?? parseSurface(text, criteria) ?? listing.surface;

  let finalPrice: number | undefined;
  let finalCurrency = listing.currency ?? criteria.currency;
  let priceConfidence: PriceConfidence = "none";

  if (structured.price) {
    finalCurrency = structured.currency ?? finalCurrency;
    finalPrice = sanitizePropertyPrice(structured.price, finalCurrency, surface, "confirmed");
    if (finalPrice) priceConfidence = "confirmed";
  }

  if (!finalPrice) {
    const pagePrice = parsePriceFromText(text, finalCurrency);
    const candidate = sanitizePropertyPrice(pagePrice.value, pagePrice.currency ?? finalCurrency, surface, pagePrice.confidence);
    if (candidate) {
      finalPrice = candidate;
      finalCurrency = pagePrice.currency ?? finalCurrency;
      priceConfidence = pagePrice.confidence === "confirmed" ? "confirmed" : "snippet";
    }
  }

  if (!finalPrice && listing.price) {
    finalPrice = listing.price;
    priceConfidence = listing.priceConfidence ?? "snippet";
  }

  // A price wildly outside the requested maximum and not structurally confirmed is more likely parsing noise.
  if (criteria.budgetMax && finalPrice && priceConfidence !== "confirmed" && finalPrice > criteria.budgetMax * 2.5) {
    finalPrice = undefined;
    priceConfidence = "none";
  }

  const images = structured.images;
  const reasons = [...listing.reasons];
  if (priceConfidence === "confirmed") reasons.unshift("Prix vérifié sur la page source");
  if (images.length) reasons.unshift("Photo récupérée sur la page source");

  return {
    ...listing,
    price: finalPrice,
    currency: finalCurrency,
    surface,
    bedrooms: structured.bedrooms ?? parseBedrooms(text) ?? listing.bedrooms,
    bathrooms: structured.bathrooms ?? parseBathrooms(text) ?? listing.bathrooms,
    images,
    pricePerM2: finalPrice && surface ? Math.round(finalPrice / surface) : undefined,
    priceConfidence,
    reasons: [...new Set(reasons)].slice(0, 10),
  };
}

async function enrichListings(listings: Listing[], criteria: Criteria) {
  const selected = listings.slice(0, PAGE_ENRICH_LIMIT);
  const enriched = await Promise.all(selected.map((listing) => enrichListing(listing, criteria)));
  return [...enriched, ...listings.slice(PAGE_ENRICH_LIMIT)];
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
  } catch {
    return [];
  }
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
  const portalQueries = domains.slice(0, 6).map((domain) => `site:${domain} ${location} ${terms} ${details}`);
  return [...new Set([original, `${location} ${terms} ${details}`, `${location} ${criteria.propertyType ?? "house"} ${details} for sale`, ...portalQueries])]
    .map(clean).filter(Boolean).slice(0, 9);
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

function quality(listing: Listing) {
  let score = listing.orbitScore;
  if (listing.priceConfidence === "confirmed") score += 18;
  else if (listing.price !== undefined) score += 5;
  if (listing.images.length > 0) score += 12;
  if (listing.surface !== undefined) score += 4;
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
    const first = await Promise.all(queries.map((q) => searxngSearch(q, 1)));
    let unique = dedupeResults(first.flat());
    if (unique.length < 30) {
      const second = await Promise.all(queries.slice(0, 6).map((q) => searxngSearch(q, 2)));
      unique = dedupeResults([...unique, ...second.flat()]);
    }
    if (unique.length < 18) {
      const third = await Promise.all(queries.slice(0, 4).map((q) => searxngSearch(q, 3)));
      unique = dedupeResults([...unique, ...third.flat()]);
    }

    let listings = unique.map((result) => toListing(result, criteria)).filter((item): item is Listing => Boolean(item));
    listings.sort((a, b) => b.orbitScore - a.orbitScore);
    listings = await enrichListings(listings.slice(0, 28), criteria);

    const filtered = applyStrongFilters(listings, criteria);
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
      searchEngineVersion: "13.0-source-verified-media",
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
