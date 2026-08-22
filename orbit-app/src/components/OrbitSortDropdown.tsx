"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type SortMode =
  | "score"
  | "price-asc"
  | "price-desc"
  | "surface-desc"
  | "surface-asc";

const OPTIONS: Array<{
  value: SortMode;
  label: string;
}> = [
  { value: "score", label: "ORBIT Score" },
  { value: "price-asc", label: "Prix croissant" },
  { value: "price-desc", label: "Prix décroissant" },
  { value: "surface-desc", label: "Surface décroissante" },
  { value: "surface-asc", label: "Surface croissante" },
];

function ensureLeafHost(): HTMLElement | null {
  const existing = document.querySelector<HTMLElement>(
    '[data-orbit-sort-leaf="true"]',
  );

  if (existing?.isConnected) {
    return existing;
  }

  const labelHost = Array.from(
    document.querySelectorAll<HTMLElement>("div"),
  ).find((element) =>
    /^Triées? par ORBIT Score$/i.test(
      element.textContent?.replace(/\s+/g, " ").trim() ?? "",
    ),
  );

  if (!labelHost) {
    return null;
  }

  labelHost.dataset.orbitSortHost = "true";
  labelHost.style.position = "relative";
  labelHost.style.minWidth = "190px";
  labelHost.style.minHeight = "40px";
  labelHost.style.padding = "0";
  labelHost.style.color = "transparent";
  labelHost.style.overflow = "visible";

  const leaf = document.createElement("span");
  leaf.dataset.orbitSortLeaf = "true";
  leaf.setAttribute("aria-hidden", "true");
  leaf.style.position = "absolute";
  leaf.style.inset = "0";
  leaf.style.display = "block";
  leaf.style.pointerEvents = "auto";
  labelHost.appendChild(leaf);

  return leaf;
}

function resultCards() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("article"),
  ).filter((article) =>
    /ORBIT\s*Score/i.test(article.innerText),
  );
}

function parseScore(card: HTMLElement) {
  const match = card.innerText.match(
    /ORBIT\s*Score\s*(\d{1,3})/i,
  );
  return match ? Number(match[1]) : 0;
}

function parseSurface(card: HTMLElement) {
  const match = card.innerText.match(
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

function parsePrice(card: HTMLElement) {
  const lines = card.innerText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/Prix non confirmé/i.test(line)) {
      continue;
    }

    if (!/(?:€|\$|£|EUR|USD|GBP|CAD|AUD|CHF)/i.test(line)) {
      continue;
    }

    const match = line.match(/([\d\s.,]{4,})/);
    if (!match) {
      continue;
    }

    const raw = match[1].replace(/\s/g, "");
    let normalized = raw;

    if (raw.includes(",") && raw.includes(".")) {
      const lastComma = raw.lastIndexOf(",");
      const lastDot = raw.lastIndexOf(".");
      const decimalIndex = Math.max(lastComma, lastDot);
      const fraction = raw.slice(decimalIndex + 1);

      normalized =
        fraction.length === 2
          ? raw.slice(0, decimalIndex).replace(/[.,]/g, "") + "." + fraction
          : raw.replace(/[.,]/g, "");
    } else if (/^[\d]{1,3}([.,]\d{3})+$/.test(raw)) {
      normalized = raw.replace(/[.,]/g, "");
    } else {
      normalized = raw.replace(",", ".");
    }

    const value = Number(normalized);
    if (Number.isFinite(value) && value >= 10_000) {
      return value;
    }
  }

  return undefined;
}

function refreshRanks(cards: HTMLElement[]) {
  cards.forEach((card, index) => {
    const rank = Array.from(
      card.querySelectorAll<HTMLElement>("div"),
    ).find((element) =>
      /^#\d+$/.test(element.textContent?.trim() ?? ""),
    );

    if (rank) {
      rank.textContent = `#${index + 1}`;
    }
  });
}

function applySort(mode: SortMode) {
  const cards = resultCards();

  if (cards.length < 2) {
    return;
  }

  const parent = cards[0]?.parentElement;
  if (
    !parent ||
    !cards.every((card) => card.parentElement === parent)
  ) {
    return;
  }

  const decorated = cards.map((card, index) => ({
    card,
    index,
    score: parseScore(card),
    price: parsePrice(card),
    surface: parseSurface(card),
  }));

  decorated.sort((a, b) => {
    if (mode === "price-asc") {
      return (
        (a.price ?? Number.MAX_SAFE_INTEGER) -
          (b.price ?? Number.MAX_SAFE_INTEGER) ||
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
        (a.surface ?? Number.MAX_SAFE_INTEGER) -
          (b.surface ?? Number.MAX_SAFE_INTEGER) ||
        b.score - a.score
      );
    }

    return b.score - a.score || a.index - b.index;
  });

  decorated.forEach(({ card }) => parent.appendChild(card));
  refreshRanks(decorated.map(({ card }) => card));
}

export default function OrbitSortDropdown() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<SortMode>("score");

  useEffect(() => {
    let frame = 0;

    const locate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = ensureLeafHost();
        setTarget((current) =>
          current?.isConnected ? current : next,
        );
      });
    };

    locate();

    const observer = new MutationObserver(locate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    applySort(mode);
  }, [mode]);

  if (!target) {
    return null;
  }

  return createPortal(
    <div className="absolute inset-0 z-[80] flex items-center">
      <select
        aria-label="Trier les résultats"
        value={mode}
        onChange={(event) => {
          const next = event.target.value as SortMode;
          setMode(next);
          requestAnimationFrame(() => applySort(next));
        }}
        className="h-full w-full cursor-pointer appearance-none rounded-xl border border-white/[0.09] bg-[#111316] px-3 pr-8 text-[11px] font-medium text-white/70 outline-none transition hover:border-white/[0.16] hover:bg-[#15181b] hover:text-white focus:border-white/[0.22] focus:ring-1 focus:ring-white/[0.08]"
      >
        {OPTIONS.map((option) => (
          <option
            key={option.value}
            value={option.value}
            className="bg-[#111316] text-white"
          >
            {option.label}
          </option>
        ))}
      </select>

      <span className="pointer-events-none absolute right-3 text-[10px] text-white/35">
        ⌄
      </span>
    </div>,
    target,
  );
}
