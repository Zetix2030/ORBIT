"use client";

import { useState } from "react";

const examples = [
  "Find me a family house near Brest under €450k",
  "Find me a sporty car under €40k",
  "Find me the best 1440p gaming monitor under €250",
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  return (
    <main className="min-h-screen bg-[#07080a] text-white">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-240px] h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-white/[0.025] blur-3xl" />
        <div className="absolute left-[10%] top-[20%] h-[280px] w-[280px] rounded-full bg-blue-500/[0.035] blur-3xl" />
        <div className="absolute right-[5%] bottom-[10%] h-[280px] w-[280px] rounded-full bg-violet-500/[0.03] blur-3xl" />
      </div>

      {/* Navigation */}
      <header className="relative z-10 border-b border-white/[0.06]">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-8">
          <div className="flex items-center gap-10">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
                <div className="h-3 w-3 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.45)]" />
              </div>

              <span className="text-[15px] font-semibold tracking-[0.28em]">
                ORBIT
              </span>
            </div>

            <nav className="hidden items-center gap-7 text-sm text-white/45 md:flex">
              <a className="transition hover:text-white" href="#">
                Search
              </a>
              <a className="transition hover:text-white" href="#">
                Compare
              </a>
              <a className="transition hover:text-white" href="#">
                Saved
              </a>
              <a className="transition hover:text-white" href="#">
                History
              </a>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden rounded-full border border-white/8 bg-white/[0.035] px-3 py-1.5 text-[11px] font-medium text-white/45 sm:block">
              DEMO MODE
            </div>

            <button className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-medium text-white transition hover:bg-white/[0.08]">
              Sign in
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-6 pb-24 pt-24 lg:px-8 lg:pb-32 lg:pt-32">
        <div className="mx-auto max-w-5xl text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-xs text-white/45 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
            Universal market intelligence
          </div>

          <h1 className="mx-auto max-w-4xl text-5xl font-semibold tracking-[-0.055em] text-white sm:text-6xl lg:text-8xl">
            Tell ORBIT
            <br />
            what you want.
          </h1>

          <p className="mx-auto mt-7 max-w-2xl text-base leading-7 text-white/45 sm:text-lg">
            Describe a house, car, computer, trip or anything you're
            considering. ORBIT is built to search, compare and find what is
            actually worth choosing.
          </p>

          {/* Search */}
          <div
            className={`mx-auto mt-12 max-w-3xl rounded-[28px] border p-2 transition-all duration-300 ${
              focused
                ? "border-white/20 bg-white/[0.055] shadow-[0_0_80px_rgba(255,255,255,0.045)]"
                : "border-white/10 bg-white/[0.035]"
            }`}
          >
            <div className="rounded-[21px] bg-[#0c0e11]">
              <div className="flex min-h-[92px] items-center gap-4 px-5 sm:px-6">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/55">
                  ✦
                </div>

                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && query.trim()) {
                      console.log("ORBIT SEARCH:", query);
                    }
                  }}
                  placeholder="What are you looking for?"
                  className="w-full bg-transparent text-base text-white outline-none placeholder:text-white/25 sm:text-lg"
                />

                <button
                  onClick={() => {
                    if (!query.trim()) return;
                    console.log("ORBIT SEARCH:", query);
                  }}
                  className="hidden shrink-0 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 sm:block"
                >
                  Search
                </button>
              </div>

              <div className="border-t border-white/[0.05] px-5 py-4 sm:px-6">
                <div className="flex flex-wrap gap-2">
                  {examples.map((example) => (
                    <button
                      key={example}
                      onClick={() => setQuery(example)}
                      className="rounded-full border border-white/7 bg-white/[0.025] px-3 py-2 text-left text-xs text-white/40 transition hover:border-white/15 hover:bg-white/[0.05] hover:text-white/70"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 text-xs text-white/25">
            Search naturally. No complicated filters required.
          </div>
        </div>
      </section>

      {/* Example analysis */}
      <section className="relative z-10 border-y border-white/[0.06] bg-white/[0.012] px-6 py-20 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-white/30">
                The idea
              </p>

              <h2 className="mt-5 max-w-xl text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                Don't search for options.
                <br />
                Search for the right one.
              </h2>

              <p className="mt-6 max-w-xl text-sm leading-7 text-white/40 sm:text-base">
                ORBIT is designed to turn a natural-language request into a
                structured search, compare the available choices and surface
                the strongest alternatives.
              </p>
            </div>

            <div className="rounded-[30px] border border-white/[0.08] bg-[#0b0d10] p-4 shadow-2xl">
              <div className="rounded-[24px] border border-white/[0.06] bg-[#101216] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Family house near Brest</div>
                    <div className="mt-1 text-xs text-white/30">
                      Under €450,000 · 140m²+ · 4 bedrooms
                    </div>
                  </div>

                  <span className="rounded-full border border-emerald-400/10 bg-emerald-400/[0.07] px-3 py-1 text-[11px] text-emerald-300/80">
                    Strong match
                  </span>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-3">
                  {[
                    ["127", "retrieved"],
                    ["38", "relevant"],
                    ["9", "strong"],
                  ].map(([value, label]) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4"
                    >
                      <div className="text-xl font-semibold">{value}</div>
                      <div className="mt-1 text-[11px] text-white/30">
                        {label}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
                  <div className="text-xs uppercase tracking-[0.18em] text-white/25">
                    Best overall
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-4">
                    <div>
                      <div className="text-lg font-medium">
                        Maison familiale
                      </div>
                      <div className="mt-1 text-sm text-white/35">
                        147m² · 4 bedrooms · garage · garden
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-xl font-semibold">€419k</div>
                      <div className="mt-1 text-xs text-white/30">
                        ORBIT 92
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 h-px bg-white/[0.06]" />

                  <div className="mt-4 grid gap-2 text-xs text-white/40 sm:grid-cols-2">
                    <div>✓ €31k below your maximum</div>
                    <div>✓ 7m² above your minimum</div>
                    <div>✓ Garage + garden</div>
                    <div>△ 11 min farther away</div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between text-xs text-white/25">
                  <span>DEMO DATA</span>
                  <span>Analysis preview</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Principles */}
      <section className="relative z-10 px-6 py-20 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                number: "01",
                title: "Understand",
                text: "Translate what you really want into structured criteria.",
              },
              {
                number: "02",
                title: "Compare",
                text: "Evaluate options, differences and trade-offs instead of just showing links.",
              },
              {
                number: "03",
                title: "Decide",
                text: "Surface the strongest choices and explain why they stand out.",
              },
            ].map((item) => (
              <div
                key={item.number}
                className="rounded-[24px] border border-white/[0.07] bg-white/[0.02] p-6 transition hover:border-white/[0.13] hover:bg-white/[0.03]"
              >
                <div className="text-xs text-white/20">{item.number}</div>
                <h3 className="mt-10 text-xl font-medium">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/35">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.06] px-6 py-8 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 text-xs text-white/25 sm:flex-row sm:items-center sm:justify-between">
          <div>ORBIT — Universal Decision Intelligence</div>
          <div>Demo foundation · Built for iteration</div>
        </div>
      </footer>
    </main>
  );
}