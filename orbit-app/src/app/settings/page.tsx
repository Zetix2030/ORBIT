"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "../../lib/supabase/client";

type OrbitSettings = {
  compactCards: boolean;
  animations: boolean;
  openOriginalNewTab: boolean;
  aiExplanations: boolean;
  rememberHistory: boolean;
  rememberFavorites: boolean;
  showCredits: boolean;
};

const DEFAULT_SETTINGS: OrbitSettings = {
  compactCards: false,
  animations: true,
  openOriginalNewTab: true,
  aiExplanations: true,
  rememberHistory: true,
  rememberFavorites: true,
  showCredits: true,
};

export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [settings, setSettings] =
    useState<OrbitSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      const { data } = await supabase.auth.getUser();

      if (!mounted) return;

      setUser(data.user ?? null);
      setAuthReady(true);

      try {
        const raw = localStorage.getItem("orbit-settings");
        if (raw) {
          setSettings({
            ...DEFAULT_SETTINGS,
            ...JSON.parse(raw),
          });
        }
      } catch {
        // ignore invalid local data
      }
    }

    void boot();

    const { data: listener } =
      supabase.auth.onAuthStateChange((_event, session) => {
        if (!mounted) return;
        setUser(session?.user ?? null);
      });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  function updateSetting<K extends keyof OrbitSettings>(
    key: K,
    value: OrbitSettings[K],
  ) {
    const next = {
      ...settings,
      [key]: value,
    };

    setSettings(next);

    try {
      localStorage.setItem(
        "orbit-settings",
        JSON.stringify(next),
      );
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1200);
    } catch {
      // ignore storage errors
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.replace("/");
  }

  function clearHistory() {
    try {
      localStorage.removeItem("orbit-recent-searches");
      localStorage.removeItem("orbit-history");
    } catch {}
  }

  function clearFavorites() {
    try {
      localStorage.removeItem("orbit-favorites");
    } catch {}
  }

  if (!authReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050607] text-white">
        <div className="text-sm text-white/35">Chargement des paramètres…</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050607] px-6 text-white">
        <div className="w-full max-w-md rounded-[28px] border border-white/[0.08] bg-white/[0.025] p-7 text-center">
          <div className="text-lg font-semibold">Connexion requise</div>
          <p className="mt-2 text-sm leading-6 text-white/35">
            Connecte-toi à ORBIT pour accéder à tes paramètres.
          </p>
          <button
            onClick={() => window.location.replace("/")}
            className="mt-6 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            Retour à l’accueil
          </button>
        </div>
      </main>
    );
  }

  const label =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "Compte ORBIT";

  const initial =
    String(label).trim().charAt(0).toUpperCase() || "O";

  return (
    <main className="min-h-screen bg-[#050607] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-56 left-[18%] h-[520px] w-[520px] rounded-full bg-[#6e7bff]/[0.09] blur-[150px]" />
        <div className="absolute right-[4%] top-[38%] h-[460px] w-[460px] rounded-full bg-[#38bdf8]/[0.05] blur-[150px]" />
      </div>

      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#050607]/80 backdrop-blur-2xl">
        <div className="mx-auto flex h-[72px] max-w-[1200px] items-center justify-between px-5 sm:px-7">
          <button
            onClick={() => window.location.assign("/")}
            className="flex items-center gap-3"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-xs font-bold text-black">
              O
            </span>
            <span>
              <span className="block text-xs font-semibold tracking-[0.28em]">
                ORBIT
              </span>
              <span className="mt-0.5 block text-[8px] uppercase tracking-[0.16em] text-white/25">
                Decision Intelligence
              </span>
            </span>
          </button>

          <div className="flex items-center gap-3">
            {saved && (
              <span className="hidden text-[10px] text-emerald-300/60 sm:block">
                Enregistré
              </span>
            )}

            <button
              onClick={() => window.location.assign("/")}
              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-xs text-white/50 transition hover:bg-white/[0.06] hover:text-white"
            >
              Retour à ORBIT
            </button>
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-[1200px] px-5 py-10 sm:px-7 lg:py-14">
        <div className="mb-10">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/25">
            Compte ORBIT
          </div>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
            Paramètres
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-white/35">
            Gère ton compte, ton expérience de recherche et les données
            conservées sur cet appareil.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[310px_1fr]">
          <aside className="h-fit rounded-[28px] border border-white/[0.07] bg-white/[0.022] p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-lg font-semibold text-black">
                {initial}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white/75">
                  {label}
                </div>
                <div className="mt-1 truncate text-[10px] text-white/25">
                  {user.email}
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-emerald-400/10 bg-emerald-400/[0.04] px-4 py-3">
              <div className="text-[9px] uppercase tracking-[0.15em] text-emerald-300/45">
                Statut
              </div>
              <div className="mt-1 text-xs text-emerald-200/70">
                Compte connecté
              </div>
            </div>

            <button
              onClick={handleSignOut}
              className="mt-5 w-full rounded-2xl border border-red-400/15 bg-red-400/[0.04] px-4 py-3 text-xs font-medium text-red-200/70 transition hover:bg-red-400/[0.08]"
            >
              Se déconnecter
            </button>
          </aside>

          <div className="space-y-6">
            <Section
              title="Recherche"
              description="Personnalise la façon dont ORBIT affiche et ouvre ses résultats."
            >
              <Toggle
                title="Cartes compactes"
                description="Affiche davantage de résultats à l’écran."
                value={settings.compactCards}
                onChange={(v) => updateSetting("compactCards", v)}
              />
              <Toggle
                title="Ouvrir les annonces dans un nouvel onglet"
                description="Garde ORBIT ouvert lorsque tu consultes une source originale."
                value={settings.openOriginalNewTab}
                onChange={(v) => updateSetting("openOriginalNewTab", v)}
              />
              <Toggle
                title="Explications IA"
                description="Affiche les raisons détaillées derrière le score ORBIT."
                value={settings.aiExplanations}
                onChange={(v) => updateSetting("aiExplanations", v)}
              />
            </Section>

            <Section
              title="Interface"
              description="Ajuste quelques détails de l’expérience visuelle."
            >
              <Toggle
                title="Animations"
                description="Transitions, effets et micro-interactions de l’interface."
                value={settings.animations}
                onChange={(v) => updateSetting("animations", v)}
              />
              <Toggle
                title="Afficher les crédits"
                description="Affiche le nombre de crédits consommés dans la barre supérieure."
                value={settings.showCredits}
                onChange={(v) => updateSetting("showCredits", v)}
              />
              <StaticRow
                title="Thème"
                description="Le thème sombre ORBIT est actuellement utilisé."
                value="Sombre"
              />
            </Section>

            <Section
              title="Données"
              description="Choisis ce qui est conservé localement dans ton navigateur."
            >
              <Toggle
                title="Mémoriser l’historique"
                description="Conserve tes recherches récentes sur cet appareil."
                value={settings.rememberHistory}
                onChange={(v) => updateSetting("rememberHistory", v)}
              />
              <Toggle
                title="Mémoriser les favoris"
                description="Conserve les annonces ajoutées à tes favoris."
                value={settings.rememberFavorites}
                onChange={(v) => updateSetting("rememberFavorites", v)}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={clearHistory}
                  className="rounded-2xl border border-white/[0.06] bg-white/[0.018] p-4 text-left transition hover:bg-white/[0.035]"
                >
                  <div className="text-xs font-medium text-white/65">
                    Effacer l’historique
                  </div>
                  <div className="mt-1 text-[10px] leading-5 text-white/25">
                    Supprime les recherches enregistrées localement.
                  </div>
                </button>

                <button
                  onClick={clearFavorites}
                  className="rounded-2xl border border-white/[0.06] bg-white/[0.018] p-4 text-left transition hover:bg-white/[0.035]"
                >
                  <div className="text-xs font-medium text-white/65">
                    Effacer les favoris
                  </div>
                  <div className="mt-1 text-[10px] leading-5 text-white/25">
                    Supprime les favoris conservés sur cet appareil.
                  </div>
                </button>
              </div>
            </Section>

            <Section
              title="À propos"
              description="Informations sur cette version d’ORBIT."
            >
              <StaticRow
                title="Produit"
                description="Moteur de recherche et d’aide à la décision multi-source."
                value="ORBIT"
              />
              <StaticRow
                title="Compte"
                description="Authentification gérée avec Supabase."
                value="Google"
              />
              <StaticRow
                title="Version"
                description="Version de développement actuelle."
                value="Beta"
              />
            </Section>
          </div>
        </div>
      </div>
    </main>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-white/[0.07] bg-white/[0.022] p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-white/75">{title}</h2>
        <p className="mt-1 text-[11px] leading-6 text-white/27">
          {description}
        </p>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Toggle({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between gap-5 rounded-2xl border border-white/[0.06] bg-black/10 p-4 text-left transition hover:bg-white/[0.025]"
    >
      <div>
        <div className="text-xs font-medium text-white/65">{title}</div>
        <div className="mt-1 text-[10px] leading-5 text-white/25">
          {description}
        </div>
      </div>

      <div
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          value ? "bg-white" : "bg-white/[0.08]"
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full transition-all ${
            value ? "left-6 bg-black" : "left-1 bg-white/40"
          }`}
        />
      </div>
    </button>
  );
}

function StaticRow({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-5 rounded-2xl border border-white/[0.06] bg-black/10 p-4">
      <div>
        <div className="text-xs font-medium text-white/65">{title}</div>
        <div className="mt-1 text-[10px] leading-5 text-white/25">
          {description}
        </div>
      </div>
      <span className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-[10px] text-white/45">
        {value}
      </span>
    </div>
  );
}
