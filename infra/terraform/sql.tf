resource "random_password" "db" {
  length  = 24
  special = false
}

resource "google_sql_database_instance" "main" {
  name                = "smartbancs-pg"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.deletion_protection

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL" # producción: REGIONAL (alta disponibilidad)
    disk_size         = 10
    user_labels       = local.labels

    ip_configuration {
      # IP pública sin redes autorizadas: solo se entra por el conector de Cloud SQL (IAM + TLS)
      ipv4_enabled = true
    }

    backup_configuration {
      enabled = true
    }

    # Diagnóstico del incidente de quincena (equivalente a la config del docker-compose)
    database_flags {
      name  = "log_lock_waits"
      value = "on"
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "500"
    }

    # Query Insights: consultas más costosas y esperas de lock desde la consola
    insights_config {
      query_insights_enabled  = true
      record_application_tags = true
      record_client_address   = false
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "app" {
  name     = "smartbancs_db"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = "smartbancs"
  instance = google_sql_database_instance.main.name
  password = random_password.db.result
}
