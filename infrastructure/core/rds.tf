# =============================================================================
# RDS PostgreSQL — Import existing instance into core state
# =============================================================================
# --- RDS Security Group ---

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = aws_vpc.main.id

  # Allow PostgreSQL from within VPC
  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
    description = "PostgreSQL from VPC"
  }

  # Allow PostgreSQL from anywhere (for public access during migration)
  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "PostgreSQL public access"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-rds"
  }
}

# --- DB Subnet Group ---

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet"
  subnet_ids = aws_subnet.public[*].id

  tags = {
    Name = "${local.name_prefix}-db-subnet"
  }
}

# --- RDS Instance ---

resource "aws_db_instance" "main" {
  identifier     = var.rds_instance_identifier
  engine         = "postgres"
  engine_version = var.rds_engine_version
  instance_class = var.rds_instance_class

  allocated_storage = var.rds_allocated_storage
  storage_type      = "gp2"

  username = var.rds_username
  password = var.rds_password

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
  publicly_accessible    = true
  apply_immediately      = false

  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.rds_instance_identifier}-final"

  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      password,
      engine_version,
      allocated_storage,
      storage_type,
    ]
  }
}
