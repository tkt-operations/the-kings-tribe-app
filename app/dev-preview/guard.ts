import { notFound } from "next/navigation";

export function devOnly() {
  if (process.env.NODE_ENV === "production") notFound();
}
