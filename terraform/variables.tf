variable "project_id" {
  description = "The GCP Project ID"
  type        = string
}

variable "region" {
  description = "The GCP Region for resources"
  type        = string
  default     = "asia-northeast3" # Seoul
}

variable "map_id" {
  description = "Google Maps Map ID (Advanced Markers)"
  type        = string
  default     = "DEMO_MAP_ID"
}

variable "google_maps_api_key" {
  description = "Google Maps API Key"
  type        = string
  sensitive   = true
}

variable "gemini_api_key" {
  description = "Google Gemini API Key"
  type        = string
  sensitive   = true
}

variable "data_go_kr_api_key" {
  description = "South Korea Public Data Portal API Key (Optional)"
  type        = string
  sensitive   = true
  default     = ""
}

