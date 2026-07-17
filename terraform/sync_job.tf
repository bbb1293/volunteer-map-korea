resource "google_service_account" "sync_job" {
  account_id   = "volunteer-sync-job"
  display_name = "Volunteer Map sync job"
}

resource "google_project_iam_member" "sync_job_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.sync_job.email}"
}

resource "google_cloud_run_v2_job" "sync_volunteers" {
  name     = "volunteer-sync-job"
  location = var.region

  template {
    template {
      service_account = google_service_account.sync_job.email
      timeout         = "3600s"

      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/volunteer-map-repo/volunteer-sync-job:latest"

        env {
          name  = "DATA_GO_KR_API_KEY"
          value = var.data_go_kr_api_key
        }
        env {
          name  = "GOOGLE_MAPS_API_KEY"
          value = var.google_maps_api_key
        }
      }
    }
  }

  depends_on = [google_firestore_database.default]
}
