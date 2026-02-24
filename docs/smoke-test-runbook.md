# Contact Form Smoke Test Runbook

Use this runbook after backend deploys, website integration changes, or SES/email configuration changes.

## Script

- `scripts/smoke-test.sh`

## What It Checks

1. `GET /health` returns `200` and `status=ok`
2. `POST /contact` without `Origin` returns `403 origin_required`
3. `POST /contact` with invalid field types returns `400 validation_failed`
4. `POST /contact` valid payload returns `200 success` (sends a real email)

## Usage

Full smoke test (includes a real email send):

```bash
scripts/smoke-test.sh \
  --endpoint https://roatlihulb.execute-api.ap-southeast-2.amazonaws.com/contact
```

Safe smoke test (no email send):

```bash
scripts/smoke-test.sh \
  --endpoint https://roatlihulb.execute-api.ap-southeast-2.amazonaws.com/contact \
  --skip-valid-send
```

Override origin (for a new domain / staging host):

```bash
scripts/smoke-test.sh \
  --endpoint https://roatlihulb.execute-api.ap-southeast-2.amazonaws.com/contact \
  --origin https://waterapps.com.au
```

## Environment Variables (optional)

- `CONTACT_FORM_API_ENDPOINT` (alternative to `--endpoint`)
- `CONTACT_FORM_ORIGIN` (default `https://www.waterapps.com.au`)
- `CONTACT_FORM_SMOKE_EMAIL` (payload value only; does not change notification target)

## Expected Outcomes

- All checks pass: `Summary: 4 passed, 0 failed`
- Missing `Origin` test should fail with `403` by design (that is a pass condition)
- The valid send check triggers a real SES send to the configured backend target email

## Failure Triage

- `GET /health` fails:
  - Check API Gateway route deployment
  - Check Lambda health handler and CloudWatch logs

- Missing `Origin` returns `200/400` instead of `403`:
  - Check backend origin enforcement logic and `ALLOWED_ORIGINS`

- Invalid type test returns `500`:
  - Regression in request normalization/validation logic

- Valid send returns `500`:
  - Check SES identity verification status
  - Check Lambda IAM SES permissions
  - Check Lambda environment variables (`SOURCE_EMAIL`, `TARGET_EMAIL`)

## Post-Run Notes

- If mailbox providers still show trust warnings, verify SES domain DKIM/SPF status and allow for provider cache delay.
