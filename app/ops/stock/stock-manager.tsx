"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
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
      return "The stock change was blocked because the existing data is inconsistent.";
    case "potential_company_duplicate":
      return "A very similar company already exists. Select it, or explicitly confirm that this is genuinely a different company.";
    case "potential_product_duplicate":
      return "A very similar product already exists for this company and unit. Use Adjust if it is the same product.";
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
      return "Current stock updated. Previous opening and dispatch history remains unchanged.";
    case "already_adjusted":
      return "This stock adjustment was already applied.";
    case "no_change":
      return "Current stock already matches that quantity.";
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
  const addSheetRef = useRef<HTMLElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
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

  useEffect(() => {
    if (!isAddSheetOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTarget = addSheetRef.current?.querySelector<
      HTMLSelectElement | HTMLInputElement
    >("select, input:not([type='checkbox'])");
    focusTarget?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsAddSheetOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAddSheetOpen]);

  function openAddSheet() {
    setNotice("");
    setIsAddSheetOpen(true);
  }

  function closeAddSheet() {
    setIsAddSheetOpen(false);
    window.requestAnimationFrame(() => addButtonRef.current?.focus());
  }

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
        setIsAddSheetOpen(false);
        router.refresh();
        window.requestAnimationFrame(() => addButtonRef.current?.focus());
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
      <div className="stockPage">
        <header className="stockHeader">
          <div className="stockHeaderCopy">
            <span className="stockKicker">Inventory</span>
            <h1>Stock management</h1>
            <p>
              Keep opening balances and physical stock corrections in one
              audited ledger.
            </p>
          </div>

          <Link className="stockSecondaryButton" href="/ops">
            Back to WhatsApp
          </Link>
        </header>

        {notice ? (
          <div className="stockNotice" role="status" aria-live="polite">
            <span className="stockNoticeDot" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        ) : null}

        <div className="stockLayout">
          <section className="stockSection stockInventorySection">
            <div className="stockSectionHeader">
              <div>
                <span className="stockSectionLabel">Current stock</span>
                <h2>Inventory</h2>
                <p>
                  {balances.length === 1
                    ? "1 configured product"
                    : balances.length + " configured products"}
                </p>
              </div>
            </div>

            {balances.length === 0 ? (
              <div className="stockEmpty">
                <strong>No stock products yet</strong>
                <span>Use Add stock to create the first opening balance.</span>
              </div>
            ) : (
              <div className="stockList">
                {balances.map((balance) => {
                  const isAdjusting =
                    adjustingProductId === balance.product_id;

                  return (
                    <div className="stockItem" key={balance.product_id}>
                      <div className="stockItemInfo">
                        <span className="stockItemCompany">
                          {balance.company_name}
                        </span>
                        <strong className="stockItemName">
                          {balance.product_name}
                        </strong>
                        <div className="stockItemMeta">
                          <span>{balance.unit}</span>
                          {balance.hsn_sac ? (
                            <span>HSN {balance.hsn_sac}</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="stockItemQuantity">
                        <span>Current</span>
                        <strong>
                          {formatQuantity(balance.current_quantity)}
                          <small>{balance.unit}</small>
                        </strong>
                      </div>

                      <div className="stockItemAction">
                        {isAdjusting ? (
                          <form
                            className="stockAdjustForm"
                            onSubmit={submitAdjustment}
                          >
                            <label htmlFor={"adjust-" + balance.product_id}>
                              New current quantity
                            </label>
                            <input
                              autoFocus
                              id={"adjust-" + balance.product_id}
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
                            <div className="stockAdjustActions">
                              <button
                                className="stockPrimaryButton stockCompactButton"
                                disabled={adjustPending}
                                type="submit"
                              >
                                {adjustPending ? "Saving…" : "Save"}
                              </button>
                              <button
                                className="stockSecondaryButton stockCompactButton"
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
                            className="stockSecondaryButton stockCompactButton"
                            onClick={() => beginAdjustment(balance)}
                            type="button"
                          >
                            Adjust
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="stockAuditNote">
              Adjustments change the current physical quantity by adding a
              ledger delta. Opening stock and previous bill movements are never
              rewritten.
            </p>
          </section>

          <section
            aria-label="Add opening stock"
            aria-modal={isAddSheetOpen ? true : undefined}
            className={
              "stockSection stockSetupSection" +
              (isAddSheetOpen ? " stockSetupSectionOpen" : "")
            }
            id="stock-add-sheet"
            ref={addSheetRef}
            role={isAddSheetOpen ? "dialog" : undefined}
          >
            <div className="stockSectionHeader stockSheetHeader">
              <div>
                <span className="stockSheetHandle" aria-hidden="true" />
                <span className="stockSectionLabel">New product</span>
                <h2>Add opening stock</h2>
                <p>
                  Use this once when a product first enters the stock ledger.
                </p>
              </div>
              <button
                aria-label="Close add stock"
                className="stockSheetClose"
                onClick={closeAddSheet}
                type="button"
              >
                ×
              </button>
            </div>

            <form
              className="stockForm"
              onSubmit={submitOpening}
              ref={openingFormRef}
            >
              <label className="stockField">
                <span>Existing company</span>
                <select name="companyId">
                  <option value="">Create or match a new company</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.canonical_name}
                      {company.gstin ? " · " + company.gstin : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="stockFieldGroup">
                <label className="stockField">
                  <span>New company name</span>
                  <input
                    maxLength={160}
                    name="companyName"
                    placeholder="Only for a new company"
                    type="text"
                  />
                </label>

                <label className="stockField">
                  <span>Company GSTIN</span>
                  <input
                    autoCapitalize="characters"
                    autoCorrect="off"
                    maxLength={80}
                    name="companyGstin"
                    placeholder="Optional"
                    spellCheck={false}
                    type="text"
                  />
                </label>
              </div>

              <label className="stockField">
                <span>Product name</span>
                <input
                  maxLength={200}
                  name="productName"
                  placeholder="e.g. Solar 560 Wp TOPCon Panel"
                  required
                  type="text"
                />
              </label>

              <div className="stockFieldGroup stockFieldGroupCompact">
                <label className="stockField">
                  <span>Unit</span>
                  <select defaultValue="NOS" name="unit" required>
                    <option value="NOS">NOS</option>
                    <option value="PCS">PCS</option>
                    <option value="SET">SET</option>
                    <option value="BOX">BOX</option>
                  </select>
                </label>

                <label className="stockField">
                  <span>HSN / SAC</span>
                  <input
                    maxLength={32}
                    name="hsnSac"
                    placeholder="Optional"
                    type="text"
                  />
                </label>
              </div>

              <label className="stockField">
                <span>Opening quantity</span>
                <input
                  inputMode="decimal"
                  min="0.001"
                  name="quantity"
                  placeholder="0"
                  required
                  step="0.001"
                  type="number"
                />
              </label>

              <div className="stockConfirmGroup">
                <label className="stockConfirm">
                  <input name="allowSimilarCompany" type="checkbox" />
                  <span>
                    I checked existing companies and this is genuinely
                    different.
                  </span>
                </label>

                <label className="stockConfirm">
                  <input name="allowSimilarProduct" type="checkbox" />
                  <span>
                    I checked current stock and this similar product is
                    genuinely different.
                  </span>
                </label>
              </div>

              <button
                className="stockPrimaryButton"
                disabled={openingPending}
                type="submit"
              >
                {openingPending ? "Saving…" : "Add opening stock"}
              </button>

              <p className="stockFinePrint">
                Later physical corrections should use Adjust on the inventory
                row so the original opening entry remains auditable.
              </p>
            </form>
          </section>
        </div>

        <button
          aria-controls="stock-add-sheet"
          aria-expanded={isAddSheetOpen}
          className="stockAddFab"
          onClick={openAddSheet}
          ref={addButtonRef}
          type="button"
        >
          <span aria-hidden="true">+</span>
          Add stock
        </button>

        <button
          aria-label="Close add stock"
          className={
            "stockSheetBackdrop" +
            (isAddSheetOpen ? " stockSheetBackdropOpen" : "")
          }
          onClick={closeAddSheet}
          tabIndex={isAddSheetOpen ? 0 : -1}
          type="button"
        />
      </div>
    </main>
  );
}
