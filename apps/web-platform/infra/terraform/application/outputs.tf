# AsiaFilings Application Layer Outputs

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = module.alb.alb_dns_name
}

output "alb_url" {
  description = "Full URL of the Application Load Balancer"
  value       = "http://${module.alb.alb_dns_name}"
}

output "ecr_repository_url" {
  description = "URL of the ECR repository"
  value       = module.ecr.repository_url
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = module.ecs.cluster_name
}

output "ecs_service_name" {
  description = "Name of the ECS service"
  value       = module.ecs.service_name
}

output "ecs_log_group" {
  description = "CloudWatch log group for ECS tasks"
  value       = module.ecs.log_group_name
}
