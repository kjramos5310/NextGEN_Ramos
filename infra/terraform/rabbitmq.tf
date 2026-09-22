# RabbitMQ en una VM: Cloud Run solo acepta tráfico HTTP entrante, así que el broker
# AMQP no puede correr ahí. En producción: un RabbitMQ administrado o un clúster.

resource "random_password" "rabbitmq" {
  length  = 24
  special = false # va dentro de una URL amqp://
}

resource "google_service_account" "rabbitmq_vm" {
  account_id   = "smartbancs-rabbitmq"
  display_name = "SmartBancs RabbitMQ VM"

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "rabbitmq_vm_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.rabbitmq_vm.email}"
}

resource "google_compute_instance" "rabbitmq" {
  name         = "smartbancs-rabbitmq"
  machine_type = "e2-small"
  zone         = var.zone
  tags         = ["rabbitmq"]
  labels       = local.labels

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 20
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.main.id
    # IP pública efímera solo para descargar la imagen; el firewall no abre puertos a Internet
    access_config {}
  }

  service_account {
    email  = google_service_account.rabbitmq_vm.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    startup-script = <<-EOT
      #!/bin/bash
      set -e
      if ! command -v docker >/dev/null; then
        apt-get update && apt-get install -y docker.io
      fi
      docker rm -f rabbitmq 2>/dev/null || true
      docker run -d --name rabbitmq --restart always \
        -p 5672:5672 -p 15672:15672 \
        -e RABBITMQ_DEFAULT_USER=smartbancs \
        -e RABBITMQ_DEFAULT_PASS='${random_password.rabbitmq.result}' \
        -v rabbitmq-data:/var/lib/rabbitmq \
        rabbitmq:3.13-management-alpine
    EOT
  }

  depends_on = [google_project_service.apis]
}

# AMQP solo desde la subred (Cloud Run usa IPs de esta subred con Direct VPC egress)
resource "google_compute_firewall" "amqp_internal" {
  name          = "smartbancs-allow-amqp-internal"
  network       = google_compute_network.vpc.id
  direction     = "INGRESS"
  source_ranges = [google_compute_subnetwork.main.ip_cidr_range]
  target_tags   = ["rabbitmq"]

  allow {
    protocol = "tcp"
    ports    = ["5672"]
  }
}

# SSH y consola de administración solo por túnel de IAP (gcloud compute start-iap-tunnel)
resource "google_compute_firewall" "iap_admin" {
  name          = "smartbancs-allow-iap-admin"
  network       = google_compute_network.vpc.id
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["rabbitmq"]

  allow {
    protocol = "tcp"
    ports    = ["22", "15672"]
  }
}
