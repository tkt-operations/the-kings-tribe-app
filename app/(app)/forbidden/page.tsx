import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Access denied" };

export default function ForbiddenPage() {
  return (
    <EmptyState title="You don’t have access to that page" action={<ButtonLink href="/dashboard" variant="secondary">Back to dashboard</ButtonLink>}>
      Your role does not include this area. If you need it, ask an administrator to update your permissions.
    </EmptyState>
  );
}
