#!/bin/bash
# Deploy to ECS Fargate
# Usage: ./deploy.sh [environment]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-prod}
AWS_REGION="ap-northeast-2"
PROJECT_NAME="koreansec"
CLUSTER_NAME="${PROJECT_NAME}-${ENVIRONMENT}-cluster"
SERVICE_NAME="${PROJECT_NAME}-${ENVIRONMENT}-service"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deploying to ECS Fargate${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Environment: ${ENVIRONMENT}"
echo "Cluster: ${CLUSTER_NAME}"
echo "Service: ${SERVICE_NAME}"
echo "AWS Region: ${AWS_REGION}"
echo ""

# Build and push Docker image
echo -e "${BLUE}► Step 1: Building and pushing Docker image...${NC}"
./build-and-push.sh ${ENVIRONMENT} latest
echo ""

# Force new deployment
echo -e "${BLUE}► Step 2: Forcing new ECS deployment...${NC}"
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION} \
  --output table

echo ""
echo -e "${YELLOW}► Waiting for deployment to stabilize...${NC}"
echo "This may take 2-3 minutes..."
echo ""

aws ecs wait services-stable \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION}

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Deployment successful!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Get service information
echo -e "${BLUE}► Service Information:${NC}"
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].{
    Status:status,
    DesiredCount:desiredCount,
    RunningCount:runningCount,
    PendingCount:pendingCount,
    TaskDefinition:taskDefinition
  }' \
  --output table

echo ""

# Get load balancer URL
echo -e "${BLUE}► Load Balancer URL:${NC}"
ALB_NAME="${PROJECT_NAME}-${ENVIRONMENT}-alb"
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --names ${ALB_NAME} \
  --region ${AWS_REGION} \
  --query 'LoadBalancers[0].DNSName' \
  --output text 2>/dev/null || echo "Not found")

if [ "${ALB_DNS}" != "Not found" ]; then
  echo "http://${ALB_DNS}"
  echo "Health check: http://${ALB_DNS}/health"
else
  echo "ALB not found. Run 'terraform apply' first to create infrastructure."
fi

echo ""
echo -e "${GREEN}Deployment complete!${NC}"
echo ""
