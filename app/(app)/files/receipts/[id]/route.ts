import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** View a receipt file via a 60-second signed URL. RLS decides visibility. */
export async function GET(request: NextRequest, ctx: RouteContext<"/files/receipts/[id]">) {
  const { id } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!UUID.test(id) || !(user.permissions.has("requisitions.view") || user.permissions.has("receipts.reconcile"))) {
    return new NextResponse("Not found", { status: 404 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: file } = await supabase.from("receipt_files").select("storage_path, original_filename").eq("id", id).maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });
  const { data } = await supabase.storage.from("receipts").createSignedUrl(file.storage_path as string, 60);
  if (!data?.signedUrl) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
