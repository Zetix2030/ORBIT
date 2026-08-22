#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="docker-compose.searxng.yml"
SEARX_URL="${SEARXNG_URL:-http://127.0.0.1:8080}"

printf '\nORBIT — démarrage du moteur de recherche SearXNG\n'

if ! command -v docker >/dev/null 2>&1; then
  echo "ERREUR: Docker n'est pas disponible dans ce Codespace."
  echo "ORBIT a besoin de Docker pour lancer SearXNG localement."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERREUR: Docker est installé mais le daemon n'est pas accessible."
  echo "Redémarre le Codespace puis relance: npm run dev"
  exit 1
fi

docker compose -f "$COMPOSE_FILE" up -d searxng

printf 'Attente de SearXNG'
READY=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 3 "$SEARX_URL/search?q=orbit&format=json" >/dev/null 2>&1; then
    READY=1
    break
  fi
  printf '.'
  sleep 1
done
printf '\n'

if [ "$READY" -ne 1 ]; then
  echo "ERREUR: SearXNG n'a pas répondu après 40 secondes."
  echo "État du conteneur:"
  docker compose -f "$COMPOSE_FILE" ps || true
  echo "Derniers logs SearXNG:"
  docker compose -f "$COMPOSE_FILE" logs --tail=80 searxng || true
  exit 1
fi

export SEARXNG_URL="$SEARX_URL"
echo "SearXNG prêt: $SEARX_URL"
echo "Démarrage de Next.js..."
echo

exec npx next dev
