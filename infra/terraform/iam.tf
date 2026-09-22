# Identidad con la que corren los servicios de Cloud Run (mínimo privilegio)
resource "google_service_account" "run" {
  account_id   = "smartbancs-run"
  display_name = "SmartBancs Cloud Run runtime"

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "run_roles" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.run.email}"
}

# Identidad que usa GitHub Actions para publicar imágenes y desplegar
resource "google_service_account" "deployer" {
  account_id   = "smartbancs-github-deployer"
  display_name = "SmartBancs GitHub Actions deployer"

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "deployer_roles" {
  for_each = toset([
    "roles/run.admin",
    "roles/artifactregistry.writer",
    "roles/compute.networkViewer", # desplegar revisiones con Direct VPC egress
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# Permite al deployer desplegar revisiones que corren como la cuenta de runtime
resource "google_service_account_iam_member" "deployer_act_as_run" {
  service_account_id = google_service_account.run.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

# Workload Identity Federation: GitHub Actions se autentica con OIDC, sin llaves JSON
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Solo este repositorio puede obtener credenciales
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
