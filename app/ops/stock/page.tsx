import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  OPS_SESSION_COOKIE,
  verifyOpsSession,
} from "@/lib/ops-auth";
import {
  listStockBalances,
  listStockCompanies,
} from "@/lib/stock";
import StockManager from "./stock-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stock | Solar Ops",
  robots: {
    index: false,
    follow: false,
  },
};

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
    <StockManager
      balances={balances}
      companies={companies}
      initialResult={params.result}
    />
  );
}
