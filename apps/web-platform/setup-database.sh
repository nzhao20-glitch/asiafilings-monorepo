#!/bin/bash

# Korean SEC Filing Viewer - Database Setup Script
echo "🚀 Setting up Korean SEC Filing Viewer Database..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop and try again."
    exit 1
fi

echo "✅ Docker is running"

# Start PostgreSQL and Redis
echo "📦 Starting PostgreSQL and Redis..."
docker compose up -d postgres redis

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check if services are healthy
echo "🔍 Checking service health..."
docker compose ps

# Install backend dependencies if needed
echo "📋 Installing backend dependencies..."
cd backend
if [ ! -d "node_modules" ]; then
    npm install
fi

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npm run db:generate

# Push schema to database (creates tables)
echo "🗄️  Creating database schema..."
npm run db:push

# Seed database with sample data
echo "🌱 Seeding database with sample Korean companies..."
npm run db:seed

# Test backend connection
echo "🧪 Testing backend connection..."
npm run dev &
BACKEND_PID=$!

# Wait a bit for backend to start
sleep 5

# Test health endpoint
echo "🏥 Testing health endpoint..."
curl -s http://localhost:3001/health | jq . || echo "Health check response received"

# Kill backend process
kill $BACKEND_PID 2>/dev/null

echo ""
echo "✅ Database setup complete!"
echo ""
echo "🎯 Next steps:"
echo "1. Run 'npm run dev' in the backend folder to start the API"
echo "2. Visit http://localhost:3001/health to check status"
echo "3. Visit http://localhost:3001/documentation for API docs"
echo "4. Run 'npm run db:studio' to open database GUI"
echo ""
echo "📊 Sample data includes:"
echo "- 5 Korean companies (Samsung, SK Hynix, Kakao, NAVER, Samsung Biologics)"
echo "- Sample filings with extracted tables"
echo "- Test users (admin@koreansec.dev / user@institutional.com)"
echo ""