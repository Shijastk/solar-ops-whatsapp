export type MobileTripItem = {
  productName: string;
  quantity: number;
  unit: string;
  companyId: string | null | undefined;
};

/**
 * Combine repeated bill lines for the trip summary without crossing company or
 * unit boundaries. Original bill records remain available separately for audit.
 */
export function aggregateMobileTripItems(items: MobileTripItem[]) {
  const aggregated = new Map<string, MobileTripItem>();

  for (const item of items) {
    const productName = item.productName.trim();
    const unit = item.unit.trim();
    const companyId = item.companyId ?? null;
    const key = JSON.stringify([
      companyId,
      productName.toLocaleLowerCase(),
      unit.toLocaleLowerCase(),
    ]);
    const existing = aggregated.get(key);

    if (existing) {
      existing.quantity += item.quantity;
    } else {
      aggregated.set(key, { ...item, productName, unit, companyId });
    }
  }

  return [...aggregated.values()];
}
