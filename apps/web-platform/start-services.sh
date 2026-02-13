#!/bin/bash
# Start both frontend and backend services

echo "🚀 Starting Korean SEC Filing Viewer Services..."
echo ""

# Check if we're in the right directory
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo "❌ Error: Please run this from /home/nzhao/KoreanSEC"
    exit 1
fi

# Check if database is running
echo "🔍 Checking PostgreSQL..."
sudo service postgresql status > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "⚠️  PostgreSQL not running, starting it..."
    sudo service postgresql start
fi

echo ""
echo "✅ Starting services..."
echo "   Backend: http://localhost:3001"
echo "   Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Start both services
npm run dev
