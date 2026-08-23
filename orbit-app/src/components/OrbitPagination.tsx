"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const PAGE_SIZE = 15;
const MAX_PAGES = 3;

function findResultsGrid(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("div.grid"));
  return candidates.find((grid) => {
    const directArticles = Array.from(grid.children).filter((child) => child.tagName === "ARTICLE");
    return directArticles.length > 0 && grid.className.includes("md:grid-cols-2");
  }) ?? null;
}

function ensureTarget(grid: HTMLElement) {
  let target = document.getElementById("orbit-pagination-root") as HTMLElement | null;
  if (!target) {
    target = document.createElement("div");
    target.id = "orbit-pagination-root";
    grid.insertAdjacentElement("afterend", target);
  } else if (target.previousElementSibling !== grid) {
    grid.insertAdjacentElement("afterend", target);
  }
  return target;
}

export default function OrbitPagination() {
  const [grid, setGrid] = useState<HTMLElement | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const locate = () => {
      const nextGrid = findResultsGrid();
      if (!nextGrid) {
        setGrid(null);
        setTarget(null);
        setTotal(0);
        return;
      }
      const count = Array.from(nextGrid.children).filter((child) => child.tagName === "ARTICLE").length;
      setGrid(nextGrid);
      setTarget(ensureTarget(nextGrid));
      setTotal(count);
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const pages = useMemo(
    () => Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PAGE_SIZE))),
    [total],
  );

  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  useEffect(() => {
    setPage(1);
  }, [total]);

  useEffect(() => {
    if (!grid) return;
    const articles = Array.from(grid.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === "ARTICLE");
    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    articles.forEach((article, index) => {
      article.style.display = index >= start && index < end ? "" : "none";
    });
  }, [grid, page, total]);

  if (!target || total <= PAGE_SIZE) return null;

  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  function go(next: number) {
    const safe = Math.max(1, Math.min(pages, next));
    setPage(safe);
    window.requestAnimationFrame(() => {
      grid?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return createPortal(
    <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.018] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-[10px] text-white/32">
        Annonces <span className="text-white/65">{first}–{last}</span> sur <span className="text-white/65">{total}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => go(page - 1)}
          disabled={page === 1}
          className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-[10px] text-white/50 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-25"
        >
          ← Précédent
        </button>

        {Array.from({ length: pages }, (_, index) => index + 1).map((number) => (
          <button
            key={number}
            type="button"
            onClick={() => go(number)}
            className={`h-8 min-w-8 rounded-xl border px-2 text-[10px] transition ${
              number === page
                ? "border-white bg-white text-black"
                : "border-white/[0.08] bg-white/[0.025] text-white/45 hover:bg-white/[0.06]"
            }`}
          >
            {number}
          </button>
        ))}

        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={page === pages}
          className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-[10px] text-white/50 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-25"
        >
          Suivant →
        </button>
      </div>
    </div>,
    target,
  );
}
