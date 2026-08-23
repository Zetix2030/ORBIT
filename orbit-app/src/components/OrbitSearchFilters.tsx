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
  return divs.find((el) => {
    const first = el.firstElementChild as HTMLElement | null;
    return first?.textContent?.trim() === "Interprétation" && el.className.includes("rounded-[22px]");
  }) ?? null;
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
  if (filters.minSurface) parts.push(`surface minimum ${filters.minSurface} m2`);
  if (filters.maxSurface) parts.push(`surface maximum ${filters.maxSurface} m2`);
  if (filters.minBedrooms) parts.push(`${filters.minBedrooms} chambres`);
  if (filters.minBathrooms) parts.push(`${filters.minBathrooms} salles de bain`);
  if (filters.garden) parts.push("jardin");
  if (filters.garage) parts.push("garage");
  if (filters.pool) parts.push("piscine");
  if (filters.terrace) parts.push("terrasse");
  if (filters.parking) parts.push("parking");
  if (filters.sortPriority === "lowest_price") parts.push("tri prix croissant");
  if (filters.sortPriority === "largest") parts.push("tri plus grande surface");
  return parts.join(", ");
}

function stripFilterSuffix(query: string) {
  return query.replace(/\s*\|\s*filtres ORBIT\s*:\s*.*$/i, "").trim();
}

function loadSaved(): FilterState {
  try {
    const raw = window.sessionStorage.getItem("orbit-search-filters");
    if (!raw) return EMPTY;
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<FilterState>) };
  } catch {
    return EMPTY;
  }
}

export default function OrbitSearchFilters() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    setFilters(loadSaved());
    const locate = () => setTarget(findCriteriaPanel());
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const activeCount = useMemo(
    () => Object.entries(filters).filter(([key, value]) => {
      if (key === "sortPriority") return value !== "best_match";
      return typeof value === "boolean" ? value : Boolean(value);
    }).length,
    [filters],
  );

  const activeLabels = useMemo(() => {
    const labels: string[] = [];
    if (filters.budgetMax) labels.push(`≤ ${Number(filters.budgetMax).toLocaleString("fr-FR")} €`);
    if (filters.minSurface) labels.push(`≥ ${filters.minSurface} m²`);
    if (filters.minBedrooms) labels.push(`${filters.minBedrooms}+ ch.`);
    if (filters.garden) labels.push("Jardin");
    if (filters.garage) labels.push("Garage");
    if (filters.pool) labels.push("Piscine");
    return labels.slice(0, 5);
  }, [filters]);

  if (!target) return null;

  function update<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function runSearch(nextQuery: string) {
    const input = getResultsInput();
    if (!input) return;
    setReactInputValue(input, nextQuery);
    window.setTimeout(() => {
      const container = input.closest("section");
      const button = Array.from(container?.querySelectorAll("button") ?? []).find(
        (item) => item.textContent?.trim() === "Rechercher",
      ) as HTMLButtonElement | undefined;
      button?.click();
    }, 50);
  }

  function apply() {
    const input = getResultsInput();
    if (!input) return;
    const base = stripFilterSuffix(input.value);
    const suffix = buildSuffix(filters);
    window.sessionStorage.setItem("orbit-search-filters", JSON.stringify(filters));
    runSearch(suffix ? `${base} | filtres ORBIT: ${suffix}` : base);
  }

  function reset() {
    const input = getResultsInput();
    setFilters(EMPTY);
    window.sessionStorage.removeItem("orbit-search-filters");
    if (input) runSearch(stripFilterSuffix(input.value));
  }

  const fieldClass = "w-full rounded-xl border border-white/[0.08] bg-[#07080a] px-3 py-2.5 text-[11px] text-white/75 outline-none transition placeholder:text-white/18 hover:border-white/[0.12] focus:border-[#9aa3ff]/35 focus:bg-white/[0.025]";
  const featureButtons: Array<["garden" | "garage" | "pool" | "terrace" | "parking", string, string]> = [
    ["garden", "Jardin", "♧"],
    ["garage", "Garage", "▣"],
    ["pool", "Piscine", "≈"],
    ["terrace", "Terrasse", "▱"],
    ["parking", "Parking", "P"],
  ];

  return createPortal(
    <div className="mt-5 overflow-hidden rounded-2xl border border-white/[0.07] bg-[linear-gradient(145deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012))] shadow-[0_18px_60px_rgba(0,0,0,0.18)]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left transition hover:bg-white/[0.025]"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-[11px] text-white/50">⌘</div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/38">Filtres intelligents</div>
            <div className="mt-1 text-[9px] text-white/22">Affiner les résultats sans repartir de zéro</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeCount > 0 && <span className="rounded-full border border-[#9aa3ff]/20 bg-[#9aa3ff]/10 px-2 py-1 text-[9px] text-[#cbd0ff]">{activeCount}</span>}
          <span className="text-xs text-white/25">{expanded ? "−" : "+"}</span>
        </div>
      </button>

      {activeLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-white/[0.05] px-4 py-3">
          {activeLabels.map((label) => (
            <span key={label} className="rounded-full border border-white/[0.07] bg-black/25 px-2.5 py-1 text-[9px] text-white/38">{label}</span>
          ))}
        </div>
      )}

      {expanded && (
        <div className="border-t border-white/[0.055] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.14em] text-white/20">Budget & espace</span>
            <span className="text-[9px] text-white/18">France • EUR (€)</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input className={fieldClass} inputMode="numeric" placeholder="Prix min. €" value={filters.budgetMin} onChange={(e) => update("budgetMin", e.target.value.replace(/\D/g, ""))} />
            <input className={fieldClass} inputMode="numeric" placeholder="Prix max. €" value={filters.budgetMax} onChange={(e) => update("budgetMax", e.target.value.replace(/\D/g, ""))} />
            <input className={fieldClass} inputMode="numeric" placeholder="m² min." value={filters.minSurface} onChange={(e) => update("minSurface", e.target.value.replace(/[^\d.]/g, ""))} />
            <input className={fieldClass} inputMode="numeric" placeholder="m² max." value={filters.maxSurface} onChange={(e) => update("maxSurface", e.target.value.replace(/[^\d.]/g, ""))} />
            <input className={fieldClass} inputMode="numeric" placeholder="Chambres min." value={filters.minBedrooms} onChange={(e) => update("minBedrooms", e.target.value.replace(/\D/g, ""))} />
            <input className={fieldClass} inputMode="numeric" placeholder="SDB min." value={filters.minBathrooms} onChange={(e) => update("minBathrooms", e.target.value.replace(/\D/g, ""))} />
          </div>

          <div className="mb-2 mt-4 text-[9px] uppercase tracking-[0.14em] text-white/20">Équipements</div>
          <div className="grid grid-cols-2 gap-2">
            {featureButtons.map(([key, label, icon]) => {
              const checked = filters[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => update(key, !checked)}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-[10px] transition ${checked ? "border-[#9aa3ff]/35 bg-[#9aa3ff]/12 text-white" : "border-white/[0.06] bg-black/20 text-white/34 hover:border-white/[0.11] hover:bg-white/[0.035]"}`}
                >
                  <span className="flex items-center gap-2"><span className="text-white/30">{icon}</span>{label}</span>
                  <span className={checked ? "text-[#cbd0ff]" : "text-white/16"}>{checked ? "✓" : "+"}</span>
                </button>
              );
            })}
          </div>

          <div className="mb-2 mt-4 text-[9px] uppercase tracking-[0.14em] text-white/20">Classement</div>
          <select className={fieldClass} value={filters.sortPriority} onChange={(e) => update("sortPriority", e.target.value as FilterState["sortPriority"])}>
            <option value="best_match">Meilleure correspondance ORBIT</option>
            <option value="lowest_price">Prix le plus bas</option>
            <option value="largest">Plus grande surface</option>
          </select>

          <div className="mt-4 rounded-xl border border-emerald-400/[0.10] bg-emerald-400/[0.035] px-3 py-2.5 text-[9px] leading-5 text-emerald-100/45">
            ORBIT France privilégie les annonces individuelles avec prix recoupé et photo rattachée à la fiche.
          </div>

          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <button type="button" onClick={apply} className="rounded-xl bg-white px-3 py-2.5 text-[10px] font-semibold text-black shadow-[0_8px_30px_rgba(255,255,255,0.08)] transition hover:scale-[1.01] hover:bg-white/90">Appliquer</button>
            <button type="button" onClick={reset} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-[10px] text-white/35 transition hover:bg-white/[0.05] hover:text-white/65">Réinitialiser</button>
          </div>
        </div>
      )}
    </div>,
    target,
  );
}
