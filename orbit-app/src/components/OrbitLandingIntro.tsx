"use client";

import { usePathname } from "next/navigation";

export default function OrbitLandingIntro() {
  const pathname = usePathname();

  if (pathname !== "/") return null;

  function scrollToOrbit() {
    window.scrollTo({
      top: window.innerHeight,
      behavior: "smooth",
    });
  }

  return (
    <section className="relative flex min-h-[100svh] w-full items-center justify-center overflow-hidden bg-[#050607] px-6 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-18%] h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/[0.055] blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-8%] h-[420px] w-[420px] rounded-full bg-white/[0.035] blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_76%)]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center text-center">
        <div className="mb-8 flex items-center gap-3 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-white/55 backdrop-blur-xl">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.85)]" />
          Immobilier en France · Recherche & décision
        </div>

        <div className="mb-8 grid h-20 w-20 place-items-center rounded-[26px] border border-white/[0.11] bg-white/[0.045] shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="relative h-8 w-8 rounded-full border border-white/80">
            <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
            <span className="absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border border-white/70 bg-[#050607]" />
          </div>
        </div>

        <p className="mb-4 text-xs font-medium uppercase tracking-[0.38em] text-white/35">
          ORBIT
        </p>

        <h1 className="max-w-5xl text-balance text-[clamp(3.4rem,8vw,7.8rem)] font-semibold leading-[0.92] tracking-[-0.065em] text-white">
          Trouve le bon bien.
          <span className="block text-white/38">Pas juste une annonce.</span>
        </h1>

        <p className="mt-8 max-w-2xl text-pretty text-sm leading-7 text-white/42 sm:text-base">
          ORBIT explore le marché immobilier français, vérifie les annonces, compare les prix et classe les meilleures opportunités selon tes critères.
        </p>

        <button
          type="button"
          onClick={scrollToOrbit}
          className="group mt-10 inline-flex items-center gap-3 rounded-2xl border border-white/[0.12] bg-white px-5 py-3 text-sm font-semibold text-black transition duration-300 hover:-translate-y-0.5 hover:bg-white/90"
        >
          Explorer ORBIT
          <span className="transition-transform duration-300 group-hover:translate-y-0.5">↓</span>
        </button>

        <button
          type="button"
          onClick={scrollToOrbit}
          aria-label="Faire défiler vers ORBIT"
          className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-white/25 transition hover:text-white/50"
        >
          <span>Faire défiler</span>
          <span className="flex h-9 w-6 items-start justify-center rounded-full border border-white/[0.12] p-1.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/45" />
          </span>
        </button>
      </div>
    </section>
  );
}
