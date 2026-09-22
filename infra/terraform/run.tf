# Los tres servicios de Cloud Run y el job de migración.
# Terraform define la configuración (env, secretos, red, escalado); el pipeline de
# GitHub Actions solo cambia la imagen, por eso se ignora en lifecycle.

locals {
  backend_env = {
    NODE_ENV                = "production"
    LOG_LEVEL               = "info"
    DB_HOST                 = local.cloudsql_socket # socket del conector de Cloud SQL
    DB_PORT                 = "5432"
    DB_USERNAME             = google_sql_user.app.name
    DB_NAME                 = google_sql_database.app.name
    DB_SYNCHRONIZE          = "false"
    DB_POOL_MAX             = tostring(var.db_pool_max)
    DB_POOL_MIN             = "1"
    DB_LOCK_TIMEOUT_MS      = "2000"
    DB_STATEMENT_TIMEOUT_MS = "5000"
    TX_MAX_ATTEMPTS         = "3"
    OUTBOX_POLL_INTERVAL_MS = "500"
    OUTBOX_BATCH_SIZE       = "100"
    SIMULATION_ENABLED      = tostring(var.enable_simulation)
  }
}

resource "google_cloud_run_v2_service" "backend" {
  name                = "smartbancs-backend"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    service_account = google_service_account.run.email

    scaling {
      # min 1: el relay del outbox y la conexión AMQP deben seguir vivos sin tráfico HTTP.
      # Varias instancias son seguras: el relay usa FOR UPDATE SKIP LOCKED.
      min_instance_count = 1
      max_instance_count = var.backend_max_instances
    }

    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.main.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }

    containers {
      image = local.bootstrap_image

      ports {
        container_port = 4000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = false # CPU siempre asignada: el relay corre en segundo plano
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.backend_env
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["smartbancs-db-password"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "RABBITMQ_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["smartbancs-rabbitmq-url"].secret_id
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.run_access, google_project_iam_member.run_roles]
}

resource "google_cloud_run_v2_service" "ai_service" {
  name                = "smartbancs-ai-service"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    service_account = google_service_account.run.email

    scaling {
      # Consumidor de RabbitMQ siempre activo; una instancia basta para el volumen del MVP
      min_instance_count = 1
      max_instance_count = 1
    }

    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.main.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = local.bootstrap_image

      ports {
        container_port = 8000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = false # el consumidor AMQP trabaja fuera de las peticiones HTTP
      }

      env {
        name  = "BACKEND_API_URL"
        value = google_cloud_run_v2_service.backend.uri
      }

      env {
        name  = "GEMINI_MODEL"
        value = var.gemini_model
      }

      env {
        name = "RABBITMQ_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["smartbancs-rabbitmq-url"].secret_id
            version = "latest"
          }
        }
      }

      dynamic "env" {
        for_each = local.gemini_enabled ? ["smartbancs-gemini-api-key"] : []
        content {
          name = "GEMINI_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.run_access]
}

resource "google_cloud_run_v2_service" "frontend" {
  name                = "smartbancs-frontend"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    service_account = google_service_account.run.email

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = local.bootstrap_image

      ports {
        container_port = 80 # nginx
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_project_service.apis]
}

# Job de migración: aplica sql/00-observability.sql, schema.sql y seed.sql si la base está vacía
resource "google_cloud_run_v2_job" "db_migrate" {
  name                = "smartbancs-db-migrate"
  location            = var.region
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    template {
      service_account = google_service_account.run.email
      max_retries     = 1
      timeout         = "300s"

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }

      containers {
        image = local.bootstrap_image

        env {
          name  = "PGHOST"
          value = local.cloudsql_socket
        }

        env {
          name  = "PGUSER"
          value = google_sql_user.app.name
        }

        env {
          name  = "PGDATABASE"
          value = google_sql_database.app.name
        }

        env {
          name = "PGPASSWORD"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["smartbancs-db-password"].secret_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.run_access, google_project_iam_member.run_roles]
}

# Backend y frontend públicos (demo). El ai-service no se expone: solo consume de RabbitMQ.
resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  name     = google_cloud_run_v2_service.backend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  name     = google_cloud_run_v2_service.frontend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
