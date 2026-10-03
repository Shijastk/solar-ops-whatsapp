import { deterministicUuid } from "@/lib/idempotency";
import { sendOpsList, sendOpsReply } from "@/lib/replies";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { NormalizedWhatsAppMessage } from "@/lib/whatsapp";

type TripStatus =
  | "collecting"
  | "closing"
  | "awaiting_driver"
  | "awaiting_driver_name"
  | "ready"
  | "cancelled";

type TripRow = {
  id: string;
  sender_phone: string;
  status: TripStatus;
  display_name: string | null;
  primary_destination: string | null;
  destination_pincode: string | null;
  destination_district: string | null;
  destination_state: string | null;
  vehicle_number: string | null;
  driver_id: string | null;
};

type TripDocumentRow = {
  trip_id: string;
  message_id: string;
  draft_id: string | null;
  processing_status: "pending" | "parsed" | "failed";
  error_code: string | null;
};

type TripDraftRow = {
  id: string;
  workflow_status: string;
  verification_status: string;
  parse_status: string;
  destination: string | null;
  consignee_pincode: string | null;
  buyer_pincode: string | null;
  vehicle_number: string | null;
  document_number: string | null;
  consignee_name: string | null;
};

type PincodeLocation = {
  district: string | null;
  state: string | null;
  postOffice: string | null;
};

export type TripTextCommand = "menu" | "start" | "done" | "cancel" | null;

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}'"“”‘’]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyTripTextCommand(value: string): TripTextCommand {
  const text = normalizeText(value);
  if (!text) return null;

  const menuWords = new Set([
    "hi",
    "hai",
    "hello",
    "hey",
    "menu",
    "ഹായ്",
    "ഹലോ",
  ]);
  if (menuWords.has(text)) return "menu";

  const startWords = new Set([
    "trip",
    "new trip",
    "start trip",
    "ട്രിപ്പ്",
    "ന്യൂ ട്രിപ്പ്",
    "പുതിയ ട്രിപ്പ്",
  ]);
  if (startWords.has(text)) return "start";

  const cancelWords = new Set([
    "cancel",
    "cancel trip",
    "trip cancel",
    "റദ്ദാക്കുക",
    "ട്രിപ്പ് റദ്ദാക്കുക",
  ]);
  if (cancelWords.has(text)) return "cancel";

  const doneExact = new Set([
    "done",
    "complete",
    "completed",
    "finish",
    "finished",
    "ready",
    "ok",
    "okay",
    "ശരി",
    "ഓക്കെ",
    "കഴിഞ്ഞു",
    "തീർന്നു",
    "പൂർത്തിയായി",
  ]);
  if (doneExact.has(text)) return "done";

  if (
    text.length <= 60 &&
    /\b(done|complete|completed|finish|finished|ready)\b/.test(text)
  ) {
    return "done";
  }

  return null;
}

export function normalizeDriverName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayCase(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact !== compact.toUpperCase()) return compact;
  return compact
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, prefix: string, letter: string) =>
      prefix + letter.toUpperCase(),
    );
}

function cleanDestination(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .normalize("NFKC")
    .replace(/\b[1-9][0-9]{5}\b/g, " ")
    .replace(/\b(?:kerala|state)\b/gi, " ")
    .replace(/[|,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? displayCase(cleaned) : null;
}

function normalizePincode(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.normalize("NFKC").match(/\b([1-9][0-9]{5})\b/);
  return match?.[1] ?? null;
}

function extractPincodeFromDraft(draft: TripDraftRow): string | null {
  return (
    normalizePincode(draft.consignee_pincode) ??
    normalizePincode(draft.buyer_pincode) ??
    normalizePincode(draft.destination)
  );
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function parseIndiaPostPincodeCsv(
  csv: string,
): PincodeLocation | null {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;

  const header = parseCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const districtIndex = header.findIndex((cell) =>
    ["districtname", "district"].includes(cell),
  );
  const stateIndex = header.findIndex((cell) =>
    ["statename", "state"].includes(cell),
  );
  const officeIndex = header.findIndex((cell) =>
    ["officename", "office"].includes(cell),
  );

  if (districtIndex < 0 && stateIndex < 0) return null;

  const rows = lines.slice(1).map(parseCsvLine);
  const nonEmpty = rows.find((row) => row.some(Boolean));
  if (!nonEmpty) return null;

  const mode = (index: number): string | null => {
    if (index < 0) return null;
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = row[index]?.trim();
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return (
      [...counts.entries()].sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      )[0]?.[0] ?? null
    );
  };

  return {
    district: mode(districtIndex),
    state: mode(stateIndex),
    postOffice:
      officeIndex >= 0 ? nonEmpty[officeIndex]?.trim() || null : null,
  };
}

async function resolvePincodeLocation(
  pincode: string | null,
): Promise<PincodeLocation | null> {
  if (!pincode) return null;
  const supabase = getSupabaseAdmin();

  const { data: cached, error: cacheError } = await supabase
    .from("trip_pincode_cache")
    .select("district, state, post_office")
    .eq("pincode", pincode)
    .maybeSingle();

  if (cacheError) {
    console.warn("Trip pincode cache lookup failed", {
      reason: cacheError.message.slice(0, 160),
    });
  } else if (cached) {
    return {
      district: cached.district,
      state: cached.state,
      postOffice: cached.post_office,
    };
  }

  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/IndiaPost/pin/master/api/v01/csv/" +
        encodeURIComponent(pincode) +
        ".csv",
      {
        cache: "no-store",
        signal: AbortSignal.timeout(1800),
      },
    );

    if (!response.ok) return null;
    const parsed = parseIndiaPostPincodeCsv(await response.text());
    if (!parsed) return null;

    const { error: saveError } = await supabase
      .from("trip_pincode_cache")
      .upsert({
        pincode,
        district: parsed.district,
        state: parsed.state,
        post_office: parsed.postOffice,
        source: "IndiaPost/pin",
        updated_at: new Date().toISOString(),
      });

    if (saveError) {
      console.warn("Trip pincode cache save failed", {
        reason: saveError.message.slice(0, 160),
      });
    }

    return parsed;
  } catch {
    return null;
  }
}

export function buildTripDisplayName(input: {
  destination: string | null;
  pincode: string | null;
  district: string | null;
  additionalStops?: number;
}): string {
  const destination = cleanDestination(input.destination);
  const district = input.district ? displayCase(input.district) : null;

  let base = destination || district || (input.pincode ? "PIN " + input.pincode : "Trip");

  if (
    destination &&
    district &&
    !normalizeText(destination).includes(normalizeText(district))
  ) {
    base += " · " + district;
  }

  const additionalStops = Math.max(0, input.additionalStops ?? 0);
  if (additionalStops > 0) {
    base += " + " + additionalStops + " stop" + (additionalStops === 1 ? "" : "s");
  }

  return base.slice(0, 160);
}

async function loadActiveTrip(senderPhone: string): Promise<TripRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("delivery_trips")
    .select(
      "id, sender_phone, status, display_name, primary_destination, destination_pincode, destination_district, destination_state, vehicle_number, driver_id",
    )
    .eq("sender_phone", senderPhone)
    .in("status", [
      "collecting",
      "closing",
      "awaiting_driver",
      "awaiting_driver_name",
    ])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error("Failed to load active trip: " + error.message);
  return (data as TripRow | null) ?? null;
}

async function loadTripForSender(
  tripId: string,
  senderPhone: string,
): Promise<TripRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("delivery_trips")
    .select(
      "id, sender_phone, status, display_name, primary_destination, destination_pincode, destination_district, destination_state, vehicle_number, driver_id",
    )
    .eq("id", tripId)
    .eq("sender_phone", senderPhone)
    .maybeSingle();

  if (error) throw new Error("Failed to load trip: " + error.message);
  return (data as TripRow | null) ?? null;
}

async function sendHomeMenu(
  storedMessageId: string,
  knownInboundAt?: string | Date,
) {
  await sendOpsList({
    requestId: deterministicUuid("trip-home-menu:" + storedMessageId),
    replyToMessageId: storedMessageId,
    body:
      "☀️ Solar Ops\nBills, trips, stock — godown daily work എളുപ്പമായി manage ചെയ്യാം.",
    buttonText: "Open menu",
    sectionTitle: "Solar Ops",
    knownInboundAt,
    rows: [
      {
        id: "so:menu:new_trip",
        title: "New Trip",
        description: "Bills തുടർച്ചയായി collect ചെയ്യുക",
      },
      {
        id: "so:menu:stock",
        title: "Stock",
        description: "Stock balance ചോദിക്കുക / stock add ചെയ്യുക",
      },
      {
        id: "so:menu:bills",
        title: "Bills",
        description: "PDF bill നേരിട്ട് അയക്കാം",
      },
      {
        id: "so:menu:more",
        title: "More",
        description: "Quick commands കാണുക",
      },
    ],
  });
}

async function startTrip(
  message: NormalizedWhatsAppMessage,
  storedMessageId: string,
) {
  const existing = await loadActiveTrip(message.senderPhone);
  if (existing) {
    const stateText =
      existing.status === "collecting"
        ? "Bills collect ചെയ്യുകയാണ്."
        : existing.status === "closing"
          ? "Bills process ചെയ്യുകയാണ്."
          : existing.status === "awaiting_driver_name"
            ? "പുതിയ driver-ന്റെ പേര് കാത്തിരിക്കുകയാണ്."
            : "Driver തിരഞ്ഞെടുക്കാൻ കാത്തിരിക്കുകയാണ്.";

    await sendOpsReply({
      requestId: deterministicUuid("trip-already-open:" + storedMessageId),
      replyToMessageId: storedMessageId,
      body:
        "🚚 ഒരു trip ഇതിനകം open ആണ്. " +
        stateText +
        (existing.status === "collecting"
          ? " PDF bills തുടർച്ചയായി അയക്കൂ; കഴിഞ്ഞാൽ done എന്ന് അയക്കൂ."
          : ""),
      knownInboundAt: message.timestamp,
    });
    return;
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("delivery_trips").insert({
    sender_phone: message.senderPhone,
    status: "collecting",
    started_by_message_id: storedMessageId,
  });

  if (error) throw new Error("Failed to create trip: " + error.message);

  await sendOpsReply({
    requestId: deterministicUuid("trip-opened:" + storedMessageId),
    replyToMessageId: storedMessageId,
    body:
      "🚚 New Trip തുറന്നു. ഇനി PDF bills തുടർച്ചയായി അയക്കൂ — ഓരോ bill-നും reply കാത്തിരിക്കേണ്ട. എല്ലാം അയച്ച ശേഷം done / ശരി / complete എന്ന് അയക്കൂ.",
    knownInboundAt: message.timestamp,
  });
}

export async function reserveTripDocument(input: {
  senderPhone: string;
  messageId: string;
}): Promise<string | null> {
  const trip = await loadActiveTrip(input.senderPhone);
  if (!trip || trip.status !== "collecting") return null;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("trip_documents").insert({
    trip_id: trip.id,
    message_id: input.messageId,
    processing_status: "pending",
  });

  if (error && error.code !== "23505") {
    throw new Error("Failed to reserve trip document: " + error.message);
  }

  return trip.id;
}

async function loadTripDocuments(tripId: string): Promise<TripDocumentRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("trip_documents")
    .select("trip_id, message_id, draft_id, processing_status, error_code")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });

  if (error) throw new Error("Failed to load trip documents: " + error.message);
  return (data ?? []) as TripDocumentRow[];
}

async function loadTripDrafts(ids: string[]): Promise<TripDraftRow[]> {
  if (ids.length === 0) return [];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("document_drafts")
    .select(
      "id, workflow_status, verification_status, parse_status, destination, consignee_pincode, buyer_pincode, vehicle_number, document_number, consignee_name",
    )
    .in("id", ids);

  if (error) throw new Error("Failed to load trip bill drafts: " + error.message);

  const byId = new Map(
    ((data ?? []) as TripDraftRow[]).map((draft) => [draft.id, draft]),
  );
  return ids
    .map((id) => byId.get(id))
    .filter((draft): draft is TripDraftRow => Boolean(draft));
}

export function choosePrimaryDestination(
  values: Array<string | null>,
): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;

  for (const value of values) {
    const compact = value?.trim();
    if (!compact) continue;

    const count = (counts.get(compact) ?? 0) + 1;
    counts.set(compact, count);

    // Strictly greater preserves the first-uploaded destination when counts tie.
    if (count > bestCount) {
      best = compact;
      bestCount = count;
    }
  }

  return best;
}

async function sendDriverPicker(
  trip: TripRow,
  replyToMessageId: string,
  totalBills: number,
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ops_drivers")
    .select("id, name")
    .eq("active", true)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true })
    .limit(8);

  if (error) throw new Error("Failed to load drivers: " + error.message);

  await sendOpsList({
    requestId: deterministicUuid("trip-driver-picker:" + trip.id),
    replyToMessageId,
    body:
      "🚚 " +
      (trip.display_name ?? "Trip") +
      "\nBills: " +
      totalBills +
      (trip.vehicle_number ? "\nVehicle: " + trip.vehicle_number : "") +
      "\n\nDriver തിരഞ്ഞെടുക്കൂ.",
    buttonText: "Choose driver",
    sectionTitle: "Drivers",
    rows: [
      ...(data ?? []).map((driver) => ({
        id: "so:trip:driver:" + trip.id + ":" + driver.id,
        title: driver.name.slice(0, 24),
      })),
      {
        id: "so:trip:new_driver:" + trip.id,
        title: "+ New Driver",
        description: "പേര് ഒരിക്കൽ add ചെയ്യുക",
      },
    ],
  });
}

async function sendTripReadySummary(
  trip: TripRow,
  replyToMessageId: string,
) {
  const supabase = getSupabaseAdmin();
  const docs = await loadTripDocuments(trip.id);
  const drafts = await loadTripDrafts(
    docs.map((doc) => doc.draft_id).filter((id): id is string => Boolean(id)),
  );
  const ready = drafts.filter(
    (draft) =>
      draft.workflow_status === "recorded" &&
      draft.verification_status === "verified",
  ).length;
  const review = drafts.filter(
    (draft) => draft.workflow_status === "review_required",
  ).length;

  let driverName: string | null = null;
  if (trip.driver_id) {
    const { data: driver, error } = await supabase
      .from("ops_drivers")
      .select("name")
      .eq("id", trip.driver_id)
      .maybeSingle();
    if (error) {
      throw new Error("Failed to load trip driver summary: " + error.message);
    }
    driverName = driver?.name ?? null;
  }

  await sendOpsReply({
    requestId: deterministicUuid("trip-ready:" + trip.id),
    replyToMessageId,
    body:
      "✅ Trip ready\n" +
      (trip.display_name ?? "Trip") +
      "\nBills: " +
      docs.length +
      (driverName ? "\nDriver: " + driverName : "") +
      (trip.vehicle_number ? "\nVehicle: " + trip.vehicle_number : "") +
      (review > 0 ? "\n⚠️ " + review + " bill needs review" : "") +
      (ready > 0 ? "\n✅ " + ready + " bill verified" : ""),
  });
}

async function finalizeTripCollection(
  tripId: string,
  replyToMessageId: string,
): Promise<"waiting" | "finalized" | "empty"> {
  const supabase = getSupabaseAdmin();
  const docs = await loadTripDocuments(tripId);
  if (docs.length === 0) return "empty";

  const pending = docs.filter((doc) => doc.processing_status === "pending").length;
  if (pending > 0) return "waiting";

  const draftIds = docs
    .map((doc) => doc.draft_id)
    .filter((id): id is string => Boolean(id));
  const drafts = await loadTripDrafts(draftIds);

  const destinations = drafts.map((draft) => cleanDestination(draft.destination));
  const primaryDestination = choosePrimaryDestination(destinations);
  const primaryDraft =
    drafts.find(
      (draft) => cleanDestination(draft.destination) === primaryDestination,
    ) ?? drafts[0] ?? null;
  const primaryPincode = primaryDestination
    ? primaryDraft
      ? extractPincodeFromDraft(primaryDraft)
      : null
    : choosePrimaryDestination(
        drafts.map((draft) => extractPincodeFromDraft(draft)),
      );
  const pincodeLocation = primaryDestination
    ? null
    : await resolvePincodeLocation(primaryPincode);

  const uniqueDestinations = new Set(destinations.filter(Boolean));
  const displayName = buildTripDisplayName({
    destination: primaryDestination,
    pincode: primaryPincode,
    district: pincodeLocation?.district ?? null,
    additionalStops: Math.max(0, uniqueDestinations.size - 1),
  });

  const vehicleNumbers = Array.from(
    new Set(
      drafts
        .map((draft) => draft.vehicle_number?.trim().toUpperCase())
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const vehicleNumber = vehicleNumbers.length === 1 ? vehicleNumbers[0] : null;

  const current = await loadTripForSender(
    tripId,
    (await supabase
      .from("delivery_trips")
      .select("sender_phone")
      .eq("id", tripId)
      .single()).data?.sender_phone ?? "",
  );
  if (!current) {
    throw new Error("Trip disappeared while finalizing");
  }

  const nextStatus: TripStatus = current.driver_id
    ? "ready"
    : current.status === "awaiting_driver_name"
      ? "awaiting_driver_name"
      : "awaiting_driver";

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("delivery_trips")
    .update({
      status: nextStatus,
      display_name: displayName,
      primary_destination: primaryDestination,
      destination_pincode: primaryPincode,
      destination_district: pincodeLocation?.district ?? null,
      destination_state: pincodeLocation?.state ?? null,
      vehicle_number: vehicleNumber,
      finalized_at: nextStatus === "ready" ? now : null,
      updated_at: now,
    })
    .eq("id", tripId)
    .select(
      "id, sender_phone, status, display_name, primary_destination, destination_pincode, destination_district, destination_state, vehicle_number, driver_id",
    )
    .single();

  if (error) throw new Error("Failed to finalize trip bills: " + error.message);

  if (nextStatus === "ready") {
    await sendTripReadySummary(updated as TripRow, replyToMessageId);
  }

  return "finalized";
}

export async function markTripDocumentProcessed(input: {
  messageId: string;
  draftId?: string | null;
  failed?: boolean;
  errorCode?: string | null;
  replyToMessageId: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data: current, error: readError } = await supabase
    .from("trip_documents")
    .select("trip_id")
    .eq("message_id", input.messageId)
    .maybeSingle();

  if (readError) {
    throw new Error("Failed to load trip document reservation: " + readError.message);
  }
  if (!current) return;

  const { error } = await supabase
    .from("trip_documents")
    .update({
      draft_id: input.draftId ?? null,
      processing_status: input.failed ? "failed" : "parsed",
      error_code: input.errorCode ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("message_id", input.messageId);

  if (error) throw new Error("Failed to update trip document: " + error.message);

  const { data: trip, error: tripError } = await supabase
    .from("delivery_trips")
    .select("status")
    .eq("id", current.trip_id)
    .maybeSingle();
  if (tripError) throw new Error("Failed to inspect closing trip: " + tripError.message);

  if (trip?.status === "closing") {
    await finalizeTripCollection(current.trip_id, input.replyToMessageId);
  }
}

async function closeTripCollection(
  message: NormalizedWhatsAppMessage,
  storedMessageId: string,
) {
  const trip = await loadActiveTrip(message.senderPhone);
  if (!trip) {
    await sendOpsReply({
      requestId: deterministicUuid("trip-done-no-active:" + storedMessageId),
      replyToMessageId: storedMessageId,
      knownInboundAt: message.timestamp,
      body: "Open trip ഒന്നുമില്ല. പുതിയ trip തുടങ്ങാൻ trip എന്ന് അയക്കൂ.",
    });
    return;
  }

  const docs = await loadTripDocuments(trip.id);

  if (trip.status === "awaiting_driver") {
    await sendDriverPicker(trip, storedMessageId, docs.length);
    return;
  }

  if (trip.status === "awaiting_driver_name") {
    await sendOpsReply({
      requestId: deterministicUuid("trip-driver-name-reminder:" + storedMessageId),
      replyToMessageId: storedMessageId,
      knownInboundAt: message.timestamp,
      body: "പുതിയ driver-ന്റെ പേര് അയക്കൂ.",
    });
    return;
  }

  if (trip.status === "closing") {
    await sendOpsReply({
      requestId: deterministicUuid("trip-driver-already-set:" + storedMessageId),
      replyToMessageId: storedMessageId,
      knownInboundAt: message.timestamp,
      body: "✅ Driver already set. Trip automatically complete ചെയ്യും.",
    });
    return;
  }

  if (trip.status !== "collecting") return;

  if (docs.length === 0) {
    await sendOpsReply({
      requestId: deterministicUuid("trip-empty:" + storedMessageId),
      replyToMessageId: storedMessageId,
      knownInboundAt: message.timestamp,
      body: "ഈ trip-ൽ bill ഒന്നും ലഭിച്ചിട്ടില്ല. PDF bills അയച്ച ശേഷം done എന്ന് അയക്കൂ.",
    });
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: updated, error } = await supabase
    .from("delivery_trips")
    .update({
      status: "awaiting_driver",
      updated_at: new Date().toISOString(),
    })
    .eq("id", trip.id)
    .eq("status", "collecting")
    .select(
      "id, sender_phone, status, display_name, primary_destination, destination_pincode, destination_district, destination_state, vehicle_number, driver_id",
    )
    .single();

  if (error) throw new Error("Failed to close trip collection: " + error.message);

  // Ask for the driver immediately. Bill parsing/verification continues in the background.
  await sendDriverPicker(updated as TripRow, storedMessageId, docs.length);
}

async function cancelTrip(message: NormalizedWhatsAppMessage, storedMessageId: string) {
  const trip = await loadActiveTrip(message.senderPhone);
  if (!trip) return;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("delivery_trips")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", trip.id)
    .neq("status", "ready");

  if (error) throw new Error("Failed to cancel trip: " + error.message);

  await sendOpsReply({
    requestId: deterministicUuid("trip-cancelled:" + storedMessageId),
    replyToMessageId: storedMessageId,
    body: "Trip cancelled. Bills/stock history delete ചെയ്തിട്ടില്ല.",
    knownInboundAt: message.timestamp,
  });
}

async function assignDriver(input: {
  trip: TripRow;
  driverId: string;
  replyToMessageId: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data: driver, error: driverError } = await supabase
    .from("ops_drivers")
    .select("id, name")
    .eq("id", input.driverId)
    .eq("active", true)
    .maybeSingle();

  if (driverError) throw new Error("Failed to load driver: " + driverError.message);
  if (!driver) throw new Error("Driver was not found");

  const docs = await loadTripDocuments(input.trip.id);
  const pending = docs.filter((doc) => doc.processing_status === "pending").length;
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("delivery_trips")
    .update({
      status: "closing",
      driver_id: driver.id,
      updated_at: now,
    })
    .eq("id", input.trip.id)
    .in("status", ["awaiting_driver", "awaiting_driver_name"]);

  if (error) throw new Error("Failed to assign trip driver: " + error.message);

  await supabase
    .from("ops_drivers")
    .update({ last_used_at: now, updated_at: now })
    .eq("id", driver.id);

  if (pending > 0) {
    await sendOpsReply({
      requestId: deterministicUuid(
        "trip-driver-set:" + input.trip.id + ":" + driver.id,
      ),
      replyToMessageId: input.replyToMessageId,
      body: "✅ Driver: " + driver.name + " set.",
    });
    return;
  }

  await finalizeTripCollection(input.trip.id, input.replyToMessageId);
}

async function promptNewDriver(
  trip: TripRow,
  replyToMessageId: string,
) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("delivery_trips")
    .update({
      status: "awaiting_driver_name",
      updated_at: new Date().toISOString(),
    })
    .eq("id", trip.id)
    .eq("status", "awaiting_driver");

  if (error) throw new Error("Failed to request new driver name: " + error.message);

  await sendOpsReply({
    requestId: deterministicUuid("trip-new-driver:" + trip.id),
    replyToMessageId,
    body: "Driver-ന്റെ പേര് മാത്രം അയക്കൂ. ഒരിക്കൽ save ചെയ്താൽ അടുത്ത trip മുതൽ list-ൽ കാണും.",
  });
}

async function createAndAssignDriver(
  trip: TripRow,
  nameInput: string,
  replyToMessageId: string,
) {
  const name = nameInput.normalize("NFKC").replace(/\s+/g, " ").trim();
  const normalizedName = normalizeDriverName(name);
  if (!normalizedName || name.length > 120) {
    await sendOpsReply({
      requestId: deterministicUuid("trip-driver-invalid:" + replyToMessageId),
      replyToMessageId,
      body: "Driver പേര് വ്യക്തമായി അയക്കൂ.",
    });
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: existing, error: existingError } = await supabase
    .from("ops_drivers")
    .select("id, name")
    .eq("normalized_name", normalizedName)
    .maybeSingle();

  if (existingError) {
    throw new Error("Failed to check driver identity: " + existingError.message);
  }

  let driver = existing;
  if (!driver) {
    const { data: created, error } = await supabase
      .from("ops_drivers")
      .insert({ name, normalized_name: normalizedName })
      .select("id, name")
      .single();
    if (error) throw new Error("Failed to save driver: " + error.message);
    driver = created;
  }

  await assignDriver({
    trip,
    driverId: driver.id,
    replyToMessageId,
  });
}

async function handleMenuAction(
  id: string,
  storedMessageId: string,
  knownInboundAt?: string | Date,
) {
  if (id === "so:menu:stock") {
    await sendOpsReply({
      requestId: deterministicUuid("menu-stock:" + storedMessageId),
      replyToMessageId: storedMessageId,
      knownInboundAt,
      body:
        "📦 Stock\nProduct name + stock എന്ന് ചോദിക്കാം. ഉദാ: Emmvee 560 panel stock ethra. Stock add ചെയ്യുന്നത് Solar Ops mobile app-ൽ.",
    });
    return true;
  }
  if (id === "so:menu:bills") {
    await sendOpsReply({
      requestId: deterministicUuid("menu-bills:" + storedMessageId),
      replyToMessageId: storedMessageId,
      knownInboundAt,
      body:
        "📄 Bills\nPDF bill നേരിട്ട് അയക്കാം. Open trip ഉണ്ടെങ്കിൽ അതിലേക്ക് attach ചെയ്യും; ഇല്ലെങ്കിൽ standalone bill ആയി process ചെയ്യും.",
    });
    return true;
  }
  if (id === "so:menu:more") {
    await sendOpsReply({
      requestId: deterministicUuid("menu-more:" + storedMessageId),
      replyToMessageId: storedMessageId,
      knownInboundAt,
      body:
        "Quick commands:\ntrip — പുതിയ trip\ndone / ശരി — trip bills complete\nHi — menu\nStock questions നേരിട്ട് type ചെയ്യാം.\nഈ ആഴ്ച / മാസം / വർഷം summary എന്നും ചോദിക്കാം.",
    });
    return true;
  }
  return false;
}

export async function handleTripWorkflowInbound(
  message: NormalizedWhatsAppMessage,
  storedMessageId: string,
): Promise<"handled" | "ignored"> {
  const interactiveId = message.interactiveReply?.id ?? null;

  if (interactiveId === "so:menu:new_trip") {
    await startTrip(message, storedMessageId);
    return "handled";
  }
  if (
    interactiveId &&
    (await handleMenuAction(interactiveId, storedMessageId, message.timestamp))
  ) {
    return "handled";
  }

  if (interactiveId?.startsWith("so:trip:driver:")) {
    const parts = interactiveId.split(":");
    if (parts.length !== 5) return "ignored";
    const trip = await loadTripForSender(parts[3], message.senderPhone);
    if (!trip || trip.status !== "awaiting_driver") return "ignored";
    await assignDriver({
      trip,
      driverId: parts[4],
      replyToMessageId: storedMessageId,
    });
    return "handled";
  }

  if (interactiveId?.startsWith("so:trip:new_driver:")) {
    const parts = interactiveId.split(":");
    if (parts.length !== 4) return "ignored";
    const trip = await loadTripForSender(parts[3], message.senderPhone);
    if (!trip || trip.status !== "awaiting_driver") return "ignored";
    await promptNewDriver(trip, storedMessageId);
    return "handled";
  }

  if (message.type !== "text" || !message.textBody) return "ignored";

  const active = await loadActiveTrip(message.senderPhone);
  const command = classifyTripTextCommand(message.textBody);

  if (active?.status === "awaiting_driver_name" && command !== "cancel") {
    await createAndAssignDriver(active, message.textBody, storedMessageId);
    return "handled";
  }

  if (command === "menu") {
    await sendHomeMenu(storedMessageId, message.timestamp);
    return "handled";
  }
  if (command === "start") {
    await startTrip(message, storedMessageId);
    return "handled";
  }
  if (command === "done") {
    await closeTripCollection(message, storedMessageId);
    return "handled";
  }
  if (command === "cancel") {
    await cancelTrip(message, storedMessageId);
    return "handled";
  }

  return "ignored";
}
