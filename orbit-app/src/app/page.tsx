"use client";

import { useMemo, useState } from "react";

type Category =
  | "real_estate"
  | "car"
  | "electronics"
  | "travel"
  | "unknown";

type SearchCriteria = {
  category: Category;
  rawQuery: string;

  budgetMax?: number;
  minSurface?: number;
  minBedrooms?: number;

  location?: string;

  garden?: boolean;
  garage?: boolean;

  preferredEnergy?: string;
  preferredYear?: number;
};

type WebResult = {
  id: string;
  title: string;
  description: string;
  url: string;
  position: number;
  source: string;
};

type DemoProperty = {
  id: number;
  title: string;
  price: number;
  location: string;
  surface: number;
  bedrooms: number;
  garden: boolean;
  garage: boolean;
  year: number;
  energy: string;
  image: string;
  description: string;
  distanceMinutes: number;
};

type ScoredProperty = DemoProperty & {
  matchScore: number;
  valueScore: number;
  orbitScore: number;
  reasons: string[];
  compromises: string[];
};

const DEMO_PROPERTIES: DemoProperty[] = [
  {
    id: 1,
    title: "Maison familiale contemporaine",
    price: 419000,
    location: "Brest — Saint-Pierre",
    surface: 147,
    bedrooms: 4,
    garden: true,
    garage: true,
    year: 2019,
    energy: "B",
    image:
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=85",
    description:
      "Maison récente avec jardin, garage et grande pièce de vie.",
    distanceMinutes: 8,
  },
  {
    id: 2,
    title: "Grande maison avec terrain",
    price: 439000,
    location: "Gouesnou",
    surface: 164,
    bedrooms: 5,
    garden: true,
    garage: true,
    year: 2017,
    energy: "B",
    image:
      "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1400&q=85",
    description:
      "Grande maison familiale avec terrain généreux et garage.",
    distanceMinutes: 14,
  },
  {
    id: 3,
    title: "Maison moderne proche de Brest",
    price: 399000,
    location: "Guipavas",
    surface: 141,
    bedrooms: 4,
    garden: true,
    garage: false,
    year: 2021,
    energy: "A",
    image:
      "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1400&q=85",
    description:
      "Maison récente très performante énergétiquement.",
    distanceMinutes: 16,
  },
  {
    id: 4,
    title: "Maison familiale avec grand jardin",
    price: 429000,
    location: "Plougastel-Daoulas",
    surface: 151,
    bedrooms: 4,
    garden: true,
    garage: true,
    year: 2015,
    energy: "C",
    image:
      "https://images.unsplash.com/photo-1605146769289-440113cc3d00?auto=format&fit=crop&w=1400&q=85",
    description:
      "Très bon terrain et garage, légèrement plus éloignée de Brest.",
    distanceMinutes: 23,
  },
  {
    id: 5,
    title: "Maison de caractère rénovée",
    price: 449000,
    location: "Brest — Lambézellec",
    surface: 154,
    bedrooms: 4,
    garden: true,
    garage: true,
    year: 2012,
    energy: "C",
    image:
      "https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=1400&q=85",
    description:
      "Très bonne localisation et excellente adéquation aux critères.",
    distanceMinutes: 7,
  },
  {
    id: 6,
    title: "Maison récente petit budget",
    price: 379000,
    location: "Le Relecq-Kerhuon",
    surface: 136,
    bedrooms: 4,
    garden: true,
    garage: true,
    year: 2022,
    energy: "A",
    image:
      "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1400&q=85",
    description:
      "Très récente et très intéressante financièrement.",
    distanceMinutes: 18,
  },
  {
    id: 7,
    title: "Maison premium avec double garage",
    price: 445000,
    location: "Bohars",
    surface: 158,
    bedrooms: 5,
    garden: true,
    garage: true,
    year: 2020,
    energy: "B",
    image:
      "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1400&q=85",
    description:
      "Très belle configuration familiale avec prestations supérieures.",
    distanceMinutes: 19,
  },
  {
    id: 8,
    title: "Maison économique à fort potentiel",
    price: 389000,
    location: "Plouzané",
    surface: 145,
    bedrooms: 4,
    garden: true,
    garage: true,
    year: 2018,
    energy: "B",
    image:
      "https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1400&q=85",
    description:
      "Prix intéressant avec de très bonnes caractéristiques.",
    distanceMinutes: 21,
  },
];

const EXAMPLES = [
  "Find me a family house near Brest under €450k, 140m²+, 4 bedrooms, garden and garage",
  "Je cherche une maison à Brest à moins de 450000 €, 140 m² minimum, 4 chambres, jardin et garage",
  "Find me a sporty car under €40k",
  "Find me the best 1440p gaming monitor under €250",
];

function formatPrice(price: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(price);
}

function parseNumber(value: string) {
  const cleaned = value
    .replace(/\s/g, "")
    .replace(/[€$£]/g, "")
    .trim();

  if (!cleaned) return undefined;

  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(/\./g, "");

  const result = Number(normalized);

  return Number.isFinite(result) ? result : undefined;
}

function detectCategory(query: string): Category {
  const q = query.toLowerCase();

  const realEstateTerms = [
    "maison",
    "maisons",
    "appartement",
    "appartements",
    "immobilier",
    "property",
    "properties",
    "house",
    "houses",
    "home",
    "homes",
    "real estate",
    "villa",
    "terrain",
  ];

  const carTerms = [
    "voiture",
    "voitures",
    "car",
    "cars",
    "auto",
    "automobile",
    "bmw",
    "audi",
    "mercedes",
    "peugeot",
    "renault",
    "suv",
    "sporty car",
  ];

  const electronicsTerms = [
    "pc",
    "ordinateur",
    "laptop",
    "écran",
    "ecran",
    "monitor",
    "moniteur",
    "smartphone",
    "phone",
    "téléphone",
    "telephone",
    "gpu",
    "carte graphique",
    "tv",
    "television",
  ];

  const travelTerms = [
    "hôtel",
    "hotel",
    "voyage",
    "travel",
    "vol",
    "flight",
    "vacances",
    "holiday",
  ];

  if (realEstateTerms.some((term) => q.includes(term))) {
    return "real_estate";
  }

  if (carTerms.some((term) => q.includes(term))) {
    return "car";
  }

  if (electronicsTerms.some((term) => q.includes(term))) {
    return "electronics";
  }

  if (travelTerms.some((term) => q.includes(term))) {
    return "travel";
  }

  return "unknown";
}

function detectLocation(query: string) {
  const q = query.toLowerCase();

  const locations = [
    "brest",
    "gouesnou",
    "guipavas",
    "plougastel",
    "plouzané",
    "plouzane",
    "bohars",
    "le relecq-kerhuon",
    "le relecq kerhuon",
  ];

  return locations.find((location) => q.includes(location));
}

function parseCriteria(query: string): SearchCriteria {
  const q = query.toLowerCase();

  const category = detectCategory(query);

  let budgetMax: number | undefined;

  const budgetPatterns = [
    /(?:under|below|less than|maximum|max|up to)\s*(\d[\d\s.,]*)\s*(?:€|euros?)?/i,
    /(?:à moins de|moins de|max(?:imum)? de|budget de)\s*(\d[\d\s.,]*)\s*(?:€|euros?)?/i,
    /(\d[\d\s.,]*)\s*(?:€|euros?)\s*(?:maximum|max|ou moins)/i,
  ];

  for (const pattern of budgetPatterns) {
    const match = q.match(pattern);

    if (match?.[1]) {
      budgetMax = parseNumber(match[1]);

      if (budgetMax) break;
    }
  }

  if (!budgetMax) {
    const euroMatch = q.match(
      /(\d[\d\s.,]*)\s*(?:€|euros?)/i,
    );

    if (euroMatch?.[1]) {
      budgetMax = parseNumber(euroMatch[1]);
    }
  }

  let minSurface: number | undefined;

  const surfaceMatch = q.match(
    /(\d[\d\s.,]*)\s*(?:m²|m2|sqm)\s*\+?/i,
  );

  if (surfaceMatch?.[1]) {
    minSurface = parseNumber(surfaceMatch[1]);
  }

  let minBedrooms: number | undefined;

  const bedroomMatch = q.match(
    /(\d+)\s*(?:bedrooms?|chambres?|chambre)/i,
  );

  if (bedroomMatch?.[1]) {
    minBedrooms = Number(bedroomMatch[1]);
  }

  return {
    category,
    rawQuery: query,
    budgetMax,
    minSurface,
    minBedrooms,
    location: detectLocation(query),
    garden:
      /jardin|garden|yard/i.test(query) || undefined,
    garage:
      /garage|parking couvert|covered parking/i.test(query) ||
      undefined,
    preferredEnergy:
      /dpe\s*a|classe\s*a|energy.*a/i.test(q)
        ? "A"
        : /dpe\s*b|classe\s*b|energy.*b/i.test(q)
          ? "B"
          : undefined,
    preferredYear:
      /récent|récente|recent|recently|new/i.test(q)
        ? 2018
        : undefined,
  };
}

function scoreProperty(
  property: DemoProperty,
  criteria: SearchCriteria,
): ScoredProperty {
  let match = 50;
  let value = 65;

  const reasons: string[] = [];
  const compromises: string[] = [];

  if (criteria.budgetMax) {
    if (property.price <= criteria.budgetMax) {
      match += 15;
      reasons.push("Dans votre budget maximum");
    } else {
      match -= 15;
      compromises.push("Au-dessus du budget maximum");
    }
  }

  if (criteria.minSurface) {
    if (property.surface >= criteria.minSurface) {
      match += 10;
      reasons.push("Respecte la surface minimum");
    } else {
      match -= 10;
      compromises.push(
        `${criteria.minSurface - property.surface} m² sous votre minimum`,
      );
    }
  }

  if (criteria.minBedrooms) {
    if (property.bedrooms >= criteria.minBedrooms) {
      match += 8;
      reasons.push("Respecte le nombre de chambres demandé");
    } else {
      match -= 10;
      compromises.push("Pas assez de chambres");
    }
  }

  if (criteria.garden !== undefined) {
    if (property.garden === criteria.garden) {
      match += 5;
      reasons.push("Jardin disponible");
    } else {
      match -= 10;
      compromises.push("Pas de jardin");
    }
  }

  if (criteria.garage !== undefined) {
    if (property.garage === criteria.garage) {
      match += 5;
      reasons.push("Garage disponible");
    } else {
      match -= 10;
      compromises.push("Pas de garage");
    }
  }

  if (criteria.location) {
    if (
      property.location
        .toLowerCase()
        .includes(criteria.location.toLowerCase())
    ) {
      match += 7;
      reasons.push("Dans la zone demandée");
    } else {
      compromises.push("Pas exactement dans la zone demandée");
    }
  }

  if (criteria.budgetMax && property.price < criteria.budgetMax) {
    const saved = criteria.budgetMax - property.price;
    value += Math.min(15, (saved / criteria.budgetMax) * 30);

    reasons.push(
      `Laisse ${formatPrice(saved)} de marge`,
    );
  }

  if (property.energy === "A") {
    value += 8;
    reasons.push("Excellent DPE");
  } else if (property.energy === "B") {
    value += 5;
    reasons.push("Bon DPE");
  }

  if (property.year >= 2020) {
    value += 6;
    reasons.push("Construction récente");
  } else if (property.year >= 2017) {
    value += 3;
  }

  const pricePerM2 = property.price / property.surface;

  if (pricePerM2 < 3000) {
    value += 8;
    reasons.push("Prix au m² intéressant");
  } else if (pricePerM2 < 3400) {
    value += 4;
  }

  match = Math.round(Math.max(0, Math.min(100, match)));
  value = Math.round(Math.max(0, Math.min(100, value)));

  const orbitScore = Math.round(
    match * 0.7 + value * 0.3,
  );

  return {
    ...property,
    matchScore: match,
    valueScore: value,
    orbitScore,
    reasons: reasons.slice(0, 4),
    compromises: compromises.slice(0, 3),
  };
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");

  const [criteria, setCriteria] =
    useState<SearchCriteria | null>(null);

  const [webResults, setWebResults] =
    useState<WebResult[]>([]);

  const [searchingWeb, setSearchingWeb] =
    useState(false);

  const [searchError, setSearchError] =
    useState("");

  const [selectedId, setSelectedId] =
    useState<number | null>(null);

  const [showDemo, setShowDemo] =
    useState(true);

  const demoResults = useMemo(() => {
    if (
      !criteria ||
      criteria.category !== "real_estate"
    ) {
      return [];
    }

    return DEMO_PROPERTIES
      .map((property) =>
        scoreProperty(property, criteria),
      )
      .sort(
        (a, b) =>
          b.orbitScore - a.orbitScore,
      );
  }, [criteria]);

  const selectedDemo =
    demoResults.find(
      (result) => result.id === selectedId,
    ) ?? demoResults[0];

  const handleSearch = async () => {
    const cleanQuery = query.trim();

    if (!cleanQuery || searchingWeb) {
      return;
    }

    const parsed = parseCriteria(cleanQuery);

    setCriteria(parsed);
    setSearchedQuery(cleanQuery);
    setSelectedId(null);
    setWebResults([]);
    setSearchError("");
    setSearchingWeb(true);
    setShowDemo(false);

    try {
      const response = await fetch(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            query: cleanQuery,
          }),
        },
      );

      const data = await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            "Erreur pendant la recherche.",
        );
      }

      setWebResults(
        Array.isArray(data.results)
          ? data.results
          : [],
      );
    } catch (error) {
      console.error(
        "ORBIT web search error:",
        error,
      );

      setSearchError(
        error instanceof Error
          ? error.message
          : "La recherche web a échoué.",
      );
    } finally {
      setSearchingWeb(false);
    }
  };

  const resetSearch = () => {
    setQuery("");
    setSearchedQuery("");
    setCriteria(null);
    setWebResults([]);
    setSearchError("");
    setSearchingWeb(false);
    setSelectedId(null);
    setShowDemo(true);
  };

  return (
    <main className="min-h-screen bg-[#07080a] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-240px] h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-white/[0.025] blur-3xl" />
        <div className="absolute left-[8%] top-[20%] h-[320px] w-[320px] rounded-full bg-blue-500/[0.03] blur-3xl" />
        <div className="absolute right-[5%] bottom-[8%] h-[320px] w-[320px] rounded-full bg-violet-500/[0.025] blur-3xl" />
      </div>

      <header className="relative z-10 border-b border-white/[0.06]">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-8">
          <button
            onClick={resetSearch}
            className="flex items-center gap-3"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
              <div className="h-3 w-3 rounded-full bg-white shadow-[0_0_24px_rgba(255,255,255,0.5)]" />
            </div>

            <div className="text-left">
              <div className="text-sm font-semibold tracking-[0.28em]">
                ORBIT
              </div>

              <div className="text-[10px] uppercase tracking-[0.18em] text-white/25">
                Decision Intelligence
              </div>
            </div>
          </button>

          <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/35">
            LIVE WEB SEARCH
          </div>
        </div>
      </header>

      {!criteria ? (
        <section className="relative z-10 mx-auto max-w-5xl px-6 pb-24 pt-24 text-center lg:pt-32">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-xs text-white/40">
            <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
            Universal market intelligence
          </div>

          <h1 className="text-5xl font-semibold tracking-[-0.055em] sm:text-6xl lg:text-8xl">
            Tell ORBIT
            <br />
            what you want.
          </h1>

          <p className="mx-auto mt-7 max-w-2xl text-base leading-7 text-white/40 sm:text-lg">
            Describe a property, car, computer, trip or
            anything you are considering. ORBIT researches
            the web and turns the results into useful choices.
          </p>

          <div className="mx-auto mt-12 max-w-4xl rounded-[28px] border border-white/10 bg-white/[0.035] p-2 shadow-2xl">
            <div className="rounded-[22px] bg-[#0c0e11]">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/50">
                  ✦
                </div>

                <input
                  value={query}
                  onChange={(event) =>
                    setQuery(
                      event.target.value,
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter"
                    ) {
                      handleSearch();
                    }
                  }}
                  placeholder="What are you looking for?"
                  className="min-w-0 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-white/25 sm:text-lg"
                />

                <button
                  onClick={handleSearch}
                  disabled={
                    !query.trim() ||
                    searchingWeb
                  }
                  className="rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {searchingWeb
                    ? "Searching..."
                    : "Search"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                onClick={() =>
                  setQuery(example)
                }
                className="rounded-full border border-white/8 bg-white/[0.025] px-4 py-2 text-xs text-white/35 transition hover:border-white/15 hover:text-white/70"
              >
                {example}
              </button>
            ))}
          </div>

          <p className="mt-6 text-xs text-white/20">
            Live web research is enabled.
          </p>
        </section>
      ) : (
        <section className="relative z-10 mx-auto max-w-7xl px-6 pb-24 pt-10 lg:px-8">
          <div className="flex flex-col gap-5 border-b border-white/[0.06] pb-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <div className="text-xs uppercase tracking-[0.2em] text-white/25">
                Research
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                {searchedQuery}
              </h1>
            </div>

            <button
              onClick={resetSearch}
              className="w-fit rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/60 transition hover:bg-white/[0.07]"
            >
              New search
            </button>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[300px_1fr]">
            <aside className="h-fit rounded-[26px] border border-white/[0.08] bg-white/[0.025] p-5">
              <div className="text-xs uppercase tracking-[0.18em] text-white/25">
                Understood criteria
              </div>

              <div className="mt-5 space-y-3">
                <CriteriaItem
                  label="Category"
                  value={
                    criteria.category ===
                    "real_estate"
                      ? "Real estate"
                      : criteria.category
                  }
                />

                {criteria.budgetMax !==
                  undefined && (
                  <CriteriaItem
                    label="Maximum budget"
                    value={formatPrice(
                      criteria.budgetMax,
                    )}
                  />
                )}

                {criteria.minSurface !==
                  undefined && (
                  <CriteriaItem
                    label="Minimum surface"
                    value={`${criteria.minSurface} m²`}
                  />
                )}

                {criteria.minBedrooms !==
                  undefined && (
                  <CriteriaItem
                    label="Minimum bedrooms"
                    value={`${criteria.minBedrooms}`}
                  />
                )}

                {criteria.location && (
                  <CriteriaItem
                    label="Location"
                    value={criteria.location}
                  />
                )}

                {criteria.garden && (
                  <CriteriaItem
                    label="Requirement"
                    value="Garden"
                  />
                )}

                {criteria.garage && (
                  <CriteriaItem
                    label="Requirement"
                    value="Garage"
                  />
                )}

                {criteria.preferredEnergy && (
                  <CriteriaItem
                    label="Preferred DPE"
                    value={
                      criteria.preferredEnergy
                    }
                  />
                )}
              </div>
            </aside>

            <div>
              {searchingWeb && (
                <div className="mb-5 rounded-[24px] border border-white/[0.08] bg-white/[0.025] p-5">
                  <div className="flex items-center gap-3">
                    <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />

                    <div>
                      <div className="text-sm font-medium">
                        ORBIT is researching
                        the web
                      </div>

                      <div className="mt-1 text-xs text-white/30">
                        Searching live web
                        sources...
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {searchError && (
                <div className="mb-5 rounded-[24px] border border-red-400/10 bg-red-400/[0.04] p-5">
                  <div className="text-sm font-medium text-red-200/80">
                    Search error
                  </div>

                  <div className="mt-2 text-sm text-white/40">
                    {searchError}
                  </div>
                </div>
              )}

              {criteria.category ===
                "real_estate" &&
                showDemo && (
                  <section className="mb-10">
                    <div className="mb-5 flex items-end justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-white/25">
                          ORBIT demo engine
                        </div>

                        <h2 className="mt-2 text-2xl font-semibold">
                          Example market
                          analysis
                        </h2>

                        <p className="mt-1 text-sm text-white/30">
                          Sample properties used
                          to test ORBIT ranking.
                        </p>
                      </div>

                      <button
                        onClick={() =>
                          setShowDemo(false)
                        }
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/40 transition hover:bg-white/[0.05]"
                      >
                        Hide demo
                      </button>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      {demoResults.map(
                        (
                          property,
                          index,
                        ) => (
                          <button
                            key={
                              property.id
                            }
                            onClick={() =>
                              setSelectedId(
                                property.id,
                              )
                            }
                            className={`overflow-hidden rounded-[26px] border text-left transition ${
                              selectedDemo?.id ===
                              property.id
                                ? "border-white/20 bg-white/[0.055]"
                                : "border-white/[0.08] bg-white/[0.025] hover:border-white/[0.14]"
                            }`}
                          >
                            <div className="relative h-52 overflow-hidden">
                              <img
                                src={
                                  property.image
                                }
                                alt={
                                  property.title
                                }
                                className="h-full w-full object-cover"
                              />

                              <div className="absolute left-4 top-4 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-[11px] backdrop-blur">
                                #{index +
                                  1}
                              </div>

                              <div className="absolute right-4 top-4 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-[11px] backdrop-blur">
                                ORBIT{" "}
                                {
                                  property.orbitScore
                                }
                              </div>
                            </div>

                            <div className="p-5">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <h3 className="text-lg font-medium">
                                    {
                                      property.title
                                    }
                                  </h3>

                                  <p className="mt-1 text-sm text-white/30">
                                    {
                                      property.location
                                    }
                                  </p>
                                </div>

                                <div className="text-right">
                                  <div className="text-xl font-semibold">
                                    {formatPrice(
                                      property.price,
                                    )}
                                  </div>

                                  <div className="text-xs text-white/20">
                                    {Math.round(
                                      property.price /
                                        property.surface,
                                    ).toLocaleString(
                                      "fr-FR",
                                    )}{" "}
                                    €/m²
                                  </div>
                                </div>
                              </div>

                              <div className="mt-5 flex flex-wrap gap-2">
                                <Tag>
                                  {
                                    property.surface
                                  }{" "}
                                  m²
                                </Tag>

                                <Tag>
                                  {
                                    property.bedrooms
                                  }{" "}
                                  chambres
                                </Tag>

                                {property.garden && (
                                  <Tag>
                                    Jardin
                                  </Tag>
                                )}

                                {property.garage && (
                                  <Tag>
                                    Garage
                                  </Tag>
                                )}

                                <Tag>
                                  DPE{" "}
                                  {
                                    property.energy
                                  }
                                </Tag>
                              </div>

                              <div className="mt-5 grid grid-cols-2 gap-3">
                                <ScoreBox
                                  label="Match"
                                  score={
                                    property.matchScore
                                  }
                                />

                                <ScoreBox
                                  label="Value"
                                  score={
                                    property.valueScore
                                  }
                                />
                              </div>
                            </div>
                          </button>
                        ),
                      )}
                    </div>

                    {selectedDemo && (
                      <div className="mt-5 rounded-[26px] border border-white/[0.08] bg-white/[0.025] p-6">
                        <div className="text-xs uppercase tracking-[0.18em] text-white/20">
                          Demo verdict
                        </div>

                        <h3 className="mt-3 text-xl font-semibold">
                          {
                            selectedDemo.title
                          }
                        </h3>

                        <div className="mt-5 grid gap-4 md:grid-cols-3">
                          <ScoreBox
                            label="Match"
                            score={
                              selectedDemo.matchScore
                            }
                          />

                          <ScoreBox
                            label="Value"
                            score={
                              selectedDemo.valueScore
                            }
                          />

                          <ScoreBox
                            label="Overall"
                            score={
                              selectedDemo.orbitScore
                            }
                          />
                        </div>
                      </div>
                    )}
                  </section>
                )}

              <section>
                <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-white/25">
                      Live web research
                    </div>

                    <h2 className="mt-2 text-2xl font-semibold">
                      {webResults.length}
                      {" "}
                      {webResults.length ===
                      1
                        ? "source"
                        : "sources"}{" "}
                      found
                    </h2>

                    <p className="mt-1 text-sm text-white/30">
                      Results retrieved from
                      the live web.
                    </p>
                  </div>

                  <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/35">
                    Firecrawl
                  </div>
                </div>

                {webResults.length ===
                0 ? (
                  <div className="rounded-[26px] border border-white/[0.08] bg-white/[0.025] p-10 text-center">
                    {searchingWeb ? (
                      <>
                        <div className="text-lg font-medium">
                          Searching...
                        </div>

                        <p className="mt-2 text-sm text-white/30">
                          ORBIT is looking
                          through the web.
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="text-lg font-medium">
                          No web results
                          returned.
                        </div>

                        <p className="mt-2 text-sm text-white/30">
                          Try a broader
                          search.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {webResults.map(
                      (result) => (
                        <a
                          key={result.id}
                          href={
                            result.url
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group block rounded-[24px] border border-white/[0.08] bg-white/[0.025] p-5 transition hover:border-white/[0.15] hover:bg-white/[0.04]"
                        >
                          <div className="flex gap-5">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03] text-xs text-white/30">
                              {
                                result.position
                              }
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <h3 className="text-base font-medium transition group-hover:text-white/90">
                                  {
                                    result.title
                                  }
                                </h3>

                                <span className="w-fit shrink-0 rounded-full border border-white/8 bg-white/[0.025] px-3 py-1 text-[10px] text-white/30">
                                  {
                                    result.source
                                  }
                                </span>
                              </div>

                              <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/35">
                                {
                                  result.description
                                }
                              </p>

                              <div className="mt-4 truncate text-xs text-white/20">
                                {
                                  result.url
                                }
                              </div>
                            </div>

                            <div className="hidden shrink-0 text-white/20 transition group-hover:translate-x-1 group-hover:text-white/50 sm:block">
                              →
                            </div>
                          </div>
                        </a>
                      ),
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function CriteriaItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="text-[11px] text-white/25">
        {label}
      </div>

      <div className="mt-1 font-medium">
        {value}
      </div>
    </div>
  );
}

function Tag({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span className="rounded-full bg-white/[0.04] px-3 py-1.5 text-xs text-white/50">
      {children}
    </span>
  );
}

function ScoreBox({
  label,
  score,
}: {
  label: string;
  score: number;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-white/20">
        {label}
      </div>

      <div className="mt-1 text-lg font-semibold">
        {score}
      </div>
    </div>
  );
}