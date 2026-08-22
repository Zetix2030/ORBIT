#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="docker-compose.searxng.yml"
SEARX_URL="${SEARXNG_URL:-http://127.0.0.1:8080}"
CONTAINER_NAME="orbit-searxng"

printf '\nORBIT — démarrage du moteur de recherche SearXNG\n'

if ! command -v docker >/dev/null 2>&1; then
  echo "ERREUR: Docker n'est pas disponible dans ce Codespace."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERREUR: Docker est installé mais le daemon n'est pas accessible."
  exit 1
fi

# Toujours recréer le conteneur pour appliquer la configuration SearXNG du dépôt.
# Cela évite de réutiliser une ancienne instance qui répond sur le port 8080 mais
# utilise encore de vieux moteurs/réglages et renvoie 0 résultat.
if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi

docker compose -f "$COMPOSE_FILE" up -d --force-recreate searxng

printf 'Attente de SearXNG'
READY=0
for _ in $(seq 1 50); do
  if curl -fsS --max-time 3 "$SEARX_URL/search?q=maison+brest&format=json" >/tmp/orbit-searx-health.json 2>/dev/null; then
    READY=1
    break
  fi
  printf '.'
  sleep 1
done
printf '\n'

if [ "$READY" -ne 1 ]; then
  echo "ERREUR: SearXNG n'a pas répondu après 50 secondes."
  docker ps -a --filter "name=^/${CONTAINER_NAME}$" || true
  docker logs --tail=120 "$CONTAINER_NAME" 2>/dev/null || true
  exit 1
fi

RESULT_COUNT="$(node -e 'try{const j=require("/tmp/orbit-searx-health.json"); console.log(Array.isArray(j.results)?j.results.length:0)}catch(e){console.log(0)}')"

echo "SearXNG prêt: $SEARX_URL"
echo "Test réel SearXNG: ${RESULT_COUNT} résultat(s) pour maison Brest"

if [ "${RESULT_COUNT:-0}" -eq 0 ]; then
  echo "ATTENTION: SearXNG répond mais ses moteurs ne renvoient rien."
  echo "Derniers logs utiles:"
  docker logs --tail=80 "$CONTAINER_NAME" 2>/dev/null || true
fi

echo "Démarrage de Next.js..."
echo

export SEARXNG_URL="$SEARX_URL"
exec npx next dev
