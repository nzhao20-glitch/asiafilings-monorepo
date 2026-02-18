# =============================================================================
# EC2 Instance + Elastic IP
# =============================================================================

resource "aws_instance" "web" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  key_name               = var.key_name
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  ebs_optimized          = false

  root_block_device {
    volume_size           = 20
    volume_type           = "gp3"
    iops                  = 3000
    throughput            = 125
    encrypted             = false
    delete_on_termination = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
    instance_metadata_tags      = "disabled"
  }

  tags = {
    Name = "asiafilings-prod-hk"
  }

  lifecycle {
    ignore_changes = [ami]
    prevent_destroy = true
  }
}

# -----------------------------------------------------------------------------
# Elastic IP — static public IP for the EC2 instance
# -----------------------------------------------------------------------------

resource "aws_eip" "web" {
  domain = "vpc"
}

resource "aws_eip_association" "web" {
  instance_id   = aws_instance.web.id
  allocation_id = aws_eip.web.id
}
