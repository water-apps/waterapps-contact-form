# WaterApps Contact Form — Serverless

Serverless contact form backend for [waterapps.com.au](https://www.waterapps.com.au). Receives enquiries from the website and sends email notifications via AWS SES.

## Architecture

```
┌─────────────────────┐         ┌──────────────────┐         ┌────────────┐         ┌─────────┐
│                     │  POST   │                  │ invoke  │            │  send   │         │
│   GitHub Pages      │────────▶│  API Gateway     │────────▶│   Lambda   │────────▶│   SES   │
│   waterapps.com.au  │  /contact  HTTP API        │         │  Node.js 18│         │  Email  │
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
- Include a hidden honeypot field `website` (leave blank)
- Include a timestamp field `submittedAt` when the form is rendered/submitted
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
    website: "",                 // hidden honeypot field (must stay blank)
    submittedAt: new Date().toISOString(),
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
  -d '{"name":"Test","email":"test@example.com","message":"Testing the contact form from terminal"}'

# Health/smoke endpoint (frontend and pipeline friendly)
curl https://YOUR-API-ID.execute-api.ap-southeast-2.amazonaws.com/health
```

## Project Structure

```
waterapps-contact-form/
├── lambda/
│   ├── index.mjs              # Handler: validate → sanitise → SES send
│   └── package.json           # AWS SDK SES dependency
├── terraform/
│   ├── main.tf                # Lambda, API GW, IAM, SES, CloudWatch
│   ├── variables.tf           # All configurable with validation
│   ├── outputs.tf             # API endpoint + useful references
│   └── terraform.tfvars.example
├── .github/
│   └── workflows/
│       └── deploy.yml         # Validate on PR, deploy on push to main
├── docs/
│   └── adr/
│       └── 001-serverless-contact-form.md
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
- **Anti-spam**: Honeypot (`website`), fill-time check (`submittedAt`), URL limit, spam-pattern checks
- **Rate limiting**: API Gateway throttling enabled at stage level (low-cost protection)
- **No secrets in code**: Emails passed via environment variables, AWS auth via OIDC

## SES Sandbox Note

New AWS accounts start in SES sandbox mode. This means you can only send to verified email addresses. For a contact form where you're sending to yourself, this is fine. If you later need to send confirmation emails to the submitter, request production SES access in the AWS console.

## CI/CD Setup (Optional)

The GitHub Actions workflow uses OIDC federation — no long-lived AWS keys stored in GitHub. To enable:

1. Create an IAM OIDC identity provider for GitHub in your AWS account
2. Create a deploy role with permissions for Lambda, API GW, SES, IAM, CloudWatch
3. Add `AWS_DEPLOY_ROLE_ARN` to your GitHub repository secrets
4. Push to `main` — the workflow handles the rest

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
