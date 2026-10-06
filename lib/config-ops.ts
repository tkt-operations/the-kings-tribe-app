import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ActionError, friendlyDbError } from "@/lib/action-result";

/**
 * Swap an item with its neighbour within the same scope and renumber the
 * scope in steps of 10 so ordering stays stable.
 */
export async function moveInScope(
  supabase: SupabaseClient,
  table: string,
  id: string,
  direction: "up" | "down",
  scope: Record<string, string | null>,
): Promise<void> {
  let query = supabase.from(table).select("id, sort_order, name").order("sort_order").order("name");
  for (const [column, value] of Object.entries(scope)) {
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }
  const { data, error } = await query;
  if (error) throw new ActionError(friendlyDbError(error));
  const rows = (data ?? []) as { id: string }[];
  const index = rows.findIndex((r) => r.id === id);
  if (index < 0) throw new ActionError("Item not found.");
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= rows.length) return;
  [rows[index], rows[target]] = [rows[target], rows[index]];
  for (const [i, row] of rows.entries()) {
    const { error: updateError } = await supabase.from(table).update({ sort_order: (i + 1) * 10 }).eq("id", row.id);
    if (updateError) throw new ActionError(friendlyDbError(updateError));
  }
}

export async function nextSortOrder(supabase: SupabaseClient, table: string, scope: Record<string, string | null>): Promise<number> {
  let query = supabase.from(table).select("sort_order").order("sort_order", { ascending: false }).limit(1);
  for (const [column, value] of Object.entries(scope)) {
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }
  const { data } = await query;
  return (((data ?? [])[0] as { sort_order?: number } | undefined)?.sort_order ?? 0) + 10;
}
