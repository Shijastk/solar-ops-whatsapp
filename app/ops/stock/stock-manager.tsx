"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  StockBalance,
  StockCompany,
} from "@/lib/stock";

type StockManagerProps = {
  companies: StockCompany[];
  balances: StockBalance[];
  initialResult?: string;
};

function formatQuantity(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function resultMessage(status: string): string {
  switch (status) {
    case "opening_created":
      return "Opening stock saved.";
    case "opening_exists":
      return "Opening stock already exists for that product. Use Adjust on the current-stock row instead of overwriting history.";
    case "invalid_item":
      return "Opening stock was not saved because the values were invalid.";
    case "inconsistent":
      return "Opening stock was blocked because the company/product data conflicted.";
    case "potential_company_duplicate":
      return "A very similar company already exists. Select it, or explicitly confirm that this is genuinely a different company.";
    case "potential_product_duplicate":
      return "A very similar product already exists for this company/unit. Check Current stock first and use Adjust when it is the same product.";
    case "invalid_gstin":
      return "GSTIN is invalid. Enter a standard 15-character GSTIN or leave it blank.";
    case "company_required":
      return "Select an existing company or enter a new company name.";
    case "product_required":
      return "Product name is required.";
    case "invalid_unit":
      return "Unit is invalid.";
    case "invalid_hsn":
      return "HSN / SAC is invalid.";
    case "adjusted":
      return "Current stock adjusted. The original opening/dispatch history was preserved.";
    case "already_adjusted":
      return "This stock adjustment was already applied.";
    case "no_change":
      return "Current stock already matches that quantity. No ledger entry was added.";
    case "not_ready":
      return "That stock product is no longer available for adjustment.";
    case "failed":
      return "The stock change could not be saved. Check the entered values and try again.";
    default:
      return status.replaceAll("_", " ");
  }
}

export default function StockManager({
  companies,
  balances,
  initialResult,
}: StockManagerProps) {
  const router = useRouter();
  const openingFormRef = useRef<HTMLFormElement>(null);
  const [notice, setNotice] = useState(
    initialResult ? resultMessage(initialResult) : "",
  );
  const [openingPending, setOpeningPending] = useState(false);
  const [adjustingProductId, setAdjustingProductId] = useState<string | null>(
    null,
  );
  const [adjustPending, setAdjustPending] = useState(false);
  const [targetQuantity, setTargetQuantity] = useState("");

  const adjustingBalance = useMemo(
    () =>
      balances.find((balance) => balance.product_id === adjustingProductId) ??
      null,
    [adjustingProductId, balances],
  );

  async function submitOpening(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (openingPending) return;

    setOpeningPending(true);
    setNotice("");

    try {
      const response = await fetch("/api/ops/stock/opening", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: new FormData(event.currentTarget),
      });
      const payload = (await response.json()) as { status?: string };
      const status = payload.status ?? "failed";

      setNotice(resultMessage(status));

      if (response.ok && status === "opening_created") {
        openingFormRef.current?.reset();
        router.refresh();
      }
    } catch {
      setNotice(resultMessage("failed"));
    } finally {
      setOpeningPending(false);
    }
  }

  function beginAdjustment(balance: StockBalance) {
    setNotice("");
    setAdjustingProductId(balance.product_id);
    setTargetQuantity(formatQuantity(balance.current_quantity));
  }

  function cancelAdjustment() {
    setAdjustingProductId(null);
    setTargetQuantity("");
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adjustPending || !adjustingBalance) return;

    setAdjustPending(true);
    setNotice("");

    try {
      const form = new FormData();
      form.set("productId", adjustingBalance.product_id);
      form.set("targetQuantity", targetQuantity);

      const response = await fetch("/api/ops/stock/adjust", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: form,
      });
      const payload = (await response.json()) as { status?: string };
      const status = payload.status ?? "failed";

      setNotice(resultMessage(status));

      if (
        response.ok &&
        ["adjusted", "already_adjusted", "no_change"].includes(status)
      ) {
        cancelAdjustment();
        router.refresh();
      }
    } catch {
      setNotice(resultMessage("failed"));
    } finally {
      setAdjustPending(false);
    }
  }

  return (
    <main className="stockShell">
      <header className="stockTopbar">
        <div>
          <span className="stockEyebrow">SOLAR OPS</span>
          <h1>Stock</h1>
          <p>
            Add opening stock once, then adjust current quantity without
            rewriting ledger history.
          </p>
        </div>
        <Link className="stockBack" href="/ops">
          Back to WhatsApp
        </Link>
      </header>

      {notice ? (
        <div className="stockNotice" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}

      <section className="stockGrid">
        <form
          className="stockCard stockForm"
          onSubmit={submitOpening}
          ref={openingFormRef}
        >
          <div>
            <span className="stockEyebrow">ADD PRODUCT</span>
            <h2>Add opening quantity</h2>
            <p>
              Use this once for a new stock product. Existing products should
              be changed with Adjust in Current stock.
            </p>
          </div>

          <label>
            Existing company
            <select name="companyId">
              <option value="">Create / match by new company details</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.canonical_name}
                  {company.gstin ? " · " + company.gstin : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="stockFormSplit">
            <label>
              New company name
              <input
                maxLength={160}
                name="companyName"
                placeholder="Required only for a new company"
                type="text"
              />
            </label>
            <label>
              Company GSTIN
              <input
                autoCapitalize="characters"
                autoCorrect="off"
                maxLength={80}
                name="companyGstin"
                placeholder="15-character GSTIN (optional)"
                spellCheck={false}
                type="text"
              />
            </label>
          </div>

          <label>
            Product name
            <input
              maxLength={200}
              name="productName"
              placeholder="e.g. Solar 560 Wp TOPCon Panel"
              required
              type="text"
            />
          </label>

          <div className="stockFormSplit">
            <label>
              Unit
              <select defaultValue="NOS" name="unit" required>
                <option value="NOS">NOS</option>
                <option value="PCS">PCS</option>
                <option value="SET">SET</option>
                <option value="BOX">BOX</option>
              </select>
            </label>
            <label>
              HSN / SAC
              <input
                maxLength={32}
                name="hsnSac"
                placeholder="Optional"
                type="text"
              />
            </label>
          </div>

          <label>
            Opening quantity
            <input
              inputMode="decimal"
              min="0.001"
              name="quantity"
              required
              step="0.001"
              type="number"
            />
          </label>

          <label className="stockConfirm">
            <input name="allowSimilarCompany" type="checkbox" />
            <span>
              I checked the existing companies and confirm this new company is
              genuinely different.
            </span>
          </label>

          <label className="stockConfirm">
            <input name="allowSimilarProduct" type="checkbox" />
            <span>
              I checked Current stock and confirm this similar product is
              genuinely a different product.
            </span>
          </label>

          <button
            className="stockPrimary"
            disabled={openingPending}
            type="submit"
          >
            {openingPending ? "Saving…" : "Save opening stock"}
          </button>

          <p className="stockFinePrint">
            Opening entries stay immutable. Later corrections use audited
            adjustment entries instead of overwriting history.
          </p>
        </form>

        <section className="stockCard stockBalances">
          <div className="stockBalancesHeader">
            <div>
              <span className="stockEyebrow">CURRENT LEDGER</span>
              <h2>Current stock</h2>
              <p>{balances.length} configured product(s)</p>
            </div>
          </div>

          {balances.length === 0 ? (
            <div className="stockEmpty">
              No opening stock yet. Add the first product on the left.
            </div>
          ) : (
            <div className="stockTableWrap">
              <table className="stockTable">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Product</th>
                    <th>HSN</th>
                    <th>Current</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((balance) => {
                    const isAdjusting =
                      adjustingProductId === balance.product_id;

                    return (
                      <tr key={balance.product_id}>
                        <td>{balance.company_name}</td>
                        <td>
                          <strong>{balance.product_name}</strong>
                          <span className="stockUnitMeta">{balance.unit}</span>
                        </td>
                        <td>{balance.hsn_sac || "—"}</td>
                        <td>
                          <strong>
                            {formatQuantity(balance.current_quantity)}
                          </strong>{" "}
                          {balance.unit}
                        </td>
                        <td>
                          {isAdjusting ? (
                            <form
                              className="stockAdjustForm"
                              onSubmit={submitAdjustment}
                            >
                              <label>
                                New current quantity
                                <input
                                  autoFocus
                                  inputMode="decimal"
                                  min="0"
                                  onChange={(event) =>
                                    setTargetQuantity(event.target.value)
                                  }
                                  required
                                  step="0.001"
                                  type="number"
                                  value={targetQuantity}
                                />
                              </label>
                              <div className="stockAdjustActions">
                                <button
                                  className="stockPrimary stockSmallButton"
                                  disabled={adjustPending}
                                  type="submit"
                                >
                                  {adjustPending ? "Saving…" : "Save"}
                                </button>
                                <button
                                  className="stockBack stockSmallButton"
                                  disabled={adjustPending}
                                  onClick={cancelAdjustment}
                                  type="button"
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <button
                              className="stockBack stockSmallButton"
                              onClick={() => beginAdjustment(balance)}
                              type="button"
                            >
                              Adjust
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="stockAdjustmentNote">
            Adjust sets the current physical quantity by adding a ledger delta.
            It never rewrites the original Opening Stock or previous bill
            movements.
          </p>
        </section>
      </section>
    </main>
  );
}
