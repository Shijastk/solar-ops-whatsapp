import { describe, expect, it } from "vitest";
import { parseStockWorkflowAction } from "../lib/stock-workflow";

describe("stock WhatsApp action parsing", () => {
  it("parses sender-resolved company selections", () => {
    expect(
      parseStockWorkflowAction(
        "so:stock:company:11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222",
      ),
    ).toEqual({
      type: "company",
      draftId: "11111111-1111-1111-1111-111111111111",
      companyId: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("parses product selections without accepting free-form commands", () => {
    expect(
      parseStockWorkflowAction(
        "so:stock:product:11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222:33333333-3333-3333-3333-333333333333",
      ),
    ).toEqual({
      type: "product",
      draftId: "11111111-1111-1111-1111-111111111111",
      itemId: "22222222-2222-2222-2222-222222222222",
      productId: "33333333-3333-3333-3333-333333333333",
    });

    expect(parseStockWorkflowAction("map this product please")).toBeNull();
  });
});
