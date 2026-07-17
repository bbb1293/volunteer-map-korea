resource "google_project_service" "scheduler_api" {
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "scheduler_invoker" {
  account_id   = "sync-job-scheduler"
  display_name = "Invokes the volunteer sync Cloud Run Job"
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_can_run" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.sync_volunteers.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler_invoker.email}"
}

resource "google_cloud_scheduler_job" "sync_daily" {
  name      = "volunteer-sync-daily"
  region    = var.region
  schedule  = "0 3 * * *"
  time_zone = "Asia/Seoul"

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.sync_volunteers.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler_invoker.email
    }
  }

  depends_on = [google_project_service.scheduler_api, google_cloud_run_v2_job_iam_member.scheduler_can_run]
}
