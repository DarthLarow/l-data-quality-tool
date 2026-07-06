#!/bin/bash

export KUBECONFIG=/Users/vlad/Documents/Workspace/Lime/kubeconfig/token.kubeconfig

NAMESPACE="lime-postgresql-production"
SERVICE="service/lime-postgresql-production"
LOCAL_PORT=5434   # 5432/5433 taken by local PG and quality_db Docker
REMOTE_PORT=5432

echo "🔌 [PROD] Підключення до $SERVICE в namespace $NAMESPACE..."
echo "Порт-форвард: localhost:$LOCAL_PORT -> $REMOTE_PORT"

# Ctrl+C виходить із циклу (а не лише вбиває поточний kubectl).
trap 'echo; echo "👋 Зупинено."; exit 0' INT

# Супервізор: kubectl port-forward періодично відвалюється (idle-таймаути, зміна
# мережі, рестарт API-сервера) і сам не перепідключається. Цикл піднімає його
# знову за ~2с, щоб довгі сесії не падали через тимчасовий обрив.
while true; do
  kubectl -n "$NAMESPACE" port-forward "$SERVICE" "$LOCAL_PORT:$REMOTE_PORT" --address='0.0.0.0'
  echo "⚠️  port-forward впав ($(date '+%H:%M:%S')), перепідключення через 2с..."
  sleep 2
done
