output "service_url" {
  description = "The deployed Cloud Run service URL"
  value       = google_cloud_run_v2_service.default.uri
}

output "artifact_registry_url" {
  description = "The Artifact Registry URL to push the Docker image to"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.name}"
}

output "github_actions_workload_identity_provider" {
  description = "Full resource name to set as the GCP_WORKLOAD_IDENTITY_PROVIDER GitHub secret"
  value       = google_iam_workload_identity_pool_provider.github_provider.name
}

output "github_actions_service_account" {
  description = "Service account email to set as the GCP_SERVICE_ACCOUNT GitHub secret"
  value       = google_service_account.github_actions_deployer.email
}
