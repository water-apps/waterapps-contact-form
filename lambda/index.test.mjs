import test from "node:test";
import assert from "node:assert/strict";
import { SESClient } from "@aws-sdk/client-ses";

process.env.ALLOWED_ORIGINS = "https://www.waterapps.com.au";
process.env.MAX_BODY_BYTES = "16384";
process.env.LOG_LEVEL = "error";
process.env.SOURCE_EMAIL = "hello@waterapps.com.au";
process.env.TARGET_EMAIL = "hello@waterapps.com.au";

let sendCalls = 0;
const originalSend = SESClient.prototype.send;
SESClient.prototype.send = async function sendStub() {
  sendCalls += 1;
  return { MessageId: "test-message-id" };
};

const { handler } = await import("./index.mjs");

test.after(() => {
  SESClient.prototype.send = originalSend;
});

function makeEvent({ method = "POST", path = "/contact", body, origin, isBase64Encoded = false } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;

  return {
    headers,
    body,
    isBase64Encoded,
    requestContext: {
      requestId: "req-test-123",
      http: {
        method,
        path,
        sourceIp: "127.0.0.1",
      },
    },
  };
}

function parseResponse(response) {
  return {
    ...response,
    json: response.body ? JSON.parse(response.body) : null,
  };
}

test("rejects non-object JSON payloads with invalid_payload", async () => {
  const res = parseResponse(
    await handler(
      makeEvent({
        origin: "https://www.waterapps.com.au",
        body: JSON.stringify(["not", "an", "object"]),
      })
    )
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.json.code, "invalid_payload");
});

test("returns validation error (not 500) for non-string fields", async () => {
  const before = sendCalls;
  const res = parseResponse(
    await handler(
      makeEvent({
        origin: "https://www.waterapps.com.au",
        body: JSON.stringify({
          name: 123,
          email: "valid@example.com",
          company: 99,
          phone: { nested: true },
          message: "This is a valid length message.",
        }),
      })
    )
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.json.code, "validation_failed");
  assert.equal(res.json.fieldErrors.name, "Name is required (min 2 characters).");
  assert.equal(res.json.fieldErrors.company, "Company must be text.");
  assert.equal(res.json.fieldErrors.phone, "Phone must be text.");
  assert.equal(sendCalls, before);
});

test("rejects oversized message instead of silently truncating", async () => {
  const before = sendCalls;
  const res = parseResponse(
    await handler(
      makeEvent({
        origin: "https://www.waterapps.com.au",
        body: JSON.stringify({
          name: "Jane Tester",
          email: "jane@example.com",
          company: "Acme",
          phone: "+61 400 000 000",
          message: "a".repeat(4001),
        }),
      })
    )
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.json.code, "validation_failed");
  assert.equal(res.json.fieldErrors.message, "Message must be 4000 characters or less.");
  assert.equal(sendCalls, before);
});

test("rejects oversized company instead of silently truncating", async () => {
  const before = sendCalls;
  const res = parseResponse(
    await handler(
      makeEvent({
        origin: "https://www.waterapps.com.au",
        body: JSON.stringify({
          name: "Jane Tester",
          email: "jane@example.com",
          company: "c".repeat(121),
          phone: "+61 400 000 000",
          message: "Valid message body for tester flow.",
        }),
      })
    )
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.json.code, "validation_failed");
  assert.equal(res.json.fieldErrors.company, "Company must be 120 characters or less.");
  assert.equal(sendCalls, before);
});

test("accepts valid payload and attempts SES send", async () => {
  const before = sendCalls;
  const res = parseResponse(
    await handler(
      makeEvent({
        origin: "https://www.waterapps.com.au",
        body: JSON.stringify({
          name: "Jane Tester",
          email: "jane@example.com",
          company: "Acme",
          phone: "+61 400 000 000",
          message: "I would like to discuss a platform engagement.",
        }),
      })
    )
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, "success");
  assert.equal(sendCalls, before + 1);
});
