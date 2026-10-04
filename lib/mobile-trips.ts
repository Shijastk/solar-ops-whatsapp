import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  cleanDestination,
  choosePrimaryDestination,
  normalizeDriverName,
} from "@/lib/trips";

type TripBill = {
  message_id: string;
  processing_status: string;
  document_drafts: {
    id: string;
    stock_company_id: string | null;
    supplier_gstin: string | null;
    document_number: string | null;
    workflow_status: string;
    stock_status: string;
    destination: string | null;
    vehicle_number: string | null;
    document_items: { description: string; quantity: number; unit: string }[];
  } | null;
};
type Trip = {
  company_id: string | null;
  id: string;
  status: string;
  display_name: string | null;
  driver_id: string | null;
  vehicle_number: string | null;
  created_at: string;
  entry_mode: string;
  site_count: number;
  owner_name: string | null;
  manual_trip_items: {
    quantity: number;
    stock_products: { id: string; canonical_name: string; unit: string };
  }[];
  ops_drivers: { name: string } | null;
  trip_documents: TripBill[];
};
const selection =
  "company_id,id,status,display_name,driver_id,vehicle_number,created_at,entry_mode,site_count,owner_name,ops_drivers(name),manual_trip_items(quantity,stock_products(id,canonical_name,unit)),trip_documents(message_id,processing_status,document_drafts(id,stock_company_id,supplier_gstin,document_number,workflow_status,stock_status,destination,vehicle_number,document_items(description,quantity,unit)))";
function serializeTrip(t: Trip) {
  return {
    companyId: t.company_id,
    id: t.id,
    status: t.status,
    name: cleanDestination(t.display_name) ?? "Trip",
    driverId: t.driver_id,
    driverName: t.ops_drivers?.name ?? null,
    vehicleNumber: t.vehicle_number,
    createdAt: t.created_at,
    entryMode: t.entry_mode,
    siteCount: t.site_count,
    ownerName: t.owner_name,
    items:
      t.entry_mode === "manual"
        ? (t.manual_trip_items ?? []).map((i) => ({
            productId: i.stock_products.id,
            productName: i.stock_products.canonical_name,
            quantity: Number(i.quantity),
            unit: i.stock_products.unit,
            companyId: t.company_id,
          }))
        : t.trip_documents
            .filter(
              (b) =>
                b.document_drafts?.stock_status !== "duplicate_document" &&
                b.document_drafts?.workflow_status !== "cancelled",
            )
            .flatMap((b) =>
              (b.document_drafts?.document_items ?? []).map((i) => ({
                productName: i.description,
                quantity: Number(i.quantity),
                unit: i.unit,
                companyId: b.document_drafts?.stock_company_id,
              })),
            ),
    bills: t.trip_documents.map((b) => ({
      messageId: b.message_id,
      companyId: b.document_drafts?.stock_company_id ?? null,
      companyGstin: b.document_drafts?.supplier_gstin ?? null,
      number: b.document_drafts?.document_number ?? "Bill",
      needsAttention:
        b.document_drafts?.stock_status !== "duplicate_document" &&
        (b.processing_status !== "parsed" ||
          !b.document_drafts ||
          b.document_drafts.workflow_status !== "recorded" ||
          b.document_drafts.stock_status !== "applied"),
      duplicate: b.document_drafts?.stock_status === "duplicate_document",
    })),
  };
}
export async function getMobileTrip(id: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("delivery_trips")
    .select(selection)
    .eq("id", id)
    .single();
  if (error) throw new Error("Could not load saved trip");
  return serializeTrip(data as unknown as Trip);
}
export async function listMobileTrips() {
  const { data, error } = await getSupabaseAdmin()
    .from("delivery_trips")
    .select(selection)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw new Error("Failed to load trips: " + error.message);
  return ((data ?? []) as unknown as Trip[]).map(serializeTrip);
}

export async function listMobileDrivers() {
  const { data, error } = await getSupabaseAdmin()
    .from("ops_drivers")
    .select("id,name")
    .eq("active", true)
    .order("name");
  if (error) throw new Error("Failed to load drivers: " + error.message);
  return data ?? [];
}
export async function saveMobileDriver(name: string) {
  const normalized = normalizeDriverName(name);
  if (!normalized) throw new Error("Enter a driver name");
  const { data, error } = await getSupabaseAdmin()
    .from("ops_drivers")
    .upsert(
      { name: name.trim(), normalized_name: normalized, active: true },
      { onConflict: "normalized_name" },
    )
    .select("id,name")
    .single();
  if (error) throw new Error("Could not save driver");
  return data;
}
export async function createMobileTrip(
  companyId: string | null = null,
  requestId?: string,
) {
  // A distinct capture identity per mobile trip avoids colliding with WhatsApp collection.
  const { data, error } = await getSupabaseAdmin()
    .from("delivery_trips")
    .insert({
      ...(requestId ? { id: requestId } : {}),
      company_id: companyId,
      sender_phone: "mobile:" + crypto.randomUUID(),
      display_name: "New trip",
    })
    .select(selection)
    .single();
  if (error) {
    if (requestId && error.code === "23505") {
      const existing = await getMobileTrip(requestId);
      if (existing.companyId === companyId && existing.entryMode === "bills")
        return existing;
    }
    throw new Error("Could not create trip");
  }
  return serializeTrip(data as unknown as Trip);
}
export async function attachMobileBill(tripId: string, messageId: string) {
  const { error } = await getSupabaseAdmin().rpc("mobile_attach_trip_bill", {
    p_trip_id: tripId,
    p_message_id: messageId,
  });
  if (error) throw new Error(error.message);
}
export async function updateMobileTrip(
  tripId: string,
  driverId: string | null,
  close: boolean,
) {
  const db = getSupabaseAdmin();
  const { error } = await db.rpc("mobile_update_trip", {
    p_trip_id: tripId,
    p_driver_id: driverId,
    p_close: close,
  });
  if (error) throw new Error(error.message);
  if (!close) return;
  const { data, error: loadError } = await db
    .from("delivery_trips")
    .select(selection)
    .eq("id", tripId)
    .single();
  if (loadError) return; // The saved action is authoritative; naming can refresh later.
  const trip = data as unknown as Trip;
  const destinations = trip.trip_documents
    .filter((b) => b.document_drafts?.stock_status !== "duplicate_document")
    .map((b) => cleanDestination(b.document_drafts?.destination));
  const name = choosePrimaryDestination(destinations);
  if (name)
    await db
      .from("delivery_trips")
      .update({ display_name: name })
      .eq("id", tripId);
}
