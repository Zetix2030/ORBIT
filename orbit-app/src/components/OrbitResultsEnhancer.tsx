"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type SortMode =
  | "score"
  | "price-asc"
  | "price-desc"
  | "surface-desc"
  | "surface-asc"
  | "confirmed-first";

const SORT_OPTIONS: Array<{
  value: SortMode;
  label: string;
  hint: string;
}> = [
  {
    value: "score",
    label: "ORBIT Score",
    hint: "Meilleure correspondance",
  },
  {
    value: "confirmed-first",
    label: "Prix vérifiés",
    hint: "Prix connus en premier",
  },
  {
    value: "price-asc",
    label: "Prix croissant",
    hint: "Du moins cher au plus cher",
  },
  {
    value: "price-desc",
    label: "Prix décroissant",
    hint: "Du plus cher au moins cher",
  },
  {
    value: "surface-desc",
    label: "Surface décroissante",
    hint: "Les plus grandes en premier",
  },
  {
    value: "surface-asc",
    label: "Surface croissante",
    hint: "Les plus petites en premier",
  },
];

function findSortTarget() {
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>(
        "div",
      ),
    ).find((element) =>
      /Triées? par ORBIT Score/i.test(
        element.textContent?.trim() ?? "",
      ),
    ) ?? null
  );
}

function resultCards() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "article",
    ),
  ).filter((article) =>
    /ORBIT\s*Score/i.test(
      article.innerText,
    ),
  );
}

function parseScore(card: HTMLElement) {
  const match =
    card.innerText.match(
      /ORBIT\s*Score\s*(\d{1,3})/i,
    );

  return match
    ? Number(match[1])
    : 0;
}

function parseSurface(
  card: HTMLElement,
) {
  const match =
    card.innerText.match(
      /([\d\s.,]+)\s*m²/i,
    );

  if (!match) {
    return undefined;
  }

  const value = Number(
    match[1]
      .replace(/\s/g, "")
      .replace(",", "."),
  );

  return Number.isFinite(value)
    ? value
    : undefined;
}

function parseVisiblePrice(
  card: HTMLElement,
) {
  const lines =
    card.innerText
      .split("\n")
      .map((line) =>
        line.trim(),
      )
      .filter(Boolean);

  for (const line of lines) {
    if (
      /Prix non confirmé/i.test(
        line,
      )
    ) {
      return undefined;
    }

    if (
      !/(?:€|\$|£|EUR|USD|GBP|CAD|AUD|CHF)/i.test(
        line,
      )
    ) {
      continue;
    }

    const match =
      line.match(
        /([\d\s.,]{4,})/,
      );

    if (!match) {
      continue;
    }

    let compact =
      match[1].replace(
        /\s/g,
        "",
      );

    if (
      compact.includes(",") &&
      compact.includes(".")
    ) {
      const last = Math.max(
        compact.lastIndexOf(","),
        compact.lastIndexOf("."),
      );

      compact =
        compact
          .slice(0, last)
          .replace(/[.,]/g, "") +
        compact.slice(last + 1);
    } else {
      compact =
        compact.replace(
          /[.,]/g,
          "",
        );
    }

    const value = Number(compact);

    if (
      Number.isFinite(value) &&
      value >= 10_000
    ) {
      return value;
    }
  }

  return undefined;
}

function refreshRanks(
  cards: HTMLElement[],
) {
  cards.forEach(
    (card, index) => {
      const rank =
        Array.from(
          card.querySelectorAll<HTMLElement>(
            "div",
          ),
        ).find((element) =>
          /^#\d+$/.test(
            element.textContent?.trim() ??
              "",
          ),
        );

      if (rank) {
        rank.textContent =
          `#${index + 1}`;
      }
    },
  );
}

function applySort(mode: SortMode) {
  const cards = resultCards();

  if (cards.length < 2) {
    return;
  }

  const parent =
    cards[0]?.parentElement;

  if (
    !parent ||
    !cards.every(
      (card) =>
        card.parentElement === parent,
    )
  ) {
    return;
  }

  const decorated =
    cards.map(
      (card, index) => ({
        card,
        index,
        score: parseScore(card),
        price:
          parseVisiblePrice(card),
        surface:
          parseSurface(card),
        unconfirmed:
          /Prix non confirmé/i.test(
            card.innerText,
          ),
      }),
    );

  decorated.sort((a, b) => {
    if (mode === "price-asc") {
      return (
        (a.price ??
          Number.MAX_SAFE_INTEGER) -
          (b.price ??
            Number.MAX_SAFE_INTEGER) ||
        b.score - a.score
      );
    }

    if (mode === "price-desc") {
      return (
        (b.price ?? -1) -
          (a.price ?? -1) ||
        b.score - a.score
      );
    }

    if (mode === "surface-desc") {
      return (
        (b.surface ?? -1) -
          (a.surface ?? -1) ||
        b.score - a.score
      );
    }

    if (mode === "surface-asc") {
      return (
        (a.surface ??
          Number.MAX_SAFE_INTEGER) -
          (b.surface ??
            Number.MAX_SAFE_INTEGER) ||
        b.score - a.score
      );
    }

    if (
      mode ===
      "confirmed-first"
    ) {
      return (
        Number(a.unconfirmed) -
          Number(b.unconfirmed) ||
        b.score - a.score
      );
    }

    return (
      b.score - a.score ||
      a.index - b.index
    );
  });

  decorated.forEach(({ card }) =>
    parent.appendChild(card),
  );

  refreshRanks(
    decorated.map(
      ({ card }) => card,
    ),
  );
}

export default function OrbitResultsEnhancer() {
  const [target, setTarget] =
    useState<HTMLElement | null>(
      null,
    );

  const [open, setOpen] =
    useState(false);

  const [mode, setMode] =
    useState<SortMode>("score");

  const rootRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const current = useMemo(
    () =>
      SORT_OPTIONS.find(
        (option) =>
          option.value === mode,
      ) ?? SORT_OPTIONS[0],
    [mode],
  );

  useEffect(() => {
    const locate = () => {
      const nextTarget =
        findSortTarget();

      if (nextTarget) {
        nextTarget.style.position =
          "relative";
        nextTarget.style.minWidth =
          "174px";
        nextTarget.style.minHeight =
          "38px";
        nextTarget.style.color =
          "transparent";
      }

      setTarget(nextTarget);
    };

    locate();

    const observer =
      new MutationObserver(locate);

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true,
      },
    );

    return () =>
      observer.disconnect();
  }, []);

  useEffect(() => {
    applySort(mode);
  }, [mode]);

  useEffect(() => {
    const close = (
      event: MouseEvent,
    ) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(
          event.target as Node,
        )
      ) {
        setOpen(false);
      }
    };

    document.addEventListener(
      "mousedown",
      close,
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        close,
      );
  }, []);

  if (!target) {
    return null;
  }

  return createPortal(
    <div
      ref={rootRef}
      className="absolute inset-0 z-30 text-white"
    >
      <button
        type="button"
        onClick={() =>
          setOpen(
            (value) => !value,
          )
        }
        className="flex h-full w-full items-center justify-between gap-3 rounded-xl px-3 text-[10px] text-white/55 transition hover:bg-white/[0.045] hover:text-white/80"
      >
        <span className="truncate">
          {current.label}
        </span>
        <span
          className={`text-[9px] text-white/28 transition-transform duration-200 ${
            open
              ? "rotate-180"
              : ""
          }`}
        >
          ⌄
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-[235px] overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0b0c0f]/95 p-1.5 shadow-[0_24px_80px_rgba(0,0,0,.55)] backdrop-blur-2xl">
          <div className="px-2.5 pb-1.5 pt-1 text-[9px] uppercase tracking-[0.16em] text-white/22">
            Classer les résultats
          </div>

          {SORT_OPTIONS.map(
            (option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setMode(
                    option.value,
                  );
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2.5 text-left transition ${
                  mode ===
                  option.value
                    ? "bg-white text-black"
                    : "text-white/62 hover:bg-white/[0.055] hover:text-white"
                }`}
              >
                <span>
                  <span className="block text-[11px] font-medium">
                    {option.label}
                  </span>
                  <span
                    className={`mt-0.5 block text-[9px] ${
                      mode ===
                      option.value
                        ? "text-black/45"
                        : "text-white/24"
                    }`}
                  >
                    {option.hint}
                  </span>
                </span>

                {mode ===
                  option.value && (
                  <span className="text-[10px]">
                    ✓
                  </span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </div>,
    target,
  );
}
