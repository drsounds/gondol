import type { CSSProperties } from "react";
import { mediaHost } from "../../../../../../media/host";

/** A stable hue per name, like the chat avatars'. */
function hueFor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/**
 * An agent's avatar: its image from the host's media library (mediaHostHook), else its initial on a coloured circle, with
 * a small spark that marks it as an AI. `working` adds a dot: green at work, grey off duty.
 */
export function AgentAvatar({
  name,
  mediaId,
  size = "md",
  working,
}: {
  name: string;
  mediaId?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  working?: boolean | null;
}) {
  const { data: images = [] } = mediaHost().useImages();
  const src = (mediaId ? images.find((m) => m.id === mediaId)?.src : null) ?? null;
  return (
    <span className={`agent-avatar agent-avatar--${size}`} style={{ "--tile-hue": hueFor(name) } as CSSProperties} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="agent-avatar__initial">{name.charAt(0).toUpperCase() || "?"}</span>}
      <span className="agent-avatar__spark">✦</span>
      {working === undefined || working === null ? null : <span className={`agent-avatar__dot${working ? " agent-avatar__dot--on" : ""}`} />}
    </span>
  );
}
