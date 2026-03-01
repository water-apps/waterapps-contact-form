output "api_endpoint" {
  description = "Contact form API URL — use this in your frontend fetch() call"
  value       = "${aws_apigatewayv2_api.contact.api_endpoint}/contact"
}

output "reviews_submit_endpoint" {
  description = "Independent review submission endpoint for public website form"
  value       = "${aws_apigatewayv2_api.contact.api_endpoint}/reviews"
}

output "reviews_admin_list_endpoint" {
  description = "Admin endpoint to list moderated/pending review submissions"
  value       = "${aws_apigatewayv2_api.contact.api_endpoint}/reviews"
}

output "reviews_admin_moderate_endpoint_template" {
  description = "Admin endpoint template to approve/reject a review"
  value       = "${aws_apigatewayv2_api.contact.api_endpoint}/reviews/{reviewId}/moderate"
}

output "health_endpoint" {
  description = "Health endpoint for smoke testing frontend integration"
  value       = "${aws_apigatewayv2_api.contact.api_endpoint}/health"
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

output "reviews_table_name" {
  description = "DynamoDB table storing independent review submissions"
  value       = aws_dynamodb_table.independent_reviews.name
}

output "review_admin_jwt_auth_enabled" {
  description = "Whether review admin endpoints require JWT authorization"
  value       = var.enable_review_admin_jwt_auth
}
