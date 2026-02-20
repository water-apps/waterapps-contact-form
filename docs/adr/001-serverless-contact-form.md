# ADR-001: Serverless Contact Form Architecture

## Status
Accepted — February 2026

## Context
waterapps.com.au needs a contact form that sends enquiry notifications.
The website is hosted on GitHub Pages (static), so we need a backend service.

## Decision
Use AWS serverless: API Gateway HTTP API → Lambda → SES

## Alternatives Considered

**Formspree / Netlify Forms**
- Pro: Zero infrastructure
- Con: Third-party dependency, limited customisation, monthly cost at scale
- Con: Data leaves our control — not ideal for a security consultancy

**AWS SNS instead of SES**
- Pro: Simpler
- Con: No email formatting control, no Reply-To headers

**Self-hosted on VPS**
- Pro: Full control
- Con: Server to maintain, patching, uptime responsibility for a contact form

## Rationale
- Cost: effectively $0/month within free tier
- Control: we own the infrastructure, logs, and data pipeline
- Credibility: demonstrates serverless + Terraform to prospects who view the repo
- Security: IAM least privilege, CORS locked to our domain, no third-party data sharing
- Extensibility: easy to add Slack notification, CRM integration, or rate limiting later

## Consequences
- Need AWS account with SES verified (sandbox or production)
- Need to set up OIDC federation for GitHub Actions → AWS (no long-lived keys)
- Lambda cold starts add ~200ms on first request — acceptable for contact form
