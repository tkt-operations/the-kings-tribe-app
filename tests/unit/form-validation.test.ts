import { describe, expect, it } from "vitest";
import { issuesToFieldErrors } from "@/lib/action-result";
import { flashMessage, FLASH_MESSAGES } from "@/lib/flash";
import { hasErrors, rules, validate } from "@/lib/validation/form";
import { isNavigationSignal } from "@/components/ui/use-action";

describe("validation rules", () => {
  it("required rejects blank and whitespace-only values", () => {
    const check = rules.required("Email address is required.");
    expect(check("")).toBe("Email address is required.");
    expect(check("   ")).toBe("Email address is required.");
    expect(check("a@b.co")).toBeNull();
  });

  it("email allows blank (pair with required) but rejects malformed addresses", () => {
    const check = rules.email();
    expect(check("")).toBeNull();
    expect(check("person@church.org")).toBeNull();
    expect(check("person@church")).toBe("Enter a valid email address.");
    expect(check("not an email")).toBe("Enter a valid email address.");
  });

  it("emailList validates each comma-separated address", () => {
    const check = rules.emailList();
    expect(check("a@x.org, b@y.org")).toBeNull();
    expect(check("a@x.org, nope")).not.toBeNull();
  });

  it("positiveMoney requires an amount greater than zero", () => {
    const check = rules.positiveMoney();
    expect(check("0")).toBe("Enter an amount greater than $0.");
    expect(check("0.00")).toBe("Enter an amount greater than $0.");
    expect(check("-5")).toBe("Enter an amount greater than $0.");
    expect(check("12.345")).toBe("Enter an amount greater than $0.");
    expect(check("abc")).toBe("Enter an amount greater than $0.");
    expect(check("1,250.50")).toBeNull();
    expect(check("$24.99")).toBeNull();
    expect(check("")).toBeNull();
  });

  it("money accepts zero but not malformed amounts", () => {
    expect(rules.money()("0")).toBeNull();
    expect(rules.money()("24.999")).toBe("Enter an amount like 24.99.");
  });

  it("quantity and maxQuantity mirror the server's hundredths rules", () => {
    expect(rules.quantity()("0")).not.toBeNull();
    expect(rules.quantity()("2.5")).toBeNull();
    const max = rules.maxQuantity(300n, "Only 3 available.");
    expect(max("3")).toBeNull();
    expect(max("3.01")).toBe("Only 3 available.");
  });

  it("date bounds", () => {
    expect(rules.date()("2026-13")).toBe("Choose a valid date.");
    expect(rules.notAfter("2026-10-06", "No future dates.")("2026-10-07")).toBe("No future dates.");
    expect(rules.notBefore("2026-10-06", "Too early.")("2026-10-05")).toBe("Too early.");
    expect(rules.notBefore("", "Too early.")("2026-10-05")).toBeNull();
  });

  it("minLength and matches", () => {
    expect(rules.minLength(12, "Use at least 12 characters.")("short")).toBe("Use at least 12 characters.");
    expect(rules.matches("abc", "Passwords do not match.")("abd")).toBe("Passwords do not match.");
  });
});

describe("validate()", () => {
  it("returns the first failing message per field, keyed by field id", () => {
    const errors = validate({
      email: ["", rules.required("Email address is required."), rules.email()],
      amount: ["0", rules.required("Amount is required."), rules.positiveMoney()],
      name: ["Grace", rules.required("Name is required.")],
    });
    expect(errors).toEqual({ email: "Email address is required.", amount: "Enter an amount greater than $0." });
    expect(hasErrors(errors)).toBe(true);
    expect(hasErrors({})).toBe(false);
  });
});

describe("issuesToFieldErrors()", () => {
  it("maps nested paths and keeps the first message per field", () => {
    expect(
      issuesToFieldErrors([
        { path: ["email"], message: "Enter a valid email address." },
        { path: ["email"], message: "second" },
        { path: ["items", 0, "quantity"], message: "Enter a quantity greater than 0" },
        { path: [], message: "form-level" },
      ]),
    ).toEqual({ email: "Enter a valid email address.", "items.0.quantity": "Enter a quantity greater than 0" });
  });
});

describe("flash messages", () => {
  it("only resolves keys from the fixed list", () => {
    expect(flashMessage("admin-created")).toBe(FLASH_MESSAGES["admin-created"]);
    expect(flashMessage("<script>")).toBeNull();
    expect(flashMessage("toString")).toBeNull();
  });
});

describe("isNavigationSignal()", () => {
  it("recognises Next.js redirect/not-found signals only", () => {
    expect(isNavigationSignal({ digest: "NEXT_REDIRECT;push;/admin/setup;307;" })).toBe(true);
    expect(isNavigationSignal({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })).toBe(true);
    expect(isNavigationSignal(new Error("boom"))).toBe(false);
    expect(isNavigationSignal(null)).toBe(false);
  });
});
