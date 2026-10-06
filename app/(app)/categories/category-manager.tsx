"use client";

import { ManageList, type ManageItem } from "@/components/config/manage-list";
import { useAction } from "@/components/ui/use-action";
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
  const { pending, run } = useAction();
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
                  disabled={pending}
                  onChange={(e) => {
                    const box = e.currentTarget;
                    const checked = box.checked;
                    run(() => setCategoryAllowsNegative(item.id, checked), {
                      successMessage: checked ? `Adjustments allowed for ${item.name}.` : `Adjustments turned off for ${item.name}.`,
                      onError: () => { box.checked = !checked; }, // put the box back as it was saved
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
