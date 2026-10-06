"use client";

import { useTransition } from "react";
import { ManageList, type ManageItem } from "@/components/config/manage-list";
import { createCategory, moveCategory, renameCategory, setCategoryActive, setCategoryAllowsNegative } from "./actions";

export function CategoryManager({
  type,
  items,
  negatives,
}: {
  type: "attendance" | "finance" | "requisition";
  items: ManageItem[];
  negatives: Record<string, boolean>;
}) {
  const [, startTransition] = useTransition();
  return (
    <ManageList
      items={items}
      itemNoun="category"
      childNoun="subcategory"
      allowChildren={type !== "attendance"}
      actions={{
        create: (name, parentId) => createCategory(type, name, parentId),
        rename: renameCategory,
        setActive: setCategoryActive,
        move: moveCategory,
      }}
      extraItemControls={
        type === "finance"
          ? (item) => (
              <label className="mr-2 flex items-center gap-1.5 text-[13px] text-navy/70" title="Allow negative adjustment amounts">
                <input
                  type="checkbox"
                  className="size-4 accent-navy"
                  defaultChecked={negatives[item.id]}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    startTransition(async () => {
                      await setCategoryAllowsNegative(item.id, checked);
                    });
                  }}
                />
                Adjustments
              </label>
            )
          : undefined
      }
    />
  );
}
