import { EventEmitter } from "events";
import type Database from "better-sqlite3";
import { insertTx, loadRecentTx, loadAggregates } from "./db.js";

export interface TxEvent {
  timestamp: Date;
  intent: string;
  provider: string;
  serviceId: string;
  url: string;
  method: string;
  amount: number | null;
  savedVsNext: number | null;
  status: "success" | "payment_error" | "service_error";
  latencyMs: number;
  responsePreview?: string;
  /** What we charged the caller (null in free/auth mode) */
  chargedAmount: number | null;
  /** Margin earned: charged - upstream cost (null if unknown) */
  revenue: number | null;
}

const MAX_LOG = 1000;

export class PaymentTracker extends EventEmitter {
  private log: TxEvent[] = [];
  private totalSpent = 0;
  private totalSaved = 0;
  private totalCharged = 0;
  private totalRevenue = 0;
  private totalLoss = 0;
  private budget: number | null = null;
  private db: Database.Database | null = null;

  constructor(db?: Database.Database) {
    super();
    this.db = db ?? null;
  }

  /** Create a tracker hydrated from persisted SQLite data */
  static hydrate(db: Database.Database): PaymentTracker {
    const tracker = new PaymentTracker(db);
    const agg = loadAggregates(db);
    tracker.totalSpent = agg.totalSpent;
    tracker.totalSaved = agg.totalSaved;
    tracker.totalCharged = agg.totalCharged;
    tracker.totalRevenue = agg.totalRevenue;
    tracker.totalLoss = agg.totalLoss;
    tracker.log = loadRecentTx(db, MAX_LOG);
    return tracker;
  }

  record(event: TxEvent) {
    this.log.push(event);
    if (this.log.length > MAX_LOG) {
      this.log.shift();
    }

    if (event.status === "success") {
      if (event.amount != null) {
        this.totalSpent += event.amount;
      }
      if (event.chargedAmount != null) {
        this.totalCharged += event.chargedAmount;
      }
      if (event.revenue != null) {
        this.totalRevenue += event.revenue;
      }
    }

    // Track loss: caller paid but upstream failed
    if (event.status !== "success" && event.chargedAmount != null && event.chargedAmount > 0) {
      this.totalLoss += event.chargedAmount;
    }

    if (event.savedVsNext != null && event.savedVsNext > 0) {
      this.totalSaved += event.savedVsNext;
    }

    if (this.db) {
      try { insertTx(this.db, event); } catch (_) { /* best-effort */ }
    }

    this.emit("transaction", event);
  }

  getTotalSpent(): number {
    return this.totalSpent;
  }

  getTotalSaved(): number {
    return this.totalSaved;
  }

  getTransactionCount(): number {
    return this.log.length;
  }

  getTransactions(limit?: number): TxEvent[] {
    if (limit !== undefined) {
      return this.log.slice(-limit);
    }
    return [...this.log];
  }

  setBudget(max: number) {
    this.budget = max;
  }

  isOverBudget(): boolean {
    if (this.budget === null) return false;
    return this.totalSpent >= this.budget;
  }

  getRemainingBudget(): number | null {
    if (this.budget === null) return null;
    return Math.max(0, this.budget - this.totalSpent);
  }

  getSavingsPercent(): number {
    const wouldHaveSpent = this.totalSpent + this.totalSaved;
    if (wouldHaveSpent === 0) return 0;
    return (this.totalSaved / wouldHaveSpent) * 100;
  }

  getTotalCharged(): number {
    return this.totalCharged;
  }

  getTotalRevenue(): number {
    return this.totalRevenue;
  }

  getTotalLoss(): number {
    return this.totalLoss;
  }

  getMarginPercent(): number {
    if (this.totalCharged === 0) return 0;
    return (this.totalRevenue / this.totalCharged) * 100;
  }
}
