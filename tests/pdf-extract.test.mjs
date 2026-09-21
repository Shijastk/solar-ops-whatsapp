import { describe, expect, it } from "vitest";
import { buildMinimalPdf } from "../scripts/integration/helpers.mjs";
import { extractPdfText } from "../lib/pdf-extract.ts";

describe("PDF text extraction", () => {
  it("extracts selectable text from a generated PDF", async () => {
    const pdf = buildMinimalPdf("Solar Ops parser fixture");
    const result = await extractPdfText(pdf);

    expect(result.pageCount).toBe(1);
    expect(result.text).toContain("Solar Ops parser fixture");
  });
});
