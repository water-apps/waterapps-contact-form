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

variable "booking_type" {
  description = "Logical booking type label used in notifications"
  type        = string
  default     = "DISCOVERY_30M"
}

variable "booking_slot_duration_minutes" {
  description = "Booking slot duration in minutes"
  type        = number
  default     = 30

  validation {
    condition     = var.booking_slot_duration_minutes >= 15 && var.booking_slot_duration_minutes <= 120
    error_message = "booking_slot_duration_minutes must be between 15 and 120."
  }
}

variable "booking_lookahead_days" {
  description = "How many days ahead availability is exposed"
  type        = number
  default     = 14

  validation {
    condition     = var.booking_lookahead_days >= 1 && var.booking_lookahead_days <= 60
    error_message = "booking_lookahead_days must be between 1 and 60."
  }
}

variable "booking_min_lead_minutes" {
  description = "Minimum lead time before a slot can be requested"
  type        = number
  default     = 120

  validation {
    condition     = var.booking_min_lead_minutes >= 0 && var.booking_min_lead_minutes <= 10080
    error_message = "booking_min_lead_minutes must be between 0 and 10080."
  }
}

variable "booking_start_hour_utc" {
  description = "Booking window start hour (UTC, inclusive)"
  type        = number
  default     = 0

  validation {
    condition     = var.booking_start_hour_utc >= 0 && var.booking_start_hour_utc <= 23
    error_message = "booking_start_hour_utc must be between 0 and 23."
  }
}

variable "booking_end_hour_utc" {
  description = "Booking window end hour (UTC, exclusive)"
  type        = number
  default     = 8

  validation {
    condition     = var.booking_end_hour_utc >= 1 && var.booking_end_hour_utc <= 24
    error_message = "booking_end_hour_utc must be between 1 and 24."
  }
}

variable "booking_workdays_utc" {
  description = "Allowed booking weekdays in UTC (0=Sun .. 6=Sat)"
  type        = list(number)
  default     = [1, 2, 3, 4, 5]

  validation {
    condition = (
      length(var.booking_workdays_utc) > 0 &&
      length([for day in var.booking_workdays_utc : day if day >= 0 && day <= 6]) == length(var.booking_workdays_utc)
    )
    error_message = "booking_workdays_utc values must be integers between 0 and 6."
  }
}

variable "preserve_legacy_reviews_stack" {
  description = "Keep legacy reviews API/auth/IAM resources managed to avoid accidental destroy during booking rollout"
  type        = bool
  default     = true
}

variable "legacy_reviews_table_name" {
  description = "Legacy reviews DynamoDB table name preserved for compatibility"
  type        = string
  default     = "waterapps-prod-independent-reviews"
}

variable "legacy_reviews_table_arn" {
  description = "Legacy reviews DynamoDB table ARN used in Lambda IAM policy"
  type        = string
  default     = "arn:aws:dynamodb:ap-southeast-2:815373603734:table/waterapps-prod-independent-reviews"
}

variable "legacy_review_retention_days" {
  description = "Legacy review retention value kept in Lambda env for backward compatibility"
  type        = number
  default     = 365
}

variable "legacy_review_jwt_issuer" {
  description = "Legacy Cognito issuer for review admin JWT authorizer"
  type        = string
  default     = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_abk0SHGQp"
}

variable "legacy_review_jwt_audience" {
  description = "Legacy Cognito audience(client id) for review admin JWT authorizer"
  type        = string
  default     = "82lu2ao83rcqvjbcbnmcfbe3e"
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
