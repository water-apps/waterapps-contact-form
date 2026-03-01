/**
 * WaterApps contact + booking API
 *
 * Endpoints:
 * - GET  /health
 * - POST /contact
 * - GET  /availability
 * - POST /booking
 */

import { randomUUID } from "node:crypto";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({});

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || "16384");
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const BOOKING_TYPE = process.env.BOOKING_TYPE || "DISCOVERY_30M";
const BOOKING_SLOT_DURATION_MINUTES = Number(
  process.env.BOOKING_SLOT_DURATION_MINUTES || "30"
);
const BOOKING_LOOKAHEAD_DAYS = Number(process.env.BOOKING_LOOKAHEAD_DAYS || "14");
const BOOKING_MIN_LEAD_MINUTES = Number(
  process.env.BOOKING_MIN_LEAD_MINUTES || "120"
);
const BOOKING_START_HOUR_UTC = Number(process.env.BOOKING_START_HOUR_UTC || "0");
const BOOKING_END_HOUR_UTC = Number(process.env.BOOKING_END_HOUR_UTC || "8");
const BOOKING_WORKDAYS_UTC = (process.env.BOOKING_WORKDAYS_UTC || "1,2,3,4,5")
  .split(",")
  .map((day) => Number(day.trim()))
  .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
const BOOKING_MAX_NOTES_CHARS = 1500;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s()+\-./]{6,30}$/;
const DATE_ONLY_UTC_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function parseJsonBody(event, origin, requestId) {
  const bodyText = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    return {
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
      response: jsonResponse(400, origin, {
        status: "error",
        code: "invalid_payload",
        message: "Request body must be a JSON object.",
        requestId,
      }),
    };
  }

  return { parsed };
}

function normaliseContactInput(body) {
  return {
    name: typeof body.name === "string" ? body.name.trim() : body.name,
    email:
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : body.email,
    company:
      typeof body.company === "string" ? body.company.trim() : body.company ?? "",
    phone: typeof body.phone === "string" ? body.phone.trim() : body.phone ?? "",
    message: typeof body.message === "string" ? body.message.trim() : body.message,
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

function parseDateOnlyUtc(dateStr) {
  if (!DATE_ONLY_UTC_RE.test(dateStr || "")) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function toIsoUtc(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function generateCandidateSlots({ startDateUtc, days, now }) {
  const slots = [];
  const nowMs = now.getTime();
  const minLeadMs = BOOKING_MIN_LEAD_MINUTES * 60 * 1000;
  const slotMs = BOOKING_SLOT_DURATION_MINUTES * 60 * 1000;

  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(startDateUtc.getTime() + offset * 24 * 60 * 60 * 1000);
    if (!BOOKING_WORKDAYS_UTC.includes(day.getUTCDay())) continue;

    const year = day.getUTCFullYear();
    const month = day.getUTCMonth();
    const dayOfMonth = day.getUTCDate();
    const startMinutes = BOOKING_START_HOUR_UTC * 60;
    const endMinutes = BOOKING_END_HOUR_UTC * 60;

    for (
      let minutes = startMinutes;
      minutes + BOOKING_SLOT_DURATION_MINUTES <= endMinutes;
      minutes += BOOKING_SLOT_DURATION_MINUTES
    ) {
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      const startTime = new Date(
        Date.UTC(year, month, dayOfMonth, hour, minute, 0, 0)
      );
      const startMs = startTime.getTime();
      if (startMs < nowMs + minLeadMs) continue;

      const endTime = new Date(startMs + slotMs);
      slots.push({
        slotStart: toIsoUtc(startTime),
        slotEnd: toIsoUtc(endTime),
      });
    }
  }
  return slots;
}

function normaliseBookingInput(body) {
  return {
    name: typeof body.name === "string" ? body.name.trim() : body.name,
    email:
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : body.email,
    company:
      typeof body.company === "string" ? body.company.trim() : body.company ?? "",
    notes: typeof body.notes === "string" ? body.notes.trim() : body.notes ?? "",
    timezone:
      typeof body.timezone === "string" ? body.timezone.trim() : body.timezone ?? "",
    slotStart:
      typeof body.slotStart === "string" ? body.slotStart.trim() : body.slotStart,
  };
}

function validateBookingInput(input, now) {
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
  } else if (input.company.length > 120) {
    fieldErrors.company = "Company must be 120 characters or less.";
  }

  if (typeof input.notes !== "string") {
    fieldErrors.notes = "Notes must be text.";
  } else if (input.notes.length > BOOKING_MAX_NOTES_CHARS) {
    fieldErrors.notes = `Notes must be ${BOOKING_MAX_NOTES_CHARS} characters or less.`;
  }

  if (typeof input.slotStart !== "string" || input.slotStart.length < 16) {
    fieldErrors.slotStart = "A slot is required.";
    return fieldErrors;
  }

  const slotDate = new Date(input.slotStart);
  if (Number.isNaN(slotDate.getTime()) || !input.slotStart.endsWith("Z")) {
    fieldErrors.slotStart = "Slot must be a valid UTC ISO timestamp.";
    return fieldErrors;
  }

  const slotStartMs = slotDate.getTime();
  const slotEndMs = slotStartMs + BOOKING_SLOT_DURATION_MINUTES * 60 * 1000;
  const minLeadMs = BOOKING_MIN_LEAD_MINUTES * 60 * 1000;
  const maxLookaheadMs = BOOKING_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;

  if (slotStartMs < now.getTime() + minLeadMs) {
    fieldErrors.slotStart = "Selected slot is no longer available.";
  } else if (slotStartMs > now.getTime() + maxLookaheadMs) {
    fieldErrors.slotStart = "Selected slot is outside the booking window.";
  }

  if (!BOOKING_WORKDAYS_UTC.includes(slotDate.getUTCDay())) {
    fieldErrors.slotStart = "Selected slot is outside available booking days.";
  }

  const startMinutes =
    slotDate.getUTCHours() * 60 + slotDate.getUTCMinutes();
  const endMinutes = startMinutes + BOOKING_SLOT_DURATION_MINUTES;
  const windowStartMinutes = BOOKING_START_HOUR_UTC * 60;
  const windowEndMinutes = BOOKING_END_HOUR_UTC * 60;

  if (
    startMinutes < windowStartMinutes ||
    endMinutes > windowEndMinutes ||
    startMinutes % BOOKING_SLOT_DURATION_MINUTES !== 0
  ) {
    fieldErrors.slotStart = "Selected slot is outside configured booking hours.";
  }

  return fieldErrors;
}

async function sendContactEmail({
  name,
  email,
  company,
  phone,
  message,
  origin,
  sourceIp,
  userAgent,
  requestId,
}) {
  const safeName = sanitise(name);
  const safeCompany = sanitise(company || "Not provided");
  const safePhone = sanitise(phone || "Not provided");
  const safeMessage = sanitise(message);
  const safeEmail = sanitise(email);
  const timestamp = new Date().toISOString();
  const subject = `WaterApps Enquiry: ${safeName}${
    safeCompany !== "Not provided" ? ` - ${safeCompany}` : ""
  }`;

  const textBody = `
New enquiry from waterapps.com.au

Name:     ${safeName}
Email:    ${safeEmail}
Company:  ${safeCompany}
Phone:    ${safePhone}
Time:     ${timestamp}

Message:
${safeMessage}

Request Metadata:
Origin:   ${origin || "Not provided"}
IP:       ${sourceIp}
UA:       ${userAgent || "Not provided"}
Request:  ${requestId}

---
Reply directly to this email to respond to ${safeName}.
  `.trim();

  const htmlBody = `
<h2>New enquiry from waterapps.com.au</h2>
<table cellpadding="4" cellspacing="0" border="0">
  <tr><td><strong>Name</strong></td><td>${safeName}</td></tr>
  <tr><td><strong>Email</strong></td><td>${safeEmail}</td></tr>
  <tr><td><strong>Company</strong></td><td>${safeCompany}</td></tr>
  <tr><td><strong>Phone</strong></td><td>${safePhone}</td></tr>
  <tr><td><strong>Time</strong></td><td>${timestamp}</td></tr>
  <tr><td><strong>Origin</strong></td><td>${sanitise(origin || "Not provided")}</td></tr>
  <tr><td><strong>IP</strong></td><td>${sanitise(sourceIp)}</td></tr>
  <tr><td><strong>Request ID</strong></td><td>${sanitise(requestId)}</td></tr>
</table>
<h3>Message</h3>
<pre style="white-space: pre-wrap; font-family: sans-serif;">${safeMessage}</pre>
<p>Reply directly to this email to respond to ${safeName}.</p>
  `.trim();

  await ses.send(
    new SendEmailCommand({
      Source: process.env.SOURCE_EMAIL,
      Destination: {
        ToAddresses: [process.env.TARGET_EMAIL],
      },
      ReplyToAddresses: [email],
      Message: {
        Subject: { Data: subject },
        Body: {
          Text: { Data: textBody },
          Html: { Data: htmlBody },
        },
      },
    })
  );
}

async function sendBookingEmail({
  name,
  email,
  company,
  notes,
  timezone,
  slotStart,
  slotEnd,
  bookingId,
}) {
  const safeName = sanitise(name);
  const safeCompany = sanitise(company || "Not provided");
  const safeNotes = sanitise(notes || "Not provided");
  const safeEmail = sanitise(email);
  const safeTimezone = sanitise(timezone || "Not provided");
  const subject = `WaterApps Booking: ${safeName} at ${slotStart}`;

  const textBody = `
New discovery-call booking from waterapps.com.au

Booking ID: ${bookingId}
Name:       ${safeName}
Email:      ${safeEmail}
Company:    ${safeCompany}
Timezone:   ${safeTimezone}
Slot UTC:   ${slotStart} to ${slotEnd}
Notes:      ${safeNotes}
  `.trim();

  const htmlBody = `
<h2>New discovery-call booking</h2>
<table cellpadding="4" cellspacing="0" border="0">
  <tr><td><strong>Booking ID</strong></td><td>${sanitise(bookingId)}</td></tr>
  <tr><td><strong>Name</strong></td><td>${safeName}</td></tr>
  <tr><td><strong>Email</strong></td><td>${safeEmail}</td></tr>
  <tr><td><strong>Company</strong></td><td>${safeCompany}</td></tr>
  <tr><td><strong>Timezone</strong></td><td>${safeTimezone}</td></tr>
  <tr><td><strong>Slot (UTC)</strong></td><td>${sanitise(slotStart)} to ${sanitise(slotEnd)}</td></tr>
</table>
<h3>Notes</h3>
<pre style="white-space: pre-wrap; font-family: sans-serif;">${safeNotes}</pre>
  `.trim();

  await ses.send(
    new SendEmailCommand({
      Source: process.env.SOURCE_EMAIL,
      Destination: {
        ToAddresses: [process.env.TARGET_EMAIL],
      },
      ReplyToAddresses: [email],
      Message: {
        Subject: { Data: subject },
        Body: {
          Text: { Data: textBody },
          Html: { Data: htmlBody },
        },
      },
    })
  );
}

function withOriginGuard(origin, requestId, sourceIp) {
  if (!origin) {
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
  return null;
}

async function handleContact({
  event,
  origin,
  requestId,
  sourceIp,
  userAgent,
  startedAt,
}) {
  const guardResponse = withOriginGuard(origin, requestId, sourceIp);
  if (guardResponse) return guardResponse;

  const { parsed, response } = parseJsonBody(event, origin, requestId);
  if (response) return response;

  const input = normaliseContactInput(parsed);
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

  try {
    await sendContactEmail({
      name: input.name,
      email: input.email,
      company: input.company,
      phone: input.phone,
      message: input.message,
      origin,
      sourceIp,
      userAgent,
      requestId,
    });

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
      message: "Something went wrong. Please email varun@waterapps.com.au directly.",
      requestId,
    });
  }
}

async function handleAvailability({ event, origin, requestId, startedAt }) {
  const query = event.queryStringParameters || {};
  const daysRaw = Number(query.days || "7");
  const days = Number.isFinite(daysRaw)
    ? Math.max(1, Math.min(21, Math.floor(daysRaw)))
    : 7;

  let startDateUtc;
  if (query.date) {
    startDateUtc = parseDateOnlyUtc(String(query.date));
    if (!startDateUtc) {
      return jsonResponse(400, origin, {
        status: "error",
        code: "invalid_date",
        message: "date must be YYYY-MM-DD in UTC.",
        requestId,
      });
    }
  } else {
    const now = new Date();
    startDateUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
    );
  }

  const now = new Date();
  const availableSlots = generateCandidateSlots({ startDateUtc, days, now });

  log("info", "Availability fetched", {
    requestId,
    requestedDays: days,
    slotCount: availableSlots.length,
    durationMs: Date.now() - startedAt,
  });

  return jsonResponse(200, origin, {
    status: "success",
    requestId,
    slotDurationMinutes: BOOKING_SLOT_DURATION_MINUTES,
    timezone: "UTC",
    slots: availableSlots,
  });
}

async function handleBooking({
  event,
  origin,
  requestId,
  sourceIp,
  startedAt,
}) {
  const guardResponse = withOriginGuard(origin, requestId, sourceIp);
  if (guardResponse) return guardResponse;

  const { parsed, response } = parseJsonBody(event, origin, requestId);
  if (response) return response;

  const input = normaliseBookingInput(parsed);
  const now = new Date();
  const fieldErrors = validateBookingInput(input, now);
  if (Object.keys(fieldErrors).length > 0) {
    return jsonResponse(400, origin, {
      status: "error",
      code: "validation_failed",
      message: "Please correct the highlighted booking fields and try again.",
      fieldErrors,
      requestId,
    });
  }

  const slotStartDate = new Date(input.slotStart);
  const slotStart = toIsoUtc(slotStartDate);
  const slotEnd = toIsoUtc(
    new Date(slotStartDate.getTime() + BOOKING_SLOT_DURATION_MINUTES * 60 * 1000)
  );
  const bookingId = randomUUID();

  let notificationSent = true;
  try {
    await sendBookingEmail({
      name: input.name,
      email: input.email,
      company: input.company,
      notes: input.notes,
      timezone: input.timezone,
      slotStart,
      slotEnd,
      bookingId,
    });
  } catch (err) {
    notificationSent = false;
    log("error", "Booking notification email failed", {
      requestId,
      bookingId,
      errorName: err?.name,
      errorMessage: err?.message,
    });
  }

  log("info", "Booking confirmed", {
    requestId,
    bookingId,
    slotStart,
    bookingType: BOOKING_TYPE,
    notificationSent,
    durationMs: Date.now() - startedAt,
  });

  return jsonResponse(200, origin, {
    status: "success",
    message:
      "Your discovery call request has been received. We will confirm your slot by email shortly.",
    bookingId,
    slotStart,
    slotEnd,
    notificationSent,
    requestId,
  });
}

function pathForEvent(event) {
  return (
    event.requestContext?.http?.path ||
    event.rawPath ||
    event.path ||
    ""
  );
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "UNKNOWN";
  const path = pathForEvent(event);
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const requestId = event.requestContext?.requestId || "unknown";
  const sourceIp =
    event.requestContext?.http?.sourceIp ||
    event.requestContext?.identity?.sourceIp ||
    "unknown";
  const userAgent = event.headers?.["user-agent"] || event.headers?.["User-Agent"] || "";
  const startedAt = Date.now();

  if (method === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin) };
  }

  if (method === "GET" && path === "/health") {
    return jsonResponse(200, origin, {
      status: "ok",
      service: "waterapps-contact-form",
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  if (method === "GET" && path === "/availability") {
    try {
      return await handleAvailability({ event, origin, requestId, startedAt });
    } catch (err) {
      log("error", "Availability error", {
        requestId,
        errorName: err?.name,
        errorMessage: err?.message,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse(500, origin, {
        status: "error",
        code: "internal_error",
        message: "Unable to fetch availability right now.",
        requestId,
      });
    }
  }

  if (method === "POST" && path === "/contact") {
    return handleContact({
      event,
      origin,
      requestId,
      sourceIp,
      userAgent,
      startedAt,
    });
  }

  if (method === "POST" && path === "/booking") {
    return handleBooking({ event, origin, requestId, sourceIp, startedAt });
  }

  const knownPaths = new Set(["/contact", "/booking", "/availability", "/health"]);
  if (knownPaths.has(path)) {
    return jsonResponse(405, origin, {
      status: "error",
      code: "method_not_allowed",
      message: `Method ${method} is not supported for ${path}.`,
      requestId,
    });
  }

  return jsonResponse(404, origin, {
    status: "error",
    code: "not_found",
    message: "Endpoint not found.",
    requestId,
  });
};
