import { describe, expect, it } from "vitest";
import {
  buildDocumentSummary,
  normalizeCorrectionValue,
  parseDocumentWorkflowAction,
} from "../lib/document-automation";

describe("document automation helpers", () => {
  it("builds a concise summary with pending stock state", () => {
    const summary = buildDocumentSummary({
      supplierName: "Sun Grid Solutions Limited",
      documentNumber: "SG000123",
      vehicleNumber: "KL11AA1234",
      totalAmount: 176026.86,
      items: [
        {
          id: "item-1",
          description: "Solar 560 Wp Topcon Panel",
          hsnSac: "8541",
          quantity: 6,
          unit: "NOS",
          rate: 20000,
          amount: 120000,
        },
      ],
    });

    expect(summary).toContain("Bill data recorded");
    expect(summary).toContain("Solar 560 Wp Topcon Panel — 6 NOS");
    expect(summary).toContain("Stock update pending");
    expect(summary.length).toBeLessThanOrEqual(950);

    const applied = buildDocumentSummary({
      supplierName: "Sun Grid Solutions Limited",
      documentNumber: "SG000123",
      vehicleNumber: "KL11AA1234",
      totalAmount: 176026.86,
      stockStatus: "applied",
      items: [
        {
          id: "item-1",
          description: "Solar 560 Wp Topcon Panel",
          hsnSac: "8541",
          quantity: 6,
          unit: "NOS",
          rate: 20000,
          amount: 120000,
        },
      ],
    });

    expect(applied).toContain("Stock updated");
  });

  it("parses only namespaced document workflow actions", () => {
    expect(
      parseDocumentWorkflowAction(
        "so:doc:field:vehicle_number:11111111-1111-1111-1111-111111111111",
      ),
    ).toEqual({
      type: "edit_field",
      field: "vehicle_number",
      draftId: "11111111-1111-1111-1111-111111111111",
    });

    expect(
      parseDocumentWorkflowAction(
        "so:doc:qty:11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222",
      ),
    ).toEqual({
      type: "edit_item_quantity",
      draftId: "11111111-1111-1111-1111-111111111111",
      itemId: "22222222-2222-2222-2222-222222222222",
    });

    expect(parseDocumentWorkflowAction("delete everything")).toBeNull();
  });

  it("validates correction values fail-closed", () => {
    expect(normalizeCorrectionValue("document_number", " SG-101 ")).toBe(
      "SG-101",
    );
    expect(normalizeCorrectionValue("vehicle_number", " kl 11 aa 1234 ")).toBe(
      "KL 11 AA 1234",
    );
    expect(normalizeCorrectionValue("item_quantity", "28.500")).toBe(28.5);

    expect(normalizeCorrectionValue("item_quantity", "0")).toBeNull();
    expect(normalizeCorrectionValue("item_quantity", "-1")).toBeNull();
    expect(normalizeCorrectionValue("item_quantity", "28.5555")).toBeNull();
    expect(
      normalizeCorrectionValue("vehicle_number", "<script>alert(1)</script>"),
    ).toBeNull();
  });
});
