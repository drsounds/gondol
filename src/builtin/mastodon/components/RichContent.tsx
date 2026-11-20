import { Fragment, type ReactNode } from "react";
import { tokenizeStatusText } from "../../../../supabase/functions/_shared/activitypub";
import { useNavigateKeepingSearch } from "../../../navigation/useEntityModal";
import { paths } from "../models/mastodon";

/**
 * A status's (or a bio's) content. Local text is typed text, split into links, @mentions and
 * #hashtags by the same tokenizer the server renders its HTML with. Remote content is HTML that the
 * server sanitised when it arrived; it is still never put in the page as HTML (no
 * dangerouslySetInnerHTML): it is parsed off-screen and rebuilt as React elements from a short list
 * of harmless tags, with links only to http(s).
 */
export function RichContent({ text, html, domain }: { text?: string | null; html?: string | null; domain?: string | null }) {
  if (text) return <StatusText text={text} domain={domain ?? null} />;
  if (html) return <SafeHtml html={html} />;
  return null;
}

function InAppLink({ to, children }: { to: string; children: ReactNode }) {
  const go = useNavigateKeepingSearch();
  return (
    <a
      href={to}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        go(to);
      }}
    >
      {children}
    </a>
  );
}

/** Typed text, as paragraphs (blank lines) and lines. */
export function StatusText({ text, domain }: { text: string; domain: string | null }) {
  const paragraphs = text.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
  return (
    <>
      {paragraphs.map((paragraph, p) => (
        <p key={p}>
          {tokenizeStatusText(paragraph).map((token, i) => {
            switch (token.kind) {
              case "break":
                return <br key={i} />;
              case "link":
                return (
                  <a key={i} href={token.href} target="_blank" rel="noopener noreferrer nofollow">
                    {shortUrl(token.href)}
                  </a>
                );
              case "mention": {
                const acct = token.domain && token.domain !== domain ? `${token.username}@${token.domain}` : token.username;
                return (
                  <InAppLink key={i} to={`/mastodon/accounts/${encodeURIComponent(token.domain ? `${token.username}@${token.domain}` : token.username)}`}>
                    @{acct}
                  </InAppLink>
                );
              }
              case "hashtag":
                return (
                  <InAppLink key={i} to={paths.tag(token.name)}>
                    #{token.name}
                  </InAppLink>
                );
              default:
                return <Fragment key={i}>{token.text}</Fragment>;
            }
          })}
        </p>
      ))}
    </>
  );
}

function shortUrl(href: string): string {
  const bare = href.replace(/^https?:\/\/(www\.)?/, "");
  return bare.length > 40 ? `${bare.slice(0, 39)}…` : bare;
}

const BLOCKS = new Set(["p", "blockquote", "ul", "ol", "li", "pre"]);
const INLINE = new Set(["strong", "b", "em", "i", "u", "s", "del", "code", "span", "sub", "sup"]);

/** Sanitised HTML from another server, rebuilt as React elements. */
export function SafeHtml({ html }: { html: string }) {
  if (typeof DOMParser === "undefined") return <p>{html.replace(/<[^>]*>/g, " ")}</p>;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return <>{Array.from(doc.body.childNodes).map((node, i) => toReact(node, i))}</>;
}

function toReact(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map((child, i) => toReact(child, i));
  if (tag === "br") return <br key={key} />;
  if (tag === "a") {
    const href = element.getAttribute("href") ?? "";
    const classes = element.getAttribute("class") ?? "";
    // Mastodon hides the scheme and long tails of links in `invisible`/`ellipsis` spans.
    if (!/^https?:\/\//i.test(href)) return <Fragment key={key}>{children}</Fragment>;
    return (
      <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className={classes.includes("mention") ? "mastodon-mention" : undefined}>
        {children}
      </a>
    );
  }
  if (tag === "span") {
    const classes = element.getAttribute("class") ?? "";
    if (classes.split(/\s+/).includes("invisible")) return null;
    if (classes.split(/\s+/).includes("ellipsis")) return <Fragment key={key}>{children}…</Fragment>;
  }
  if (BLOCKS.has(tag) || INLINE.has(tag)) {
    const Tag = tag as "p";
    return <Tag key={key}>{children}</Tag>;
  }
  return <Fragment key={key}>{children}</Fragment>;
}
