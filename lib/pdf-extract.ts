import { extractTextItems, getDocumentProxy } from "unpdf";

const MAX_PDF_PAGES = 12;
const MAX_EXTRACTED_TEXT_CHARS = 120_000;
const MAX_IMAGE_PIXELS = 16_777_216;
const EXTRACTION_TIMEOUT_MS = 8_000;

export type ExtractedPdfText = {
  pageCount: number;
  text: string;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("PDF text extraction timed out"));
      }, timeoutMs);
      timeout.unref?.();
    }),
  ]);
}

function pageToLines(
  items: Array<{ str: string; x: number; y: number; fontSize: number }>,
): string[] {
  const useful = items
    .filter((item) => item.str.trim())
    .sort((left, right) => {
      if (Math.abs(left.y - right.y) > 2.5) return right.y - left.y;
      return left.x - right.x;
    });

  const rows: Array<{ y: number; items: typeof useful }> = [];

  for (const item of useful) {
    const tolerance = Math.max(2.5, item.fontSize * 0.22);
    const row = rows.find(
      (candidate) => Math.abs(candidate.y - item.y) <= tolerance,
    );

    if (row) {
      row.items.push(item);
      row.y =
        row.items.reduce((total, current) => total + current.y, 0) /
        row.items.length;
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) =>
      row.items
        .sort((left, right) => left.x - right.x)
        .map((item) => item.str.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

export async function extractPdfText(bytes: Buffer): Promise<ExtractedPdfText> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;

  try {
    pdf = await withTimeout(
      getDocumentProxy(new Uint8Array(bytes), {
        isEvalSupported: false,
        maxImageSize: MAX_IMAGE_PIXELS,
      }),
      EXTRACTION_TIMEOUT_MS,
    );

    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(
        "PDF has too many pages (" +
          pdf.numPages +
          "; limit " +
          MAX_PDF_PAGES +
          ")",
      );
    }

    const extracted = await withTimeout(
      extractTextItems(pdf),
      EXTRACTION_TIMEOUT_MS,
    );

    const text = extracted.items
      .map((pageItems) => pageToLines(pageItems).join("\n"))
      .join("\n\n")
      .slice(0, MAX_EXTRACTED_TEXT_CHARS)
      .trim();

    return {
      pageCount: extracted.totalPages,
      text,
    };
  } finally {
    await pdf?.destroy().catch(() => undefined);
  }
}
