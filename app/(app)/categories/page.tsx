import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { buildTree, listCategories } from "@/lib/data/categories";
import { cn } from "@/lib/cn";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CategoryManager } from "./category-manager";
import { CostCenterManager } from "./cost-center-manager";

export const metadata = { title: "Categories" };

const TABS = [
  { key: "attendance", label: "Attendance", description: "Headcount buckets on Sunday Entry. Total attendance is the sum of all categories." },
  { key: "finance", label: "Finance", description: "What is received on Sundays. Tick “Adjustments” on a category that may hold negative corrections." },
  { key: "requisition", label: "Expense", description: "Spending categories Finance assigns to requisitions during review, used in reports." },
  { key: "budget", label: "Budget lines", description: "Cost centers / budget lines requesters choose on the requisition form." },
] as const;

export default async function CategoriesPage({ searchParams }: PageProps<"/categories">) {
  await requirePagePermission("categories.manage");
  const params = await searchParams;
  const active = TABS.find((t) => t.key === params.type) ?? TABS[0];

  let body: React.ReactNode;
  if (active.key === "budget") {
    const supabase = await createSupabaseServerClient();
    const [{ data: cc }, { data: depts }] = await Promise.all([
      supabase.from("cost_centers").select("id, code, name, department_id, is_active").order("sort_order").order("code"),
      supabase.from("departments").select("id, name").eq("is_active", true).order("sort_order"),
    ]);
    body = <CostCenterManager costCenters={(cc ?? []) as never} departments={(depts ?? []) as never} />;
  } else {
    const rows = await listCategories(active.key);
    const tree = buildTree(rows);
    body = (
      <CategoryManager
        key={active.key}
        type={active.key}
        negatives={Object.fromEntries(rows.map((r) => [r.id, r.allows_negative]))}
        items={tree.map((n) => ({
          id: n.id,
          name: n.name,
          isActive: n.is_active,
          badges: n.allows_negative ? ["Adjustments"] : undefined,
          children: n.children.map((c) => ({ id: c.id, name: c.name, isActive: c.is_active })),
        }))}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Categories"
        description="Nothing here is hard-coded. Categories referenced by past records are archived, never deleted, so history stays intact."
      />
      <nav aria-label="Category types" className="mb-6 flex gap-1.5 overflow-x-auto rounded-2xl bg-white p-1 ring-1 ring-navy/10 sm:inline-flex">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/categories?type=${t.key}`}
            aria-current={t.key === active.key ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium", t.key === active.key ? "bg-navy text-gold" : "text-navy/70 hover:bg-navy/5")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <p className="mb-5 max-w-2xl text-sm text-navy/65">{active.description}</p>
      {body}
    </>
  );
}
