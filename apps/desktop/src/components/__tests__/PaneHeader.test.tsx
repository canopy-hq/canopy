import { render, cleanup, within } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";

import { PaneHeader } from "../PaneHeader";

describe("PaneHeader", () => {
  afterEach(cleanup);

  it("renders last 2 path segments", () => {
    const { container } = render(<PaneHeader cwd="/Users/pierre/project/src" isFocused={false} />);
    expect(within(container).getByText("project/src")).toBeInTheDocument();
  });

  it("renders ~ when cwd is empty string", () => {
    const { container } = render(<PaneHeader cwd="" isFocused={false} />);
    expect(within(container).getByText("~")).toBeInTheDocument();
  });

  it("applies focused text color when isFocused=true", () => {
    const { container } = render(<PaneHeader cwd="/a/b" isFocused={true} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.color).toBe("var(--text-primary)");
  });

  it("applies muted text color when isFocused=false", () => {
    const { container } = render(<PaneHeader cwd="/a/b" isFocused={false} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.color).toBe("var(--text-muted)");
  });

  it("handles single-segment path", () => {
    const { container } = render(<PaneHeader cwd="/home" isFocused={false} />);
    expect(within(container).getByText("home")).toBeInTheDocument();
  });

  it("handles deeply nested path showing only last 2 segments", () => {
    const { container } = render(<PaneHeader cwd="/a/b/c/d/e/f" isFocused={false} />);
    expect(within(container).getByText("e/f")).toBeInTheDocument();
  });
});
