import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

// Placeholder: proves CloudFront -> Function URL (OAC) works for GET and POST.
// Real routes arrive with the Matchmaking and signaling backend.
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const { method, path } = event.requestContext.http;

  if (method === "GET" && path === "/api/ping") return json({ ok: true, now: Date.now() });

  if (method === "POST" && path === "/api/echo") {
    const body = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString() : (event.body ?? "");
    return json({ ok: true, bytes: body.length, body });
  }

  return json({ ok: false, error: "not found" }, 404);
};

const json = (body: unknown, statusCode = 200): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
