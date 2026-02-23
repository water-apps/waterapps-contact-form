/**
 * WaterApps Contact Form Handler
 *
 * Receives POST requests from waterapps.com.au contact form,
 * validates input, and sends notification via AWS SES.
 *
 * Environment variables:
 *   SOURCE_EMAIL  — verified SES sender (hello@waterapps.com.au)
 *   TARGET_EMAIL  — receives submissions (hello@waterapps.com.au)
 */

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({});
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || "16384");
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s()+\-./]{6,30}$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(origin) {
  const allowOrigin = isAllowedOrigin(origin)
    ? origin
    : (ALLOWED_ORIGINS[0] || "https://www.waterapps.com.au");
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

function sanitise(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normaliseInput(body) {
  return {
    name: typeof body.name === "string" ? body.name.trim() : body.name,
    email:
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : body.email,
    company:
      typeof body.company === "string"
        ? body.company.trim()
        : (body.company ?? ""),
    phone:
      typeof body.phone === "string"
        ? body.phone.trim()
        : (body.phone ?? ""),
    message: typeof body.message === "string" ? body.message.trim() : body.message,
  };
}

function validate(input) {
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
  console[level === "debug" ? "log" : level](
    JSON.stringify({ level, message, ...data })
  );
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "UNKNOWN";
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const requestId = event.requestContext?.requestId || event.requestContext?.requestId || "unknown";
  const sourceIp = event.requestContext?.http?.sourceIp || event.requestContext?.identity?.sourceIp || "unknown";
  const userAgent = event.headers?.["user-agent"] || event.headers?.["User-Agent"] || "";
  const startedAt = Date.now();

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin) };
  }

  if (method === "GET" && event.requestContext?.http?.path === "/health") {
    return jsonResponse(200, origin, {
      status: "ok",
      service: "waterapps-contact-form",
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  if (method !== "POST") {
    return jsonResponse(405, origin, {
      status: "error",
      code: "method_not_allowed",
      message: "Only POST is supported for this endpoint.",
      requestId,
    });
  }

  try {
    if (!origin) {
      log("warn", "Rejected request without origin", { requestId });
      return jsonResponse(403, origin, {
        status: "error",
        code: "origin_required",
        message: "Origin header is required.",
        requestId,
      });
    }

    if (!isAllowedOrigin(origin)) {
      log("warn", "Rejected disallowed origin", { requestId, origin, sourceIp });
      return jsonResponse(403, origin, {
        status: "error",
        code: "origin_not_allowed",
        message: "Origin not allowed.",
        requestId,
      });
    }

    const bodyText = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");

    if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
      return jsonResponse(413, origin, {
        status: "error",
        code: "payload_too_large",
        message: "Request body is too large.",
        requestId,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(bodyText || "{}");
    } catch {
      return jsonResponse(400, origin, {
        status: "error",
        code: "invalid_json",
        message: "Request body must be valid JSON.",
        requestId,
      });
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse(400, origin, {
        status: "error",
        code: "invalid_payload",
        message: "Request body must be a JSON object.",
        requestId,
      });
    }

    const input = normaliseInput(parsed);
    const fieldErrors = validate(input);
    if (Object.keys(fieldErrors).length > 0) {
      log("info", "Validation failed", { requestId, fieldErrors, origin });
      return jsonResponse(400, origin, {
        status: "error",
        code: "validation_failed",
        message: "Please correct the highlighted fields and try again.",
        fieldErrors,
        requestId,
      });
    }

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

    log("info", "Contact form submitted", {
      requestId,
      origin,
      timestamp,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(200, origin, {
        status: "success",
        message:
          "Thank you for contacting WaterApps. We'll be in touch within 24 hours.",
        requestId,
      });
  } catch (err) {
    log("error", "Contact form error", {
      requestId,
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
