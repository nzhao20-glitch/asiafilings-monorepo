#!/bin/bash
# AsiaFilings Deployment Script
# Deploys the application to EC2 (ap-east-1 Hong Kong)
#
# Usage:
#   ./scripts/deploy.sh .env.production
#   ./scripts/deploy.sh .env.production --skip-build
#   ./scripts/deploy.sh --help

set -e

# Configuration
SERVER_IP="18.167.27.8"
SERVER_USER="ec2-user"
SSH_KEY="asiafilings-hk-key.pem"
REMOTE_DIR="/home/ec2-user/AsiaFilings"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Find SSH key (check project root and infrastructure/ec2)
find_ssh_key() {
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local project_root="$(dirname "$script_dir")"

    if [[ -f "$project_root/$SSH_KEY" ]]; then
        echo "$project_root/$SSH_KEY"
    elif [[ -f "$project_root/infrastructure/ec2/$SSH_KEY" ]]; then
        echo "$project_root/infrastructure/ec2/$SSH_KEY"
    else
        echo ""
    fi
}

# Print usage
usage() {
    echo "Usage: $0 <env-file> [options]"
    echo ""
    echo "Arguments:"
    echo "  <env-file>     Path to .env.production file (required)"
    echo ""
    echo "Options:"
    echo "  --skip-build   Skip Docker build (just restart containers)"
    echo "  --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 .env.production"
    echo "  $0 .env.production --skip-build"
}

# Print status message
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Parse arguments
ENV_FILE=""
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --help)
            usage
            exit 0
            ;;
        -*)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
        *)
            if [[ -z "$ENV_FILE" ]]; then
                ENV_FILE="$1"
            else
                log_error "Unexpected argument: $1"
                usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate env file argument
if [[ -z "$ENV_FILE" ]]; then
    log_error "Environment file is required"
    usage
    exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
    log_error "Environment file not found: $ENV_FILE"
    exit 1
fi

# Find SSH key
SSH_KEY_PATH=$(find_ssh_key)
if [[ -z "$SSH_KEY_PATH" ]]; then
    log_error "SSH key not found. Expected: $SSH_KEY"
    log_error "Looked in project root and infrastructure/ec2/"
    exit 1
fi

log_info "Using SSH key: $SSH_KEY_PATH"

# SSH command helper
ssh_cmd() {
    ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "$@"
}

# SCP command helper
scp_cmd() {
    scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "$@"
}

# Check AWS credentials on server
check_aws_credentials() {
    log_info "Checking AWS credentials on server..."
    local creds_exist
    creds_exist=$(ssh_cmd "test -f ~/.aws/credentials && echo 'yes' || echo 'no'")

    if [[ "$creds_exist" != "yes" ]]; then
        log_error "AWS credentials not found on server!"
        log_error "Please set up ~/.aws/credentials on the server with:"
        echo ""
        echo "  ssh -i $SSH_KEY_PATH $SERVER_USER@$SERVER_IP"
        echo "  mkdir -p ~/.aws"
        echo "  cat > ~/.aws/credentials << EOF"
        echo "  [default]"
        echo "  aws_access_key_id = YOUR_ACCESS_KEY"
        echo "  aws_secret_access_key = YOUR_SECRET_KEY"
        echo "  EOF"
        echo "  chmod 600 ~/.aws/credentials"
        echo ""
        exit 1
    fi
    log_info "AWS credentials found"
}

# Main deployment
main() {
    log_info "Starting deployment to $SERVER_IP"
    echo ""

    # Step 0: Check AWS credentials
    check_aws_credentials
    echo ""

    # Step 1: Upload .env file
    log_info "Step 1: Uploading environment file..."
    scp_cmd "$ENV_FILE" "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/.env"
    log_info "Environment file uploaded"
    echo ""

    # Step 2: Pull latest code
    log_info "Step 2: Pulling latest code..."
    ssh_cmd "cd $REMOTE_DIR && git pull origin main"
    log_info "Code updated"
    echo ""

    # Step 3: Build and restart containers
    if [[ "$SKIP_BUILD" == "true" ]]; then
        log_info "Step 3: Restarting containers (skip build)..."
        ssh_cmd "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml down && docker compose -f docker-compose.prod.yml up -d"
    else
        log_info "Step 3: Building and restarting containers..."
        ssh_cmd "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml build && docker compose -f docker-compose.prod.yml down && docker compose -f docker-compose.prod.yml up -d"
    fi
    log_info "Containers started"
    echo ""

    # Step 4: Wait for services to be ready
    log_info "Step 4: Waiting for services to start..."
    sleep 10

    # Step 5: Health check
    log_info "Step 5: Running health check..."
    local health_response
    health_response=$(ssh_cmd "curl -s http://localhost:3001/health" 2>/dev/null || echo "FAILED")

    if echo "$health_response" | grep -q '"status":"ok"'; then
        log_info "Health check passed!"
        echo "$health_response" | python3 -m json.tool 2>/dev/null || echo "$health_response"
    else
        log_warn "Health check returned unexpected response:"
        echo "$health_response"
    fi
    echo ""

    # Step 6: Show container status
    log_info "Step 6: Container status:"
    ssh_cmd "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
    echo ""

    log_info "Deployment complete!"
    echo ""
    echo "Access the application at:"
    echo "  - Frontend: http://$SERVER_IP (via nginx)"
    echo "  - Backend API: http://$SERVER_IP/api (via nginx)"
    echo "  - Direct backend: http://$SERVER_IP:3001"
}

main
