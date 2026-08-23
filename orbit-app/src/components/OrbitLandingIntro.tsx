"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const INTRO_KEY = "orbit:intro-seen:v1";

export default function OrbitLandingIntro() {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const completedRef = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pathname !== "/") return;
    if (sessionStorage.getItem(INTRO_KEY) === "1") {
      setHidden(true);
      return;
    }

    let raf = 0;

    const finishIntro = () => {
      if (completedRef.current) return;
      completedRef.current = true;
      sessionStorage.setItem(INTRO_KEY, "1");

      requestAnimationFrame(() => {
        setHidden(true);
        requestAnimationFrame(() => {
          window.scrollTo({ top: 0, behavior: "auto" });
        });
      });
    };

    const update = () => {
      raf = 0;
      const section = sectionRef.current;
      const panel = panelRef.current;
      const content = contentRef.current;
      const orbit = orbitRef.current;
      const progress = progressRef.current;
      const veil = veilRef.current;
      const line = lineRef.current;
      if (!section || !panel || !content || !orbit || !progress || !veil || !line) return;

      const top = section.offsetTop;
      const raw = (window.scrollY - top) / Math.max(1, window.innerHeight * 0.92);
      const p = Math.min(1, Math.max(0, raw));

      const smooth = p * p * (3 - 2 * p);
      const curtain = 1 - Math.pow(1 - p, 4);
      const textPhase = Math.min(1, p / 0.72);
      const revealPhase = Math.max(0, Math.min(1, (p - 0.22) / 0.78));

      panel.style.transform = `translate3d(0, ${-curtain * 101}%, 0) scale(${1 - p * 0.025})`;
      panel.style.borderRadius = `${smooth * 34}px`;
      panel.style.filter = `saturate(${1 - p * 0.08}) brightness(${1 - p * 0.06})`;

      content.style.transform = `translate3d(0, ${-textPhase * 120}px, 0) scale(${1 - textPhase * 0.09})`;
      content.style.opacity = String(Math.max(0, 1 - textPhase * 1.28));
      content.style.filter = `blur(${textPhase * 10}px)`;

      orbit.style.transform = `translate3d(-50%, ${p * 170}px, 0) scale(${1 + p * 0.42})`;
      orbit.style.opacity = String(Math.max(0.012, 0.085 - p * 0.065));

      veil.style.opacity = String(1 - revealPhase * 0.92);
      veil.style.transform = `translate3d(0, ${revealPhase * 18}px, 0) scale(${1 + revealPhase * 0.02})`;
      line.style.transform = `scaleX(${0.12 + revealPhase * 0.88})`;
      progress.style.transform = `scaleX(${Math.max(0.025, p)})`;
      panel.style.pointerEvents = p > 0.92 ? "none" : "auto";

      if (p >= 0.995) finishIntro();
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pathname]);

  if (pathname !== "/" || hidden) return null;

  return (
    <section ref={sectionRef} className="relative h-[100svh] w-full bg-[#050607]">
      <div
        ref={panelRef}
        className="fixed inset-0 z-[70] overflow-hidden bg-[#050607] text-white will-change-transform [box-shadow:0_55px_150px_rgba(0,0,0,.78)]"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-[40%] h-[58vw] max-h-[820px] w-[58vw] max-w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.05] blur-[145px]" />
          <div className="absolute bottom-[-24%] right-[-6%] h-[520px] w-[520px] rounded-full bg-blue-500/[0.055] blur-[145px]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.024)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.024)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_74%)]" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          <div
            ref={orbitRef}
            className="absolute bottom-[-4vw] left-1/2 select-none whitespace-nowrap text-[24vw] font-black leading-none tracking-[-0.09em] text-white will-change-transform"
            style={{ opacity: 0.085, transform: "translateX(-50%)" }}
          >
            ORBIT
          </div>
        </div>

        <div ref={contentRef} className="relative z-10 mx-auto flex h-full w-full max-w-7xl flex-col items-center justify-center px-6 text-center will-change-transform">
          <div className="mb-9 flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-white/55 backdrop-blur-xl">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,.9)]" />
            ORBIT · Immobilier en France
          </div>

          <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.55em] text-white/30">Recherche · Vérification · Décision</p>
          <h1 className="max-w-6xl text-balance text-[clamp(3.6rem,8.4vw,8.8rem)] font-semibold leading-[0.88] tracking-[-0.075em]">
            Trouve le bon bien.
            <span className="block bg-gradient-to-b from-white/58 to-white/18 bg-clip-text text-transparent">Pas juste une annonce.</span>
          </h1>
          <p className="mt-9 max-w-2xl text-pretty text-sm leading-7 text-white/42 sm:text-base">
            ORBIT explore le marché immobilier français, vérifie les annonces, compare les prix et fait remonter les opportunités qui méritent vraiment ton attention.
          </p>
        </div>

        <div className="absolute bottom-8 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-3 text-[9px] uppercase tracking-[0.32em] text-white/28">
          <span>Fais défiler</span>
          <span className="relative h-10 w-[1px] overflow-hidden bg-white/10"><span className="absolute left-0 top-0 h-1/2 w-full animate-[orbitScroll_1.6s_ease-in-out_infinite] bg-white/55" /></span>
        </div>

        <div className="absolute bottom-0 left-0 z-40 h-[2px] w-full bg-white/[0.04]">
          <div ref={progressRef} className="h-full w-full origin-left scale-x-[.025] bg-white/60 will-change-transform" />
        </div>
      </div>

      <div ref={veilRef} className="pointer-events-none fixed inset-0 z-[60] bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,.035),transparent_42%),linear-gradient(to_bottom,rgba(5,6,7,.9),rgba(5,6,7,.65))] will-change-transform" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[61] flex justify-center pb-8">
        <div ref={lineRef} className="h-px w-40 origin-center scale-x-[.12] bg-gradient-to-r from-transparent via-white/45 to-transparent will-change-transform" />
      </div>

      <style jsx global>{`
        @keyframes orbitScroll {
          0% { transform: translateY(-120%); opacity: 0; }
          25% { opacity: 1; }
          100% { transform: translateY(220%); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          html { scroll-behavior: auto !important; }
        }
      `}</style>
    </section>
  );
}
