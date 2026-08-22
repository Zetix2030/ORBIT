"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type FilterState = {
  budgetMin: string;
  budgetMax: string;
  minSurface: string;
  maxSurface: string;
  minBedrooms: string;
  minBathrooms: string;
  garden: boolean;
  garage: boolean;
  pool: boolean;
  terrace: boolean;
  parking: boolean;
  sortPriority: "best_match" | "lowest_price" | "largest";
};

const EMPTY: FilterState = {
  budgetMin: "",
  budgetMax: "",
  minSurface: "",
  maxSurface: "",
  minBedrooms: "",
  minBathrooms: "",
  garden: false,
  garage: false,
  pool: false,
  terrace: false,
  parking: false,
  sortPriority: "best_match",
};

function findCriteriaPanel(): HTMLElement | null {
  const divs = Array.from(document.querySelectorAll<HTMLElement>("div"));
  return (
    divs.find((el) => {
      const first = el.firstElementChild as HTMLElement | null;
      return first?.textContent?.trim() === "Interprétation" && el.className.includes("rounded-[22px]");
    }) ?? null
  );
}

function getResultsInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[placeholder="Modifie ta recherche..."]');
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function buildSuffix(filters: FilterState) {
  const parts: string[] = [];
  if (filters.budgetMin) parts.push(`prix minimum ${filters.budgetMin}`);
  if (filters.budgetMax) parts.push(`budget max ${filters.budgetMax}`);
  if (filters.minSurface) parts.push(`minimum ${filters.minSurface} m2`);
  if (filters.maxSurface) parts.push(`maximum ${filters.maxSurface} m2`);
  if (filters.minBedrooms) parts.push(`${filters.minBedrooms} chambres`);
  if (filters.minBathrooms) parts.push(`${filters.minBathrooms} salles de bain`);
  if (filters.garden) parts.push("jardin");
  if (filters.garage) parts.push("garage");
  if (filters.pool) parts.push("piscine");
  if (filters.terrace) parts.push("terrasse");
  if (filters.parking) parts.push("parking");
  return parts.join(", ");
}

function stripFilterSuffix(query: string) {
  return query.replace(/\s*\|\s*filtres ORBIT\s*:\s*.*$/i, "").trim();
}

export default function OrbitSearchFilters() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY);

  useEffect(() => {
    const locate = () => setTarget(findCriteriaPanel());
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const activeCount = useMemo(
    () =>
      Object.entries(filters).filter(([key, value]) => {
        if (key === "sortPriority") return value !== "best_match";
        return typeof value === "boolean" ? value : Boolean(value);
      }).length,
    [filters],
  );

  if (!target) return null;

  function update<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function apply() {
    const input = getResultsInput();
    if (!input) return;
    const base = stripFilterSuffix(input.value);
    const suffix = buildSuffix(filters);
    const next = suffix ? `${base} | filtres ORBIT: ${suffix}` : base;
    setReactInputValue(input, next);

    // Expose structured filters for future integrations/debugging.
    window.sessionStorage.setItem("orbit-search-filters", JSON.stringify(filters));

    window.setTimeout(() => {
      const container = input.closest("section");
      const button = Array.from(container?.querySelectorAll("button") ?? []).find(
        (item) => item.textContent?.trim() === "Rechercher",
      ) as HTMLButtonElement | undefined;
      button?.click();
    }, 40);
  }

  function reset() {
    setFilters(EMPTY);
    const input = getResultsInput();
    if (!input) return;
    const base = stripFilterSuffix(input.value);
    setReactInputValue(input, base);
    window.sessionStorage.removeItem("orbit-search-filters");
    window.setTimeout(() => {
      const container = input.closest("section");
      const button = Array.from(container?.querySelectorAll("button") ?? []).find(
        (item) => item.textContent?.trim() === "Rechercher",
      ) as HTMLButtonElement | undefined;
      button?.click();
    }, 40);
  }

  const fieldClass =
    "w-full rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5 text-[11px] text-white/70 outline-none placeholder:text-white/18 focus:border-white/[0.16]";

  return createPortal(
    <div className="mt-5 border-t border-white/[0.06] pt-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/22">Filtres</div>
          <div className="mt-1 text-[9px] text-white/24">Affiner sans réécrire la recherche</div>
        </div>
        {activeCount > 0 && (
          <div className="rounded-full border border-white/[0.07] bg-white/[0.035] px-2 py-1 text-[9px] text-white/45">
            {activeCount} actifs
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <input className={fieldClass} inputMode="numeric" placeholder="Prix min." value={filters.budgetMin} onChange={(e) => update("budgetMin", e.target.value.replace(/\D/g, ""))} />
        <input className={fieldClass} inputMode="numeric" placeholder="Prix max." value={filters.budgetMax} onChange={(e) => update("budgetMax", e.target.value.replace(/\D/g, ""))} />
        <input className={fieldClass} inputMode="numeric" placeholder="m² min." value={filters.minSurface} onChange={(e) => update("minSurface", e.target.value.replace(/[^\d.]/g, ""))} />
        <input className={fieldClass} inputMode="numeric" placeholder="m² max." value={filters.maxSurface} onChange={(e) => update("maxSurface", e.target.value.replace(/[^\d.]/g, ""))} />
        <input className={fieldClass} inputMode="numeric" placeholder="Chambres min." value={filters.minBedrooms} onChange={(e) => update("minBedrooms", e.target.value.replace(/\D/g, ""))} />
        <input className={fieldClass} inputMode="numeric" placeholder="SDB min." value={filters.minBathrooms} onChange={(e) => update("minBathrooms", e.target.value.replace(/\D/g, ""))} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {[
          ["garden", "Jardin"],
          ["garage", "Garage"],
          ["pool", "Piscine"],
          ["terrace", "Terrasse"],
          ["parking", "Parking"],
        ].map(([key, label]) => {
          const checked = filters[key as keyof FilterState] as boolean;
          return (
            <button
              key={key}
              type="button"
              onClick={() => update(key as keyof FilterState, !checked as never)}
              className={`rounded-xl border px-3 py-2 text-left text-[10px] transition ${
                checked
                  ? "border-white/20 bg-white text-black"
                  : "border-white/[0.06] bg-white/[0.02] text-white/34 hover:bg-white/[0.05]"
              }`}
            >
              {checked ? "✓ " : "+ "}{label}
            </button>
          );
        })}
      </div>

      <select
        className={`${fieldClass} mt-3`}
        value={filters.sortPriority}
        onChange={(e) => update("sortPriority", e.target.value as FilterState["sortPriority"])}
      >
        <option value="best_match">Meilleure correspondance</option>
        <option value="lowest_price">Prix le plus bas</option>
        <option value="largest">Plus grande surface</option>
      </select>

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <button type="button" onClick={apply} className="rounded-xl bg-white px-3 py-2.5 text-[10px] font-semibold text-black transition hover:bg-white/90">
          Appliquer les filtres
        </button>
        <button type="button" onClick={reset} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-[10px] text-white/35 transition hover:bg-white/[0.05] hover:text-white/65">
          Réinitialiser
        </button>
      </div>
    </div>,
    target,
  );
}
