// @vitest-environment jsdom
import "./setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, Input, RequiredNote, Select, Textarea } from "@/components/ui/field";

describe("required field semantics", () => {
  it("marks required controls with an asterisk and aria-required, and keeps the label associated", () => {
    const { container } = render(
      <form>
        <RequiredNote />
        <Field label="Email Address" htmlFor="email" required hint="We send updates here.">
          <Input type="email" />
        </Field>
        <Field label="Department" htmlFor="department" required>
          <Select><option value="">Choose</option></Select>
        </Field>
        <Field label="Notes" htmlFor="notes">
          <Textarea />
        </Field>
      </form>,
    );
    const email = screen.getByLabelText(/Email Address/);
    expect(email.id).toBe("email");
    expect(email.getAttribute("aria-required")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe("email-hint");
    expect(screen.getByLabelText(/Department/).getAttribute("aria-required")).toBe("true");
    expect(screen.getByLabelText("Notes").hasAttribute("aria-required")).toBe(false);

    // Visible marker is not colour-only (it's a glyph) and is hidden from screen readers,
    // which get "required" from aria-required instead.
    const marker = container.querySelector('label[for="email"] [aria-hidden]');
    expect(marker?.textContent).toBe("*");
    expect(screen.getByText("Required fields")).toBeTruthy();
  });

  it("links an inline error to the control and marks it invalid", () => {
    render(
      <Field label="Amount" htmlFor="amount" required error="Enter an amount greater than $0.">
        <Input inputMode="decimal" />
      </Field>,
    );
    const amount = screen.getByLabelText(/Amount/);
    expect(amount.getAttribute("aria-invalid")).toBe("true");
    expect(amount.getAttribute("aria-describedby")).toBe("amount-error");
    expect(document.getElementById("amount-error")?.textContent).toContain("Enter an amount greater than $0.");
  });

  it("lets explicit props win over the field context", () => {
    render(
      <Field label="Code" htmlFor="code" required>
        <Input id="custom" aria-describedby="extra" />
      </Field>,
    );
    const input = document.getElementById("custom")!;
    expect(input.getAttribute("aria-describedby")).toBe("extra");
    expect(input.getAttribute("aria-required")).toBe("true");
  });
});
