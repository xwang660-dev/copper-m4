// The refund rules, in plain code. The Refund agent can ask for a refund, but
// only this file decides what happens to it: refunds at or under the
// auto-refund limit go through, bigger ones wait for a person, and an order
// can only ever be refunded once. The model cannot argue past any of it.
//
// State lives in memory on the server (fine for class; a real app would use a
// database). It survives hot reloads through globalThis.

export type Order = {
  id: string;
  customer: string;
  item: string;
  amountUsd: number;
};

export type RefundStatus = "auto_approved" | "pending" | "approved" | "rejected";

export type RefundRequest = {
  id: string;
  orderId: string;
  customer: string;
  item: string;
  amountUsd: number;
  reason: string;
  status: RefundStatus;
  requestedAt: string;
  decidedAt: string | null;
};

export const ORDERS: Order[] = [
  { id: "CS-1001", customer: "Maya Reyes", item: "Copper Plus, monthly", amountUsd: 7.99 },
  { id: "CS-1002", customer: "Maya Reyes", item: "Copper Plus, annual", amountUsd: 79 },
  { id: "CS-1003", customer: "Maya Reyes", item: "Copper Notes", amountUsd: 129 },
  { id: "CS-1004", customer: "Maya Reyes", item: "Copper Home", amountUsd: 149 },
];

export const DEFAULT_LIMIT_USD = 50;

type State = { limitUsd: number; requests: RefundRequest[]; seq: number };

const g = globalThis as unknown as { __copperRefunds?: State };
const state: State = (g.__copperRefunds ??= {
  limitUsd: DEFAULT_LIMIT_USD,
  requests: [],
  seq: 0,
});

export function getLimit(): number {
  return state.limitUsd;
}

/** Sets the auto-refund limit. Anything that isn't a number >= 0 is refused. */
export function setLimit(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error("The limit must be a number, 0 or more.");
  }
  state.limitUsd = Math.round(usd * 100) / 100;
  return state.limitUsd;
}

export function listRequests(): RefundRequest[] {
  return state.requests.map((r) => ({ ...r }));
}

export function findOrder(orderId: string): Order | undefined {
  const wanted = orderId.trim().toUpperCase();
  return ORDERS.find((o) => o.id === wanted);
}

export function refundFor(orderId: string): RefundRequest | undefined {
  const wanted = orderId.trim().toUpperCase();
  const found = state.requests.find((r) => r.orderId === wanted);
  return found && { ...found };
}

export type RefundOutcome =
  | { outcome: "not_found"; orderId: string }
  | { outcome: "duplicate"; request: RefundRequest }
  | { outcome: "auto_approved"; request: RefundRequest; limitUsd: number }
  | { outcome: "needs_human_approval"; request: RefundRequest; limitUsd: number };

/**
 * Asks for a refund. The only way a refund is created. One request per order,
 * ever: asking again (even after a rejection) returns the first one.
 */
export function requestRefund(orderId: string, reason: string): RefundOutcome {
  const order = findOrder(orderId);
  if (!order) return { outcome: "not_found", orderId };
  const existing = refundFor(order.id);
  if (existing) return { outcome: "duplicate", request: existing };

  const now = new Date().toISOString();
  const auto = order.amountUsd <= state.limitUsd;
  const request: RefundRequest = {
    id: `RF-${String(++state.seq).padStart(3, "0")}`,
    orderId: order.id,
    customer: order.customer,
    item: order.item,
    amountUsd: order.amountUsd,
    reason: reason.slice(0, 300),
    status: auto ? "auto_approved" : "pending",
    requestedAt: now,
    decidedAt: auto ? now : null,
  };
  state.requests.push(request);
  return auto
    ? { outcome: "auto_approved", request: { ...request }, limitUsd: state.limitUsd }
    : {
        outcome: "needs_human_approval",
        request: { ...request },
        limitUsd: state.limitUsd,
      };
}

/** A person's decision. Only a pending refund can be decided, and only once. */
export function decideRefund(
  requestId: string,
  decision: "approved" | "rejected",
): RefundRequest {
  const request = state.requests.find((r) => r.id === requestId);
  if (!request) throw new Error("No such refund request.");
  if (request.status !== "pending") {
    throw new Error("That refund was already decided.");
  }
  request.status = decision;
  request.decidedAt = new Date().toISOString();
  return { ...request };
}

/** Tests only: back to the starting state. */
export function resetRefunds() {
  state.limitUsd = DEFAULT_LIMIT_USD;
  state.requests = [];
  state.seq = 0;
}
