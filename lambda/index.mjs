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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://www.waterapps.com.au",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Simple validation — no libraries needed
function validate(body) {
  const errors = [];

  if (!body.name || body.name.trim().length < 2) {
    errors.push("Name is required (min 2 characters)");
  }
  if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    errors.push("Valid email is required");
  }
  if (!body.message || body.message.trim().length < 10) {
    errors.push("Message is required (min 10 characters)");
  }

  // Basic anti-spam: reject if message contains excessive URLs
  const urlCount = (body.message || "").match(/https?:\/\//g)?.length || 0;
  if (urlCount > 3) {
    errors.push("Message contains too many links");
  }

  return errors;
}

function sanitise(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const errors = validate(body);

    if (errors.length > 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: "error", errors }),
      };
    }

    const name = sanitise(body.name.trim());
    const email = sanitise(body.email.trim().toLowerCase());
    const company = sanitise((body.company || "Not provided").trim());
    const phone = sanitise((body.phone || "Not provided").trim());
    const message = sanitise(body.message.trim());
    const timestamp = new Date().toISOString();

    const emailBody = `
New enquiry from waterapps.com.au

Name:     ${name}
Email:    ${email}
Company:  ${company}
Phone:    ${phone}
Time:     ${timestamp}

Message:
${message}

---
Reply directly to this email to respond to ${name}.
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
            Data: `WaterApps Enquiry: ${name}${company !== "Not provided" ? ` — ${company}` : ""}`,
          },
          Body: {
            Text: { Data: emailBody },
          },
        },
      })
    );

    console.log(
      JSON.stringify({
        event: "contact_form_submission",
        name,
        email,
        company,
        timestamp,
      })
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "success",
        message:
          "Thank you for contacting WaterApps. We'll be in touch within 24 hours.",
      }),
    };
  } catch (err) {
    console.error("Contact form error:", err);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        message: "Something went wrong. Please email hello@waterapps.com.au directly.",
      }),
    };
  }
};
