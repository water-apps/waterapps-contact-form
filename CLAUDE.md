# CLAUDE.md — WaterApps

## Context
DevSecOps/AIOps consultancy for regulated industries (banks, gov, telcos) in Australia.
Quality bar: "Would a staff engineer at RBA approve this?"

## Workflow
- Plan mode for 3+ file changes. Stop and re-plan if stuck.
- Use subagents for research and parallel tasks.
- After corrections → update `tasks/lessons.md`
- Verify before done: validate, plan, scan, test.
- Never mark complete without proving it works.

## Terraform
- Pin provider versions with upper bounds
- Every variable: description + type + validation where sensible
- Tags: Project, Environment, ManagedBy="terraform", Owner="waterapps"
- Naming: `{project}-{env}-{resource}`
- No hardcoded values. No `Resource: "*"` in IAM
- Run: `terraform validate` → `terraform plan` → `tflint` → `tfsec`
- Remote state only. Never local state in shared repos
- Cost comments on expensive resources

## Security (Non-Negotiable)
- No secrets in code. Ever.
- Encryption at rest + in transit (TLS 1.2+)
- IAM least privilege. Document every permission.
- Private subnets for DBs/internal. Public only for LBs.
- Fix all CRITICAL/HIGH from tfsec/checkov/trivy before merge.

## Commits
Convention: `type(scope): description`
Types: feat, fix, docs, refactor, test, ci, chore, security
