# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

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
