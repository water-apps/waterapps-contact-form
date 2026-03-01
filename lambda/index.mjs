/**
 * WaterApps Contact + Independent Review Handler
 *
 * Routes:
 *   POST /contact                       Public enquiry submission (SES email)
 *   POST /reviews                       Public independent review submission (DynamoDB + SES notice)
 *   GET  /reviews                       Admin list of reviews (API Gateway JWT auth recommended)
 *   POST /reviews/{reviewId}/moderate   Admin approve/reject review (API Gateway JWT auth recommended)
 *   GET  /health                        Health check
 */

import { randomUUID, createHmac, createHash } from "node:crypto";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({});

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || "16384");
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const REVIEWS_TABLE_NAME = process.env.REVIEWS_TABLE_NAME || "";
const REVIEW_RETENTION_DAYS = Number(process.env.REVIEW_RETENTION_DAYS || "365");
const REVIEW_STATUS_INDEX_NAME = "status-created-at-index";
const VALID_REVIEW_STATUSES = ["pending", "approved", "rejected"];
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-southeast-2";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s()+\-./]{6,30}$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(origin) {
  const allowOrigin = isAllowedOrigin(origin)
    ? origin
    : ALLOWED_ORIGINS[0] || "https://www.waterapps.com.au";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

function sanitise(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : value;
}

function normaliseContactInput(body) {
  return {
    name: cleanText(body.name),
    email: typeof body.email === "string" ? body.email.trim().toLowerCase() : body.email,
    company: typeof body.company === "string" ? body.company.trim() : body.company ?? "",
    phone: typeof body.phone === "string" ? body.phone.trim() : body.phone ?? "",
    message: cleanText(body.message),
  };
}

function normaliseReviewInput(body) {
  return {
    name: cleanText(body.name),
    email: typeof body.email === "string" ? body.email.trim().toLowerCase() : body.email,
    role: typeof body.role === "string" ? body.role.trim() : body.role ?? "",
    company: typeof body.company === "string" ? body.company.trim() : body.company ?? "",
    linkedin: cleanText(body.linkedin),
    review: cleanText(body.review),
    rating: body.rating == null || body.rating === "" ? "" : String(body.rating).trim(),
    consent: body.consent,
  };
}

function validateContact(input) {
  const fieldErrors = {};

  if (typeof input.name !== "string" || input.name.length < 2) {
    fieldErrors.name = "Name is required (min 2 characters).";
  } else if (input.name.length > 120) {
    fieldErrors.name = "Name must be 120 characters or less.";
  }

  if (typeof input.email !== "string" || !EMAIL_RE.test(input.email)) {
    fieldErrors.email = "Valid email is required.";
  } else if (input.email.length > 254) {
    fieldErrors.email = "Email must be 254 characters or less.";
  }

  if (typeof input.company !== "string") {
    fieldErrors.company = "Company must be text.";
  } else if (input.company && input.company.length > 120) {
    fieldErrors.company = "Company must be 120 characters or less.";
  }

  if (typeof input.phone !== "string") {
    fieldErrors.phone = "Phone must be text.";
  } else if (input.phone && !PHONE_RE.test(input.phone)) {
    fieldErrors.phone = "Phone format looks invalid.";
  }

  if (typeof input.message !== "string" || input.message.length < 10) {
    fieldErrors.message = "Message is required (min 10 characters).";
  } else if (input.message.length > 4000) {
    fieldErrors.message = "Message must be 4000 characters or less.";
  }

  if (typeof input.message === "string") {
    const urlCount = input.message.match(/https?:\/\//g)?.length || 0;
    if (!fieldErrors.message && urlCount > 3) {
      fieldErrors.message = "Message contains too many links.";
    }
    if (!fieldErrors.message && /(.)\1{14,}/.test(input.message)) {
      fieldErrors.message = "Message looks like spam.";
    }
  }

  return fieldErrors;
}

function isValidLinkedInUrl(urlText) {
  if (typeof urlText !== "string" || urlText.length === 0) return false;
  try {
    const parsed = new URL(urlText);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return false;
    if (!parsed.pathname || parsed.pathname === "/") return false;
    return true;
  } catch {
    return false;
  }
}

function validateReview(input) {
  const fieldErrors = {};

  if (typeof input.name !== "string" || input.name.length < 2) {
    fieldErrors.name = "Name is required (min 2 characters).";
  } else if (input.name.length > 120) {
    fieldErrors.name = "Name must be 120 characters or less.";
  }

  if (typeof input.email !== "string" || !EMAIL_RE.test(input.email)) {
    fieldErrors.email = "Valid email is required.";
  } else if (input.email.length > 254) {
    fieldErrors.email = "Email must be 254 characters or less.";
  }

  if (typeof input.role !== "string") {
    fieldErrors.role = "Role must be text.";
  } else if (input.role && input.role.length > 120) {
    fieldErrors.role = "Role must be 120 characters or less.";
  }

  if (typeof input.company !== "string") {
    fieldErrors.company = "Company must be text.";
  } else if (input.company && input.company.length > 120) {
    fieldErrors.company = "Company must be 120 characters or less.";
  }

  if (!isValidLinkedInUrl(input.linkedin)) {
    fieldErrors.linkedin = "Please provide a valid HTTPS LinkedIn profile URL.";
  } else if (input.linkedin.length > 500) {
    fieldErrors.linkedin = "LinkedIn URL must be 500 characters or less.";
  }

  if (typeof input.review !== "string" || input.review.length < 30) {
    fieldErrors.review = "Review is required (min 30 characters).";
  } else if (input.review.length > 2500) {
    fieldErrors.review = "Review must be 2500 characters or less.";
  }

  if (!(input.rating === "" || /^[1-5]$/.test(input.rating))) {
    fieldErrors.rating = "Rating must be between 1 and 5.";
  }

  if (input.consent !== true && input.consent !== "yes") {
    fieldErrors.consent = "Consent is required to submit a review.";
  }

  return fieldErrors;
}

function jsonResponse(statusCode, origin, payload) {
  return {
    statusCode,
    headers: corsHeaders(origin),
    body: JSON.stringify(payload),
  };
}

function log(level, message, data = {}) {
  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  if ((levels[level] || 20) < (levels[LOG_LEVEL] || 20)) return;
  const logger = level === "debug" ? console.log : console[level] || console.log;
  logger(JSON.stringify({ level, message, ...data }));
}

function parseJsonBody(event, origin, requestId) {
  const bodyText = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: jsonResponse(413, origin, {
        status: "error",
        code: "payload_too_large",
        message: "Request body is too large.",
        requestId,
      }),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyText || "{}");
  } catch {
    return {
      ok: false,
      response: jsonResponse(400, origin, {
        status: "error",
        code: "invalid_json",
        message: "Request body must be valid JSON.",
        requestId,
      }),
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      response: jsonResponse(400, origin, {
        status: "error",
        code: "invalid_payload",
        message: "Request body must be a JSON object.",
        requestId,
      }),
    };
  }

  return { ok: true, parsed };
}

function getRouteKey(event, method, path) {
  return event.routeKey || event.requestContext?.routeKey || `${method} ${path}`;
}

function toAttrValue(value) {
  if (value === null || value === undefined) {
    return { NULL: true };
  }
  if (typeof value === "string") {
    return { S: value };
  }
  if (typeof value === "number") {
    return { N: String(value) };
  }
  if (typeof value === "boolean") {
    return { BOOL: value };
  }
  throw new Error(`Unsupported DynamoDB value type: ${typeof value}`);
}

function fromAttrValue(value) {
  if (!value || typeof value !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(value, "S")) return value.S;
  if (Object.prototype.hasOwnProperty.call(value, "N")) return Number(value.N);
  if (Object.prototype.hasOwnProperty.call(value, "BOOL")) return Boolean(value.BOOL);
  if (Object.prototype.hasOwnProperty.call(value, "NULL")) return null;
  return null;
}

function marshallItem(item) {
  const out = {};
  Object.entries(item).forEach(([key, value]) => {
    if (value === undefined) return;
    out[key] = toAttrValue(value);
  });
  return out;
}

function marshallExpressionValues(values) {
  const out = {};
  Object.entries(values).forEach(([key, value]) => {
    out[key] = toAttrValue(value);
  });
  return out;
}

function unmarshallItem(item) {
  if (!item || typeof item !== "object") return {};
  const out = {};
  Object.entries(item).forEach(([key, value]) => {
    out[key] = fromAttrValue(value);
  });
  return out;
}

function toAmzDate(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function getSignatureKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

async function dynamoRequest(target, payload) {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials are not available for DynamoDB request.");
  }

  const service = "dynamodb";
  const host = `${service}.${AWS_REGION}.amazonaws.com`;
  const endpoint = `https://${host}/`;
  const method = "POST";
  const body = JSON.stringify(payload);
  const amzDate = toAmzDate();
  const dateStamp = amzDate.slice(0, 8);

  const headerMap = {
    "content-type": "application/x-amz-json-1.0",
    host,
    "x-amz-date": amzDate,
    "x-amz-target": `DynamoDB_20120810.${target}`,
  };

  if (sessionToken) {
    headerMap["x-amz-security-token"] = sessionToken;
  }

  const signedHeaderNames = Object.keys(headerMap).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headerMap[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const payloadHash = sha256Hex(body);

  const canonicalRequest = [
    method,
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${AWS_REGION}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, AWS_REGION, service);
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const requestHeaders = {
    "Content-Type": "application/x-amz-json-1.0",
    "X-Amz-Date": amzDate,
    "X-Amz-Target": `DynamoDB_20120810.${target}`,
    Authorization: authorizationHeader,
  };

  if (sessionToken) {
    requestHeaders["X-Amz-Security-Token"] = sessionToken;
  }

  const response = await fetch(endpoint, {
    method,
    headers: requestHeaders,
    body,
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { message: text };
  }

  if (!response.ok) {
    const rawType = parsed?.__type || parsed?.code || "DynamoDBError";
    const typeParts = String(rawType).split("#");
    const errorName = typeParts[typeParts.length - 1] || "DynamoDBError";
    const err = new Error(parsed?.message || `DynamoDB ${target} failed with status ${response.status}.`);
    err.name = errorName;
    err.statusCode = response.status;
    throw err;
  }

  return parsed;
}

async function dynamoPutReview(item) {
  return dynamoRequest("PutItem", {
    TableName: REVIEWS_TABLE_NAME,
    Item: marshallItem(item),
    ConditionExpression: "attribute_not_exists(review_id)",
  });
}

async function dynamoQueryReviewsByStatus(status, limit) {
  const response = await dynamoRequest("Query", {
    TableName: REVIEWS_TABLE_NAME,
    IndexName: REVIEW_STATUS_INDEX_NAME,
    KeyConditionExpression: "#status = :status",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":status": { S: status },
    },
    ScanIndexForward: false,
    Limit: limit,
  });

  return (response.Items || []).map(unmarshallItem);
}

async function dynamoModerateReview(reviewId, decision, moderatedBy, moderationNote, updatedAt) {
  const response = await dynamoRequest("UpdateItem", {
    TableName: REVIEWS_TABLE_NAME,
    Key: {
      review_id: { S: reviewId },
    },
    ConditionExpression: "attribute_exists(review_id)",
    UpdateExpression: "SET #status = :status, updated_at = :updated_at, moderated_at = :moderated_at, moderated_by = :moderated_by, moderation_note = :moderation_note",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: marshallExpressionValues({
      ":status": decision,
      ":updated_at": updatedAt,
      ":moderated_at": updatedAt,
      ":moderated_by": moderatedBy,
      ":moderation_note": moderationNote,
    }),
    ReturnValues: "ALL_NEW",
  });

  return unmarshallItem(response.Attributes || {});
}

async function sendContactEmail({ input, origin, sourceIp, userAgent, requestId }) {
  const name = sanitise(input.name);
  const email = input.email;
  const company = sanitise(input.company || "Not provided");
  const phone = sanitise(input.phone || "Not provided");
  const message = sanitise(input.message);
  const emailDisplay = sanitise(email);
  const timestamp = new Date().toISOString();
  const subject = `WaterApps Enquiry: ${name}${company !== "Not provided" ? ` - ${company}` : ""}`;

  const textBody = `
New enquiry from waterapps.com.au

Name:     ${name}
Email:    ${emailDisplay}
Company:  ${company}
Phone:    ${phone}
Time:     ${timestamp}

Message:
${message}

Request Metadata:
Origin:   ${origin || "Not provided"}
IP:       ${sourceIp}
UA:       ${userAgent || "Not provided"}
Request:  ${requestId}

---
Reply directly to this email to respond to ${name}.
  `.trim();

  const htmlBody = `
<h2>New enquiry from waterapps.com.au</h2>
<table cellpadding="4" cellspacing="0" border="0">
  <tr><td><strong>Name</strong></td><td>${name}</td></tr>
  <tr><td><strong>Email</strong></td><td>${emailDisplay}</td></tr>
  <tr><td><strong>Company</strong></td><td>${company}</td></tr>
  <tr><td><strong>Phone</strong></td><td>${phone}</td></tr>
  <tr><td><strong>Time</strong></td><td>${timestamp}</td></tr>
  <tr><td><strong>Origin</strong></td><td>${sanitise(origin || "Not provided")}</td></tr>
  <tr><td><strong>IP</strong></td><td>${sanitise(sourceIp)}</td></tr>
  <tr><td><strong>Request ID</strong></td><td>${sanitise(requestId)}</td></tr>
</table>
<h3>Message</h3>
<pre style="white-space: pre-wrap; font-family: sans-serif;">${message}</pre>
<p>Reply directly to this email to respond to ${name}.</p>
  `.trim();

  await ses.send(
    new SendEmailCommand({
      Source: process.env.SOURCE_EMAIL,
      Destination: {
        ToAddresses: [process.env.TARGET_EMAIL],
      },
      ReplyToAddresses: [email],
      Message: {
        Subject: {
          Data: subject,
        },
        Body: {
          Text: { Data: textBody },
          Html: { Data: htmlBody },
        },
      },
    })
  );
}

async function sendReviewNotificationEmail({ item, requestId, origin, sourceIp, userAgent }) {
  const reviewerName = sanitise(item.name);
  const reviewerEmail = sanitise(item.email);
  const reviewerRole = sanitise(item.role || "Not provided");
  const reviewerCompany = sanitise(item.company || "Not provided");
  const reviewerLinkedIn = sanitise(item.linkedin);
  const rating = sanitise(item.rating || "Not provided");
  const reviewText = sanitise(item.review);

  const subject = `WaterApps Review Submission: ${reviewerName}`;
  const textBody = `
New independent review submission from waterapps.com.au

Review ID: ${item.review_id}
Status:    ${item.status}
Time:      ${item.created_at}

Reviewer:
Name:      ${reviewerName}
Email:     ${reviewerEmail}
Role:      ${reviewerRole}
Company:   ${reviewerCompany}
LinkedIn:  ${reviewerLinkedIn}
Rating:    ${rating}

Review:
${reviewText}

Request Metadata:
Origin:   ${origin || "Not provided"}
IP:       ${sourceIp}
UA:       ${userAgent || "Not provided"}
Request:  ${requestId}

Moderate via dashboard/admin API when verified.
  `.trim();

  const htmlBody = `
<h2>New independent review submission</h2>
<table cellpadding="4" cellspacing="0" border="0">
  <tr><td><strong>Review ID</strong></td><td>${sanitise(item.review_id)}</td></tr>
  <tr><td><strong>Status</strong></td><td>${sanitise(item.status)}</td></tr>
  <tr><td><strong>Time</strong></td><td>${sanitise(item.created_at)}</td></tr>
  <tr><td><strong>Name</strong></td><td>${reviewerName}</td></tr>
  <tr><td><strong>Email</strong></td><td>${reviewerEmail}</td></tr>
  <tr><td><strong>Role</strong></td><td>${reviewerRole}</td></tr>
  <tr><td><strong>Company</strong></td><td>${reviewerCompany}</td></tr>
  <tr><td><strong>LinkedIn</strong></td><td>${reviewerLinkedIn}</td></tr>
  <tr><td><strong>Rating</strong></td><td>${rating}</td></tr>
  <tr><td><strong>Origin</strong></td><td>${sanitise(origin || "Not provided")}</td></tr>
  <tr><td><strong>IP</strong></td><td>${sanitise(sourceIp)}</td></tr>
  <tr><td><strong>Request ID</strong></td><td>${sanitise(requestId)}</td></tr>
</table>
<h3>Review</h3>
<pre style="white-space: pre-wrap; font-family: sans-serif;">${reviewText}</pre>
  `.trim();

  await ses.send(
    new SendEmailCommand({
      Source: process.env.SOURCE_EMAIL,
      Destination: {
        ToAddresses: [process.env.TARGET_EMAIL],
      },
      ReplyToAddresses: [item.email],
      Message: {
        Subject: {
          Data: subject,
        },
        Body: {
          Text: { Data: textBody },
          Html: { Data: htmlBody },
        },
      },
    })
  );
}

async function handleContact({ event, origin, requestId, sourceIp, userAgent, startedAt }) {
  const parsedBody = parseJsonBody(event, origin, requestId);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const input = normaliseContactInput(parsedBody.parsed);
  const fieldErrors = validateContact(input);
  if (Object.keys(fieldErrors).length > 0) {
    log("info", "Contact validation failed", { requestId, fieldErrors, origin });
    return jsonResponse(400, origin, {
      status: "error",
      code: "validation_failed",
      message: "Please correct the highlighted fields and try again.",
      fieldErrors,
      requestId,
    });
  }

  await sendContactEmail({ input, origin, sourceIp, userAgent, requestId });

  log("info", "Contact form submitted", {
    requestId,
    origin,
    durationMs: Date.now() - startedAt,
  });

  return jsonResponse(200, origin, {
    status: "success",
    message: "Thank you for contacting WaterApps. We'll be in touch within 24 hours.",
    requestId,
  });
}

async function handleReviewSubmit({ event, origin, requestId, sourceIp, userAgent, startedAt }) {
  if (!REVIEWS_TABLE_NAME) {
    return jsonResponse(503, origin, {
      status: "error",
      code: "reviews_not_configured",
      message: "Reviews service is not configured yet.",
      requestId,
    });
  }

  const parsedBody = parseJsonBody(event, origin, requestId);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const input = normaliseReviewInput(parsedBody.parsed);
  const fieldErrors = validateReview(input);
  if (Object.keys(fieldErrors).length > 0) {
    log("info", "Review validation failed", { requestId, fieldErrors, origin });
    return jsonResponse(400, origin, {
      status: "error",
      code: "validation_failed",
      message: "Please correct the highlighted fields and try again.",
      fieldErrors,
      requestId,
    });
  }

  const createdAt = new Date().toISOString();
  const reviewId = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(REVIEW_RETENTION_DAYS, 30) * 86400;

  const item = {
    review_id: reviewId,
    status: "pending",
    created_at: createdAt,
    updated_at: createdAt,
    name: input.name,
    email: input.email,
    role: input.role || "",
    company: input.company || "",
    linkedin: input.linkedin,
    review: input.review,
    rating: input.rating || "",
    consent: true,
    source_ip: sourceIp,
    user_agent: userAgent || "",
    origin: origin || "",
    request_id: requestId,
    expires_at: expiresAt,
  };

  await dynamoPutReview(item);
  await sendReviewNotificationEmail({ item, requestId, origin, sourceIp, userAgent });

  log("info", "Review submission accepted", {
    requestId,
    origin,
    reviewId,
    durationMs: Date.now() - startedAt,
  });

  return jsonResponse(200, origin, {
    status: "success",
    message: "Thank you. Your review has been submitted for verification.",
    reviewId,
    requestId,
  });
}

async function handleReviewList({ event, origin, requestId }) {
  if (!REVIEWS_TABLE_NAME) {
    return jsonResponse(503, origin, {
      status: "error",
      code: "reviews_not_configured",
      message: "Reviews service is not configured yet.",
      requestId,
    });
  }

  const statusFilter = (event.queryStringParameters?.status || "pending").toLowerCase();
  const limitRaw = Number(event.queryStringParameters?.limit || "25");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 25;

  if (!VALID_REVIEW_STATUSES.includes(statusFilter)) {
    return jsonResponse(400, origin, {
      status: "error",
      code: "invalid_status",
      message: "status must be one of pending, approved, rejected.",
      requestId,
    });
  }

  const reviews = await dynamoQueryReviewsByStatus(statusFilter, limit);

  return jsonResponse(200, origin, {
    status: "success",
    filter: statusFilter,
    count: reviews.length,
    reviews: reviews.map((item) => ({
      review_id: item.review_id,
      status: item.status,
      created_at: item.created_at,
      updated_at: item.updated_at,
      moderated_at: item.moderated_at || null,
      moderated_by: item.moderated_by || null,
      moderation_note: item.moderation_note || "",
      name: item.name,
      email: item.email,
      role: item.role,
      company: item.company,
      linkedin: item.linkedin,
      review: item.review,
      rating: item.rating,
      origin: item.origin,
      request_id: item.request_id,
    })),
    requestId,
  });
}

async function handleReviewModeration({ event, origin, requestId }) {
  if (!REVIEWS_TABLE_NAME) {
    return jsonResponse(503, origin, {
      status: "error",
      code: "reviews_not_configured",
      message: "Reviews service is not configured yet.",
      requestId,
    });
  }

  const reviewId = event.pathParameters?.reviewId;
  if (!reviewId || typeof reviewId !== "string") {
    return jsonResponse(400, origin, {
      status: "error",
      code: "invalid_review_id",
      message: "reviewId path parameter is required.",
      requestId,
    });
  }

  const parsedBody = parseJsonBody(event, origin, requestId);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const decision = String(parsedBody.parsed.decision || "").toLowerCase().trim();
  const moderationNote = cleanText(parsedBody.parsed.note) || "";

  if (!(decision === "approved" || decision === "rejected")) {
    return jsonResponse(400, origin, {
      status: "error",
      code: "invalid_decision",
      message: "decision must be either approved or rejected.",
      requestId,
    });
  }

  if (typeof moderationNote !== "string") {
    return jsonResponse(400, origin, {
      status: "error",
      code: "invalid_note",
      message: "note must be text if provided.",
      requestId,
    });
  }

  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  const moderatedBy = String(claims.email || claims["cognito:username"] || claims.sub || "admin");
  const updatedAt = new Date().toISOString();

  try {
    const item = await dynamoModerateReview(reviewId, decision, moderatedBy, moderationNote, updatedAt);

    return jsonResponse(200, origin, {
      status: "success",
      message: `Review ${decision}.`,
      review: {
        review_id: item.review_id || reviewId,
        status: item.status || decision,
        moderated_at: item.moderated_at || updatedAt,
        moderated_by: item.moderated_by || moderatedBy,
        moderation_note: item.moderation_note || moderationNote,
      },
      requestId,
    });
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      return jsonResponse(404, origin, {
        status: "error",
        code: "review_not_found",
        message: "Review does not exist.",
        requestId,
      });
    }
    throw err;
  }
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "UNKNOWN";
  const path = event.requestContext?.http?.path || event.rawPath || "/";
  const routeKey = getRouteKey(event, method, path);
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const requestId = event.requestContext?.requestId || "unknown";
  const sourceIp = event.requestContext?.http?.sourceIp || event.requestContext?.identity?.sourceIp || "unknown";
  const userAgent = event.headers?.["user-agent"] || event.headers?.["User-Agent"] || "";
  const startedAt = Date.now();

  if (method === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin) };
  }

  if (routeKey === "GET /health") {
    return jsonResponse(200, origin, {
      status: "ok",
      service: "waterapps-contact-form",
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  try {
    if (!origin) {
      log("warn", "Rejected request without origin", { requestId, routeKey });
      return jsonResponse(403, origin, {
        status: "error",
        code: "origin_required",
        message: "Origin header is required.",
        requestId,
      });
    }

    if (!isAllowedOrigin(origin)) {
      log("warn", "Rejected disallowed origin", { requestId, origin, sourceIp, routeKey });
      return jsonResponse(403, origin, {
        status: "error",
        code: "origin_not_allowed",
        message: "Origin not allowed.",
        requestId,
      });
    }

    if (routeKey === "POST /contact") {
      return await handleContact({ event, origin, requestId, sourceIp, userAgent, startedAt });
    }

    if (routeKey === "POST /reviews") {
      return await handleReviewSubmit({ event, origin, requestId, sourceIp, userAgent, startedAt });
    }

    if (routeKey === "GET /reviews") {
      return await handleReviewList({ event, origin, requestId });
    }

    if (routeKey === "POST /reviews/{reviewId}/moderate") {
      return await handleReviewModeration({ event, origin, requestId });
    }

    return jsonResponse(404, origin, {
      status: "error",
      code: "route_not_found",
      message: "Route not found.",
      requestId,
    });
  } catch (err) {
    log("error", "Request handling error", {
      requestId,
      routeKey,
      origin,
      errorName: err?.name,
      errorMessage: err?.message,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(500, origin, {
      status: "error",
      code: "internal_error",
      message: "Something went wrong. Please email hello@waterapps.com.au directly.",
      requestId,
    });
  }
};
