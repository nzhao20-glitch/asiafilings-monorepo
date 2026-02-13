#!/bin/bash
# Complete setup script for Korean SEC Filing Viewer

set -e  # Exit on error

echo "🚀 Korean SEC Filing Viewer - Complete Setup"
echo "=============================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Setup PostgreSQL
echo -e "${BLUE}Step 1: Setting up PostgreSQL database...${NC}"
sudo -u postgres psql -f setup-db.sql
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Database setup complete!${NC}"
else
    echo -e "${RED}❌ Database setup failed${NC}"
    exit 1
fi
echo ""

# Step 2: Generate Prisma Client
echo -e "${BLUE}Step 2: Generating Prisma client...${NC}"
cd backend
npx prisma generate
echo -e "${GREEN}✅ Prisma client generated!${NC}"
echo ""

# Step 3: Run Migrations
echo -e "${BLUE}Step 3: Running database migrations...${NC}"
npx prisma migrate dev --name init
echo -e "${GREEN}✅ Migrations complete!${NC}"
echo ""

# Step 4: Seed Database
echo -e "${BLUE}Step 4: Seeding database with test users...${NC}"
npm run seed 2>/dev/null || echo -e "${YELLOW}⚠️  Seed script not found, skipping...${NC}"
echo ""

# Go back to root
cd ..

# Step 5: Final Instructions
echo -e "${GREEN}=============================================="
echo "✅ Setup Complete!"
echo "==============================================${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Start the application:"
echo "   ${GREEN}npm run dev${NC}"
echo ""
echo "2. Open your browser:"
echo "   ${GREEN}http://localhost:3000${NC}"
echo ""
echo "3. Login with test credentials:"
echo "   Admin: ${GREEN}admin@koreansec.dev / admin123!${NC}"
echo "   User:  ${GREEN}test@institutional.com / user123!${NC}"
echo ""
echo -e "${YELLOW}Note: Redis is not installed. Queue features won't work, but basic app will function.${NC}"
echo ""
