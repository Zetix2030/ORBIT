import { NextRequest, NextResponse } from "next/server";
import { detectLocationWithAI } from "@/lib/search/location";
import {
  parseLocalizedInteger,
  parsePriceFromText,
  sanitizePropertyPrice,
} from "@/lib/search/price";

type SortPriority = "best_match" | "lowest_price" | "largest";

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
  sortPriority?: SortPriority;
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
  sortPriority: SortPriority;
};

type SearxResult = {
  url?: string;
  title?: string;
  content?: string;
  thumbnail?: string;
  img_src?: string;
  engine?: string;
  engines?: string[];
  score?: number;
};

type Candidate = {
  url: string;
  normalizedUrl: string;
  title: string;
  description: string;
  source: string;
  engines: string[];
  snippetPrice?: number;
  snippetSurface?: number;
  snippetBedrooms?: number;
  snippetBathrooms?: number;
  snippetImage?: string;
  propertyKind: PropertyKind;
  cityMatched: boolean;
  discoveryScore: number;
};

type PropertyKind =
  | "existing_house"
  | "new_build_project"
  | "apartment"
  | "villa"
  | "unknown";

type PageEvidence = {
  title?: string;
  canonicalUrl?: string;
  price?: number;
  priceSource?: "jsonld" | "meta" | "page";
  surface?: number;
  bedrooms?: number;
  bathrooms?: number;
  images: string[];
  text: string;
  cityMatched: boolean;
  propertyKind: PropertyKind;
};

type ExactEvidence = {
  price?: number;
  priceVotes: number;
  engines: string[];
  image?: string;
  exactUrlMatches: number;
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
  landSurface?: number;
  bedrooms?: number;
  bathrooms?: number;
  rooms?: number;
  location: string;
  garden?: boolean;
  garage?: boolean;
  pool?: boolean;
  terrace?: boolean;
  parking?: boolean;
  dpe?: string;
  images: string[];
  pricePerM2?: number;
  propertyKind: PropertyKind;
  matchScore: number;
  valueScore: number;
  orbitScore: number;
  reasons: string[];
  compromises: string[];
  extractedAt: string;
  priceConfidence: "confirmed";
  imageConfidence: "confirmed" | "none";
};

type RejectionStats = {
  collection: number;
  foreign: number;
  wrongType: number;
  wrongCity: number;
  noPrice: number;
  budget: number;
  invalidPrice: number;
  duplicate: number;
  fetchFailed: number;
};

const TARGET = 45;
const PAGE_SIZE = 15;
const MAX_CANDIDATES = 220;
const MAX_ENRICH = 180;
const BATCH_SIZE = 12;
const PAGE_TIMEOUT_MS = 5500;
const SEARX_TIMEOUT_MS = 9000;

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
  "optimhome.com",
  "capifrance.fr",
  "guy-hoquet.com",
  "squarehabitat.fr",
];

const SECONDARY_PORTALS = [
  "fnaim.fr",
  "logic-immo.com",
  "bienici.com",
  "seloger.com",
  "leboncoin.fr",
  "3gimmobilier.com",
  "megagence.com",
  "proprietes.lefigaro.fr",
  "paruvendu.fr",
  "avendrealouer.fr",
  "figaro-immobilier.fr",
];

const FRENCH_PORTALS = [...PRIORITY_PORTALS, ...SECONDARY_PORTALS];
const PRIORITY_SET = new Set(PRIORITY_PORTALS);

const FOREIGN_MARKERS = /\b(miami|londres|london|new york|los angeles|dubai|madrid|barcelone|barcelona|berlin|rome|milan|lisbonne|lisbon|tokyo|sydney|toronto|usa|etats[- ]unis|états[- ]unis|royaume[- ]uni|uk|espagne|allemagne|italie|portugal|suisse|belgique|canada|australie)\b/i;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value: unknown) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'");
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

function stripHtml(value: string) {
  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function numberValue(value: unknown) {
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
  return matches.length ? numberValue(matches[matches.length - 1]?.[1]) : undefined;
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
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "xtor",
    ].forEach((key) => parsed.searchParams.delete(key));
    const query = parsed.searchParams.toString();
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}${query ? `?${query}` : ""}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}

function sameUrl(a: string, b: string) {
  const left = normalizeUrl(a);
  const right = normalizeUrl(b);
  if (left === right) return true;
  try {
    const A = new URL(left);
    const B = new URL(right);
    return A.hostname === B.hostname && A.pathname.replace(/\/$/, "") === B.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
}

function isFrenchPortal(url: string) {
  const domain = host(url);
  return FRENCH_PORTALS.some((portal) => domain === portal || domain.endsWith(`.${portal}`));
}

function portalPriority(url: string) {
  const domain = host(url);
  if (PRIORITY_SET.has(domain)) return 10;
  if (FRENCH_PORTALS.some((p) => domain === p || domain.endsWith(`.${p}`))) return 4;
  return 0;
}

function isLikelyCollection(result: Pick<SearxResult, "url" | "title" | "content">) {
  const url = result.url ?? "";
  const title = norm(result.title);
  const content = norm(result.content);
  const combined = `${title} ${content}`;

  if (/^\d{1,6}\s+(maisons?|appartements?|biens?|annonces?|resultats?)\b/.test(title)) return true;
  if (/\b\d{2,6}\s+(annonces|biens|maisons|appartements|resultats)\b/.test(title)) return true;
  if (/\b(resultats? de recherche|toutes les annonces|nos biens|liste des biens|voir toutes les annonces|catalogue immobilier)\b/.test(combined)) return true;

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase().replace(/\/$/, "");
    const parts = path.split("/").filter(Boolean);
    if (/\/(recherche|search|annonces|biens|acheter|vente|immobilier|maisons|appartements)$/.test(path)) return true;
    if (/\/recherche\//.test(path) || /\/search\//.test(path)) return true;
    if (parts.length <= 1 && /immobilier|maison|appartement|vente|acheter/.test(title)) return true;
  } catch {
    return true;
  }

  return false;
}

function looksLikeIndividualUrl(url: string, title: string) {
  if (!isFrenchPortal(url)) return false;
  if (isLikelyCollection({ url, title })) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return false;
    if (/\b(annonce|bien|maison|appartement|vente|achat|immobilier|property|detail|ref|mandat)\b/.test(path)) return true;
    if (/\d{5,}/.test(path)) return true;
    return parts.length >= 3;
  } catch {
    return false;
  }
}

function propertyKind(text: string): PropertyKind {
  const q = norm(text);
  if (/\b(appartement|studio|duplex|loft)\b/.test(q)) return "apartment";
  if (/\bvilla\b/.test(q)) return "villa";
  if (/programme neuf|construction neuve|neuf a construire/.test(q)) return "new_build_project";
  if (/\b(maison|pavillon|longere|propriete|demeure|corps de ferme)\b/.test(q)) return "existing_house";
  return "unknown";
}

function typeCompatible(kind: PropertyKind, criteria: Criteria) {
  if (criteria.propertyType === "house" && kind === "apartment") return false;
  if (criteria.propertyType === "apartment" && ["existing_house", "villa"].includes(kind)) return false;
  return true;
}

function parseSurface(text: string, preferred?: number) {
  const candidates: Array<{ value: number; score: number }> = [];
  for (const match of text.matchAll(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|sqm|metres? carres?)\b/gi)) {
    const value = Number(String(match[1]).replace(",", "."));
    if (!Number.isFinite(value) || value < 15 || value > 800) continue;
    const index = match.index ?? 0;
    const around = norm(text.slice(Math.max(0, index - 100), index + match[0].length + 120));
    if (/terrain|parcelle|jardin de|surface terrain|terrain de|foncier/.test(around)) continue;
    let score = /surface habitable|habitable|carrez|surface utile/.test(around) ? 16 : 5;
    if (preferred) score += Math.max(0, 10 - Math.abs(value - preferred) / Math.max(20, preferred * 0.22));
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
  const match = text.match(/(\d{1,2})\s*(?:sdb|salles? de bain|salles? d'eau)\b/i);
  const value = match ? Number(match[1]) : undefined;
  return value && value <= 10 ? value : undefined;
}

function safeImage(value: unknown, pageUrl?: string) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const absolute = new URL(value, pageUrl).toString();
    if (!/^https?:\/\//i.test(absolute)) return undefined;
    const q = norm(absolute);
    if (/logo|favicon|sprite|placeholder|no[-_]?image|default|avatar|agent|agence|profil|tracking|pixel|banner|advert|cookie|map|floorplan|plan[-_]|icone|icon|portrait|facebook|twitter|linkedin/.test(q)) return undefined;
    return absolute;
  } catch {
    return undefined;
  }
}

function parsePriceStrict(text: string, surface?: number) {
  const parsed = parsePriceFromText(text, "EUR");
  if (!parsed.value || parsed.currency !== "EUR" || parsed.confidence === "none") return undefined;
  return sanitizePropertyPrice(parsed.value, "EUR", surface, parsed.confidence === "confirmed" ? "confirmed" : "snippet");
}

function closePrice(a?: number, b?: number) {
  if (!a || !b) return false;
  return Math.abs(a - b) <= Math.max(1000, Math.min(a, b) * 0.012);
}

async function parseCriteria(query: string, filters: Filters): Promise<Criteria> {
  const q = norm(query);
  const location = await detectLocationWithAI(query, process.env.OPENAI_API_KEY);

  const minSurface = lastNumber(q, /(?:minimum|min\.?|au moins)\s*(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|sqm)/gi);
  const maxSurface = lastNumber(q, /(?:maximum|max\.?|jusqu(?:a|')a)\s*(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|sqm)/gi);
  const anySurface = lastNumber(q, /(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|sqm|metres? carres?)/gi);
  const minBedrooms = lastNumber(q, /(\d{1,2})\s*(?:chambres?|chambre)/gi);
  const minBathrooms = lastNumber(q, /(\d{1,2})\s*(?:sdb|salles? de bain|salles? d'eau)/gi);
  const minBudget = lastNumber(q, /(?:prix\s*)?(?:minimum|min\.?|au moins)\s*([\d\s.,]+)\s*(?:€|eur|euros?)?/gi);
  const maxBudget = lastNumber(q, /(?:moins de|sous|budget(?: max)?|prix\s*max(?:imum)?|maximum|max\.?)\s*([\d\s.,]+)\s*(?:€|eur|euros?)?/gi);
  const bareBudget = lastNumber(q, /([\d\s.,]{4,})\s*(?:€|eur|euros?)/gi);

  const propertyType =
    filters.propertyType ??
    (/\b(appartement|studio|duplex|loft)\b/.test(q)
      ? "apartment"
      : /\b(maison|villa|pavillon|longere|demeure)\b/.test(q)
        ? "house"
        : undefined);

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

async function searx(query: string, page = 1): Promise<SearxResult[]> {
  const base = (process.env.SEARXNG_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
  try {
    const url = new URL(`${base}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("language", "fr-FR");
    url.searchParams.set("categories", "general");
    url.searchParams.set("pageno", String(page));

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(SEARX_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { results?: SearxResult[] };
    return Array.isArray(payload.results) ? payload.results : [];
  } catch {
    return [];
  }
}

function queryPlan(criteria: Criteria, original: string) {
  const city = criteria.city ?? "France";
  const type = criteria.propertyType === "apartment" ? "appartement" : "maison";
  const budget = criteria.budgetMax ? `${Math.round(criteria.budgetMax)} €` : "";
  const surface = criteria.minSurface ? `${Math.round(criteria.minSurface)} m²` : "";
  const bedrooms = criteria.minBedrooms ? `${criteria.minBedrooms} chambres` : "";

  const core = [
    original,
    `${type} à vendre ${city}`,
    `${type} vente ${city} ${budget}`,
    `${type} ${city} ${surface} ${bedrooms}`,
    `annonce ${type} ${city} ${budget} ${surface}`,
    `immobilier ${city} ${type} ${bedrooms}`,
    `${type} ${city} agence immobilière ${budget}`,
  ].map((q) => q.replace(/\s+/g, " ").trim());

  const portal = PRIORITY_PORTALS.map((domain) => `site:${domain} "${city}" ${type} vente`);
  return {
    core: [...new Set(core)],
    portal: [...new Set(portal)],
  };
}

function dedupeSearchResults(results: SearxResult[]) {
  const map = new Map<string, SearxResult>();
  for (const result of results) {
    if (!result.url) continue;
    const key = normalizeUrl(result.url);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, result);
      continue;
    }
    const engines = [...new Set([...(existing.engines ?? []), ...(result.engines ?? []), existing.engine ?? "", result.engine ?? ""].filter(Boolean))];
    map.set(key, {
      ...existing,
      title: clean(existing.title).length >= clean(result.title).length ? existing.title : result.title,
      content: clean(existing.content).length >= clean(result.content).length ? existing.content : result.content,
      thumbnail: existing.thumbnail || result.thumbnail,
      img_src: existing.img_src || result.img_src,
      engines,
      score: Math.max(existing.score ?? 0, result.score ?? 0),
    });
  }
  return [...map.values()];
}

function toCandidate(result: SearxResult, criteria: Criteria): Candidate | null {
  if (!result.url || !looksLikeIndividualUrl(result.url, clean(result.title))) return null;
  if (!isFrenchPortal(result.url)) return null;

  const title = clean(result.title);
  const description = clean(result.content);
  const combined = `${title} ${description} ${result.url}`;
  if (FOREIGN_MARKERS.test(combined)) return null;

  const kind = propertyKind(combined);
  if (!typeCompatible(kind, criteria)) return null;

  const cityNorm = norm(criteria.city ?? "");
  const cityMatched = !cityNorm || norm(combined).includes(cityNorm);
  const surface = parseSurface(combined, criteria.minSurface);
  const price = parsePriceStrict(combined, surface);
  const engines = [...new Set([...(result.engines ?? []), result.engine ?? ""].filter(Boolean))];

  let score = portalPriority(result.url) + (result.score ?? 0) * 2;
  if (cityMatched) score += 22;
  if (kind !== "unknown") score += 8;
  if (price) score += 8;
  if (surface) score += 5;
  if (parseBedrooms(combined)) score += 4;
  if (/\b(ref|reference|mandat|exclusivite|\d{5,})\b/i.test(title + " " + result.url)) score += 4;

  return {
    url: result.url,
    normalizedUrl: normalizeUrl(result.url),
    title,
    description,
    source: host(result.url),
    engines,
    snippetPrice: price,
    snippetSurface: surface,
    snippetBedrooms: parseBedrooms(combined),
    snippetBathrooms: parseBathrooms(combined),
    snippetImage: safeImage(result.thumbnail || result.img_src, result.url),
    propertyKind: kind,
    cityMatched,
    discoveryScore: score,
  };
}

function dedupeCandidates(candidates: Candidate[]) {
  const map = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const existing = map.get(candidate.normalizedUrl);
    if (!existing || candidate.discoveryScore > existing.discoveryScore) {
      map.set(candidate.normalizedUrl, candidate);
    } else if (existing) {
      existing.engines = [...new Set([...existing.engines, ...candidate.engines])];
      if (!existing.snippetImage && candidate.snippetImage) existing.snippetImage = candidate.snippetImage;
      if (!existing.snippetPrice && candidate.snippetPrice) existing.snippetPrice = candidate.snippetPrice;
    }
  }
  return [...map.values()].sort((a, b) => b.discoveryScore - a.discoveryScore);
}

async function discoverCandidates(criteria: Criteria, original: string) {
  const plan = queryPlan(criteria, original);
  const firstWave = await Promise.all([
    ...plan.core.map((q) => searx(q, 1)),
    ...plan.portal.map((q) => searx(q, 1)),
  ]);

  let raw = dedupeSearchResults(firstWave.flat());
  let candidates = dedupeCandidates(raw.map((r) => toCandidate(r, criteria)).filter((x): x is Candidate => Boolean(x)));

  if (candidates.length < 90) {
    const secondWave = await Promise.all([
      ...plan.core.slice(0, 6).map((q) => searx(q, 2)),
      ...SECONDARY_PORTALS.slice(0, 8).map((domain) => searx(`site:${domain} "${criteria.city ?? "France"}" ${criteria.propertyType === "apartment" ? "appartement" : "maison"} vente`, 1)),
    ]);
    raw = dedupeSearchResults([...raw, ...secondWave.flat()]);
    candidates = dedupeCandidates(raw.map((r) => toCandidate(r, criteria)).filter((x): x is Candidate => Boolean(x)));
  }

  if (candidates.length < 55) {
    const thirdWave = await Promise.all(plan.core.slice(0, 5).map((q) => searx(q, 3)));
    raw = dedupeSearchResults([...raw, ...thirdWave.flat()]);
    candidates = dedupeCandidates(raw.map((r) => toCandidate(r, criteria)).filter((x): x is Candidate => Boolean(x)));
  }

  return { raw, candidates: candidates.slice(0, MAX_CANDIDATES), searchQuery: plan.core[0] ?? original };
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern)?.[1];
    if (match) return decodeHtml(match);
  }
  return undefined;
}

function canonicalUrl(html: string, pageUrl: string) {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i)?.[1]
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i)?.[1];
  if (!match) return undefined;
  try {
    return new URL(match, pageUrl).toString();
  } catch {
    return undefined;
  }
}

function walkJson(value: unknown, visit: (record: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  visit(record);
  for (const child of Object.values(record)) walkJson(child, visit);
}

function jsonLdEvidence(html: string, pageUrl: string, criteria: Criteria) {
  const prices: number[] = [];
  const surfaces: number[] = [];
  const bedrooms: number[] = [];
  const bathrooms: number[] = [];
  const images: string[] = [];
  let foundRelevant = false;

  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    const raw = script[1]?.trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    walkJson(parsed, (node) => {
      const rawType = node["@type"];
      const types = Array.isArray(rawType) ? rawType.map(String) : [String(rawType ?? "")];
      const typeText = norm(types.join(" "));
      const relevant = /house|residence|apartment|product|realestatelisting|singlefamily|offer|accommodation/.test(typeText);
      if (!relevant) return;

      const nodeUrl = typeof node.url === "string" ? node.url : undefined;
      if (nodeUrl && !sameUrl(nodeUrl, pageUrl)) {
        try {
          const A = new URL(nodeUrl, pageUrl);
          const B = new URL(pageUrl);
          if (A.hostname !== B.hostname || A.pathname !== B.pathname) return;
        } catch {
          return;
        }
      }

      foundRelevant = true;
      const offers = node.offers;
      const offerList = Array.isArray(offers) ? offers : offers && typeof offers === "object" ? [offers] : [];
      for (const item of offerList) {
        if (!item || typeof item !== "object") continue;
        const offer = item as Record<string, unknown>;
        const currency = clean(offer.priceCurrency || "EUR").toUpperCase();
        if (currency && currency !== "EUR") continue;
        const rawPrice = numberValue(offer.price) ?? numberValue((offer.priceSpecification as Record<string, unknown> | undefined)?.price);
        const safe = sanitizePropertyPrice(rawPrice, "EUR", undefined, "confirmed");
        if (safe) prices.push(safe);
      }

      const floorSize = node.floorSize;
      if (floorSize && typeof floorSize === "object") {
        const value = numberValue((floorSize as Record<string, unknown>).value);
        if (value && value >= 15 && value <= 800) surfaces.push(value);
      } else {
        const value = numberValue(floorSize);
        if (value && value >= 15 && value <= 800) surfaces.push(value);
      }

      const bed = numberValue(node.numberOfBedrooms ?? node.numberOfRooms);
      if (bed && bed <= 15) bedrooms.push(bed);
      const bath = numberValue(node.numberOfBathrooms);
      if (bath && bath <= 10) bathrooms.push(bath);

      const imageValues = Array.isArray(node.image) ? node.image : node.image ? [node.image] : [];
      for (const image of imageValues) {
        const value = typeof image === "string" ? image : image && typeof image === "object" ? String((image as Record<string, unknown>).url ?? (image as Record<string, unknown>).contentUrl ?? "") : "";
        const safe = safeImage(value, pageUrl);
        if (safe) images.push(safe);
      }
    });
  }

  const price = prices.length ? modeNumber(prices, 1000) : undefined;
  const surface = surfaces.length ? nearestNumber(surfaces, criteria.minSurface) : undefined;
  return {
    foundRelevant,
    price,
    surface,
    bedrooms: bedrooms[0],
    bathrooms: bathrooms[0],
    images: [...new Set(images)].slice(0, 12),
  };
}

function modeNumber(values: number[], bucket = 1) {
  if (!values.length) return undefined;
  const counts = new Map<number, number>();
  for (const value of values) {
    const key = Math.round(value / bucket) * bucket;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function nearestNumber(values: number[], preferred?: number) {
  if (!values.length) return undefined;
  if (!preferred) return values[0];
  return [...values].sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))[0];
}

function metaPrice(html: string, surface?: number) {
  const keys = [
    "product:price:amount",
    "og:price:amount",
    "price",
    "product:price",
    "property:price",
  ];
  for (const key of keys) {
    const raw = metaContent(html, key);
    const value = numberValue(raw);
    const safe = sanitizePropertyPrice(value, "EUR", surface, "confirmed");
    if (safe) return safe;
  }
  return undefined;
}

function metaImages(html: string, pageUrl: string) {
  const values = [
    metaContent(html, "og:image"),
    metaContent(html, "og:image:url"),
    metaContent(html, "twitter:image"),
    metaContent(html, "twitter:image:src"),
  ];
  return [...new Set(values.map((v) => safeImage(v, pageUrl)).filter((v): v is string => Boolean(v)))];
}

async function fetchPage(candidate: Candidate, criteria: Criteria): Promise<PageEvidence | null> {
  try {
    const response = await fetch(candidate.url, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) return null;
    const html = await response.text();
    if (html.length < 300) return null;

    const text = stripHtml(html).slice(0, 180_000);
    const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? candidate.title).replace(/\s+/g, " ").trim();
    const json = jsonLdEvidence(html, candidate.url, criteria);
    const textSurface = parseSurface(`${title} ${text.slice(0, 45_000)}`, criteria.minSurface);
    const surface = json.surface ?? textSurface ?? candidate.snippetSurface;
    const structuredPrice = json.price;
    const mPrice = metaPrice(html, surface);

    let pageTextPrice: number | undefined;
    if (!structuredPrice && !mPrice) {
      const firstChunk = `${title} ${text.slice(0, 40_000)}`;
      const parsed = parsePriceFromText(firstChunk, "EUR");
      if (parsed.confidence === "confirmed") {
        pageTextPrice = sanitizePropertyPrice(parsed.value, "EUR", surface, "confirmed");
      }
    }

    const images = [...new Set([...json.images, ...metaImages(html, candidate.url)])].slice(0, 12);
    const cityNorm = norm(criteria.city ?? "");
    const cityMatched = !cityNorm || norm(`${title} ${text.slice(0, 35_000)} ${candidate.url}`).includes(cityNorm);
    const kind = propertyKind(`${title} ${text.slice(0, 18_000)}`);

    return {
      title,
      canonicalUrl: canonicalUrl(html, candidate.url),
      price: structuredPrice ?? mPrice ?? pageTextPrice,
      priceSource: structuredPrice ? "jsonld" : mPrice ? "meta" : pageTextPrice ? "page" : undefined,
      surface,
      bedrooms: json.bedrooms ?? parseBedrooms(`${title} ${text.slice(0, 45_000)}`) ?? candidate.snippetBedrooms,
      bathrooms: json.bathrooms ?? parseBathrooms(`${title} ${text.slice(0, 45_000)}`) ?? candidate.snippetBathrooms,
      images,
      text,
      cityMatched,
      propertyKind: kind,
    };
  } catch {
    return null;
  }
}

function exactTitleTerms(title: string) {
  return clean(title)
    .replace(/[|–—-].*$/, "")
    .replace(/[^A-Za-zÀ-ÿ0-9'’ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length >= 3)
    .slice(0, 10)
    .join(" ");
}

async function exactSearxEvidence(candidate: Candidate, criteria: Criteria): Promise<ExactEvidence> {
  const domain = host(candidate.url);
  const terms = exactTitleTerms(candidate.title);
  const city = criteria.city ?? "";
  const queries = [
    `site:${domain} "${city}" "${terms}"`,
    `site:${domain} "${terms}"`,
  ];

  const batches = await Promise.all(queries.map((q) => searx(q, 1)));
  const matches = batches.flat().filter((result) => result.url && sameUrl(result.url, candidate.url));
  const priceVotes = new Map<number, { count: number; engines: Set<string> }>();
  let image: string | undefined;

  for (const result of matches) {
    const text = `${clean(result.title)} ${clean(result.content)}`;
    const surface = parseSurface(text, criteria.minSurface) ?? candidate.snippetSurface;
    const price = parsePriceStrict(text, surface);
    const engines = [...new Set([...(result.engines ?? []), result.engine ?? ""].filter(Boolean))];
    if (price) {
      const bucket = Math.round(price / 1000) * 1000;
      const existing = priceVotes.get(bucket) ?? { count: 0, engines: new Set<string>() };
      existing.count += 1;
      engines.forEach((engine) => existing.engines.add(engine));
      priceVotes.set(bucket, existing);
    }
    if (!image) image = safeImage(result.thumbnail || result.img_src, candidate.url);
  }

  const ranked = [...priceVotes.entries()].sort((a, b) => {
    const scoreA = a[1].count + a[1].engines.size * 2;
    const scoreB = b[1].count + b[1].engines.size * 2;
    return scoreB - scoreA;
  });

  const best = ranked[0];
  return {
    price: best?.[0],
    priceVotes: best?.[1].count ?? 0,
    engines: best ? [...best[1].engines] : [],
    image,
    exactUrlMatches: matches.length,
  };
}

function featureFlags(text: string) {
  const q = norm(text);
  return {
    garden: /\bjardin\b|terrain arbore|espace vert/.test(q),
    garage: /\bgarage\b|box ferme/.test(q),
    pool: /\bpiscine\b/.test(q),
    terrace: /\bterrasse\b/.test(q),
    parking: /\bparking\b|stationnement|place de parking/.test(q),
  };
}

function confirmPrice(candidate: Candidate, page: PageEvidence | null, exact: ExactEvidence | null) {
  const pagePrice = page?.price;
  if (pagePrice && page?.priceSource === "jsonld") return pagePrice;
  if (pagePrice && page?.priceSource === "meta") return pagePrice;
  if (pagePrice && candidate.snippetPrice && closePrice(pagePrice, candidate.snippetPrice)) return pagePrice;
  if (pagePrice && exact?.price && closePrice(pagePrice, exact.price)) return pagePrice;
  if (candidate.snippetPrice && exact?.price && closePrice(candidate.snippetPrice, exact.price) && (exact.engines.length >= 2 || exact.priceVotes >= 2)) {
    return Math.round((candidate.snippetPrice + exact.price) / 2 / 1000) * 1000;
  }
  if (exact?.price && exact.engines.length >= 2 && exact.exactUrlMatches >= 1) return exact.price;
  return undefined;
}

function passesHardFilters(listing: Listing, criteria: Criteria) {
  if (criteria.budgetMin !== undefined && listing.price < criteria.budgetMin) return false;
  if (criteria.budgetMax !== undefined && listing.price > criteria.budgetMax) return false;
  if (criteria.maxSurface !== undefined && listing.surface !== undefined && listing.surface > criteria.maxSurface) return false;
  if (criteria.minSurface !== undefined && listing.surface !== undefined && listing.surface < criteria.minSurface * 0.72) return false;
  if (criteria.minBedrooms !== undefined && listing.bedrooms !== undefined && listing.bedrooms < Math.max(1, criteria.minBedrooms - 1)) return false;
  if (criteria.minBathrooms !== undefined && listing.bathrooms !== undefined && listing.bathrooms < criteria.minBathrooms) return false;
  if (!typeCompatible(listing.propertyKind, criteria)) return false;
  return true;
}

function rankListing(listing: Listing, criteria: Criteria) {
  let match = 48;
  let value = 50;
  const reasons: string[] = [];
  const compromises: string[] = [];

  if (criteria.city && norm(`${listing.title} ${listing.description} ${listing.location}`).includes(norm(criteria.city))) {
    match += 18;
    reasons.push("Localisation confirmée");
  }

  if (criteria.budgetMax) {
    const ratio = listing.price / criteria.budgetMax;
    if (ratio <= 0.85) {
      match += 12;
      value += 12;
      reasons.push("Sous le budget avec marge");
    } else if (ratio <= 1) {
      match += 9;
      reasons.push("Budget respecté");
    }
  }

  if (criteria.minSurface) {
    if (listing.surface === undefined) compromises.push("Surface non lisible sur la fiche");
    else {
      const ratio = listing.surface / criteria.minSurface;
      if (ratio >= 1) {
        match += 10;
        reasons.push("Surface demandée respectée");
      } else if (ratio >= 0.9) {
        match += 4;
        compromises.push("Surface légèrement inférieure");
      } else {
        match -= 8;
        compromises.push("Surface inférieure au souhait");
      }
    }
  }

  if (criteria.minBedrooms) {
    if (listing.bedrooms === undefined) compromises.push("Nombre de chambres non lisible");
    else if (listing.bedrooms >= criteria.minBedrooms) {
      match += 8;
      reasons.push("Nombre de chambres respecté");
    } else {
      match -= 5;
      compromises.push("Une chambre de moins que souhaité");
    }
  }

  const requestedFeatures: Array<[keyof Pick<Listing, "garden" | "garage" | "pool" | "terrace" | "parking">, boolean | undefined, string]> = [
    ["garden", criteria.garden, "Jardin"],
    ["garage", criteria.garage, "Garage"],
    ["pool", criteria.pool, "Piscine"],
    ["terrace", criteria.terrace, "Terrasse"],
    ["parking", criteria.parking, "Parking"],
  ];
  for (const [key, requested, label] of requestedFeatures) {
    if (!requested) continue;
    if (listing[key]) {
      match += 5;
      reasons.push(`${label} détecté`);
    } else {
      match -= 3;
      compromises.push(`${label} non confirmé`);
    }
  }

  if (listing.images.length) match += 6;
  if (PRIORITY_SET.has(listing.source)) match += 4;
  if (listing.surface && listing.price) {
    const ppm2 = listing.price / listing.surface;
    listing.pricePerM2 = Math.round(ppm2);
    if (ppm2 < 4500) value += 6;
  }

  match = Math.max(0, Math.min(100, Math.round(match)));
  value = Math.max(0, Math.min(100, Math.round(value)));
  const orbit = Math.max(0, Math.min(100, Math.round(match * 0.78 + value * 0.22)));
  return { match, value, orbit, reasons, compromises };
}

async function enrichCandidate(candidate: Candidate, criteria: Criteria, stats: RejectionStats): Promise<Listing | null> {
  const page = await fetchPage(candidate, criteria);
  if (!page) stats.fetchFailed += 1;

  const cityNorm = norm(criteria.city ?? "");
  const cityConfirmed = !cityNorm || candidate.cityMatched || Boolean(page?.cityMatched);
  if (!cityConfirmed) {
    stats.wrongCity += 1;
    return null;
  }

  const kind = page?.propertyKind && page.propertyKind !== "unknown" ? page.propertyKind : candidate.propertyKind;
  if (!typeCompatible(kind, criteria)) {
    stats.wrongType += 1;
    return null;
  }

  let exact: ExactEvidence | null = null;
  const needsExact = !page?.price || page.priceSource === "page" || page.images.length === 0;
  if (needsExact) exact = await exactSearxEvidence(candidate, criteria);

  const price = confirmPrice(candidate, page, exact);
  if (!price) {
    stats.noPrice += 1;
    return null;
  }

  const surface = page?.surface ?? candidate.snippetSurface;
  const safePrice = sanitizePropertyPrice(price, "EUR", surface, "confirmed");
  if (!safePrice) {
    stats.invalidPrice += 1;
    return null;
  }

  if (criteria.budgetMin !== undefined && safePrice < criteria.budgetMin) {
    stats.budget += 1;
    return null;
  }
  if (criteria.budgetMax !== undefined && safePrice > criteria.budgetMax) {
    stats.budget += 1;
    return null;
  }

  const pageText = page?.text ?? "";
  const combined = `${candidate.title} ${candidate.description} ${page?.title ?? ""} ${pageText.slice(0, 35_000)}`;
  const flags = featureFlags(combined);
  const images = [...new Set([...(page?.images ?? []), ...(exact?.image ? [exact.image] : [])].map((img) => safeImage(img, candidate.url)).filter((img): img is string => Boolean(img)))].slice(0, 8);

  const listing: Listing = {
    id: "",
    url: page?.canonicalUrl && sameUrl(page.canonicalUrl, candidate.url) ? page.canonicalUrl : candidate.url,
    source: candidate.source,
    parentSource: candidate.source,
    title: clean(page?.title || candidate.title) || "Annonce immobilière",
    description: candidate.description,
    price: safePrice,
    currency: "EUR",
    surface,
    bedrooms: page?.bedrooms ?? candidate.snippetBedrooms,
    bathrooms: page?.bathrooms ?? candidate.snippetBathrooms,
    location: criteria.city ? `${criteria.city}, France` : "France",
    garden: flags.garden,
    garage: flags.garage,
    pool: flags.pool,
    terrace: flags.terrace,
    parking: flags.parking,
    images,
    propertyKind: kind,
    matchScore: 0,
    valueScore: 0,
    orbitScore: 0,
    reasons: [],
    compromises: [],
    extractedAt: new Date().toISOString(),
    priceConfidence: "confirmed",
    imageConfidence: images.length ? "confirmed" : "none",
  };

  if (!passesHardFilters(listing, criteria)) return null;
  const score = rankListing(listing, criteria);
  listing.matchScore = score.match;
  listing.valueScore = score.value;
  listing.orbitScore = score.orbit;
  listing.reasons = score.reasons;
  listing.compromises = score.compromises;
  return listing;
}

function listingIdentity(listing: Listing) {
  const title = norm(listing.title)
    .replace(/\b(vente|achat|maison|appartement|a vendre|à vendre|immobilier|france)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const surface = listing.surface ? Math.round(listing.surface / 5) * 5 : 0;
  const price = Math.round(listing.price / 5000) * 5000;
  return `${listing.source}|${title.slice(0, 80)}|${surface}|${price}`;
}

function dedupeListings(listings: Listing[], stats: RejectionStats) {
  const urls = new Set<string>();
  const identities = new Set<string>();
  const output: Listing[] = [];
  for (const listing of listings) {
    const url = normalizeUrl(listing.url);
    const identity = listingIdentity(listing);
    if (urls.has(url) || identities.has(identity)) {
      stats.duplicate += 1;
      continue;
    }
    urls.add(url);
    identities.add(identity);
    output.push(listing);
  }
  return output;
}

function sortListings(listings: Listing[], priority: SortPriority) {
  return [...listings].sort((a, b) => {
    if (priority === "lowest_price") return a.price - b.price || b.orbitScore - a.orbitScore;
    if (priority === "largest") return (b.surface ?? 0) - (a.surface ?? 0) || b.orbitScore - a.orbitScore;
    const completeA = (a.images.length ? 6 : 0) + (a.surface ? 3 : 0) + (a.bedrooms ? 2 : 0);
    const completeB = (b.images.length ? 6 : 0) + (b.surface ? 3 : 0) + (b.bedrooms ? 2 : 0);
    return b.orbitScore - a.orbitScore || completeB - completeA || a.price - b.price;
  });
}

function sourcePayload(raw: SearxResult[]) {
  return dedupeSearchResults(raw)
    .filter((item) => item.url && isFrenchPortal(item.url))
    .slice(0, 140)
    .map((item, index) => ({
      id: `source-${index}`,
      title: clean(item.title) || host(item.url ?? ""),
      description: clean(item.content),
      url: item.url ?? "",
      position: index + 1,
      source: host(item.url ?? ""),
      sourceScore: item.score ?? 0,
    }));
}

export async function franceSearchProxyV8(request: NextRequest) {
  const stats: RejectionStats = {
    collection: 0,
    foreign: 0,
    wrongType: 0,
    wrongCity: 0,
    noPrice: 0,
    budget: 0,
    invalidPrice: 0,
    duplicate: 0,
    fetchFailed: 0,
  };

  try {
    const body = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return NextResponse.json({ success: false, error: "La recherche est vide." }, { status: 400 });
    if (FOREIGN_MARKERS.test(query)) {
      return NextResponse.json({ success: false, error: "ORBIT recherche uniquement des biens situés en France." }, { status: 400 });
    }

    const filters = body.filters && typeof body.filters === "object" ? (body.filters as Filters) : {};
    const criteria = await parseCriteria(query, filters);
    const discovered = await discoverCandidates(criteria, query);

    const verified: Listing[] = [];
    let analyzed = 0;
    const candidates = discovered.candidates.slice(0, MAX_ENRICH);

    for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
      const batch = candidates.slice(start, start + BATCH_SIZE);
      const settled = await Promise.allSettled(batch.map((candidate) => enrichCandidate(candidate, criteria, stats)));
      analyzed += batch.length;
      for (const result of settled) {
        if (result.status === "fulfilled" && result.value) verified.push(result.value);
      }

      const uniqueNow = dedupeListings(verified, { ...stats, duplicate: 0 });
      const withImages = uniqueNow.filter((item) => item.images.length).length;
      if (uniqueNow.length >= TARGET + 8 && withImages >= Math.min(TARGET, 28)) break;
    }

    const unique = dedupeListings(verified, stats);
    const sorted = sortListings(unique, criteria.sortPriority).slice(0, TARGET).map((listing, index) => ({
      ...listing,
      id: `listing-${index + 1}`,
    }));

    const sources = sourcePayload(discovered.raw);

    return NextResponse.json({
      success: true,
      query,
      searchQuery: discovered.searchQuery,
      criteria,
      sourceCount: sources.length,
      candidateCount: discovered.candidates.length,
      analyzedCandidateCount: analyzed,
      listingCount: sorted.length,
      verifiedListingCount: sorted.length,
      targetListingCount: TARGET,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)),
      confirmedPriceCount: sorted.length,
      photoCount: sorted.filter((item) => item.images.length).length,
      confirmedPhotoCount: sorted.filter((item) => item.images.length).length,
      creditsUsed: null,
      listings: sorted,
      sources,
      searchEngineVersion: "FR-8.0",
      searchProvider: "SearXNG-France + fiche source + recoupement exact",
      scope: "France-only",
      qualityPolicy: "Aucun résultat final sans prix recoupé/confirmé. Une photo absente vaut mieux qu'une mauvaise photo.",
      diagnostics: stats,
    });
  } catch (error) {
    console.error("ORBIT France v8 search error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "ORBIT France n'a pas pu effectuer la recherche.",
        listings: [],
        sources: [],
        listingCount: 0,
      },
      { status: 503 },
    );
  }
}
