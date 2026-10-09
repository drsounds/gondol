export function InternalAppBadge({ active }: { active?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.15rem 0.5rem",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        background: active !== false ? "rgba(99, 102, 241, 0.15)" : "rgba(156, 163, 175, 0.15)",
        color: active !== false ? "var(--bungalow-color-primary, #6366f1)" : "var(--bungalow-color-muted, #9ca3af)",
        border: "1px solid currentColor",
      }}
    >
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          backgroundColor: active !== false ? "#10b981" : "#9ca3af",
        }}
      />
      Internal Bundle
    </span>
  );
}

export function ExternalAppBadge() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.15rem 0.5rem",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        background: "rgba(59, 130, 246, 0.12)",
        color: "#3b82f6",
        border: "1px solid currentColor",
      }}
    >
      HTML5 Embed
    </span>
  );
}

