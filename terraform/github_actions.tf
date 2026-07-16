# Workload Identity Federation so GitHub Actions can deploy without a
# long-lived service account key.

resource "google_project_service" "iamcredentials_api" {
  service            = "iamcredentials.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "sts_api" {
  service            = "sts.googleapis.com"
  disable_on_destroy = false
}

data "google_project" "current" {}

resource "google_service_account" "github_actions_deployer" {
  account_id   = "github-actions-deployer"
  display_name = "GitHub Actions Deployer"
  description  = "Used by GitHub Actions to build/push images and deploy to Cloud Run"
}

resource "google_iam_workload_identity_pool" "github_pool" {
  workload_identity_pool_id = "github-actions-pool"
  display_name              = "GitHub Actions Pool"
  description               = "Identity pool for GitHub Actions OIDC"
}

resource "google_iam_workload_identity_pool_provider" "github_provider" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github_pool.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC Provider"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Restrict to this repo only.
  attribute_condition = "assertion.repository == 'bbb1293/volunteer-map-korea'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  depends_on = [google_project_service.iamcredentials_api, google_project_service.sts_api]
}

# Let GitHub Actions runs from this repo (any branch/ref) impersonate the deployer SA.
resource "google_service_account_iam_member" "github_actions_wif_binding" {
  service_account_id = google_service_account.github_actions_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github_pool.name}/attribute.repository/bbb1293/volunteer-map-korea"
}

# Permissions the deployer SA needs to build/push/deploy.
resource "google_project_iam_member" "deployer_artifact_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_actions_deployer.email}"
}

resource "google_project_iam_member" "deployer_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.github_actions_deployer.email}"
}

# Cloud Run's default runtime SA is the Compute Engine default SA (no
# service_account block is set on google_cloud_run_v2_service.default), so the
# deployer needs to act-as it to deploy new revisions.
resource "google_service_account_iam_member" "deployer_act_as_runtime_sa" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${data.google_project.current.number}-compute@developer.gserviceaccount.com"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_actions_deployer.email}"
}
