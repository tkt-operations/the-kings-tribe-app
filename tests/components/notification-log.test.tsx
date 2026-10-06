// @vitest-environment jsdom
/** Internal notification log: provider delivery status vs Resend acceptance. */
import "./setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationLog } from "@/app/(app)/requisitions/[id]/notification-log";

describe("notification log", () => {
  const n = (o: object) => ({ id: Math.random().toString(), channel: "email", template: "requisition_submitted", recipient: "a@example.org", status: "sent", error: null, created_at: "2026-10-06T21:03:14Z", delivery_status: null, delivery_status_at: null, notification_events: [], ...o });
  it("separates 'Accepted by Resend' from provider status and never implies delivery", () => {
    render(<NotificationLog timezone="UTC" notifications={[
      n({}),
      n({ template: "finance_new_requisition", delivery_status: "delivered", delivery_status_at: "2026-10-06T21:03:20Z" }),
      n({ template: "status_approved", delivery_status: "bounced", delivery_status_at: "2026-10-06T22:00:00Z", notification_events: [{ event_type: "bounced", occurred_at: "2026-10-06T22:00:00Z", detail: "Permanent / General" }] }),
    ] as never} />);
    const rows = screen.getAllByTestId("notification-row");
    expect(rows[0].textContent).toContain("Accepted by Resend");
    expect(rows[0].textContent).toContain("No delivery update yet");
    expect(rows[0].textContent).not.toContain("Delivered");
    expect(rows[1].textContent).toContain("Provider status: Delivered");
    expect(rows[2].textContent).toContain("Bounced");
    expect(rows[2].textContent).toContain("Reason: Permanent / General");
  });
});
