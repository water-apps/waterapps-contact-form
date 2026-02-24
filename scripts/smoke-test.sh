#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
WaterApps contact-form smoke test

Usage:
  scripts/smoke-test.sh --endpoint https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/contact [options]

Options:
  --endpoint URL       Full /contact endpoint URL (or base API URL; /contact is appended)
  --origin URL         Origin header for browser-like requests (default: https://www.waterapps.com.au)
  --email EMAIL        Email value used in payloads (default: smoke-test@waterapps.com.au)
  --skip-valid-send    Skip the live success-path POST that sends an email
  --help               Show this help

Checks:
  1. GET /health returns 200 and status ok
  2. POST /contact without Origin returns 403 origin_required
  3. POST /contact with invalid field types returns 400 validation_failed
  4. POST /contact valid payload returns 200 success (unless --skip-valid-send)
EOF
}

ENDPOINT="${CONTACT_FORM_API_ENDPOINT:-}"
ORIGIN="${CONTACT_FORM_ORIGIN:-https://www.waterapps.com.au}"
EMAIL="${CONTACT_FORM_SMOKE_EMAIL:-smoke-test@waterapps.com.au}"
SKIP_VALID_SEND=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --endpoint)
      ENDPOINT="${2:-}"
      shift 2
      ;;
    --origin)
      ORIGIN="${2:-}"
      shift 2
      ;;
    --email)
      EMAIL="${2:-}"
      shift 2
      ;;
    --skip-valid-send)
      SKIP_VALID_SEND=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$ENDPOINT" ]]; then
  echo "Missing endpoint. Use --endpoint or set CONTACT_FORM_API_ENDPOINT." >&2
  usage >&2
  exit 2
fi

normalize_endpoint() {
  local raw="$1"
  raw="${raw%/}"
  if [[ "$raw" == */contact ]]; then
    CONTACT_URL="$raw"
    BASE_URL="${raw%/contact}"
  else
    BASE_URL="$raw"
    CONTACT_URL="$raw/contact"
  fi
  HEALTH_URL="$BASE_URL/health"
}

normalize_endpoint "$ENDPOINT"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASS_COUNT=0
FAIL_COUNT=0

say() {
  printf '%s\n' "$*"
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  say "PASS: $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  say "FAIL: $1"
  if [[ -n "${2:-}" && -f "$2" ]]; then
    say "  Response body:"
    sed 's/^/    /' "$2"
  fi
}

curl_json() {
  local method="$1"
  local url="$2"
  local body_file="$3"
  local payload="${4:-}"
  local origin_header="${5:-}"
  local -a args
  args=(-sS -X "$method" "$url" -o "$body_file" -w "%{http_code}" -H "Content-Type: application/json")
  if [[ -n "$origin_header" ]]; then
    args+=(-H "Origin: $origin_header")
  fi
  if [[ -n "$payload" ]]; then
    args+=(--data "$payload")
  fi
  curl "${args[@]}"
}

curl_plain() {
  local url="$1"
  local body_file="$2"
  curl -sS "$url" -o "$body_file" -w "%{http_code}"
}

body_contains() {
  local file="$1"
  local needle="$2"
  grep -Fq "$needle" "$file"
}

say "WaterApps contact-form smoke test"
say "Contact endpoint: $CONTACT_URL"
say "Health endpoint:   $HEALTH_URL"
say "Origin header:     $ORIGIN"
say

# 1) Health
health_body="$TMP_DIR/health.json"
health_code="$(curl_plain "$HEALTH_URL" "$health_body" || true)"
if [[ "$health_code" == "200" ]] && body_contains "$health_body" '"status":"ok"'; then
  pass "GET /health returns 200 and status ok"
else
  fail "GET /health expected 200 + status ok (got $health_code)" "$health_body"
fi

# 2) Missing Origin should be rejected
missing_origin_body="$TMP_DIR/missing-origin.json"
missing_origin_payload='{"name":"Smoke Test","email":"'"$EMAIL"'","message":"Missing origin header negative test"}'
missing_origin_code="$(curl_json "POST" "$CONTACT_URL" "$missing_origin_body" "$missing_origin_payload" "" || true)"
if [[ "$missing_origin_code" == "403" ]] && body_contains "$missing_origin_body" 'origin_required'; then
  pass "POST /contact without Origin returns 403 origin_required"
else
  fail "POST /contact without Origin expected 403 origin_required (got $missing_origin_code)" "$missing_origin_body"
fi

# 3) Invalid field type should be validation error, not 500
invalid_type_body="$TMP_DIR/invalid-type.json"
invalid_type_payload='{"name":123,"email":"'"$EMAIL"'","message":"Type mismatch validation test"}'
invalid_type_code="$(curl_json "POST" "$CONTACT_URL" "$invalid_type_body" "$invalid_type_payload" "$ORIGIN" || true)"
if [[ "$invalid_type_code" == "400" ]] && body_contains "$invalid_type_body" 'validation_failed'; then
  pass "POST /contact invalid field type returns 400 validation_failed"
else
  fail "POST /contact invalid field type expected 400 validation_failed (got $invalid_type_code)" "$invalid_type_body"
fi

# 4) Valid request (sends an email)
if [[ "$SKIP_VALID_SEND" -eq 1 ]]; then
  say "SKIP: Valid send check skipped (--skip-valid-send)"
else
  valid_body="$TMP_DIR/valid.json"
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  valid_payload='{"name":"Prod Smoke Test","email":"'"$EMAIL"'","company":"WaterApps","message":"Automated smoke test ('"$ts"')"}'
  valid_code="$(curl_json "POST" "$CONTACT_URL" "$valid_body" "$valid_payload" "$ORIGIN" || true)"
  if [[ "$valid_code" == "200" ]] && body_contains "$valid_body" '"status":"success"'; then
    pass "POST /contact valid payload returns 200 success"
  else
    fail "POST /contact valid payload expected 200 success (got $valid_code)" "$valid_body"
  fi
fi

say
say "Summary: $PASS_COUNT passed, $FAIL_COUNT failed"
if [[ "$FAIL_COUNT" -ne 0 ]]; then
  exit 1
fi
