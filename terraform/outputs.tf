output "api_endpoint" {
  description = "Contact form API URL — use this in your frontend fetch() call"
  value       = "${aws_apigatewayv2_api.contact.api_endpoint}/contact"
}

output "health_endpoint" {
  description = "Health endpoint for smoke testing frontend integration"
  value       = "${aws_apigatewayv2_api.contact.api_endpoint}/health"
}

output "booking_endpoint" {
  description = "Booking request endpoint for discovery calls"
  value       = "${aws_apigatewayv2_api.contact.api_endpoint}/booking"
}

output "availability_endpoint" {
  description = "Availability endpoint for scheduler UI"
  value       = "${aws_apigatewayv2_api.contact.api_endpoint}/availability"
}

output "review_admin_jwt_auth_enabled" {
  description = "Whether legacy review admin JWT authorizer compatibility mode is enabled"
  value       = var.preserve_legacy_reviews_stack
}

output "reviews_submit_endpoint" {
  description = "Legacy public reviews submit endpoint (preserved during migration)"
  value       = var.preserve_legacy_reviews_stack ? "${aws_apigatewayv2_api.contact.api_endpoint}/reviews" : null
}

output "reviews_admin_list_endpoint" {
  description = "Legacy admin reviews list endpoint (preserved during migration)"
  value       = var.preserve_legacy_reviews_stack ? "${aws_apigatewayv2_api.contact.api_endpoint}/reviews" : null
}

output "reviews_admin_moderate_endpoint_template" {
  description = "Legacy admin review moderation endpoint template"
  value       = var.preserve_legacy_reviews_stack ? "${aws_apigatewayv2_api.contact.api_endpoint}/reviews/{reviewId}/moderate" : null
}

output "reviews_table_name" {
  description = "Legacy reviews table name retained for compatibility tracking"
  value       = var.preserve_legacy_reviews_stack ? var.legacy_reviews_table_name : null
}

output "api_id" {
  description = "API Gateway ID for reference"
  value       = aws_apigatewayv2_api.contact.id
}

output "lambda_function_name" {
  description = "Lambda function name for monitoring"
  value       = aws_lambda_function.contact.function_name
}

output "lambda_log_group" {
  description = "CloudWatch log group for debugging"
  value       = aws_cloudwatch_log_group.lambda.name
}

output "ses_verification_status" {
  description = "Check your email to verify SES identity after first apply"
  value       = "Verification email sent to ${var.source_email} — click the link to activate"
}

output "allowed_origins" {
  description = "Configured CORS allowed origins"
  value       = var.allowed_origins
}
