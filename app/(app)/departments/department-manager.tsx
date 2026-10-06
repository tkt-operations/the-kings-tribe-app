"use client";

import { ManageList, type ManageItem } from "@/components/config/manage-list";
import { createDepartmentItem, moveDepartmentItem, renameDepartmentItem, setDepartmentItemActive } from "./actions";

export function DepartmentManager({ items }: { items: ManageItem[] }) {
  return (
    <ManageList
      items={items}
      itemNoun="department"
      childNoun="subcategory"
      allowChildren
      actions={{ create: createDepartmentItem, rename: renameDepartmentItem, setActive: setDepartmentItemActive, move: moveDepartmentItem }}
    />
  );
}
