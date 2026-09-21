export type ParsedDocumentItem = {
  sourceLineNumber: number | null;
  description: string;
  normalizedDescription: string;
  hsnSac: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  amount: number | null;
};

export type ParsedOperationalDocument = {
  parserVersion: string;
  parseStatus: "ready_for_review" | "needs_review" | "needs_ocr";
  documentType: string | null;
  supplierName: string | null;
  supplierGstin: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  ewayBillNumber: string | null;
  customerName: string | null;
  customerAddress: string | null;
  customerPincode: string | null;
  customerPhone: string | null;
  destination: string | null;
  vehicleNumber: string | null;
  supplyType: string | null;
  transactionType: string | null;
  taxableAmount: number | null;
  cgstAmount: number | null;
  sgstAmount: number | null;
  totalAmount: number | null;
  missingFields: string[];
  items: ParsedDocumentItem[];
};

export const DOCUMENT_PARSER_VERSION = "anchor-v1";

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function cleanText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeProductDescription(value: string): string {
  return cleanLine(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/[₹,\s]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function parseDocumentDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = cleanLine(value).replace(/[.,]$/, "");

  const named = trimmed.match(
    /^(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{2,4})$/,
  );
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    let year = Number(named[3]);
    if (named[3].length === 2) year += year >= 70 ? 1900 : 2000;
    return isoDate(year, month, Number(named[1]));
  }

  const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (dmy[3].length === 2) year += year >= 70 ? 1900 : 2000;
    return isoDate(year, Number(dmy[2]), Number(dmy[1]));
  }

  const ymd = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    return isoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  }

  return null;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1] ? cleanLine(match[1]) : "";
    if (value) return value;
  }
  return null;
}

function blockBetween(text: string, start: RegExp, end: RegExp): string[] {
  const match = text.match(
    new RegExp(start.source + "([\\s\\S]*?)" + end.source, "i"),
  );
  if (!match?.[1]) return [];

  return match[1].split("\n").map(cleanLine).filter(Boolean);
}

function parseCustomer(text: string) {
  let block = blockBetween(
    text,
    /Consignee\s*\(Ship to\)\s*/,
    /Buyer\s*\(Bill to\)/,
  );

  if (block.length === 0) {
    block = blockBetween(
      text,
      /(?:^|\n)Ship To\s*/,
      /(?:^|\n)3\.\s*Goods Details/,
    );
  }

  const name = block[0] ?? null;
  const addressLines = block.slice(1).filter(
    (line) =>
      !/^State Name\s*:/i.test(line) &&
      !/^GSTIN\s*:/i.test(line) &&
      !/^Kerala$/i.test(line),
  );
  const address = addressLines.length > 0 ? addressLines.join(", ") : null;

  return {
    name,
    address,
    pincode:
      address?.match(/\b([1-9][0-9]{5})\b/)?.[1] ??
      firstMatch(text, [
        /\b(?:PIN|Pincode|Postal Code)\s*[:.-]?\s*([1-9][0-9]{5})\b/i,
      ]),
    phone: firstMatch(text, [
      /\b(?:Phone|Mobile|Mob|Contact)\s*(?:No\.?|Number)?\s*[:.-]\s*(\+?\d[\d ()-]{7,18})/i,
    ]),
  };
}

function parseSupplier(text: string) {
  const fromBlock = text.match(
    /(?:^|\n)From\s*\n([^\n]+)\nGSTIN\s*:\s*([A-Z0-9]{15})/i,
  );
  if (fromBlock) {
    return {
      name: cleanLine(fromBlock[1]),
      gstin: fromBlock[2].toUpperCase(),
    };
  }

  const firstPage = text.match(
    /(?:DELIVERY NOTE|DELIVERY CHALLAN|TAX INVOICE|INVOICE)[^\n]*\n([^\n]+)[\s\S]{0,500}?GSTIN(?:\/UIN)?\s*:\s*([A-Z0-9]{15})/i,
  );

  return {
    name: firstPage?.[1] ? cleanLine(firstPage[1]) : null,
    gstin: firstPage?.[2]?.toUpperCase() ?? null,
  };
}

function parseDocumentType(text: string): string | null {
  if (/\bDELIVERY NOTE\b/i.test(text)) return "delivery_note";
  if (/\bDELIVERY CHALLAN\b/i.test(text)) return "delivery_challan";
  if (/\bTAX INVOICE\b/i.test(text)) return "tax_invoice";
  if (/\bINVOICE\b/i.test(text)) return "invoice";
  if (/\be-?Way Bill\b/i.test(text)) return "eway_bill";
  return null;
}

function parseDocumentNumber(text: string): string | null {
  return firstMatch(text, [
    /Doc No\.\s*:\s*(?:Delivery Challan\s*-\s*)?([A-Z0-9][A-Z0-9/-]{2,})/i,
    /Delivery Note No\.\s*(?:e-?Way Bill No\.)?\s*\n?\s*([A-Z0-9][A-Z0-9/-]{2,})/i,
    /(?:Invoice|Bill|Challan)\s*(?:No\.?|Number)\s*[:.-]\s*([A-Z0-9][A-Z0-9/-]{2,})/i,
  ]);
}

function parseEwayNumber(text: string): string | null {
  return firstMatch(text, [
    /e-?Way Bill No\.\s*:\s*(\d{12})/i,
    /Delivery Note No\.\s*e-?Way Bill No\.\s*\n?\s*[A-Z0-9/-]+\s+(\d{12})/i,
  ]);
}

function parseDateFromText(text: string): string | null {
  const raw = firstMatch(text, [
    /(?:^|\n)Date\s*:\s*(\d{1,2}[- /][A-Za-z]{3,9}[- /]\d{2,4})/i,
    /(?:^|\n)Dated\s*\n?\s*(\d{1,2}[- /][A-Za-z]{3,9}[- /]\d{2,4})/i,
    /(?:^|\n)Date\s*:\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
  ]);
  return parseDocumentDate(raw ?? undefined);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
}

function parseLabelValue(text: string, label: string): string | null {
  const escaped = escapeRegex(label);
  return firstMatch(text, [
    new RegExp("(?:^|\\n)" + escaped + "\\s*:\\s*([^\\n]+)", "i"),
  ]);
}

function cleanupEwayDescription(value: string): string {
  const parts = value.split(/\s+&\s+/);
  if (parts.length === 2) {
    const left = normalizeProductDescription(parts[0]);
    const right = normalizeProductDescription(parts[1]);
    if (left === right || left.endsWith(right) || right.endsWith(left)) {
      return cleanLine(parts[0]);
    }
  }
  return cleanLine(value);
}

function parseDeliveryTableItems(lines: string[]): ParsedDocumentItem[] {
  const items: ParsedDocumentItem[] = [];
  const row =
    /^\s*(\d{1,3})\s+(.+?)\s+(\d{4,8})\s+([\d,.]+)\s+([A-Za-z][A-Za-z0-9.]*)\s+([\d,.]+)\s+(?:[A-Za-z][A-Za-z0-9.]*\s+)?([\d,.]+)\s*$/;

  for (const line of lines) {
    const match = line.match(row);
    if (!match) continue;

    const quantity = parseNumber(match[4]);
    const rate = parseNumber(match[6]);
    const amount = parseNumber(match[7]);
    if (quantity === null || amount === null) continue;

    const description = cleanLine(match[2]);
    items.push({
      sourceLineNumber: Number(match[1]),
      description,
      normalizedDescription: normalizeProductDescription(description),
      hsnSac: match[3],
      quantity,
      unit: match[5].toUpperCase(),
      rate,
      amount,
    });
  }

  return items;
}

function parseEwayItems(lines: string[]): ParsedDocumentItem[] {
  const items: ParsedDocumentItem[] = [];
  const row =
    /^\s*(\d{4,8})\s+(.+?)\s+([\d,.]+)\s+([A-Za-z][A-Za-z0-9.]*)\s+([\d,.]+)\s+\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)?\s*$/;

  for (const line of lines) {
    const match = line.match(row);
    if (!match) continue;

    const quantity = parseNumber(match[3]);
    const amount = parseNumber(match[5]);
    if (quantity === null || amount === null) continue;

    const description = cleanupEwayDescription(match[2]);
    items.push({
      sourceLineNumber: null,
      description,
      normalizedDescription: normalizeProductDescription(description),
      hsnSac: match[1],
      quantity,
      unit: match[4].toUpperCase(),
      rate: null,
      amount,
    });
  }

  return items;
}

function dedupeItems(items: ParsedDocumentItem[]): ParsedDocumentItem[] {
  const seen = new Set<string>();
  const output: ParsedDocumentItem[] = [];

  for (const item of items) {
    const key = [
      item.hsnSac ?? "",
      item.normalizedDescription,
      item.quantity ?? "",
      item.unit ?? "",
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function parseItems(text: string): ParsedDocumentItem[] {
  const lines = text.split("\n").map(cleanLine).filter(Boolean);
  const deliveryItems = parseDeliveryTableItems(lines);
  if (deliveryItems.length > 0) return dedupeItems(deliveryItems);
  return dedupeItems(parseEwayItems(lines));
}

function parseAmount(text: string, patterns: RegExp[]): number | null {
  const raw = firstMatch(text, patterns);
  return parseNumber(raw ?? undefined);
}

export function parseOperationalDocumentText(
  sourceText: string,
): ParsedOperationalDocument {
  const text = cleanText(sourceText);

  if (text.length < 80 || (text.match(/[A-Za-z]/g)?.length ?? 0) < 30) {
    return {
      parserVersion: DOCUMENT_PARSER_VERSION,
      parseStatus: "needs_ocr",
      documentType: null,
      supplierName: null,
      supplierGstin: null,
      documentNumber: null,
      documentDate: null,
      ewayBillNumber: null,
      customerName: null,
      customerAddress: null,
      customerPincode: null,
      customerPhone: null,
      destination: null,
      vehicleNumber: null,
      supplyType: null,
      transactionType: null,
      taxableAmount: null,
      cgstAmount: null,
      sgstAmount: null,
      totalAmount: null,
      missingFields: ["text_layer"],
      items: [],
    };
  }

  const supplier = parseSupplier(text);
  const customer = parseCustomer(text);
  const items = parseItems(text);

  const parsed = {
    parserVersion: DOCUMENT_PARSER_VERSION,
    parseStatus: "needs_review" as "ready_for_review" | "needs_review",
    documentType: parseDocumentType(text),
    supplierName: supplier.name,
    supplierGstin: supplier.gstin,
    documentNumber: parseDocumentNumber(text),
    documentDate: parseDateFromText(text),
    ewayBillNumber: parseEwayNumber(text),
    customerName: customer.name,
    customerAddress: customer.address,
    customerPincode: customer.pincode,
    customerPhone: customer.phone,
    destination: parseLabelValue(text, "Destination"),
    vehicleNumber: firstMatch(text, [
      /Vehicle No\.\s*:\s*([A-Z0-9-]{5,20})/i,
      /Vehicle Number\s*:\s*([A-Z0-9-]{5,20})/i,
    ]),
    supplyType: firstMatch(text, [
      /Supply Type\s*:\s*(.+?)(?=\s+Transaction Type\s*:|\n|$)/i,
    ]),
    transactionType: firstMatch(text, [
      /Transaction Type\s*:\s*([^\n]+)/i,
    ]),
    taxableAmount: parseAmount(text, [
      /Tot\.\s*Taxable Amt\s*:\s*([₹\d,.]+)/i,
      /Total Taxable(?: Value| Amount)?\s*[:.-]\s*([₹\d,.]+)/i,
    ]),
    cgstAmount: parseAmount(text, [
      /CGST Amt\s*:\s*([₹\d,.]+)/i,
      /(?:^|\n)CGST\s+([₹\d,.]+)/i,
    ]),
    sgstAmount: parseAmount(text, [
      /SGST Amt\s*:\s*([₹\d,.]+)/i,
      /(?:^|\n)SGST\s+([₹\d,.]+)/i,
    ]),
    totalAmount: parseAmount(text, [
      /Total Inv Amt\s*:\s*([₹\d,.]+)/i,
      /(?:^|\n)Total\s+[₹]?\s*([\d,.]+)\s*(?:\n|$)/i,
    ]),
    missingFields: [] as string[],
    items,
  };

  const required: Array<[string, unknown]> = [
    ["supplier_name", parsed.supplierName],
    ["document_number", parsed.documentNumber],
    ["document_date", parsed.documentDate],
    ["customer_name", parsed.customerName],
    ["items", parsed.items.length > 0 ? parsed.items : null],
  ];

  parsed.missingFields = required
    .filter(([, value]) => value === null || value === undefined)
    .map(([name]) => name);

  parsed.parseStatus =
    parsed.missingFields.length === 0 ? "ready_for_review" : "needs_review";

  return parsed;
}
