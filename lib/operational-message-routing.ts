import { handleDocumentWorkflowInbound } from "@/lib/document-automation";
import { handleDriverMutation } from "@/lib/driver-agent";
import { handleStockWorkflowInbound } from "@/lib/stock-workflow";
import { handleTripWorkflowInbound } from "@/lib/trips";
import type { NormalizedWhatsAppMessage } from "@/lib/whatsapp";

type WorkflowResult = "handled" | "ignored";

export async function routeOperationalTextMessage(
  message: NormalizedWhatsAppMessage,
  storedMessageId: string,
  options: { fromVoice?: boolean } = {},
): Promise<WorkflowResult> {
  let result = await handleDriverMutation(message, storedMessageId);

  if (result === "ignored") {
    result = await handleStockWorkflowInbound(message, storedMessageId);
  }

  if (result === "ignored") {
    result = await handleTripWorkflowInbound(message, storedMessageId);
  }

  if (result === "ignored") {
    result = await handleDocumentWorkflowInbound(message, storedMessageId, {
      ...options,
      skipOperationalWorkflows: true,
    });
  }

  return result;
}
