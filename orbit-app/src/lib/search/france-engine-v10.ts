import { NextRequest, NextResponse } from "next/server";
import { franceSearchProxyV9 } from "@/lib/search/france-engine-v9";
import { parseLocalizedInteger, parsePriceFromText, sanitizePropertyPrice } from "@/lib/search/price";

type Criteria = {
  city?: string;
  propertyType?: string;
  budgetMax?: number;
  budgetMin?: number;
  minSurface?: number;
  maxSurface?: number;
  minBedrooms?: number;
  minBathrooms?: number;
  sortPriority?: "best_match" | "lowest_price" | "largest";
};

type Listing = {
  id: string;
  url: string;
  source: string;
  parentSource: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  surface?: number;
  bedrooms?: number;
  bathrooms?: number;
  location?: string;
  garden?: boolean;
  garage?: boolean;
  pool?: boolean;
  terrace?: boolean;
  parking?: boolean;
  images: string[];
  propertyKind: string;
  matchScore: number;
  valueScore: number;
  orbitScore: number;
  reasons: string[];
  compromises: string[];
  extractedAt: string;
  priceConfidence?: string;
  imageConfidence?: string;
  pricePerM2?: number;
};

type Source = {
  id?: string;
  url?: string;
  title?: string;
  description?: string;
  source?: string;
  position?: number;
  sourceScore?: number;
};

type Payload = {
  success?: boolean;
  error?: string;
  query?: string;
  criteria?: Criteria;
  listings?: Listing[];
  sources?: Source[];
  sourceCount?: number;
  candidateCount?: number;
  [key: string]: unknown;
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

type Evidence = {
  title: string;
  price?: number;
  surface?: number;
  bedrooms?: number;
  bathrooms?: number;
  image?: string;
  text: string;
};

const TARGET = 45;
const PAGE_TIMEOUT = 4800;
const SEARX_TIMEOUT = 7500;
const PORTALS = [
  "safti.fr", "iadfrance.fr", "orpi.com", "efficity.com", "proprietes-privees.com",
  "ouestfrance-immo.com", "century21.fr", "laforet.com", "nestenn.com", "human-immobilier.fr",
  "optimhome.com", "capifrance.fr", "guy-hoquet.com", "squarehabitat.fr", "fnaim.fr",
  "logic-immo.com", "bienici.com", "seloger.com", "leboncoin.fr", "3gimmobilier.com",
  "megagence.com", "paruvendu.fr", "avendrealouer.fr"
];

function clean(v: unknown) { return String(v ?? "").replace(/\s+/g, " ").trim(); }
function norm(v: unknown) { return clean(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function host(url: string) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
function normalizeUrl(url: string) {
  try {
    const u = new URL(url); u.hash = "";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid","xtor"].forEach(k => u.searchParams.delete(k));
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch { return url.replace(/\/$/, ""); }
}
function isPortal(url: string) { const h = host(url); return PORTALS.some(p => h === p || h.endsWith(`.${p}`)); }
function decodeHtml(v: string) { return v.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;|&#34;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">"); }
function stripHtml(v: string) { return decodeHtml(v.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim(); }

function parseSurface(text: string, preferred?: number) {
  const values: number[] = [];
  for (const m of text.matchAll(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|metres? carres?)\b/gi)) {
    const value = Number(String(m[1]).replace(",", "."));
    if (!Number.isFinite(value) || value < 18 || value > 500) continue;
    const i = m.index ?? 0;
    const around = norm(text.slice(Math.max(0, i - 80), i + 120));
    if (/terrain|parcelle|jardin de|surface terrain/.test(around)) continue;
    values.push(value);
  }
  if (!values.length) return undefined;
  if (!preferred) return values[0];
  return [...values].sort((a,b) => Math.abs(a-preferred)-Math.abs(b-preferred))[0];
}
function parseBedrooms(text: string) { const m = text.match(/(\d{1,2})\s*(?:chambres?|chambre)\b/i); const n = m ? Number(m[1]) : undefined; return n && n <= 12 ? n : undefined; }
function parseBathrooms(text: string) { const m = text.match(/(\d{1,2})\s*(?:sdb|salles? de bain|salles? d'eau)\b/i); const n = m ? Number(m[1]) : undefined; return n && n <= 8 ? n : undefined; }
function parsePrice(text: string, surface?: number) {
  const p = parsePriceFromText(text, "EUR");
  if (!p.value || p.currency !== "EUR" || p.confidence === "none") return undefined;
  return sanitizePropertyPrice(p.value, "EUR", surface, p.confidence === "confirmed" ? "confirmed" : "snippet");
}
function safeImage(value: unknown, pageUrl: string) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const u = new URL(value, pageUrl).toString();
    if (!/^https?:\/\//i.test(u)) return undefined;
    if (/logo|favicon|sprite|placeholder|no[-_]?image|default|avatar|agent|agence|profil|tracking|pixel|banner|advert|cookie|map|floorplan|plan[-_]|icone|icon|portrait|facebook|twitter|linkedin/i.test(u)) return undefined;
    return u;
  } catch { return undefined; }
}
function meta(html: string, key: string) {
  const e = key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  return html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${e}["'][^>]+content=["']([^"']+)["'][^>]*>`,"i"))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${e}["'][^>]*>`,"i"))?.[1];
}

async function searx(q: string, page = 1): Promise<SearxResult[]> {
  const base = (process.env.SEARXNG_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
  try {
    const u = new URL(`${base}/search`);
    u.searchParams.set("q", q); u.searchParams.set("format", "json"); u.searchParams.set("language", "fr-FR"); u.searchParams.set("categories", "general"); u.searchParams.set("pageno", String(page));
    const r = await fetch(u, { cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(SEARX_TIMEOUT) });
    if (!r.ok) return [];
    const j = await r.json() as { results?: SearxResult[] };
    return Array.isArray(j.results) ? j.results : [];
  } catch { return []; }
}

function collectionLike(url: string, title: string) {
  const t = norm(title); const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ""; } })();
  if (/^\d+\s+(maisons?|appartements?|annonces?|biens?)\b/.test(t)) return true;
  if (/\b(resultats?|toutes les annonces|nos biens|liste des biens)\b/.test(t)) return true;
  if (/\/(recherche|search|annonces|biens|maisons|appartements)\/?$/.test(path)) return true;
  return false;
}

function compatible(text: string, criteria?: Criteria) {
  const q = norm(text);
  if (criteria?.propertyType === "house" && /\b(appartement|studio|duplex|loft)\b/.test(q)) return false;
  if (criteria?.propertyType === "apartment" && /\b(maison|villa|pavillon|longere)\b/.test(q)) return false;
  if (criteria?.city && !q.includes(norm(criteria.city))) return false;
  return true;
}

function fitBand(surface: number | undefined, bedrooms: number | undefined, criteria?: Criteria) {
  if (criteria?.minSurface && surface !== undefined) {
    const floor = criteria.minSurface * 0.82; // 140m² => refuse < 115m²
    if (surface < floor) return false;
  }
  if (criteria?.maxSurface && surface !== undefined && surface > criteria.maxSurface * 1.08) return false;
  if (criteria?.minBedrooms && bedrooms !== undefined && bedrooms < Math.max(1, criteria.minBedrooms - 1)) return false;
  return true;
}

async function pageEvidence(url: string, titleHint: string, criteria?: Criteria): Promise<Evidence | null> {
  try {
    const r = await fetch(url, {
      redirect: "follow", cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36", "Accept-Language": "fr-FR,fr;q=0.9", Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(PAGE_TIMEOUT)
    });
    if (!r.ok) return null;
    const html = await r.text(); if (html.length < 300) return null;
    const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? titleHint).replace(/\s+/g," ").trim();
    const text = stripHtml(html).slice(0, 70000);
    const combined = `${title} ${text}`;
    const surface = parseSurface(combined, criteria?.minSurface);
    const bedrooms = parseBedrooms(combined);
    const bathrooms = parseBathrooms(combined);

    let price: number | undefined;
    for (const key of ["product:price:amount","og:price:amount","property:price","price"]) {
      const raw = meta(html, key); if (!raw) continue;
      const n = parseLocalizedInteger(raw); const safe = sanitizePropertyPrice(n, "EUR", surface, "confirmed"); if (safe) { price = safe; break; }
    }
    if (!price) price = parsePrice(`${title} ${text.slice(0, 25000)}`, surface);

    const image = safeImage(meta(html,"og:image") ?? meta(html,"twitter:image") ?? "", url);
    return { title, price, surface, bedrooms, bathrooms, image, text };
  } catch { return null; }
}

function score(listing: Listing, criteria?: Criteria) {
  let s = 55;
  if (criteria?.city && norm(`${listing.title} ${listing.location}`).includes(norm(criteria.city))) s += 18;
  if (criteria?.minSurface && listing.surface) {
    const ratio = listing.surface / criteria.minSurface;
    if (ratio >= 1) s += 14;
    else if (ratio >= 0.9) s += 9;
    else if (ratio >= 0.82) s += 4;
  }
  if (criteria?.minBedrooms && listing.bedrooms) {
    if (listing.bedrooms >= criteria.minBedrooms) s += 8;
    else if (listing.bedrooms === criteria.minBedrooms - 1) s += 3;
  }
  if (criteria?.budgetMax) {
    const ratio = listing.price / criteria.budgetMax;
    if (ratio <= 0.85) s += 7; else if (ratio <= 1) s += 4;
  }
  if (listing.images.length) s += 4;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function candidateToListing(result: SearxResult, evidence: Evidence | null, criteria?: Criteria): Listing | null {
  if (!result.url || !isPortal(result.url) || collectionLike(result.url, clean(result.title))) return null;
  const title = evidence?.title || clean(result.title) || "Annonce immobilière";
  const desc = clean(result.content);
  const combined = `${title} ${desc} ${evidence?.text ?? ""}`;
  if (!compatible(combined, criteria)) return null;

  const surface = evidence?.surface ?? parseSurface(`${title} ${desc}`, criteria?.minSurface);
  const bedrooms = evidence?.bedrooms ?? parseBedrooms(`${title} ${desc}`);
  if (!fitBand(surface, bedrooms, criteria)) return null;

  const snippetPrice = parsePrice(`${title} ${desc}`, surface);
  const price = evidence?.price ?? snippetPrice;
  if (!price) return null;
  if (criteria?.budgetMin !== undefined && price < criteria.budgetMin) return null;
  if (criteria?.budgetMax !== undefined && price > criteria.budgetMax) return null;

  // A price is only accepted when it comes from the source page or is explicitly present on the exact SearX result URL.
  if (!evidence?.price && !snippetPrice) return null;

  const image = evidence?.image ?? safeImage(result.thumbnail || result.img_src || "", result.url);
  const flags = norm(combined);
  const listing: Listing = {
    id: "", url: normalizeUrl(result.url), source: host(result.url), parentSource: host(result.url),
    title, description: desc, price, currency: "EUR", surface, bedrooms,
    bathrooms: evidence?.bathrooms ?? parseBathrooms(`${title} ${desc}`), location: criteria?.city ? `${criteria.city}, France` : "France",
    garden: /\bjardin\b/.test(flags), garage: /\bgarage\b/.test(flags), pool: /\bpiscine\b/.test(flags), terrace: /\bterrasse\b/.test(flags), parking: /\bparking|stationnement\b/.test(flags),
    images: image ? [image] : [], propertyKind: criteria?.propertyType === "apartment" ? "apartment" : "existing_house",
    matchScore: 0, valueScore: 50, orbitScore: 0, reasons: [], compromises: [], extractedAt: new Date().toISOString(),
    priceConfidence: "confirmed", imageConfidence: image ? "confirmed" : "none", pricePerM2: surface ? Math.round(price/surface) : undefined
  };
  listing.orbitScore = score(listing, criteria); listing.matchScore = listing.orbitScore;
  if (surface && criteria?.minSurface && surface < criteria.minSurface) listing.compromises.push(`Surface légèrement sous l'objectif (${surface} m²)`);
  if (bedrooms && criteria?.minBedrooms && bedrooms < criteria.minBedrooms) listing.compromises.push(`${bedrooms} chambres au lieu de ${criteria.minBedrooms}`);
  return listing;
}

async function rescue(criteria: Criteria | undefined, original: string, existing: Listing[], sourceHints: Source[]) {
  const city = criteria?.city ?? "France";
  const type = criteria?.propertyType === "apartment" ? "appartement" : "maison";
  const minSurf = criteria?.minSurface;
  const relaxedSurf = minSurf ? Math.max(40, Math.round(minSurf * 0.82)) : undefined;
  const maxSurf = minSurf ? Math.round(minSurf * 1.35) : undefined;
  const beds = criteria?.minBedrooms;
  const budget = criteria?.budgetMax;

  const queries = [
    original,
    `${type} à vendre ${city}`,
    `${type} ${city} ${budget ? `moins de ${Math.round(budget)} €` : ""}`,
    `${type} ${city} ${relaxedSurf ? `${relaxedSurf} m²` : ""} ${maxSurf ? `${maxSurf} m²` : ""}`,
    `${type} ${city} ${beds ? `${Math.max(1,beds-1)} chambres` : ""}`,
    `${type} ${city} ${beds ? `${beds} chambres` : ""} ${budget ? `${Math.round(budget)} €` : ""}`,
    ...PORTALS.slice(0,16).map(p => `site:${p} "${city}" ${type} vente`)
  ].map(q => q.replace(/\s+/g," ").trim());

  const batches = await Promise.all([...new Set(queries)].flatMap(q => [searx(q,1), searx(q,2)]));
  const raw: SearxResult[] = [
    ...sourceHints.map(s => ({ url:s.url, title:s.title, content:s.description, score:s.sourceScore })),
    ...batches.flat()
  ];

  const seen = new Set(existing.map(x => normalizeUrl(x.url)));
  const byUrl = new Map<string,SearxResult>();
  for (const r of raw) {
    if (!r.url || !isPortal(r.url)) continue;
    const k = normalizeUrl(r.url); if (seen.has(k)) continue;
    if (!byUrl.has(k)) byUrl.set(k,r);
  }

  const pool = [...byUrl.values()].slice(0,180);
  const output: Listing[] = [];
  for (let i=0; i<pool.length && existing.length + output.length < TARGET; i+=10) {
    const batch = pool.slice(i,i+10);
    const checked = await Promise.allSettled(batch.map(async r => ({ r, e: await pageEvidence(r.url!, clean(r.title), criteria) })));
    for (const item of checked) {
      if (item.status !== "fulfilled") continue;
      const listing = candidateToListing(item.value.r, item.value.e, criteria);
      if (!listing) continue;
      const key = normalizeUrl(listing.url); if (seen.has(key)) continue;
      seen.add(key); output.push(listing);
      if (existing.length + output.length >= TARGET) break;
    }
  }
  return output;
}

function sortListings(listings: Listing[], priority?: Criteria["sortPriority"]) {
  return [...listings].sort((a,b) => {
    if (priority === "lowest_price") return a.price-b.price || b.orbitScore-a.orbitScore;
    if (priority === "largest") return (b.surface??0)-(a.surface??0) || b.orbitScore-a.orbitScore;
    return b.orbitScore-a.orbitScore || (b.surface??0)-(a.surface??0) || a.price-b.price;
  });
}

export async function franceSearchProxyV10(request: NextRequest) {
  try {
    const base = await franceSearchProxyV9(request.clone());
    const payload = await base.json() as Payload;
    if (!base.ok || !payload.success) return NextResponse.json(payload,{status:base.status});

    const initial = Array.isArray(payload.listings) ? payload.listings : [];
    const filteredInitial = initial.filter(l => fitBand(l.surface ?? parseSurface(`${l.title} ${l.description}`, payload.criteria?.minSurface), l.bedrooms ?? parseBedrooms(`${l.title} ${l.description}`), payload.criteria));
    const extra = filteredInitial.length < TARGET ? await rescue(payload.criteria, clean(payload.query), filteredInitial, Array.isArray(payload.sources) ? payload.sources : []) : [];
    const merged = sortListings([...filteredInitial, ...extra], payload.criteria?.sortPriority).slice(0,TARGET).map((l,i)=>({...l,id:`listing-${i+1}`}));

    return NextResponse.json({
      ...payload,
      listings: merged,
      listingCount: merged.length,
      candidateCount: Math.max(Number(payload.candidateCount ?? 0), (Array.isArray(payload.sources)?payload.sources.length:0) + extra.length),
      searchEngine: "ORBIT France FR-10 balanced",
      resultPolicy: {
        surfaceFloorRatio: 0.82,
        bedroomsTolerance: 1,
        budgetHardLimit: true,
        priceRequired: true,
        target: 45,
        pageSize: 15
      }
    });
  } catch (error) {
    return NextResponse.json({success:false,error:error instanceof Error?error.message:"Erreur ORBIT France FR-10"},{status:500});
  }
}
