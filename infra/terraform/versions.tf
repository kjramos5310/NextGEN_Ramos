terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.20"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Estado local para el MVP. En un equipo iría en un bucket GCS:
  # backend "gcs" { bucket = "<bucket>" prefix = "smartbancs" }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
