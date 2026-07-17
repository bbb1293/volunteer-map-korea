terraform {
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

# Enable required APIs
resource "google_project_service" "run_api" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "cloudbuild_api" {
  service            = "cloudbuild.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry_api" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

# Create an Artifact Registry repository for Docker images
resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = "volunteer-map-repo"
  description   = "Docker repository for Volunteer Map Next.js app"
  format        = "DOCKER"
  depends_on    = [google_project_service.artifactregistry_api]
}

# Note: In a real deployment, you'd build and push the Docker image here
# using Cloud Build or a local provisioner. For this example, we assume
# the image is built and pushed to the registry.

# Cloud Run Service
resource "google_cloud_run_v2_service" "default" {
  name     = "volunteer-map-service"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.name}/volunteer-map-web:latest"
      
      env {
        name  = "NEXT_PUBLIC_MAP_ID"
        value = var.map_id
      }

      env {
        name  = "GEMINI_API_KEY"
        value = var.gemini_api_key
      }

      env {
        name  = "NEXT_PUBLIC_KAKAO_MAP_APP_KEY"
        value = var.kakao_map_app_key
      }

      ports {
        container_port = 3000
      }
    }
  }

  depends_on = [google_project_service.run_api]
}

# Make the Cloud Run service publicly accessible
resource "google_cloud_run_service_iam_member" "public_access" {
  location = google_cloud_run_v2_service.default.location
  project  = google_cloud_run_v2_service.default.project
  service  = google_cloud_run_v2_service.default.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_project_iam_member" "web_firestore_reader" {
  project = var.project_id
  role    = "roles/datastore.viewer"
  member  = "serviceAccount:${data.google_compute_default_service_account.default.email}"
}

data "google_compute_default_service_account" "default" {
  project = var.project_id
}
