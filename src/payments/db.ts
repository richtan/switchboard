import Database from "better-sqlite3";
import type { TxEvent } from "./tracker.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  intent TEXT NOT NULL,
  provider TEXT NOT NULL,
  service_id TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL,
  amount REAL,
  saved_vs_next REAL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  response_preview TEXT,
  charged_amount REAL,
  revenue REAL
);
CREATE INDEX IF NOT EXISTS idx_tx_timestamp ON transactions(timestamp);
`;

export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

const INSERT_SQL = `
  INSERT INTO transactions
    (timestamp, intent, provider, service_id, url, method, amount, saved_vs_next, status, latency_ms, response_preview, charged_amount, revenue)
  VALUES
    (@timestamp, @intent, @provider, @serviceId, @url, @method, @amount, @savedVsNext, @status, @latencyMs, @responsePreview, @chargedAmount, @revenue)
`;

export function insertTx(db: Database.Database, event: TxEvent): void {
  const stmt = db.prepare(INSERT_SQL);
  stmt.run({
    timestamp: event.timestamp.toISOString(),
    intent: event.intent,
    provider: event.provider,
    serviceId: event.serviceId,
    url: event.url,
    method: event.method,
    amount: event.amount,
    savedVsNext: event.savedVsNext,
    status: event.status,
    latencyMs: event.latencyMs,
    responsePreview: event.responsePreview ?? null,
    chargedAmount: event.chargedAmount,
    revenue: event.revenue,
  });
}

export function loadRecentTx(db: Database.Database, limit: number): TxEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM transactions ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as any[];

  return rows.reverse().map((r) => ({
    timestamp: new Date(r.timestamp),
    intent: r.intent,
    provider: r.provider,
    serviceId: r.service_id,
    url: r.url,
    method: r.method,
    amount: r.amount,
    savedVsNext: r.saved_vs_next,
    status: r.status,
    latencyMs: r.latency_ms,
    responsePreview: r.response_preview ?? undefined,
    chargedAmount: r.charged_amount,
    revenue: r.revenue,
  }));
}

export interface Aggregates {
  totalSpent: number;
  totalSaved: number;
  totalCharged: number;
  totalRevenue: number;
  totalLoss: number;
}

export function loadAggregates(db: Database.Database): Aggregates {
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0) AS totalSpent,
        COALESCE(SUM(CASE WHEN saved_vs_next > 0 THEN saved_vs_next ELSE 0 END), 0) AS totalSaved,
        COALESCE(SUM(CASE WHEN status = 'success' THEN charged_amount ELSE 0 END), 0) AS totalCharged,
        COALESCE(SUM(CASE WHEN status = 'success' THEN revenue ELSE 0 END), 0) AS totalRevenue,
        COALESCE(SUM(CASE WHEN status != 'success' AND charged_amount > 0 THEN charged_amount ELSE 0 END), 0) AS totalLoss
      FROM transactions`
    )
    .get() as any;

  return {
    totalSpent: row.totalSpent,
    totalSaved: row.totalSaved,
    totalCharged: row.totalCharged,
    totalRevenue: row.totalRevenue,
    totalLoss: row.totalLoss,
  };
}
