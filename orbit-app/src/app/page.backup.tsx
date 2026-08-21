"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  User,
} from "@supabase/supabase-js";

import {
  createClient,
} from "@/lib/supabase/client";

/* =========================================================
   TYPES
========================================================= */

type PropertyKind =
  | "existing_house"
  | "new_build_project"
  | "apartment"
  | "villa"
  | "unknown";

type RealEstateCriteria = {
  location?: string;
  city?: string;
  country?: string;
  propertyType?: string;
  currency?: string;
  budgetMax?: number;
  minSurface?: number;
  minBedrooms?: number;
  minBathrooms?: number;
  requirements?: string[];
  preferences?: string[];
  garden?: boolean;
  garage?: boolean;
};

type WebSource = {
  id: string;
  title: string;
  description: string;
  url: string;
  position: number;
  source: string;
  sourceScore?: number;
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
  propertyKind: PropertyKind;
  matchScore: number;
  valueScore: number;
  orbitScore: number;
  reasons: string[];
  compromises: string[];
  extractedAt: string;
};

type SearchResponse = {
  success: boolean;
  query?: string;
  searchQuery?: string;
  criteria?: RealEstateCriteria;
  sourceCount?: number;
  candidateCount?: number;
  listingCount?: number;
  creditsUsed?: number | null;
  confirmedPriceCount?: number;
  photoCount?: number;
  sources?: WebSource[];
  listings?: Listing[];
  error?: string;
};

type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

type RecentSearch = {
  query: string;
  at: number;
};

type SearchStage = {
  label: string;
  detail: string;
};

/* =========================================================
   CONSTANTS
========================================================= */

const EXAMPLES = [
  "Maison à Londres moins de 600 000 £, 3 chambres",
  "Villa à Miami moins de 1 200 000 $, piscine et garage",
  "Maison à Brest moins de 450 000 €, 140 m², 4 chambres",
];

const QUICK_QUESTIONS = [
  "Comment fonctionne le score ORBIT ?",
  "Comment ORBIT compare les biens ?",
  "Comment mieux formuler ma recherche ?",
  "Quels compromis faut-il regarder en priorité ?",
];

const SEARCH_STAGES: SearchStage[] = [
  {
    label: "Compréhension",
    detail:
      "ORBIT structure tes critères et résout la localisation.",
  },
  {
    label: "Recherche web",
    detail:
      "Interrogation parallèle des moteurs et portails pertinents.",
  },
  {
    label: "Vérification",
    detail:
      "Prix, photos, type de bien, ville et critères sont contrôlés.",
  },
  {
    label: "Classement",
    detail:
      "Les meilleurs résultats sont comparés et classés.",
  },
];

/* =========================================================
   HELPERS
========================================================= */

function formatPrice(
  value?: number,
  currency = "EUR",
) {
  if (value === undefined) {
    return "Prix non confirmé";
  }

  try {
    return new Intl.NumberFormat(
      "fr-FR",
      {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      },
    ).format(value);
  } catch {
    return `${value.toLocaleString(
      "fr-FR",
    )} ${currency}`;
  }
}

function formatSurface(
  value?: number,
) {
  if (value === undefined) {
    return "—";
  }

  return `${value.toLocaleString(
    "fr-FR",
    {
      maximumFractionDigits: 1,
    },
  )} m²`;
}

function propertyKindLabel(
  kind: PropertyKind,
) {
  if (
    kind === "existing_house"
  ) {
    return "Maison";
  }

  if (
    kind === "new_build_project"
  ) {
    return "Programme neuf";
  }

  if (kind === "villa") {
    return "Villa";
  }

  if (
    kind === "apartment"
  ) {
    return "Appartement";
  }

  return "Bien";
}

function firstImage(
  listing: Listing,
) {
  return listing.images?.find(
    (image) =>
      typeof image === "string" &&
      image.startsWith("http"),
  );
}

function clamp(
  value: number,
  min: number,
  max: number,
) {
  return Math.max(
    min,
    Math.min(
      max,
      value,
    ),
  );
}

function scoreLabel(
  score: number,
) {
  if (score >= 90) {
    return "Excellent";
  }

  if (score >= 80) {
    return "Très fort";
  }

  if (score >= 70) {
    return "Solide";
  }

  if (score >= 60) {
    return "Intéressant";
  }

  return "Partiel";
}

function safeHost(
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
    return url;
  }
}

/* =========================================================
   PAGE
========================================================= */

export default function Home() {
  const [query, setQuery] =
    useState("");

  const [
    showMarketingLanding,
    setShowMarketingLanding,
  ] = useState(true);

  const [
    authMode,
    setAuthMode,
  ] = useState<
    "signin" | "signup" | null
  >(null);

  const [
    authUser,
    setAuthUser,
  ] = useState<User | null>(
    null,
  );

  const [
    authReady,
    setAuthReady,
  ] = useState(false);

  const supabase =
    useMemo(
      () => createClient(),
      [],
    );

  const [
    searchedQuery,
    setSearchedQuery,
  ] = useState("");

  const [criteria, setCriteria] =
    useState<RealEstateCriteria | null>(
      null,
    );

  const [sources, setSources] =
    useState<WebSource[]>([]);

  const [listings, setListings] =
    useState<Listing[]>([]);

  const [
    sourceCount,
    setSourceCount,
  ] = useState(0);

  const [
    candidateCount,
    setCandidateCount,
  ] = useState(0);

  const [
    creditsUsed,
    setCreditsUsed,
  ] =
    useState<number | null>(
      null,
    );

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const [
    selectedListingId,
    setSelectedListingId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    hoveredListingId,
    setHoveredListingId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    showCommand,
    setShowCommand,
  ] = useState(false);

  const [
    showAssistant,
    setShowAssistant,
  ] = useState(false);

  const [
    activeNav,
    setActiveNav,
  ] = useState<
    | "search"
    | "history"
    | "favorites"
    | "assistant"
  >("search");

  const [
    favoriteUrls,
    setFavoriteUrls,
  ] = useState<string[]>(
    [],
  );

  const [
    recentSearches,
    setRecentSearches,
  ] = useState<RecentSearch[]>(
    [],
  );

  const [
    searchStageIndex,
    setSearchStageIndex,
  ] = useState(0);

  const [
    assistantInput,
    setAssistantInput,
  ] = useState("");

  const [
    assistantLoading,
    setAssistantLoading,
  ] = useState(false);

  const [
    assistantMessages,
    setAssistantMessages,
  ] =
    useState<
      AssistantMessage[]
    >([
      {
        role: "assistant",
        content:
          "Je suis ORBIT Assistant. Je peux t'aider à affiner une recherche, comprendre un score, comparer des compromis ou analyser un bien.",
      },
    ]);

  const searchInputRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const selectedListing =
    useMemo(() => {
      if (!selectedListingId) {
        return null;
      }

      return (
        listings.find(
          (listing) =>
            listing.id ===
            selectedListingId,
        ) ?? null
      );
    }, [
      listings,
      selectedListingId,
    ]);

  const favoriteListings =
    useMemo(
      () =>
        listings.filter(
          (listing) =>
            favoriteUrls.includes(
              listing.url,
            ),
        ),
      [
        favoriteUrls,
        listings,
      ],
    );

  useEffect(() => {
    let mounted = true;

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) {
          return;
        }

        const user =
          data.session?.user ??
          null;

        setAuthUser(user);

        if (user) {
          setShowMarketingLanding(
            false,
          );
        }

        setAuthReady(true);
      });

    const {
      data: {
        subscription,
      },
    } =
      supabase.auth.onAuthStateChange(
        (
          _event,
          session,
        ) => {
          const user =
            session?.user ??
            null;

          setAuthUser(user);

          if (user) {
            setShowMarketingLanding(
              false,
            );
            setAuthMode(null);
          }

          setAuthReady(true);
        },
      );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    try {
      const recent =
        JSON.parse(
          localStorage.getItem(
            "orbit-recent-searches",
          ) ?? "[]",
        ) as RecentSearch[];

      const favorites =
        JSON.parse(
          localStorage.getItem(
            "orbit-favorites",
          ) ?? "[]",
        ) as string[];

      setRecentSearches(
        Array.isArray(recent)
          ? recent
          : [],
      );

      setFavoriteUrls(
        Array.isArray(
          favorites,
        )
          ? favorites
          : [],
      );
    } catch {
      // localStorage may be unavailable.
    }
  }, []);

  useEffect(() => {
    function onKeyDown(
      event: KeyboardEvent,
    ) {
      if (
        (event.ctrlKey ||
          event.metaKey) &&
        event.key.toLowerCase() ===
          "k"
      ) {
        event.preventDefault();
        setShowCommand(
          (value) => !value,
        );
      }

      if (
        event.key === "Escape"
      ) {
        setShowCommand(false);
        setSelectedListingId(
          null,
        );
      }
    }

    window.addEventListener(
      "keydown",
      onKeyDown,
    );

    return () =>
      window.removeEventListener(
        "keydown",
        onKeyDown,
      );
  }, []);

  useEffect(() => {
    if (!loading) {
      setSearchStageIndex(0);
      return;
    }

    const interval =
      window.setInterval(
        () => {
          setSearchStageIndex(
            (current) =>
              clamp(
                current + 1,
                0,
                SEARCH_STAGES.length -
                  1,
              ),
          );
        },
        3300,
      );

    return () =>
      window.clearInterval(
        interval,
      );
  }, [loading]);

  async function handleSearch(
    forcedQuery?: string,
  ) {
    const cleanQuery =
      (
        forcedQuery ??
        query
      ).trim();

    if (
      !cleanQuery ||
      loading
    ) {
      return;
    }

    setQuery(cleanQuery);
    setLoading(true);
    setError("");
    setListings([]);
    setSources([]);
    setCriteria(null);
    setSourceCount(0);
    setCandidateCount(0);
    setCreditsUsed(null);
    setSelectedListingId(
      null,
    );
    setSearchStageIndex(0);
    setActiveNav("search");
    setShowCommand(false);

    try {
      const response =
        await fetch(
          "/api/search",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                query:
                  cleanQuery,
              }),
          },
        );

      const data =
        (await response.json()) as SearchResponse;

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            "ORBIT n'a pas pu effectuer la recherche.",
        );
      }

      setSearchedQuery(
        data.query ??
          cleanQuery,
      );

      setCriteria(
        data.criteria ?? {},
      );

      setSources(
        Array.isArray(
          data.sources,
        )
          ? data.sources
          : [],
      );

      setListings(
        Array.isArray(
          data.listings,
        )
          ? data.listings
          : [],
      );

      setSourceCount(
        data.sourceCount ??
          data.sources
            ?.length ??
          0,
      );

      setCandidateCount(
        data.candidateCount ??
          0,
      );

      setCreditsUsed(
        data.creditsUsed ??
          null,
      );

      const newRecent = [
        {
          query:
            cleanQuery,
          at: Date.now(),
        },
        ...recentSearches.filter(
          (item) =>
            item.query !==
            cleanQuery,
        ),
      ].slice(0, 8);

      setRecentSearches(
        newRecent,
      );

      localStorage.setItem(
        "orbit-recent-searches",
        JSON.stringify(
          newRecent,
        ),
      );
    } catch (searchError) {
      console.error(
        "ORBIT search error:",
        searchError,
      );

      setError(
        searchError instanceof
          Error
          ? searchError.message
          : "Une erreur est survenue.",
      );
    } finally {
      setLoading(false);
      setSearchStageIndex(
        SEARCH_STAGES.length -
          1,
      );
    }
  }

  function toggleFavorite(
    listing: Listing,
  ) {
    const next =
      favoriteUrls.includes(
        listing.url,
      )
        ? favoriteUrls.filter(
            (url) =>
              url !==
              listing.url,
          )
        : [
            ...favoriteUrls,
            listing.url,
          ];

    setFavoriteUrls(next);

    try {
      localStorage.setItem(
        "orbit-favorites",
        JSON.stringify(next),
      );
    } catch {
      // ignore
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();

    setAuthUser(null);
    setShowMarketingLanding(
      true,
    );
    setAuthMode(null);
    setShowAssistant(false);
    setActiveNav("search");
  }

  function resetSearch() {
    setQuery("");
    setSearchedQuery("");
    setCriteria(null);
    setSources([]);
    setListings([]);
    setSourceCount(0);
    setCandidateCount(0);
    setCreditsUsed(null);
    setError("");
    setLoading(false);
    setSelectedListingId(
      null,
    );
    setActiveNav("search");

    window.setTimeout(
      () =>
        searchInputRef.current?.focus(),
      60,
    );
  }

  async function sendAssistant(
    forcedQuestion?: string,
  ) {
    const question =
      (
        forcedQuestion ??
        assistantInput
      ).trim();

    if (
      !question ||
      assistantLoading
    ) {
      return;
    }

    const userMessage:
      AssistantMessage = {
      role: "user",
      content: question,
    };

    const conversation = [
      ...assistantMessages,
      userMessage,
    ];

    setAssistantMessages(
      conversation,
    );
    setAssistantInput("");
    setAssistantLoading(true);

    try {
      const response =
        await fetch(
          "/api/assistant",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                messages:
                  conversation,
              }),
          },
        );

      const data =
        (await response.json()) as {
          success?: boolean;
          answer?: string;
          error?: string;
        };

      if (
        !response.ok ||
        !data.success ||
        !data.answer
      ) {
        throw new Error(
          data.error ||
            "ORBIT n'a pas pu répondre.",
        );
      }

      setAssistantMessages(
        (messages) => [
          ...messages,
          {
            role:
              "assistant",
            content:
              data.answer!,
          },
        ],
      );
    } catch (assistantError) {
      setAssistantMessages(
        (messages) => [
          ...messages,
          {
            role:
              "assistant",
            content:
              assistantError instanceof
                Error
                ? `Problème temporaire : ${assistantError.message}`
                : "Problème temporaire.",
          },
        ],
      );
    } finally {
      setAssistantLoading(
        false,
      );
    }
  }

  const hasResults =
    listings.length > 0;

  const filteredListings =
    activeNav ===
    "favorites"
      ? favoriteListings
      : listings;

  if (!authReady) {
    return (
      <AuthBootScreen />
    );
  }

  if (showMarketingLanding) {
    return (
      <>
        <MarketingLanding
          user={authUser}
          onEnter={() =>
            setShowMarketingLanding(
              false,
            )
          }
          onSignIn={() =>
            setAuthMode(
              "signin",
            )
          }
          onSignUp={() =>
            setAuthMode(
              "signup",
            )
          }
        />

        {authMode && (
          <AuthModal
            mode={authMode}
            supabase={supabase}
            onClose={() =>
              setAuthMode(null)
            }
            onSwitch={(mode) =>
              setAuthMode(mode)
            }
            onContinue={() => {
              setAuthMode(null);
              setShowMarketingLanding(
                false,
              );
            }}
          />
        )}
      </>
    );
  }

  return (
    <main className="min-h-screen bg-[#050607] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-56 left-[18%] h-[520px] w-[520px] rounded-full bg-[#6e7bff]/[0.09] blur-[150px]" />
        <div className="absolute right-[4%] top-[38%] h-[460px] w-[460px] rounded-full bg-[#38bdf8]/[0.05] blur-[150px]" />
        <div className="absolute bottom-[-240px] left-[42%] h-[520px] w-[520px] rounded-full bg-[#8b5cf6]/[0.05] blur-[160px]" />
      </div>

      <Sidebar
        active={activeNav}
        recentCount={
          recentSearches.length
        }
        favoriteCount={
          favoriteUrls.length
        }
        user={authUser}
        onNavigate={
          setActiveNav
        }
        onNewSearch={
          resetSearch
        }
        onAssistant={() => {
          setShowAssistant(true);
          setActiveNav(
            "assistant",
          );
        }}
        onSignOut={() =>
          void handleSignOut()
        }
      />

      <div className="relative min-h-screen lg:pl-[92px]">
        <TopBar
          creditsUsed={
            creditsUsed
          }
          user={authUser}
          onCommand={() =>
            setShowCommand(true)
          }
          onAssistant={() =>
            setShowAssistant(true)
          }
          onSignOut={() =>
            void handleSignOut()
          }
        />

        <div className="mx-auto max-w-[1540px] px-4 pb-24 pt-5 sm:px-6 lg:px-8">
          {activeNav ===
          "history" ? (
            <HistoryView
              recentSearches={
                recentSearches
              }
              onSearch={(value) =>
                void handleSearch(
                  value,
                )
              }
            />
          ) : activeNav ===
            "assistant" ? (
            <AssistantFullPage
              messages={
                assistantMessages
              }
              input={
                assistantInput
              }
              loading={
                assistantLoading
              }
              onInput={
                setAssistantInput
              }
              onSend={() =>
                void sendAssistant()
              }
              onQuick={(q) =>
                void sendAssistant(
                  q,
                )
              }
            />
          ) : !searchedQuery &&
            !loading &&
            !error ? (
            <LandingView
              query={query}
              onQuery={setQuery}
              onSearch={() =>
                void handleSearch()
              }
              onExample={(value) => {
                setQuery(value);
                void handleSearch(
                  value,
                );
              }}
              inputRef={
                searchInputRef
              }
            />
          ) : (
            <ResultsView
              query={query}
              onQuery={setQuery}
              onSearch={() =>
                void handleSearch()
              }
              loading={loading}
              error={error}
              searchedQuery={
                searchedQuery
              }
              criteria={criteria}
              sources={sources}
              sourceCount={
                sourceCount
              }
              candidateCount={
                candidateCount
              }
              listings={
                filteredListings
              }
              allListingsCount={
                listings.length
              }
              activeNav={
                activeNav
              }
              hoveredId={
                hoveredListingId
              }
              favoriteUrls={
                favoriteUrls
              }
              onHover={
                setHoveredListingId
              }
              onOpen={(id) =>
                setSelectedListingId(
                  id,
                )
              }
              onFavorite={
                toggleFavorite
              }
              stageIndex={
                searchStageIndex
              }
            />
          )}
        </div>
      </div>

      {showCommand && (
        <CommandPalette
          query={query}
          recentSearches={
            recentSearches
          }
          onClose={() =>
            setShowCommand(false)
          }
          onSearch={(value) => {
            setQuery(value);
            void handleSearch(
              value,
            );
          }}
        />
      )}

      {showAssistant && (
        <AssistantDrawer
          messages={
            assistantMessages
          }
          input={
            assistantInput
          }
          loading={
            assistantLoading
          }
          onInput={
            setAssistantInput
          }
          onSend={() =>
            void sendAssistant()
          }
          onQuick={(q) =>
            void sendAssistant(q)
          }
          onClose={() =>
            setShowAssistant(false)
          }
        />
      )}

      {selectedListing && (
        <ListingModal
          listing={
            selectedListing
          }
          favorite={
            favoriteUrls.includes(
              selectedListing.url,
            )
          }
          onFavorite={() =>
            toggleFavorite(
              selectedListing,
            )
          }
          onClose={() =>
            setSelectedListingId(
              null,
            )
          }
        />
      )}
    </main>
  );
}


/* =========================================================
   PUBLIC LANDING / AUTH GATE
========================================================= */

function MarketingLanding({
  user,
  onEnter,
  onSignIn,
  onSignUp,
}: {
  user: User | null;
  onEnter: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  return (
    <main className="min-h-screen overflow-hidden bg-[#050607] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-44 h-[560px] w-[560px] rounded-full bg-[#6f7cff]/[0.10] blur-[170px]" />
        <div className="absolute right-[-120px] top-[18%] h-[520px] w-[520px] rounded-full bg-[#22d3ee]/[0.055] blur-[170px]" />
        <div className="absolute bottom-[-220px] left-[35%] h-[520px] w-[520px] rounded-full bg-[#8b5cf6]/[0.07] blur-[180px]" />
      </div>

      <header className="relative z-30 border-b border-white/[0.06] bg-[#050607]/70 backdrop-blur-2xl">
        <div className="mx-auto flex h-[76px] max-w-[1480px] items-center justify-between px-5 sm:px-7 lg:px-10">
          <button
            onClick={() =>
              window.scrollTo({
                top: 0,
                behavior: "smooth",
              })
            }
            className="flex items-center gap-3"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.11] bg-white text-black shadow-[0_12px_40px_rgba(255,255,255,0.12)]">
              <OrbitMark dark />
            </div>

            <div className="text-left">
              <div className="text-[12px] font-semibold tracking-[0.30em]">
                ORBIT
              </div>
              <div className="mt-0.5 text-[8px] uppercase tracking-[0.18em] text-white/25">
                Decision Intelligence
              </div>
            </div>
          </button>

          <nav className="hidden items-center gap-7 text-[11px] text-white/34 md:flex">
            <a
              href="#product"
              className="transition hover:text-white/75"
            >
              Produit
            </a>
            <a
              href="#how"
              className="transition hover:text-white/75"
            >
              Fonctionnement
            </a>
            <a
              href="#assistant"
              className="transition hover:text-white/75"
            >
              Assistant IA
            </a>
          </nav>

          <div className="flex items-center gap-2">
            {user ? (
              <button
                onClick={onEnter}
                className="rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-black transition hover:scale-[1.01] hover:bg-white/92"
              >
                Ouvrir ORBIT
              </button>
            ) : (
              <>
                <button
                  onClick={onSignIn}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 py-2.5 text-xs font-medium text-white/55 transition hover:bg-white/[0.06] hover:text-white"
                >
                  Se connecter
                </button>

                <button
                  onClick={onSignUp}
                  className="rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-black transition hover:scale-[1.01] hover:bg-white/92"
                >
                  S&apos;inscrire
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="relative z-10">
        <div className="mx-auto grid max-w-[1480px] gap-10 px-5 pb-14 pt-16 sm:px-7 sm:pt-20 lg:grid-cols-[0.94fr_1.06fr] lg:items-center lg:px-10 lg:pb-20 lg:pt-24">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3.5 py-2 text-[10px] uppercase tracking-[0.18em] text-white/35">
              <span className="h-1.5 w-1.5 rounded-full bg-[#9aa3ff] shadow-[0_0_15px_rgba(154,163,255,0.75)]" />
              AI-powered decision engine
            </div>

            <h1 className="mt-7 text-[54px] font-semibold leading-[0.94] tracking-[-0.065em] sm:text-[72px] lg:text-[82px] xl:text-[92px]">
              Le web est immense.
              <br />
              <span className="text-white/35">
                ORBIT le réduit à l&apos;essentiel.
              </span>
            </h1>

            <p className="mt-7 max-w-2xl text-[15px] leading-7 text-white/36 sm:text-[17px]">
              Décris ce que tu veux. ORBIT comprend tes critères,
              explore plusieurs sources, vérifie les données et classe
              les meilleures opportunités pour t&apos;aider à décider.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={onEnter}
                className="group inline-flex items-center justify-center gap-3 rounded-2xl bg-white px-6 py-4 text-sm font-semibold text-black shadow-[0_18px_60px_rgba(255,255,255,0.10)] transition hover:scale-[1.015]"
              >
                Découvrir ORBIT
                <span className="transition group-hover:translate-x-1">
                  →
                </span>
              </button>

              <button
                onClick={onSignUp}
                className="rounded-2xl border border-white/[0.09] bg-white/[0.025] px-6 py-4 text-sm font-medium text-white/58 transition hover:bg-white/[0.06] hover:text-white"
              >
                Créer un compte
              </button>
            </div>

            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-[10px] uppercase tracking-[0.14em] text-white/22">
              <span>Multi-source search</span>
              <span>ORBIT Score</span>
              <span>Assistant IA</span>
              <span>Comparaison intelligente</span>
            </div>

            <div className="mt-7 grid max-w-2xl gap-2 sm:grid-cols-3">
              <TrustPill
                value="Multi-source"
                label="moteur de recherche"
              />
              <TrustPill
                value="Temps réel"
                label="vérification web"
              />
              <TrustPill
                value="IA"
                label="assistant contextuel"
              />
            </div>
          </div>

          <LandingProductPreview
            onEnter={onEnter}
          />
        </div>
      </section>

      <section
        id="product"
        className="relative z-10 border-y border-white/[0.06] bg-white/[0.012]"
      >
        <div className="mx-auto max-w-[1480px] px-5 py-8 sm:px-7 lg:px-10">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <LandingMetric
              value="10"
              label="meilleures opportunités"
              detail="classées pour toi"
            />
            <LandingMetric
              value="Multi"
              label="sources simultanées"
              detail="web + portails"
            />
            <LandingMetric
              value="100"
              label="points ORBIT"
              detail="pour comparer"
            />
            <LandingMetric
              value="24/7"
              label="assistant IA"
              detail="pour t'aider à décider"
            />
          </div>
        </div>
      </section>

      <section
        id="how"
        className="relative z-10 mx-auto max-w-[1480px] px-5 py-20 sm:px-7 lg:px-10 lg:py-28"
      >
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <div className="text-[10px] uppercase tracking-[0.20em] text-white/22">
              Comment ça marche
            </div>

            <h2 className="mt-4 max-w-xl text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">
              Une requête.
              <br />
              Quatre couches de décision.
            </h2>

            <p className="mt-5 max-w-lg text-sm leading-7 text-white/32">
              ORBIT transforme une demande naturelle en critères,
              cherche, vérifie puis classe. L&apos;interface te montre
              seulement ce qui compte.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {SEARCH_STAGES.map(
              (
                stage,
                index,
              ) => (
                <LandingStep
                  key={stage.label}
                  index={
                    index + 1
                  }
                  title={
                    stage.label
                  }
                  text={
                    stage.detail
                  }
                />
              ),
            )}
          </div>
        </div>
      </section>

      <section
        id="assistant"
        className="relative z-10 mx-auto max-w-[1480px] px-5 pb-20 sm:px-7 lg:px-10 lg:pb-28"
      >
        <div className="overflow-hidden rounded-[34px] border border-white/[0.07] bg-[radial-gradient(circle_at_top_right,rgba(108,122,255,0.12),transparent_42%),rgba(255,255,255,0.02)]">
          <div className="grid gap-0 lg:grid-cols-[0.92fr_1.08fr]">
            <div className="p-7 sm:p-10 lg:p-12">
              <div className="text-[10px] uppercase tracking-[0.20em] text-white/22">
                ORBIT Assistant
              </div>

              <h3 className="mt-4 max-w-xl text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">
                Ne compare plus seul.
              </h3>

              <p className="mt-5 max-w-xl text-sm leading-7 text-white/33">
                Pose une question, affine un compromis ou demande
                pourquoi une opportunité est classée devant une autre.
                L&apos;assistant reste dans le contexte de ta décision.
              </p>

              <button
                onClick={onEnter}
                className="mt-7 rounded-2xl border border-white/[0.09] bg-white/[0.045] px-5 py-3 text-xs font-medium text-white/62 transition hover:bg-white hover:text-black"
              >
                Essayer l&apos;assistant →
              </button>
            </div>

            <AssistantPreviewCard />
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-[1480px] px-5 pb-20 sm:px-7 lg:px-10">
        <div className="rounded-[34px] border border-white/[0.07] bg-white/[0.025] px-6 py-12 text-center sm:px-10 sm:py-16">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black">
            <OrbitMark dark />
          </div>

          <h3 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">
            Ta prochaine décision commence ici.
          </h3>

          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-white/31">
            Recherche, compare, comprends. ORBIT rassemble tout dans
            une seule expérience.
          </p>

          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              onClick={onSignUp}
              className="rounded-2xl bg-white px-6 py-3.5 text-sm font-semibold text-black"
            >
              Créer mon compte
            </button>

            <button
              onClick={onEnter}
              className="rounded-2xl border border-white/[0.08] bg-black/20 px-6 py-3.5 text-sm text-white/55 transition hover:bg-white/[0.05] hover:text-white"
            >
              Explorer sans compte
            </button>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-4 px-5 py-7 text-[10px] text-white/20 sm:flex-row sm:items-center sm:justify-between sm:px-7 lg:px-10">
          <div className="flex items-center gap-2">
            <OrbitMark />
            <span className="tracking-[0.18em]">
              ORBIT
            </span>
          </div>

          <div className="flex flex-wrap gap-5">
            <span>Produit</span>
            <span>Confidentialité</span>
            <span>Conditions</span>
          </div>

          <div>
            © 2026 ORBIT
          </div>
        </div>
      </footer>
    </main>
  );
}

function LandingProductPreview({
  onEnter,
}: {
  onEnter: () => void;
}) {
  return (
    <div className="relative">
      <div className="absolute -inset-7 rounded-[42px] bg-[#7582ff]/[0.06] blur-3xl" />

      <div className="relative overflow-hidden rounded-[30px] border border-white/[0.10] bg-[#0a0b0d] shadow-[0_45px_160px_rgba(0,0,0,0.48)]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-white/18" />
            <div className="h-2 w-2 rounded-full bg-white/12" />
            <div className="h-2 w-2 rounded-full bg-white/8" />
          </div>

          <div className="text-[9px] uppercase tracking-[0.18em] text-white/20">
            ORBIT workspace
          </div>

          <div className="rounded-md border border-white/[0.06] px-2 py-1 text-[8px] text-white/20">
            Live
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="rounded-2xl border border-white/[0.07] bg-black/40 p-2">
            <div className="flex items-center gap-2 rounded-xl bg-white/[0.025] px-3 py-3">
              <span className="text-white/30">
                ✦
              </span>

              <div className="flex-1 text-[11px] text-white/42">
                Maison à Londres, 3 chambres, moins de 600 000 £
              </div>

              <button
                onClick={onEnter}
                className="rounded-lg bg-white px-3 py-2 text-[9px] font-semibold text-black"
              >
                Rechercher
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[0.72fr_1.28fr]">
            <div className="space-y-3">
              <PreviewPanel
                title="Interprétation"
                rows={[
                  [
                    "Lieu",
                    "London, UK",
                  ],
                  [
                    "Budget",
                    "600 000 £",
                  ],
                  [
                    "Chambres",
                    "3+",
                  ],
                ]}
              />

              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.018] p-3">
                <div className="text-[8px] uppercase tracking-[0.16em] text-white/18">
                  Search progress
                </div>

                <div className="mt-3 space-y-2">
                  {[
                    "Compréhension",
                    "Recherche",
                    "Vérification",
                    "Classement",
                  ].map(
                    (
                      label,
                      index,
                    ) => (
                      <div
                        key={label}
                        className="flex items-center gap-2 text-[9px]"
                      >
                        <div
                          className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                            index < 3
                              ? "border-white bg-white text-black"
                              : "border-[#9aa3ff]/40 text-[#aeb6ff]"
                          }`}
                        >
                          {index <
                          3
                            ? "✓"
                            : "4"}
                        </div>
                        <span className="text-white/28">
                          {
                            label
                          }
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <PreviewListing
                rank={1}
                price="£589,000"
                score={94}
                title="3 bedroom terraced house"
                place="London"
              />

              <PreviewListing
                rank={2}
                price="£575,000"
                score={91}
                title="Family house with garden"
                place="Greater London"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<
    [string, string]
  >;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.018] p-3">
      <div className="text-[8px] uppercase tracking-[0.16em] text-white/18">
        {title}
      </div>

      <div className="mt-3 space-y-2">
        {rows.map(
          ([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-lg border border-white/[0.045] bg-black/20 px-2.5 py-2 text-[9px]"
            >
              <span className="text-white/20">
                {label}
              </span>
              <span className="text-white/50">
                {value}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function PreviewListing({
  rank,
  price,
  score,
  title,
  place,
}: {
  rank: number;
  price: string;
  score: number;
  title: string;
  place: string;
}) {
  return (
    <div className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.018] transition hover:border-white/[0.13]">
      <div className="relative h-24 overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.08),transparent_35%),linear-gradient(135deg,#15181d,#0b0d10)]">
        <div className="absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] [background-size:20px_20px]" />
        <div className="absolute left-2.5 top-2.5 rounded-full border border-white/10 bg-black/40 px-2 py-1 text-[8px]">
          #{rank}
        </div>
        <div className="absolute bottom-2.5 right-2.5 rounded-full border border-white/10 bg-black/40 px-2 py-1 text-[8px]">
          Score {score}
        </div>
      </div>

      <div className="p-3">
        <div className="text-[11px] font-medium text-white/68">
          {title}
        </div>
        <div className="mt-1 text-[9px] text-white/22">
          {place}
        </div>
        <div className="mt-3 text-[15px] font-semibold tracking-[-0.03em]">
          {price}
        </div>
      </div>
    </div>
  );
}

function LandingMetric({
  value,
  label,
  detail,
}: {
  value: string;
  label: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.055] bg-black/15 p-4">
      <div className="text-2xl font-semibold tracking-[-0.04em]">
        {value}
      </div>
      <div className="mt-1 text-[10px] font-medium text-white/44">
        {label}
      </div>
      <div className="mt-1 text-[9px] text-white/20">
        {detail}
      </div>
    </div>
  );
}

function LandingStep({
  index,
  title,
  text,
}: {
  index: number;
  title: string;
  text: string;
}) {
  return (
    <div className="group rounded-[24px] border border-white/[0.065] bg-white/[0.018] p-5 transition hover:-translate-y-1 hover:border-white/[0.12] hover:bg-white/[0.03]">
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-[10px] text-white/40">
          0{index}
        </div>

        <div className="h-1.5 w-1.5 rounded-full bg-white/12 transition group-hover:bg-[#9aa3ff]" />
      </div>

      <h3 className="mt-5 text-base font-medium text-white/76">
        {title}
      </h3>

      <p className="mt-2 text-xs leading-6 text-white/28">
        {text}
      </p>
    </div>
  );
}

function AssistantPreviewCard() {
  return (
    <div className="border-t border-white/[0.06] bg-black/20 p-5 sm:p-7 lg:border-l lg:border-t-0 lg:p-8">
      <div className="rounded-[24px] border border-white/[0.07] bg-[#0a0b0d] p-4 shadow-[0_30px_100px_rgba(0,0,0,0.3)]">
        <div className="flex items-center justify-between border-b border-white/[0.055] pb-3">
          <div className="text-[9px] uppercase tracking-[0.17em] text-white/23">
            Conversation
          </div>
          <div className="flex items-center gap-1.5 text-[8px] text-white/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
            Online
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="ml-auto max-w-[78%] rounded-2xl bg-white px-3.5 py-2.5 text-[10px] leading-5 text-black">
            Pourquoi le résultat #1 est mieux classé ?
          </div>

          <div className="max-w-[84%] rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3 text-[10px] leading-5 text-white/45">
            Il correspond mieux au budget, possède une surface plus
            grande et son prix au m² est plus intéressant que les
            autres biens vérifiés.
          </div>

          <div className="ml-auto max-w-[68%] rounded-2xl bg-white px-3.5 py-2.5 text-[10px] leading-5 text-black">
            Et le principal compromis ?
          </div>

          <div className="max-w-[84%] rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3 text-[10px] leading-5 text-white/45">
            Il est légèrement plus éloigné du centre. ORBIT estime
            cependant que le rapport espace / prix compense cet écart.
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2.5">
          <div className="flex-1 text-[9px] text-white/18">
            Demande quelque chose à ORBIT...
          </div>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[10px] text-black">
            ↑
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthModal({
  mode,
  supabase,
  onClose,
  onSwitch,
  onContinue,
}: {
  mode: "signin" | "signup";
  supabase: ReturnType<
    typeof createClient
  >;
  onClose: () => void;
  onSwitch: (
    mode: "signin" | "signup",
  ) => void;
  onContinue: () => void;
}) {
  const [email, setEmail] =
    useState("");

  const [
    password,
    setPassword,
  ] = useState("");

  const [name, setName] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [authError, setAuthError] =
    useState("");

  const isSignup =
    mode === "signup";

  async function handleSubmit(
    event:
      React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setLoading(true);
    setMessage("");
    setAuthError("");

    try {
      if (isSignup) {
        const {
          data,
          error,
        } =
          await supabase.auth.signUp({
            email:
              email.trim(),
            password,
            options: {
              data: {
                name:
                  name.trim(),
                full_name:
                  name.trim(),
              },
            },
          });

        if (error) {
          throw error;
        }

        if (
          data.session
        ) {
          onContinue();
          return;
        }

        setMessage(
          "Compte créé. Vérifie ton e-mail pour confirmer l'inscription.",
        );
      } else {
        const {
          error,
        } =
          await supabase.auth.signInWithPassword({
            email:
              email.trim(),
            password,
          });

        if (error) {
          throw error;
        }

        onContinue();
      }
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Impossible de terminer l'authentification.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    setMessage("");
    setAuthError("");

    try {
      const {
        error,
      } =
        await supabase.auth.signInWithOAuth({
          provider:
            "google",
          options: {
            redirectTo:
              "https://ubiquitous-barnacle-6v4gqw45g7qg35qg7-3000.app.github.dev/auth/callback",
          },
        });

      if (error) {
        throw error;
      }
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Connexion Google impossible.",
      );
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/72 p-4 backdrop-blur-xl"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(
          event,
        ) =>
          event.stopPropagation()
        }
        className="relative w-full max-w-[440px] overflow-hidden rounded-[30px] border border-white/[0.10] bg-[#0a0b0d] shadow-[0_50px_180px_rgba(0,0,0,0.78)]"
      >
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-[#7480ff]/[0.14] blur-[90px]" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-52 w-52 rounded-full bg-[#22d3ee]/[0.06] blur-[90px]" />

        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-white/35 transition hover:text-white"
        >
          ×
        </button>

        <div className="relative p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-black">
              <OrbitMark dark />
            </div>

            <div className="rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[9px] uppercase tracking-[0.13em] text-white/24">
              Secure access
            </div>
          </div>

          <h2 className="mt-6 text-3xl font-semibold tracking-[-0.05em]">
            {isSignup
              ? "Créer ton compte"
              : "Bon retour sur ORBIT"}
          </h2>

          <p className="mt-2 text-xs leading-6 text-white/28">
            {isSignup
              ? "Sauvegarde tes recherches, tes favoris et retrouve tes décisions sur tous tes appareils."
              : "Connecte-toi pour reprendre exactement là où tu t'étais arrêté."}
          </p>

          {authError && (
            <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[11px] leading-5 text-red-200/80">
              {authError}
            </div>
          )}

          {message && (
            <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3 text-[11px] leading-5 text-emerald-200/80">
              {message}
            </div>
          )}

          <form
            onSubmit={
              handleSubmit
            }
            className="mt-6 space-y-3"
          >
            {isSignup && (
              <AuthField
                label="Nom"
                type="text"
                value={name}
                onChange={
                  setName
                }
                autoComplete="name"
                placeholder="Ton nom"
              />
            )}

            <AuthField
              label="E-mail"
              type="email"
              value={email}
              onChange={
                setEmail
              }
              autoComplete="email"
              placeholder="toi@exemple.com"
            />

            <AuthField
              label="Mot de passe"
              type="password"
              value={
                password
              }
              onChange={
                setPassword
              }
              autoComplete={
                isSignup
                  ? "new-password"
                  : "current-password"
              }
              placeholder="••••••••"
            />

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-2xl bg-white px-4 py-3.5 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-wait disabled:opacity-50"
            >
              {loading
                ? "Connexion..."
                : isSignup
                  ? "Créer mon compte"
                  : "Se connecter"}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-[9px] uppercase tracking-[0.14em] text-white/18">
              ou
            </span>
            <div className="h-px flex-1 bg-white/[0.06]" />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() =>
              void handleGoogle()
            }
            className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5 text-xs text-white/55 transition hover:bg-white/[0.055] hover:text-white disabled:opacity-45"
          >
            <GoogleMark />
            Continuer avec Google
          </button>

          <div className="mt-5 text-center text-[10px] text-white/24">
            {isSignup
              ? "Tu as déjà un compte ?"
              : "Pas encore de compte ?"}{" "}
            <button
              type="button"
              onClick={() =>
                onSwitch(
                  isSignup
                    ? "signin"
                    : "signup",
                )
              }
              className="font-medium text-white/60 hover:text-white"
            >
              {isSignup
                ? "Se connecter"
                : "S'inscrire"}
            </button>
          </div>

          <div className="mt-6 border-t border-white/[0.055] pt-4 text-center text-[9px] leading-5 text-white/16">
            En continuant, tu acceptes les conditions d&apos;utilisation et la politique de confidentialité d&apos;ORBIT.
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthField({
  label,
  type,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (
    value: string,
  ) => void;
  autoComplete: string;
  placeholder: string;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] font-medium text-white/32">
        {label}
      </div>

      <input
        type={type}
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value,
          )
        }
        autoComplete={
          autoComplete
        }
        placeholder={
          placeholder
        }
        required
        className="w-full rounded-2xl border border-white/[0.075] bg-black/30 px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/16 focus:border-white/[0.16] focus:bg-white/[0.025]"
      />
    </label>
  );
}

/* =========================================================
   SIDEBAR
========================================================= */

function Sidebar({
  active,
  recentCount,
  favoriteCount,
  user,
  onNavigate,
  onNewSearch,
  onAssistant,
  onSignOut,
}: {
  active:
    | "search"
    | "history"
    | "favorites"
    | "assistant";
  recentCount: number;
  favoriteCount: number;
  user: User | null;
  onNavigate: (
    value:
      | "search"
      | "history"
      | "favorites"
      | "assistant",
  ) => void;
  onNewSearch: () => void;
  onAssistant: () => void;
  onSignOut: () => void;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-[92px] border-r border-white/[0.07] bg-[#060708]/90 backdrop-blur-2xl lg:flex lg:flex-col lg:items-center">
      <button
        onClick={onNewSearch}
        className="mt-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.1] bg-white text-black shadow-[0_10px_40px_rgba(255,255,255,0.12)] transition hover:scale-[1.03]"
        title="Nouvelle recherche"
      >
        <OrbitMark dark />
      </button>

      <div className="mt-8 flex flex-1 flex-col items-center gap-2">
        <SideButton
          active={
            active === "search"
          }
          icon="⌕"
          label="Recherche"
          onClick={() =>
            onNavigate(
              "search",
            )
          }
        />

        <SideButton
          active={
            active ===
            "history"
          }
          icon="↺"
          label="Historique"
          badge={
            recentCount
          }
          onClick={() =>
            onNavigate(
              "history",
            )
          }
        />

        <SideButton
          active={
            active ===
            "favorites"
          }
          icon="♡"
          label="Favoris"
          badge={
            favoriteCount
          }
          onClick={() =>
            onNavigate(
              "favorites",
            )
          }
        />

        <SideButton
          active={
            active ===
            "assistant"
          }
          icon="✦"
          label="Assistant"
          onClick={
            onAssistant
          }
        />
      </div>

      <div className="mb-5 flex flex-col items-center gap-2">
        <div
          title={
            user?.email ??
            "Compte"
          }
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[11px] font-semibold text-white/55"
        >
          {getUserInitial(
            user,
          )}
        </div>

        {user && (
          <button
            onClick={onSignOut}
            title="Se déconnecter"
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-transparent text-[12px] text-white/20 transition hover:border-white/[0.06] hover:bg-white/[0.035] hover:text-white/55"
          >
            ↪
          </button>
        )}
      </div>
    </aside>
  );
}

function SideButton({
  active,
  icon,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`relative flex h-12 w-12 items-center justify-center rounded-2xl border text-lg transition ${
        active
          ? "border-white/[0.12] bg-white/[0.09] text-white"
          : "border-transparent text-white/30 hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-white/70"
      }`}
    >
      {icon}

      {Boolean(badge) && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[9px] font-semibold text-black">
          {badge}
        </span>
      )}
    </button>
  );
}

/* =========================================================
   TOP BAR
========================================================= */

function TopBar({
  creditsUsed,
  user,
  onCommand,
  onAssistant,
  onSignOut,
}: {
  creditsUsed:
    | number
    | null;
  user: User | null;
  onCommand: () => void;
  onAssistant: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#050607]/72 backdrop-blur-2xl">
      <div className="mx-auto flex h-[70px] max-w-[1540px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-black">
            <OrbitMark dark />
          </div>

          <div>
            <div className="text-xs font-semibold tracking-[0.3em]">
              ORBIT
            </div>
            <div className="mt-0.5 text-[8px] uppercase tracking-[0.16em] text-white/25">
              Decision Intelligence
            </div>
          </div>
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/25">
            ORBIT
          </div>

          <div className="h-1 w-1 rounded-full bg-white/20" />

          <div className="text-[11px] text-white/30">
            Recherche & décision
          </div>
        </div>

        <div className="flex items-center gap-2">
          {creditsUsed !==
            null && (
            <div className="hidden rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[10px] text-white/30 sm:block">
              {creditsUsed} crédits
            </div>
          )}

          <button
            onClick={onCommand}
            className="hidden items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs text-white/40 transition hover:bg-white/[0.06] hover:text-white md:flex"
          >
            <span>Recherche rapide</span>
            <span className="rounded-md border border-white/[0.08] bg-black/30 px-1.5 py-0.5 text-[9px]">
              Ctrl K
            </span>
          </button>

          <button
            onClick={
              onAssistant
            }
            className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-xs font-medium text-white/65 transition hover:bg-white/[0.08] hover:text-white"
          >
            ✦ Assistant
          </button>

          {user && (
            <div className="group relative">
              <button className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 text-xs text-white/45 transition hover:bg-white/[0.06]">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white text-[9px] font-semibold text-black">
                  {getUserInitial(
                    user,
                  )}
                </span>

                <span className="hidden max-w-[120px] truncate lg:block">
                  {getUserLabel(
                    user,
                  )}
                </span>
              </button>

              <div className="invisible absolute right-0 top-[calc(100%+8px)] w-56 translate-y-1 rounded-2xl border border-white/[0.08] bg-[#0a0b0d] p-2 opacity-0 shadow-[0_24px_80px_rgba(0,0,0,0.5)] transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                <div className="px-3 py-2">
                  <div className="text-[10px] font-medium text-white/55">
                    {getUserLabel(
                      user,
                    )}
                  </div>
                  <div className="mt-1 truncate text-[9px] text-white/20">
                    {user.email}
                  </div>
                </div>

                <div className="my-1 h-px bg-white/[0.05]" />

                <button
                  onClick={onSignOut}
                  className="w-full rounded-xl px-3 py-2.5 text-left text-[10px] text-white/35 transition hover:bg-white/[0.04] hover:text-white/70"
                >
                  Se déconnecter
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/* =========================================================
   LANDING
========================================================= */

function LandingView({
  query,
  onQuery,
  onSearch,
  onExample,
  inputRef,
}: {
  query: string;
  onQuery: (
    value: string,
  ) => void;
  onSearch: () => void;
  onExample: (
    value: string,
  ) => void;
  inputRef:
    React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <>
      <section className="relative overflow-hidden rounded-[34px] border border-white/[0.07] bg-[linear-gradient(140deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] px-5 py-14 shadow-[0_50px_180px_rgba(0,0,0,0.42)] sm:px-9 sm:py-20 lg:px-14 lg:py-24">
        <div className="pointer-events-none absolute -right-24 -top-24 h-[360px] w-[360px] rounded-full border border-white/[0.05] bg-white/[0.015]" />
        <div className="pointer-events-none absolute right-10 top-8 h-[210px] w-[210px] rounded-full border border-white/[0.04]" />
        <div className="pointer-events-none absolute bottom-[-170px] left-[18%] h-[340px] w-[340px] rounded-full bg-[#6976ff]/[0.1] blur-[120px]" />

        <div className="relative max-w-5xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-black/20 px-3.5 py-2 text-[10px] uppercase tracking-[0.18em] text-white/35">
            <span className="h-1.5 w-1.5 rounded-full bg-[#9aa3ff] shadow-[0_0_14px_rgba(154,163,255,0.8)]" />
            Live decision engine
          </div>

          <h1 className="mt-7 max-w-5xl text-[48px] font-semibold leading-[0.95] tracking-[-0.065em] sm:text-[72px] lg:text-[92px]">
            Cherche moins.
            <br />
            <span className="text-white/38">
              Décide mieux.
            </span>
          </h1>

          <p className="mt-7 max-w-2xl text-[15px] leading-7 text-white/36 sm:text-[17px]">
            ORBIT comprend ta demande, parcourt le web, vérifie les annonces et te présente les meilleures opportunités dans une interface pensée pour décider.
          </p>

          <div className="mt-10 max-w-5xl rounded-[28px] border border-white/[0.12] bg-black/40 p-2 shadow-[0_28px_100px_rgba(0,0,0,0.38)] backdrop-blur-xl">
            <div className="flex flex-col gap-2 rounded-[22px] border border-white/[0.05] bg-white/[0.025] p-2 sm:flex-row sm:items-center">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.035] text-lg text-white/50">
                ✦
              </div>

              <input
                ref={inputRef}
                value={query}
                onChange={(event) =>
                  onQuery(
                    event.target.value,
                  )
                }
                onKeyDown={(event) => {
                  if (
                    event.key ===
                    "Enter"
                  ) {
                    onSearch();
                  }
                }}
                placeholder="Décris exactement ce que tu recherches..."
                className="min-w-0 flex-1 bg-transparent px-3 py-3 text-[16px] text-white outline-none placeholder:text-white/20 sm:text-[18px]"
              />

              <button
                onClick={onSearch}
                disabled={
                  !query.trim()
                }
                className="rounded-2xl bg-white px-6 py-3.5 text-sm font-semibold text-black transition hover:scale-[1.01] hover:bg-white/92 disabled:cursor-not-allowed disabled:opacity-25"
              >
                Lancer ORBIT
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLES.map(
              (example) => (
                <button
                  key={example}
                  onClick={() =>
                    onExample(
                      example,
                    )
                  }
                  className="rounded-full border border-white/[0.07] bg-white/[0.02] px-3.5 py-2 text-[11px] text-white/32 transition hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-white/70"
                >
                  {example}
                </button>
              ),
            )}
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-[28px] border border-white/[0.07] bg-white/[0.022] p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/22">
                Comment ça marche
              </div>

              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                Une recherche. Quatre couches.
              </h2>
            </div>

            <div className="hidden rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[10px] text-white/25 sm:block">
              Multi-source
            </div>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            {SEARCH_STAGES.map(
              (
                stage,
                index,
              ) => (
                <ProcessCard
                  key={
                    stage.label
                  }
                  index={
                    index + 1
                  }
                  title={
                    stage.label
                  }
                  text={
                    stage.detail
                  }
                />
              ),
            )}
          </div>
        </div>

        <div className="rounded-[28px] border border-white/[0.07] bg-[radial-gradient(circle_at_top_right,rgba(104,117,255,0.13),transparent_48%),rgba(255,255,255,0.022)] p-6 sm:p-8">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/22">
            ORBIT Score
          </div>

          <div className="mt-5 flex items-end gap-3">
            <div className="text-6xl font-semibold tracking-[-0.07em]">
              92
            </div>
            <div className="pb-2 text-sm text-white/30">
              / 100
            </div>
          </div>

          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full w-[92%] rounded-full bg-white" />
          </div>

          <p className="mt-6 text-sm leading-7 text-white/33">
            Un score de décision qui combine correspondance avec tes critères, qualité des données et valeur relative du bien.
          </p>
        </div>
      </section>
    </>
  );
}

function ProcessCard({
  index,
  title,
  text,
}: {
  index: number;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.055] bg-black/20 p-4 transition hover:border-white/[0.11] hover:bg-white/[0.03]">
      <div className="text-[10px] text-white/20">
        0{index}
      </div>
      <div className="mt-3 text-sm font-medium">
        {title}
      </div>
      <div className="mt-2 text-xs leading-6 text-white/28">
        {text}
      </div>
    </div>
  );
}

/* =========================================================
   RESULTS
========================================================= */

function ResultsView({
  query,
  onQuery,
  onSearch,
  loading,
  error,
  searchedQuery,
  criteria,
  sources,
  sourceCount,
  candidateCount,
  listings,
  allListingsCount,
  activeNav,
  hoveredId,
  favoriteUrls,
  onHover,
  onOpen,
  onFavorite,
  stageIndex,
}: {
  query: string;
  onQuery: (
    value: string,
  ) => void;
  onSearch: () => void;
  loading: boolean;
  error: string;
  searchedQuery: string;
  criteria:
    | RealEstateCriteria
    | null;
  sources: WebSource[];
  sourceCount: number;
  candidateCount: number;
  listings: Listing[];
  allListingsCount: number;
  activeNav:
    | "search"
    | "history"
    | "favorites"
    | "assistant";
  hoveredId:
    | string
    | null;
  favoriteUrls: string[];
  onHover: (
    value:
      | string
      | null,
  ) => void;
  onOpen: (
    id: string,
  ) => void;
  onFavorite: (
    listing: Listing,
  ) => void;
  stageIndex: number;
}) {
  return (
    <div className="space-y-5">
      <section className="rounded-[26px] border border-white/[0.07] bg-white/[0.022] p-3 shadow-[0_30px_100px_rgba(0,0,0,0.25)]">
        <div className="flex flex-col gap-2 rounded-[20px] border border-white/[0.05] bg-black/30 p-2 sm:flex-row sm:items-center">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-white/45">
            ⌕
          </div>

          <input
            value={query}
            onChange={(event) =>
              onQuery(
                event.target.value,
              )
            }
            onKeyDown={(event) => {
              if (
                event.key ===
                "Enter"
              ) {
                onSearch();
              }
            }}
            className="min-w-0 flex-1 bg-transparent px-3 py-3 text-[15px] outline-none placeholder:text-white/20"
            placeholder="Modifie ta recherche..."
          />

          <button
            onClick={onSearch}
            disabled={
              !query.trim() ||
              loading
            }
            className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition disabled:opacity-30"
          >
            Rechercher
          </button>
        </div>
      </section>

      {loading && (
        <SearchToolCard
          query={query}
          stageIndex={
            stageIndex
          }
        />
      )}

      {error && (
        <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] p-4 text-sm text-red-200/80">
          {error}
        </div>
      )}

      {!loading &&
        Boolean(
          searchedQuery,
        ) && (
          <div className="grid gap-5 xl:grid-cols-[290px_1fr]">
            <aside className="space-y-4">
              <CriteriaPanel
                criteria={
                  criteria
                }
                sourceCount={
                  sourceCount
                }
                candidateCount={
                  candidateCount
                }
                listingCount={
                  allListingsCount
                }
              />

              <SourcesPanel
                sources={
                  sources
                }
              />
            </aside>

            <section>
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-white/22">
                    {activeNav ===
                    "favorites"
                      ? "Favoris"
                      : "Résultats vérifiés"}
                  </div>

                  <h2 className="mt-2 text-3xl font-semibold tracking-[-0.045em]">
                    {listings.length}{" "}
                    {listings.length >
                    1
                      ? "opportunités"
                      : "opportunité"}
                  </h2>

                  <p className="mt-2 max-w-2xl text-xs leading-6 text-white/30">
                    {searchedQuery}
                  </p>
                </div>

                <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[10px] text-white/28">
                  Triées par ORBIT Score
                </div>
              </div>

              {listings.length ===
              0 ? (
                <EmptyResults
                  activeNav={
                    activeNav
                  }
                />
              ) : (
                <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {listings.map(
                    (
                      listing,
                      index,
                    ) => (
                      <PropertyCard
                        key={
                          listing.id
                        }
                        listing={
                          listing
                        }
                        rank={
                          index + 1
                        }
                        faded={
                          Boolean(
                            hoveredId,
                          ) &&
                          hoveredId !==
                            listing.id
                        }
                        favorite={
                          favoriteUrls.includes(
                            listing.url,
                          )
                        }
                        onHover={
                          onHover
                        }
                        onOpen={
                          onOpen
                        }
                        onFavorite={
                          onFavorite
                        }
                      />
                    ),
                  )}
                </div>
              )}
            </section>
          </div>
        )}
    </div>
  );
}

function SearchToolCard({
  query,
  stageIndex,
}: {
  query: string;
  stageIndex: number;
}) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#0a0b0d] shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.19em] text-white/24">
            ORBIT Search Tool
          </div>
          <div className="mt-1 text-sm text-white/65">
            {query}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[10px] text-white/35">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#9aa3ff]" />
          Recherche
        </div>
      </div>

      <div className="grid gap-0 sm:grid-cols-4">
        {SEARCH_STAGES.map(
          (
            stage,
            index,
          ) => {
            const done =
              index <
              stageIndex;

            const active =
              index ===
              stageIndex;

            return (
              <div
                key={
                  stage.label
                }
                className="relative border-b border-white/[0.05] p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
              >
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border text-[10px] ${
                    done
                      ? "border-white bg-white text-black"
                      : active
                        ? "border-[#9aa3ff]/40 bg-[#9aa3ff]/10 text-[#c7ccff]"
                        : "border-white/[0.07] text-white/20"
                  }`}
                >
                  {done
                    ? "✓"
                    : index +
                      1}
                </div>

                <div className="mt-3 text-xs font-medium text-white/70">
                  {stage.label}
                </div>

                <div className="mt-1.5 text-[10px] leading-5 text-white/24">
                  {stage.detail}
                </div>

                {active && (
                  <div className="absolute inset-x-4 bottom-0 h-px overflow-hidden bg-white/[0.04]">
                    <div className="h-full w-1/2 animate-pulse bg-[#9aa3ff]" />
                  </div>
                )}
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}

/* =========================================================
   PROPERTY CARD / FOCUS EFFECT
========================================================= */

function PropertyCard({
  listing,
  rank,
  faded,
  favorite,
  onHover,
  onOpen,
  onFavorite,
}: {
  listing: Listing;
  rank: number;
  faded: boolean;
  favorite: boolean;
  onHover: (
    value:
      | string
      | null,
  ) => void;
  onOpen: (
    id: string,
  ) => void;
  onFavorite: (
    listing: Listing,
  ) => void;
}) {
  const image =
    firstImage(listing);

  return (
    <article
      onMouseEnter={() =>
        onHover(
          listing.id,
        )
      }
      onMouseLeave={() =>
        onHover(null)
      }
      className={`group overflow-hidden rounded-[24px] border border-white/[0.07] bg-[#0a0b0d] transition duration-300 ${
        faded
          ? "scale-[0.985] opacity-35"
          : "opacity-100 hover:-translate-y-1 hover:border-white/[0.14] hover:shadow-[0_30px_80px_rgba(0,0,0,0.35)]"
      }`}
    >
      <div className="relative aspect-[1.45/1] overflow-hidden bg-white/[0.025]">
        {image ? (
          <img
            src={image}
            alt={
              listing.title
            }
            className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.045]"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.045),transparent_60%)] text-white/20">
            <div className="text-4xl">
              ⌂
            </div>
            <div className="mt-2 text-xs">
              Photo non disponible
            </div>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent" />

        <div className="absolute left-3 top-3 flex items-center gap-2">
          <div className="rounded-full border border-white/10 bg-black/55 px-2.5 py-1.5 text-[10px] backdrop-blur-xl">
            #{rank}
          </div>

          <div className="rounded-full border border-white/10 bg-black/55 px-2.5 py-1.5 text-[10px] text-white/70 backdrop-blur-xl">
            {propertyKindLabel(
              listing.propertyKind,
            )}
          </div>
        </div>

        <button
          onClick={(event) => {
            event.stopPropagation();
            onFavorite(
              listing,
            );
          }}
          className={`absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-xl transition ${
            favorite
              ? "border-white bg-white text-black"
              : "border-white/10 bg-black/55 text-white/75 hover:bg-white hover:text-black"
          }`}
        >
          {favorite
            ? "♥"
            : "♡"}
        </button>

        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/45">
              ORBIT Score
            </div>
            <div className="mt-0.5 text-2xl font-semibold tracking-[-0.04em]">
              {Math.round(
                listing.orbitScore,
              )}
            </div>
          </div>

          <div className="rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[10px] text-white/60 backdrop-blur-xl">
            {scoreLabel(
              listing.orbitScore,
            )}
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-[15px] font-medium leading-6 text-white/88">
              {listing.title}
            </h3>

            <div className="mt-1.5 truncate text-xs text-white/30">
              {listing.location ??
                "Localisation non confirmée"}
            </div>
          </div>
        </div>

        <div className="mt-4 text-[22px] font-semibold tracking-[-0.04em]">
          {formatPrice(
            listing.price,
            listing.currency,
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <MiniStat
            label="Surface"
            value={formatSurface(
              listing.surface,
            )}
          />
          <MiniStat
            label="Chambres"
            value={
              listing.bedrooms !==
              undefined
                ? String(
                    listing.bedrooms,
                  )
                : "—"
            }
          />
          <MiniStat
            label="SDB"
            value={
              listing.bathrooms !==
              undefined
                ? String(
                    listing.bathrooms,
                  )
                : "—"
            }
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {listing.garden && (
            <Tag>
              Jardin
            </Tag>
          )}
          {listing.garage && (
            <Tag>
              Garage
            </Tag>
          )}
          {listing.pool && (
            <Tag>
              Piscine
            </Tag>
          )}
          {listing.terrace && (
            <Tag>
              Terrasse
            </Tag>
          )}
          {listing.parking && (
            <Tag>
              Parking
            </Tag>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-white/[0.055] pt-4">
          <div className="text-[10px] text-white/22">
            {safeHost(
              listing.url,
            )}
          </div>

          <button
            onClick={() =>
              onOpen(
                listing.id,
              )
            }
            className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-3.5 py-2 text-[11px] font-medium text-white/58 transition hover:bg-white hover:text-black"
          >
            Voir l'analyse ↗
          </button>
        </div>
      </div>
    </article>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="border-r border-white/[0.06] px-3 py-3 last:border-r-0">
      <div className="text-[9px] uppercase tracking-[0.12em] text-white/20">
        {label}
      </div>
      <div className="mt-1 text-xs font-medium text-white/65">
        {value}
      </div>
    </div>
  );
}

function Tag({
  children,
}: {
  children:
    React.ReactNode;
}) {
  return (
    <span className="rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1 text-[9px] text-white/36">
      {children}
    </span>
  );
}

/* =========================================================
   CRITERIA / SOURCES
========================================================= */

function CriteriaPanel({
  criteria,
  sourceCount,
  candidateCount,
  listingCount,
}: {
  criteria:
    | RealEstateCriteria
    | null;
  sourceCount: number;
  candidateCount: number;
  listingCount: number;
}) {
  return (
    <div className="rounded-[22px] border border-white/[0.07] bg-white/[0.022] p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-white/22">
        Interprétation
      </div>

      <div className="mt-4 space-y-2">
        <CriteriaRow
          label="Lieu"
          value={
            criteria?.location ??
            "—"
          }
        />
        <CriteriaRow
          label="Type"
          value={
            criteria?.propertyType ??
            "Immobilier"
          }
        />
        <CriteriaRow
          label="Budget"
          value={
            criteria?.budgetMax
              ? formatPrice(
                  criteria.budgetMax,
                  criteria.currency,
                )
              : "Non précisé"
          }
        />
        <CriteriaRow
          label="Surface min."
          value={
            criteria?.minSurface
              ? `${criteria.minSurface} m²`
              : "—"
          }
        />
        <CriteriaRow
          label="Chambres min."
          value={
            criteria?.minBedrooms
              ? String(
                  criteria.minBedrooms,
                )
              : "—"
          }
        />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <Metric
          value={
            sourceCount
          }
          label="Sources"
        />
        <Metric
          value={
            candidateCount
          }
          label="Candidats"
        />
        <Metric
          value={
            listingCount
          }
          label="Final"
        />
      </div>
    </div>
  );
}

function CriteriaRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-black/20 px-3 py-2.5">
      <span className="text-[10px] text-white/24">
        {label}
      </span>
      <span className="max-w-[160px] truncate text-right text-[10px] font-medium text-white/55">
        {value}
      </span>
    </div>
  );
}

function Metric({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 text-center">
      <div className="text-lg font-semibold">
        {value}
      </div>
      <div className="mt-1 text-[8px] uppercase tracking-[0.12em] text-white/20">
        {label}
      </div>
    </div>
  );
}

function SourcesPanel({
  sources,
}: {
  sources: WebSource[];
}) {
  const [open, setOpen] =
    useState(false);

  return (
    <div className="rounded-[22px] border border-white/[0.07] bg-white/[0.022] p-4">
      <button
        onClick={() =>
          setOpen(
            (value) => !value,
          )
        }
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/22">
            Sources
          </div>
          <div className="mt-1 text-xs text-white/45">
            {sources.length} domaines
          </div>
        </div>

        <div className="text-white/25">
          {open
            ? "−"
            : "+"}
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-2">
          {sources
            .slice(0, 10)
            .map(
              (source) => (
                <a
                  key={
                    source.id
                  }
                  href={
                    source.url
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl border border-white/[0.05] bg-black/20 px-3 py-2.5 transition hover:bg-white/[0.04]"
                >
                  <div className="truncate text-[10px] font-medium text-white/48">
                    {
                      source.source
                    }
                  </div>
                  <div className="mt-1 line-clamp-1 text-[9px] text-white/22">
                    {
                      source.title
                    }
                  </div>
                </a>
              ),
            )}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   HISTORY
========================================================= */

function HistoryView({
  recentSearches,
  onSearch,
}: {
  recentSearches:
    RecentSearch[];
  onSearch: (
    value: string,
  ) => void;
}) {
  return (
    <section className="rounded-[28px] border border-white/[0.07] bg-white/[0.022] p-6 sm:p-8">
      <div className="text-[10px] uppercase tracking-[0.2em] text-white/22">
        Historique
      </div>

      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
        Tes recherches récentes
      </h1>

      <div className="mt-7 space-y-3">
        {recentSearches.length ===
        0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.08] p-8 text-center text-sm text-white/25">
            Aucune recherche enregistrée.
          </div>
        ) : (
          recentSearches.map(
            (item) => (
              <button
                key={
                  `${item.query}-${item.at}`
                }
                onClick={() =>
                  onSearch(
                    item.query,
                  )
                }
                className="group flex w-full items-center justify-between gap-4 rounded-2xl border border-white/[0.06] bg-black/20 px-4 py-4 text-left transition hover:border-white/[0.12] hover:bg-white/[0.035]"
              >
                <div>
                  <div className="text-sm text-white/70">
                    {item.query}
                  </div>
                  <div className="mt-1 text-[10px] text-white/22">
                    {new Date(
                      item.at,
                    ).toLocaleString(
                      "fr-FR",
                    )}
                  </div>
                </div>

                <div className="text-white/20 transition group-hover:translate-x-1 group-hover:text-white/55">
                  →
                </div>
              </button>
            ),
          )
        )}
      </div>
    </section>
  );
}

/* =========================================================
   ASSISTANT
========================================================= */

function AssistantFullPage({
  messages,
  input,
  loading,
  onInput,
  onSend,
  onQuick,
}: {
  messages:
    AssistantMessage[];
  input: string;
  loading: boolean;
  onInput: (
    value: string,
  ) => void;
  onSend: () => void;
  onQuick: (
    value: string,
  ) => void;
}) {
  return (
    <section className="mx-auto max-w-5xl rounded-[30px] border border-white/[0.07] bg-white/[0.022] p-4 sm:p-6">
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/22">
            ORBIT Assistant
          </div>
          <div className="mt-1 text-sm text-white/55">
            Assistant de décision
          </div>
        </div>

        <div className="rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[9px] text-white/28">
          OpenAI connected
        </div>
      </div>

      <AssistantConversation
        messages={messages}
        input={input}
        loading={loading}
        onInput={onInput}
        onSend={onSend}
        onQuick={onQuick}
      />
    </section>
  );
}

function AssistantDrawer({
  messages,
  input,
  loading,
  onInput,
  onSend,
  onQuick,
  onClose,
}: {
  messages:
    AssistantMessage[];
  input: string;
  loading: boolean;
  onInput: (
    value: string,
  ) => void;
  onSend: () => void;
  onQuick: (
    value: string,
  ) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] bg-black/55 backdrop-blur-sm">
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-white/[0.08] bg-[#08090b] shadow-[-30px_0_100px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/22">
              ORBIT Assistant
            </div>
            <div className="mt-1 text-sm text-white/55">
              Pose n'importe quelle question.
            </div>
          </div>

          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-white/40 transition hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <AssistantConversation
            messages={
              messages
            }
            input={input}
            loading={
              loading
            }
            onInput={
              onInput
            }
            onSend={
              onSend
            }
            onQuick={
              onQuick
            }
          />
        </div>
      </div>
    </div>
  );
}

function AssistantConversation({
  messages,
  input,
  loading,
  onInput,
  onSend,
  onQuick,
}: {
  messages:
    AssistantMessage[];
  input: string;
  loading: boolean;
  onInput: (
    value: string,
  ) => void;
  onSend: () => void;
  onQuick: (
    value: string,
  ) => void;
}) {
  return (
    <div className="flex min-h-[560px] flex-col">
      <div className="flex-1 space-y-3 py-5">
        {messages.map(
          (
            message,
            index,
          ) => (
            <div
              key={index}
              className={`flex ${
                message.role ===
                "user"
                  ? "justify-end"
                  : "justify-start"
              }`}
            >
              <div
                className={`max-w-[84%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                  message.role ===
                  "user"
                    ? "bg-white text-black"
                    : "border border-white/[0.07] bg-white/[0.035] text-white/62"
                }`}
              >
                {
                  message.content
                }
              </div>
            </div>
          ),
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl border border-white/[0.07] bg-white/[0.035] px-4 py-3">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40 [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40 [animation-delay:240ms]" />
            </div>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 bg-[#08090b]/95 pb-5 pt-2 backdrop-blur-xl">
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {QUICK_QUESTIONS.map(
            (question) => (
              <button
                key={
                  question
                }
                onClick={() =>
                  onQuick(
                    question,
                  )
                }
                className="shrink-0 rounded-full border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-[10px] text-white/30 transition hover:text-white/65"
              >
                {question}
              </button>
            ),
          )}
        </div>

        <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-black/35 p-2">
          <textarea
            value={input}
            onChange={(event) =>
              onInput(
                event.target.value,
              )
            }
            onKeyDown={(event) => {
              if (
                event.key ===
                  "Enter" &&
                !event.shiftKey
              ) {
                event.preventDefault();
                onSend();
              }
            }}
            rows={1}
            placeholder="Demande quelque chose à ORBIT..."
            className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-3 text-sm outline-none placeholder:text-white/20"
          />

          <button
            onClick={onSend}
            disabled={
              !input.trim() ||
              loading
            }
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-black transition disabled:opacity-25"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   COMMAND PALETTE
========================================================= */

function CommandPalette({
  query,
  recentSearches,
  onClose,
  onSearch,
}: {
  query: string;
  recentSearches:
    RecentSearch[];
  onClose: () => void;
  onSearch: (
    value: string,
  ) => void;
}) {
  const [value, setValue] =
    useState(query);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/65 px-4 pt-[12vh] backdrop-blur-md"
      onMouseDown={
        onClose
      }
    >
      <div
        onMouseDown={(
          event,
        ) =>
          event.stopPropagation()
        }
        className="w-full max-w-2xl overflow-hidden rounded-[24px] border border-white/[0.1] bg-[#0a0b0d] shadow-[0_40px_160px_rgba(0,0,0,0.65)]"
      >
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
          <div className="text-white/35">
            ⌕
          </div>

          <input
            autoFocus
            value={value}
            onChange={(event) =>
              setValue(
                event.target.value,
              )
            }
            onKeyDown={(event) => {
              if (
                event.key ===
                  "Enter" &&
                value.trim()
              ) {
                onSearch(
                  value.trim(),
                );
              }
            }}
            placeholder="Rechercher avec ORBIT..."
            className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-white/20"
          />

          <div className="rounded-md border border-white/[0.07] px-2 py-1 text-[9px] text-white/25">
            ESC
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-2">
          {value.trim() && (
            <button
              onClick={() =>
                onSearch(
                  value.trim(),
                )
              }
              className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition hover:bg-white/[0.05]"
            >
              <div>
                <div className="text-xs text-white/75">
                  Rechercher “
                  {value.trim()}
                  ”
                </div>
                <div className="mt-1 text-[10px] text-white/22">
                  Lancer le moteur ORBIT
                </div>
              </div>

              <div className="text-white/25">
                ↵
              </div>
            </button>
          )}

          <div className="px-3 pb-2 pt-4 text-[9px] uppercase tracking-[0.18em] text-white/18">
            Recherches récentes
          </div>

          {recentSearches
            .slice(0, 6)
            .map(
              (item) => (
                <button
                  key={
                    item.at
                  }
                  onClick={() =>
                    onSearch(
                      item.query,
                    )
                  }
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs text-white/42 transition hover:bg-white/[0.05] hover:text-white/75"
                >
                  <span className="text-white/20">
                    ↺
                  </span>
                  <span className="truncate">
                    {item.query}
                  </span>
                </button>
              ),
            )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   LISTING MODAL
========================================================= */

function ListingModal({
  listing,
  favorite,
  onFavorite,
  onClose,
}: {
  listing: Listing;
  favorite: boolean;
  onFavorite: () => void;
  onClose: () => void;
}) {
  const image =
    firstImage(listing);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-3 backdrop-blur-md sm:p-6"
      onMouseDown={
        onClose
      }
    >
      <div
        onMouseDown={(
          event,
        ) =>
          event.stopPropagation()
        }
        className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[28px] border border-white/[0.1] bg-[#090a0c] shadow-[0_50px_180px_rgba(0,0,0,0.7)]"
      >
        <div className="relative aspect-[2.1/1] overflow-hidden bg-white/[0.025]">
          {image ? (
            <img
              src={image}
              alt={
                listing.title
              }
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-5xl text-white/15">
              ⌂
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-[#090a0c] via-transparent to-black/25" />

          <div className="absolute right-4 top-4 flex gap-2">
            <button
              onClick={
                onFavorite
              }
              className={`flex h-10 w-10 items-center justify-center rounded-xl border backdrop-blur-xl ${
                favorite
                  ? "border-white bg-white text-black"
                  : "border-white/10 bg-black/45 text-white"
              }`}
            >
              {favorite
                ? "♥"
                : "♡"}
            </button>

            <button
              onClick={
                onClose
              }
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/45 text-white/70 backdrop-blur-xl"
            >
              ×
            </button>
          </div>

          <div className="absolute bottom-5 left-5 right-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">
              ORBIT Score{" "}
              {Math.round(
                listing.orbitScore,
              )}
              /100
            </div>

            <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-[-0.04em] sm:text-4xl">
              {listing.title}
            </h2>

            <div className="mt-2 text-sm text-white/45">
              {listing.location ??
                "Localisation non confirmée"}
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="grid gap-3 sm:grid-cols-4">
              <DetailStat
                label="Prix"
                value={formatPrice(
                  listing.price,
                  listing.currency,
                )}
              />
              <DetailStat
                label="Surface"
                value={formatSurface(
                  listing.surface,
                )}
              />
              <DetailStat
                label="Chambres"
                value={
                  listing.bedrooms !==
                  undefined
                    ? String(
                        listing.bedrooms,
                      )
                    : "—"
                }
              />
              <DetailStat
                label="SDB"
                value={
                  listing.bathrooms !==
                  undefined
                    ? String(
                        listing.bathrooms,
                      )
                    : "—"
                }
              />
            </div>

            <div className="mt-6">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/22">
                Description
              </div>
              <p className="mt-3 text-sm leading-7 text-white/42">
                {listing.description ||
                  "Aucune description détaillée disponible."}
              </p>
            </div>

            {listing.reasons.length >
              0 && (
              <div className="mt-6">
                <div className="text-[10px] uppercase tracking-[0.18em] text-white/22">
                  Pourquoi ORBIT le recommande
                </div>

                <div className="mt-3 space-y-2">
                  {listing.reasons.map(
                    (reason) => (
                      <div
                        key={
                          reason
                        }
                        className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-xs text-white/45"
                      >
                        ✓{" "}
                        {reason}
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-3">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/22">
                Analyse
              </div>

              <ScoreBar
                label="Match"
                value={
                  listing.matchScore
                }
              />
              <ScoreBar
                label="Value"
                value={
                  listing.valueScore
                }
              />
              <ScoreBar
                label="ORBIT"
                value={
                  listing.orbitScore
                }
              />
            </div>

            <a
              href={
                listing.url
              }
              target="_blank"
              rel="noreferrer"
              className="block rounded-2xl bg-white px-4 py-3.5 text-center text-sm font-semibold text-black transition hover:bg-white/90"
            >
              Ouvrir l'annonce ↗
            </a>
          </aside>
        </div>
      </div>
    </div>
  );
}

function DetailStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
      <div className="text-[9px] uppercase tracking-[0.15em] text-white/20">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-white/70">
        {value}
      </div>
    </div>
  );
}

function ScoreBar({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-white/28">
          {label}
        </span>
        <span className="font-medium text-white/55">
          {Math.round(
            value,
          )}
        </span>
      </div>

      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full bg-white"
          style={{
            width: `${clamp(
              value,
              0,
              100,
            )}%`,
          }}
        />
      </div>
    </div>
  );
}

/* =========================================================
   EMPTY
========================================================= */

function EmptyResults({
  activeNav,
}: {
  activeNav:
    | "search"
    | "history"
    | "favorites"
    | "assistant";
}) {
  return (
    <div className="mt-5 rounded-[24px] border border-dashed border-white/[0.08] bg-white/[0.015] px-5 py-16 text-center">
      <div className="text-4xl text-white/15">
        ◌
      </div>
      <div className="mt-4 text-sm font-medium text-white/48">
        {activeNav ===
        "favorites"
          ? "Aucun favori pour le moment"
          : "Aucun résultat vérifié"}
      </div>
      <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-white/24">
        {activeNav ===
        "favorites"
          ? "Ajoute des annonces à tes favoris depuis les résultats."
          : "ORBIT a préféré ne rien afficher plutôt que de te montrer des annonces trop éloignées de tes critères."}
      </p>
    </div>
  );
}

function AuthBootScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050607] text-white">
      <div className="flex flex-col items-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white text-black shadow-[0_18px_70px_rgba(255,255,255,0.10)]">
          <OrbitMark dark />
        </div>

        <div className="mt-5 text-[10px] uppercase tracking-[0.20em] text-white/22">
          Restoring session
        </div>

        <div className="mt-3 h-1 w-28 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-white/55" />
        </div>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black">
      G
    </span>
  );
}

function getUserInitial(
  user: User | null,
) {
  const label =
    getUserLabel(user);

  return (
    label
      ?.trim()
      .charAt(0)
      .toUpperCase() ||
    "O"
  );
}

function getUserLabel(
  user: User | null,
) {
  if (!user) {
    return "ORBIT";
  }

  const metadata =
    user.user_metadata ??
    {};

  return (
    metadata.full_name ||
    metadata.name ||
    user.email?.split(
      "@",
    )[0] ||
    "Compte"
  );
}

function TrustPill({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.018] px-4 py-3">
      <div className="text-[11px] font-medium text-white/56">
        {value}
      </div>
      <div className="mt-1 text-[9px] text-white/20">
        {label}
      </div>
    </div>
  );
}

/* =========================================================
   LOGO
========================================================= */

function OrbitMark({
  dark = false,
}: {
  dark?: boolean;
}) {
  return (
    <div className="relative h-5 w-5">
      <div
        className={`absolute inset-[3px] rounded-full border ${
          dark
            ? "border-black/55"
            : "border-white/55"
        }`}
      />
      <div
        className={`absolute left-1/2 top-0 h-5 w-[1px] -translate-x-1/2 rotate-45 ${
          dark
            ? "bg-black/30"
            : "bg-white/30"
        }`}
      />
      <div
        className={`absolute left-[8px] top-[8px] h-1 w-1 rounded-full ${
          dark
            ? "bg-black"
            : "bg-white"
        }`}
      />
    </div>
  );
}
