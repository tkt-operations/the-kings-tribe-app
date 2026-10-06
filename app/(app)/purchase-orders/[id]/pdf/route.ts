import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Download a stored PO PDF via a 60-second signed URL (bucket is private). */
export async function GET(request: NextRequest, ctx: RouteContext<"/purchase-orders/[id]/pdf">) {
  const { id } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!user.permissions.has("requisitions.view") || !UUID.test(id)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data: po } = await supabase.from("purchase_orders").select("pdf_path, po_number").eq("id", id).maybeSingle();
  if (!po?.pdf_path) return new NextResponse("Not found", { status: 404 });
  const { data } = await supabase.storage.from("purchase-orders").createSignedUrl(po.pdf_path as string, 60, { download: `${po.po_number}.pdf` });
  if (!data?.signedUrl) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
