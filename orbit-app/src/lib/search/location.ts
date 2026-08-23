export type LocationIntent = {
  city?: string;
  country?: string;
  currency?: string;
};

const FRENCH_CITIES = [
  "Paris",
  "Marseille",
  "Lyon",
  "Toulouse",
  "Nice",
  "Nantes",
  "Montpellier",
  "Strasbourg",
  "Bordeaux",
  "Lille",
  "Rennes",
  "Reims",
  "Saint-Étienne",
  "Toulon",
  "Le Havre",
  "Grenoble",
  "Dijon",
  "Angers",
  "Nîmes",
  "Villeurbanne",
  "Clermont-Ferrand",
  "Le Mans",
  "Aix-en-Provence",
  "Brest",
  "Tours",
  "Amiens",
  "Limoges",
  "Annecy",
  "Perpignan",
  "Metz",
  "Besançon",
  "Orléans",
  "Rouen",
  "Mulhouse",
  "Caen",
  "Nancy",
  "Argenteuil",
  "Montreuil",
  "Roubaix",
  "Tourcoing",
  "Avignon",
  "Poitiers",
  "Versailles",
  "Pau",
  "La Rochelle",
  "Lorient",
  "Quimper",
  "Vannes",
  "Saint-Brieuc",
  "Saint-Malo",
  "Morlaix",
  "Concarneau",
  "Landerneau",
  "Plougastel-Daoulas",
  "Guipavas",
  "Le Relecq-Kerhuon",
];

function norm(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .trim();
}

function titleCaseCity(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(/([ -])/)
    .map((part) =>
      /[ -]/.test(part)
        ? part
        : part
            .split("'")
            .map((word) =>
              word ? `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}` : word,
            )
            .join("'"),
    )
    .join("");
}

function knownFrenchCity(query: string) {
  const q = norm(query);
  for (const city of FRENCH_CITIES) {
    if (q.includes(norm(city))) return city;
  }
  return undefined;
}

function heuristicFrenchCity(query: string) {
  const patterns = [
    /(?:\bà|\ba|\bsur|\bvers|\bautour de|\bproche de|\bprès de)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ -]{1,45})/i,
    /(?:maison|appartement|villa|bien|immobilier)\s+(?:à|a|sur)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ -]{1,45})/i,
  ];

  const stopWords = /\s+(?:moins|sous|budget|prix|avec|sans|minimum|min\.?|maximum|max\.?|de\s+\d|\d+\s*(?:m2|m²|chambres?))/i;

  for (const pattern of patterns) {
    const match = query.match(pattern)?.[1];
    if (!match) continue;
    const cleaned = match.split(stopWords)[0]?.trim().replace(/[,.]+$/, "");
    if (!cleaned || cleaned.length < 2 || cleaned.length > 45) continue;
    return titleCaseCity(cleaned);
  }

  return undefined;
}

export function detectLocationDeterministically(query: string): LocationIntent {
  return {
    city: knownFrenchCity(query) ?? heuristicFrenchCity(query),
    country: "France",
    currency: "EUR",
  };
}

export async function detectLocationWithAI(
  query: string,
  apiKey?: string,
): Promise<LocationIntent> {
  const fallback = detectLocationDeterministically(query);
  if (!apiKey) return fallback;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "ORBIT recherche désormais uniquement des biens immobiliers situés en France. Extrais uniquement la commune française demandée. Retourne un JSON {city}. Si la requête vise clairement une ville hors de France, n'invente aucune ville française et retourne {}. N'ajoute jamais un autre pays ni une autre devise.",
          },
          { role: "user", content: query },
        ],
      }),
    });

    if (!response.ok) return fallback;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return fallback;

    const parsed = JSON.parse(content) as { city?: unknown };
    const city =
      typeof parsed.city === "string" && parsed.city.trim()
        ? titleCaseCity(parsed.city)
        : fallback.city;

    return {
      city,
      country: "France",
      currency: "EUR",
    };
  } catch {
    return fallback;
  }
}
