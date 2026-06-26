#!/bin/bash

export KUBECONFIG=/Users/vlad/Documents/Workspace/Lime/kubeconfig/token.kubeconfig

NAMESPACE="lime-postgresql-production"
SERVICE="service/lime-postgresql-production"
LOCAL_PORT=5434   # 5432/5433 taken by local PG and quality_db Docker
REMOTE_PORT=5432

echo "🔌 [PROD] Підключення до $SERVICE в namespace $NAMESPACE..."
echo "Порт-форвард: localhost:$LOCAL_PORT -> $REMOTE_PORT"

kubectl -n "$NAMESPACE" port-forward "$SERVICE" "$LOCAL_PORT:$REMOTE_PORT" --address='0.0.0.0'
