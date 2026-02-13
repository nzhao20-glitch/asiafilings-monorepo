#!/bin/bash
# AsiaFilings EC2 Deployment Script
# Run this script on the EC2 instance to deploy updates

set -e

# Configuration
APP_DIR="/opt/asiafilings"
COMPOSE_FILE="docker-compose.prod.yml"
BRANCH="${1:-main}"

echo "============================================"
echo "AsiaFilings Deployment Script"
echo "============================================"
echo "Timestamp: $(date)"
echo "Branch: $BRANCH"
echo ""

cd "$APP_DIR"

# Pull latest code
echo "[1/5] Pulling latest code from $BRANCH..."
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

# Build containers
echo "[2/5] Building Docker containers..."
docker compose -f "$COMPOSE_FILE" build

# Stop existing containers
echo "[3/5] Stopping existing containers..."
docker compose -f "$COMPOSE_FILE" down

# Start new containers
echo "[4/5] Starting containers..."
docker compose -f "$COMPOSE_FILE" up -d

# Wait for services to be healthy
echo "[5/5] Waiting for services to be healthy..."
sleep 30

# Run database migrations
echo "Running database migrations..."
docker compose -f "$COMPOSE_FILE" exec -T backend npx prisma migrate deploy || {
    echo "Warning: Migration failed, but containers are running"
}

# Health check
echo ""
echo "============================================"
echo "Deployment Complete!"
echo "============================================"

echo ""
echo "Container Status:"
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo "Health Check:"
if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    echo "  Backend API: OK"
else
    echo "  Backend API: FAILED"
fi

if curl -sf http://localhost:3000 > /dev/null 2>&1; then
    echo "  Frontend: OK"
else
    echo "  Frontend: FAILED"
fi

echo ""
echo "View logs: docker compose -f $COMPOSE_FILE logs -f"
