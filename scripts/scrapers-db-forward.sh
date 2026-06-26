#!/bin/bash

export KUBECONFIG=/Users/vlad/Documents/Workspace/Lime/kubeconfig/token.kubeconfig

NAMESPACE="lime-postgresql-production"
SERVICE="service/lime-postgresql-production"
LOCAL_PORT=5434   # 5433 is taken by quality_db (Docker)
REMOTE_PORT=5432

echo "🔌 Підключення до $SERVICE в namespace $NAMESPACE..."
echo "Порт-форвард: localhost:$LOCAL_PORT -> $REMOTE_PORT"

kubectl -n "$NAMESPACE" port-forward "$SERVICE" "$LOCAL_PORT:$REMOTE_PORT" --address='0.0.0.0'
