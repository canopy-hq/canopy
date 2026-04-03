import { describe, it, expect } from "vitest";

import { toastQueue, showErrorToast } from "../../lib/toast";

describe("ToastProvider", () => {
  it("toastQueue is defined", () => {
    expect(toastQueue).toBeDefined();
  });

  it("showErrorToast is a function", () => {
    expect(typeof showErrorToast).toBe("function");
  });
});
