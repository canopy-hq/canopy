import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { StatusDot } from "../StatusDot";

describe("StatusDot", () => {
  it("renders green dot with no animation when idle", () => {
    render(<StatusDot status="idle" />);
    const dot = screen.getByRole("img", { name: "Agent idle" });
    expect(dot).toBeDefined();
    expect(dot.style.backgroundColor).toBe("var(--agent-idle)");
  });

  it("renders orange dot with pulse-slow animation when running", () => {
    render(<StatusDot status="running" />);
    const dot = screen.getByRole("img", { name: "Agent running" });
    expect(dot).toBeDefined();
    expect(dot.className).toContain("pulse-slow");
    expect(dot.style.backgroundColor).toBe("var(--agent-running)");
  });

  it("renders red dot with breathe animation when waiting", () => {
    render(<StatusDot status="waiting" />);
    const dot = screen.getByRole("img", { name: "Agent waiting" });
    expect(dot).toBeDefined();
    expect(dot.className).toContain("breathe");
    expect(dot.style.backgroundColor).toBe("var(--agent-waiting)");
  });

  it("uses custom size prop", () => {
    render(<StatusDot status="running" size={12} />);
    const dot = screen.getByRole("img");
    expect(dot.style.width).toBe("12px");
    expect(dot.style.height).toBe("12px");
  });

  it("has accessible aria-label", () => {
    render(<StatusDot status="running" />);
    const dot = screen.getByRole("img");
    expect(dot.getAttribute("aria-label")).toBe("Agent running");
  });

  it("uses default size of 8px", () => {
    render(<StatusDot status="running" />);
    const dot = screen.getByRole("img");
    expect(dot.style.width).toBe("8px");
    expect(dot.style.height).toBe("8px");
  });
});
