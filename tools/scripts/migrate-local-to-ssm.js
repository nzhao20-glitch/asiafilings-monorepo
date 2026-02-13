#!/usr/bin/env node

/**
 * migrate-local-to-ssm.js
 *
 * Reads .env files from all app directories, parses KEY=VALUE pairs,
 * and generates an upload-secrets.sh script with AWS CLI commands to
 * push each parameter to AWS SSM Parameter Store.
 *
 * Also handles:
 *   - SSH private keys (.pem) -> SSM SecureString at /platform/keys/{name}
 *   - Terraform .tfvars files -> SSM params at /platform/{app}/{env}/{KEY}
 *
 * SSM naming convention: /platform/{app_name}/{env}/{KEY}
 *   - web-platform     -> web
 *   - serverless-functions -> lambda
 *   - data-pipeline     -> etl
 *
 * SSH keys: /platform/keys/{key_name}
 *
 * Environment mapping:
 *   - .env.development  -> dev
 *   - .env.production   -> prod
 *   - .env.local        -> dev
 *   - .env              -> dev
 *
 * Usage:
 *   node tools/scripts/migrate-local-to-ssm.js
 *
 * Output:
 *   tools/scripts/upload-secrets.sh  (review before executing!)
 */

const fs = require('fs');
const path = require('path');

// ── Configuration ──────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Original source repos (for credentials not yet in monorepo)
const SOURCE_ROOT = path.resolve(REPO_ROOT, '..');

const APP_DIRS = [
  { dir: 'apps/web-platform', ssmName: 'web' },
  { dir: 'apps/serverless-functions', ssmName: 'lambda' },
  { dir: 'apps/data-pipeline', ssmName: 'etl' },
];

// SSH keys to migrate to SSM (from original source repos)
const SSH_KEYS = [
  {
    path: path.join(SOURCE_ROOT, 'AsiaFilings/LightsailDefaultKey-ap-northeast-2.pem'),
    ssmName: 'lightsail-ap-northeast-2',
    description: 'Lightsail SSH key for ap-northeast-2 region',
  },
  {
    path: path.join(SOURCE_ROOT, 'AsiaFilings/LightsailDefaultKey-ap-northeast.pem'),
    ssmName: 'lightsail-ap-northeast',
    description: 'Lightsail SSH key for ap-northeast region',
  },
  {
    path: path.join(SOURCE_ROOT, 'AsiaFilings/infrastructure/ec2/asiafilings-hk-key.pem'),
    ssmName: 'asiafilings-hk-ec2',
    description: 'EC2 SSH key for Hong Kong (18.167.27.8)',
  },
];

// Terraform .tfvars files to parse and migrate
const TFVARS_FILES = [
  {
    path: path.join(SOURCE_ROOT, 'filing-etl-pipeline/infrastructure/terraform.tfvars'),
    ssmName: 'etl',
    env: 'prod',
    description: 'ETL pipeline Terraform variables',
  },
];

const ENV_FILES = [
  '.env.development',
  '.env.production',
  '.env.local',
  '.env',
];

const ENV_MAP = {
  '.env.development': 'dev',
  '.env.production': 'prod',
  '.env.local': 'dev',
  '.env': 'dev',
};

// Keys containing any of these substrings (case-insensitive) get SecureString
const SENSITIVE_PATTERNS = [
  'PASSWORD',
  'SECRET',
  'KEY',
  'TOKEN',
  'DSN',
  'LICENSE',
  'CREDENTIAL',
  'API_KEY',
];

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse a .env file into an array of { key, value } objects.
 * Handles comments, blank lines, and quoted values.
 */
function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const entries = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    // Skip blank lines and comments
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.substring(0, eqIdx).trim();
    let value = line.substring(eqIdx + 1).trim();

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Skip keys that are empty identifiers
    if (!key) continue;

    entries.push({ key, value });
  }

  return entries;
}

/**
 * Determine SSM parameter type based on the key name.
 */
function getParamType(key) {
  const upper = key.toUpperCase();
  for (const pattern of SENSITIVE_PATTERNS) {
    if (upper.includes(pattern)) {
      return 'SecureString';
    }
  }
  return 'String';
}

/**
 * Escape a value for safe use inside single-quoted shell strings.
 * Single quotes are replaced with '\'' (end quote, escaped quote, new quote).
 */
function shellEscape(val) {
  return val.replace(/'/g, "'\\''");
}

/**
 * Parse a Terraform .tfvars file into an array of { key, value } objects.
 * Handles HCL-style assignments: key = "value" or key = value
 * Also handles lists: key = ["a", "b"] (stored as JSON string)
 */
function parseTfvarsFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const entries = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    const match = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (!match) continue;

    const key = match[1].trim();
    let value = match[2].trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Keep lists/arrays as-is (they'll be stored as JSON strings)
    if (!key) continue;
    entries.push({ key, value });
  }

  return entries;
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const commands = [];
  let totalParams = 0;
  const summary = [];

  for (const app of APP_DIRS) {
    const appPath = path.join(REPO_ROOT, app.dir);

    if (!fs.existsSync(appPath)) {
      console.log(`[SKIP] Directory not found: ${app.dir}`);
      continue;
    }

    for (const envFile of ENV_FILES) {
      const envPath = path.join(appPath, envFile);

      if (!fs.existsSync(envPath)) continue;

      const env = ENV_MAP[envFile];
      const entries = parseEnvFile(envPath);

      if (entries.length === 0) continue;

      const secureCount = entries.filter(e => getParamType(e.key) === 'SecureString').length;
      const plainCount = entries.length - secureCount;

      summary.push(
        `#   ${app.dir}/${envFile} -> /platform/${app.ssmName}/${env}/ (${entries.length} params: ${secureCount} SecureString, ${plainCount} String)`
      );

      commands.push('');
      commands.push(`# ── ${app.dir}/${envFile} -> /platform/${app.ssmName}/${env}/ ──`);
      commands.push('');

      for (const { key, value } of entries) {
        const paramType = getParamType(key);
        const ssmPath = `/platform/${app.ssmName}/${env}/${key}`;

        commands.push(
          `aws ssm put-parameter \\`,
          `  --name '${ssmPath}' \\`,
          `  --value '${shellEscape(value)}' \\`,
          `  --type ${paramType} \\`,
          `  --overwrite \\`,
          `  --region "\${AWS_REGION:-us-east-2}" \\`,
          `  && echo "  [OK] ${ssmPath}" \\`,
          `  || echo "  [FAIL] ${ssmPath}"`,
          ''
        );

        totalParams++;
      }
    }
  }

  // ── SSH Keys ──────────────────────────────────────────────────────────────

  const sshKeysFound = SSH_KEYS.filter(k => fs.existsSync(k.path));

  if (sshKeysFound.length > 0) {
    commands.push('');
    commands.push('# ══════════════════════════════════════════════════════════════════════');
    commands.push('# SSH PRIVATE KEYS -> /platform/keys/{name}');
    commands.push('# ══════════════════════════════════════════════════════════════════════');
    commands.push('');

    summary.push(`#   SSH keys -> /platform/keys/ (${sshKeysFound.length} keys)`);

    for (const keyDef of sshKeysFound) {
      const keyContent = fs.readFileSync(keyDef.path, 'utf-8').trim();
      const ssmPath = `/platform/keys/${keyDef.ssmName}`;

      // Use a heredoc for multi-line PEM content
      commands.push(
        `# ${keyDef.description}`,
        `aws ssm put-parameter \\`,
        `  --name '${ssmPath}' \\`,
        `  --value "$(cat <<'PEMEOF'`,
        keyContent,
        `PEMEOF`,
        `)" \\`,
        `  --type SecureString \\`,
        `  --overwrite \\`,
        `  --region "\${AWS_REGION:-ap-east-1}" \\`,
        `  && echo "  [OK] ${ssmPath}" \\`,
        `  || echo "  [FAIL] ${ssmPath}"`,
        ''
      );

      totalParams++;
    }
  }

  // ── Terraform .tfvars ────────────────────────────────────────────────────

  for (const tfDef of TFVARS_FILES) {
    if (!fs.existsSync(tfDef.path)) {
      console.log(`[SKIP] Terraform vars not found: ${tfDef.path}`);
      continue;
    }

    const entries = parseTfvarsFile(tfDef.path);
    if (entries.length === 0) continue;

    summary.push(
      `#   ${path.basename(tfDef.path)} -> /platform/${tfDef.ssmName}/${tfDef.env}/ (${entries.length} terraform vars)`
    );

    commands.push('');
    commands.push(`# ── Terraform: ${path.basename(tfDef.path)} -> /platform/${tfDef.ssmName}/${tfDef.env}/ ──`);
    commands.push('');

    for (const { key, value } of entries) {
      const paramType = getParamType(key);
      const ssmPath = `/platform/${tfDef.ssmName}/${tfDef.env}/${key}`;

      commands.push(
        `aws ssm put-parameter \\`,
        `  --name '${ssmPath}' \\`,
        `  --value '${shellEscape(value)}' \\`,
        `  --type ${paramType} \\`,
        `  --overwrite \\`,
        `  --region "\${AWS_REGION:-ap-east-1}" \\`,
        `  && echo "  [OK] ${ssmPath}" \\`,
        `  || echo "  [FAIL] ${ssmPath}"`,
        ''
      );

      totalParams++;
    }
  }

  if (totalParams === 0) {
    console.log('No .env files, SSH keys, or tfvars found. Nothing to generate.');
    process.exit(0);
  }

  // Build the output script
  const outputPath = path.join(__dirname, 'upload-secrets.sh');

  const header = [
    '#!/usr/bin/env bash',
    '',
    '# ============================================================================',
    '# upload-secrets.sh',
    '# Generated by migrate-local-to-ssm.js',
    `# Generated at: ${new Date().toISOString()}`,
    '#',
    '# This script uploads local .env parameters to AWS SSM Parameter Store.',
    '# SSM path convention: /platform/{app_name}/{env}/{KEY}',
    '#',
    '# IMPORTANT: Review this script carefully before running!',
    '#   - Ensure your AWS CLI is configured with appropriate credentials',
    '#   - Ensure you are targeting the correct AWS account and region',
    '#   - SecureString parameters will be encrypted with the default AWS KMS key',
    '#',
    '# Source files processed:',
    ...summary,
    `# Total parameters: ${totalParams}`,
    '# ============================================================================',
    '',
    'set -euo pipefail',
    '',
    'echo "============================================"',
    `echo "Uploading ${totalParams} parameters to SSM..."`,
    'echo "Region: ${AWS_REGION:-us-east-2}"',
    'echo "============================================"',
    'echo ""',
  ];

  const footer = [
    '',
    'echo ""',
    'echo "============================================"',
    'echo "Upload complete."',
    'echo "============================================"',
  ];

  const fullScript = [...header, ...commands, ...footer].join('\n') + '\n';

  fs.writeFileSync(outputPath, fullScript, { mode: 0o755 });

  console.log(`\n[SUCCESS] Generated: ${outputPath}`);
  console.log(`  Total parameters: ${totalParams}`);
  console.log(`\nReview the script, then run:`);
  console.log(`  bash ${outputPath}`);
}

main();
