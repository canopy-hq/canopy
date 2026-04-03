import { StatusDot } from "./StatusDot";

import type { DotStatus } from "./StatusDot";

/**
 * Floating CWD overlay for a terminal pane.
 *
 * Positioned absolute top-right, shows the last 2 path segments
 * of the current working directory. Falls back to '~' when empty.
 *
 * When an agent is running or waiting, shows a StatusDot and agent name
 * before the CWD text.
 */
export function PaneHeader({
  cwd,
  isFocused,
  agentStatus,
  agentName,
}: {
  cwd: string;
  isFocused: boolean;
  agentStatus?: DotStatus;
  agentName?: string;
}) {
  const displayPath = cwd ? cwd.split("/").filter(Boolean).slice(-2).join("/") : "~";

  const showAgent = agentStatus && agentStatus !== "idle";

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        zIndex: 10,
        background: "color-mix(in srgb, var(--bg-tertiary) 85%, transparent)",
        backdropFilter: "blur(4px)",
        borderRadius: "0 0 0 6px",
        padding: "4px 16px",
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: "12px",
        lineHeight: 1,
        color: isFocused ? "var(--text-primary)" : "var(--text-muted)",
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        gap: "4px",
      }}
    >
      {showAgent && <StatusDot status={agentStatus} size={8} />}
      {showAgent && agentName && (
        <>
          <span style={{ fontSize: "11px", color: "var(--text-primary)" }}>{agentName}</span>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", opacity: 0.4 }}>
            &middot;
          </span>
        </>
      )}
      {displayPath}
    </div>
  );
}
