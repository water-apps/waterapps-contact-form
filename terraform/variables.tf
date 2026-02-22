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
  default     = "hello@waterapps.com.au"

  validation {
    condition     = can(regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", var.source_email))
    error_message = "Must be a valid email address."
  }
}

variable "target_email" {
  description = "Email address that receives contact form submissions"
  type        = string
  default     = "hello@waterapps.com.au"

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

variable "log_level" {
  description = "Lambda log verbosity"
  type        = string
  default     = "info"

  validation {
    condition     = contains(["debug", "info", "warn", "error"], var.log_level)
    error_message = "log_level must be one of: debug, info, warn, error."
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
