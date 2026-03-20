import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

const key = process.env.SPENDING_KEY;
if (!key?.startsWith("0x")) {
  throw new Error("SPENDING_KEY env var required (hex format: 0x...)");
}

const account = privateKeyToAccount(key as `0x${string}`);
const mppx = Mppx.create({
  methods: [tempo({ account })],
  polyfill: false,
});

export interface PaymentResult {
  success: boolean;
  statusCode: number;
  response: any;
  responseRaw: string;
  contentType: string;
  error?: string;
  latencyMs: number;
}

export async function payRequest(
  url: string,
  method: string = "GET",
  headers: Record<string, string> = {},
  body?: string
): Promise<PaymentResult> {
  const start = Date.now();

  try {
    const res = await mppx.fetch(url, {
      method,
      headers: {
        ...headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body || undefined,
      signal: AbortSignal.timeout(30000),
    });

    const latencyMs = Date.now() - start;
    const contentType = res.headers.get("content-type") || "application/json";
    const rawText = await res.text();

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = rawText;
    }

    if (res.status === 402) {
      return {
        success: false,
        statusCode: 402,
        response: parsed,
        responseRaw: rawText,
        contentType,
        error: typeof parsed === "object" ? parsed?.message || "Payment failed" : "Payment failed",
        latencyMs,
      };
    }

    if (res.status >= 400) {
      return {
        success: false,
        statusCode: res.status,
        response: parsed,
        responseRaw: rawText,
        contentType,
        error: typeof parsed === "object" ? parsed?.message || `HTTP ${res.status}` : `HTTP ${res.status}`,
        latencyMs,
      };
    }

    return {
      success: true,
      statusCode: res.status,
      response: parsed,
      responseRaw: rawText,
      contentType,
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      statusCode: 0,
      response: null,
      responseRaw: "",
      contentType: "application/json",
      error: err?.name === "TimeoutError" ? "Request timed out (30s)" : (err?.message || "Request failed"),
      latencyMs: Date.now() - start,
    };
  }
}
