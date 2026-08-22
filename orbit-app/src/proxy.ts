import { NextRequest, NextResponse } from "next/server";

import { detectLocationWithAI } from "@/lib/search/location";
import { parsePriceFromText, sanitizePropertyPrice } from "@/lib/search/price";

type SearXNGResult = {
  url?: string;
  title?: string;
  content?: string;
  score?: number;
  engine?: string;
  engines?: string[];
  thumbnail?: string;
  img_src?: string;
};

type SearXNGResponse = { query?: string; results?: SearXNGResult[] };

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
  priceConfidence?: "confirmed" | "snippet" | "none";
};

const TARGET = 10;
const PAGE_ENRICH_LIMIT = 16;

const COUNTRY_DOMAINS: Record<string, string[]> = {
  France: ["seloger.com", "bienici.com", "ouestfrance-immo.com", "leboncoin.fr", "orpi.com", "century21.fr"],
  "United States": ["zillow.com", "redfin.com", "realtor.com", "homes.com", "compass.com"],
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

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "web"; }
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
    const context = norm(text.slice(Math.max(0, index - 55), Math.min(text.length, index + match[0].length + 55)));
    if (/\b(terrain|parcelle|land|plot|lot|garden size|jardin de|acre|hectare|grounds?)\b/.test(context)) continue;
    const maxLiving = criteria.minSurface && criteria.minSurface > 1000 ? 5000 : 1200;
    if (value < 10 || value > maxLiving) continue;
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
    const context = norm(text.slice(Math.max(0, index - 55), Math.min(text.length, index + match[0].length + 55)));
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

function toListing(result: SearXNGResult, criteria: Criteria): Listing | null {
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
    if (norm(combined).includes(norm(criteria.city))) {
      matchScore += 23;
      reasons.push(`${criteria.city} détecté dans l'annonce`);
    } else {
      matchScore -= 8;
      compromises.push(`${criteria.city} non confirmé dans l'extrait`);
    }
  }
  if (criteria.country && norm(combined).includes(norm(criteria.country))) matchScore += 5;

  if (criteria.propertyType === "house") {
    if (kind === "existing_house" || kind === "villa") {
      matchScore += 18;
      reasons.push("Type maison détecté");
    } else if (kind === "apartment") {
      matchScore -= 30;
      compromises.push("Semble être un appartement");
    } else compromises.push("Type exact non confirmé");
  }

  if (criteria.minSurface) {
    if (surface !== undefined) {
      if (surface >= criteria.minSurface) {
        matchScore += 14;
        reasons.push(`${surface} m² habitables détectés`);
      } else {
        const gap = (criteria.minSurface - surface) / criteria.minSurface;
        if (gap <= 0.1) {
          matchScore += 4;
          compromises.push(`${surface} m², légèrement sous ${criteria.minSurface} m²`);
        } else if (gap <= 0.25) {
          matchScore -= 5;
          compromises.push(`${surface} m² sous le minimum souhaité`);
        } else {
          matchScore -= 14;
          compromises.push(`Surface nettement sous ${criteria.minSurface} m²`);
        }
      }
    } else compromises.push("Surface habitable non confirmée");
  }

  if (criteria.maxSurface && surface !== undefined && surface > criteria.maxSurface) {
    matchScore -= 10;
    compromises.push(`Surface supérieure au maximum de ${criteria.maxSurface} m²`);
  }

  if (criteria.budgetMin && price !== undefined && price < criteria.budgetMin) matchScore -= 3;
  if (criteria.budgetMax && price !== undefined) {
    if (price <= criteria.budgetMax) {
      matchScore += 10;
      valueScore += 8;
      reasons.push("Dans le budget");
    } else {
      const over = (price - criteria.budgetMax) / criteria.budgetMax;
      if (over <= 0.1) compromises.push("Légèrement au-dessus du budget");
      else {
        matchScore -= 12;
        compromises.push("Au-dessus du budget");
      }
    }
  }

  if (criteria.minBedrooms && bedrooms !== undefined) {
    if (bedrooms >= criteria.minBedrooms) {
      matchScore += 8;
      reasons.push(`${bedrooms} chambres`);
    } else {
      matchScore -= 8;
      compromises.push("Moins de chambres que demandé");
    }
  }
  if (criteria.minBathrooms && bathrooms !== undefined) {
    if (bathrooms >= criteria.minBathrooms) matchScore += 5;
    else matchScore -= 5;
  }

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
      compromises.push(`${label} non confirmé dans l'extrait`);
    }
  }

  if (priceResult.confidence === "confirmed" && price !== undefined) reasons.push("Prix détecté avec devise explicite");
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
    images: (result.thumbnail ?? result.img_src)?.startsWith("http") ? [result.thumbnail ?? result.img_src ?? ""] : [],
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

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function pageText(html: string) {
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1] ?? "")
    .join(" ");
  const meta = [...html.matchAll(/<meta[^>]+(?:content|value)=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1] ?? "")
    .join(" ");
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(`${title} ${meta} ${jsonLd} ${visible}`).replace(/\s+/g, " ").slice(0, 450_000);
}

function structuredPriceText(html: string, currency: string) {
  const chunks: string[] = [];
  const patterns = [
    /(?:itemprop|property|name)=["'][^"']*(?:price|amount)[^"']*["'][^>]*(?:content|value)=["']([^"']+)["']/gi,
    /(?:content|value)=["']([^"']+)["'][^>]*(?:itemprop|property|name)=["'][^"']*(?:price|amount)[^"']*["']/gi,
    /["']price["']\s*:\s*["']?([0-9][0-9\s.,]*)["']?/gi,
    /["']priceCurrency["']\s*:\s*["']([A-Z]{3})["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = clean(match[1]);
      if (value) chunks.push(value);
      if (chunks.length >= 20) break;
    }
  }
  if (!chunks.length) return "";
  return chunks.map((chunk) => `${currency} ${chunk}`).join(" listing price ");
}

async function fetchListingHtml(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; ORBIT/1.0; +https://github.com/Zetix2030/ORBIT)",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) return undefined;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return undefined;
    return (await response.text()).slice(0, 1_200_000);
  } catch {
    return undefined;
  }
}

async function enrichListing(listing: Listing, criteria: Criteria): Promise<Listing> {
  if (listing.priceConfidence === "confirmed" && listing.surface !== undefined) return listing;
  const html = await fetchListingHtml(listing.url);
  if (!html) return listing;

  const text = pageText(html);
  const structured = structuredPriceText(html, listing.currency ?? criteria.currency);
  const pagePrice = parsePriceFromText(`${structured} ${text}`, listing.currency ?? criteria.currency);
  const pageSurface = parseSurface(text, criteria);
  const finalSurface = pageSurface ?? listing.surface;
  const candidatePrice = sanitizePropertyPrice(
    pagePrice.value,
    pagePrice.currency ?? listing.currency ?? criteria.currency,
    finalSurface,
    pagePrice.confidence,
  );

  const usePagePrice = candidatePrice !== undefined && (
    listing.price === undefined ||
    listing.priceConfidence !== "confirmed" ||
    pagePrice.confidence === "confirmed"
  );

  const finalPrice = usePagePrice ? candidatePrice : listing.price;
  const finalCurrency = usePagePrice ? (pagePrice.currency ?? listing.currency ?? criteria.currency) : listing.currency;
  const finalConfidence = usePagePrice ? "confirmed" : listing.priceConfidence;
  const reasons = [...listing.reasons];
  const compromises = listing.compromises.filter((item) => !/prix/i.test(item));

  if (usePagePrice) reasons.unshift("Prix vérifié sur la page source");
  else if (finalPrice === undefined) compromises.push("Prix disponible sur l'annonce source");

  return {
    ...listing,
    price: finalPrice,
    currency: finalCurrency,
    surface: finalSurface,
    bedrooms: parseBedrooms(text) ?? listing.bedrooms,
    bathrooms: parseBathrooms(text) ?? listing.bathrooms,
    garden: listing.garden || has(text, /\b(jardin|garden|yard)\b/),
    garage: listing.garage || has(text, /\bgarage\b/),
    pool: listing.pool || has(text, /\b(piscine|pool|swimming pool)\b/),
    terrace: listing.terrace || has(text, /\b(terrasse|terrace|patio)\b/),
    parking: listing.parking || has(text, /\b(parking|stationnement|carport|driveway)\b/),
    pricePerM2: finalPrice && finalSurface ? Math.round(finalPrice / finalSurface) : undefined,
    priceConfidence: finalPrice !== undefined ? finalConfidence : "none",
    reasons: [...new Set(reasons)].slice(0, 10),
    compromises: [...new Set(compromises)].slice(0, 10),
  };
}

async function enrichListings(listings: Listing[], criteria: Criteria) {
  const selected = listings
    .map((listing, index) => ({ listing, index }))
    .filter(({ listing }) => listing.priceConfidence !== "confirmed" || listing.surface === undefined)
    .slice(0, PAGE_ENRICH_LIMIT);

  const enriched = await Promise.all(selected.map(({ listing }) => enrichListing(listing, criteria)));
  const output = [...listings];
  selected.forEach(({ index }, i) => { output[index] = enriched[i] ?? output[index]; });
  return output;
}

async function searxngSearch(query: string, pageno = 1): Promise<SearXNGResult[]> {
  const base = (process.env.SEARXNG_URL ?? "http://localhost:8080").replace(/\/$/, "");
  try {
    const url = new URL(`${base}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("pageno", String(pageno));
    url.searchParams.set("safesearch", "0");
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as SearXNGResponse;
    return Array.isArray(payload.results) ? payload.results : [];
  } catch {
    return [];
  }
}

function buildQueries(original: string, criteria: Criteria) {
  const city = criteria.city ?? "";
  const country = criteria.country ?? "";
  const areaMetric = criteria.minSurface ? `${criteria.minSurface} m2` : "";
  const areaImperial = criteria.minSurface && criteria.country === "United States"
    ? `${Math.round(criteria.minSurface / 0.092903)} sqft`
    : "";
  const localTerms = COUNTRY_TERMS[criteria.country ?? ""] ?? "house for sale real estate";
  const features = [
    criteria.garden ? "garden" : "",
    criteria.garage ? "garage" : "",
    criteria.pool ? "pool" : "",
    criteria.terrace ? "terrace" : "",
    criteria.parking ? "parking" : "",
  ].filter(Boolean).join(" ");

  const queries = [
    original,
    [localTerms, city, country, areaMetric, features].filter(Boolean).join(" "),
    ["house for sale", city, country, areaImperial || areaMetric, features].filter(Boolean).join(" "),
  ];

  for (const domain of (COUNTRY_DOMAINS[criteria.country ?? ""] ?? []).slice(0, 5)) {
    queries.push(`site:${domain} ${city} ${areaImperial || areaMetric} ${features} ${criteria.propertyType === "house" ? "house" : "property"}`);
  }
  return [...new Set(queries.map(clean).filter(Boolean))].slice(0, 8);
}

function dedupeResults(results: SearXNGResult[]) {
  const seen = new Set<string>();
  const output: SearXNGResult[] = [];
  for (const item of results) {
    if (!item.url) continue;
    let key = item.url;
    try {
      const url = new URL(item.url);
      url.hash = "";
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((param) => url.searchParams.delete(param));
      key = `${url.origin}${url.pathname}${url.search}`.replace(/\/$/, "");
    } catch {}
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function applyStrongFilters(listings: Listing[], criteria: Criteria) {
  return listings.filter((listing) => {
    if (criteria.budgetMin && listing.price !== undefined && listing.price < criteria.budgetMin) return false;
    if (criteria.budgetMax && listing.price !== undefined && listing.price > criteria.budgetMax * 1.15) return false;
    if (criteria.minSurface && listing.surface !== undefined && listing.surface < criteria.minSurface * 0.75) return false;
    if (criteria.maxSurface && listing.surface !== undefined && listing.surface > criteria.maxSurface * 1.15) return false;
    if (criteria.minBedrooms && listing.bedrooms !== undefined && listing.bedrooms < criteria.minBedrooms) return false;
    if (criteria.minBathrooms && listing.bathrooms !== undefined && listing.bathrooms < criteria.minBathrooms) return false;
    if (criteria.propertyType === "house" && listing.propertyKind === "apartment") return false;
    return true;
  });
}

function priceQuality(listing: Listing) {
  if (listing.price !== undefined && listing.priceConfidence === "confirmed") return 2;
  if (listing.price !== undefined) return 1;
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
    const firstPass = await Promise.all(queries.map((searchQuery) => searxngSearch(searchQuery, 1)));
    let unique = dedupeResults(firstPass.flat());

    if (unique.length < 25) {
      const secondPass = await Promise.all(queries.slice(0, 4).map((searchQuery) => searxngSearch(searchQuery, 2)));
      unique = dedupeResults([...unique, ...secondPass.flat()]);
    }

    let listings = unique.map((result) => toListing(result, criteria)).filter((item): item is Listing => Boolean(item));
    listings.sort((a, b) => b.orbitScore - a.orbitScore);
    listings = await enrichListings(listings.slice(0, 24), criteria);

    const stronglyFiltered = applyStrongFilters(listings, criteria);
    listings = stronglyFiltered.length >= 4 ? stronglyFiltered : listings;

    if (criteria.sortPriority === "lowest_price") {
      listings.sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER) || b.orbitScore - a.orbitScore);
    } else if (criteria.sortPriority === "largest") {
      listings.sort((a, b) => (b.surface ?? 0) - (a.surface ?? 0) || priceQuality(b) - priceQuality(a) || b.orbitScore - a.orbitScore);
    } else {
      listings.sort((a, b) => priceQuality(b) - priceQuality(a) || b.orbitScore - a.orbitScore);
    }

    const reliable = listings.filter((listing) => priceQuality(listing) > 0);
    if (reliable.length >= TARGET) listings = reliable;
    else if (reliable.length >= 6) {
      const reliableUrls = new Set(reliable.map((listing) => listing.url));
      listings = [...reliable, ...listings.filter((listing) => !reliableUrls.has(listing.url))];
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
      enrichedListingCount: listings.filter((listing) => listing.reasons.includes("Prix vérifié sur la page source")).length,
      recoveryPoolCount: listings.length,
      verifiedListingCount: listings.filter((listing) => listing.priceConfidence === "confirmed").length,
      targetListingCount: TARGET,
      confirmedPriceCount: listings.filter((listing) => listing.priceConfidence === "confirmed").length,
      photoCount: listings.filter((listing) => listing.images.length > 0).length,
      creditsUsed: null,
      sources,
      listings,
      searchEngineVersion: "10.0-searxng-page-verification",
      searchProvider: "SearXNG",
    });
  } catch (error) {
    console.error("ORBIT SearXNG proxy error:", error);
    return NextResponse.next();
  }
}

export const config = { matcher: ["/api/search"] };
