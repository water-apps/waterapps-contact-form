variable "aws_region" {
  description = "AWS region — ap-southeast-2 for data sovereignty (Australian clients)"
  type        = string
  default     = "ap-southeast-2"
}

variable "project" {
  description = "Project name used in resource naming"
  type        = string
  default     = "waterapps"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "source_email" {
  description = "SES verified sender email for contact form notifications"
  type        = string
  default     = "varun@waterapps.com.au"

  validation {
    condition     = can(regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", var.source_email))
    error_message = "Must be a valid email address."
  }
}

variable "target_email" {
  description = "Email address that receives contact form submissions"
  type        = string
  default     = "varun@waterapps.com.au"

  validation {
    condition     = can(regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", var.target_email))
    error_message = "Must be a valid email address."
  }
}

variable "allowed_origins" {
  description = "CORS allowed origins — restrict to your domain in production"
  type        = list(string)
  default     = ["https://www.waterapps.com.au", "https://waterapps.com.au"]
}

variable "max_body_bytes" {
  description = "Maximum request body size accepted by Lambda (bytes)"
  type        = number
  default     = 16384
}

variable "api_throttling_burst_limit" {
  description = "API Gateway stage burst limit to reduce abuse/spam"
  type        = number
  default     = 20

  validation {
    condition     = var.api_throttling_burst_limit >= 1 && var.api_throttling_burst_limit <= 10000
    error_message = "api_throttling_burst_limit must be between 1 and 10000."
  }
}

variable "api_throttling_rate_limit" {
  description = "API Gateway stage steady-state requests/sec limit to reduce abuse/spam"
  type        = number
  default     = 5

  validation {
    condition     = var.api_throttling_rate_limit > 0 && var.api_throttling_rate_limit <= 10000
    error_message = "api_throttling_rate_limit must be greater than 0 and at most 10000."
  }
}

variable "log_level" {
  description = "Lambda log verbosity"
  type        = string
  default     = "info"

  validation {
    condition     = contains(["debug", "info", "warn", "error"], var.log_level)
    error_message = "log_level must be one of: debug, info, warn, error."
  }
}

variable "reviews_table_name" {
  description = "Optional explicit DynamoDB table name for independent review submissions"
  type        = string
  default     = ""
}

variable "review_retention_days" {
  description = "Retention period for review records (TTL) in days"
  type        = number
  default     = 365

  validation {
    condition     = var.review_retention_days >= 30 && var.review_retention_days <= 3650
    error_message = "review_retention_days must be between 30 and 3650 days."
  }
}

variable "reviews_point_in_time_recovery_enabled" {
  description = "Enable point-in-time recovery (PITR) for the independent reviews table"
  type        = bool
  default     = false
}

variable "enable_review_admin_jwt_auth" {
  description = "Require JWT auth on admin review routes (GET /reviews and POST /reviews/{reviewId}/moderate)"
  type        = bool
  default     = true
}

variable "review_admin_jwt_issuer" {
  description = "JWT issuer URL for review admin API authorization (for Cognito use the user pool issuer URL)"
  type        = string
  default     = null

  validation {
    condition     = !var.enable_review_admin_jwt_auth || (var.review_admin_jwt_issuer != null && startswith(var.review_admin_jwt_issuer, "https://"))
    error_message = "review_admin_jwt_issuer must be set to an https URL when enable_review_admin_jwt_auth is true."
  }
}

variable "review_admin_jwt_audience" {
  description = "JWT audience for review admin API authorization (for Cognito use the app client ID)"
  type        = list(string)
  default     = []

  validation {
    condition     = !var.enable_review_admin_jwt_auth || length(var.review_admin_jwt_audience) > 0
    error_message = "review_admin_jwt_audience must include at least one value when enable_review_admin_jwt_auth is true."
  }
}

variable "common_tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default = {
    Project     = "WaterApps"
    Component   = "ContactForm"
    Environment = "prod"
    ManagedBy   = "terraform"
    Owner       = "waterapps"
    CostCenter  = "Marketing"
  }
}
