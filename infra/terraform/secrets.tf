locals {
  # Solo se expone si hay key o no (booleano), nunca el valor
  gemini_enabled = nonsensitive(var.gemini_api_key != "")

  secrets = merge(
    {
      "smartbancs-db-password"  = random_password.db.result
      "smartbancs-rabbitmq-url" = "amqp://smartbancs:${random_password.rabbitmq.result}@${google_compute_instance.rabbitmq.network_interface[0].network_ip}:5672"
    },
    local.gemini_enabled ? { "smartbancs-gemini-api-key" = var.gemini_api_key } : {}
  )
}

resource "google_secret_manager_secret" "app" {
  for_each  = nonsensitive(toset(keys(local.secrets)))
  secret_id = each.value
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "app" {
  for_each    = google_secret_manager_secret.app
  secret      = each.value.id
  secret_data = local.secrets[each.key]
}

resource "google_secret_manager_secret_iam_member" "run_access" {
  for_each  = google_secret_manager_secret.app
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}
