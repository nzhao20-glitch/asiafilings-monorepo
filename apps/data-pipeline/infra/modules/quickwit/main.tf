# Quickwit Module - Two-Node Cluster (Indexer + Searcher)

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "indexer_instance_types" {
  type    = list(string)
  default = ["t4g.medium", "t4g.large", "m6g.medium", "m7g.medium"]
}

variable "searcher_instance_types" {
  type    = list(string)
  default = ["r7gd.xlarge", "m6gd.xlarge"]
}

variable "key_pair" {
  type    = string
  default = ""
}

variable "quickwit_version" {
  type    = string
  default = "0.8.1"
}

variable "bucket_raw" {
  type = string
}

variable "bucket_processed" {
  type = string
}

variable "sqs_queue_arn" {
  type = string
}

variable "sqs_queue_url" {
  type = string
}

variable "rds_host" {
  type = string
}

variable "rds_password" {
  type      = string
  sensitive = true
}

# -----------------------------------------------------------------------------
# Data Sources
# -----------------------------------------------------------------------------

data "aws_region" "current" {}

data "aws_subnet" "selected" {
  id = var.subnet_id
}

# Single ARM64 AMI lookup — both instances are Graviton
data "aws_ami" "ubuntu_arm64" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# -----------------------------------------------------------------------------
# Security Groups (separate resources + rules to avoid circular deps)
# -----------------------------------------------------------------------------

resource "aws_security_group" "indexer" {
  name        = "${var.name_prefix}-quickwit-indexer"
  description = "Security group for Quickwit indexer node"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-quickwit-indexer"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "searcher" {
  name        = "${var.name_prefix}-quickwit-searcher"
  description = "Security group for Quickwit searcher node"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-quickwit-searcher"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# --- Indexer SG rules ---

resource "aws_security_group_rule" "indexer_rest_public" {
  type              = "ingress"
  from_port         = 7280
  to_port           = 7280
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.indexer.id
  description       = "Quickwit REST API (public)"
}

resource "aws_security_group_rule" "indexer_ssh" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.indexer.id
  description       = "SSH"
}

resource "aws_security_group_rule" "indexer_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.indexer.id
}

# --- Searcher SG rules ---

resource "aws_security_group_rule" "searcher_rest_public" {
  type              = "ingress"
  from_port         = 7280
  to_port           = 7280
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.searcher.id
  description       = "Quickwit REST API (public)"
}

resource "aws_security_group_rule" "searcher_ssh" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.searcher.id
  description       = "SSH"
}

resource "aws_security_group_rule" "searcher_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.searcher.id
}

# --- Cross-SG rules: indexer allows inbound from searcher ---
resource "aws_security_group_rule" "indexer_rest_from_searcher" {
  type                     = "ingress"
  from_port                = 7280
  to_port                  = 7280
  protocol                 = "tcp"
  security_group_id        = aws_security_group.indexer.id
  source_security_group_id = aws_security_group.searcher.id
  description              = "Quickwit REST API from searcher"
}

resource "aws_security_group_rule" "indexer_gossip_from_searcher" {
  type                     = "ingress"
  from_port                = 7280
  to_port                  = 7280
  protocol                 = "udp"
  security_group_id        = aws_security_group.indexer.id
  source_security_group_id = aws_security_group.searcher.id
  description              = "Quickwit gossip from searcher"
}

resource "aws_security_group_rule" "indexer_grpc_from_searcher" {
  type                     = "ingress"
  from_port                = 7281
  to_port                  = 7281
  protocol                 = "tcp"
  security_group_id        = aws_security_group.indexer.id
  source_security_group_id = aws_security_group.searcher.id
  description              = "Quickwit gRPC from searcher"
}

# Cross-SG rules: searcher allows inbound from indexer
resource "aws_security_group_rule" "searcher_gossip_from_indexer" {
  type                     = "ingress"
  from_port                = 7280
  to_port                  = 7280
  protocol                 = "udp"
  security_group_id        = aws_security_group.searcher.id
  source_security_group_id = aws_security_group.indexer.id
  description              = "Quickwit gossip from indexer"
}

resource "aws_security_group_rule" "searcher_grpc_from_indexer" {
  type                     = "ingress"
  from_port                = 7281
  to_port                  = 7281
  protocol                 = "tcp"
  security_group_id        = aws_security_group.searcher.id
  source_security_group_id = aws_security_group.indexer.id
  description              = "Quickwit gRPC from indexer"
}

# -----------------------------------------------------------------------------
# IAM (shared role, two instance profiles)
# -----------------------------------------------------------------------------

resource "aws_iam_role" "quickwit" {
  name = "${var.name_prefix}-quickwit"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "quickwit_s3" {
  name = "${var.name_prefix}-quickwit-s3"
  role = aws_iam_role.quickwit.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = [
          "arn:aws:s3:::${var.bucket_raw}",
          "arn:aws:s3:::${var.bucket_raw}/*",
          "arn:aws:s3:::${var.bucket_processed}",
          "arn:aws:s3:::${var.bucket_processed}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "quickwit_sqs" {
  name = "${var.name_prefix}-quickwit-sqs"
  role = aws_iam_role.quickwit.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = var.sqs_queue_arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "quickwit_ec2" {
  name = "${var.name_prefix}-quickwit-ec2"
  role = aws_iam_role.quickwit.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:AssociateAddress",
          "ec2:DescribeAddresses",
          "ec2:ModifyInstanceMetadataOptions"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "quickwit_ssm" {
  role       = aws_iam_role.quickwit.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "indexer" {
  name = "${var.name_prefix}-quickwit-indexer"
  role = aws_iam_role.quickwit.name
}

resource "aws_iam_instance_profile" "searcher" {
  name = "${var.name_prefix}-quickwit-searcher"
  role = aws_iam_role.quickwit.name
}

# -----------------------------------------------------------------------------
# Indexer Launch Template + ASG
# -----------------------------------------------------------------------------

locals {
  indexer_user_data = <<-EOF
    #!/bin/bash
    set -e

    # ==========================================================================
    # FIRST BOOT ONLY — install packages, pull images, write boot script
    # ==========================================================================

    # Install packages
    apt-get update
    apt-get install -y docker.io awscli jq snapd
    snap install amazon-ssm-agent --classic
    systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent
    systemctl start snap.amazon-ssm-agent.amazon-ssm-agent

    # Enable Docker
    systemctl enable docker
    systemctl start docker

    # Pull Quickwit image with retries (Docker Hub can be flaky)
    for i in 1 2 3 4 5; do
      docker pull quickwit/quickwit:${var.quickwit_version} && break
      echo "docker pull quickwit retry $i..."; sleep 10
    done

    # Write environment file with Terraform-interpolated values
    cat > /etc/quickwit-boot.env <<'ENVEOF'
    REGION='${data.aws_region.current.name}'
    BUCKET='${var.bucket_processed}'
    QW_VERSION='${var.quickwit_version}'
    EIP_ALLOC_ID='${aws_eip.indexer.id}'
    RDS_HOST='${var.rds_host}'
    RDS_PASSWORD='${var.rds_password}'
    ENVEOF
    chmod 600 /etc/quickwit-boot.env

    # Write boot script (single-quoted heredoc — no shell expansion)
    cat > /usr/local/bin/quickwit-boot.sh <<'BOOTEOF'
    #!/bin/bash
    set -e

    # Source Terraform-interpolated values
    source /etc/quickwit-boot.env

    # --- Data directory (root volume) ---
    mkdir -p /data/quickwit/config

    # --- IMDS metadata ---
    TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
    PRIVATE_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/local-ipv4)
    INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)

    # Set IMDS hop limit to 2 so Docker containers can get IAM credentials
    aws ec2 modify-instance-metadata-options \
      --instance-id "$INSTANCE_ID" \
      --http-put-response-hop-limit 2 \
      --region "$REGION"

    # Associate Elastic IP with this instance (handles spot relaunches)
    aws ec2 associate-address \
      --instance-id "$INSTANCE_ID" \
      --allocation-id "$EIP_ALLOC_ID" \
      --region "$REGION"

    # URL-encode the RDS password for the metastore URI
    ENCODED_PW=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.stdin.read().strip(), safe=''))" <<< "$RDS_PASSWORD")

    # --- Write Quickwit config ---
    cat > /data/quickwit/config/quickwit.yaml <<QWCONFIG
    version: 0.8
    cluster_id: filing-search
    node_id: indexer-1
    listen_address: 0.0.0.0
    advertise_address: $PRIVATE_IP
    rest:
      listen_port: 7280
    grpc_listen_port: 7281
    data_dir: /quickwit/data
    metastore_uri: postgres://postgres:$ENCODED_PW@$RDS_HOST:5432/postgres
    default_index_root_uri: s3://$BUCKET/quickwit-indexes
    QWCONFIG

    # --- Quickwit container (always recreate to pick up fresh config) ---
    docker rm -f quickwit 2>/dev/null || true
    docker run -d \
      --name quickwit \
      --restart unless-stopped \
      -p 7280:7280/tcp \
      -p 7280:7280/udp \
      -p 7281:7281 \
      -v /data/quickwit:/quickwit/data \
      -v /data/quickwit/config:/quickwit/config \
      -e QW_CONFIG=/quickwit/config/quickwit.yaml \
      -e AWS_REGION="$REGION" \
      quickwit/quickwit:"$QW_VERSION" \
      run --service indexer --service control_plane --service metastore --service janitor

    # --- Wait for health + create index (idempotent) ---
    echo "Waiting for Quickwit to be ready..."
    for i in $(seq 1 60); do
      curl -sf http://localhost:7280/health/readyz && break
      sleep 5
    done

    cat > /tmp/index-config.json <<'INDEXCFG'
    {
      "version": "0.8",
      "index_id": "filings",
      "doc_mapping": {
        "mode": "dynamic",
        "field_mappings": [
          {"name": "unique_page_id", "type": "text", "tokenizer": "raw", "stored": true, "fast": true},
          {"name": "document_id", "type": "text", "tokenizer": "raw", "stored": true, "fast": true},
          {"name": "exchange", "type": "text", "tokenizer": "raw", "stored": true, "fast": true},
          {"name": "company_id", "type": "text", "tokenizer": "raw", "stored": true, "fast": true},
          {"name": "company_name", "type": "text", "tokenizer": "default", "stored": true},
          {"name": "filing_date", "type": "datetime", "input_formats": ["%Y-%m-%d", "%Y%m%d"], "stored": true, "fast": true},
          {"name": "filing_type", "type": "text", "tokenizer": "raw", "stored": true, "fast": true},
          {"name": "title", "type": "text", "tokenizer": "default", "stored": true},
          {"name": "page_number", "type": "u64", "stored": true, "fast": true},
          {"name": "total_pages", "type": "u64", "stored": true, "fast": true},
          {"name": "text", "type": "text", "tokenizer": "default", "record": "position", "stored": true},
          {"name": "s3_key", "type": "text", "tokenizer": "raw", "stored": true},
          {"name": "file_type", "type": "text", "tokenizer": "raw", "stored": true, "fast": true}
        ]
      },
      "search_settings": {
        "default_search_fields": ["text", "title", "company_name"]
      },
      "indexing_settings": {
        "commit_timeout_secs": 60,
        "merge_policy": {
          "type": "stable_log",
          "min_level_num_docs": 100000,
          "merge_factor": 10,
          "max_merge_factor": 12
        }
      }
    }
    INDEXCFG

    echo "Creating filings index..."
    curl -sf -X POST http://localhost:7280/api/v1/indexes \
      -H 'Content-Type: application/json' \
      --data-binary @/tmp/index-config.json || true
    rm -f /tmp/index-config.json

    echo "Quickwit indexer boot complete"
    BOOTEOF
    chmod +x /usr/local/bin/quickwit-boot.sh

    # Write systemd service
    cat > /etc/systemd/system/quickwit-boot.service <<'SVCEOF'
    [Unit]
    Description=Quickwit Bootstrap
    After=docker.service
    Requires=docker.service

    [Service]
    Type=oneshot
    ExecStart=/usr/local/bin/quickwit-boot.sh
    RemainAfterExit=yes
    StandardOutput=journal
    StandardError=journal

    [Install]
    WantedBy=multi-user.target
    SVCEOF

    # Enable for future boots and run now
    systemctl daemon-reload
    systemctl enable quickwit-boot
    /usr/local/bin/quickwit-boot.sh

    echo "Quickwit indexer first-boot setup complete"
    EOF
}

resource "aws_launch_template" "indexer" {
  name_prefix   = "${var.name_prefix}-quickwit-indexer-"
  image_id      = data.aws_ami.ubuntu_arm64.id
  key_name      = var.key_pair != "" ? var.key_pair : null

  iam_instance_profile {
    name = aws_iam_instance_profile.indexer.name
  }

  vpc_security_group_ids = [aws_security_group.indexer.id]

  user_data = base64encode(local.indexer_user_data)

  metadata_options {
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 2
    http_tokens                 = "optional"
  }

  block_device_mappings {
    device_name = "/dev/sda1"

    ebs {
      volume_size = 20
      volume_type = "gp3"
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${var.name_prefix}-quickwit-indexer"
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_autoscaling_group" "indexer" {
  name                = "${var.name_prefix}-quickwit-indexer"
  min_size            = 1
  max_size            = 1
  desired_capacity    = 1
  vpc_zone_identifier = [var.subnet_id]

  mixed_instances_policy {
    instances_distribution {
      on_demand_base_capacity                  = 0
      on_demand_percentage_above_base_capacity = 0
      spot_allocation_strategy                 = "price-capacity-optimized"
    }

    launch_template {
      launch_template_specification {
        launch_template_id = aws_launch_template.indexer.id
        version            = "$Latest"
      }

      dynamic "override" {
        for_each = var.indexer_instance_types
        content {
          instance_type = override.value
        }
      }
    }
  }

  tag {
    key                 = "Name"
    value               = "${var.name_prefix}-quickwit-indexer"
    propagate_at_launch = true
  }

  lifecycle {
    create_before_destroy = true
  }
}

# -----------------------------------------------------------------------------
# Searcher Launch Template + ASG
# -----------------------------------------------------------------------------

locals {
  searcher_user_data = <<-EOF
    #!/bin/bash
    set -e

    # ==========================================================================
    # FIRST BOOT ONLY — install packages, pull images, write boot script
    # ==========================================================================

    # Install packages
    apt-get update
    apt-get install -y docker.io awscli jq snapd
    snap install amazon-ssm-agent --classic
    systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent
    systemctl start snap.amazon-ssm-agent.amazon-ssm-agent

    # Enable Docker
    systemctl enable docker
    systemctl start docker

    # Pull Quickwit image with retries (Docker Hub can be flaky)
    for i in 1 2 3 4 5; do
      docker pull quickwit/quickwit:${var.quickwit_version} && break
      echo "docker pull quickwit retry $i..."; sleep 10
    done

    # Write environment file with Terraform-interpolated values
    cat > /etc/quickwit-boot.env <<'ENVEOF'
    REGION='${data.aws_region.current.name}'
    BUCKET='${var.bucket_processed}'
    QW_VERSION='${var.quickwit_version}'
    EIP_ALLOC_ID='${aws_eip.searcher.id}'
    RDS_HOST='${var.rds_host}'
    RDS_PASSWORD='${var.rds_password}'
    ENVEOF
    chmod 600 /etc/quickwit-boot.env

    # Write boot script (single-quoted heredoc — no shell expansion)
    cat > /usr/local/bin/quickwit-boot.sh <<'BOOTEOF'
    #!/bin/bash
    set -e

    # Source Terraform-interpolated values
    source /etc/quickwit-boot.env

    # --- Format and mount local NVMe SSD (ephemeral — wiped on stop) ---
    NVME_DEV=""
    for dev in /dev/nvme1n1 /dev/nvme2n1; do
      if [ -e "$dev" ]; then
        NVME_DEV="$dev"
        break
      fi
    done

    mkdir -p /data/quickwit
    if [ -n "$NVME_DEV" ]; then
      if mountpoint -q /data/quickwit; then
        echo "NVMe already mounted at /data/quickwit"
      else
        mkfs.ext4 -F "$NVME_DEV"
        mount "$NVME_DEV" /data/quickwit
      fi
    fi

    # Create config directory
    mkdir -p /data/quickwit/config

    # --- IMDS metadata ---
    TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
    PRIVATE_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/local-ipv4)
    INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)

    # Set IMDS hop limit to 2 so Docker containers can get IAM credentials
    aws ec2 modify-instance-metadata-options \
      --instance-id "$INSTANCE_ID" \
      --http-put-response-hop-limit 2 \
      --region "$REGION"

    # Associate Elastic IP with this instance (handles spot relaunches + stop/start)
    aws ec2 associate-address \
      --instance-id "$INSTANCE_ID" \
      --allocation-id "$EIP_ALLOC_ID" \
      --region "$REGION"

    # URL-encode the RDS password for the metastore URI
    ENCODED_PW=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.stdin.read().strip(), safe=''))" <<< "$RDS_PASSWORD")

    # --- Write Quickwit config (no peer_seeds — searcher is independent) ---
    cat > /data/quickwit/config/quickwit.yaml <<QWCONFIG
    version: 0.8
    cluster_id: filing-search
    node_id: searcher-1
    listen_address: 0.0.0.0
    advertise_address: $PRIVATE_IP
    rest:
      listen_port: 7280
    grpc_listen_port: 7281
    data_dir: /quickwit/data
    metastore_uri: postgres://postgres:$ENCODED_PW@$RDS_HOST:5432/postgres
    default_index_root_uri: s3://$BUCKET/quickwit-indexes
    QWCONFIG

    # --- Quickwit container (always recreate to pick up fresh config) ---
    docker rm -f quickwit 2>/dev/null || true
    docker run -d \
      --name quickwit \
      --restart unless-stopped \
      -p 7280:7280/tcp \
      -p 7280:7280/udp \
      -p 7281:7281 \
      -v /data/quickwit:/quickwit/data \
      -v /data/quickwit/config:/quickwit/config \
      -e QW_CONFIG=/quickwit/config/quickwit.yaml \
      -e AWS_REGION="$REGION" \
      quickwit/quickwit:"$QW_VERSION" \
      run --service searcher --service metastore

    echo "Quickwit searcher boot complete"
    BOOTEOF
    chmod +x /usr/local/bin/quickwit-boot.sh

    # Write systemd service
    cat > /etc/systemd/system/quickwit-boot.service <<'SVCEOF'
    [Unit]
    Description=Quickwit Bootstrap
    After=docker.service
    Requires=docker.service

    [Service]
    Type=oneshot
    ExecStart=/usr/local/bin/quickwit-boot.sh
    RemainAfterExit=yes
    StandardOutput=journal
    StandardError=journal

    [Install]
    WantedBy=multi-user.target
    SVCEOF

    # Enable for future boots and run now
    systemctl daemon-reload
    systemctl enable quickwit-boot
    /usr/local/bin/quickwit-boot.sh

    echo "Quickwit searcher first-boot setup complete"
    EOF
}

resource "aws_launch_template" "searcher" {
  name_prefix   = "${var.name_prefix}-quickwit-searcher-"
  image_id      = data.aws_ami.ubuntu_arm64.id
  key_name      = var.key_pair != "" ? var.key_pair : null

  iam_instance_profile {
    name = aws_iam_instance_profile.searcher.name
  }

  vpc_security_group_ids = [aws_security_group.searcher.id]

  user_data = base64encode(local.searcher_user_data)

  metadata_options {
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 2
    http_tokens                 = "optional"
  }

  block_device_mappings {
    device_name = "/dev/sda1"

    ebs {
      volume_size = 20
      volume_type = "gp3"
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${var.name_prefix}-quickwit-searcher"
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_autoscaling_group" "searcher" {
  name                = "${var.name_prefix}-quickwit-searcher"
  min_size            = 1
  max_size            = 1
  desired_capacity    = 1
  vpc_zone_identifier = [var.subnet_id]

  mixed_instances_policy {
    instances_distribution {
      on_demand_base_capacity                  = 0
      on_demand_percentage_above_base_capacity = 0
      spot_allocation_strategy                 = "price-capacity-optimized"
    }

    launch_template {
      launch_template_specification {
        launch_template_id = aws_launch_template.searcher.id
        version            = "$Latest"
      }

      dynamic "override" {
        for_each = var.searcher_instance_types
        content {
          instance_type = override.value
        }
      }
    }
  }

  tag {
    key                 = "Name"
    value               = "${var.name_prefix}-quickwit-searcher"
    propagate_at_launch = true
  }

  lifecycle {
    create_before_destroy = true
  }
}

# -----------------------------------------------------------------------------
# Elastic IPs
# -----------------------------------------------------------------------------

resource "aws_eip" "indexer" {
  domain = "vpc"

  tags = {
    Name = "${var.name_prefix}-quickwit-indexer"
  }
}

resource "aws_eip" "searcher" {
  domain = "vpc"

  tags = {
    Name = "${var.name_prefix}-quickwit-searcher"
  }
}

# -----------------------------------------------------------------------------
# VPC Endpoints (S3 gateway — free, keeps EC2↔S3 traffic off the internet)
# -----------------------------------------------------------------------------

data "aws_route_tables" "vpc" {
  vpc_id = var.vpc_id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id          = var.vpc_id
  service_name    = "com.amazonaws.${data.aws_region.current.name}.s3"
  route_table_ids = data.aws_route_tables.vpc.ids

  tags = {
    Name = "${var.name_prefix}-s3-endpoint"
  }
}

# -----------------------------------------------------------------------------
# Lambda Ingest (SQS → S3 download → Quickwit ingest API)
# -----------------------------------------------------------------------------

resource "aws_iam_role" "lambda_ingest" {
  name = "${var.name_prefix}-quickwit-ingest-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda_ingest_s3" {
  name = "s3-read"
  role = aws_iam_role.lambda_ingest.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = ["arn:aws:s3:::${var.bucket_processed}/*"]
    }]
  })
}

resource "aws_iam_role_policy" "lambda_ingest_sqs" {
  name = "sqs"
  role = aws_iam_role.lambda_ingest.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ]
      Resource = var.sqs_queue_arn
    }]
  })
}

resource "aws_iam_role_policy" "lambda_ingest_ec2" {
  name = "ec2-describe"
  role = aws_iam_role.lambda_ingest.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ec2:DescribeInstances"]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_ingest_basic" {
  role       = aws_iam_role.lambda_ingest.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "archive_file" "ingest_lambda" {
  type        = "zip"
  source_file = "${path.module}/lambda/ingest.py"
  output_path = "${path.module}/lambda/ingest.zip"
}

resource "aws_lambda_function" "ingest" {
  filename         = data.archive_file.ingest_lambda.output_path
  source_code_hash = data.archive_file.ingest_lambda.output_base64sha256
  function_name    = "${var.name_prefix}-quickwit-ingest"
  role             = aws_iam_role.lambda_ingest.arn
  handler          = "ingest.handler"
  runtime          = "python3.12"
  timeout          = 300
  memory_size      = 512

  environment {
    variables = {
      INDEXER_TAG     = "${var.name_prefix}-quickwit-indexer"
      AWS_REGION_NAME = data.aws_region.current.name
    }
  }

  tags = {
    Name = "${var.name_prefix}-quickwit-ingest"
  }
}

resource "aws_lambda_event_source_mapping" "ingest_sqs" {
  event_source_arn = var.sqs_queue_arn
  function_name    = aws_lambda_function.ingest.arn
  batch_size       = 1
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "indexer_asg_name" {
  value = aws_autoscaling_group.indexer.name
}

output "searcher_asg_name" {
  value = aws_autoscaling_group.searcher.name
}

output "indexer_public_ip" {
  value = aws_eip.indexer.public_ip
}

output "searcher_public_ip" {
  value = aws_eip.searcher.public_ip
}

output "indexer_security_group_id" {
  value = aws_security_group.indexer.id
}

output "searcher_security_group_id" {
  value = aws_security_group.searcher.id
}
