# WaterApps Contact Form — Serverless Infrastructure
#
# Architecture: GitHub Pages → API Gateway HTTP API → Lambda → SES
# Cost estimate: ~$0/month (free tier covers typical contact form volume)
# - Lambda: 1M free requests/month, contact forms won't exceed 1K
# - API Gateway: 1M free requests/month for HTTP APIs
# - SES: $0.10 per 1K emails (first 62K free from EC2/Lambda)

terraform {
  required_version = ">= 1.5.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  # Uncomment for remote state (recommended for production)
  # backend "s3" {
  #   bucket         = "waterapps-terraform-state"
  #   key            = "contact-form/terraform.tfstate"
  #   region         = "ap-southeast-2"
  #   dynamodb_table = "waterapps-terraform-lock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = var.common_tags
  }
}

# ─────────────────────────────────────────────
# DATA
# ─────────────────────────────────────────────

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ─────────────────────────────────────────────
# IAM — Least privilege for Lambda
# ─────────────────────────────────────────────

resource "aws_iam_role" "lambda" {
  name = "${var.project}-${var.environment}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

# SES send permission — scoped to verified identities only
resource "aws_iam_role_policy" "lambda_ses" {
  name = "${var.project}-${var.environment}-ses-send"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ]
      # Scoped to the specific verified identity, not wildcard
      Resource = "arn:aws:ses:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:identity/${var.source_email}"
    }]
  })
}

# CloudWatch logging — scoped to this function's log group
resource "aws_iam_role_policy" "lambda_logging" {
  name = "${var.project}-${var.environment}-logging"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project}-${var.environment}-contact:*"
    }]
  })
}

# ─────────────────────────────────────────────
# LAMBDA
# ─────────────────────────────────────────────

# Package the Lambda code
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda"
  output_path = "${path.module}/lambda.zip"
}

resource "aws_lambda_function" "contact" {
  function_name = "${var.project}-${var.environment}-contact"
  description   = "Contact form handler for waterapps.com.au"

  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 10
  memory_size      = 128 # Minimal — contact form doesn't need more

  role = aws_iam_role.lambda.arn

  environment {
    variables = {
      SOURCE_EMAIL    = var.source_email
      TARGET_EMAIL    = var.target_email
      ALLOWED_ORIGINS = join(",", var.allowed_origins)
      MAX_BODY_BYTES  = tostring(var.max_body_bytes)
      LOG_LEVEL       = var.log_level
    }
  }
}

# CloudWatch log group with retention
# 30 days is sufficient for a contact form — keeps costs at $0
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${aws_lambda_function.contact.function_name}"
  retention_in_days = 30
}

# ─────────────────────────────────────────────
# API GATEWAY — HTTP API (cheaper than REST API)
# ─────────────────────────────────────────────

resource "aws_apigatewayv2_api" "contact" {
  name          = "${var.project}-${var.environment}-contact-api"
  protocol_type = "HTTP"
  description   = "WaterApps contact form API"

  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["Content-Type", "X-Requested-With"]
    max_age       = 86400 # 24 hours — browser caches preflight
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.contact.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.api_throttling_burst_limit
    throttling_rate_limit  = var.api_throttling_rate_limit
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      ip               = "$context.identity.sourceIp"
      requestTime      = "$context.requestTime"
      httpMethod       = "$context.httpMethod"
      path             = "$context.path"
      status           = "$context.status"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${var.project}-${var.environment}-contact"
  retention_in_days = 14
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.contact.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.contact.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post_contact" {
  api_id    = aws_apigatewayv2_api.contact.id
  route_key = "POST /contact"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "get_health" {
  api_id    = aws_apigatewayv2_api.contact.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# Allow API Gateway to invoke Lambda
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.contact.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.contact.execution_arn}/*/*"
}

# ─────────────────────────────────────────────
# SES — Email identity verification
# ─────────────────────────────────────────────

resource "aws_ses_email_identity" "source" {
  email = var.source_email
}

# Optional: verify target email too (required in SES sandbox)
resource "aws_ses_email_identity" "target" {
  count = var.source_email != var.target_email ? 1 : 0
  email = var.target_email
}
