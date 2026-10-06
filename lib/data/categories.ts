import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CategoryType = "attendance" | "finance" | "requisition";

export interface CategoryRow {
  id: string;
  type: CategoryType;
  parent_id: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  allows_negative: boolean;
  is_system: boolean;
}

export const CATEGORY_COLUMNS = "id, type, parent_id, name, description, sort_order, is_active, allows_negative, is_system";

export async function listCategories(type?: CategoryType): Promise<CategoryRow[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("categories").select(CATEGORY_COLUMNS).order("sort_order").order("name");
  if (type) query = query.eq("type", type);
  const { data } = await query;
  return (data as CategoryRow[] | null) ?? [];
}

export interface CategoryTreeNode extends CategoryRow {
  children: CategoryRow[];
}

export function buildTree(rows: CategoryRow[]): CategoryTreeNode[] {
  const parents = rows.filter((r) => !r.parent_id).map((r) => ({ ...r, children: [] as CategoryRow[] }));
  const byId = new Map(parents.map((p) => [p.id, p]));
  for (const row of rows) {
    if (row.parent_id) byId.get(row.parent_id)?.children.push(row);
  }
  return parents;
}
