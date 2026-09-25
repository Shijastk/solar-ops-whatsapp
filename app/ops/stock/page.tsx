import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  OPS_SESSION_COOKIE,
  verifyOpsSession,
} from "@/lib/ops-auth";
import {
  listStockBalances,
  listStockCompanies,
} from "@/lib/stock";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stock | Solar Ops",
  robots: {
    index: false,
    follow: false,
  },
};

function formatQuantity(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const cookieStore = await cookies();
  if (!verifyOpsSession(cookieStore.get(OPS_SESSION_COOKIE)?.value)) {
    redirect("/ops/login");
  }

  const params = await searchParams;
  const [companies, balances] = await Promise.all([
    listStockCompanies(),
    listStockBalances(),
  ]);

  return (
    <main className="stockShell">
      <header className="stockTopbar">
        <div>
          <span className="stockEyebrow">SOLAR OPS</span>
          <h1>Opening stock</h1>
          <p>
            Add each product once. Future verified outgoing bills deduct from
            this ledger automatically.
          </p>
        </div>
        <Link className="stockBack" href="/ops">
          Back to WhatsApp
        </Link>
      </header>

      {params.result ? (
        <div className="stockNotice" role="status">
          {params.result === "opening_created"
            ? "Opening stock saved."
            : params.result === "opening_exists"
              ? "Opening stock already exists for that product. It was not overwritten."
              : params.result === "invalid_item"
                ? "Opening stock was not saved because the values were invalid."
                : params.result === "inconsistent"
                  ? "Opening stock was blocked because the company/product data conflicted."
                  : params.result === "potential_company_duplicate"
                    ? "A very similar company already exists. Select the existing company, or explicitly confirm below that this is a different company."
                    : params.result === "potential_product_duplicate"
                      ? "A very similar product already exists for this company/unit. Check Current stock first. Only override if this is genuinely a different product."
                      : params.result === "invalid_gstin"
                        ? "GSTIN is invalid after removing spaces/separators. Enter the 15-character GSTIN or leave it blank."
                        : params.result === "company_required"
                          ? "Select an existing company or enter a new company name."
                          : params.result === "product_required"
                            ? "Product name is required."
                            : params.result === "invalid_unit"
                              ? "Unit is invalid."
                              : params.result === "invalid_hsn"
                                ? "HSN / SAC is invalid."
                                : params.result === "failed"
                                  ? "Opening stock could not be saved. Check the entered values and try again."
                                  : params.result.replaceAll("_", " ")}
        </div>
      ) : null}

      <section className="stockGrid">
        <form
          action="/api/ops/stock/opening"
          className="stockCard stockForm"
          method="post"
        >
          <div>
            <span className="stockEyebrow">ONE-TIME SETUP</span>
            <h2>Add opening quantity</h2>
            <p>
              Use an existing company where possible. New product spelling
              becomes the canonical stock name.
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
                maxLength={40}
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

          <button className="stockPrimary" type="submit">
            Save opening stock
          </button>

          <p className="stockFinePrint">
            Existing opening stock is never silently overwritten. A spelling
            variation in a future bill must match an approved alias before
            stock can move.
          </p>
        </form>

        <section className="stockCard stockBalances">
          <div>
            <span className="stockEyebrow">CURRENT LEDGER</span>
            <h2>Current stock</h2>
            <p>{balances.length} configured product(s)</p>
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
                  </tr>
                </thead>
                <tbody>
                  {balances.map((balance) => (
                    <tr key={balance.product_id}>
                      <td>{balance.company_name}</td>
                      <td>{balance.product_name}</td>
                      <td>{balance.hsn_sac || "—"}</td>
                      <td>
                        <strong>{formatQuantity(balance.current_quantity)}</strong>{" "}
                        {balance.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
