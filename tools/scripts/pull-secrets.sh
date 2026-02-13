#!/usr/bin/env bash

# ============================================================================
# pull-secrets.sh
#
# Fetches secrets from AWS SSM Parameter Store and writes them to a .env file
# in the appropriate app directory.
#
# SSM path convention: /platform/{app_name}/{env}/{KEY}
#
# Usage:
#   ./tools/scripts/pull-secrets.sh --app web --env dev
#   ./tools/scripts/pull-secrets.sh --app lambda --env prod
#   ./tools/scripts/pull-secrets.sh --app etl --env dev
#   ./tools/scripts/pull-secrets.sh --help
#
# Requirements:
#   - AWS CLI v2 installed and configured
#   - jq installed
#   - Appropriate IAM permissions for ssm:GetParametersByPath
# ============================================================================

set -euo pipefail

# ── Constants ───────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ── Usage ───────────────────────────────────────────────────────────────────

usage() {
  cat <<HELP
Usage: $(basename "$0") --app <app> --env <env> [--region <region>]
       $(basename "$0") --type keys --name <key-name> [--output <path>] [--region <region>]

Pull secrets from AWS SSM Parameter Store and write them to a .env file
in the correct application directory, or fetch SSH keys on demand.

Modes:
  DEFAULT           Pull .env parameters for an app/environment
  --type keys       Pull an SSH private key from SSM

Options (default mode):
  --app <app>       Application shortname (required)
                      web    -> apps/web-platform
                      lambda -> apps/serverless-functions
                      etl    -> apps/data-pipeline

  --env <env>       Environment (required)
                      dev    -> development parameters
                      prod   -> production parameters

Options (keys mode):
  --type keys       Switch to SSH key retrieval mode
  --name <name>     Key name in SSM (required). Available keys:
                      asiafilings-hk-ec2       -> EC2 deploy key (HK)
                      lightsail-ap-northeast-2 -> Lightsail key
                      lightsail-ap-northeast   -> Lightsail key
  --output <path>   Output file path (default: ./{name}.pem)

Common Options:
  --region <region> AWS region (default: ap-east-1, or AWS_REGION env var)
  --help            Show this help message

Examples:
  $(basename "$0") --app web --env dev
  $(basename "$0") --app lambda --env prod --region ap-east-1
  $(basename "$0") --type keys --name asiafilings-hk-ec2
  $(basename "$0") --type keys --name asiafilings-hk-ec2 --output ~/.ssh/asiafilings.pem

SSM Path Convention:
  Parameters: /platform/{app}/{env}/{PARAM_NAME}
  SSH Keys:   /platform/keys/{KEY_NAME}

Output:
  Parameters: .env.development or .env.production in the app directory
  SSH Keys:   .pem file with chmod 600 (owner-only read/write)
HELP
  exit 0
}

# ── Argument Parsing ────────────────────────────────────────────────────────

APP=""
ENV=""
REGION="${AWS_REGION:-ap-east-1}"
MODE="env"          # "env" or "keys"
KEY_NAME=""
KEY_OUTPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP="$2"
      shift 2
      ;;
    --env)
      ENV="$2"
      shift 2
      ;;
    --type)
      MODE="$2"
      shift 2
      ;;
    --name)
      KEY_NAME="$2"
      shift 2
      ;;
    --output)
      KEY_OUTPUT="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --help|-h)
      usage
      ;;
    *)
      echo "Error: Unknown argument '$1'"
      echo "Run '$(basename "$0") --help' for usage."
      exit 1
      ;;
  esac
done

# ── SSH Keys Mode ──────────────────────────────────────────────────────────

if [[ "${MODE}" == "keys" ]]; then
  if [[ -z "${KEY_NAME}" ]]; then
    echo "Error: --name is required in keys mode."
    echo "Run '$(basename "$0") --help' for usage."
    exit 1
  fi

  # Check prerequisites
  if ! command -v aws &>/dev/null; then
    echo "Error: AWS CLI not found. Install it: https://aws.amazon.com/cli/"
    exit 1
  fi

  SSM_KEY_PATH="/platform/keys/${KEY_NAME}"
  OUTPUT_FILE="${KEY_OUTPUT:-${KEY_NAME}.pem}"

  echo "============================================"
  echo "Pulling SSH key from SSM Parameter Store"
  echo "  SSM Path:   ${SSM_KEY_PATH}"
  echo "  Region:     ${REGION}"
  echo "  Output:     ${OUTPUT_FILE}"
  echo "============================================"
  echo ""

  KEY_VALUE=$(aws ssm get-parameter \
    --name "${SSM_KEY_PATH}" \
    --with-decryption \
    --region "${REGION}" \
    --query 'Parameter.Value' \
    --output text 2>&1)

  if [[ $? -ne 0 ]]; then
    echo "Error: Failed to fetch key from SSM."
    echo "${KEY_VALUE}"
    exit 1
  fi

  # Write key file with secure permissions
  umask 077
  echo "${KEY_VALUE}" > "${OUTPUT_FILE}"
  chmod 600 "${OUTPUT_FILE}"

  echo "SSH key written to ${OUTPUT_FILE} (permissions: 600)"
  echo ""
  echo "Usage:"
  echo "  ssh -i ${OUTPUT_FILE} ec2-user@<host>"
  echo ""
  echo "============================================"
  echo "Done."
  echo "============================================"
  exit 0
fi

# ── Validation (env mode) ──────────────────────────────────────────────────

if [[ -z "${APP}" ]]; then
  echo "Error: --app is required."
  echo "Run '$(basename "$0") --help' for usage."
  exit 1
fi

if [[ -z "${ENV}" ]]; then
  echo "Error: --env is required."
  echo "Run '$(basename "$0") --help' for usage."
  exit 1
fi

# Map app shortname to SSM path prefix and output directory
case "${APP}" in
  web)
    SSM_PATH="/platform/web/${ENV}"
    OUTPUT_DIR="${REPO_ROOT}/apps/web-platform"
    ;;
  lambda)
    SSM_PATH="/platform/lambda/${ENV}"
    OUTPUT_DIR="${REPO_ROOT}/apps/serverless-functions"
    ;;
  etl)
    SSM_PATH="/platform/etl/${ENV}"
    OUTPUT_DIR="${REPO_ROOT}/apps/data-pipeline"
    ;;
  *)
    echo "Error: Unknown app '${APP}'. Valid options: web, lambda, etl"
    exit 1
    ;;
esac

# Map env to filename suffix
case "${ENV}" in
  dev)
    ENV_FILENAME=".env.development"
    ;;
  prod)
    ENV_FILENAME=".env.production"
    ;;
  *)
    echo "Error: Unknown env '${ENV}'. Valid options: dev, prod"
    exit 1
    ;;
esac

# Check prerequisites
if ! command -v aws &>/dev/null; then
  echo "Error: AWS CLI not found. Install it: https://aws.amazon.com/cli/"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq not found. Install it: https://stedolan.github.io/jq/"
  exit 1
fi

if [[ ! -d "${OUTPUT_DIR}" ]]; then
  echo "Error: Output directory does not exist: ${OUTPUT_DIR}"
  exit 1
fi

# ── Fetch Parameters ────────────────────────────────────────────────────────

OUTPUT_FILE="${OUTPUT_DIR}/${ENV_FILENAME}"
SSM_PATH_WITH_SLASH="${SSM_PATH}/"

echo "============================================"
echo "Pulling secrets from SSM Parameter Store"
echo "  SSM Path:   ${SSM_PATH_WITH_SLASH}"
echo "  Region:     ${REGION}"
echo "  Output:     ${OUTPUT_FILE}"
echo "============================================"
echo ""

# Fetch all parameters under the path (handles pagination via --recursive)
PARAMS_JSON=$(aws ssm get-parameters-by-path \
  --path "${SSM_PATH_WITH_SLASH}" \
  --recursive \
  --with-decryption \
  --region "${REGION}" \
  --output json 2>&1)

if [[ $? -ne 0 ]]; then
  echo "Error: Failed to fetch parameters from SSM."
  echo "${PARAMS_JSON}"
  exit 1
fi

PARAM_COUNT=$(echo "${PARAMS_JSON}" | jq '.Parameters | length')

if [[ "${PARAM_COUNT}" -eq 0 ]]; then
  echo "Warning: No parameters found at ${SSM_PATH_WITH_SLASH}"
  echo "Nothing to write."
  exit 0
fi

echo "Found ${PARAM_COUNT} parameters."
echo ""

# ── Write .env File ─────────────────────────────────────────────────────────

# Build the .env file content
{
  echo "# ============================================"
  echo "# Auto-generated from AWS SSM Parameter Store"
  echo "# Source: ${SSM_PATH_WITH_SLASH}"
  echo "# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "# Region: ${REGION}"
  echo "# ============================================"
  echo ""
} > "${OUTPUT_FILE}"

# Extract each parameter: strip the SSM path prefix to get the key name
echo "${PARAMS_JSON}" | jq -r '.Parameters[] | "\(.Name)=\(.Value)"' | while IFS='=' read -r name value; do
  # Strip the path prefix to get the KEY name
  # e.g., /platform/web/dev/DATABASE_URL -> DATABASE_URL
  KEY="${name##*/}"
  echo "${KEY}=${value}" >> "${OUTPUT_FILE}"
done

echo "Written ${PARAM_COUNT} parameters to ${OUTPUT_FILE}"
echo ""
echo "============================================"
echo "Done."
echo "============================================"
