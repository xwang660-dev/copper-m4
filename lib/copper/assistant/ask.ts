"use server";

// The server action the Ask Copper chat calls. It streams the conversation to
// the model through callStream (lib/ai/call.ts), with or without the tools,
// and sends back each step as it happens, so the panel can show Copper
// thinking and using its tools.
//
// Two agents share the chat. Copper answers shopping and support questions;
// when the customer wants a refund, Copper calls hand_off_to_refund_agent and
// the Refund agent (refund-agent.ts) takes over, with its own instructions and
// tools, until it calls transfer_support to hand the chat back.
import { hasToolCall, stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type {
  AgentName,
  Progress,
  ToolStep,
} from "@/lib/copper/assistant/progress";
import {
  REFUND_INSTRUCTIONS,
  refundTools,
} from "@/lib/copper/assistant/refund-agent";
import { copperTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
  /** Who holds the chat right now. Defaults to Copper. */
  agent?: AgentName;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per agent run. */
const MAX_STEPS = 5;

/** At most this many agents in one answer, so two agents can't ping-pong. */
const MAX_HANDOFFS = 2;

const SORRY = "Sorry, something went wrong on my end. Please try again.";

/** The tool each agent calls to hand the chat to the other. */
const HAND_OFF: Record<AgentName, string> = {
  copper: "hand_off_to_refund_agent",
  refund: "transfer_support",
};

const OTHER: Record<AgentName, AgentName> = {
  copper: "refund",
  refund: "copper",
};

export async function askCopper({
  messages,
  useTools,
  agent = "copper",
}: AskCopperRequest): Promise<AskCopperResult> {
  const { live, update, done } = createLive<Progress>();
  // With tools off there are no agents to hand off between.
  const first: AgentName = useTools ? agent : "copper";
  const progress: Progress = {
    steps: [],
    reply: "",
    status: "working",
    agent: first,
  };
  // A fresh copy each time, so earlier updates never change underneath the
  // panel.
  const snapshot = (): Progress => ({
    ...progress,
    steps: progress.steps.map((step) => ({ ...step })),
  });
  const toolStep = (id: string) =>
    progress.steps.find(
      (step): step is ToolStep => step.type === "tool" && step.id === id,
    );

  // Without tools, send no instructions either: "always use your tools" with
  // no tools makes the model answer with nothing.
  const start = (who: AgentName) =>
    callStream(
      who === "refund"
        ? { module: 4, feature: "refund-agent" }
        : { module: 2, feature: "ask-copper" },
      {
        messages,
        providerOptions: THOUGHT_SUMMARIES,
        ...(useTools &&
          (who === "refund"
            ? {
                instructions: REFUND_INSTRUCTIONS,
                tools: refundTools,
                // An agent stops the moment it hands off; the other agent
                // writes the reply.
                stopWhen: [stepCountIs(MAX_STEPS), hasToolCall(HAND_OFF.refund)],
              }
            : {
                instructions: COPPER_INSTRUCTIONS,
                tools: copperTools,
                stopWhen: [stepCountIs(MAX_STEPS), hasToolCall(HAND_OFF.copper)],
              })),
      },
    );

  /** Reads one agent's stream into `progress`. True if it handed off. */
  async function read(who: AgentName): Promise<boolean> {
    let handedOff = false;
    for await (const part of start(who).fullStream) {
      switch (part.type) {
        case "reasoning-delta": {
          const last = progress.steps.at(-1);
          if (last?.type === "thinking") last.text += part.text;
          else progress.steps.push({ type: "thinking", text: part.text });
          break;
        }
        case "tool-input-start":
          progress.steps.push({
            type: "tool",
            id: part.id,
            name: part.toolName,
            state: "calling",
          });
          break;
        case "tool-call": {
          const step = toolStep(part.toolCallId);
          if (step) step.input = part.input;
          else
            progress.steps.push({
              type: "tool",
              id: part.toolCallId,
              name: part.toolName,
              state: "calling",
              input: part.input,
            });
          break;
        }
        case "tool-result": {
          const step = toolStep(part.toolCallId);
          if (step) Object.assign(step, { output: part.output, state: "done" });
          if (part.toolName === HAND_OFF[who]) handedOff = true;
          break;
        }
        case "tool-error": {
          const step = toolStep(part.toolCallId);
          const message =
            part.error instanceof Error
              ? part.error.message
              : String(part.error);
          if (step) Object.assign(step, { output: message, state: "error" });
          break;
        }
        case "text-delta":
          progress.reply += part.text;
          break;
        case "error":
          throw part.error;
        default:
          continue;
      }
      update(snapshot());
    }
    return handedOff;
  }

  // Read the streams in the background, so the panel gets the first update now.
  void (async () => {
    try {
      let who = first;
      for (let run = 0; ; run++) {
        const handedOff = await read(who);
        if (!handedOff || run >= MAX_HANDOFFS) break;
        // Keep anything the agent said; the other agent carries on.
        who = OTHER[who];
        progress.agent = who;
        progress.reply = progress.reply.trim() ? `${progress.reply}\n\n` : "";
        update(snapshot());
      }
      progress.status = "done";
      if (!progress.reply.trim()) progress.reply = SORRY;
    } catch {
      progress.status = "error";
      if (!progress.reply.trim()) progress.reply = SORRY;
    }
    done(snapshot());
  })();

  return { progress: live };
}
