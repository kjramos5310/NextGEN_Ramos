variable "project_id" {
  description = "ID del proyecto de GCP (con facturación habilitada)."
  type        = string
}

variable "region" {
  description = "Región de Cloud Run, Cloud SQL y Artifact Registry."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "Zona de la VM de RabbitMQ."
  type        = string
  default     = "us-central1-a"
}

variable "github_repository" {
  description = "Repositorio owner/nombre autorizado a desplegar con Workload Identity Federation."
  type        = string
  default     = "kjramos5310/NextGEN_Ramos"
}

variable "gemini_api_key" {
  description = "API key de Gemini. Vacía = el ai-service usa solo el motor de reglas."
  type        = string
  default     = ""
  sensitive   = true
}

variable "gemini_model" {
  description = "Modelo de Gemini."
  type        = string
  default     = "gemini-3.6-flash"
}

variable "db_tier" {
  description = "Tier de Cloud SQL. db-f1-micro admite ~25 conexiones: el pool del backend se dimensiona en consecuencia."
  type        = string
  default     = "db-f1-micro"
}

variable "backend_max_instances" {
  description = "Máximo de instancias del backend. max_instances * db_pool_max debe quedar bajo max_connections de Cloud SQL."
  type        = number
  default     = 2
}

variable "db_pool_max" {
  description = "Conexiones máximas del pool de pg por instancia del backend."
  type        = number
  default     = 8
}

variable "enable_simulation" {
  description = "Expone /api/v1/simulation (mueve dinero sin autenticación). Activar solo durante una demo."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Protección contra borrado de Cloud SQL y Cloud Run. false permite terraform destroy en la demo."
  type        = bool
  default     = false
}
