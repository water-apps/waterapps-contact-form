import test from "node:test";
import assert from "node:assert/strict";
import { SESClient } from "@aws-sdk/client-ses";

process.env.ALLOWED_ORIGINS = "https://www.waterapps.com.au";
process.env.MAX_BODY_BYTES = "16384";
process.env.LOG_LEVEL = "error";
process.env.SOURCE_EMAIL = "hello@waterapps.com.au";
process.env.TARGET_EMAIL = "hello@waterapps.com.au";
process.env.REVIEWS_TABLE_NAME = "waterapps-test-reviews";
process.env.REVIEW_RETENTION_DAYS = "365";
process.env.AWS_REGION = "ap-southeast-2";
process.env.AWS_ACCESS_KEY_ID = "test-access-key";
process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
process.env.AWS_SESSION_TOKEN = "test-session-token";

let sesSendCalls = 0;
let ddbPutCalls = 0;
let ddbQueryCalls = 0;
let ddbUpdateCalls = 0;

const originalSesSend = SESClient.prototype.send;
const originalFetch = globalThis.fetch;

SESClient.prototype.send = async function sendSesStub() {
  sesSendCalls += 1;
  return { MessageId: "test-message-id" };
};

globalThis.fetch = async function fetchStub(_url, options = {}) {
  const target = options.headers && (options.headers["X-Amz-Target"] || options.headers["x-amz-target"]);

  if (target === "DynamoDB_20120810.PutItem") {
    ddbPutCalls += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({})
    };
  }

  if (target === "DynamoDB_20120810.Query") {
    ddbQueryCalls += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        Items: [
          {
            review_id: { S: "review-123" },
            status: { S: "pending" },
            created_at: { S: "2026-03-01T00:00:00.000Z" },
            updated_at: { S: "2026-03-01T00:00:00.000Z" },
            name: { S: "Jane Reviewer" },
            email: { S: "jane@example.com" },
            role: { S: "Engineering Manager" },
            company: { S: "Acme" },
            linkedin: { S: "https://www.linkedin.com/in/jane-reviewer" },
            review: { S: "Great delivery quality and transparent risk management." },
            rating: { S: "5" },
            origin: { S: "https://www.waterapps.com.au" },
            request_id: { S: "req-admin-list" }
          }
        ]
      })
    };
  }

  if (target === "DynamoDB_20120810.UpdateItem") {
    ddbUpdateCalls += 1;
    const body = JSON.parse(options.body || "{}");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        Attributes: {
          review_id: { S: body.Key.review_id.S },
          status: body.ExpressionAttributeValues[":status"],
          moderated_at: body.ExpressionAttributeValues[":moderated_at"],
          moderated_by: body.ExpressionAttributeValues[":moderated_by"],
          moderation_note: body.ExpressionAttributeValues[":moderation_note"]
        }
      })
    };
  }

  return {
    ok: false,
    status: 400,
    text: async () => JSON.stringify({
      __type: "ValidationException",
      message: "Unexpected DynamoDB test request"
    })
  };
};

const { handler } = await import("./index.mjs");

test.after(() => {
  SESClient.prototype.send = originalSesSend;
  globalThis.fetch = originalFetch;
});

function makeEvent({
  method = "POST",
  path = "/contact",
  routeKey,
  body,
  origin,
  isBase64Encoded = false,
  pathParameters,
  queryStringParameters,
  claims
} = {}) {
  const headers = {};
  if (origin) headers.origin = origin;

  return {
    headers,
    body,
    isBase64Encoded,
    pathParameters,
    queryStringParameters,
    requestContext: {
      requestId: "req-test-123",
      routeKey: routeKey || `${method} ${path}`,
      http: {
        method,
        path,
        sourceIp: "127.0.0.1"
      },
      authorizer: claims
        ? {
            jwt: {
              claims
            }
          }
        : undefined
    }
  };
}

function parseResponse(response) {
  return {
    ...response,
    json: response.body ? JSON.parse(response.body) : null
  };
}

test("rejects non-object JSON payloads with invalid_payload", async () => {
  const res = parseResponse(
    await handler(
      makeEvent({
        origin: "https://www.waterapps.com.au",
        body: JSON.stringify(["not", "an", "object"])
      })
    )
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.json.code, "invalid_payload");
});

test("returns validation error (not 500) for non-string contact fields", async () => {
  const before = sesSendCalls;
  const res = parseResponse(
    await handler(
      makeEvent({
        origin: "https://www.waterapps.com.au",
        body: JSON.stringify({
          name: 123,
          email: "valid@example.com",
          company: 99,
          phone: { nested: true },
          message: "This is a valid length message."
        })
      })
    )
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.json.code, "validation_failed");
  assert.equal(res.json.fieldErrors.name, "Name is required (min 2 characters).");
  assert.equal(res.json.fieldErrors.company, "Company must be text.");
  assert.equal(res.json.fieldErrors.phone, "Phone must be text.");
  assert.equal(sesSendCalls, before);
});

test("accepts valid contact payload and attempts SES send", async () => {
  const before = sesSendCalls;
  const res = parseResponse(
    await handler(
      makeEvent({
        method: "POST",
        path: "/contact",
        routeKey: "POST /contact",
        origin: "https://www.waterapps.com.au",
        body: JSON.stringify({
          name: "Jane Tester",
          email: "jane@example.com",
          company: "Acme",
          phone: "+61 400 000 000",
          message: "I would like to discuss a platform engagement."
        })
      })
    )
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, "success");
  assert.equal(sesSendCalls, before + 1);
});

test("rejects invalid linkedin URL for review submissions", async () => {
  const beforePut = ddbPutCalls;
  const res = parseResponse(
    await handler(
      makeEvent({
        method: "POST",
        path: "/reviews",
        routeKey: "POST /reviews",
        origin: "https://www.waterapps.com.au",
        body: JSON.stringify({
          name: "Jane Reviewer",
          email: "jane@example.com",
          role: "Manager",
          company: "Acme",
          linkedin: "https://example.com/jane",
          review: "This review has enough characters to pass basic length validation.",
          rating: "5",
          consent: true
        })
      })
    )
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.json.code, "validation_failed");
  assert.equal(res.json.fieldErrors.linkedin, "Please provide a valid HTTPS LinkedIn profile URL.");
  assert.equal(ddbPutCalls, beforePut);
});

test("accepts valid review submission and stores pending record", async () => {
  const beforePut = ddbPutCalls;
  const beforeSes = sesSendCalls;

  const res = parseResponse(
    await handler(
      makeEvent({
        method: "POST",
        path: "/reviews",
        routeKey: "POST /reviews",
        origin: "https://www.waterapps.com.au",
        body: JSON.stringify({
          name: "Jane Reviewer",
          email: "jane@example.com",
          role: "Engineering Manager",
          company: "Acme",
          linkedin: "https://www.linkedin.com/in/jane-reviewer",
          review: "Varun delivered clear architecture guidance and practical execution support with strong governance.",
          rating: "5",
          consent: true
        })
      })
    )
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, "success");
  assert.equal(typeof res.json.reviewId, "string");
  assert.equal(ddbPutCalls, beforePut + 1);
  assert.equal(sesSendCalls, beforeSes + 1);
});

test("lists pending reviews for admin endpoint", async () => {
  const beforeQuery = ddbQueryCalls;
  const res = parseResponse(
    await handler(
      makeEvent({
        method: "GET",
        path: "/reviews",
        routeKey: "GET /reviews",
        origin: "https://www.waterapps.com.au",
        queryStringParameters: {
          status: "pending",
          limit: "10"
        }
      })
    )
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, "success");
  assert.equal(res.json.filter, "pending");
  assert.equal(Array.isArray(res.json.reviews), true);
  assert.equal(res.json.reviews.length, 1);
  assert.equal(ddbQueryCalls, beforeQuery + 1);
});

test("rejects invalid moderation decision", async () => {
  const beforeUpdate = ddbUpdateCalls;
  const res = parseResponse(
    await handler(
      makeEvent({
        method: "POST",
        path: "/reviews/review-123/moderate",
        routeKey: "POST /reviews/{reviewId}/moderate",
        origin: "https://www.waterapps.com.au",
        pathParameters: { reviewId: "review-123" },
        body: JSON.stringify({
          decision: "hold",
          note: "Needs another check"
        })
      })
    )
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.json.code, "invalid_decision");
  assert.equal(ddbUpdateCalls, beforeUpdate);
});

test("approves review via moderation endpoint", async () => {
  const beforeUpdate = ddbUpdateCalls;
  const res = parseResponse(
    await handler(
      makeEvent({
        method: "POST",
        path: "/reviews/review-123/moderate",
        routeKey: "POST /reviews/{reviewId}/moderate",
        origin: "https://www.waterapps.com.au",
        pathParameters: { reviewId: "review-123" },
        claims: { email: "varun@waterapps.com.au" },
        body: JSON.stringify({
          decision: "approved",
          note: "LinkedIn profile verified"
        })
      })
    )
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, "success");
  assert.equal(res.json.review.status, "approved");
  assert.equal(res.json.review.moderated_by, "varun@waterapps.com.au");
  assert.equal(ddbUpdateCalls, beforeUpdate + 1);
});
