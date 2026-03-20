import path from "path";
import { loadServices } from "./discovery/loader.js";
import { ServiceStore } from "./discovery/store.js";
import { openDb } from "./payments/db.js";
import { PaymentTracker } from "./payments/tracker.js";
import { startProxy, PORT, type PaymentMode } from "./proxy/server.js";
import { startDashboard } from "./dashboard/tui.js";

const BANNER = `
{bold}{cyan-fg}
 ╔═════════════════════════════╗
 ║      ⚡ MPP ROUTER ⚡      ║
 ╚═════════════════════════════╝
{/cyan-fg}{/bold}`;

async function main() {
  // Auto-detect production: force --no-tui when no TTY available
  const isProduction = !!process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production";
  const noTui = process.argv.includes("--no-tui") || isProduction;

  // Payment mode
  const paymentMode = (process.env.PAYMENT_MODE || "paid") as PaymentMode;
  if (!["paid", "auth", "free"].includes(paymentMode)) {
    console.error(`Invalid PAYMENT_MODE: ${paymentMode}. Must be "paid", "auth", or "free".`);
    process.exit(1);
  }

  // Validate required env vars for paid mode
  if (paymentMode === "paid") {
    if (!process.env.RECEIVING_ADDRESS) {
      console.error("RECEIVING_ADDRESS is required when PAYMENT_MODE=paid");
      process.exit(1);
    }
    if (!process.env.MPP_SECRET_KEY) {
      console.error("MPP_SECRET_KEY is required when PAYMENT_MODE=paid");
      process.exit(1);
    }
  }

  // Step 1: Load services
  if (noTui) console.log("Loading MPP services...");
  const services = loadServices();
  const store = new ServiceStore(services);
  const intents = store.getAllIntents();

  if (noTui) {
    console.log(`Loaded ${services.length} services, ${intents.length} intents`);
    console.log(`Intents: ${intents.join(", ")}`);
    console.log(`Payment mode: ${paymentMode}`);
  }

  // Step 2: Setup tracker with SQLite persistence
  const dataDir = process.env.DATA_DIR || "/data";
  let db: ReturnType<typeof openDb> | null = null;
  let tracker: PaymentTracker;
  try {
    db = openDb(path.join(dataDir, "mpprouter.db"));
    tracker = PaymentTracker.hydrate(db);
    if (noTui) console.log(`Database opened at ${path.join(dataDir, "mpprouter.db")}`);
  } catch (err) {
    if (noTui) console.log(`Database unavailable (${(err as Error).message}), running in-memory only`);
    tracker = new PaymentTracker();
  }
  const budget = parseFloat(process.env.BUDGET || "5") || 5;
  tracker.setBudget(budget);

  if (noTui) {
    // Console-only mode: log transactions to stdout
    tracker.on("transaction", (event) => {
      const status = event.status === "success" ? "✓" : "✗";
      const savings = event.savedVsNext != null && event.savedVsNext > 0 ? ` (saved $${event.savedVsNext.toFixed(3)})` : "";
      const price = event.amount != null ? `$${event.amount.toFixed(4)}` : "$?.??";
      const charged = event.chargedAmount != null ? ` [charged $${event.chargedAmount.toFixed(4)}]` : "";
      console.log(`${status} ${event.intent} → ${event.provider} ${price}${charged}${savings} [${event.latencyMs}ms]`);
    });
  }

  // Step 3: Start proxy
  const proxy = startProxy(store, tracker, paymentMode);
  if (noTui) {
    console.log(`Proxy listening on http://localhost:${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  }

  // Step 4: Start dashboard (unless --no-tui)
  if (!noTui) {
    const { screen } = startDashboard(tracker, store);
  }

  // Graceful shutdown
  const shutdown = () => {
    proxy.close();
    if (db) db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
