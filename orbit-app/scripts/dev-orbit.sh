#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="docker-compose.searxng.yml"
SEARX_URL="${SEARXNG_URL:-http://127.0.0.1:8080}"
CONTAINER_NAME="orbit-searxng"

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

# Un ancien conteneur ORBIT peut déjà exister après des tests précédents.
# Si c'est le cas, on le réutilise s'il est sain, sinon on le remplace proprement.
if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  echo "Conteneur SearXNG existant détecté. Vérification..."

  if ! docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    docker start "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi

  READY_EXISTING=0
  for _ in $(seq 1 8); do
    if curl -fsS --max-time 3 "$SEARX_URL/search?q=orbit&format=json" >/dev/null 2>&1; then
      READY_EXISTING=1
      break
    fi
    sleep 1
  done

  if [ "$READY_EXISTING" -eq 1 ]; then
    echo "SearXNG existant réutilisé."
  else
    echo "Ancien conteneur SearXNG inutilisable: remplacement automatique."
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
fi

if ! curl -fsS --max-time 3 "$SEARX_URL/search?q=orbit&format=json" >/dev/null 2>&1; then
  docker compose -f "$COMPOSE_FILE" up -d --force-recreate searxng
fi

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
  docker ps -a --filter "name=^/${CONTAINER_NAME}$" || true
  echo "Derniers logs SearXNG:"
  docker logs --tail=80 "$CONTAINER_NAME" 2>/dev/null || true
  exit 1
fi

export SEARXNG_URL="$SEARX_URL"
echo "SearXNG prêt: $SEARX_URL"
echo "Démarrage de Next.js..."
echo

exec npx next dev
