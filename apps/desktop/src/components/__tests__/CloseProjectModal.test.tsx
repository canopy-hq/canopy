import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { CloseProjectModal, type CloseProjectModalProps } from "../CloseProjectModal";

describe("CloseProjectModal", () => {
  let props: CloseProjectModalProps;

  beforeEach(() => {
    props = {
      isOpen: true,
      onClose: vi.fn(),
      onConfirm: vi.fn(),
      projectName: "my-project",
    };
  });

  it("renders nothing when isOpen is false", () => {
    render(<CloseProjectModal {...props} isOpen={false} />);
    expect(screen.queryByText(/Close Project/)).toBeNull();
  });

  it("shows project name in heading when open", () => {
    render(<CloseProjectModal {...props} />);
    expect(screen.getByRole("heading", { name: /Close Project/ })).toBeDefined();
    expect(screen.getByRole("heading", { name: /my-project/ })).toBeDefined();
  });

  it("shows explanation text about files remaining on disk", () => {
    render(<CloseProjectModal {...props} />);
    expect(screen.getByText(/Your files and git history will remain on disk/)).toBeDefined();
  });

  it("calls onClose when Cancel button is clicked", () => {
    render(<CloseProjectModal {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when Close Project button is clicked", () => {
    render(<CloseProjectModal {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Close Project" }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape keypress", () => {
    render(<CloseProjectModal {...props} />);
    const backdrop = screen.getByRole("presentation");
    fireEvent.keyDown(backdrop, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on backdrop click", () => {
    render(<CloseProjectModal {...props} />);
    const backdrop = screen.getByRole("presentation");
    fireEvent.click(backdrop);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
