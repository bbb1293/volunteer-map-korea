resource "google_project_service" "firestore_api" {
  service            = "firestore.googleapis.com"
  disable_on_destroy = false
}

resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.firestore_api]
}

resource "google_firestore_index" "volunteer_events_geo" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "volunteerEvents"

  fields {
    field_path = "lat"
    order      = "ASCENDING"
  }
  fields {
    field_path = "lng"
    order      = "ASCENDING"
  }
}
