import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const profileSchema = z
  .object({
    action: z.literal("company_profile"),
    companyId: z.uuid(),
    label: z.string().trim().min(1).max(200).optional(),
    photo: z.string().max(131072).nullable().optional(),
  })
  .refine((b) => b.label !== undefined || b.photo !== undefined);

export function validProfilePhoto(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64");
  return (
    bytes.length <= 98304 &&
    bytes.length >= 33 &&
    bytes.toString("base64") === value &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(16) <= 256 &&
    bytes.readUInt32BE(20) > 0 &&
    bytes.readUInt32BE(20) <= 256
  );
}
export async function getMobileProfile(id: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("stock_companies")
    .select("id,canonical_name,gstin,profile_label,photo_png")
    .eq("id", id)
    .eq("active", true)
    .single();
  if (error) throw new Error("Company profile unavailable");
  return {
    id: data.id,
    name: data.canonical_name,
    gstin: data.gstin,
    label: data.profile_label ?? data.canonical_name,
    photo: data.photo_png,
  };
}
export async function saveMobileProfile(b: z.infer<typeof profileSchema>) {
  if (b.photo && !validProfilePhoto(b.photo))
    throw new Error("Choose a small PNG photo (up to 256 × 256)");
  const { error } = await getSupabaseAdmin()
    .from("stock_companies")
    .update({
      ...(b.label !== undefined ? { profile_label: b.label } : {}),
      ...(b.photo !== undefined ? { photo_png: b.photo } : {}),
    })
    .eq("id", b.companyId)
    .eq("active", true);
  if (error) throw new Error("Could not save company profile");
  return getMobileProfile(b.companyId);
}
