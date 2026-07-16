# Terraform configuration for Google Cloud Run (Volunteer Map Korea)

terraform {
  required_version = ">= 1.0.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  description = "The GCP Project ID"
  type        = string
}

variable "region" {
  description = "The GCP region to deploy to"
  type        = string
  default     = "asia-northeast3"
}

# Cloud Run Service
resource "google_cloud_run_v2_service" "default" {
  name     = "volunteer-map-korea"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello" # Placeholder until first build
      
      env {
        name  = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_key.secret_id
            version = "latest"
          }
        }
      }
      
      env {
        name  = "GOOGLE_MAPS_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.maps_key.secret_id
            version = "latest"
          }
        }
      }
      
      env {
        name  = "DATA_GO_KR_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.datago_key.secret_id
            version = "latest"
          }
        }
      }
    }
    
    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }
  }
}

# Allow unauthenticated access
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  name     = google_cloud_run_v2_service.default.name
  location = google_cloud_run_v2_service.default.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Secrets Definitions (values must be set via GCP console or scripts)
resource "google_secret_manager_secret" "gemini_key" {
  secret_id = "GEMINI_API_KEY"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "maps_key" {
  secret_id = "GOOGLE_MAPS_API_KEY"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "datago_key" {
  secret_id = "DATA_GO_KR_API_KEY"
  replication {
    auto {}
  }
}
