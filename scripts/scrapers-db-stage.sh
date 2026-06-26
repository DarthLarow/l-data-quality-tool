#!/bin/bash

export KUBECONFIG=/Users/vlad/Documents/Workspace/Lime/kubeconfig/token.kubeconfig

NAMESPACE="lime-postgresql"
SERVICE="svc/lime-postgresql"
LOCAL_PORT=5435   # 5432/5433 taken by local PG and quality_db Docker
REMOTE_PORT=5432

echo "🔌 [STAGE] Підключення до $SERVICE в namespace $NAMESPACE..."
echo "Порт-форвард: localhost:$LOCAL_PORT -> $REMOTE_PORT"

kubectl port-forward "$SERVICE" "$LOCAL_PORT:$REMOTE_PORT" -n "$NAMESPACE"
