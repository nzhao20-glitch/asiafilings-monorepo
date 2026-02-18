# =============================================================================
# Outputs
# =============================================================================

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.web.id
}

output "public_ip" {
  description = "Elastic IP address"
  value       = aws_eip.web.public_ip
}

output "security_group_id" {
  description = "EC2 security group ID"
  value       = aws_security_group.ec2.id
}

output "vpc_id" {
  description = "VPC ID (default VPC)"
  value       = data.aws_vpc.default.id
}

output "subnet_id" {
  description = "Subnet ID"
  value       = data.aws_subnet.ec2.id
}
