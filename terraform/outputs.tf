output "service_url" {
  description = "The deployed Cloud Run service URL"
  value       = google_cloud_run_v2_service.default.uri
}

output "artifact_registry_url" {
  description = "The Artifact Registry URL to push the Docker image to"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.name}"
}
