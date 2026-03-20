import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { ServiceStore } from "../discovery/store.js";
import { PaymentTracker } from "../payments/tracker.js";
import { RequestHandler } from "./handler.js";
import { getDashboardHtml, createEventStream } from "../dashboard/web.js";

const PORT = parseInt(process.env.PORT || "3402", 10) || 3402;

export function startProxy(store: ServiceStore, tracker: PaymentTracker): { close: () => void } {
  const app = new Hono();
  const handler = new RequestHandler(store, tracker);

  // Request logging
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`);
  });

  // Auth middleware for spending routes
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    app.use("/intent/*", async (c, next) => {
      const auth = c.req.header("authorization");
      if (auth !== `Bearer ${apiKey}`) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    });
    app.use("/proxy/*", async (c, next) => {
      const auth = c.req.header("authorization");
      if (auth !== `Bearer ${apiKey}`) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    });
  }

  // Web dashboard (read-only, no auth)
  app.get("/", (c) => c.html(getDashboardHtml()));
  app.get("/events", (c) => createEventStream(c, tracker));

  // Health check
  app.get("/health", (c) => c.json({ status: "ok", services: store.getServiceCount(), intents: store.getAllIntents().length }));

  // Price index — all intents and providers
  app.get("/prices", (c) => {
    const all = store.getAllProviders();
    return c.json(
      all.map((ip) => ({
        intent: ip.intent,
        providers: ip.providers.map((p) => ({
          service: p.serviceName,
          serviceId: p.serviceId,
          endpoint: `${p.endpoint.method} ${p.endpoint.path}`,
          priceUsd: p.priceUsd,
        })),
      }))
    );
  });

  // Compare providers for a specific intent
  app.get("/compare/:intent", (c) => {
    const intent = c.req.param("intent");
    const providers = store.getProviders(intent);
    if (providers.length === 0) {
      return c.json({ error: `No providers for intent: ${intent}`, available: store.getAllIntents() }, 404);
    }
    return c.json({
      intent,
      providers: providers.map((p) => ({
        service: p.serviceName,
        serviceId: p.serviceId,
        endpoint: `${p.endpoint.method} ${p.endpoint.path}`,
        priceUsd: p.priceUsd,
        url: p.serviceUrl,
      })),
    });
  });

  // Stats
  app.get("/stats", (c) => {
    return c.json({
      totalSpent: tracker.getTotalSpent(),
      totalSaved: tracker.getTotalSaved(),
      savingsPercent: tracker.getSavingsPercent(),
      transactionCount: tracker.getTransactionCount(),
      recentTransactions: tracker.getTransactions(10),
    });
  });

  // Intent-based routing
  app.all("/intent/:intent", (c) => handler.handleIntent(c));

  // Direct proxy pass-through
  app.all("/proxy/*", (c) => handler.handleDirect(c));

  const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    // Server started — logging handled by caller
  });

  return {
    close: () => {
      (server as any).close?.();
    },
  };
}

export { PORT };
