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

type SearXNGResponse = {
  query?: string;
  results?: SearXNGResult[];
};

type Criteria = {
  category: "real_estate";
  intent: "buy";
  propertyType?: string;
  city?: string;
  country?: string;
  location?: string;
  currency: string;
  budgetMax?: number;
  minSurface?: number;
  minBedrooms?: number;
  requirements: string[];
  preferences: string[];
  sortPriority: "best_match";
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
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

function parseSimpleNumber(raw: string | undefined) {
  if (!raw) return undefined;
  const n = Number(raw.replace(/[\s\u00a0]/g, "").replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function parseCriteria(query: string): Promise<Criteria> {
  const q = norm(query);
  const location = await detectLocationWithAI(query, process.env.OPENAI_API_KEY);

  const surfaceMatch = q.match(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|metres? carres?|sqm|sq\s*m)/i);
  const bedroomsMatch = q.match(/(\d{1,2})\s*(?:chambres?|bedrooms?|beds?)/i);
  const budgetMatch =
    q.match(/(?:moins de|sous|budget(?: max)?|max(?:imum)?|under|below|up to)\s*([\d\s.,]+)\s*(?:€|eur|euros?|\$|usd|£|gbp)?/i) ??
    q.match(/([\d\s.,]{4,})\s*(?:€|eur|euros?|\$|usd|£|gbp)/i);

  const house = /\b(maison|maisons|house|houses|villa|villas|home|homes|haus|casa|huis)\b/i.test(q);

  return {
    category: "real_estate",
    intent: "buy",
    propertyType: house ? "house" : undefined,
    city: location.city,
    country: location.country,
    location: [location.city, location.country].filter(Boolean).join(", ") || undefined,
    currency: location.currency ?? "EUR",
    budgetMax: parseSimpleNumber(budgetMatch?.[1]),
    minSurface: surfaceMatch ? Number(surfaceMatch[1].replace(",", ".")) : undefined,
    minBedrooms: bedroomsMatch ? Number(bedroomsMatch[1]) : undefined,
    requirements: [],
    preferences: [],
    sortPriority: "best_match",
  };
}

function parseSurface(text: string) {
  const metric = text.match(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|sqm|sq\s*m)\b/i);
  if (metric?.[1]) {
    const value = parseSimpleNumber(metric[1]);
    if (value && value >= 10 && value <= 5000) return Math.round(value * 10) / 10;
  }

  const imperial = text.match(/([\d,]{3,7})\s*(?:sq\.?\s*ft|square\s*feet|sqft)\b/i);
  if (imperial?.[1]) {
    const sqft = Number(imperial[1].replace(/,/g, ""));
    if (Number.isFinite(sqft) && sqft >= 100 && sqft <= 100000) {
      return Math.round(sqft * 0.092903 * 10) / 10;
    }
  }

  return undefined;
}

function parseBedrooms(text: string) {
  const match = text.match(/(\d{1,2})\s*(?:chambres?|bedrooms?|beds?|bed)\b/i);
  const value = match ? Number(match[1]) : undefined;
  return value && value <= 30 ? value : undefined;
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
  return /\b(vacation rental|location vacances|hotel|booking|airbnb|emploi|job|actualité|actualite|news|wikipedia|definition|dictionary)\b/.test(q);
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

  const surface = parseSurface(combined);
  const priceResult = parsePriceFromText(combined, criteria.currency);
  const price = sanitizePropertyPrice(priceResult.value, priceResult.currency ?? criteria.currency, surface);
  const bedrooms = parseBedrooms(combined);
  const kind = detectKind(combined);
  const domain = host(result.url);

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

  if (criteria.country && norm(combined).includes(norm(criteria.country))) {
    matchScore += 5;
  }

  if (criteria.propertyType === "house") {
    if (kind === "existing_house" || kind === "villa") {
      matchScore += 18;
      reasons.push("Type maison détecté");
    } else if (kind === "apartment") {
      matchScore -= 30;
      compromises.push("Semble être un appartement");
    } else {
      compromises.push("Type exact non confirmé");
    }
  }

  if (criteria.minSurface) {
    if (surface !== undefined) {
      if (surface >= criteria.minSurface) {
        matchScore += 14;
        reasons.push(`${surface} m²`);
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
    } else {
      compromises.push("Surface non confirmée");
    }
  }

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

  if (priceResult.confidence === "confirmed" && price !== undefined) {
    reasons.push("Prix détecté avec devise explicite");
  } else if (price === undefined) {
    compromises.push("Prix non confirmé");
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
    currency: priceResult.currency ?? criteria.currency,
    surface,
    bedrooms,
    location: criteria.location,
    images: (result.thumbnail ?? result.img_src)?.startsWith("http") ? [result.thumbnail ?? result.img_src ?? ""] : [],
    pricePerM2: price && surface ? Math.round(price / surface) : undefined,
    propertyKind: kind,
    matchScore,
    valueScore,
    orbitScore,
    reasons: reasons.slice(0, 8),
    compromises: compromises.slice(0, 8),
    extractedAt: new Date().toISOString(),
    priceConfidence: priceResult.confidence,
  };
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
      signal: AbortSignal.timeout(7000),
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

  const queries = [
    original,
    [localTerms, city, country, areaMetric].filter(Boolean).join(" "),
    ["house for sale", city, country, areaImperial || areaMetric].filter(Boolean).join(" "),
  ];

  for (const domain of (COUNTRY_DOMAINS[criteria.country ?? ""] ?? []).slice(0, 5)) {
    queries.push(`site:${domain} ${city} ${areaImperial || areaMetric} ${criteria.propertyType === "house" ? "house" : "property"}`);
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
    } catch {
      // keep original URL
    }
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname !== "/api/search" || request.method !== "POST") {
    return NextResponse.next();
  }

  try {
    const body = await request.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";

    if (!query) {
      return NextResponse.json({ success: false, error: "La recherche est vide." }, { status: 400 });
    }

    const criteria = await parseCriteria(query);
    const queries = buildQueries(query, criteria);

    // SearXNG is the primary and free/self-hosted search engine.
    const firstPass = await Promise.all(queries.map((searchQuery) => searxngSearch(searchQuery, 1)));
    let unique = dedupeResults(firstPass.flat());

    // If recall is low, fetch a second SearXNG page for the strongest generic queries.
    if (unique.length < 20) {
      const secondPass = await Promise.all(queries.slice(0, 3).map((searchQuery) => searxngSearch(searchQuery, 2)));
      unique = dedupeResults([...unique, ...secondPass.flat()]);
    }

    let listings = unique
      .map((result) => toListing(result, criteria))
      .filter((item): item is Listing => Boolean(item));

    if (criteria.propertyType === "house") {
      // Explicit apartments are excluded, unknown types survive as fallback.
      listings = listings.filter((listing) => listing.propertyKind !== "apartment");
    }

    listings.sort((a, b) => b.orbitScore - a.orbitScore);
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
      enrichedListingCount: 0,
      recoveryPoolCount: listings.length,
      verifiedListingCount: listings.length,
      targetListingCount: TARGET,
      confirmedPriceCount: listings.filter((listing) => typeof listing.price === "number").length,
      photoCount: listings.filter((listing) => listing.images.length > 0).length,
      creditsUsed: 0,
      sources,
      listings,
      searchEngineVersion: "8.0-searxng-global",
      searchProvider: "SearXNG",
    });
  } catch (error) {
    console.error("ORBIT SearXNG proxy error:", error);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/api/search"],
};
