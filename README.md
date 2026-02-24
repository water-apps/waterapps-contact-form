# WaterApps Contact Form — Serverless

Serverless contact form backend for [waterapps.com.au](https://www.waterapps.com.au). Receives enquiries from the website and sends email notifications via AWS SES.

## Architecture

```
┌─────────────────────┐         ┌──────────────────┐         ┌────────────┐         ┌─────────┐
│                     │  POST   │                  │ invoke  │            │  send   │         │
│   GitHub Pages      │────────▶│  API Gateway     │────────▶│   Lambda   │────────▶│   SES   │
│   waterapps.com.au  │  /contact  HTTP API        │         │  Node.js 22│         │  Email  │
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

### 4. Verify SES

After first `terraform apply`, AWS sends a verification email to your `source_email`. Click the link to activate sending.

### 5. Get your API endpoint

```bash
terraform output api_endpoint
# Example: https://abc123.execute-api.ap-southeast-2.amazonaws.com/contact
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

## Project Structure

```
waterapps-contact-form/
├── lambda/
│   ├── index.mjs              # Handler: validate → sanitise → SES send
│   └── package.json           # AWS SDK SES dependency
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
- **No secrets in code**: Emails passed via environment variables, AWS auth via OIDC

## SES Sandbox Note

New AWS accounts start in SES sandbox mode. This means you can only send to verified email addresses. For a contact form where you're sending to yourself, this is fine. If you later need to send confirmation emails to the submitter, request production SES access in the AWS console.

## Email Authentication Status (In Progress: DNS Publish Pending)

The contact form is live and sending, but mailbox providers may still show warnings such as "This message isn't authenticated" until domain-level email authentication is fully configured.

Current status (2026-02-24):
- SES email identity sending is working for `varun@waterapps.com.au`
- Contact form delivery is operational
- SES domain identity for `waterapps.com.au` has been created in `ap-southeast-2`
- Easy DKIM is enabled in SES and waiting on DNS propagation (`VerificationStatus=PENDING`, `DkimStatus=PENDING`)
- Public DNS is not hosted in Route 53 (nameservers: `ns07.domaincontrol.com`, `ns08.domaincontrol.com`) and must be updated in GoDaddy
- DMARC already exists (`p=quarantine`)
- SPF TXT record is currently missing at the apex domain

DNS records to publish in GoDaddy (required to remove mailbox trust warnings):

DKIM (CNAME):
- `4zszwq5bhhuy7gswpgxhbiizkvvpn6x4._domainkey.waterapps.com.au` -> `4zszwq5bhhuy7gswpgxhbiizkvvpn6x4.dkim.amazonses.com`
- `76dek2jl4soqnjmeogwaqgayqkrrvp67._domainkey.waterapps.com.au` -> `76dek2jl4soqnjmeogwaqgayqkrrvp67.dkim.amazonses.com`
- `yyb55it6b6ol7ybfcay633yeeei7zdyp._domainkey.waterapps.com.au` -> `yyb55it6b6ol7ybfcay633yeeei7zdyp.dkim.amazonses.com`

SPF (TXT at apex `waterapps.com.au`, if no existing SPF record):
- `v=spf1 include:amazonses.com ~all`

DMARC (already present, confirm it remains published):
- `_dmarc.waterapps.com.au` -> `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;`

Optional hardening (later):
- Configure a custom MAIL FROM subdomain (for SPF alignment) after DKIM is verified

Until the DNS records are in place and propagated, recipients may see unauthenticated-sender warnings even for legitimate contact form emails.

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
