import { NextRequest, NextResponse } from "next/server";

import { orbitRelaxedFallback } from "@/lib/search/ranking";

/* =========================================================
   ORBIT SEARCH ENGINE V4
   Intent Engine + Search Planner + Comparison Engine
========================================================= */

type FirecrawlSearchResult = {
  url?: string;
  title?: string;
  description?: string;
  position?: number;
  image?: string;
};

type FirecrawlSearchResponse = {
  success?: boolean;
  data?: {
    web?: FirecrawlSearchResult[];
  };
  error?: string;
  creditsUsed?: number;
};

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

type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    rawHtml?: string;
    links?: string[];
    images?: string[];
    metadata?: {
      title?: string;
      description?: string;
      sourceURL?: string;
      url?: string;
      ogImage?: string;
      og_image?: string;
      "og:image"?: string;
      twitterImage?: string;
      twitter_image?: string;
      "twitter:image"?: string;
      image?: string;
      [key: string]: unknown;
    };
  };
  error?: string;
};

type SearchIntent = {
  category: "real_estate";
  intent: "buy" | "rent";
  propertyType?: string;
  city?: string;
  region?: string;
  country?: string;
  location?: string;
  language?: string;
  currency?: string;
  budgetMin?: number;
  budgetMax?: number;
  minSurface?: number;
  maxSurface?: number;
  minBedrooms?: number;
  minBathrooms?: number;
  radiusKm?: number;
  requirements: string[];
  preferences: string[];
  sortPriority:
    | "best_match"
    | "lowest_price"
    | "best_value"
    | "largest"
    | "newest";
};

type RankedSource = {
  id: string;
  title: string;
  description: string;
  url: string;
  position: number;
  source: string;
  sourceScore: number;
  image?: string;
};

type ListingCandidate = {
  url: string;
  source: string;
  parentSource: string;
  discoveryScore: number;
};

type PropertyKind =
  | "existing_house"
  | "new_build_project"
  | "apartment"
  | "villa"
  | "unknown";

type StructuredListing = {
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

  propertyKind: PropertyKind;

  matchScore: number;
  valueScore: number;
  orbitScore: number;

  reasons: string[];
  compromises: string[];

  extractedAt: string;
};


type SearchSnippetListing = {
  url: string;
  title: string;
  description: string;
  source: string;
  parentSource: string;
  sourceScore: number;
  image?: string;
};

type CountryProfile = {
  canonical: string;
  aliases: string[];
  language: string;
  currency: string;
  searchTerms: string[];
  domains: Record<string, number>;
};

/* =========================================================
   COUNTRY / SOURCE KNOWLEDGE
========================================================= */

const COUNTRY_PROFILES: CountryProfile[] = [
  {
    canonical: "France",
    aliases: ["france"],
    language: "fr",
    currency: "EUR",
    searchTerms: ["maison à vendre", "immobilier", "achat maison", "appartement"],
    domains: {
      "seloger.com": 100,
      "ouestfrance-immo.com": 97,
      "bienici.com": 97,
      "logic-immo.com": 95,
      "fnaim.fr": 93,
      "immobilier.lefigaro.fr": 91,
      "leboncoin.fr": 88,
      "orpi.com": 86,
      "century21.fr": 85,
      "laforet.com": 84,
      "iadfrance.fr": 84,
      "safti.fr": 82,
    },
  },
  {
    canonical: "United States",
    aliases: [
      "usa",
      "united states",
      "united states of america",
      "états-unis",
      "etats-unis",
      "états unis",
      "etats unis",
      "america",
      "amérique",
      "amerique",
    ],
    language: "en",
    currency: "USD",
    searchTerms: ["homes for sale", "real estate", "house for sale"],
    domains: {
      "zillow.com": 100,
      "redfin.com": 99,
      "realtor.com": 98,
      "homes.com": 94,
      "compass.com": 90,
      "coldwellbankerhomes.com": 88,
      "sothebysrealty.com": 86,
      "jamesedition.com": 80,
    },
  },
  {
    canonical: "Germany",
    aliases: ["germany", "allemagne", "deutschland"],
    language: "de",
    currency: "EUR",
    searchTerms: ["haus kaufen", "immobilien", "haus zum kauf"],
    domains: {
      "immobilienscout24.de": 100,
      "immowelt.de": 98,
      "immonet.de": 96,
      "kleinanzeigen.de": 85,
      "engelvoelkers.com": 82,
      "realting.com": 75,
    },
  },
  {
    canonical: "Spain",
    aliases: ["spain", "espagne", "españa", "espana"],
    language: "es",
    currency: "EUR",
    searchTerms: ["casa en venta", "inmobiliaria", "comprar casa"],
    domains: {
      "idealista.com": 100,
      "fotocasa.es": 98,
      "habitaclia.com": 95,
      "engelvoelkers.com": 82,
      "jamesedition.com": 78,
    },
  },
  {
    canonical: "Portugal",
    aliases: ["portugal"],
    language: "pt",
    currency: "EUR",
    searchTerms: ["casa à venda", "imobiliário", "comprar casa"],
    domains: {
      "idealista.pt": 100,
      "imovirtual.com": 98,
      "casa.sapo.pt": 95,
      "engelvoelkers.com": 82,
    },
  },
  {
    canonical: "Italy",
    aliases: ["italy", "italie", "italia"],
    language: "it",
    currency: "EUR",
    searchTerms: ["casa in vendita", "immobiliare", "comprare casa"],
    domains: {
      "immobiliare.it": 100,
      "idealista.it": 98,
      "casa.it": 96,
      "engelvoelkers.com": 82,
    },
  },
  {
    canonical: "United Kingdom",
    aliases: [
      "united kingdom",
      "uk",
      "royaume-uni",
      "royaume uni",
      "england",
      "angleterre",
      "scotland",
      "wales",
    ],
    language: "en",
    currency: "GBP",
    searchTerms: ["property for sale", "house for sale", "estate agents"],
    domains: {
      "rightmove.co.uk": 100,
      "zoopla.co.uk": 98,
      "onthemarket.com": 96,
      "primeLocation.com": 88,
    },
  },
  {
    canonical: "Belgium",
    aliases: ["belgium", "belgique", "belgië", "belgie"],
    language: "fr",
    currency: "EUR",
    searchTerms: ["maison à vendre", "immobilier", "huis te koop"],
    domains: {
      "immoweb.be": 100,
      "zimmo.be": 97,
      "logic-immo.be": 90,
    },
  },
  {
    canonical: "Netherlands",
    aliases: ["netherlands", "pays-bas", "pays bas", "nederland"],
    language: "nl",
    currency: "EUR",
    searchTerms: ["huis te koop", "woning kopen", "makelaar"],
    domains: {
      "funda.nl": 100,
      "pararius.nl": 94,
    },
  },
  {
    canonical: "Switzerland",
    aliases: ["switzerland", "suisse", "schweiz", "svizzera"],
    language: "de",
    currency: "CHF",
    searchTerms: ["haus kaufen", "immobilien kaufen", "maison à vendre"],
    domains: {
      "homegate.ch": 100,
      "immoscout24.ch": 98,
      "newhome.ch": 94,
    },
  },
  {
    canonical: "Austria",
    aliases: ["austria", "autriche", "österreich", "osterreich"],
    language: "de",
    currency: "EUR",
    searchTerms: ["haus kaufen", "immobilien", "eigentum"],
    domains: {
      "willhaben.at": 100,
      "immobilienscout24.at": 98,
    },
  },
  {
    canonical: "Canada",
    aliases: ["canada"],
    language: "en",
    currency: "CAD",
    searchTerms: ["homes for sale", "real estate", "property for sale"],
    domains: {
      "realtor.ca": 100,
      "centris.ca": 96,
      "royallepage.ca": 90,
    },
  },
];

const GLOBAL_PREFERRED_DOMAINS: Record<string, number> = {
  "properstar.com": 70,
  "properstar.fr": 70,
  "properstar.ie": 65,
  "jamesedition.com": 72,
  "sothebysrealty.com": 76,
  "engelvoelkers.com": 76,
  "realting.com": 70,
};

const BLOCKED_DOMAINS = [
  "booking.com",
  "airbnb.com",
  "vrbo.com",
  "abritel.fr",
  "tripadvisor.com",
  "expedia.com",
  "hotels.com",
  "agoda.com",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "pinterest.com",
];

const BAD_PATH_PARTS = [
  "/contact",
  "/blog",
  "/news",
  "/actualite",
  "/actualites",
  "/privacy",
  "/terms",
  "/login",
  "/register",
  "/signup",
  "/estimation",
  "/prix-de-l-immo",
  "/prix-immobilier",
  "/house-price",
  "/market-trends",
  "/professionnels-immobilier",
];

const PROPERTY_TYPE_WORDS: Record<string, string[]> = {
  villa: ["villa"],
  house: ["house", "maison", "haus", "casa", "huis"],
  apartment: [
    "apartment",
    "appartement",
    "flat",
    "wohnung",
    "apartamento",
    "appartamento",
  ],
  chalet: ["chalet"],
  penthouse: ["penthouse"],
  townhouse: ["townhouse", "maison de ville", "terraced house"],
  mansion: ["mansion", "manoir", "palace", "estate"],
};

/* =========================================================
   RESULT TARGETS
========================================================= */

const TARGET_LISTINGS = 10;

/*
 * We recover more than 10 candidates before the final cut.
 * This lets ORBIT discard wrong-city / wrong-type / over-budget
 * results and still have replacements available.
 */
const FINAL_RECOVERY_POOL = 20;
const MAX_SOURCE_PAGES_TO_EXPLORE = 6;
const MAX_DISCOVERED_CANDIDATES = 40;
const SCRAPE_BATCH_SIZE = 6;
const MAX_LISTINGS_TO_SCRAPE = 24;


/* =========================================================
   ROUTE
========================================================= */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const query =
      typeof body?.query === "string"
        ? body.query.trim()
        : "";

    if (!query) {
      return NextResponse.json(
        {
          success: false,
          error: "La recherche est vide.",
        },
        { status: 400 },
      );
    }

    const firecrawlKey =
      process.env.FIRECRAWL_API_KEY;

    if (!firecrawlKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "FIRECRAWL_API_KEY n'est pas configurée.",
        },
        { status: 500 },
      );
    }

    /* -----------------------------------------------------
       1. INTENT ENGINE
    ----------------------------------------------------- */

    const understoodCriteria =
      await understandSearchIntent(
        query,
        process.env.OPENAI_API_KEY,
      );

    /*
     * Deterministic location resolver.
     * AI may understand "Washington" as a generic US location;
     * ORBIT needs a canonical city/region before searching.
     */
    const criteria =
      resolveAmbiguousLocation(
        understoodCriteria,
        query,
      );

    /* -----------------------------------------------------
       2. SEARCH PLANNER
    ----------------------------------------------------- */

    const countryProfile =
      resolveCountryProfile(criteria);

    const searchQueries =
      buildSearchPlan(
        query,
        criteria,
        countryProfile,
      );

    /* -----------------------------------------------------
       3. WEB SEARCH
       Two queries run in parallel. Better recall without
       doubling the user's waiting time too much.
    ----------------------------------------------------- */

    const searchJobs =
      await Promise.allSettled(
        searchQueries.flatMap(
          (searchQuery) => [
            firecrawlSearch(
              firecrawlKey,
              searchQuery,
            ),
            searxngSearch(
              searchQuery,
            ),
          ],
        ),
      );

    const rawResults: FirecrawlSearchResult[] =
      [];

    let creditsUsed = 0;

    for (const job of searchJobs) {
      if (
        job.status !== "fulfilled" ||
        !job.value
      ) {
        continue;
      }

      if (Array.isArray(job.value)) {
        rawResults.push(
          ...job.value,
        );

        continue;
      }

      rawResults.push(
        ...(job.value.data?.web ?? []),
      );

      creditsUsed +=
        job.value.creditsUsed ?? 0;
    }

    if (rawResults.length === 0) {
      return NextResponse.json({
        success: true,
        query,
        searchQuery:
          searchQueries.join(" || "),
        criteria,
        sourceCount: 0,
        candidateCount: 0,
        listingCount: 0,
        creditsUsed,
        sources: [],
        listings: [],
      });
    }

    /* -----------------------------------------------------
       4. SOURCE FILTERING + GEO RANKING
    ----------------------------------------------------- */

    const rankedSources =
      rankAndFilterSources(
        rawResults,
        criteria,
        countryProfile,
      ).slice(0, 18);

    /*
     * Direct listing results are immediately candidates.
     */
    const candidates: ListingCandidate[] =
      [];

    for (const source of rankedSources) {
      if (
        looksLikeIndividualListing(
          source.url,
          source.url,
          true,
        )
      ) {
        candidates.push({
          url: normalizeUrl(source.url),
          source: source.source,
          parentSource: source.source,
          discoveryScore:
            source.sourceScore + 20,
        });
      }
    }

    /* -----------------------------------------------------
       4B. DIRECT LISTING SEARCH FALLBACK

       Portals such as Zillow / Redfin / Realtor often expose
       category pages to web search but do not expose their
       individual links when that category page is scraped.

       If the first pass did not already find enough individual
       listing URLs, ORBIT performs focused searches designed to
       return detail pages directly.
    ----------------------------------------------------- */

    if (
      candidates.length <
      TARGET_LISTINGS
    ) {
      const directQueries =
        buildDirectListingSearchQueries(
          criteria,
          countryProfile,
        );

      const directJobs =
        await Promise.allSettled(
          directQueries.flatMap(
            (directQuery) => [
              firecrawlSearch(
                firecrawlKey,
                directQuery,
              ),
              searxngSearch(
                directQuery,
              ),
            ],
          ),
        );

      const directRawResults:
        FirecrawlSearchResult[] =
        [];

      for (const job of directJobs) {
        if (
          job.status !== "fulfilled" ||
          !job.value
        ) {
          continue;
        }

        if (Array.isArray(job.value)) {
          directRawResults.push(
            ...job.value,
          );

          continue;
        }

        directRawResults.push(
          ...(job.value.data?.web ?? []),
        );

        creditsUsed +=
          job.value.creditsUsed ?? 0;
      }

      const directSources =
        rankAndFilterSources(
          directRawResults,
          criteria,
          countryProfile,
        );

      /*
       * Keep these sources too so the UI can show where ORBIT
       * discovered its listings.
       */
      for (const source of directSources) {
        if (
          !rankedSources.some(
            (existing) =>
              normalizeUrl(
                existing.url,
              ) ===
              normalizeUrl(
                source.url,
              ),
          )
        ) {
          rankedSources.push(
            source,
          );
        }

        if (
          looksLikeIndividualListing(
            source.url,
            source.url,
            true,
          )
        ) {
          candidates.push({
            url:
              normalizeUrl(
                source.url,
              ),

            source:
              source.source,

            parentSource:
              source.source,

            discoveryScore:
              source.sourceScore +
              35,
          });
        }
      }

      rankedSources.sort(
        (a, b) =>
          b.sourceScore -
          a.sourceScore,
      );
    }

    /* -----------------------------------------------------
       5. DISCOVER LISTING URLS
       Only top source pages are explored.
    ----------------------------------------------------- */

    const sourcePages =
      rankedSources
        .filter(
          (source) =>
            !looksLikeIndividualListing(
              source.url,
              source.url,
              true,
            ),
        )
        .slice(
          0,
          MAX_SOURCE_PAGES_TO_EXPLORE,
        );

    const discoveryJobs =
      await Promise.allSettled(
        sourcePages.map(
          async (source) => {
            const scrape =
              await scrapePage(
                firecrawlKey,
                source.url,
                ["links"],
                6500,
              );

            if (!scrape) {
              return [];
            }

            return (
              scrape.data?.links ?? []
            )
              .filter((url) =>
                looksLikeIndividualListing(
                  url,
                  source.url,
                ),
              )
              .slice(0, 25)
              .map(
                (
                  url,
                  index,
                ): ListingCandidate => ({
                  url: normalizeUrl(url),
                  source: getDomain(url),
                  parentSource:
                    source.source,
                  discoveryScore:
                    source.sourceScore -
                    index * 0.15,
                }),
              );
          },
        ),
      );

    for (const job of discoveryJobs) {
      if (
        job.status === "fulfilled"
      ) {
        candidates.push(
          ...job.value,
        );
      }
    }

    const uniqueCandidates =
      deduplicateCandidates(candidates)
        .filter((candidate) =>
          !isBlockedDomain(candidate.url),
        )
        .sort(
          (a, b) =>
            b.discoveryScore -
            a.discoveryScore,
        )
        .slice(
          0,
          MAX_DISCOVERED_CANDIDATES,
        );

    /* -----------------------------------------------------
       6. FAST LISTING PIPELINE V4.5

       Key change:
       Search engines already give ORBIT useful listing snippets.
       We no longer discard those results and wait for Firecrawl
       to successfully scrape every portal.

       Phase A:
       - turn individual search results into lightweight listings
         immediately;
       - parse price / beds / sqft / location from the snippet.

       Phase B:
       - scrape only the strongest few listings to enrich them;
       - if a portal blocks scraping, keep the snippet listing.

       This cuts latency dramatically and avoids "0 listings"
       when Zillow/Redfin expose the listing to search but block
       page scraping.
    ----------------------------------------------------- */

    const directSnippetSources =
      rankedSources
        .filter((source) =>
          looksLikeIndividualListing(
            source.url,
            source.url,
            true,
          ),
        )
        .slice(0, 24);

    const snippetListings =
      directSnippetSources
        .map(
          (
            source,
            index,
          ) =>
            extractListingFromSearchSnippet(
              {
                url: source.url,
                title: source.title,
                description:
                  source.description,
                source:
                  source.source,
                parentSource:
                  source.source,
                sourceScore:
                  source.sourceScore,
                image:
                  source.image,
              },
              criteria,
              index,
            ),
        )
        .filter(
          (
            listing,
          ): listing is StructuredListing =>
            Boolean(listing),
        );

    /*
     * Prefer URLs already discovered from search snippets, then
     * add link-discovery candidates. Only a small top set is scraped.
     */
    const enrichmentCandidates =
      deduplicateCandidates([
        ...directSnippetSources.map(
          (source) => ({
            url:
              normalizeUrl(
                source.url,
              ),

            source:
              source.source,

            parentSource:
              source.source,

            discoveryScore:
              source.sourceScore +
              50,
          }),
        ),

        ...uniqueCandidates,
      ])
        .sort(
          (a, b) =>
            b.discoveryScore -
            a.discoveryScore,
        )
        .slice(0, 10);

    const enrichmentJobs =
      await Promise.allSettled(
        enrichmentCandidates.map(
          async (
            candidate,
            index,
          ) => {
            const scrape =
              await scrapePage(
                firecrawlKey,
                candidate.url,
                [
                  "markdown",
                  "html",
                ],
                4200,
              );

            if (
              !scrape?.data?.markdown
            ) {
              return null;
            }

            const listing =
              extractRealEstateListing(
                scrape,
                candidate,
                criteria,
                index,
              );

            return isUsableListing(
              listing,
              criteria,
            )
              ? listing
              : null;
          },
        ),
      );

    const enrichedListings:
      StructuredListing[] =
      [];

    for (
      const job of
      enrichmentJobs
    ) {
      if (
        job.status === "fulfilled" &&
        job.value
      ) {
        enrichedListings.push(
          job.value,
        );
      }
    }

    /*
     * Enriched listings replace snippet versions when they share
     * the same URL. Snippet-only listings remain valid fallbacks.
     */
    const listingsByUrl =
      new Map<
        string,
        StructuredListing
      >();

    for (
      const listing of
      snippetListings
    ) {
      listingsByUrl.set(
        normalizeUrl(
          listing.url,
        ),
        listing,
      );
    }

    for (
      const listing of
      enrichedListings
    ) {
      const key =
        normalizeUrl(
          listing.url,
        );

      const fallback =
        listingsByUrl.get(key);

      listingsByUrl.set(
        key,
        mergeListingData(
          fallback,
          listing,
        ),
      );
    }

    const uniqueListings =
      Array.from(
        listingsByUrl.values(),
      )
        .filter((listing) =>
          isUsableListing(
            listing,
            criteria,
          ),
        )
        .slice(
          0,
          TARGET_LISTINGS * 3,
        );

    /* -----------------------------------------------------
       7. COMPARISON + FINAL VERIFICATION ENGINE

       Important:
       We do NOT select the final 10 before verification anymore.

       1. Rank a larger pool.
       2. Recover missing price + first real photo.
       3. Apply strict final criteria.
       4. Sort again.
       5. Return up to the 10 best verified listings.
    ----------------------------------------------------- */

    const comparisonPoolBase =
      applyRelativeComparison(
        uniqueListings,
        criteria,
      )
        .sort((a, b) =>
          sortListings(
            a,
            b,
            criteria.sortPriority,
          ),
        )
        .slice(
          0,
          FINAL_RECOVERY_POOL,
        )
        .map(
          (
            listing,
            index,
          ) => ({
            ...listing,
            id:
              `candidate-${index}`,
          }),
        );

    const comparisonPoolRecovered =
      await recoverMissingListingDetails(
        comparisonPoolBase,
        criteria,
      );

    const verifiedListings =
      comparisonPoolRecovered
        .filter(
          (listing) =>
            isFinalVerifiedListing(
              listing,
              criteria,
            ),
        );

    const comparedListings =
      applyRelativeComparison(
        verifiedListings,
        criteria,
      )
        .sort((a, b) =>
          sortListings(
            a,
            b,
            criteria.sortPriority,
          ),
        )
        .slice(
          0,
          TARGET_LISTINGS,
        )
        .map(
          (
            listing,
            index,
          ) => ({
            ...listing,
            id:
              `listing-${index}`,
          }),
        );

    return NextResponse.json({
      success: true,

      query,

      searchQuery:
        searchQueries.join(" || "),

      criteria,

      sourceCount:
        rankedSources.length,

      candidateCount:
        uniqueCandidates.length,

      directListingSearchEnabled:
        true,

      searxngEnabled:
        Boolean(
          process.env.SEARXNG_URL,
        ),

      searchEngineVersion:
        "6.1-canonical-location-resolver",

      listingCount:
        comparedListings.length,

      recoveryPoolCount:
        comparisonPoolBase.length,

      verifiedListingCount:
        verifiedListings.length,

      confirmedPriceCount:
        comparedListings.filter(
          (listing) =>
            typeof listing.price ===
              "number",
        ).length,

      photoCount:
        comparedListings.filter(
          (listing) =>
            listing.images.length > 0,
        ).length,

      targetListingCount:
        TARGET_LISTINGS,

      analyzedCandidateCount:
        enrichmentCandidates.length,

      snippetListingCount:
        snippetListings.length,

      enrichedListingCount:
        enrichedListings.length,

      creditsUsed,

      sources:
        rankedSources,

      listings:
        comparedListings,
    });
  } catch (error) {
    console.error(
      "ORBIT V4 error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Erreur inconnue";

    return NextResponse.json(
      {
        success: false,
        error:
          message
            .toLowerCase()
            .includes("abort")
            ? "La recherche a dépassé le délai prévu. Essaie avec une ville ou un pays plus précis."
            : "Impossible d'effectuer la recherche ORBIT.",
        details:
          process.env.NODE_ENV ===
          "development"
            ? message
            : undefined,
      },
      { status: 500 },
    );
  }
}

/* =========================================================
   INTENT ENGINE
========================================================= */

async function understandSearchIntent(
  query: string,
  openaiKey?: string,
): Promise<SearchIntent> {
  const fallback =
    heuristicIntent(query);

  if (!openaiKey) {
    return fallback;
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      4500,
    );

  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${openaiKey}`,
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          model: "gpt-5.4-mini",

          reasoning: {
            effort: "none",
          },

          max_output_tokens: 420,

          input: [
            {
              role: "system",
              content: `
Tu es le moteur de compréhension d'ORBIT.

Transforme une recherche immobilière naturelle en JSON strict.

Tu dois comprendre les villes composées :
- "los angeles" doit rester "Los Angeles"
- "new york" doit rester "New York"
- "le relecq-kerhuon" doit rester entier

Déduis le pays lorsqu'il est évident :
Los Angeles -> United States
Miami -> United States
Berlin -> Germany
Munich -> Germany
Barcelona -> Spain
Madrid -> Spain
Porto -> Portugal
Lisbon -> Portugal
Rome -> Italy
Milan -> Italy
London -> United Kingdom
Paris/Brest/Lyon -> France
Dubai -> United Arab Emirates

Règles pour lieux ambigus :
- "Washington" seul = Washington, District of Columbia, United States
- "Washington DC" = Washington, District of Columbia, United States
- "Washington state" = Washington State, United States
- Ne confonds jamais Washington DC avec Washington Court House, Ohio.
- Si un état/région est fourni, conserve-le précisément.

Différencie :
- requirements = critères obligatoires
- preferences = souhaits du type "si possible", "idéalement", "de préférence"

Retourne UNIQUEMENT un objet JSON.
Aucun markdown.

Schéma :
{
  "intent":"buy",
  "propertyType":"villa|house|apartment|chalet|penthouse|townhouse|mansion|property",
  "city":"string|null",
  "region":"string|null",
  "country":"string|null",
  "budgetMin":number|null,
  "budgetMax":number|null,
  "minSurface":number|null,
  "maxSurface":number|null,
  "minBedrooms":number|null,
  "minBathrooms":number|null,
  "radiusKm":number|null,
  "requirements":["string"],
  "preferences":["string"],
  "sortPriority":"best_match|lowest_price|best_value|largest|newest"
}
              `.trim(),
            },
            {
              role: "user",
              content: query,
            },
          ],
        }),

        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return fallback;
    }

    const payload =
      (await response.json()) as {
        output_text?: string;
        output?: Array<{
          content?: Array<{
            type?: string;
            text?: string;
          }>;
        }>;
      };

    const text =
      extractOpenAIText(payload);

    if (!text) {
      return fallback;
    }

    const jsonText =
      extractJsonObject(text);

    if (!jsonText) {
      return fallback;
    }

    const parsed =
      JSON.parse(jsonText) as Record<
        string,
        unknown
      >;

    return normalizeIntent(
      parsed,
      fallback,
    );
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

function heuristicIntent(
  query: string,
): SearchIntent {
  const q =
    query.toLowerCase();

  const location =
    heuristicLocation(query);

  const countryProfile =
    detectCountryFromText(q) ??
    inferCountryFromCity(
      location.city,
    );

  const budgetMax =
    extractBudgetMax(q);

  const surface =
    q.match(
      /(\d+(?:[.,]\d+)?)\s*(?:m²|m2|㎡|sqm)\s*\+?/i,
    );

  const bedrooms =
    q.match(
      /(\d+)\s*(?:chambres?|bedrooms?|beds?|schlafzimmer|habitaciones?|quartos?|camere)\b/i,
    );

  const bathrooms =
    q.match(
      /(\d+)\s*(?:salles?\s+de\s+bain|bathrooms?|baths?|badezimmer)\b/i,
    );

  return {
    category:
      "real_estate",

    intent:
      /\blocation\b|\brent\b|\bà louer\b|\ba louer\b/i.test(
        q,
      )
        ? "rent"
        : "buy",

    propertyType:
      detectPropertyType(q),

    city:
      location.city,

    region:
      location.region,

    country:
      countryProfile?.canonical,

    location:
      buildLocationString(
        location.city,
        location.region,
        countryProfile?.canonical,
      ),

    language:
      countryProfile?.language,

    currency:
      countryProfile?.currency,

    budgetMax,

    minSurface:
      surface?.[1]
        ? Number(
            surface[1].replace(
              ",",
              ".",
            ),
          )
        : undefined,

    minBedrooms:
      bedrooms?.[1]
        ? Number(
            bedrooms[1],
          )
        : undefined,

    minBathrooms:
      bathrooms?.[1]
        ? Number(
            bathrooms[1],
          )
        : undefined,

    requirements:
      extractFeatureWords(q, false),

    preferences:
      extractFeatureWords(q, true),

    sortPriority:
      q.includes("moins cher") ||
      q.includes("cheapest")
        ? "lowest_price"
        : q.includes("plus grand") ||
            q.includes("largest")
          ? "largest"
          : q.includes("bonne affaire") ||
              q.includes("best value")
            ? "best_value"
            : "best_match",
  };
}

function normalizeIntent(
  parsed: Record<string, unknown>,
  fallback: SearchIntent,
): SearchIntent {
  const city =
    cleanOptionalString(
      parsed.city,
    ) ??
    fallback.city;

  const region =
    cleanOptionalString(
      parsed.region,
    ) ??
    fallback.region;

  const countryRaw =
    cleanOptionalString(
      parsed.country,
    ) ??
    fallback.country;

  const profile =
    countryRaw
      ? resolveProfileByName(
          countryRaw,
        )
      : inferCountryFromCity(city);

  const country =
    profile?.canonical ??
    countryRaw;

  const sort =
    cleanOptionalString(
      parsed.sortPriority,
    );

  const validSort:
    SearchIntent["sortPriority"][] =
    [
      "best_match",
      "lowest_price",
      "best_value",
      "largest",
      "newest",
    ];

  return {
    category:
      "real_estate",

    intent:
      parsed.intent === "rent"
        ? "rent"
        : "buy",

    propertyType:
      cleanOptionalString(
        parsed.propertyType,
      ) ??
      fallback.propertyType,

    city,
    region,
    country,

    location:
      buildLocationString(
        city,
        region,
        country,
      ),

    language:
      profile?.language ??
      fallback.language,

    currency:
      profile?.currency ??
      fallback.currency,

    budgetMin:
      cleanOptionalNumber(
        parsed.budgetMin,
      ) ??
      fallback.budgetMin,

    budgetMax:
      cleanOptionalNumber(
        parsed.budgetMax,
      ) ??
      fallback.budgetMax,

    minSurface:
      cleanOptionalNumber(
        parsed.minSurface,
      ) ??
      fallback.minSurface,

    maxSurface:
      cleanOptionalNumber(
        parsed.maxSurface,
      ) ??
      fallback.maxSurface,

    minBedrooms:
      cleanOptionalNumber(
        parsed.minBedrooms,
      ) ??
      fallback.minBedrooms,

    minBathrooms:
      cleanOptionalNumber(
        parsed.minBathrooms,
      ) ??
      fallback.minBathrooms,

    radiusKm:
      cleanOptionalNumber(
        parsed.radiusKm,
      ) ??
      fallback.radiusKm,

    requirements:
      normalizeStringArray(
        parsed.requirements,
      ),

    preferences:
      normalizeStringArray(
        parsed.preferences,
      ),

    sortPriority:
      validSort.includes(
        sort as SearchIntent["sortPriority"],
      )
        ? (sort as SearchIntent["sortPriority"])
        : fallback.sortPriority,
  };
}

/* =========================================================
   SEARCH PLANNER
========================================================= */

function buildSearchPlan(
  originalQuery: string,
  criteria: SearchIntent,
  profile?: CountryProfile,
) {
  const location =
    criteria.location ??
    originalQuery;

  const property =
    criteria.propertyType ??
    "property";

  const details: string[] =
    [];

  if (criteria.minBedrooms) {
    details.push(
      `${criteria.minBedrooms} bedrooms`,
    );
  }

  if (criteria.minSurface) {
    details.push(
      `${criteria.minSurface} sqm`,
    );
  }

  if (criteria.budgetMax) {
    details.push(
      `under ${criteria.budgetMax} ${criteria.currency ?? ""}`,
    );
  }

  for (
    const feature of
    criteria.requirements
  ) {
    details.push(feature);
  }

  const localTerms =
    profile?.searchTerms ??
    [
      "property for sale",
      "real estate",
    ];

  const queryOne =
    [
      property,
      location,
      criteria.intent === "rent"
        ? "for rent"
        : "for sale",
      ...details,
      ...localTerms.slice(0, 2),
    ]
      .filter(Boolean)
      .join(" ");

  /*
   * Second query focuses on the country's strongest portals.
   * It runs in parallel with queryOne.
   */
  const topDomains =
    Object.entries(
      profile?.domains ?? {},
    )
      .sort(
        (a, b) =>
          b[1] - a[1],
      )
      .slice(0, 3)
      .map(([domain]) =>
        `site:${domain}`,
      );

  const queryTwo =
    topDomains.length > 0
      ? [
          property,
          location,
          criteria.intent === "rent"
            ? "rent"
            : "sale",
          ...details,
          `(${topDomains.join(" OR ")})`,
        ]
          .filter(Boolean)
          .join(" ")
      : [
          originalQuery,
          location,
          "real estate",
        ].join(" ");

  return Array.from(
    new Set([
      cleanupText(queryOne),
      cleanupText(queryTwo),
    ]),
  );
}

function buildDirectListingSearchQueries(
  criteria: SearchIntent,
  profile?: CountryProfile,
) {
  const location =
    criteria.location ??
    criteria.city ??
    "";

  const property =
    criteria.propertyType ??
    "property";

  const details: string[] =
    [];

  if (criteria.budgetMax) {
    details.push(
      `under ${criteria.budgetMax} ${criteria.currency ?? ""}`,
    );
  }

  if (criteria.minBedrooms) {
    details.push(
      `${criteria.minBedrooms} bedrooms`,
    );
  }

  if (criteria.minSurface) {
    details.push(
      `${criteria.minSurface} sqm`,
    );
  }

  for (
    const requirement of
    criteria.requirements
  ) {
    details.push(requirement);
  }

  const country =
    criteria.country ??
    profile?.canonical;

  /*
   * For the largest portals we use path-specific searches.
   * This is important because their category pages are often
   * JavaScript-heavy and do not reveal individual links to
   * Firecrawl when scraped.
   */
  if (
    country ===
    "United States"
  ) {
    return [
      [
        `site:zillow.com/homedetails`,
        location,
        property,
        ...details,
        "for sale",
      ]
        .filter(Boolean)
        .join(" "),

      [
        `site:redfin.com`,
        location,
        property,
        ...details,
        `"home/"`,
        "for sale",
      ]
        .filter(Boolean)
        .join(" "),

      [
        `(site:realtor.com/realestateandhomes-detail OR site:homes.com/property)`,
        location,
        property,
        ...details,
        "for sale",
      ]
        .filter(Boolean)
        .join(" "),
    ];
  }

  if (
    country === "Germany"
  ) {
    return [
      [
        "site:immobilienscout24.de/expose",
        location,
        property,
        ...details,
        "kaufen",
      ]
        .filter(Boolean)
        .join(" "),

      [
        "site:immowelt.de/expose",
        location,
        property,
        ...details,
        "kaufen",
      ]
        .filter(Boolean)
        .join(" "),
    ];
  }

  if (
    country === "Spain"
  ) {
    return [
      [
        "site:idealista.com/inmueble",
        location,
        property,
        ...details,
        "venta",
      ]
        .filter(Boolean)
        .join(" "),

      [
        "site:fotocasa.es",
        location,
        property,
        ...details,
        "venta",
      ]
        .filter(Boolean)
        .join(" "),
    ];
  }

  if (
    country === "Portugal"
  ) {
    return [
      [
        "site:idealista.pt/imovel",
        location,
        property,
        ...details,
        "venda",
      ]
        .filter(Boolean)
        .join(" "),

      [
        "site:imovirtual.com",
        location,
        property,
        ...details,
        "venda",
      ]
        .filter(Boolean)
        .join(" "),
    ];
  }

  if (
    country === "Italy"
  ) {
    return [
      [
        "site:immobiliare.it/annunci",
        location,
        property,
        ...details,
        "vendita",
      ]
        .filter(Boolean)
        .join(" "),

      [
        "site:idealista.it/immobile",
        location,
        property,
        ...details,
        "vendita",
      ]
        .filter(Boolean)
        .join(" "),
    ];
  }

  if (
    country ===
    "United Kingdom"
  ) {
    return [
      [
        "site:rightmove.co.uk/properties",
        location,
        property,
        ...details,
        "for sale",
      ]
        .filter(Boolean)
        .join(" "),

      [
        "site:zoopla.co.uk/for-sale/details",
        location,
        property,
        ...details,
        "for sale",
      ]
        .filter(Boolean)
        .join(" "),
    ];
  }

  /*
   * Generic fallback for countries without portal-specific path
   * rules yet.
   */
  const topDomains =
    Object.entries(
      profile?.domains ?? {},
    )
      .sort(
        (a, b) =>
          b[1] - a[1],
      )
      .slice(0, 2)
      .map(([domain]) =>
        domain,
      );

  if (
    topDomains.length === 0
  ) {
    return [
      [
        location,
        property,
        ...details,
        "property listing for sale address",
      ]
        .filter(Boolean)
        .join(" "),
    ];
  }

  return topDomains.map(
    (domain) =>
      [
        `site:${domain}`,
        location,
        property,
        ...details,
        "property listing details",
      ]
        .filter(Boolean)
        .join(" "),
  );
}

/* =========================================================
   FIRECRAWL
========================================================= */

async function searxngSearch(
  query: string,
): Promise<FirecrawlSearchResult[]> {
  const baseUrl =
    process.env.SEARXNG_URL ??
    "http://localhost:8080";

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      6000,
    );

  try {
    const url =
      `${baseUrl}/search?` +
      new URLSearchParams({
        q: query,
        format: "json",
        categories: "general",
        language: "auto",
      }).toString();

    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,
          cache: "no-store",
        },
      );

    if (!response.ok) {
      return [];
    }

    const payload =
      (await response.json()) as SearXNGResponse;

    return (
      payload.results ?? []
    )
      .filter(
        (
          result,
        ): result is SearXNGResult & {
          url: string;
        } =>
          typeof result.url ===
            "string" &&
          result.url.length > 0,
      )
      .filter((result) =>
        isUsefulSearXNGResult(
          result,
        ),
      )
      .slice(0, 30)
      .map(
        (
          result,
          index,
        ) => ({
          url: result.url,
          title:
            result.title ?? "",
          description:
            result.content ?? "",
          position:
            index + 1,
          image:
            pickSearchThumbnail(
              result.thumbnail,
              result.img_src,
            ),
        }),
      );
  } catch (error) {
    console.warn(
      "SearXNG search failed:",
      error,
    );

    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function isUsefulSearXNGResult(
  result: SearXNGResult,
) {
  if (!result.url) {
    return false;
  }

  if (
    isBlockedDomain(
      result.url,
    )
  ) {
    return false;
  }

  const text =
    `${result.title ?? ""} ${result.content ?? ""} ${result.url}`
      .toLowerCase();

  const badSignals = [
    "hotel",
    "restaurant",
    "yoga",
    "kitchen",
    "bath showroom",
    "review",
    "tripadvisor",
    "booking.com",
    "instagram",
    "facebook",
    "youtube",
    "for rent",
    "apartments for rent",
  ];

  if (
    badSignals.some(
      (signal) =>
        text.includes(signal),
    )
  ) {
    return false;
  }

  const goodSignals = [
    "for sale",
    "homes for sale",
    "house for sale",
    "property for sale",
    "real estate",
    "à vendre",
    "a vendre",
    "maison",
    "villa",
    "appartement",
    "immobilier",
    "kaufen",
    "in vendita",
    "en venta",
    "te koop",
  ];

  return goodSignals.some(
    (signal) =>
      text.includes(signal),
  );
}

async function firecrawlSearch(
  apiKey: string,
  query: string,
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      7500,
    );

  try {
    const response =
      await fetch(
        "https://api.firecrawl.dev/v2/search",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${apiKey}`,
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            query,
            limit: 10,
            sources: ["web"],
          }),

          signal: controller.signal,
          cache: "no-store",
        },
      );

    const payload =
      (await response.json()) as FirecrawlSearchResponse;

    if (
      !response.ok ||
      !payload.success
    ) {
      return null;
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function scrapePage(
  apiKey: string,
  url: string,
  formats: Array<
    "markdown" | "links" | "html"
  >,
  timeoutMs: number,
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs,
    );

  try {
    const response =
      await fetch(
        "https://api.firecrawl.dev/v2/scrape",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${apiKey}`,
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            url,
            formats,
          }),

          signal: controller.signal,
          cache: "no-store",
        },
      );

    const payload =
      (await response.json()) as FirecrawlScrapeResponse;

    if (
      !response.ok ||
      !payload.success
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================================
   SOURCE RANKING / GEO FILTER
========================================================= */

function rankAndFilterSources(
  rawResults: FirecrawlSearchResult[],
  criteria: SearchIntent,
  profile?: CountryProfile,
): RankedSource[] {
  const seen =
    new Set<string>();

  const output: RankedSource[] =
    [];

  for (
    let index = 0;
    index < rawResults.length;
    index++
  ) {
    const result =
      rawResults[index];

    if (!result.url) {
      continue;
    }

    const url =
      normalizeUrl(result.url);

    if (
      seen.has(url) ||
      isBlockedDomain(url)
    ) {
      continue;
    }

    seen.add(url);

    const domain =
      getDomain(url);

    const title =
      cleanupText(
        result.title ?? "",
      );

    const description =
      cleanupText(
        result.description ?? "",
      );

    const text =
      `${title} ${description} ${url}`
        .toLowerCase();

    /*
     * Hard geo rejection when the result clearly references a
     * different well-known city than the requested city.
     */
    if (
      isClearlyWrongLocation(
        text,
        criteria,
      )
    ) {
      continue;
    }

    let score =
      profile?.domains[
        domain
      ] ??
      GLOBAL_PREFERRED_DOMAINS[
        domain
      ] ??
      50;

    if (
      criteria.city
    ) {
      const geo =
        evaluateLocationMatch(
          title,
          description,
          criteria,
        );

      score +=
        geo.sourceScoreAdjustment;

      if (
        geo.reject
      ) {
        continue;
      }

      if (
        !isSearchResultLocationCompatible(
          title,
          description,
          url,
          criteria,
        )
      ) {
        continue;
      }
    }

    if (
      criteria.country &&
      text.includes(
        criteria.country.toLowerCase(),
      )
    ) {
      score += 12;
    }

    if (
      criteria.propertyType &&
      containsPropertyType(
        text,
        criteria.propertyType,
      )
    ) {
      score += 10;
    }

    if (
      /for sale|à vendre|a vendre|kaufen|en venta|à venda|in vendita|te koop/i.test(
        text,
      )
    ) {
      score += 10;
    }

    if (
      /holiday|vacation rental|per night|par nuit|location saisonnière/i.test(
        text,
      )
    ) {
      score -= 80;
    }

    if (
      /house price|market price|prix immobilier|price\/m²|price per square/i.test(
        text,
      )
    ) {
      score -= 35;
    }

    if (score <= 0) {
      continue;
    }

    output.push({
      id: `source-${index}`,
      title:
        title ||
        "Résultat immobilier",
      description,
      url,
      position:
        result.position ??
        index + 1,
      source: domain,
      sourceScore: score,
      image:
        result.image,
    });
  }

  return output.sort(
    (a, b) =>
      b.sourceScore -
      a.sourceScore,
  );
}

function isClearlyWrongLocation(
  text: string,
  criteria: SearchIntent,
) {
  if (!criteria.city) {
    return false;
  }

  const requested =
    criteria.city.toLowerCase();

  if (
    text.includes(requested)
  ) {
    return false;
  }

  /*
   * Common cities are used only as negative signals.
   * Example: Los Angeles request should reject Palm Desert,
   * Miami, Berlin, etc. if the requested city is absent.
   */
  const cities = [
    "los angeles",
    "palm desert",
    "san francisco",
    "san diego",
    "miami",
    "new york",
    "chicago",
    "boston",
    "berlin",
    "munich",
    "hamburg",
    "frankfurt",
    "paris",
    "brest",
    "lyon",
    "marseille",
    "madrid",
    "barcelona",
    "valencia",
    "lisbon",
    "porto",
    "milan",
    "rome",
    "london",
    "manchester",
    "dubai",
  ];

  const foreignCity =
    cities.find(
      (city) =>
        city !== requested &&
        text.includes(city),
    );

  return Boolean(foreignCity);
}

/* =========================================================
   LISTING URL DETECTION
========================================================= */

function isKnownCategoryPage(
  domain: string,
  path: string,
) {
  if (
    domain === "zillow.com"
  ) {
    return (
      /\/under-\d+\/?$/i.test(
        path,
      ) ||
      /\/\d+-bedrooms\/?$/i.test(
        path,
      )
    );
  }

  if (
    domain === "redfin.com"
  ) {
    return (
      /\/homes-for-sale-under-/i.test(
        path,
      ) ||
      /\/filter\//i.test(
        path,
      )
    );
  }

  if (
    domain === "realtor.com"
  ) {
    return (
      /\/realestateandhomes-search\//i.test(
        path,
      )
    );
  }

  if (
    domain === "homes.com"
  ) {
    return (
      /\/under-\d+k\/?$/i.test(
        path,
      )
    );
  }

  return false;
}

function looksLikeIndividualListing(
  candidateUrl: string,
  parentUrl: string,
  allowSameUrl = false,
) {
  try {
    if (
      isBlockedDomain(
        candidateUrl,
      )
    ) {
      return false;
    }

    const candidate =
      new URL(candidateUrl);

    const parent =
      new URL(parentUrl);

    if (
      !allowSameUrl &&
      normalizeUrl(
        candidateUrl,
      ) ===
        normalizeUrl(
          parentUrl,
        )
    ) {
      return false;
    }

    /*
     * Listing links normally stay on the portal's domain.
     */
    if (
      candidate.hostname !==
      parent.hostname
    ) {
      return false;
    }

    const path =
      candidate.pathname.toLowerCase();

    if (
      !path ||
      path === "/"
    ) {
      return false;
    }

    if (
      BAD_PATH_PARTS.some(
        (bad) =>
          path.includes(bad),
      )
    ) {
      return false;
    }

    const domain =
      getDomain(
        candidateUrl,
      );

    if (
      isKnownCategoryPage(
        domain,
        path,
      )
    ) {
      return false;
    }

    const domainPatterns: Record<
      string,
      RegExp[]
    > = {
      "zillow.com": [
        /\/homedetails\//i,
        /\/b\/[^/]+\/\d+_zpid/i,
        /\/\d+_zpid\//i,
      ],

      "redfin.com": [
        /\/home\/\d+/i,
        /\/[^/]+\/[^/]+\/[^/]+\/home\/\d+/i,
      ],

      "realtor.com": [
        /\/realestateandhomes-detail\//i,
      ],

      "homes.com": [
        /\/property\//i,
      ],

      "immobilienscout24.de": [
        /\/expose\/\d+/i,
      ],

      "immowelt.de": [
        /\/expose\//i,
      ],

      "idealista.com": [
        /\/inmueble\/\d+/i,
      ],

      "idealista.pt": [
        /\/imovel\/\d+/i,
        /\/inmueble\/\d+/i,
      ],

      "idealista.it": [
        /\/immobile\/\d+/i,
        /\/inmueble\/\d+/i,
      ],

      "immobiliare.it": [
        /\/annunci\/\d+/i,
      ],

      "rightmove.co.uk": [
        /\/properties\/\d+/i,
      ],

      "zoopla.co.uk": [
        /\/for-sale\/details\/\d+/i,
      ],

      "onthemarket.com": [
        /\/details\/\d+/i,
      ],

      "spain-real.estate": [
        /\/property\/\d+/i,
      ],

      "realtor.ca": [
        /\/real-estate\/\d+/i,
      ],

      "seloger.com": [
        /\/annonce\/achat\//i,
        /\/annonces\/achat\//i,
      ],

      "ouestfrance-immo.com": [
        /\/immobilier\/vente\/.+\/\d+\.htm$/i,
      ],
    };

    const specific =
      domainPatterns[domain];

    if (
      specific?.some(
        (pattern) =>
          pattern.test(path),
      )
    ) {
      return true;
    }

    const generic = [
      /\/listing\//i,
      /\/property\//i,
      /\/properties\/\d+/i,
      /\/detail\/\d+/i,
      /\/details\/\d+/i,
      /\/annonce\//i,
      /\/annonces\/.+\/\d+/i,
      /\/inmueble\/\d+/i,
      /\/immobile\/\d+/i,
      /\/expose\/\d+/i,
      /\/real-estate\/\d+/i,
      /\/realestateandhomes-detail\//i,
      /\/home\/\d+/i,
      /\/homedetails\//i,
    ];

    return generic.some(
      (pattern) =>
        pattern.test(path),
    );
  } catch {
    return false;
  }
}

/* =========================================================
   EXTRACTION
========================================================= */

function pickSearchThumbnail(
  ...values: Array<
    string | undefined
  >
) {
  for (const value of values) {
    if (
      typeof value ===
        "string" &&
      value.startsWith("http") &&
      isLikelyPropertyImage(value)
    ) {
      return value;
    }
  }

  return undefined;
}

function extractLocationFromSearchSnippet(
  title: string,
  description: string,
  criteria: SearchIntent,
) {
  const text =
    cleanupText(
      `${title} ${description}`,
    );

  /*
   * US listing titles usually contain:
   * 15022 SW 127th Pl, Miami, FL 33186
   */
  if (
    criteria.country ===
    "United States"
  ) {
    const match =
      text.match(
        /\b([^,\n]{2,60}),\s*([A-Za-z .'-]{2,40}),\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/,
      );

    if (
      match?.[2] &&
      match?.[3]
    ) {
      return cleanupText(
        `${match[2]}, ${match[3]}, United States`,
      );
    }

    const cityState =
      text.match(
        /\b([A-Za-z .'-]{2,40}),\s*(FL|CA|NY|TX|AZ|NV|IL|MA|WA|GA|NC|SC|NJ|PA)\b/,
      );

    if (
      cityState?.[1] &&
      cityState?.[2]
    ) {
      return cleanupText(
        `${cityState[1]}, ${cityState[2]}, United States`,
      );
    }
  }

  if (
    criteria.city &&
    text
      .toLowerCase()
      .includes(
        criteria.city.toLowerCase(),
      )
  ) {
    return buildLocationString(
      criteria.city,
      criteria.region,
      criteria.country,
    );
  }

  return undefined;
}

function normalizePlaceToken(
  value?: string,
) {
  return cleanupText(
    value ?? "",
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    );
}

function isSearchResultLocationCompatible(
  title: string,
  description: string,
  url: string,
  criteria: SearchIntent,
) {
  const requestedCity =
    normalizePlaceToken(
      criteria.city,
    );

  const requestedRegion =
    normalizePlaceToken(
      criteria.region,
    );

  const textRaw =
    `${title} ${description} ${url}`;

  const text =
    normalizePlaceToken(
      textRaw,
    );

  if (
    requestedCity ===
      "washington" &&
    requestedRegion ===
      "district of columbia"
  ) {
    if (
      text.includes(
        "washington court house",
      ) ||
      text.includes(
        "washington courthouse",
      )
    ) {
      return false;
    }

    const explicitState =
      extractUSStateCode(
        textRaw,
      );

    if (
      explicitState &&
      explicitState !== "DC"
    ) {
      return false;
    }

    return (
      text.includes(
        "washington dc",
      ) ||
      text.includes(
        "district of columbia",
      ) ||
      /,\s*dc\b/i.test(
        textRaw,
      )
    );
  }

  return true;
}

function evaluateLocationMatch(
  title: string,
  description: string,
  criteria: SearchIntent,
) {
  const requested =
    normalizePlaceToken(
      criteria.city,
    );

  if (!requested) {
    return {
      reject: false,
      sourceScoreAdjustment: 0,
    };
  }

  const text =
    normalizePlaceToken(
      `${title} ${description}`,
    );

  if (
    text.includes(requested)
  ) {
    return {
      reject: false,
      sourceScoreAdjustment: 34,
    };
  }

  /*
   * If a listing snippet explicitly contains another city/address,
   * do not pretend it is the requested city.
   */
  const explicitUSCity =
    `${title} ${description}`.match(
      /,\s*([A-Za-z .'-]{2,40}),\s*(FL|CA|NY|TX|AZ|NV|IL|MA|WA|GA|NC|SC|NJ|PA)\b/,
    );

  if (
    explicitUSCity?.[1] &&
    criteria.country ===
      "United States"
  ) {
    const found =
      normalizePlaceToken(
        explicitUSCity[1],
      );

    if (
      found &&
      !found.includes(
        requested,
      ) &&
      !requested.includes(
        found,
      )
    ) {
      return {
        reject: true,
        sourceScoreAdjustment: -100,
      };
    }
  }

  return {
    reject: false,
    sourceScoreAdjustment: -8,
  };
}

function evaluateListingLocation(
  location: string | undefined,
  title: string,
  description: string,
  criteria: SearchIntent,
) {
  const requested =
    normalizePlaceToken(
      criteria.city,
    );

  if (!requested) {
    return {
      reject: false,
    };
  }

  const explicit =
    normalizePlaceToken(
      location,
    );

  if (
    explicit &&
    explicit.includes(
      requested,
    )
  ) {
    return {
      reject: false,
    };
  }

  const sourceGeo =
    evaluateLocationMatch(
      title,
      description,
      criteria,
    );

  if (
    sourceGeo.reject
  ) {
    return {
      reject: true,
    };
  }

  /*
   * Unknown location is allowed but ranked lower.
   */
  return {
    reject: false,
  };
}

function mergeListingData(
  fallback:
    | StructuredListing
    | undefined,
  enriched: StructuredListing,
): StructuredListing {
  if (!fallback) {
    return enriched;
  }

  const images =
    uniqueStrings([
      ...(enriched.images ?? []),
      ...(fallback.images ?? []),
    ])
      .filter(
        isLikelyPropertyImage,
      )
      .slice(0, 12);

  return {
    ...fallback,
    ...enriched,

    title:
      enriched.title ||
      fallback.title,

    description:
      enriched.description ||
      fallback.description,

    price:
      enriched.price ??
      fallback.price,

    currency:
      enriched.currency ??
      fallback.currency,

    surface:
      enriched.surface ??
      fallback.surface,

    landSurface:
      enriched.landSurface ??
      fallback.landSurface,

    bedrooms:
      enriched.bedrooms ??
      fallback.bedrooms,

    bathrooms:
      enriched.bathrooms ??
      fallback.bathrooms,

    rooms:
      enriched.rooms ??
      fallback.rooms,

    location:
      enriched.location ??
      fallback.location,

    dpe:
      enriched.dpe ??
      fallback.dpe,

    images,

    pricePerM2:
      enriched.pricePerM2 ??
      fallback.pricePerM2,
  };
}

function isStrongIndividualListingUrl(
  url: string,
) {
  try {
    const parsed =
      new URL(url);

    const domain =
      getDomain(url);

    const path =
      parsed.pathname.toLowerCase();

    const strongPatterns: Record<
      string,
      RegExp[]
    > = {
      "zillow.com": [
        /\/homedetails\//i,
        /\/\d+_zpid\/?/i,
      ],

      "redfin.com": [
        /\/home\/\d+/i,
      ],

      "realtor.com": [
        /\/realestateandhomes-detail\//i,
      ],

      "homes.com": [
        /\/property\//i,
      ],

      "zoopla.co.uk": [
        /\/for-sale\/details\/\d+/i,
      ],

      "rightmove.co.uk": [
        /\/properties\/\d+/i,
      ],

      "onthemarket.com": [
        /\/details\/\d+/i,
      ],

      "spain-real.estate": [
        /\/property\/\d+/i,
      ],

      "idealista.com": [
        /\/inmueble\/\d+/i,
      ],

      "idealista.pt": [
        /\/imovel\/\d+/i,
      ],

      "idealista.it": [
        /\/immobile\/\d+/i,
      ],

      "immobilienscout24.de": [
        /\/expose\/\d+/i,
      ],

      "immowelt.de": [
        /\/expose\//i,
      ],

      "seloger.com": [
        /\/annonce\/achat\//i,
        /\/annonces\/achat\//i,
      ],
    };

    const specific =
      strongPatterns[domain];

    if (
      specific?.some(
        (pattern) =>
          pattern.test(path),
      )
    ) {
      return true;
    }

    return [
      /\/property\/\d+/i,
      /\/properties\/\d+/i,
      /\/listing\/\d+/i,
      /\/details?\/\d+/i,
      /\/annonce\/.+\d+/i,
      /\/home\/\d+/i,
      /\/homedetails\//i,
    ].some(
      (pattern) =>
        pattern.test(path),
    );
  } catch {
    return false;
  }
}

function looksLikeCategorySearchResult(
  title: string,
  description: string,
  url: string,
) {
  const text =
    cleanupText(
      `${title} ${description}`,
    ).toLowerCase();

  const categorySignals = [
    "property & houses for sale",
    "properties & houses for sale",
    "houses for sale in uk",
    "houses for sale in england",
    "homes for sale under",
    "properties for sale under",
    "search properties",
    "search homes",
    "browse properties",
    "property search",
    "real estate listings",
    "all properties",
    "all homes",
    "homes for sale -",
    "properties for sale -",
  ];

  return (
    categorySignals.some(
      (signal) =>
        text.includes(signal),
    ) &&
    !isStrongIndividualListingUrl(
      url,
    )
  );
}

function hasExplicitCurrencyPrice(
  text: string,
  value: number,
) {
  const variants = [
    String(Math.round(value)),
    Math.round(value).toLocaleString(
      "en-US",
      {
        maximumFractionDigits: 0,
      },
    ),
    Math.round(value)
      .toLocaleString(
        "en-US",
        {
          maximumFractionDigits: 0,
        },
      )
      .replace(/,/g, " "),
  ];

  const escaped =
    variants.map(
      (candidate) =>
        candidate.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        ),
    );

  const amount =
    `(?:${escaped.join("|")})`;

  return new RegExp(
    `(?:US\\\\$|USD|\\\\$|EUR|€|GBP|£|CHF|CAD|C\\\\$)\\\\s*${amount}|${amount}\\\\s*(?:US\\\\$|USD|\\\\$|EUR|€|GBP|£|CHF|CAD|C\\\\$)`,
    "i",
  ).test(text);
}

function applyPriceSafetyGuards(
  price: number | undefined,
  sourceText: string,
  title: string,
  criteria: SearchIntent,
  surface?: number,
) {
  if (
    price === undefined
  ) {
    return undefined;
  }

  /* SAFETY 1 — global range */
  if (
    !Number.isFinite(price) ||
    price < 10000 ||
    price > 1000000000
  ) {
    return undefined;
  }

  /* SAFETY 2 — ZIP / postcode collision */
  if (
    isPriceActuallyAddressZip(
      price,
      title,
    )
  ) {
    return undefined;
  }

  /* SAFETY 3 — query budget must not become property price */
  if (
    criteria.budgetMax &&
    price === criteria.budgetMax &&
    !hasExplicitCurrencyPrice(
      sourceText,
      price,
    )
  ) {
    return undefined;
  }

  /* SAFETY 4 — absurd price per square metre */
  if (
    surface &&
    surface > 10
  ) {
    const perM2 =
      price / surface;

    if (
      perM2 < 100 ||
      perM2 > 100000
    ) {
      return undefined;
    }
  }

  /*
   * SAFETY 5 — never hide a confirmed high price.
   * Keeping it allows the hard budget filter to reject the listing
   * instead of turning it into "Prix non confirmé".
   */
  if (
    criteria.budgetMax &&
    price >
      criteria.budgetMax * 20
  ) {
    return undefined;
  }

  return price;
}

function extractListingFromSearchSnippet(
  source: SearchSnippetListing,
  criteria: SearchIntent,
  index: number,
): StructuredListing | null {
  const combined =
    cleanupText(
      `${source.title} ${source.description}`,
    );

  if (
    !combined ||
    isBlockedDomain(
      source.url,
    )
  ) {
    return null;
  }

  const lower =
    combined.toLowerCase();

  if (
    looksLikeCategorySearchResult(
      source.title,
      source.description,
      source.url,
    ) ||
    !isStrongIndividualListingUrl(
      source.url,
    )
  ) {
    return null;
  }

  let price =
    extractPrice(
      combined,
    );

  const surface =
    extractSurface(
      combined,
    );

  price =
    applyPriceSafetyGuards(
      price,
      combined,
      source.title,
      criteria,
      surface,
    );

  const bedrooms =
    extractBedrooms(
      combined,
    );

  const bathrooms =
    extractBathrooms(
      combined,
    );

  const location =
    extractLocationFromSearchSnippet(
      source.title,
      source.description,
      criteria,
    );

  const garden =
    detectFeature(
      combined,
      ["garden", "jardin"],
    );

  const garage =
    detectFeature(
      combined,
      ["garage"],
    );

  const pool =
    detectFeature(
      combined,
      [
        "pool",
        "swimming pool",
        "piscine",
      ],
    );

  const terrace =
    detectFeature(
      combined,
      [
        "terrace",
        "terrasse",
      ],
    );

  const parking =
    detectFeature(
      combined,
      [
        "parking",
        "carport",
      ],
    );

  const propertyKind =
    detectPropertyKind(
      combined,
      source.title,
      criteria.propertyType,
    );

  const pricePerM2 =
    price &&
    surface &&
    surface > 0
      ? Math.round(
          price / surface,
        )
      : undefined;

  const images =
    source.image &&
    isLikelyPropertyImage(
      source.image,
    )
      ? [source.image]
      : [];

  const scores =
    calculateBaseScores(
      {
        price,
        surface,
        bedrooms,
        bathrooms,
        location,
        garden,
        garage,
        pool,
        terrace,
        parking,
        dpe: undefined,
        pricePerM2,
        images,
        propertyKind,
      },
      criteria,
    );

  /*
   * Keep only individual-listing URLs. Search snippets are allowed
   * to be incomplete; missing fields are better than losing the
   * result entirely.
   */
  if (
    !looksLikeIndividualListing(
      source.url,
      source.url,
      true,
    )
  ) {
    return null;
  }

  return {
    id:
      `snippet-${index}`,

    url:
      normalizeUrl(
        source.url,
      ),

    source:
      source.source,

    parentSource:
      source.parentSource,

    title:
      cleanupText(
        source.title,
      ) ||
      "Property listing",

    description:
      cleanupText(
        source.description,
      ).slice(
        0,
        700,
      ),

    price,

    currency:
      criteria.currency,

    surface,

    bedrooms,
    bathrooms,

    location,

    garden,
    garage,
    pool,
    terrace,
    parking,

    images,

    pricePerM2,

    propertyKind,

    matchScore:
      scores.matchScore,

    valueScore:
      scores.valueScore,

    orbitScore:
      scores.orbitScore,

    reasons:
      scores.reasons,

    compromises:
      scores.compromises,

    extractedAt:
      new Date().toISOString(),
  };
}

function extractRealEstateListing(
  scrape: FirecrawlScrapeResponse,
  candidate: ListingCandidate,
  criteria: SearchIntent,
  index: number,
): StructuredListing {
  const markdown =
    scrape.data?.markdown ??
    "";

  const metadata =
    scrape.data?.metadata;

  const summary =
    markdown.slice(
      0,
      10000,
    );

  const title =
    extractTitle(
      summary,
      metadata?.title,
    );

  const description =
    extractDescription(
      summary,
      metadata?.description,
    );

  let price =
    extractPriceFromScrape(
      scrape,
      criteria,
    );

  const surface =
    extractSurface(summary);

  price =
    applyPriceSafetyGuards(
      price,
      `${summary} ${scrape.data?.html ?? ""}`,
      title,
      criteria,
      surface,
    );

  const landSurface =
    extractLandSurface(summary);

  const bedrooms =
    extractBedrooms(summary);

  const bathrooms =
    extractBathrooms(summary);

  const rooms =
    extractRooms(summary);

  const location =
    extractListingLocation(
      summary,
      criteria,
    );

  const garden =
    detectFeature(
      markdown,
      [
        "garden",
        "jardin",
        "garten",
        "jardín",
        "jardin privado",
        "giardino",
        "tuin",
      ],
    );

  const garage =
    detectFeature(
      markdown,
      [
        "garage",
        "garage fermé",
        "garage ferme",
        "garaje",
        "garage privato",
      ],
    );

  const pool =
    detectFeature(
      markdown,
      [
        "pool",
        "swimming pool",
        "piscine",
        "piscina",
        "schwimmbad",
      ],
    );

  const terrace =
    detectFeature(
      markdown,
      [
        "terrace",
        "terrasse",
        "terraza",
        "terrazza",
      ],
    );

  const parking =
    detectFeature(
      markdown,
      [
        "parking",
        "carport",
        "stellplatz",
      ],
    );

  const dpe =
    extractDpe(markdown);

  const images =
    extractImagesFromScrape(
      scrape,
    ).slice(
      0,
      12,
    );

  const publishedPricePerM2 =
    extractPricePerM2(
      summary,
    );

  const pricePerM2 =
    publishedPricePerM2 ??
    (
      price &&
      surface &&
      surface > 0
        ? Math.round(
            price / surface,
          )
        : undefined
    );

  const propertyKind =
    detectPropertyKind(
      markdown,
      title,
      criteria.propertyType,
    );

  const scores =
    calculateBaseScores(
      {
        price,
        surface,
        bedrooms,
        bathrooms,
        location,
        garden,
        garage,
        pool,
        terrace,
        parking,
        dpe,
        pricePerM2,
        images,
        propertyKind,
      },
      criteria,
    );

  return {
    id: `listing-${index}`,

    url:
      candidate.url,

    source:
      candidate.source,

    parentSource:
      candidate.parentSource,

    title,
    description,

    price,

    currency:
      criteria.currency,

    surface,
    landSurface,

    bedrooms,
    bathrooms,
    rooms,

    location,

    garden,
    garage,
    pool,
    terrace,
    parking,

    dpe,

    images,

    pricePerM2,

    propertyKind,

    matchScore:
      scores.matchScore,

    valueScore:
      scores.valueScore,

    orbitScore:
      scores.orbitScore,

    reasons:
      scores.reasons,

    compromises:
      scores.compromises,

    extractedAt:
      new Date().toISOString(),
  };
}

function isPriceActuallyAddressZip(
  price: number,
  title: string,
) {
  if (
    price < 10000 ||
    price > 99999
  ) {
    return false;
  }

  const zipMatches =
    title.match(
      /\b\d{5}(?:-\d{4})?\b/g,
    ) ?? [];

  return zipMatches.some(
    (zip) =>
      Number(
        zip.slice(
          0,
          5,
        ),
      ) === price,
  );
}

type PriceCandidate = {
  value: number;
  currency?: string;
  context: string;
  confidence: number;
};

function extractPriceFromScrape(
  scrape: FirecrawlScrapeResponse,
  criteria: SearchIntent,
) {
  const markdown =
    scrape.data?.markdown ??
    "";

  const html =
    scrape.data?.html ??
    scrape.data?.rawHtml ??
    "";

  const metadata =
    scrape.data?.metadata;

  const candidates: PriceCandidate[] =
    [];

  /*
   * 1. Structured data is the strongest signal.
   */
  if (html) {
    candidates.push(
      ...extractStructuredPriceCandidates(
        html,
      ),
    );
  }

  /*
   * 2. Visible HTML text. This catches pages where the price is
   * rendered as:
   *   <div>Price</div><span>€ 1 623 000</span>
   * which a markdown-only parser can miss.
   */
  if (html) {
    const visibleText =
      htmlToSearchableText(
        html,
      );

    candidates.push(
      ...extractCurrencyPriceCandidates(
        visibleText,
        82,
      ),
    );
  }

  /*
   * 3. Markdown remains useful on portals Firecrawl parses well.
   */
  candidates.push(
    ...extractCurrencyPriceCandidates(
      markdown,
      78,
    ),
  );

  /*
   * 4. Metadata can occasionally contain a price in title/description.
   */
  const metadataText =
    [
      metadata?.title,
      metadata?.description,
    ]
      .filter(
        (
          value,
        ): value is string =>
          typeof value ===
          "string",
      )
      .join(" ");

  if (metadataText) {
    candidates.push(
      ...extractCurrencyPriceCandidates(
        metadataText,
        70,
      ),
    );
  }

  return chooseBestPropertyPrice(
    candidates,
    criteria,
  );
}

function extractStructuredPriceCandidates(
  html: string,
) {
  const candidates:
    PriceCandidate[] =
    [];

  /*
   * JSON-LD:
   * offers.price, price, lowPrice, highPrice.
   */
  const jsonLdRegex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match:
    | RegExpExecArray
    | null;

  while (
    (match =
      jsonLdRegex.exec(html))
  ) {
    try {
      const parsed =
        JSON.parse(
          decodeHtmlEntities(
            match[1],
          ),
        );

      collectStructuredPrices(
        parsed,
        candidates,
      );
    } catch {
      // Ignore malformed JSON-LD.
    }
  }

  /*
   * Schema / OpenGraph style price metadata.
   */
  const metaPatterns = [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:product:price:amount|og:price:amount|price)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["'](?:product:price:amount|og:price:amount|price)["'][^>]*>/gi,
  ];

  for (
    const pattern of
    metaPatterns
  ) {
    let metaMatch:
      | RegExpExecArray
      | null;

    while (
      (metaMatch =
        pattern.exec(html))
    ) {
      const value =
        parseMoney(
          metaMatch[1],
        );

      if (
        value &&
        isPlausiblePropertyPrice(
          value,
        )
      ) {
        candidates.push({
          value,
          context:
            metaMatch[0],
          confidence: 96,
        });
      }
    }
  }

  return candidates;
}

function collectStructuredPrices(
  value: unknown,
  output: PriceCandidate[],
  inheritedCurrency?: string,
) {
  if (
    Array.isArray(value)
  ) {
    for (const item of value) {
      collectStructuredPrices(
        item,
        output,
        inheritedCurrency,
      );
    }

    return;
  }

  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return;
  }

  const record =
    value as Record<
      string,
      unknown
    >;

  const currency =
    typeof record.priceCurrency ===
      "string"
      ? record.priceCurrency
      : inheritedCurrency;

  const priceKeys = [
    "price",
    "lowPrice",
    "highPrice",
  ];

  for (
    const key of priceKeys
  ) {
    const raw =
      record[key];

    if (
      typeof raw ===
        "string" ||
      typeof raw ===
        "number"
    ) {
      const parsed =
        parseMoney(
          String(raw),
        );

      if (
        parsed &&
        isPlausiblePropertyPrice(
          parsed,
        )
      ) {
        output.push({
          value: parsed,
          currency,
          context:
            `JSON-LD ${key}`,
          confidence:
            key === "price"
              ? 100
              : 88,
        });
      }
    }
  }

  for (
    const nested of
    Object.values(record)
  ) {
    if (
      nested &&
      typeof nested ===
        "object"
    ) {
      collectStructuredPrices(
        nested,
        output,
        currency,
      );
    }
  }
}

function extractCurrencyPriceCandidates(
  text: string,
  baseConfidence: number,
) {
  const normalized =
    decodeHtmlEntities(
      text,
    )
      .replace(
        /\u00A0|\u202F/g,
        " ",
      );

  const candidates:
    PriceCandidate[] =
    [];

  /*
   * STRICT MONEY AMOUNT
   *
   * The old regexp was too greedy and could swallow the next
   * property field, for example:
   *
   *   "$1,620,000 4 bedrooms"
   *          ↓
   *   16,200,004   (WRONG)
   *
   * This grammar accepts only complete grouped money amounts.
   */
  const amount =
    String.raw`(?:\d{1,3}(?:[,. ]\d{3}){1,3}|\d{5,9})`;

  const definitions: Array<{
    regex: RegExp;
    currency: string;
  }> = [
    {
      regex:
        new RegExp(
          `(?:US\\$|USD|\\$)\\s*(${amount})(?![\\d,.])`,
          "gi",
        ),
      currency: "USD",
    },
    {
      regex:
        new RegExp(
          `(${amount})(?![\\d,.])\\s*(?:US\\$|USD|\\$)`,
          "gi",
        ),
      currency: "USD",
    },
    {
      regex:
        new RegExp(
          `(?:EUR|€)\\s*(${amount})(?![\\d,.])`,
          "gi",
        ),
      currency: "EUR",
    },
    {
      regex:
        new RegExp(
          `(${amount})(?![\\d,.])\\s*(?:EUR|€)`,
          "gi",
        ),
      currency: "EUR",
    },
    {
      regex:
        new RegExp(
          `(?:GBP|£)\\s*(${amount})(?![\\d,.])`,
          "gi",
        ),
      currency: "GBP",
    },
    {
      regex:
        new RegExp(
          `(${amount})(?![\\d,.])\\s*(?:GBP|£)`,
          "gi",
        ),
      currency: "GBP",
    },
    {
      regex:
        new RegExp(
          `(?:CHF)\\s*(${amount})(?![\\d,.])`,
          "gi",
        ),
      currency: "CHF",
    },
    {
      regex:
        new RegExp(
          `(${amount})(?![\\d,.])\\s*CHF`,
          "gi",
        ),
      currency: "CHF",
    },
    {
      regex:
        new RegExp(
          `(?:CAD|C\\$)\\s*(${amount})(?![\\d,.])`,
          "gi",
        ),
      currency: "CAD",
    },
    {
      regex:
        new RegExp(
          `(${amount})(?![\\d,.])\\s*(?:CAD|C\\$)`,
          "gi",
        ),
      currency: "CAD",
    },
  ];

  for (
    const {
      regex,
      currency,
    } of definitions
  ) {
    let match:
      | RegExpExecArray
      | null;

    while (
      (match =
        regex.exec(normalized))
    ) {
      const value =
        parseMoney(
          match[1],
        );

      if (
        !value ||
        !isPlausiblePropertyPrice(
          value,
        )
      ) {
        continue;
      }

      const context =
        normalized.slice(
          Math.max(
            0,
            match.index - 100,
          ),
          Math.min(
            normalized.length,
            match.index +
              match[0].length +
              100,
          ),
        );

      let confidence =
        baseConfidence;

      if (
        /\b(?:price|prix|asking|sale price|precio|prezzo|kaufpreis|purchase price)\b/i.test(
          context,
        )
      ) {
        confidence += 16;
      }

      if (
        /\b(?:mortgage|monthly|month|mois|per month|hoa|tax|fees?|commission|deposit|rent)\b/i.test(
          context,
        )
      ) {
        confidence -= 30;
      }

      candidates.push({
        value,
        currency,
        context,
        confidence,
      });
    }
  }

  return candidates;
}

function chooseBestPropertyPrice(
  candidates: PriceCandidate[],
  criteria: SearchIntent,
) {
  if (
    candidates.length === 0
  ) {
    return undefined;
  }

  const grouped =
    new Map<
      number,
      {
        value: number;
        score: number;
        occurrences: number;
        currencyMatches: number;
      }
    >();

  for (
    const candidate of
    candidates
  ) {
    if (
      !isPlausiblePropertyPrice(
        candidate.value,
      )
    ) {
      continue;
    }

    const current =
      grouped.get(
        candidate.value,
      ) ?? {
        value:
          candidate.value,
        score: 0,
        occurrences: 0,
        currencyMatches: 0,
      };

    current.score +=
      candidate.confidence;

    current.occurrences +=
      1;

    if (
      criteria.currency &&
      candidate.currency ===
        criteria.currency
    ) {
      current.score += 12;
      current.currencyMatches +=
        1;
    }

    if (
      criteria.budgetMax &&
      candidate.value >
        criteria.budgetMax * 1.5
    ) {
      current.score -= 45;
    }

    grouped.set(
      candidate.value,
      current,
    );
  }

  const ranked =
    Array.from(
      grouped.values(),
    )
      .map((item) => ({
        ...item,
        score:
          item.score +
          Math.min(
            35,
            (item.occurrences -
              1) *
              9,
          ),
      }))
      .sort(
        (a, b) =>
          b.score -
          a.score,
      );

  return ranked[0]?.value;
}

function isPlausiblePropertyPrice(
  value: number,
) {
  return (
    Number.isFinite(value) &&
    value >= 10000 &&
    value <= 1000000000
  );
}

function htmlToSearchableText(
  html: string,
) {
  return decodeHtmlEntities(
    html
      .replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi,
        " ",
      )
      .replace(
        /<style\b[^>]*>[\s\S]*?<\/style>/gi,
        " ",
      )
      .replace(
        /<[^>]+>/g,
        " ",
      )
      .replace(
        /\s+/g,
        " ",
      ),
  ).trim();
}

function extractPrice(
  text: string,
) {
  /*
   * IMPORTANT:
   * Never interpret a bare 5-digit number as a property price.
   *
   * US real-estate snippets contain ZIP codes such as 33157.
   * The old extractor could accidentally read:
   *   "... price ... Miami, FL 33157"
   * as $33,157.
   *
   * A valid price must now have a real currency marker or a
   * very explicit "list price / asking price" expression.
   */

  const strongPatterns = [
    /* USD */
    /(?:US\$|USD|\$)\s*([\d][\d,. \u00A0\u202F]{3,})/i,
    /([\d][\d,. \u00A0\u202F]{3,})\s*(?:US\$|USD|\$)\b/i,

    /* EUR */
    /(?:EUR|€)\s*([\d][\d,. \u00A0\u202F]{3,})/i,
    /([\d][\d,. \u00A0\u202F]{3,})\s*(?:EUR|€)\b/i,

    /* GBP */
    /(?:GBP|£)\s*([\d][\d,. \u00A0\u202F]{3,})/i,
    /([\d][\d,. \u00A0\u202F]{3,})\s*(?:GBP|£)\b/i,

    /* CHF */
    /(?:CHF)\s*([\d][\d,. \u00A0\u202F]{3,})/i,
    /([\d][\d,. \u00A0\u202F]{3,})\s*CHF\b/i,

    /* CAD */
    /(?:CAD|C\$)\s*([\d][\d,. \u00A0\u202F]{3,})/i,
    /([\d][\d,. \u00A0\u202F]{3,})\s*(?:CAD|C\$)\b/i,

    /* Explicit labels with currency */
    /(?:list\s+price|asking\s+price|sale\s+price|prix\s+de\s+vente|prix)\s*[:\-]?\s*(?:US\$|USD|\$|EUR|€|GBP|£|CHF|CAD|C\$)\s*([\d][\d,. \u00A0\u202F]{3,})/i,

    /(?:list\s+price|asking\s+price|sale\s+price|prix\s+de\s+vente|prix)\s*[:\-]?\s*([\d][\d,. \u00A0\u202F]{3,})\s*(?:US\$|USD|\$|EUR|€|GBP|£|CHF|CAD|C\$)\b/i,
  ];

  for (
    const pattern of
    strongPatterns
  ) {
    const match =
      text.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const value =
      parseMoney(
        match[1],
      );

    if (
      !value ||
      value < 10000 ||
      value > 1000000000
    ) {
      continue;
    }

    /*
     * Defensive protection against US ZIP codes accidentally
     * entering a currency expression through malformed snippets.
     */
    if (
      isLikelyUSZipCode(
        value,
        match[0],
      )
    ) {
      continue;
    }

    return value;
  }

  return undefined;
}

function isLikelyUSZipCode(
  value: number,
  matchedText: string,
) {
  if (
    value < 10000 ||
    value > 99999
  ) {
    return false;
  }

  /*
   * If the match has a genuine currency sign immediately around
   * the value, we accept it. "$33,000" can theoretically be real.
   * What we reject is a bare five-digit value captured from an
   * address/ZIP context.
   */
  const hasCurrency =
    /(?:US\$|USD|\$|EUR|€|GBP|£|CHF|CAD|C\$)/i.test(
      matchedText,
    );

  return !hasCurrency;
}

function extractPricePerM2(
  text: string,
) {
  const patterns = [
    /([\d\s,.]+)\s*(?:€|\$|£|CHF)\s*\/\s*(?:m²|m2|sqm)/i,
    /([\d\s,.]+)\s*(?:€|\$|£|CHF)\s+per\s+(?:m²|sqm)/i,
  ];

  for (const pattern of patterns) {
    const match =
      text.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const value =
      parseMoney(
        match[1],
      );

    if (
      value &&
      value >= 100 &&
      value <= 200000
    ) {
      return value;
    }
  }

  return undefined;
}

function extractSurface(
  text: string,
) {
  const structured = [
    /(?:living area|living space|interior|surface habitable|wohnfläche|wohnflaeche|superficie|área útil|area utile)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(?:m²|m2|sqm)/i,

    /\b\d+\s*(?:rooms?|pi[eè]ces?|pcs?)\s+\d+\s*(?:beds?|bedrooms?|chambres?|ch)\s+(\d+(?:[.,]\d+)?)\s*(?:m²|m2|㎡|sqm)\b/i,

    /\b(\d+(?:[.,]\d+)?)\s*(?:m²|m2|㎡|sqm)\s+(?:living|interior|habitable)/i,
  ];

  for (const pattern of structured) {
    const match =
      text.match(pattern);

    if (match?.[1]) {
      const value =
        parseDecimal(
          match[1],
        );

      if (
        value &&
        value >= 10 &&
        value <= 5000
      ) {
        return value;
      }
    }
  }

  /*
   * Square feet are converted to square metres.
   */
  const sqft =
    text.match(
      /(?:living area|interior|living space)?[\s:]*([\d,]+)\s*(?:sq\.?\s*ft|sqft|square feet)/i,
    );

  if (sqft?.[1]) {
    const feet =
      Number(
        sqft[1].replace(
          /,/g,
          "",
        ),
      );

    if (
      Number.isFinite(feet) &&
      feet >= 100
    ) {
      return round1(
        feet * 0.092903,
      );
    }
  }

  const regex =
    /(\d+(?:[.,]\d+)?)\s*(?:m²|m2|㎡|sqm)\b/gi;

  let match:
    | RegExpExecArray
    | null;

  while (
    (match =
      regex.exec(text))
  ) {
    const value =
      parseDecimal(
        match[1],
      );

    if (
      !value ||
      value < 10 ||
      value > 5000
    ) {
      continue;
    }

    const context =
      text
        .slice(
          Math.max(
            0,
            match.index - 90,
          ),
          Math.min(
            text.length,
            match.index + 120,
          ),
        )
        .toLowerCase();

    if (
      /land|lot|terrain|parcelle|garden|jardin|grundstück|grundstuck|plot|terreno/.test(
        context,
      )
    ) {
      continue;
    }

    if (
      /\/\s*(?:m²|m2|sqm)/.test(
        context,
      )
    ) {
      continue;
    }

    return value;
  }

  return undefined;
}

function extractLandSurface(
  text: string,
) {
  const patterns = [
    /(?:land|lot|plot|terrain|parcelle|grundstück|grundstuck|terreno)\s*(?:area|size|surface)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(?:m²|m2|sqm)/i,

    /(\d+(?:[.,]\d+)?)\s*(?:m²|m2|sqm)\s+(?:of land|de terrain|grundstück|terreno)/i,
  ];

  for (const pattern of patterns) {
    const match =
      text.match(pattern);

    if (match?.[1]) {
      const value =
        parseDecimal(
          match[1],
        );

      if (
        value &&
        value >= 20 &&
        value <= 1000000
      ) {
        return value;
      }
    }
  }

  return undefined;
}

function extractBedrooms(
  text: string,
) {
  const patterns = [
    /\b(\d+)\s*(?:bedrooms?|beds?|chambres?|ch\b|schlafzimmer|habitaciones?|dormitorios?|quartos?|camere da letto)\b/i,

    /(?:bedrooms?|chambres?|schlafzimmer|habitaciones?|dormitorios?|quartos?|camere da letto)\s*[:\-]?\s*(\d+)\b/i,
  ];

  return extractInteger(
    text,
    patterns,
    0,
    30,
  );
}

function extractBathrooms(
  text: string,
) {
  const patterns = [
    /\b(\d+)\s*(?:bathrooms?|baths?|salles?\s+de\s+bain|badezimmer|baños?|banos?|bagni)\b/i,

    /(?:bathrooms?|baths?|salles?\s+de\s+bain|badezimmer|baños?|banos?|bagni)\s*[:\-]?\s*(\d+)\b/i,
  ];

  return extractInteger(
    text,
    patterns,
    0,
    30,
  );
}

function extractRooms(
  text: string,
) {
  const patterns = [
    /\b(\d+)\s*(?:rooms?|pi[eè]ces?|pcs?|zimmer|stanza|stanze)\b/i,
  ];

  return extractInteger(
    text,
    patterns,
    1,
    50,
  );
}

function extractListingLocation(
  text: string,
  criteria: SearchIntent,
) {
  if (
    criteria.city &&
    text
      .toLowerCase()
      .includes(
        criteria.city.toLowerCase(),
      )
  ) {
    return buildLocationString(
      criteria.city,
      criteria.region,
      criteria.country,
    );
  }

  const patterns = [
    /(?:location|address|adresse|ubicación|ubicacion|standort)\s*[:\-]\s*([^\n]{3,100})/i,
  ];

  for (const pattern of patterns) {
    const match =
      text.match(pattern);

    if (match?.[1]) {
      return cleanupText(
        match[1],
      ).slice(0, 120);
    }
  }

  return criteria.location;
}

function extractDpe(
  text: string,
) {
  const patterns = [
    /\bDPE\s*[:\-]?\s*([A-G])\b/i,
    /energy\s+(?:class|rating)\s*[:\-]?\s*([A-G])\b/i,
    /energieklasse\s*[:\-]?\s*([A-G])\b/i,
  ];

  for (const pattern of patterns) {
    const match =
      text.match(pattern);

    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  return undefined;
}

function detectFeature(
  text: string,
  keywords: string[],
) {
  const lower =
    text.toLowerCase();

  return keywords.some(
    (keyword) =>
      lower.includes(
        keyword.toLowerCase(),
      ),
  );
}

function detectPropertyKind(
  text: string,
  title: string,
  requested?: string,
): PropertyKind {
  const combined =
    `${title} ${text}`
      .toLowerCase();

  if (
    /new build|new construction|projet de construction|maison à construire|neubau/.test(
      combined,
    )
  ) {
    return "new_build_project";
  }

  if (
    requested === "villa" ||
    /\bvilla\b/.test(combined)
  ) {
    return "villa";
  }

  if (
    requested === "apartment" ||
    /\bapartment\b|\bappartement\b|\bwohnung\b|\bapartamento\b/.test(
      combined,
    )
  ) {
    return "apartment";
  }

  if (
    /\bhouse\b|\bmaison\b|\bhaus\b|\bcasa\b|\bterraced\b|\bsemi-detached\b|\bdetached\b|\btownhouse\b|\bbungalow\b|\bcottage\b/.test(
      combined,
    )
  ) {
    return "existing_house";
  }

  return "unknown";
}

function extractImagesFromScrape(
  scrape: FirecrawlScrapeResponse,
) {
  const images: string[] = [];

  const markdown =
    scrape.data?.markdown ??
    "";

  const html =
    scrape.data?.html ??
    scrape.data?.rawHtml ??
    "";

  const metadata =
    scrape.data?.metadata;

  if (html) {
    images.push(
      ...extractPrimaryPropertyImagesFromHtml(
        html,
      ),
    );
  }

  images.push(
    ...extractImagesFromMetadata(
      metadata,
    ),
  );

  images.push(
    ...(scrape.data?.images ?? []),
  );

  images.push(
    ...extractImagesFromMarkdown(
      markdown,
    ),
  );

  if (html) {
    images.push(
      ...extractImagesFromHtml(
        html,
      ),
    );
  }

  return rankPropertyImages(
    cleanImageList(
      images,
    ),
  );
}

function extractImagesFromMarkdown(
  markdown: string,
) {
  const regex =
    /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;

  const images: string[] =
    [];

  let match:
    | RegExpExecArray
    | null;

  while (
    (match =
      regex.exec(markdown))
  ) {
    if (match[1]) {
      images.push(
        decodeHtmlEntities(
          match[1],
        ),
      );
    }
  }

  return images;
}

function extractImagesFromMetadata(
  metadata:
    | NonNullable<
        FirecrawlScrapeResponse["data"]
      >["metadata"]
    | undefined,
) {
  if (!metadata) {
    return [];
  }

  const possibleKeys = [
    "ogImage",
    "og_image",
    "og:image",
    "twitterImage",
    "twitter_image",
    "twitter:image",
    "image",
  ];

  const images: string[] =
    [];

  for (
    const key of possibleKeys
  ) {
    const value =
      metadata[key];

    if (
      typeof value ===
      "string"
    ) {
      images.push(value);
    }

    if (
      Array.isArray(value)
    ) {
      for (const item of value) {
        if (
          typeof item ===
          "string"
        ) {
          images.push(item);
        }
      }
    }
  }

  return images;
}

function extractImagesFromHtml(
  html: string,
) {
  const images: string[] =
    [];

  /*
   * OpenGraph / Twitter / link rel image:
   * these are often available even on JS-heavy property portals.
   */
  const metaPatterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/gi,

    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/gi,

    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/gi,
  ];

  for (
    const pattern of
    metaPatterns
  ) {
    let match:
      | RegExpExecArray
      | null;

    while (
      (match =
        pattern.exec(html))
    ) {
      if (match[1]) {
        images.push(
          decodeHtmlEntities(
            match[1],
          ),
        );
      }
    }
  }

  /*
   * JSON-LD property data frequently contains:
   * "image": "...",
   * "image": ["...", "..."]
   */
  const jsonLdRegex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let jsonMatch:
    | RegExpExecArray
    | null;

  while (
    (jsonMatch =
      jsonLdRegex.exec(html))
  ) {
    const block =
      jsonMatch[1];

    try {
      const parsed =
        JSON.parse(
          decodeHtmlEntities(
            block,
          ),
        );

      collectJsonLdImages(
        parsed,
        images,
      );
    } catch {
      const looseMatches =
        block.match(
          /https?:\\?\/\\?\/[^"'\\\s]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\\s]*)?/gi,
        ) ?? [];

      images.push(
        ...looseMatches.map(
          (value) =>
            value.replace(
              /\\\//g,
              "/",
            ),
        ),
      );
    }
  }

  /*
   * Lazy-loaded / normal image attributes.
   */
  const attributeRegex =
    /<(?:img|source)[^>]+(?:src|data-src|data-lazy-src|data-original)=["'](https?:\/\/[^"']+)["'][^>]*>/gi;

  let attrMatch:
    | RegExpExecArray
    | null;

  while (
    (attrMatch =
      attributeRegex.exec(html))
  ) {
    if (attrMatch[1]) {
      images.push(
        decodeHtmlEntities(
          attrMatch[1],
        ),
      );
    }
  }

  /*
   * srcset can contain multiple resolutions.
   */
  const srcsetRegex =
    /(?:srcset|data-srcset)=["']([^"']+)["']/gi;

  let srcsetMatch:
    | RegExpExecArray
    | null;

  while (
    (srcsetMatch =
      srcsetRegex.exec(html))
  ) {
    const entries =
      srcsetMatch[1]
        .split(",")
        .map(
          (entry) =>
            entry
              .trim()
              .split(/\s+/)[0],
        )
        .filter(Boolean);

    images.push(
      ...entries,
    );
  }

  return images;
}

function extractPortalPropertyImages(
  html: string,
  pageUrl: string,
) {
  const domain =
    getDomain(pageUrl);

  const urls =
    extractAllHttpImageUrls(
      html,
    );

  const preferredHosts: Record<
    string,
    string[]
  > = {
    "rightmove.co.uk": [
      "media.rightmove.co.uk",
    ],

    "zoopla.co.uk": [
      "lc.zoocdn.com",
      "images.zoopla.co.uk",
    ],

    "onthemarket.com": [
      "media.onthemarket.com",
    ],

    "zillow.com": [
      "photos.zillowstatic.com",
    ],

    "realtor.com": [
      "ap.rdcpix.com",
    ],

    "redfin.com": [
      "cdn-redfin.com/photo",
    ],

    "homes.com": [
      "images.homes.com",
    ],

    "spain-real.estate": [
      "spain-real.estate",
    ],

    "idealista.com": [
      "img4.idealista.com",
      "img3.idealista.com",
      "img2.idealista.com",
    ],
  };

  const hosts =
    preferredHosts[domain] ??
    [];

  const preferred =
    urls.filter(
      (image) =>
        hosts.some(
          (host) =>
            image
              .toLowerCase()
              .includes(
                host.toLowerCase(),
              ),
        ),
    );

  return [
    ...preferred,
    ...urls.filter(
      (image) =>
        !preferred.includes(
          image,
        ),
    ),
  ].filter(
    isLikelyPropertyImage,
  );
}

function extractAllHttpImageUrls(
  html: string,
) {
  const regex =
    /https?:\\?\/\\?\/[^"'<>\\\s]+?(?:jpg|jpeg|png|webp)(?:\?[^"'<>\\\s]*)?/gi;

  const matches =
    html.match(regex) ??
    [];

  return Array.from(
    new Set(
      matches.map(
        (value) =>
          decodeHtmlEntities(
            value.replace(
              /\\\//g,
              "/",
            ),
          ),
      ),
    ),
  );
}

function extractPrimaryPropertyImagesFromHtml(
  html: string,
) {
  const images: string[] =
    [];

  const ogPatterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/gi,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
  ];

  for (
    const pattern of ogPatterns
  ) {
    let match:
      | RegExpExecArray
      | null;

    while (
      (match =
        pattern.exec(html))
    ) {
      if (match[1]) {
        images.push(
          decodeHtmlEntities(
            match[1],
          ),
        );
      }
    }
  }

  const imgRegex =
    /<img\b[^>]*>/gi;

  let tag:
    | RegExpExecArray
    | null;

  while (
    (tag =
      imgRegex.exec(html))
  ) {
    const htmlTag =
      tag[0];

    const src =
      htmlTag.match(
        /(?:src|data-src|data-lazy-src|data-original)=["'](https?:\/\/[^"']+)["']/i,
      )?.[1];

    if (!src) {
      continue;
    }

    const lower =
      htmlTag.toLowerCase();

    const width =
      Number(
        htmlTag.match(
          /\bwidth=["']?(\d+)/i,
        )?.[1] ?? 0,
      );

    const height =
      Number(
        htmlTag.match(
          /\bheight=["']?(\d+)/i,
        )?.[1] ?? 0,
      );

    const propertySignal =
      /gallery|hero|property|listing|carousel|photo|main-image|main_image/.test(
        lower,
      );

    if (
      propertySignal ||
      width >= 500 ||
      height >= 350
    ) {
      images.push(
        decodeHtmlEntities(src),
      );
    }
  }

  return cleanImageList(images);
}

function scorePropertyImage(
  image: string,
) {
  const lower =
    image.toLowerCase();

  let score = 0;

  for (
    const word of [
      "property",
      "listing",
      "photo",
      "gallery",
      "media",
      "cdn",
      "large",
      "hero",
      "original",
    ]
  ) {
    if (
      lower.includes(word)
    ) {
      score += 3;
    }
  }

  for (
    const word of [
      "logo",
      "brand",
      "avatar",
      "profile",
      "icon",
      "sprite",
      "placeholder",
      "banner",
      "advert",
      "marketing",
      "default",
      "social",
      "favicon",
      "homepage",
      "header",
      "sitewide",
    ]
  ) {
    if (
      lower.includes(word)
    ) {
      score -= 15;
    }
  }

  if (
    /\.(jpg|jpeg|webp|png)(?:\?|$)/i.test(
      image,
    )
  ) {
    score += 5;
  }

  const trustedPropertyCdnSignals = [
    "media.rightmove.co.uk",
    "lc.zoocdn.com",
    "media.onthemarket.com",
    "photos.zillowstatic.com",
    "ap.rdcpix.com",
    "cdn-redfin.com/photo",
    "images.homes.com",
    "idealista.com",
    "spain-real.estate",
  ];

  if (
    trustedPropertyCdnSignals.some(
      (signal) =>
        lower.includes(signal),
    )
  ) {
    score += 40;
  }

  return score;
}

function rankPropertyImages(
  images: string[],
) {
  return Array.from(
    new Set(images),
  )
    .filter(
      isLikelyPropertyImage,
    )
    .sort(
      (a, b) =>
        scorePropertyImage(b) -
        scorePropertyImage(a),
    );
}

function collectJsonLdImages(
  value: unknown,
  output: string[],
) {
  if (
    typeof value === "string"
  ) {
    if (
      /^https?:\/\//i.test(
        value,
      ) &&
      /\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(
        value,
      )
    ) {
      output.push(value);
    }

    return;
  }

  if (
    Array.isArray(value)
  ) {
    for (const item of value) {
      collectJsonLdImages(
        item,
        output,
      );
    }

    return;
  }

  if (
    value &&
    typeof value ===
      "object"
  ) {
    const record =
      value as Record<
        string,
        unknown
      >;

    const imageKeys = [
      "image",
      "photo",
      "photos",
      "thumbnail",
      "thumbnailUrl",
      "contentUrl",
    ];

    for (
      const key of imageKeys
    ) {
      if (
        key in record
      ) {
        collectJsonLdImages(
          record[key],
          output,
        );
      }
    }

    /*
     * Nested objects can hold the image deeper in schema.org data.
     */
    for (
      const nested of
      Object.values(record)
    ) {
      if (
        nested &&
        typeof nested ===
          "object"
      ) {
        collectJsonLdImages(
          nested,
          output,
        );
      }
    }
  }
}

function cleanImageList(
  images: string[],
) {
  const clean =
    images
      .map((image) =>
        decodeHtmlEntities(
          image,
        )
          .replace(
            /\\u0026/g,
            "&",
          )
          .replace(
            /\\\//g,
            "/",
          )
          .trim(),
      )
      .filter(
        (image) =>
          image.startsWith(
            "http",
          ),
      )
      .filter(
        isLikelyPropertyImage,
      );

  return Array.from(
    new Set(clean),
  );
}

function decodeHtmlEntities(
  value: string,
) {
  return value
    .replace(
      /&amp;/g,
      "&",
    )
    .replace(
      /&quot;/g,
      '"',
    )
    .replace(
      /&#39;/g,
      "'",
    )
    .replace(
      /&lt;/g,
      "<",
    )
    .replace(
      /&gt;/g,
      ">",
    );
}

async function recoverMissingListingDetails(
  listings: StructuredListing[],
  criteria: SearchIntent,
) {
  /*
   * All recoveries run in parallel.
   * Each listing gets:
   * 1) direct page recovery;
   * 2) exact SearXNG lookup only when useful.
   */
  const jobs =
    listings.map(
      async (listing) => {
        if (
          !isStrongIndividualListingUrl(
            listing.url,
          )
        ) {
          return listing;
        }

        const directPromise =
          (
            listing.price ===
              undefined ||
            listing.images.length ===
              0 ||
            listing.bedrooms ===
              undefined ||
            listing.surface ===
              undefined
          )
            ? fetchPageDetails(
                listing.url,
                criteria,
              )
            : Promise.resolve(
                null,
              );

        const searchPromise =
          (
            listing.price ===
              undefined ||
            listing.images.length ===
              0
          )
            ? recoverListingFromExactSearch(
                listing,
                criteria,
              )
            : Promise.resolve(
                null,
              );

        const [
          direct,
          search,
        ] =
          await Promise.all([
            directPromise,
            searchPromise,
          ]);

        const recoveredPrice =
          chooseRecoveredPrice(
            [
              listing.price,
              direct?.price,
              search?.price,
            ],
            listing,
            criteria,
          );

        const recoveredImages =
          rankPropertyImages([
            ...(direct?.images ??
              []),
            ...(search?.images ??
              []),
            ...(listing.images ??
              []),
          ]).slice(
            0,
            12,
          );

        const recoveredBedrooms =
          listing.bedrooms ??
          direct?.bedrooms ??
          search?.bedrooms;

        const recoveredBathrooms =
          listing.bathrooms ??
          direct?.bathrooms ??
          search?.bathrooms;

        const recoveredSurface =
          listing.surface ??
          direct?.surface ??
          search?.surface;

        const recoveredLocation =
          listing.location ??
          direct?.location ??
          search?.location;

        return {
          ...listing,

          price:
            recoveredPrice,

          images:
            recoveredImages,

          bedrooms:
            recoveredBedrooms,

          bathrooms:
            recoveredBathrooms,

          surface:
            recoveredSurface,

          location:
            recoveredLocation,

          pricePerM2:
            recoveredPrice &&
            recoveredSurface
              ? Math.round(
                  recoveredPrice /
                    recoveredSurface,
                )
              : listing.pricePerM2,
        };
      },
    );

  return Promise.all(jobs);
}

function chooseRecoveredPrice(
  values: Array<
    number | undefined
  >,
  listing: StructuredListing,
  criteria: SearchIntent,
) {
  const candidates =
    values.filter(
      (
        value,
      ): value is number =>
        typeof value ===
          "number" &&
        Number.isFinite(value) &&
        value >= 10000 &&
        value <= 1000000000,
    );

  if (
    candidates.length === 0
  ) {
    return undefined;
  }

  /*
   * Existing validated price wins.
   */
  if (
    typeof listing.price ===
      "number" &&
    candidates.includes(
      listing.price,
    )
  ) {
    return listing.price;
  }

  /*
   * If two recovery channels agree approximately,
   * prefer that consensus.
   */
  for (
    let i = 0;
    i < candidates.length;
    i++
  ) {
    for (
      let j = i + 1;
      j < candidates.length;
      j++
    ) {
      const a =
        candidates[i];

      const b =
        candidates[j];

      const delta =
        Math.abs(a - b) /
        Math.max(a, b);

      if (
        delta <= 0.015
      ) {
        return Math.round(
          (a + b) / 2,
        );
      }
    }
  }

  /*
   * Otherwise use the first recovered amount.
   * The strict final budget validation runs afterwards.
   */
  return candidates[0];
}

type ExactSearchRecovery = {
  price?: number;
  images: string[];
  bedrooms?: number;
  bathrooms?: number;
  surface?: number;
  location?: string;
};

async function recoverListingFromExactSearch(
  listing: StructuredListing,
  criteria: SearchIntent,
): Promise<
  ExactSearchRecovery | null
> {
  try {
    const domain =
      getDomain(
        listing.url,
      );

    const exactTitle =
      cleanupText(
        listing.title,
      )
        .replace(
          /\s+/g,
          " ",
        )
        .slice(
          0,
          140,
        );

    if (!exactTitle) {
      return null;
    }

    const queryParts = [
      `"${exactTitle}"`,
      criteria.city,
      criteria.currency,
      "price",
      domain
        ? `site:${domain}`
        : undefined,
    ].filter(Boolean);

    const results =
      await searxngSearch(
        queryParts.join(" "),
      );

    if (
      results.length === 0
    ) {
      return null;
    }

    const sameDomain =
      results.filter(
        (result) =>
          result.url &&
          getDomain(
            result.url,
          ) === domain,
      );

    const pool =
      sameDomain.length > 0
        ? sameDomain
        : results;

    const best =
      pool
        .map(
          (result) => ({
            result,
            identityScore:
              scoreListingIdentity(
                listing,
                result,
              ),
          }),
        )
        .sort(
          (a, b) =>
            b.identityScore -
            a.identityScore,
        )[0];

    if (
      !best ||
      best.identityScore < 2
    ) {
      return null;
    }

    const text =
      cleanupText(
        `${best.result.title ?? ""} ${best.result.description ?? ""}`,
      );

    const price =
      extractPrice(text);

    const guardedPrice =
      applyPriceSafetyGuards(
        price,
        text,
        best.result.title ??
          listing.title,
        criteria,
        extractSurface(text),
      );

    const image =
      best.result.image;

    return {
      price:
        guardedPrice,

      images:
        image &&
        isLikelyPropertyImage(
          image,
        )
          ? [image]
          : [],

      bedrooms:
        extractBedrooms(
          text,
        ),

      bathrooms:
        extractBathrooms(
          text,
        ),

      surface:
        extractSurface(
          text,
        ),

      location:
        extractLocationFromSearchSnippet(
          best.result.title ??
            "",
          best.result.description ??
            "",
          criteria,
        ),
    };
  } catch {
    return null;
  }
}

function scoreListingIdentity(
  listing: StructuredListing,
  result: FirecrawlSearchResult,
) {
  const listingText =
    normalizeIdentityText(
      listing.title,
    );

  const resultText =
    normalizeIdentityText(
      `${result.title ?? ""} ${result.description ?? ""}`,
    );

  if (
    !listingText ||
    !resultText
  ) {
    return 0;
  }

  const tokens =
    listingText
      .split(" ")
      .filter(
        (token) =>
          token.length >= 3,
      )
      .slice(
        0,
        12,
      );

  let score = 0;

  for (
    const token of tokens
  ) {
    if (
      resultText.includes(
        token,
      )
    ) {
      score += 1;
    }
  }

  return score;
}

function normalizeIdentityText(
  value: string,
) {
  return cleanupText(
    value,
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .replace(
      /[^a-z0-9 ]+/g,
      " ",
    )
    .replace(
      /\s+/g,
      " ",
    )
    .trim();
}

type RecoveredPageDetails = {
  price?: number;
  images: string[];
  bedrooms?: number;
  bathrooms?: number;
  surface?: number;
  location?: string;
};

async function fetchPageDetails(
  url: string,
  criteria: SearchIntent,
): Promise<
  RecoveredPageDetails | null
> {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      3200,
    );

  try {
    const response =
      await fetch(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",

            Accept:
              "text/html,application/xhtml+xml",
          },

          redirect:
            "follow",

          signal:
            controller.signal,

          cache:
            "no-store",
        },
      );

    if (!response.ok) {
      return null;
    }

    const contentType =
      response.headers.get(
        "content-type",
      ) ?? "";

    if (
      !contentType.includes(
        "text/html",
      )
    ) {
      return null;
    }

    const html =
      (
        await response.text()
      ).slice(
        0,
        2_500_000,
      );

    const visible =
      htmlToSearchableText(
        html,
      );

    const priceCandidates = [
      ...extractStructuredPriceCandidates(
        html,
      ),
      ...extractCurrencyPriceCandidates(
        visible,
        86,
      ),
    ];

    const price =
      chooseBestPropertyPrice(
        priceCandidates,
        criteria,
      );

    const images =
      rankPropertyImages([
        ...extractPortalPropertyImages(
          html,
          url,
        ),
        ...extractPrimaryPropertyImagesFromHtml(
          html,
        ),
        ...extractImagesFromHtml(
          html,
        ),
      ]).slice(
        0,
        12,
      );

    return {
      price,
      images,

      bedrooms:
        extractBedrooms(
          visible,
        ),

      bathrooms:
        extractBathrooms(
          visible,
        ),

      surface:
        extractSurface(
          visible,
        ),

      location:
        extractListingLocation(
          visible,
          criteria,
        ),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPageImages(
  url: string,
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      2800,
    );

  try {
    const response =
      await fetch(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",

            Accept:
              "text/html,application/xhtml+xml",
          },

          redirect:
            "follow",

          signal:
            controller.signal,

          cache:
            "no-store",
        },
      );

    if (!response.ok) {
      return [];
    }

    const contentType =
      response.headers.get(
        "content-type",
      ) ?? "";

    if (
      !contentType.includes(
        "text/html",
      )
    ) {
      return [];
    }

    const html =
      await response.text();

    const clipped =
      html.slice(
        0,
        2_000_000,
      );

    return rankPropertyImages([
      ...extractPortalPropertyImages(
        clipped,
        url,
      ),
      ...extractPrimaryPropertyImagesFromHtml(
        clipped,
      ),
      ...extractImagesFromHtml(
        clipped,
      ),
    ]).slice(
      0,
      12,
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function isLikelyPropertyImage(
  url: string,
) {
  const text =
    url.toLowerCase();

  const blocked = [
    "logo",
    "icon",
    "avatar",
    "profile",
    "mapbox",
    "maps.googleapis",
    "banner",
    ".svg",
    "favicon",
    "sprite",
    "placeholder",
    "tracking",
    "pixel.gif",
    "spacer.gif",
    "badge",
    "brand",
    "marketing",
    "advert",
    "advertisement",
    "default-image",
    "default_image",
  ];

  if (
    blocked.some(
      (word) =>
        text.includes(word),
    )
  ) {
    return false;
  }

  /*
   * Search-engine thumbnails and major property CDNs are useful.
   * Do not require a file extension because many CDNs transform
   * images through extension-less URLs.
   */
  return (
    text.startsWith("http://") ||
    text.startsWith("https://")
  );
}

function extractTitle(
  markdown: string,
  metadataTitle?: string,
) {
  const heading =
    markdown.match(
      /^#\s+(.+)$/m,
    );

  if (
    heading?.[1] &&
    cleanupText(
      heading[1],
    ).length > 3
  ) {
    return cleanupText(
      heading[1],
    ).slice(0, 180);
  }

  if (metadataTitle) {
    return cleanupText(
      metadataTitle,
    ).slice(0, 180);
  }

  return "Property listing";
}

function extractDescription(
  markdown: string,
  metadataDescription?: string,
) {
  const cleaned =
    cleanupMarkdown(
      markdown,
    );

  if (
    cleaned.length >= 80
  ) {
    return cleaned.slice(
      0,
      700,
    );
  }

  return cleanupText(
    metadataDescription ?? "",
  ).slice(0, 700);
}

/* =========================================================
   COMPARISON ENGINE
========================================================= */

function calculateBaseScores(
  listing: {
    price?: number;
    surface?: number;
    bedrooms?: number;
    bathrooms?: number;
    location?: string;
    garden?: boolean;
    garage?: boolean;
    pool?: boolean;
    terrace?: boolean;
    parking?: boolean;
    dpe?: string;
    pricePerM2?: number;
    images?: string[];
    propertyKind: PropertyKind;
  },
  criteria: SearchIntent,
) {
  let matchScore = 35;
  let valueScore = 50;

  const reasons: string[] =
    [];

  const compromises: string[] =
    [];

  /* LOCATION = strongest criterion */

  if (criteria.city) {
    if (
      listing.location
        ?.toLowerCase()
        .includes(
          criteria.city.toLowerCase(),
        )
    ) {
      matchScore += 25;
      reasons.push(
        `Localisation ${criteria.city}`,
      );
    } else {
      matchScore -= 35;
      compromises.push(
        "Localisation exacte non confirmée",
      );
    }
  }

  /* DATA QUALITY / VISUAL CONFIDENCE */

  if (
    Array.isArray(
      (listing as { images?: string[] }).images,
    ) &&
    ((listing as { images?: string[] }).images?.length ?? 0) > 0
  ) {
    matchScore += 3;
    reasons.push(
      "Photo disponible",
    );
  }

  /* PROPERTY TYPE */

  if (
    criteria.propertyType
  ) {
    const typeMatch =
      propertyTypeMatches(
        listing.propertyKind,
        criteria.propertyType,
      );

    if (typeMatch) {
      matchScore += 12;
      reasons.push(
        "Type de bien correspondant",
      );
    } else if (
      listing.propertyKind !==
      "unknown"
    ) {
      matchScore -= 15;
      compromises.push(
        "Type de bien différent",
      );
    }
  }

  /* BUDGET */

  if (
    criteria.budgetMax &&
    listing.price
  ) {
    if (
      listing.price <=
      criteria.budgetMax
    ) {
      matchScore += 14;
      reasons.push(
        "Dans le budget",
      );
    } else {
      const over =
        (
          listing.price -
          criteria.budgetMax
        ) /
        criteria.budgetMax;

      matchScore -=
        Math.min(
          30,
          Math.max(
            10,
            Math.round(
              over * 100,
            ),
          ),
        );

      compromises.push(
        "Dépasse le budget",
      );
    }
  }

  /* SURFACE */

  if (
    criteria.minSurface &&
    listing.surface
  ) {
    if (
      listing.surface >=
      criteria.minSurface
    ) {
      matchScore += 10;
      reasons.push(
        "Surface minimum respectée",
      );
    } else {
      matchScore -= 15;
      compromises.push(
        `${round1(
          criteria.minSurface -
            listing.surface,
        )} m² sous le minimum`,
      );
    }
  }

  /* BEDROOMS */

  if (
    criteria.minBedrooms &&
    listing.bedrooms !==
      undefined
  ) {
    if (
      listing.bedrooms >=
      criteria.minBedrooms
    ) {
      matchScore += 10;
      reasons.push(
        "Nombre de chambres respecté",
      );
    } else {
      matchScore -= 18;
      compromises.push(
        "Pas assez de chambres",
      );
    }
  }

  /* BATHROOMS */

  if (
    criteria.minBathrooms &&
    listing.bathrooms !==
      undefined
  ) {
    if (
      listing.bathrooms >=
      criteria.minBathrooms
    ) {
      matchScore += 6;
    } else {
      matchScore -= 10;
      compromises.push(
        "Pas assez de salles de bain",
      );
    }
  }

  /* HARD REQUIREMENTS */

  for (
    const requirement of
    criteria.requirements
  ) {
    const matched =
      listingMatchesFeature(
        listing,
        requirement,
      );

    if (matched) {
      matchScore += 7;
      reasons.push(
        requirement,
      );
    } else {
      matchScore -= 9;
      compromises.push(
        `${requirement} non confirmé`,
      );
    }
  }

  /* PREFERENCES */

  for (
    const preference of
    criteria.preferences
  ) {
    if (
      listingMatchesFeature(
        listing,
        preference,
      )
    ) {
      matchScore += 3;
      reasons.push(
        preference,
      );
    }
  }

  /*
   * Value score will be refined after comparing all properties.
   */
  if (
    listing.dpe === "A" ||
    listing.dpe === "B"
  ) {
    valueScore += 5;
  }

  matchScore =
    clamp(
      Math.round(
        matchScore,
      ),
      0,
      100,
    );

  valueScore =
    clamp(
      Math.round(
        valueScore,
      ),
      0,
      100,
    );

  const orbitScore =
    Math.round(
      matchScore * 0.78 +
        valueScore * 0.22,
    );

  return {
    matchScore,
    valueScore,
    orbitScore,
    reasons:
      uniqueStrings(
        reasons,
      ).slice(0, 8),
    compromises:
      uniqueStrings(
        compromises,
      ).slice(0, 8),
  };
}

function applyRelativeComparison(
  listings: StructuredListing[],
  criteria: SearchIntent,
) {
  const pricesPerM2 =
    listings
      .map(
        (listing) =>
          listing.pricePerM2,
      )
      .filter(
        (
          value,
        ): value is number =>
          typeof value ===
          "number" &&
          value > 0,
      )
      .sort(
        (a, b) => a - b,
      );

  const median =
    medianNumber(
      pricesPerM2,
    );

  return listings.map(
    (listing) => {
      let valueScore =
        listing.valueScore;

      const reasons = [
        ...listing.reasons,
      ];

      const compromises = [
        ...listing.compromises,
      ];

      if (
        median &&
        listing.pricePerM2
      ) {
        const ratio =
          listing.pricePerM2 /
          median;

        if (ratio <= 0.82) {
          valueScore += 24;
          reasons.push(
            "Prix au m² nettement sous la médiane des résultats",
          );
        } else if (
          ratio <= 0.95
        ) {
          valueScore += 12;
          reasons.push(
            "Bon prix au m² face aux autres résultats",
          );
        } else if (
          ratio >= 1.25
        ) {
          valueScore -= 15;
          compromises.push(
            "Prix au m² élevé face aux autres résultats",
          );
        }
      }

      if (
        criteria.budgetMax &&
        listing.price &&
        listing.price <=
          criteria.budgetMax * 0.9
      ) {
        valueScore += 5;
      }

      valueScore =
        clamp(
          Math.round(
            valueScore,
          ),
          0,
          100,
        );

      const orbitScore =
        Math.round(
          listing.matchScore *
            0.76 +
            valueScore *
              0.24,
        );

      return {
        ...listing,
        valueScore,
        orbitScore,
        reasons:
          uniqueStrings(
            reasons,
          ).slice(0, 8),
        compromises:
          uniqueStrings(
            compromises,
          ).slice(0, 8),
      };
    },
  );
}

function isFinalVerifiedListing(
  listing: StructuredListing,
  criteria: SearchIntent,
) {
  /*
   * FINAL RULE 1 — it must be a real individual listing page.
   */
  if (
    !isStrongIndividualListingUrl(
      listing.url,
    ) ||
    looksLikeCategorySearchResult(
      listing.title,
      listing.description,
      listing.url,
    )
  ) {
    return false;
  }

  /*
   * FINAL RULE 2 — reject explicit foreign-country results.
   */
  if (
    !isCountryCompatible(
      listing,
      criteria,
    )
  ) {
    return false;
  }

  
  /*
   * ORBIT FLEXIBLE SEARCH MODE
   *
   * balanced = comportement normal :
   * les critères servent au classement mais ne suppriment
   * plus automatiquement une annonce.
   *
   * broad = encore plus permissif.
   *
   * strict = ancien comportement avec contraintes dures.
   */
  const __orbitSearchMode =
    String(
      (criteria as unknown as {
        searchMode?: string;
      }).searchMode ?? "balanced",
    ).toLowerCase();

  if (__orbitSearchMode === "strict") {
/*
   * FINAL RULE 3 — requested city must be present when the listing
   * explicitly exposes another place/country.
   */
  if (
    !isCityCompatible(
      listing,
      criteria,
    )
  ) {
    return false;
  }

  /*
   * FINAL RULE 4 — hard property type.
   */
  if (
    !isPropertyTypeCompatible(
      listing,
      criteria,
    )
  ) {
    return false;
  }

  /*
   * FINAL RULE 5 — if the user asked for minimum bedrooms,
   * ORBIT only shows listings where the bedroom count is known.
   */
  if (
    criteria.minBedrooms
  ) {
    if (
      listing.bedrooms ===
        undefined ||
      listing.bedrooms <
        criteria.minBedrooms
    ) {
      return false;
    }
  }

  /*
   * FINAL RULE 6 — same principle for minimum surface.
   */
  if (
    criteria.minSurface
  ) {
    if (
      listing.surface ===
        undefined ||
      listing.surface <
        criteria.minSurface
    ) {
      return false;
    }
  }

  /*
   * FINAL RULE 7 — with a maximum budget, price must be confirmed.
   * This removes "Prix non confirmé" cards from budget searches.
   */
  if (
    criteria.budgetMax
  ) {
    if (
      listing.price ===
        undefined ||
      listing.price >
        criteria.budgetMax
    ) {
      return false;
    }
  }

  /*
   * FINAL RULE 8 — if location exists, reuse normal geo rejection.
   */
  if (
    criteria.city
  ) {
    const geo =
      evaluateListingLocation(
        listing.location,
        listing.title,
        listing.description,
        criteria,
      );

    if (geo.reject) {
      return false;
    }
  }

  
  }

  /*
   * En balanced/broad :
   * les RULES 3 → 8 deviennent des préférences de scoring.
   * RULE 1 et RULE 2 restent actives :
   * - vraie annonce individuelle
   * - pas de pays explicitement incorrect
   */

return true;
}

function isCountryCompatible(
  listing: StructuredListing,
  criteria: SearchIntent,
) {
  if (
    !criteria.country
  ) {
    return true;
  }

  const text =
    normalizePlaceToken(
      `${listing.title} ${listing.description} ${listing.location ?? ""}`,
    );

  const countryGroups: Record<
    string,
    string[]
  > = {
    "France": [
      "france",
    ],

    "United Kingdom": [
      "united kingdom",
      "uk",
      "england",
      "scotland",
      "wales",
      "northern ireland",
    ],

    "United States": [
      "united states",
      "usa",
      "u s a",
      "florida",
      "california",
      "texas",
      "new york",
    ],

    "Spain": [
      "spain",
      "espana",
      "españa",
    ],

    "Germany": [
      "germany",
      "deutschland",
    ],

    "Italy": [
      "italy",
      "italia",
    ],

    "Portugal": [
      "portugal",
    ],

    "Belgium": [
      "belgium",
      "belgique",
      "belgie",
    ],

    "Switzerland": [
      "switzerland",
      "suisse",
      "schweiz",
    ],
  };

  const requested =
    countryGroups[
      criteria.country
    ] ?? [
      normalizePlaceToken(
        criteria.country,
      ),
    ];

  if (
    requested.some(
      (token) =>
        token &&
        text.includes(
          normalizePlaceToken(
            token,
          ),
        ),
    )
  ) {
    return true;
  }

  /*
   * Reject only when another known country is explicitly present.
   * Unknown country text is allowed.
   */
  for (
    const [
      country,
      tokens,
    ] of Object.entries(
      countryGroups,
    )
  ) {
    if (
      country ===
        criteria.country
    ) {
      continue;
    }

    if (
      tokens.some(
        (token) =>
          text.includes(
            normalizePlaceToken(
              token,
            ),
          ),
      )
    ) {
      return false;
    }
  }

  return true;
}

function isCityCompatible(
  listing: StructuredListing,
  criteria: SearchIntent,
) {
  if (
    !criteria.city
  ) {
    return true;
  }

  const requestedCity =
    normalizePlaceToken(
      criteria.city,
    );

  const requestedRegion =
    normalizePlaceToken(
      criteria.region,
    );

  const text =
    normalizePlaceToken(
      `${listing.title} ${listing.description} ${listing.location ?? ""}`,
    );

  /*
   * Special strict identity for Washington, D.C.
   */
  if (
    requestedCity ===
      "washington" &&
    (
      requestedRegion ===
        "district of columbia" ||
      normalizePlaceToken(
        criteria.location,
      ).includes(
        "district of columbia",
      )
    )
  ) {
    const dcSignals = [
      "washington dc",
      "washington d c",
      "district of columbia",
      ", dc ",
      " dc ",
    ];

    const wrongWashingtonSignals = [
      "washington court house",
      "washington courthouse",
      "washington state",
    ];

    if (
      wrongWashingtonSignals.some(
        (signal) =>
          text.includes(signal),
      )
    ) {
      return false;
    }

    /*
     * Detect explicit US state abbreviations. D.C. results must not
     * carry another state such as OH, WA, PA, etc.
     */
    const explicitState =
      extractUSStateCode(
        `${listing.title} ${listing.description} ${listing.location ?? ""}`,
      );

    if (
      explicitState &&
      explicitState !== "DC"
    ) {
      return false;
    }

    return dcSignals.some(
      (signal) =>
        text.includes(
          normalizePlaceToken(
            signal,
          ),
        ),
    );
  }

  /*
   * General city matching.
   */
  if (
    !text.includes(
      requestedCity,
    )
  ) {
    if (
      listing.location
    ) {
      return false;
    }

    return true;
  }

  /*
   * If a region/state was explicitly resolved, require it whenever
   * the listing exposes another state/region.
   */
  if (
    requestedRegion
  ) {
    const listingRegion =
      normalizePlaceToken(
        listing.location,
      );

    if (
      listingRegion &&
      !listingRegion.includes(
        requestedRegion,
      )
    ) {
      const requestedUSCode =
        regionToUSStateCode(
          criteria.region,
        );

      const explicitState =
        extractUSStateCode(
          `${listing.title} ${listing.description} ${listing.location ?? ""}`,
        );

      if (
        requestedUSCode &&
        explicitState &&
        requestedUSCode !==
          explicitState
      ) {
        return false;
      }
    }
  }

  return true;
}

function extractUSStateCode(
  value: string,
) {
  const match =
    value.match(
      /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i,
    );

  return match?.[1]
    ?.toUpperCase();
}

function regionToUSStateCode(
  region?: string,
) {
  const normalized =
    normalizePlaceToken(
      region,
    );

  const map: Record<
    string,
    string
  > = {
    "district of columbia":
      "DC",
    "washington": "WA",
    "ohio": "OH",
    "florida": "FL",
    "california": "CA",
    "new york": "NY",
    "texas": "TX",
    "virginia": "VA",
    "maryland": "MD",
  };

  return map[normalized];
}

function isPropertyTypeCompatible(
  listing: StructuredListing,
  criteria: SearchIntent,
) {
  const requested =
    criteria.propertyType;

  if (!requested) {
    return true;
  }

  const kind =
    listing.propertyKind;

  if (
    requested ===
      "apartment"
  ) {
    return (
      kind ===
        "apartment"
    );
  }

  if (
    requested ===
      "villa"
  ) {
    return (
      kind === "villa"
    );
  }

  if (
    requested ===
      "house"
  ) {
    if (
      kind ===
        "apartment"
    ) {
      return false;
    }

    if (
      kind ===
        "existing_house" ||
      kind ===
        "villa" ||
      kind ===
        "new_build_project"
    ) {
      return true;
    }

    const text =
      `${listing.title} ${listing.description}`
        .toLowerCase();

    return /house|terraced|terrace house|semi-detached|detached|townhouse|bungalow|cottage|maison|villa/.test(
      text,
    );
  }

  return true;
}

function sortListings(
  a: StructuredListing,
  b: StructuredListing,
  priority: SearchIntent["sortPriority"],
) {
  if (
    priority ===
    "lowest_price"
  ) {
    return (
      (a.price ??
        Number.MAX_SAFE_INTEGER) -
      (b.price ??
        Number.MAX_SAFE_INTEGER)
    );
  }

  if (
    priority ===
    "largest"
  ) {
    return (
      (b.surface ?? 0) -
      (a.surface ?? 0)
    );
  }

  if (
    priority ===
    "best_value"
  ) {
    return (
      b.valueScore -
      a.valueScore
    );
  }

  /*
   * Known valid prices rank ahead of unknown-price cards.
   */
  if (
    priority ===
      "best_match"
  ) {
    const aHasPrice =
      typeof a.price ===
      "number";

    const bHasPrice =
      typeof b.price ===
      "number";

    if (
      aHasPrice !==
      bHasPrice
    ) {
      return bHasPrice
        ? 1
        : -1;
    }
  }

  return (
    b.orbitScore -
    a.orbitScore
  );
}

/* =========================================================
   VALIDATION
========================================================= */

function isUsableListing(
  listing: StructuredListing,
  criteria: SearchIntent,
) {
  const combined =
    `${listing.title} ${listing.description}`
      .toLowerCase();

  if (
    /per night|par nuit|vacation rental|holiday rental|location saisonnière|hotel|booking/.test(
      combined,
    )
  ) {
    return false;
  }

  /*
   * A real individual listing can still be useful even when a portal
   * hides some fields from scraping. Keep it when at least one strong
   * property signal is available. The ORBIT score will naturally rank
   * richer listings above weaker ones.
   */
  const evidence = [
    listing.price,
    listing.surface,
    listing.bedrooms,
    listing.bathrooms,
    listing.images.length > 0
      ? 1
      : undefined,
  ].filter(Boolean).length;

  if (
    evidence < 1 &&
    !looksLikeIndividualListing(
      listing.url,
      listing.url,
      true,
    )
  ) {
    return false;
  }

  if (
    !isStrongIndividualListingUrl(
      listing.url,
    ) ||
    looksLikeCategorySearchResult(
      listing.title,
      listing.description,
      listing.url,
    )
  ) {
    return false;
  }

  if (
    criteria.city
  ) {
    const geo =
      evaluateListingLocation(
        listing.location,
        listing.title,
        listing.description,
        criteria,
      );

    if (
      geo.reject
    ) {
      return false;
    }
  }

  /*
   * Maximum budget is a hard constraint when a real price is known.
   * Unknown-price listings may remain as fallbacks.
   */
  if (
    criteria.budgetMax &&
    listing.price !==
      undefined &&
    listing.price >
      criteria.budgetMax
  ) {
    return false;
  }

  return true;
}

/* =========================================================
   INTENT HELPERS
========================================================= */

function heuristicLocation(
  query: string,
) {
  const original =
    cleanupText(query);

  /*
   * Strong patterns first.
   */
  const patterns = [
    /\b(?:à|a|near|près de|pres de|in|around|autour de)\s+([A-Za-zÀ-ÿ.' -]{2,50}?)(?=\s+(?:moins|under|avec|with|\d+\s*(?:chambres?|bedrooms?|m²|m2)|$)|[,;])/i,

    /\b(?:villa|maison|house|appartement|apartment|chalet|penthouse|townhouse|mansion)\s+([A-Za-zÀ-ÿ.' -]{2,50}?)(?=\s+(?:moins|under|avec|with|\d+\s*(?:chambres?|bedrooms?|m²|m2)|$)|[,;])/i,
  ];

  for (const pattern of patterns) {
    const match =
      original.match(pattern);

    if (match?.[1]) {
      const value =
        cleanupText(
          match[1],
        );

      const stripped =
        stripCountrySuffix(
          value,
        );

      return {
        city:
          titleCase(
            stripped.city,
          ),
        region:
          stripped.region,
      };
    }
  }

  return {
    city: undefined,
    region: undefined,
  };
}

function stripCountrySuffix(
  location: string,
) {
  const lower =
    location.toLowerCase();

  for (
    const profile of
    COUNTRY_PROFILES
  ) {
    for (
      const alias of
      profile.aliases
    ) {
      const pos =
        lower.lastIndexOf(
          alias,
        );

      if (
        pos > 0 &&
        pos + alias.length ===
          lower.length
      ) {
        return {
          city:
            cleanupText(
              location.slice(
                0,
                pos,
              ),
            ),
          region:
            undefined,
        };
      }
    }
  }

  return {
    city: location,
    region: undefined,
  };
}

function detectCountryFromText(
  text: string,
) {
  const q =
    text.toLowerCase();

  return COUNTRY_PROFILES.find(
    (profile) =>
      profile.aliases.some(
        (alias) =>
          q.includes(alias),
      ),
  );
}

function inferCountryFromCity(
  city?: string,
) {
  if (!city) {
    return undefined;
  }

  const c =
    city.toLowerCase();

  const map: Record<
    string,
    string
  > = {
    "los angeles":
      "United States",
    miami: "United States",
    "new york":
      "United States",
    chicago:
      "United States",
    "san francisco":
      "United States",
    "san diego":
      "United States",

    berlin: "Germany",
    munich: "Germany",
    münchen: "Germany",
    hamburg: "Germany",
    frankfurt: "Germany",

    barcelona: "Spain",
    madrid: "Spain",
    valencia: "Spain",
    seville: "Spain",

    porto: "Portugal",
    lisbon: "Portugal",
    lisboa: "Portugal",

    rome: "Italy",
    roma: "Italy",
    milan: "Italy",
    milano: "Italy",

    london:
      "United Kingdom",
    manchester:
      "United Kingdom",

    paris: "France",
    brest: "France",
    lyon: "France",
    marseille: "France",
    nice: "France",

    amsterdam:
      "Netherlands",
    brussels: "Belgium",
    bruxelles: "Belgium",
    zurich: "Switzerland",
    geneva: "Switzerland",
    vienne: "Austria",
    vienna: "Austria",
    toronto: "Canada",
    montreal: "Canada",
  };

  const country =
    map[c];

  return country
    ? resolveProfileByName(
        country,
      )
    : undefined;
}

function resolveAmbiguousLocation(
  criteria: SearchIntent,
  originalQuery: string,
): SearchIntent {
  const query =
    normalizePlaceToken(
      originalQuery,
    );

  const city =
    normalizePlaceToken(
      criteria.city,
    );

  /*
   * Washington without an explicit state means Washington, D.C.
   * This is intentionally deterministic so search engines and the
   * final validator use the same geographic identity.
   */
  const saysWashington =
    /\bwashington\b/.test(
      query,
    );

  const saysWashingtonState =
    /\bwashington\s+(?:state|etat|état)\b/.test(
      query,
    );

  const saysDC =
    /\bwashington\s*(?:dc|d c|district of columbia)\b/.test(
      query,
    );

  if (
    saysWashington &&
    !saysWashingtonState &&
    (
      saysDC ||
      city === "washington" ||
      !criteria.region
    )
  ) {
    return {
      ...criteria,
      city: "Washington",
      region:
        "District of Columbia",
      country:
        "United States",
      location:
        "Washington, District of Columbia, United States",
      language: "en",
      currency: "USD",
    };
  }

  if (
    saysWashingtonState
  ) {
    return {
      ...criteria,
      city:
        criteria.city &&
        city !== "washington"
          ? criteria.city
          : undefined,
      region:
        "Washington",
      country:
        "United States",
      location:
        criteria.city &&
        city !== "washington"
          ? buildLocationString(
              criteria.city,
              "Washington",
              "United States",
            )
          : "Washington State, United States",
      language: "en",
      currency: "USD",
    };
  }

  /*
   * Always rebuild location from canonical pieces when available.
   */
  const canonicalLocation =
    buildLocationString(
      criteria.city,
      criteria.region,
      criteria.country,
    );

  return {
    ...criteria,
    location:
      canonicalLocation ??
      criteria.location,
  };
}

function resolveCountryProfile(
  intent: SearchIntent,
) {
  if (intent.country) {
    const profile =
      resolveProfileByName(
        intent.country,
      );

    if (profile) {
      return profile;
    }
  }

  return inferCountryFromCity(
    intent.city,
  );
}

function resolveProfileByName(
  country: string,
) {
  const q =
    country.toLowerCase();

  return COUNTRY_PROFILES.find(
    (profile) =>
      profile.canonical
        .toLowerCase() ===
        q ||
      profile.aliases.some(
        (alias) =>
          alias === q,
      ),
  );
}

function detectPropertyType(
  q: string,
) {
  for (
    const [
      canonical,
      words,
    ] of Object.entries(
      PROPERTY_TYPE_WORDS,
    )
  ) {
    if (
      words.some((word) =>
        q.includes(word),
      )
    ) {
      return canonical;
    }
  }

  return "property";
}

function extractBudgetMax(
  q: string,
) {
  const million =
    q.match(
      /(?:under|moins de|max(?:imum)?|budget)?\s*(?:\$|€|£)?\s*(\d+(?:[.,]\d+)?)\s*(?:m|million|millions)\b/i,
    );

  if (million?.[1]) {
    return Math.round(
      Number(
        million[1].replace(
          ",",
          ".",
        ),
      ) * 1_000_000,
    );
  }

  const k =
    q.match(
      /(?:\$|€|£)?\s*(\d+(?:[.,]\d+)?)\s*k\b/i,
    );

  if (k?.[1]) {
    return Math.round(
      Number(
        k[1].replace(
          ",",
          ".",
        ),
      ) * 1000,
    );
  }

  const standard = [
    /(?:under|less than|moins de|max(?:imum)?|budget(?: de)?)\s*(?:\$|€|£)?\s*([\d\s,.]{4,})/i,

    /(?:\$|€|£)\s*([\d\s,.]{4,})/i,

    /([\d\s,.]{4,})\s*(?:€|\$|£|euros?|usd|eur|gbp)/i,
  ];

  for (const pattern of standard) {
    const match =
      q.match(pattern);

    if (match?.[1]) {
      const value =
        parseMoney(
          match[1],
        );

      if (
        value &&
        value >= 10000
      ) {
        return value;
      }
    }
  }

  return undefined;
}

function extractFeatureWords(
  q: string,
  preferencesOnly: boolean,
) {
  const features = [
    "garage",
    "garden",
    "jardin",
    "pool",
    "piscine",
    "swimming pool",
    "terrace",
    "terrasse",
    "parking",
    "sea view",
    "vue mer",
    "ocean view",
    "balcony",
    "balcon",
  ];

  const preferenceSignal =
    /si possible|idéalement|idealement|de préférence|de preference|preferably|if possible/i;

  if (
    preferencesOnly &&
    !preferenceSignal.test(q)
  ) {
    return [];
  }

  const found =
    features.filter(
      (feature) =>
        q.includes(feature),
    );

  return found.map(
    normalizeFeatureName,
  );
}

function normalizeFeatureName(
  feature: string,
) {
  const map: Record<
    string,
    string
  > = {
    jardin: "garden",
    piscine: "pool",
    "swimming pool": "pool",
    terrasse: "terrace",
    "vue mer": "sea view",
    "ocean view": "sea view",
    balcon: "balcony",
  };

  return (
    map[feature] ??
    feature
  );
}

/* =========================================================
   GENERAL HELPERS
========================================================= */

function extractOpenAIText(
  payload: {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  },
) {
  if (
    payload.output_text?.trim()
  ) {
    return payload.output_text.trim();
  }

  const parts: string[] =
    [];

  for (
    const output of
    payload.output ?? []
  ) {
    for (
      const content of
      output.content ?? []
    ) {
      if (
        typeof content.text ===
        "string"
      ) {
        parts.push(
          content.text,
        );
      }
    }
  }

  return parts.join("\n").trim();
}

function extractJsonObject(
  text: string,
) {
  const start =
    text.indexOf("{");

  const end =
    text.lastIndexOf("}");

  if (
    start === -1 ||
    end === -1 ||
    end <= start
  ) {
    return undefined;
  }

  return text.slice(
    start,
    end + 1,
  );
}

function cleanOptionalString(
  value: unknown,
) {
  if (
    typeof value !==
    "string"
  ) {
    return undefined;
  }

  const clean =
    cleanupText(value);

  if (
    !clean ||
    clean.toLowerCase() ===
      "null"
  ) {
    return undefined;
  }

  return clean;
}

function cleanOptionalNumber(
  value: unknown,
) {
  if (
    typeof value ===
    "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value ===
    "string"
  ) {
    const number =
      Number(
        value.replace(
          ",",
          ".",
        ),
      );

    if (
      Number.isFinite(number)
    ) {
      return number;
    }
  }

  return undefined;
}

function normalizeStringArray(
  value: unknown,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(
    value
      .filter(
        (
          item,
        ): item is string =>
          typeof item ===
          "string",
      )
      .map(
        (item) =>
          normalizeFeatureName(
            cleanupText(
              item.toLowerCase(),
            ),
          ),
      )
      .filter(Boolean),
  );
}

function buildLocationString(
  city?: string,
  region?: string,
  country?: string,
) {
  const parts = [
    city,
    region,
    country,
  ].filter(Boolean);

  return parts.length
    ? parts.join(", ")
    : undefined;
}

function containsPropertyType(
  text: string,
  requested: string,
) {
  const words =
    PROPERTY_TYPE_WORDS[
      requested
    ] ??
    [requested];

  return words.some((word) =>
    text.includes(
      word.toLowerCase(),
    ),
  );
}

function propertyTypeMatches(
  kind: PropertyKind,
  requested: string,
) {
  if (
    requested === "property"
  ) {
    return true;
  }

  if (
    requested === "villa"
  ) {
    return kind === "villa";
  }

  if (
    requested === "apartment"
  ) {
    return (
      kind === "apartment"
    );
  }

  if (
    requested === "house" ||
    requested === "townhouse" ||
    requested === "mansion" ||
    requested === "chalet"
  ) {
    return (
      kind ===
        "existing_house" ||
      kind === "villa"
    );
  }

  return true;
}

function listingMatchesFeature(
  listing: {
    garden?: boolean;
    garage?: boolean;
    pool?: boolean;
    terrace?: boolean;
    parking?: boolean;
    title?: string;
    description?: string;
  },
  feature: string,
) {
  const f =
    normalizeFeatureName(
      feature.toLowerCase(),
    );

  if (f === "garden") {
    return Boolean(
      listing.garden,
    );
  }

  if (f === "garage") {
    return Boolean(
      listing.garage,
    );
  }

  if (f === "pool") {
    return Boolean(
      listing.pool,
    );
  }

  if (f === "terrace") {
    return Boolean(
      listing.terrace,
    );
  }

  if (f === "parking") {
    return Boolean(
      listing.parking,
    );
  }

  const text =
    `${listing.title ?? ""} ${listing.description ?? ""}`
      .toLowerCase();

  return text.includes(f);
}

function extractInteger(
  text: string,
  patterns: RegExp[],
  min: number,
  max: number,
) {
  for (const pattern of patterns) {
    const match =
      text.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const value =
      Number(match[1]);

    if (
      Number.isInteger(value) &&
      value >= min &&
      value <= max
    ) {
      return value;
    }
  }

  return undefined;
}

function parseMoney(
  value: string,
) {
  let cleaned =
    value
      .replace(
        /[\s\u00A0\u202F]/g,
        "",
      )
      .trim();

  /*
   * 1,250,000 -> 1250000
   * 1.250.000 -> 1250000
   * 450000 -> 450000
   */
  const commaCount =
    (
      cleaned.match(
        /,/g,
      ) ?? []
    ).length;

  const dotCount =
    (
      cleaned.match(
        /\./g,
      ) ?? []
    ).length;

  if (
    commaCount > 1 ||
    dotCount > 1
  ) {
    cleaned =
      cleaned.replace(
        /[,.]/g,
        "",
      );
  } else if (
    commaCount === 1 &&
    dotCount === 0
  ) {
    const parts =
      cleaned.split(",");

    if (
      parts[1]?.length === 3
    ) {
      cleaned =
        parts.join("");
    } else {
      cleaned =
        cleaned.replace(
          ",",
          ".",
        );
    }
  } else if (
    dotCount === 1 &&
    commaCount === 0
  ) {
    const parts =
      cleaned.split(".");

    if (
      parts[1]?.length === 3
    ) {
      cleaned =
        parts.join("");
    }
  } else if (
    commaCount === 1 &&
    dotCount === 1
  ) {
    cleaned =
      cleaned.replace(
        /[,.]/g,
        "",
      );
  }

  cleaned =
    cleaned.replace(
      /[^\d.]/g,
      "",
    );

  const number =
    Number(cleaned);

  return Number.isFinite(
    number,
  )
    ? Math.round(number)
    : undefined;
}

function parseDecimal(
  value: string,
) {
  const number =
    Number(
      value
        .trim()
        .replace(
          ",",
          ".",
        ),
    );

  return Number.isFinite(
    number,
  )
    ? number
    : undefined;
}

function deduplicateCandidates(
  candidates: ListingCandidate[],
) {
  const map =
    new Map<
      string,
      ListingCandidate
    >();

  for (
    const candidate of
    candidates
  ) {
    const key =
      normalizeUrl(
        candidate.url,
      );

    const existing =
      map.get(key);

    if (
      !existing ||
      candidate.discoveryScore >
        existing.discoveryScore
    ) {
      map.set(
        key,
        candidate,
      );
    }
  }

  return Array.from(
    map.values(),
  );
}

function deduplicateListings(
  listings: StructuredListing[],
) {
  const map =
    new Map<
      string,
      StructuredListing
    >();

  for (const listing of listings) {
    const key =
      normalizeUrl(listing.url);

    const existing =
      map.get(key);

    if (
      !existing ||
      listing.orbitScore >
        existing.orbitScore
    ) {
      map.set(
        key,
        listing,
      );
    }
  }

  return Array.from(
    map.values(),
  );
}

function normalizeUrl(
  url: string,
) {
  try {
    const parsed =
      new URL(url);

    parsed.hash = "";

    const remove = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "fbclid",
      "gclid",
      "serp_view",
      "search",
    ];

    for (const key of remove) {
      parsed.searchParams.delete(
        key,
      );
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

function getDomain(
  url: string,
) {
  try {
    return new URL(url)
      .hostname
      .replace(
        /^www\./,
        "",
      );
  } catch {
    return "web";
  }
}

function isBlockedDomain(
  url: string,
) {
  const domain =
    getDomain(url);

  return BLOCKED_DOMAINS.some(
    (blocked) =>
      domain === blocked ||
      domain.endsWith(
        `.${blocked}`,
      ),
  );
}

function cleanupText(
  text: string,
) {
  return text
    .replace(
      /\s+/g,
      " ",
    )
    .trim();
}

function cleanupMarkdown(
  text: string,
) {
  return text
    .replace(
      /!\[[^\]]*\]\([^)]+\)/g,
      "",
    )
    .replace(
      /\[([^\]]+)\]\([^)]+\)/g,
      "$1",
    )
    .replace(
      /[#*_>`]/g,
      "",
    )
    .replace(
      /\s+/g,
      " ",
    )
    .trim();
}

function uniqueStrings(
  values: string[],
) {
  return Array.from(
    new Set(
      values.filter(Boolean),
    ),
  );
}

function medianNumber(
  values: number[],
) {
  if (!values.length) {
    return undefined;
  }

  const middle =
    Math.floor(
      values.length / 2,
    );

  if (
    values.length % 2 === 0
  ) {
    return (
      values[middle - 1] +
      values[middle]
    ) / 2;
  }

  return values[middle];
}

function titleCase(
  text?: string,
) {
  if (!text) {
    return undefined;
  }

  return text
    .split(" ")
    .map(
      (word) =>
        word
          ? word[0].toUpperCase() +
            word.slice(1)
          : word,
    )
    .join(" ");
}

function clamp(
  value: number,
  min: number,
  max: number,
) {
  return Math.min(
    max,
    Math.max(
      min,
      value,
    ),
  );
}

function round1(
  value: number,
) {
  return (
    Math.round(
      value * 10,
    ) / 10
  );
}