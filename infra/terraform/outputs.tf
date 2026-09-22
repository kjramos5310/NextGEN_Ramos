output "frontend_url" {
  value = google_cloud_run_v2_service.frontend.uri
}

output "backend_url" {
  value = google_cloud_run_v2_service.backend.uri
}

output "ai_service_url" {
  description = "Privado (requiere identidad con run.invoker)."
  value       = google_cloud_run_v2_service.ai_service.uri
}

output "artifact_registry" {
  value = local.registry
}

output "cloudsql_connection_name" {
  value = google_sql_database_instance.main.connection_name
}

output "rabbitmq_internal_ip" {
  value = google_compute_instance.rabbitmq.network_interface[0].network_ip
}

# Valores para configurar como variables del repositorio en GitHub (Settings > Variables)
output "github_variables" {
  value = {
    GCP_PROJECT_ID   = var.project_id
    GCP_REGION       = var.region
    GCP_WIF_PROVIDER = google_iam_workload_identity_pool_provider.github.name
    GCP_DEPLOYER_SA  = google_service_account.deployer.email
  }
}
