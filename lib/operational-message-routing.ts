import { handleDocumentWorkflowInbound } from "@/lib/document-automation";
import { handleDriverMutation } from "@/lib/driver-agent";
import { handleStockWorkflowInbound } from "@/lib/stock-workflow";
import { handleTripWorkflowInbound } from "@/lib/trips";
import { getAgentEnabled } from "@/lib/agent-settings";
import type { NormalizedWhatsAppMessage } from "@/lib/whatsapp";

type WorkflowResult = "handled" | "ignored" | "disabled";

export async function routeOperationalTextMessage(
  message: NormalizedWhatsAppMessage,
  storedMessageId: string,
  options: { fromVoice?: boolean; agentEnabled?: boolean } = {},
): Promise<WorkflowResult> {
  const startedAt = performance.now();
  const stageDurationsMs: Record<string, number> = {};
  let outcome: WorkflowResult | "failed" = "failed";

  const runStage = async (
    stage: string,
    action: () => Promise<WorkflowResult>,
  ): Promise<WorkflowResult> => {
    const stageStartedAt = performance.now();
    try {
      return await action();
    } finally {
      stageDurationsMs[stage] = Math.round(performance.now() - stageStartedAt);
    }
  };

  try {
    const agentEnabled = options.agentEnabled ?? (await getAgentEnabled());
    if (!agentEnabled) {
      outcome = "disabled";
      return "disabled";
    }

    let result = await runStage("driver", () =>
      handleDriverMutation(message, storedMessageId),
    );
    if (result === "handled") {
      outcome = result;
      return result;
    }

    result = await runStage("stock", () =>
      handleStockWorkflowInbound(message, storedMessageId),
    );
    if (result === "handled") {
      outcome = result;
      return result;
    }

    result = await runStage("trip", () =>
      handleTripWorkflowInbound(message, storedMessageId),
    );
    if (result === "handled") {
      outcome = result;
      return result;
    }

    result = await runStage("document_query", () =>
      handleDocumentWorkflowInbound(message, storedMessageId, {
        ...options,
        skipOperationalWorkflows: true,
      }),
    );
    outcome = result;
    return result;
  } finally {
    console.info("WhatsApp operational routing completed", {
      durationMs: Math.round(performance.now() - startedAt),
      stageDurationsMs,
      messageType: message.type,
      fromVoice: options.fromVoice === true,
      outcome,
    });
  }
}
