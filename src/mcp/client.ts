#!/usr/bin/env node
/**
 * Local MCP stdio server that proxies tool calls to a remote mpprouter instance.
 * Signs MPP 402 payment challenges locally — private key never leaves the machine.
 *
 * Usage (Claude Code MCP config):
 *   "mpprouter": {
 *     "type": "stdio",
 *     "command": "npx",
 *     "args": ["mpprouter"],
 *     "env": { "SPENDING_KEY": "0x..." }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

const MPPROUTER_URL = (process.env.MPPROUTER_URL || "https://mpprouter.com").replace(/\/$/, "");

// Setup mppx client for automatic 402 handling
const key = process.env.SPENDING_KEY;
if (!key?.startsWith("0x")) {
  console.error("SPENDING_KEY env var required (hex format: 0x...)");
  process.exit(1);
}
const account = privateKeyToAccount(key as `0x${string}`);
const mppx = Mppx.create({
  methods: [tempo({ account })],
  polyfill: false,
});

interface PriceEntry {
  intent: string;
  providers: { service: string; serviceId: string; endpoint: string; priceUsd: number | null }[];
}

interface IntentTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  mapArgs: (args: Record<string, any>) => { queryParams: Record<string, string>; body?: string };
}

/** Known intent schemas — everything else gets a generic body passthrough */
const KNOWN_INTENTS: Record<string, {
  description: string;
  inputSchema: Record<string, any>;
  mapArgs: (args: Record<string, any>) => { queryParams: Record<string, string>; body?: string };
}> = {
  web_search: {
    description: "Search the web for information",
    inputSchema: {
      query: z.string().describe("Search query"),
      num_results: z.number().optional().describe("Number of results"),
    },
    mapArgs: (args) => ({
      queryParams: {
        q: args.query || "",
        ...(args.num_results != null ? { num: String(args.num_results) } : {}),
      },
    }),
  },
  scrape: {
    description: "Extract content from a URL",
    inputSchema: {
      url: z.string().describe("URL to scrape"),
    },
    mapArgs: (args) => ({
      queryParams: { url: args.url || "" },
    }),
  },
};

function genericSchema() {
  return {
    inputSchema: {
      body: z.record(z.string(), z.unknown()).optional().describe("JSON body to forward to upstream provider"),
    },
    mapArgs: (args: Record<string, any>) => ({
      queryParams: {} as Record<string, string>,
      body: args.body ? JSON.stringify(args.body) : undefined,
    }),
  };
}

async function fetchIntents(): Promise<string[]> {
  try {
    const res = await fetch(`${MPPROUTER_URL}/prices`);
    if (!res.ok) throw new Error(`/prices returned ${res.status}`);
    const data: PriceEntry[] = await res.json();
    return data.map((d) => d.intent);
  } catch (err: any) {
    console.error(`Failed to fetch intents from ${MPPROUTER_URL}/prices: ${err.message}`);
    // Fallback: hardcoded core intents
    return ["web_search", "scrape", "llm", "image_gen", "email", "weather", "maps", "finance", "blockchain", "social", "enrich", "travel"];
  }
}

async function callIntent(intent: string, queryParams: Record<string, string>, body?: string): Promise<{ text: string; ok: boolean }> {
  const qs = new URLSearchParams(queryParams).toString();
  const url = `${MPPROUTER_URL}/intent/${intent}${qs ? "?" + qs : ""}`;

  try {
    const res = await mppx.fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body || undefined,
      signal: AbortSignal.timeout(30000),
    });

    const text = await res.text();

    if (res.status >= 400) {
      return { text: `Error ${res.status}: ${text}`, ok: false };
    }

    return { text, ok: true };
  } catch (err: any) {
    const msg = err?.name === "TimeoutError" ? "Request timed out (30s)" : (err?.message || "Request failed");
    return { text: msg, ok: false };
  }
}

async function main() {
  const server = new McpServer({ name: "mpprouter", version: "1.0.0" });

  // Fetch available intents from remote
  const intents = await fetchIntents();

  for (const intent of intents) {
    const known = KNOWN_INTENTS[intent];
    const description = known?.description || intent;
    const inputSchema = known?.inputSchema || genericSchema().inputSchema;
    const mapArgs = known?.mapArgs || genericSchema().mapArgs;

    server.registerTool(intent, { description, inputSchema }, async (args: Record<string, any>) => {
      const { queryParams, body } = mapArgs(args);
      const result = await callIntent(intent, queryParams, body);
      return {
        content: [{ type: "text" as const, text: result.text }],
        isError: !result.ok,
      };
    });
  }

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
