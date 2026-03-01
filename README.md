# WaterApps Contact + Booking API — Serverless

Serverless contact + booking backend for [waterapps.com.au](https://www.waterapps.com.au). Receives enquiries and discovery-call booking requests, then sends notifications via AWS SES.

## Architecture

```
┌─────────────────────┐         ┌──────────────────┐         ┌────────────┐         ┌─────────┐
│                     │  POST   │                  │ invoke  │            │  send   │         │
│   GitHub Pages      │────────▶│  API Gateway     │────────▶│   Lambda   │────────▶│   SES   │
│   waterapps.com.au  │ /contact,/booking,/availability      │  Node.js 22│         │  Email  │
│                     │◀────────│  (CORS locked)   │◀────────│            │         │         │
│                     │  JSON   │                  │  JSON   │            │         │         │
└─────────────────────┘         └──────────────────┘         └─────┬──────┘         └────┬────┘
                                                                   │                     │
                                                                   ▼                     ▼
                                                            ┌────────────┐        ┌────────────┐
                                                            │ CloudWatch │        │   Inbox    │
                                                            │   Logs     │        │ hello@     │
                                                            └────────────┘        └────────────┘
```

## Cost Estimate

| Resource | Monthly Cost | Notes |
|----------|-------------|-------|
| Lambda | $0.00 | 1M free requests/month — contact forms won't exceed 1K |
| API Gateway | $0.00 | 1M free HTTP API requests/month |
| SES | $0.00 | First 62K emails free when sent from Lambda |
| CloudWatch Logs | $0.00 | <1MB/month at contact form volume |
| **Total** | **$0.00** | Within AWS free tier for typical usage |

## Prerequisites

- AWS account with CLI configured (`aws configure`)
- Terraform >= 1.5
- Node.js 18+ (for Lambda dependencies)
- SES: verify your sender email (Terraform handles this — check inbox after first apply)

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/vkaushik13/waterapps-contact-form.git
cd waterapps-contact-form

# Set your email addresses
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# Edit terraform.tfvars with your values
```

### 2. Install Lambda dependencies

```bash
cd lambda
npm install
cd ..
```

### 3. Deploy

```bash
cd terraform
terraform init
terraform plan        # Review what will be created
terraform apply       # Deploy
```

Migration safety note:
- `preserve_legacy_reviews_stack = true` (default) keeps legacy `/reviews` API/auth/IAM resources managed so booking rollout does not destroy existing reviews infrastructure.
- Set it to `false` only after an explicit reviews retirement plan is approved.

### 4. Verify SES

After first `terraform apply`, AWS sends a verification email to your `source_email`. Click the link to activate sending.

### 5. Get your API endpoint

```bash
terraform output api_endpoint
# Example: https://abc123.execute-api.ap-southeast-2.amazonaws.com/contact

terraform output booking_endpoint
# Example: https://abc123.execute-api.ap-southeast-2.amazonaws.com/booking

terraform output availability_endpoint
# Example: https://abc123.execute-api.ap-southeast-2.amazonaws.com/availability
```

### 6. Update your website

Add the API endpoint to your contact form's `fetch()` call.
Recommended frontend behavior:
- Surface `fieldErrors` from API responses

Example:

```javascript
const response = await fetch("YOUR_API_ENDPOINT_HERE", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Jane Smith",
    email: "jane@example.com",
    company: "Acme Corp",        // optional
    phone: "+61 400 000 000",    // optional
    message: "I'd like to discuss a DevOps engagement..."
  })
});

const data = await response.json();
// data.status === "success" || "error"
// data.fieldErrors may be returned on validation failure
```

Booking endpoints:
- `GET /availability?days=7` returns UTC booking slots
- `POST /booking` accepts `name`, `email`, optional `company`, `notes`, `timezone`, and `slotStart` (UTC ISO timestamp)

### 7. Test it

```bash
# Replace with your actual endpoint
curl -X POST https://YOUR-API-ID.execute-api.ap-southeast-2.amazonaws.com/contact \
  -H "Content-Type: application/json" \
  -H "Origin: https://www.waterapps.com.au" \
  -d '{"name":"Test","email":"test@example.com","message":"Testing the contact form from terminal"}'

# Health/smoke endpoint (frontend and pipeline friendly)
curl https://YOUR-API-ID.execute-api.ap-southeast-2.amazonaws.com/health
```

Note: `POST /contact` rejects requests without an `Origin` header (`403 origin_required`) to reduce abuse from non-browser clients.

Repeatable smoke test script (recommended after deploys / config changes):

```bash
./scripts/smoke-test.sh \
  --endpoint https://YOUR-API-ID.execute-api.ap-southeast-2.amazonaws.com/contact
```

See `/Users/varunau/Projects/waterapps/waterapps-contact-form/docs/smoke-test-runbook.md` for the full runbook and failure triage.

## Booking API (Calendly-style MVP)

Current capability:
- Availability API for upcoming slots (`GET /availability`)
- Booking request API (`POST /booking`)
- Email notification to `target_email` for each booking request
- Same-origin CORS and server-side validation

Current limitation:
- No calendar OAuth sync (Google/Microsoft) yet
- Request-based booking flow (slot confirmation is finalized by email)

## Project Structure

```
waterapps-contact-form/
├── lambda/
│   ├── index.mjs              # Routes: /contact, /availability, /booking, /health
│   └── package.json           # Lambda dependencies
├── terraform/
│   ├── main.tf                # Lambda, API GW, IAM, SES, CloudWatch
│   ├── backend.tf             # Remote state backend declaration (S3)
│   ├── variables.tf           # All configurable with validation
│   ├── outputs.tf             # API endpoint + useful references
│   └── terraform.tfvars.example
├── .github/
│   └── workflows/
│       └── deploy.yml         # Validate on PR, deploy on push to main
├── docs/
│   ├── smoke-test-runbook.md      # Post-deploy API smoke test procedure
│   └── adr/
│       └── 001-serverless-contact-form.md
├── scripts/
│   └── smoke-test.sh          # Repeatable health/validation/origin smoke test
├── CLAUDE.md                  # Engineering standards for Claude Code
├── CHANGELOG.md
└── README.md
```

## Security

- **CORS**: Configurable allowlist in Terraform and enforced in Lambda response handling
- **IAM**: Lambda role has only `ses:SendEmail` (scoped to verified identity) and CloudWatch logging
- **No `Resource: "*"`**: Every IAM permission is scoped to specific ARNs
- **Input validation**: Name, email, message validated server-side
- **Field limits**: Request size and input lengths constrained to reduce abuse
- **HTML sanitisation**: All input escaped before use
- **Anti-spam**: URL limit and spam-pattern checks in backend validation
- **Booking guardrails**: slot-window, lead-time, and UTC timestamp checks
- **No secrets in code**: Emails passed via environment variables, AWS auth via OIDC

## SES Sandbox Note

New AWS accounts start in SES sandbox mode. This means you can only send to verified email addresses. For a contact form where you're sending to yourself, this is fine. If you later need to send confirmation emails to the submitter, request production SES access in the AWS console.

## Email Authentication (Required for Gmail Trust)

To avoid warnings like "sender can't be verified", deploy SES with:

1. Domain identity (`source_email_domain`, default: `waterapps.com.au`)
2. Easy DKIM (`aws_ses_domain_dkim`)
3. Custom MAIL FROM subdomain (`aws_ses_domain_mail_from`, default: `mail.waterapps.com.au`)
4. Sender address from that domain (`source_email`, recommended: `bookings@waterapps.com.au`)

This repo now manages all SES auth resources in Terraform (enabled by default with `manage_ses_domain_authentication = true`).

### DNS records to publish

After `terraform apply`, publish values from outputs:

1. Domain verification TXT:
- `_amazonses.<source_email_domain>` = `ses_domain_identity_verification_token`

2. DKIM CNAME (3 records):
- `<token>._domainkey.<source_email_domain>` -> `<token>.dkim.amazonses.com`
- tokens are in output `ses_dkim_tokens`

3. MAIL FROM MX:
- `<mail_from_subdomain>.<source_email_domain>` MX `10 feedback-smtp.<region>.amazonses.com`
- output: `ses_mail_from_mx_record`

4. MAIL FROM SPF TXT:
- `<mail_from_subdomain>.<source_email_domain>` TXT `v=spf1 include:amazonses.com -all`
- output: `ses_mail_from_spf_txt`

5. DMARC (domain-level):
- `_dmarc.<source_email_domain>` should remain present and enforced

### Verification checklist

1. Send a booking test email from `/booking`.
2. In Gmail "Show original", confirm:
- `dkim=pass` for `waterapps.com.au`
- `spf=pass`
- `dmarc=pass`
3. Confirm warning banner is no longer shown after provider caches refresh.

## CI/CD Setup (Optional)

The GitHub Actions workflow uses OIDC federation — no long-lived AWS keys stored in GitHub.

Current flow:
- Push / PR: validate + security checks
- PR (optional): Terraform plan when remote-state and OIDC prerequisites are configured
- `main` push: deploy only when auto deploy is explicitly enabled
- Manual `workflow_dispatch`: Terraform plan/apply with `production` environment approval

To enable:

1. Create an IAM OIDC identity provider for GitHub in your AWS account
2. Create a deploy role with permissions for Lambda, API GW, SES, IAM, CloudWatch
3. Add `AWS_DEPLOY_ROLE_ARN` to your GitHub repository secrets
4. Configure remote Terraform state + locking (required for safe CI apply):
   - Repo vars:
     - `CONTACT_FORM_TF_STATE_BUCKET`
     - `CONTACT_FORM_TF_STATE_KEY` (optional override; default: `contact-form/terraform.tfstate`)
     - `CONTACT_FORM_TF_LOCK_TABLE`
5. Set `CONTACT_FORM_AUTO_DEPLOY_ENABLED=true` only after the backend is configured
6. Push to `main` — the workflow handles the rest

Without remote state, CI runners use ephemeral local state and can collide with existing AWS resources.

For GitOps-style approvals, configure:
- Branch protection on `main` (require PR + status checks)
- GitHub `production` environment required reviewers (for deploy approval)

### Manual Operator Run (Restored Apply Stage)

Use the workflow `Contact Form — Deploy` with `workflow_dispatch` input:

- `action=plan` for a safe manual plan run
- `action=apply` for a manual apply (gated by `production` environment approval)

This is the recommended operator path when auto deploy is disabled.

## Monitoring

```bash
# Watch Lambda logs
aws logs tail /aws/lambda/waterapps-prod-contact --follow

# Check health endpoint
curl "$(terraform output -raw health_endpoint)"

# Check recent invocations
aws lambda get-function --function-name waterapps-prod-contact --query 'Configuration.LastModified'
```

## Tear Down

```bash
cd terraform
terraform destroy
```

---

**Water Apps Pty Ltd** | ABN 63 632 823 084 | Sydney, Australia
