#!/usr/bin/env node

/**
 * migrate-local-to-ssm.js
 *
 * Reads .env files, SSH keys, and terraform.tfvars, then:
 *   1. Generates upload-secrets.sh — ONLY for truly sensitive values (SSM SecureString)
 *   2. Generates .env.{env}.defaults files — committed, non-secret config
 *
 * Only values matching SENSITIVE_KEYS patterns go to SSM.
 * Everything else is written to a .defaults file that can be safely committed.
 *
 * SSM naming convention:
 *   /platform/{app}/{env}/{KEY}    (secrets)
 *   /platform/keys/{key-name}       (SSH keys)
 *
 * Usage:
 *   node tools/scripts/migrate-local-to-ssm.js
 *
 * Output:
 *   tools/scripts/upload-secrets.sh       (gitignored — contains secret values)
 *   apps/{app}/.env.{env}.defaults        (committed — non-secret config)
 */

const fs = require('fs');
const path = require('path');

// ── Configuration ──────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_ROOT = path.resolve(REPO_ROOT, '..');

const APP_DIRS = [
  { dir: 'apps/web-platform', ssmName: 'web' },
  { dir: 'apps/serverless-functions', ssmName: 'lambda' },
  { dir: 'apps/data-pipeline', ssmName: 'etl' },
];

const ENV_FILES = ['.env.development', '.env.production', '.env.local', '.env'];

const ENV_MAP = {
  '.env.development': 'dev',
  '.env.production': 'prod',
  '.env.local': 'dev',
  '.env': 'dev',
};

// SSH keys to migrate
const SSH_KEYS = [
  {
    path: path.join(SOURCE_ROOT, 'AsiaFilings/infrastructure/ec2/asiafilings-hk-key.pem'),
    ssmName: 'asiafilings-hk-ec2',
    description: 'EC2 SSH key for Hong Kong (18.167.27.8)',
  },
];

// Terraform .tfvars files — only sensitive keys get pushed
const TFVARS_FILES = [
  {
    path: path.join(SOURCE_ROOT, 'filing-etl-pipeline/infrastructure/terraform.tfvars'),
    ssmName: 'etl',
    env: 'prod',
    description: 'ETL pipeline Terraform variables',
  },
];

// ── Sensitive Key Detection ────────────────────────────────────────────────
// A key is sensitive if it matches any of these patterns (case-insensitive).
// NEXT_PUBLIC_* keys are NEVER sensitive (they're embedded in client-side JS).

const SENSITIVE_PATTERNS = [
  'PASSWORD',
  'SECRET',
  'API_KEY',
  'ACCESS_KEY',
  'LICENSE_KEY',
  'APP_KEY',
  '_DSN',
  'CREDENTIAL',
];

// Exact key names that are sensitive despite not matching patterns above
const SENSITIVE_EXACT = new Set([
  'DATABASE_URL',         // Contains embedded password in connection string
  'OPENAI_ORGANIZATION',  // Org-level identifier, treat as secret
]);

// Keys that match a pattern but are NOT actually sensitive
const SENSITIVE_EXCEPTIONS = new Set([
  'PASSWORD_MIN_LENGTH',      // Config, not a password
  'CORS_CREDENTIALS',         // Boolean flag, not a credential
  'COOKIE_HTTPONLY',           // Boolean flag
  'COOKIE_SECURE',            // Boolean flag
]);

function isSensitive(key) {
  if (key.startsWith('NEXT_PUBLIC_')) return false;
  if (SENSITIVE_EXCEPTIONS.has(key)) return false;
  if (SENSITIVE_EXACT.has(key)) return true;

  const upper = key.toUpperCase();
  return SENSITIVE_PATTERNS.some((pattern) => upper.includes(pattern));
}

// ── Parsers ────────────────────────────────────────────────────────────────

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const entries = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.substring(0, eqIdx).trim();
    let value = line.substring(eqIdx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!key) continue;
    entries.push({ key, value });
  }

  return entries;
}

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

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!key) continue;
    entries.push({ key, value });
  }

  return entries;
}

function shellEscape(val) {
  return val.replace(/'/g, "'\\''");
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const commands = [];
  let totalSecrets = 0;
  let totalDefaults = 0;
  const summary = [];

  // ── Process .env files ─────────────────────────────────────────────────

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

      const secrets = entries.filter((e) => isSensitive(e.key));
      const defaults = entries.filter((e) => !isSensitive(e.key));

      // Generate SSM commands for secrets only
      if (secrets.length > 0) {
        summary.push(
          `#   ${app.dir}/${envFile} -> /platform/${app.ssmName}/${env}/ (${secrets.length} secrets)`
        );

        commands.push('');
        commands.push(
          `# ── ${app.dir}/${envFile} -> /platform/${app.ssmName}/${env}/ (${secrets.length} secrets) ──`
        );
        commands.push('');

        for (const { key, value } of secrets) {
          const ssmPath = `/platform/${app.ssmName}/${env}/${key}`;
          commands.push(
            `aws ssm put-parameter \\`,
            `  --name '${ssmPath}' \\`,
            `  --value '${shellEscape(value)}' \\`,
            `  --type SecureString \\`,
            `  --overwrite \\`,
            `  --region "\${AWS_REGION:-ap-east-1}" \\`,
            `  && echo "  [OK] ${ssmPath}" \\`,
            `  || echo "  [FAIL] ${ssmPath}"`,
            ''
          );
          totalSecrets++;
        }
      }

      // Write .defaults file for non-secret config
      if (defaults.length > 0) {
        const defaultsSuffix = envFile === '.env' ? '.env.defaults' : `${envFile}.defaults`;
        const defaultsPath = path.join(appPath, defaultsSuffix);

        const defaultsContent = [
          `# ${defaultsSuffix}`,
          `# Non-secret configuration — safe to commit to git.`,
          `# Secrets are stored in AWS SSM at /platform/${app.ssmName}/${env}/`,
          `# Run: ./tools/scripts/pull-secrets.sh --app ${app.ssmName} --env ${env}`,
          `# Generated: ${new Date().toISOString()}`,
          '',
          ...defaults.map(({ key, value }) => `${key}=${value}`),
          '',
        ].join('\n');

        fs.writeFileSync(defaultsPath, defaultsContent);
        console.log(`[DEFAULTS] ${app.dir}/${defaultsSuffix} (${defaults.length} config values)`);
        totalDefaults += defaults.length;
      }
    }
  }

  // ── SSH Keys ───────────────────────────────────────────────────────────

  const sshKeysFound = SSH_KEYS.filter((k) => fs.existsSync(k.path));

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
      totalSecrets++;
    }
  }

  // ── Terraform .tfvars (sensitive keys only) ────────────────────────────

  for (const tfDef of TFVARS_FILES) {
    if (!fs.existsSync(tfDef.path)) {
      console.log(`[SKIP] Terraform vars not found: ${tfDef.path}`);
      continue;
    }

    const entries = parseTfvarsFile(tfDef.path);
    const secrets = entries.filter((e) => isSensitive(e.key));

    if (secrets.length === 0) continue;

    summary.push(
      `#   terraform.tfvars -> /platform/${tfDef.ssmName}/${tfDef.env}/ (${secrets.length} secrets)`
    );

    commands.push('');
    commands.push(
      `# ── Terraform: terraform.tfvars -> /platform/${tfDef.ssmName}/${tfDef.env}/ (${secrets.length} secrets) ──`
    );
    commands.push('');

    for (const { key, value } of secrets) {
      const ssmPath = `/platform/${tfDef.ssmName}/${tfDef.env}/${key}`;
      commands.push(
        `aws ssm put-parameter \\`,
        `  --name '${ssmPath}' \\`,
        `  --value '${shellEscape(value)}' \\`,
        `  --type SecureString \\`,
        `  --overwrite \\`,
        `  --region "\${AWS_REGION:-ap-east-1}" \\`,
        `  && echo "  [OK] ${ssmPath}" \\`,
        `  || echo "  [FAIL] ${ssmPath}"`,
        ''
      );
      totalSecrets++;
    }
  }

  if (totalSecrets === 0) {
    console.log('No secrets found. Nothing to generate.');
    process.exit(0);
  }

  // ── Generate upload-secrets.sh ─────────────────────────────────────────

  const outputPath = path.join(__dirname, 'upload-secrets.sh');

  const header = [
    '#!/usr/bin/env bash',
    '',
    '# ============================================================================',
    '# upload-secrets.sh',
    '# Generated by migrate-local-to-ssm.js',
    `# Generated at: ${new Date().toISOString()}`,
    '#',
    '# This script uploads ONLY sensitive values to AWS SSM Parameter Store.',
    '# Non-secret config is stored in committed .env.*.defaults files.',
    '#',
    '# IMPORTANT: Review this script carefully before running!',
    '#   - Ensure your AWS CLI is configured with appropriate credentials',
    '#   - Ensure you are targeting the correct AWS account and region',
    '#   - All parameters use SecureString (KMS encrypted)',
    '#',
    '# Secrets processed:',
    ...summary,
    `# Total secrets: ${totalSecrets}`,
    '# ============================================================================',
    '',
    'set -euo pipefail',
    '',
    'echo "============================================"',
    `echo "Uploading ${totalSecrets} secrets to SSM..."`,
    'echo "Region: ${AWS_REGION:-ap-east-1}"',
    'echo "============================================"',
    'echo ""',
  ];

  const footer = [
    '',
    'echo ""',
    'echo "============================================"',
    `echo "Upload complete. ${totalSecrets} secrets pushed."`,
    `echo "Non-secret config is in .env.*.defaults files (${totalDefaults} values, committed to git)."`,
    'echo "============================================"',
  ];

  const fullScript = [...header, ...commands, ...footer].join('\n') + '\n';
  fs.writeFileSync(outputPath, fullScript, { mode: 0o755 });

  console.log(`\n[SUCCESS] Generated: ${outputPath}`);
  console.log(`  Secrets for SSM: ${totalSecrets}`);
  console.log(`  Config in .defaults files: ${totalDefaults}`);
  console.log(`\nReview the script, then run:`);
  console.log(`  bash ${outputPath}`);
}

main();
