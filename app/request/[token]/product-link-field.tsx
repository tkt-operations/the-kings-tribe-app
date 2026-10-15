"use client";

import type { UseFormReturn } from "react-hook-form";
import { useLineLookups, type FillField } from "@/components/product/product-lookup";
import type { RequisitionInput } from "@/lib/validation/requisition";
import { getProductDetails } from "./product-actions";

/** The request form's "Product link (optional)": the shared lookup engine bound to react-hook-form. */
export * from "@/components/product/product-lookup";

export function useProductLookups(
  form: UseFormReturn<RequisitionInput>,
  formToken: string,
  lines: { indexOf: (fieldId: string) => number; ids: () => string[] },
) {
  return useLineLookups({
    get: (key, name) => {
      const index = lines.indexOf(key);
      return index < 0 ? "" : String(form.getValues(`items.${index}.${name}`) ?? "");
    },
    set: (key, name: FillField, value, validate) => {
      const index = lines.indexOf(key);
      if (index >= 0) form.setValue(`items.${index}.${name}`, value, validate ? { shouldDirty: true, shouldValidate: true } : { shouldDirty: true });
    },
    setToken: (key, token) => {
      const index = lines.indexOf(key);
      if (index >= 0) form.setValue(`items.${index}.product_lookup`, token);
    },
    exists: (key) => lines.indexOf(key) >= 0,
    keys: () => lines.ids(),
    fetch: (url) => getProductDetails(formToken, url),
    fieldId: (key, name) => `items.${lines.indexOf(key)}.${name}`,
  });
}
