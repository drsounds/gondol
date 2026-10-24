import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Icon } from "../../../../../../design-system/bungalow-79d923";
import { useAppSetting } from "../../../../../../settings/settings";
import { entityIdentifier, entityKey } from "../../../../../../entities/slugs";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { useSession } from "../../../../../../supabase/useSession";
import { useI18n } from "../../../../../../i18n/i18n";
import {
  agentConversationPath,
  agentMessagesKey,
  openAgentConversation,
  useAgentAvailability,
  useAgentConversation,
  useAgents,
  useAllAgentConversations,
  type Agent,
  type AgentMessage,
} from "../../../../models/agents";
import {
  addIntercomHead,
  removeIntercomHead,
  updateIntercom,
  useIntercomState,
  useVisibleAgentConversation,
  type IntercomConversation,
} from "../../../../models/intercom";
import { useAgentRunner } from "../../../../models/runAgent";
import { AgentAvatar } from "../components/AgentAvatar";
import { AgentChat } from "../components/AgentChat";
import { useAvailabilityText } from "../components/useAvailabilityText";
import { useAgentEgos } from "../../../../models/host";

/** A bubble's size, and the gaps around the launcher, in pixels. */
const HEAD = 52;
const LAUNCHER = 56;
const EDGE = 16;
const GAP = 10;

/**
 * How much of the bottom of the screen the shell's own bars take (the phone's tab bar, the
 * player), so the intercom sits above them.
 */
function useBottomInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const measure = () => {
      let top = window.innerHeight;
      // Full-width bars stacked up from the bottom edge (the tab bar, the player above it, …), not
      // the desktop's menu column: lowest first, each one counting when it rests on the last.
      const bars = Array.from(document.querySelectorAll<HTMLElement>(".app-dock > *, .bottom-nav"))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.height && r.width >= window.innerWidth * 0.5)
        .sort((a, b) => b.bottom - a.bottom);
      for (const r of bars) {
        if (r.bottom < top - 4) break;
        top = Math.min(top, r.top);
      }
      setInset(Math.max(0, Math.round(window.innerHeight - top)));
    };
    measure();
    const timer = window.setInterval(measure, 1500);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, []);
  return inset;
}

/**
 * The agents' intercom, over every page while the agents app is on (its `intercom` setting): a
 * round launcher at the bottom right in the accent colour opens the main list of agents, and
 * picking one opens a popup with your main conversation with it. Conversations you leave on the
 * Agents page (and ones opened here) stay as chat bubbles with the agent's avatar (the
 * `chatHeads` setting): tap one to open its popup, drag it anywhere (it settles at the nearest
 * edge), or drag it onto the ✕ that appears at the bottom to throw it away. A dot marks a bubble
 * whose agent wrote since you last looked. While the Agents page shows a conversation, its bubble
 * hides. The bubbles and where they were dropped are remembered on this device.
 */
export function AgentIntercom() {
  const { session } = useSession();
  const enabled = useAppSetting<boolean>("agents", "intercom") !== false;
  if (!session || !enabled) return null;
  return <Intercom />;
}

function Intercom() {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const keepHeads = useAppSetting<boolean>("agents", "chatHeads") !== false;
  const state = useIntercomState();
  const visible = useVisibleAgentConversation();
  const { data: allAgents = [] } = useAgents();
  const agents = useMemo(() => allAgents.filter((a) => a.status !== "fired"), [allAgents]);
  const conversations = useAllAgentConversations(state.heads.length > 0).data ?? [];
  const egos = useAgentEgos().data ?? [];
  const inset = useBottomInset();
  const runner = useAgentRunner();
  const [listOpen, setListOpen] = useState(false);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; overBin: boolean } | null>(null);
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1024 : window.innerWidth));
  const [height, setHeight] = useState(() => (typeof window === "undefined" ? 768 : window.innerHeight));
  useEffect(() => {
    const onResize = () => {
      setWidth(window.innerWidth);
      setHeight(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Leaving a conversation on the Agents page keeps it as a bubble, when anything was said in it.
  const shown = useRef(visible);
  useEffect(() => {
    const was = shown.current;
    shown.current = visible;
    if (!keepHeads || !was || was.conversationId === visible?.conversationId) return;
    const said = queryClient.getQueryData<AgentMessage[]>(agentMessagesKey(was.conversationId));
    if (said?.length) addIntercomHead(was);
  }, [visible, keepHeads, queryClient]);

  // Bubbles of agents that are gone (deleted, fired) go too.
  useEffect(() => {
    if (!allAgents.length) return;
    for (const head of state.heads) if (!agents.some((a) => a.id === head.agentId)) removeIntercomHead(head.conversationId);
  }, [agents, allAgents.length, state.heads]);

  const heads = state.heads.filter((h) => h.conversationId !== visible?.conversationId && agents.some((a) => a.id === h.agentId));
  const openHead = state.open ? heads.find((h) => h.conversationId === state.open) : undefined;
  const lastMessageAt = (id: string) => conversations.find((c) => c.id === id)?.last_message_at ?? null;
  const markSeen = (id: string) => updateIntercom((s) => ({ ...s, seen: { ...s.seen, [id]: new Date().toISOString() } }));

  const bottom = inset + EDGE;
  const defaultY = (index: number) => height - bottom - LAUNCHER - GAP - (index + 1) * (HEAD + GAP);
  const placeOf = (id: string, index: number) => {
    const stored = state.positions[id];
    const side = stored?.side ?? "right";
    const y = Math.min(Math.max(EDGE, stored?.y ?? defaultY(index)), height - bottom - HEAD);
    return { left: side === "left" ? EDGE : width - EDGE - HEAD, top: y, side };
  };

  const toggleHead = (id: string) => {
    setListOpen(false);
    updateIntercom((s) => ({ ...s, open: s.open === id ? null : id }));
    markSeen(id);
  };

  const openWith = async (agent: Agent) => {
    setListOpen(false);
    const conversationId = await openAgentConversation(agent.id, "account");
    addIntercomHead({ conversationId, agentId: agent.id }, true);
    markSeen(conversationId);
  };

  const popupSide = openHead ? placeOf(openHead.conversationId, heads.indexOf(openHead)).side : "right";
  const binCenter = { x: width / 2, y: height - bottom - 40 };

  return (
    <div className="intercom" style={{ "--intercom-bottom": `${bottom}px` } as CSSProperties}>
      {heads.map((head, index) => {
        const agent = agents.find((a) => a.id === head.agentId)!;
        const place = placeOf(head.conversationId, index);
        const dragging = drag?.id === head.conversationId ? drag : null;
        const last = lastMessageAt(head.conversationId);
        const unread = !!last && state.open !== head.conversationId && (!state.seen[head.conversationId] || last > state.seen[head.conversationId]);
        return (
          <ChatHead
            key={head.conversationId}
            agent={agent}
            left={dragging ? dragging.x : place.left}
            top={dragging ? dragging.y : place.top}
            open={state.open === head.conversationId}
            unread={unread}
            dragging={!!dragging}
            label={t("agents.intercom.bubble", { name: agent.name })}
            onTap={() => toggleHead(head.conversationId)}
            onDismiss={() => removeIntercomHead(head.conversationId)}
            onDrag={(x, y) => {
              const overBin = Math.hypot(x + HEAD / 2 - binCenter.x, y + HEAD / 2 - binCenter.y) < 56;
              setDrag({ id: head.conversationId, x, y, overBin });
            }}
            onDrop={(x, y) => {
              const overBin = Math.hypot(x + HEAD / 2 - binCenter.x, y + HEAD / 2 - binCenter.y) < 56;
              setDrag(null);
              if (overBin) {
                removeIntercomHead(head.conversationId);
                return;
              }
              const side = x + HEAD / 2 < width / 2 ? "left" : "right";
              updateIntercom((s) => ({ ...s, positions: { ...s.positions, [head.conversationId]: { side, y: Math.round(y) } } }));
            }}
          />
        );
      })}

      {drag ? (
        <div className={`intercom__bin${drag.overBin ? " intercom__bin--over" : ""}`} style={{ left: binCenter.x - 28, top: binCenter.y - 28 }} aria-hidden="true">
          ✕
        </div>
      ) : null}

      {openHead ? (
        <IntercomPopup
          key={openHead.conversationId}
          head={openHead}
          agent={agents.find((a) => a.id === openHead.agentId)!}
          agents={agents}
          side={popupSide}
          onQueued={runner.kick}
          onMinimize={() => updateIntercom((s) => ({ ...s, open: null }))}
          onDismiss={() => removeIntercomHead(openHead.conversationId)}
          onExpand={(path) => {
            updateIntercom((s) => ({ ...s, open: null }));
            go(path);
          }}
          pathOf={(c) => {
            const agent = agents.find((a) => a.id === openHead.agentId);
            return agent ? agentConversationPath(agent, agents, egos, c) : null;
          }}
        />
      ) : null}

      {listOpen ? (
        <AgentList
          agents={agents}
          pathname={pathname}
          onPick={(agent) => void openWith(agent)}
          onAll={() => {
            setListOpen(false);
            go("/agents");
          }}
          onHire={() => {
            setListOpen(false);
            go("/agents/new");
          }}
          onClose={() => setListOpen(false)}
        />
      ) : null}

      <button
        type="button"
        className="intercom__launcher"
        aria-expanded={listOpen}
        aria-label={t("agents.intercom.open")}
        title={t("agents.intercom.open")}
        onClick={() => {
          setListOpen((v) => !v);
          if (state.open) updateIntercom((s) => ({ ...s, open: null }));
        }}
      >
        {listOpen ? <span aria-hidden="true">✕</span> : <Icon name="sparkle" />}
      </button>
    </div>
  );
}

/** One chat bubble: a tap opens its popup, a drag moves it, and a hover shows a ✕ to throw it away. */
function ChatHead({
  agent,
  left,
  top,
  open,
  unread,
  dragging,
  label,
  onTap,
  onDismiss,
  onDrag,
  onDrop,
}: {
  agent: Agent;
  left: number;
  top: number;
  open: boolean;
  unread: boolean;
  dragging: boolean;
  label: string;
  onTap: () => void;
  onDismiss: () => void;
  onDrag: (x: number, y: number) => void;
  onDrop: (x: number, y: number) => void;
}) {
  const { t } = useI18n();
  const start = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const position = (event: ReactPointerEvent) => {
    const s = start.current!;
    return { x: s.left + event.clientX - s.x, y: s.top + event.clientY - s.y };
  };
  return (
    <div
      className={`intercom__head${open ? " intercom__head--open" : ""}${dragging ? " intercom__head--dragging" : ""}`}
      style={{ left, top }}
    >
      <button
        type="button"
        className="intercom__head-button"
        aria-label={label}
        aria-expanded={open}
        title={agent.name}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          start.current = { x: event.clientX, y: event.clientY, left, top, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const s = start.current;
          if (!s) return;
          if (!s.moved && Math.hypot(event.clientX - s.x, event.clientY - s.y) < 6) return;
          s.moved = true;
          const p = position(event);
          onDrag(p.x, p.y);
        }}
        onPointerUp={(event) => {
          const s = start.current;
          start.current = null;
          if (!s) return;
          if (s.moved) {
            const p = position(event);
            onDrop(p.x, p.y);
          } else onTap();
        }}
        onPointerCancel={() => {
          const s = start.current;
          start.current = null;
          if (s?.moved) onDrop(s.left, s.top);
        }}
        onKeyDown={(event) => {
          if (event.key === "Delete" || event.key === "Backspace") onDismiss();
        }}
        onClick={(event) => {
          // Pointer events do the work; a keyboard's Enter/Space still taps.
          if (event.detail === 0) onTap();
        }}
      >
        <AgentAvatar name={agent.name} mediaId={agent.avatar_media_id} size="lg" />
        {unread ? <span className="intercom__unread" aria-label={t("agents.intercom.unread")} /> : null}
      </button>
      <button type="button" className="intercom__head-dismiss" aria-label={t("agents.intercom.dismiss", { name: agent.name })} title={t("agents.intercom.dismiss", { name: agent.name })} onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}

/** The popup of a bubble: the conversation, small, with its threads in its place. */
function IntercomPopup({
  head,
  agent,
  agents,
  side,
  onQueued,
  onMinimize,
  onDismiss,
  onExpand,
  pathOf,
}: {
  head: IntercomConversation;
  agent: Agent;
  agents: Agent[];
  side: "left" | "right";
  onQueued: () => void;
  onMinimize: () => void;
  onDismiss: () => void;
  onExpand: (path: string) => void;
  pathOf: (c: NonNullable<ReturnType<typeof useAgentConversation>["data"]>) => string | null;
}) {
  const { t } = useI18n();
  const conversation = useAgentConversation(head.conversationId);
  const availability = useAgentAvailability([agent.id]).data?.get(agent.id);
  const availabilityText = useAvailabilityText();
  const [threadId, setThreadId] = useState<string | null>(null);
  const current = conversation.data ?? null;
  const path = current ? pathOf(current) : null;
  // A conversation that's gone (deleted elsewhere) takes its bubble along.
  useEffect(() => {
    if (conversation.isSuccess && !current) onDismiss();
  }, [conversation.isSuccess, current, onDismiss]);
  return (
    <section className={`intercom__popup intercom__popup--${side}`} aria-label={t("agents.intercom.conversationWith", { name: agent.name })}>
      <header className="intercom__popup-head">
        <AgentAvatar name={agent.name} mediaId={agent.avatar_media_id} size="sm" working={availability?.working} />
        <div className="intercom__popup-title">
          <strong>{current && !current.is_main && current.title ? current.title : agent.name}</strong>
          <span className="muted">{availabilityText(agent, availability)}</span>
        </div>
        {path ? (
          <button type="button" className="agent-chat__icon-button" onClick={() => onExpand(threadId ? `${path}/threads/${entityIdentifier(threadId)}` : path)} aria-label={t("agents.intercom.expand")} title={t("agents.intercom.expand")}>
            ⤢
          </button>
        ) : null}
        <button type="button" className="agent-chat__icon-button" onClick={onMinimize} aria-label={t("agents.intercom.minimize")} title={t("agents.intercom.minimize")}>
          –
        </button>
        <button type="button" className="agent-chat__icon-button" onClick={onDismiss} aria-label={t("agents.intercom.dismiss", { name: agent.name })} title={t("agents.intercom.dismiss", { name: agent.name })}>
          ✕
        </button>
      </header>
      {current ? (
        <AgentChat
          agent={agent}
          agents={agents}
          conversation={current}
          threadId={threadId}
          onThread={setThreadId}
          onEditMessage={(m) => path && onExpand(`${path}/message/${entityIdentifier(m.id)}/edit`)}
          onQueued={onQueued}
          compact
        />
      ) : (
        <p className="muted intercom__loading">{conversation.error ? conversation.error.message : t("app.loading")}</p>
      )}
    </section>
  );
}

/** The intercom's main list: every agent at work (and off duty), to open a conversation with. */
function AgentList({
  agents,
  pathname,
  onPick,
  onAll,
  onHire,
  onClose,
}: {
  agents: Agent[];
  pathname: string;
  onPick: (agent: Agent) => void;
  onAll: () => void;
  onHire: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const availability = useAgentAvailability(agents.map((a) => a.id)).data;
  const availabilityText = useAvailabilityText();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <section className="intercom__popup intercom__popup--right intercom__list" aria-label={t("agents.intercom.title")}>
      <header className="intercom__popup-head intercom__list-head">
        <div className="intercom__popup-title">
          <strong>{t("agents.intercom.title")}</strong>
          <span className="muted">{t("agents.intercom.intro")}</span>
        </div>
      </header>
      {agents.length === 0 ? (
        <div className="intercom__empty">
          <p className="muted">{t("agents.intercom.none")}</p>
          <button type="button" className="intercom__link" onClick={onHire}>
            {t("agents.add")}
          </button>
        </div>
      ) : (
        <ul className="intercom__agents">
          {agents.map((agent) => {
            const now = availability?.get(agent.id);
            const here = pathname.startsWith(`/agents/${entityKey(agent)}`);
            return (
              <li key={agent.id}>
                <button type="button" className="intercom__agent" aria-current={here ? "page" : undefined} onClick={() => onPick(agent)}>
                  <AgentAvatar name={agent.name} mediaId={agent.avatar_media_id} size="md" working={now?.working ?? null} />
                  <span className="intercom__agent-text">
                    <strong>{agent.name}</strong>
                    <span className="muted">{[agent.title, availabilityText(agent, now)].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="intercom__list-foot">
        <button type="button" className="intercom__link" onClick={onAll}>
          {t("agents.intercom.all")}
        </button>
      </footer>
    </section>
  );
}
