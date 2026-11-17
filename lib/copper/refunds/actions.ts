"use server";

// Server Actions for the Refund Console: read the orders, refunds and limit,
// change the limit, and approve or reject a refund that is waiting.
import {
  decideRefund,
  getLimit,
  listRequests,
  ORDERS,
  setLimit,
  type Order,
  type RefundRequest,
} from "@/lib/copper/refunds/store";

export type ConsoleState = {
  limitUsd: number;
  orders: Order[];
  requests: RefundRequest[];
};

export async function getConsoleState(): Promise<ConsoleState> {
  return { limitUsd: getLimit(), orders: ORDERS, requests: listRequests() };
}

export async function changeLimit(usd: number): Promise<ConsoleState> {
  setLimit(usd);
  return getConsoleState();
}

export async function decide(
  requestId: string,
  decision: "approved" | "rejected",
): Promise<ConsoleState> {
  try {
    decideRefund(requestId, decision);
  } catch {
    // Already decided (say, in another tab): just show the current state.
  }
  return getConsoleState();
}
