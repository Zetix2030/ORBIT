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
  budgetMin?: number;

  minSurface?: number;
  minBedrooms?: number;
  minMileage?: number;
  minPower?: number;

  location?: string;

  garden?: boolean;
  garage?: boolean;
  parking?: boolean;

  preferredEnergy?: string;
  preferredYear?: number;
};

type Property = {
  id: number;
  title: string;
  price: number;
  location: string;
  surface: number;
  bedrooms: number;
  garden: boolean;
  garage: boolean;
  parking: boolean;
  year: number;
  energy: string;
  image: string;
  description: string;
  distanceMinutes: number;
};

type ScoredProperty = Property & {
  matchScore: number;
  valueScore: number;
  orbitScore: number;
  reasons: string[];
  compromises: string[];
};

const DEMO_PROPERTIES: Property[] = [
  {
    id: 1,
    title: "Maison familiale contemporaine",
    price: 419000,
    location: "Brest — Saint-Pierre",
    surface: 147,
    bedrooms: 4,
    garden: true,
    garage: true,
    parking: true,
    year: 2019,
    energy: "B",
    image:
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=85",
    description:
      "Maison récente avec jardin, garage et grande pièce de vie. Très bon équilibre entre prix et caractéristiques.",
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
    parking: true,
    year: 2017,
    energy: "B",
    image:
      "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1400&q=85",
    description:
      "Plus grande et mieux équipée, avec un terrain généreux. Un peu plus chère mais excellente pour une famille.",
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
    parking: true,
    year: 2021,
    energy: "A",
    image:
      "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1400&q=85",
    description:
      "Très récente et performante énergétiquement. Le principal compromis est l'absence de garage.",
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
    parking: true,
    year: 2015,
    energy: "C",
    image:
      "https://images.unsplash.com/photo-1605146769289-440113cc3d00?auto=format&fit=crop&w=1400&q=85",
    description:
      "Très bon terrain et garage. Le principal compromis est la distance par rapport au centre de Brest.",
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
    parking: true,
    year: 2012,
    energy: "C",
    image:
      "https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=1400&q=85",
    description:
      "Très bien située et parfaitement adaptée à la recherche, mais proche du budget maximum.",
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
    parking: true,
    year: 2022,
    energy: "A",
    image:
      "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1400&q=85",
    description:
      "Excellente valeur et très récente, mais légèrement sous la surface minimum recherchée.",
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
    parking: true,
    year: 2020,
    energy: "B",
    image:
      "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1400&q=85",
    description:
      "Très belle configuration familiale avec garage et prestations supérieures.",
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
    parking: true,
    year: 2018,
    energy: "B",
    image:
      "https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1400&q=85",
    description:
      "Prix intéressant avec de bonnes caractéristiques générales et une marge budgétaire confortable.",
    distanceMinutes: 21,
  },
];

const EXAMPLES = [
  "Find me a family house near Brest under €450k, 140m²+, 4 bedrooms, garden and garage",
  "Je cherche une maison à Brest à moins de 450000 €, 140 m² minimum, 4 chambres, jardin et garage",
  "Find me a sporty car under €40k",
  "Find me the best 1440p gaming monitor under €250",
];

function cleanNumber(value: string) {
  const normalized = value
    .replace(/\s/g, "")
    .replace(/[€$£]/g, "")
    .replace(/euros?/gi, "")
    .trim();

  if (!normalized) return undefined;

  const commaDecimal =
    normalized.includes(",") && normalized.split(",")[1]?.length <= 2;

  const cleaned = commaDecimal
    ? normalized.replace(/\./g, "").replace(",", ".")
    : normalized.replace(/,/g, "").replace(/\./g, "");

  const number = Number(cleaned);

  return Number.isFinite(number) ? number : undefined;
}

function parseBudget(query: string) {
  const normalized = query.toLowerCase();

  const maxPatterns = [
    /(?:under|below|less than|maximum|max|up to|budget(?: of)?|à moins de|moins de|max(?:imum)? de|budget(?: de)?)\s*(\d[\d\s.,]*)\s*(?:€|euros?)?/i,
    /(\d[\d\s.,]*)\s*(?:€|euros?)\s*(?:maximum|max|ou moins)/i,
  ];

  for (const pattern of maxPatterns) {
    const match = normalized.match(pattern);

    if (match?.[1]) {
      const value = cleanNumber(match[1]);

      if (value) {
        return { budgetMax: value };
      }
    }
  }

  const euroMatch = normalized.match(/(\d[\d\s.,]*)\s*(?:€|euros?)/i);

  if (euroMatch?.[1]) {
    const value = cleanNumber(euroMatch[1]);

    if (value) {
      return { budgetMax: value };
    }
  }

  return {};
}

function parseSurface(query: string) {
  const normalized = query.toLowerCase();

  const plusMatch = normalized.match(
    /(\d[\d\s.,]*)\s*(?:m²|m2|sqm)\s*\+/i,
  );

  if (plusMatch?.[1]) {
    const value = cleanNumber(plusMatch[1]);

    if (value) {
      return value;
    }
  }

  const minimumMatch = normalized.match(
    /(?:at least|minimum|min|au moins|minimum de)\s*(\d[\d\s.,]*)\s*(?:m²|m2|sqm)/i,
  );

  if (minimumMatch?.[1]) {
    const value = cleanNumber(minimumMatch[1]);

    if (value) {
      return value;
    }
  }

  const genericMatch = normalized.match(
    /(\d[\d\s.,]*)\s*(?:m²|m2|sqm)/i,
  );

  if (genericMatch?.[1]) {
    const value = cleanNumber(genericMatch[1]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function parseBedrooms(query: string) {
  const normalized = query.toLowerCase();

  const match = normalized.match(
    /(\d+)\s*(?:bedrooms?|bedroom|chambres?|chambre)/i,
  );

  if (match?.[1]) {
    return Number(match[1]);
  }

  return undefined;
}

function detectLocation(query: string) {
  const normalized = query.toLowerCase();

  const knownLocations = [
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

  return knownLocations.find((location) =>
    normalized.includes(location),
  );
}

function detectCategory(query: string): Category {
  const normalized = query.toLowerCase();

  const realEstateTerms = [
    "maison",
    "maisons",
    "appartement",
    "appartements",
    "immobilier",
    "immobilière",
    "immobiliere",
    "property",
    "properties",
    "house",
    "houses",
    "home",
    "homes",
    "real estate",
    "villa",
    "villas",
    "terrain",
    "land",
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
    "citroën",
    "citroen",
    "sportive",
    "sports car",
    "suv",
  ];

  const electronicsTerms = [
    "pc",
    "ordinateur",
    "ordinateur portable",
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
    "graphics card",
    "tv",
    "television",
    "télévision",
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

  if (realEstateTerms.some((term) => normalized.includes(term))) {
    return "real_estate";
  }

  if (carTerms.some((term) => normalized.includes(term))) {
    return "car";
  }

  if (electronicsTerms.some((term) => normalized.includes(term))) {
    return "electronics";
  }

  if (travelTerms.some((term) => normalized.includes(term))) {
    return "travel";
  }

  return "unknown";
}

function parseCriteria(query: string): SearchCriteria {
  const category = detectCategory(query);
  const budget = parseBudget(query);
  const surface = parseSurface(query);
  const bedrooms = parseBedrooms(query);

  const normalized = query.toLowerCase();

  return {
    category,
    rawQuery: query,
    budgetMax: budget.budgetMax,
    minSurface: surface,
    minBedrooms: bedrooms,
    location: detectLocation(query),
    garden:
      /jardin|garden|yard|terrain/i.test(query) || undefined,
    garage:
      /garage|parking couvert|covered parking/i.test(query) || undefined,
    parking:
      /parking|stationnement|driveway/i.test(query) || undefined,
    preferredEnergy:
      /dpe\s*a|classe\s*a|energy\s*a|energy rating a/i.test(normalized)
        ? "A"
        : /dpe\s*b|classe\s*b|energy\s*b|energy rating b/i.test(normalized)
          ? "B"
          : undefined,
    preferredYear:
      /récent|recente|récente|recent|new|nouveau/i.test(normalized)
        ? 2018
        : undefined,
  };
}

function calculateScores(
  property: Property,
  criteria: SearchCriteria,
): ScoredProperty {
  let match = 50;
  let value = 65;

  const reasons: string[] = [];
  const compromises: string[] = [];

  if (criteria.budgetMax) {
    if (property.price <= criteria.budgetMax) {
      match += 15;
      reasons.push("Within your maximum budget");
    } else {
      const over =
        ((property.price - criteria.budgetMax) / criteria.budgetMax) * 100;

      match -= Math.min(20, Math.max(5, over));
      compromises.push("Above your stated maximum budget");
    }
  }

  if (criteria.minSurface) {
    if (property.surface >= criteria.minSurface) {
      match += 10;
      reasons.push("Meets your minimum surface");
    } else {
      const difference = criteria.minSurface - property.surface;
      match -= Math.min(15, difference / 2);
      compromises.push(`${difference}m² below your minimum`);
    }
  }

  if (criteria.minBedrooms) {
    if (property.bedrooms >= criteria.minBedrooms) {
      match += 8;
      reasons.push("Meets your bedroom requirement");
    } else {
      match -= 10;
      compromises.push("Below your requested bedroom count");
    }
  }

  if (criteria.garden !== undefined) {
    if (property.garden === criteria.garden) {
      match += 5;
      reasons.push("Has a garden");
    } else {
      match -= 10;
      compromises.push("No garden");
    }
  }

  if (criteria.garage !== undefined) {
    if (property.garage === criteria.garage) {
      match += 5;
      reasons.push("Has a garage");
    } else {
      match -= 10;
      compromises.push("No garage");
    }
  }

  if (criteria.location) {
    const wanted = criteria.location.toLowerCase();
    const actual = property.location.toLowerCase();

    if (actual.includes(wanted)) {
      match += 7;
      reasons.push("Located in your requested area");
    } else {
      compromises.push("Not in the exact requested location");
    }
  }

  if (criteria.preferredEnergy) {
    if (property.energy <= criteria.preferredEnergy) {
      value += 7;
      reasons.push(`Good energy rating (${property.energy})`);
    } else {
      compromises.push(`Energy rating ${property.energy}`);
    }
  }

  if (criteria.preferredYear) {
    if (property.year >= criteria.preferredYear) {
      value += 7;
      reasons.push("Relatively recent property");
    } else {
      compromises.push("Older than your preferred construction period");
    }
  }

  if (criteria.budgetMax && property.price < criteria.budgetMax) {
    const savings = criteria.budgetMax - property.price;
    const savingsPercent = savings / criteria.budgetMax;

    value += Math.min(15, savingsPercent * 30);
    reasons.push(
      `Leaves €${Math.round(savings).toLocaleString("fr-FR")} of budget headroom`,
    );
  }

  if (property.energy === "A") value += 8;
  else if (property.energy === "B") value += 5;

  if (property.year >= 2020) value += 6;
  else if (property.year >= 2017) value += 3;

  const pricePerM2 = property.price / property.surface;

  if (pricePerM2 < 3000) {
    value += 8;
    reasons.push("Attractive price per m² in this demo dataset");
  } else if (pricePerM2 < 3400) {
    value += 4;
  }

  match = Math.round(Math.max(0, Math.min(100, match)));
  value = Math.round(Math.max(0, Math.min(100, value)));

  const overall = Math.round(match * 0.7 + value * 0.3);

  return {
    ...property,
    matchScore: match,
    valueScore: value,
    orbitScore: overall,
    reasons: reasons.slice(0, 4),
    compromises: compromises.slice(0, 3),
  };
}

function formatPrice(price: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(price);
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const results = useMemo(() => {
    if (!criteria || criteria.category !== "real_estate") {
      return [];
    }

    return DEMO_PROPERTIES.map((property) =>
      calculateScores(property, criteria),
    ).sort((a, b) => b.orbitScore - a.orbitScore);
  }, [criteria]);

  const selectedResult =
    results.find((result) => result.id === selectedId) ?? results[0];

  const handleSearch = () => {
    const cleanQuery = query.trim();

    if (!cleanQuery) return;

    const parsed = parseCriteria(cleanQuery);

    setCriteria(parsed);
    setSearchedQuery(cleanQuery);
    setSelectedId(null);
  };

  const resetSearch = () => {
    setQuery("");
    setSearchedQuery("");
    setCriteria(null);
    setSelectedId(null);
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
            aria-label="Return to ORBIT home"
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

          <div className="flex items-center gap-3">
            <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/35">
              DEMO MODE
            </div>
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
            Describe a house, car, computer, trip or anything you are
            considering. ORBIT turns your request into structured criteria and
            finds the strongest available options.
          </p>

          <div className="mx-auto mt-12 max-w-4xl rounded-[28px] border border-white/10 bg-white/[0.035] p-2 shadow-2xl">
            <div className="rounded-[22px] bg-[#0c0e11]">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/50">
                  ✦
                </div>

                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleSearch();
                    }
                  }}
                  placeholder="What are you looking for?"
                  className="min-w-0 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-white/25 sm:text-lg"
                />

                <button
                  onClick={handleSearch}
                  disabled={!query.trim()}
                  className="rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Search
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                onClick={() => setQuery(example)}
                className="rounded-full border border-white/8 bg-white/[0.025] px-4 py-2 text-xs text-white/35 transition hover:border-white/15 hover:text-white/70"
              >
                {example}
              </button>
            ))}
          </div>

          <p className="mt-6 text-xs text-white/20">
            Demo data only — live web research will be connected later.
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
                {criteria.category !== "unknown" && (
                  <CriteriaItem
                    label="Category"
                    value={
                      criteria.category === "real_estate"
                        ? "Real estate"
                        : criteria.category
                    }
                  />
                )}

                {criteria.budgetMax !== undefined && (
                  <CriteriaItem
                    label="Maximum budget"
                    value={formatPrice(criteria.budgetMax)}
                  />
                )}

                {criteria.minSurface !== undefined && (
                  <CriteriaItem
                    label="Minimum surface"
                    value={`${criteria.minSurface} m²`}
                  />
                )}

                {criteria.minBedrooms !== undefined && (
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
                    label="Preferred energy"
                    value={criteria.preferredEnergy}
                  />
                )}
              </div>

              <div className="mt-5 rounded-2xl border border-amber-300/10 bg-amber-300/[0.03] p-4 text-xs leading-5 text-white/35">
                <span className="font-medium text-white/60">
                  Demo mode:
                </span>{" "}
                these properties are sample data. No live market source is
                connected yet.
              </div>
            </aside>

            <div>
              {criteria.category !== "real_estate" ? (
                <div className="rounded-[28px] border border-white/[0.08] bg-white/[0.025] p-10">
                  <div className="text-xs uppercase tracking-[0.18em] text-white/25">
                    Category engine
                  </div>

                  <h2 className="mt-3 text-2xl font-semibold">
                    {criteria.category === "unknown"
                      ? "I need a little more information."
                      : "This category is coming next."}
                  </h2>

                  <p className="mt-4 max-w-xl text-sm leading-7 text-white/40">
                    {criteria.category === "unknown"
                      ? "Try describing a house, car, electronics product, hotel or another item you want ORBIT to research."
                      : "The universal architecture is ready, but the current live demo is focused on real estate."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <div className="text-2xl font-semibold">
                        {results.length} matches
                      </div>
                      <div className="mt-1 text-sm text-white/30">
                        Ranked by ORBIT Match + ORBIT Value
                      </div>
                    </div>

                    <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/35">
                      Demo research
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 xl:grid-cols-2">
                    {results.map((result, index) => (
                      <button
                        key={result.id}
                        onClick={() => setSelectedId(result.id)}
                        className={`overflow-hidden rounded-[26px] border text-left transition ${
                          selectedResult?.id === result.id
                            ? "border-white/20 bg-white/[0.055]"
                            : "border-white/[0.08] bg-white/[0.025] hover:border-white/[0.14]"
                        }`}
                      >
                        <div className="relative h-56 overflow-hidden">
                          <img
                            src={result.image}
                            alt={result.title}
                            className="h-full w-full object-cover transition duration-500 hover:scale-105"
                          />

                          <div className="absolute left-4 top-4 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-[11px] backdrop-blur">
                            #{index + 1}
                          </div>

                          <div className="absolute right-4 top-4 rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-[11px] backdrop-blur">
                            ORBIT {result.orbitScore}
                          </div>
                        </div>

                        <div className="p-5">
                          <div className="flex items-start justify-between gap-5">
                            <div>
                              <h3 className="text-lg font-medium">
                                {result.title}
                              </h3>
                              <p className="mt-1 text-sm text-white/30">
                                {result.location}
                              </p>
                            </div>

                            <div className="text-right">
                              <div className="text-xl font-semibold">
                                {formatPrice(result.price)}
                              </div>
                              <div className="mt-1 text-[11px] text-white/25">
                                {Math.round(
                                  result.price / result.surface,
                                ).toLocaleString("fr-FR")}{" "}
                                €/m²
                              </div>
                            </div>
                          </div>

                          <div className="mt-5 flex flex-wrap gap-2">
                            <Tag>{result.surface} m²</Tag>
                            <Tag>{result.bedrooms} chambres</Tag>
                            {result.garden && <Tag>Jardin</Tag>}
                            {result.garage && <Tag>Garage</Tag>}
                            <Tag>DPE {result.energy}</Tag>
                          </div>

                          <div className="mt-5 grid grid-cols-2 gap-3">
                            <ScoreBox
                              label="Match"
                              score={result.matchScore}
                            />
                            <ScoreBox
                              label="Value"
                              score={result.valueScore}
                            />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {selectedResult && (
                    <div className="mt-6 rounded-[28px] border border-white/[0.08] bg-white/[0.025] p-6 lg:p-8">
                      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-white/25">
                            ORBIT analysis
                          </div>

                          <h2 className="mt-3 text-2xl font-semibold">
                            {selectedResult.title}
                          </h2>

                          <p className="mt-4 text-sm leading-7 text-white/40">
                            {selectedResult.description}
                          </p>

                          <div className="mt-6">
                            <div className="text-xs uppercase tracking-[0.16em] text-white/20">
                              Why ORBIT likes it
                            </div>

                            <div className="mt-3 space-y-2">
                              {selectedResult.reasons.map((reason) => (
                                <div
                                  key={reason}
                                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white/50"
                                >
                                  <span className="mr-2 text-emerald-300/70">
                                    ✓
                                  </span>
                                  {reason}
                                </div>
                              ))}
                            </div>
                          </div>

                          {selectedResult.compromises.length > 0 && (
                            <div className="mt-6">
                              <div className="text-xs uppercase tracking-[0.16em] text-white/20">
                                Trade-offs
                              </div>

                              <div className="mt-3 space-y-2">
                                {selectedResult.compromises.map((compromise) => (
                                  <div
                                    key={compromise}
                                    className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white/40"
                                  >
                                    <span className="mr-2 text-amber-300/70">
                                      △
                                    </span>
                                    {compromise}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="rounded-3xl border border-white/[0.07] bg-[#0c0e11] p-6">
                            <div className="text-xs uppercase tracking-[0.18em] text-white/20">
                              Verdict
                            </div>

                            <div className="mt-4 text-3xl font-semibold">
                              {selectedResult.orbitScore >= 85
                                ? "Strong option"
                                : selectedResult.orbitScore >= 70
                                  ? "Worth investigating"
                                  : "Significant compromises"}
                            </div>

                            <div className="mt-6 grid grid-cols-3 gap-3">
                              <MiniScore
                                label="Match"
                                value={selectedResult.matchScore}
                              />
                              <MiniScore
                                label="Value"
                                value={selectedResult.valueScore}
                              />
                              <MiniScore
                                label="Orbit"
                                value={selectedResult.orbitScore}
                              />
                            </div>

                            <div className="mt-6 space-y-3 text-sm text-white/45">
                              <div className="flex justify-between gap-4">
                                <span>Price</span>
                                <span className="text-white/80">
                                  {formatPrice(selectedResult.price)}
                                </span>
                              </div>

                              <div className="flex justify-between gap-4">
                                <span>Surface</span>
                                <span className="text-white/80">
                                  {selectedResult.surface} m²
                                </span>
                              </div>

                              <div className="flex justify-between gap-4">
                                <span>Bedrooms</span>
                                <span className="text-white/80">
                                  {selectedResult.bedrooms}
                                </span>
                              </div>

                              <div className="flex justify-between gap-4">
                                <span>Year</span>
                                <span className="text-white/80">
                                  {selectedResult.year}
                                </span>
                              </div>

                              <div className="flex justify-between gap-4">
                                <span>Energy</span>
                                <span className="text-white/80">
                                  {selectedResult.energy}
                                </span>
                              </div>

                              <div className="flex justify-between gap-4">
                                <span>Distance</span>
                                <span className="text-white/80">
                                  {selectedResult.distanceMinutes} min
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
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
      <div className="text-[11px] text-white/25">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
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
      <div className="mt-1 text-lg font-semibold">{score}</div>
    </div>
  );
}

function MiniScore({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/20">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}