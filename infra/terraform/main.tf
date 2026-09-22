locals {
  apis = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "compute.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ]

  labels = { app = "smartbancs", managed-by = "terraform" }

  # Imagen de arranque: Terraform crea los servicios con esta imagen y el pipeline
  # de GitHub Actions despliega después las imágenes reales (ver lifecycle.ignore_changes).
  bootstrap_image = "us-docker.pkg.dev/cloudrun/container/hello"

  registry        = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
  cloudsql_socket = "/cloudsql/${google_sql_database_instance.main.connection_name}"
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "smartbancs"
  format        = "DOCKER"
  description   = "Imágenes de backend, ai-service, frontend y job de migración"
  labels        = local.labels

  depends_on = [google_project_service.apis]
}

# Red privada: Cloud Run llega a RabbitMQ por Direct VPC egress (IP interna).
resource "google_compute_network" "vpc" {
  name                    = "smartbancs-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.apis]
}

resource "google_compute_subnetwork" "main" {
  name                     = "smartbancs-subnet"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = "10.10.0.0/24"
  private_ip_google_access = true
}
