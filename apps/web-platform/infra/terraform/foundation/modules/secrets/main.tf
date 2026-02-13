# AWS Secrets Manager Module
# Creates secrets for application configuration
# Values should be set manually after creation via AWS Console or CLI

# Database URL secret
resource "aws_secretsmanager_secret" "database_url" {
  name        = "${var.project_name}/${var.environment}/database-url"
  description = "PostgreSQL connection string for AsiaFilings"

  tags = {
    Name        = "${var.project_name}-database-url"
    Environment = var.environment
  }
}

# JWT Secret
resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "${var.project_name}/${var.environment}/jwt-secret"
  description = "JWT signing secret for authentication"

  tags = {
    Name        = "${var.project_name}-jwt-secret"
    Environment = var.environment
  }
}

# JWT Refresh Secret
resource "aws_secretsmanager_secret" "jwt_refresh_secret" {
  name        = "${var.project_name}/${var.environment}/jwt-refresh-secret"
  description = "JWT refresh token signing secret"

  tags = {
    Name        = "${var.project_name}-jwt-refresh-secret"
    Environment = var.environment
  }
}

# Cookie Secret
resource "aws_secretsmanager_secret" "cookie_secret" {
  name        = "${var.project_name}/${var.environment}/cookie-secret"
  description = "Secret for signing cookies"

  tags = {
    Name        = "${var.project_name}-cookie-secret"
    Environment = var.environment
  }
}

# Placeholder initial values (should be updated via AWS Console or CLI)
resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "REPLACE_WITH_ACTUAL_DATABASE_URL"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = "REPLACE_WITH_ACTUAL_JWT_SECRET"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret_version" "jwt_refresh_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_refresh_secret.id
  secret_string = "REPLACE_WITH_ACTUAL_JWT_REFRESH_SECRET"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret_version" "cookie_secret" {
  secret_id     = aws_secretsmanager_secret.cookie_secret.id
  secret_string = "REPLACE_WITH_ACTUAL_COOKIE_SECRET"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Outputs
output "secret_arns" {
  description = "Map of secret names to their ARNs"
  value = {
    database_url       = aws_secretsmanager_secret.database_url.arn
    jwt_secret         = aws_secretsmanager_secret.jwt_secret.arn
    jwt_refresh_secret = aws_secretsmanager_secret.jwt_refresh_secret.arn
    cookie_secret      = aws_secretsmanager_secret.cookie_secret.arn
  }
}

output "database_url_arn" {
  description = "ARN of database URL secret"
  value       = aws_secretsmanager_secret.database_url.arn
}

output "jwt_secret_arn" {
  description = "ARN of JWT secret"
  value       = aws_secretsmanager_secret.jwt_secret.arn
}

output "jwt_refresh_secret_arn" {
  description = "ARN of JWT refresh secret"
  value       = aws_secretsmanager_secret.jwt_refresh_secret.arn
}

output "cookie_secret_arn" {
  description = "ARN of cookie secret"
  value       = aws_secretsmanager_secret.cookie_secret.arn
}
