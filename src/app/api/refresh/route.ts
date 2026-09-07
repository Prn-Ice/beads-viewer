import { clearCache } from "@/lib/cache";

export async function POST() {
  clearCache();
  return Response.json({ ok: true });
}
