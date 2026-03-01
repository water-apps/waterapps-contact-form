# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.1] — 2026-03-01

### Added
- Terraform-managed SES domain authentication resources:
  - `aws_ses_domain_identity`
  - `aws_ses_domain_dkim`
  - `aws_ses_domain_mail_from`
- DNS-oriented SES outputs for verification token, DKIM tokens, and MAIL FROM SPF/MX records

### Changed
- Expanded Lambda SES IAM allowlist to include domain identity ARN
- Added sender-domain guardrail validation (`source_email` must match `source_email_domain`)
- Updated `terraform.tfvars.example` with MAIL FROM alignment settings and `bookings@waterapps.com.au` sender example
- Updated docs and smoke-test runbook with Gmail authentication verification checklist (`dkim=pass`, `spf=pass`, `dmarc=pass`)

## [1.0.0] — 2026-02-21

### Added
- Lambda contact form handler (Node.js 18, ESM)
- API Gateway HTTP API with CORS for waterapps.com.au
- SES email integration with Reply-To support
- Terraform infrastructure (Lambda, API GW, IAM, SES, CloudWatch)
- GitHub Actions CI/CD with OIDC federation
- Input validation and HTML sanitisation
- Basic anti-spam (URL count check)
- Architecture Decision Record (ADR-001)
- Cost estimate: $0/month within AWS free tier
