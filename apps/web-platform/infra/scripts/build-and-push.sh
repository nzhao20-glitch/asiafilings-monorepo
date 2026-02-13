#!/bin/bash
# Build and Push Docker Image to ECR
# Usage: ./build-and-push.sh [environment] [tag]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-prod}
TAG=${2:-latest}
AWS_REGION="ap-northeast-2"
PROJECT_NAME="koreansec"
REPOSITORY_NAME="${PROJECT_NAME}-backend"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Building and Pushing Docker Image${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Environment: ${ENVIRONMENT}"
echo "Tag: ${TAG}"
echo "AWS Region: ${AWS_REGION}"
echo ""

# Get AWS Account ID
echo -e "${YELLOW}► Getting AWS Account ID...${NC}"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account ID: ${AWS_ACCOUNT_ID}"

# Construct ECR repository URL
ECR_REPOSITORY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPOSITORY_NAME}"
echo "ECR Repository: ${ECR_REPOSITORY}"
echo ""

# Login to ECR
echo -e "${YELLOW}► Logging in to ECR...${NC}"
aws ecr get-login-password --region ${AWS_REGION} | \
  docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Build Docker image
echo -e "${YELLOW}► Building Docker image...${NC}"
cd ../../backend
docker build --platform linux/amd64 -t ${REPOSITORY_NAME}:${TAG} -f Dockerfile .

# Tag image for ECR
echo -e "${YELLOW}► Tagging image for ECR...${NC}"
docker tag ${REPOSITORY_NAME}:${TAG} ${ECR_REPOSITORY}:${TAG}
docker tag ${REPOSITORY_NAME}:${TAG} ${ECR_REPOSITORY}:latest

# Push to ECR
echo -e "${YELLOW}► Pushing image to ECR...${NC}"
docker push ${ECR_REPOSITORY}:${TAG}
docker push ${ECR_REPOSITORY}:latest

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Image pushed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Image URL: ${ECR_REPOSITORY}:${TAG}"
echo "Latest URL: ${ECR_REPOSITORY}:latest"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Update ECS service to use new image:"
echo "   cd ../terraform"
echo "   terraform apply"
echo ""
echo "Or force new deployment:"
echo "   aws ecs update-service \\"
echo "     --cluster ${PROJECT_NAME}-${ENVIRONMENT}-cluster \\"
echo "     --service ${PROJECT_NAME}-${ENVIRONMENT}-service \\"
echo "     --force-new-deployment \\"
echo "     --region ${AWS_REGION}"
echo ""
