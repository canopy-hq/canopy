export function ClaudeCodeIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Asterisk / sparkle — matches the Claude Code icon */}
      <g fill="currentColor">
        <rect x="6.3" y="1" width="1.4" height="12" rx="0.7" />
        <rect x="6.3" y="1" width="1.4" height="12" rx="0.7" transform="rotate(60 7 7)" />
        <rect x="6.3" y="1" width="1.4" height="12" rx="0.7" transform="rotate(120 7 7)" />
      </g>
    </svg>
  );
}
