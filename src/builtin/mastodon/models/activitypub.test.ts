import { describe, expect, test } from "bun:test";
import {
  generateKeyPair,
  htmlToText,
  parseAcct,
  parseSignatureHeader,
  sanitizeHtml,
  signRequest,
  statusTextToHtml,
  tokenizeStatusText,
  verifySignature,
} from "../../../../supabase/functions/_shared/activitypub";

describe("HTTP signatures", () => {
  test("a signed POST verifies, and a changed body doesn't", async () => {
    const keys = await generateKeyPair();
    const body = JSON.stringify({ type: "Follow" });
    const headers = await signRequest({ method: "POST", url: "https://remote.example/inbox", body, keyId: "https://a.example/ap/users/a#main-key", privateKeyPem: keys.privateKeyPem });
    const signature = parseSignatureHeader(headers.signature)!;
    expect(signature.keyId).toBe("https://a.example/ap/users/a#main-key");
    const header = (name: string) => headers[name] ?? null;
    expect(await verifySignature({ method: "POST", path: "/inbox", header, body, signature, publicKeyPem: keys.publicKeyPem })).toEqual({ ok: true });
    const bad = await verifySignature({ method: "POST", path: "/inbox", header, body: `${body} `, signature, publicKeyPem: keys.publicKeyPem });
    expect(bad.ok).toBe(false);
    const wrongPath = await verifySignature({ method: "POST", path: "/other", header, body, signature, publicKeyPem: keys.publicKeyPem });
    expect(wrongPath.ok).toBe(false);
  });
});

describe("status text", () => {
  test("finds links, mentions, hashtags and breaks", () => {
    const tokens = tokenizeStatusText("Hi @bob and @eve@social.example, see https://x.y/a. #Fedi\nbye");
    expect(tokens.map((t) => t.kind)).toEqual(["text", "mention", "text", "mention", "text", "link", "text", "hashtag", "break", "text"]);
    expect(tokens[3]).toMatchObject({ username: "eve", domain: "social.example" });
    expect(tokens[5]).toMatchObject({ href: "https://x.y/a" });
  });
  test("e-mail addresses aren't mentions, nor anchors hashtags", () => {
    expect(tokenizeStatusText("mail me@x.org or a#b").every((t) => t.kind === "text")).toBe(true);
  });
  test("renders HTML with paragraphs, escaping and links", () => {
    const html = statusTextToHtml("<b>hi</b> @bob #tag\n\nnext", { mentionUrl: () => "https://s/@bob", tagUrl: (n) => `https://s/tags/${n}` });
    expect(html).toBe('<p>&lt;b&gt;hi&lt;/b&gt; <span class="h-card"><a href="https://s/@bob" class="u-url mention">@<span>bob</span></a></span> <a href="https://s/tags/tag" class="mention hashtag" rel="tag">#<span>tag</span></a></p><p>next</p>');
  });
  test("sanitises remote HTML", () => {
    const html = sanitizeHtml('<p onclick="x()">Hi <script>alert(1)</script><a href="javascript:alert(1)">x</a> <a href="https://ok.example" class="mention evil">ok</a><img src=x onerror=alert(1)></p><style>p{}</style>');
    expect(html).toBe('<p>Hi <a>x</a> <a href="https://ok.example" rel="nofollow noopener noreferrer" target="_blank" class="mention">ok</a></p>');
    expect(sanitizeHtml("<p>unclosed <strong>b")).toBe("<p>unclosed <strong>b</strong></p>");
  });
  test("HTML to text", () => {
    expect(htmlToText("<p>a &amp; b<br>c</p><p>d</p>")).toBe("a & b\nc\n\nd");
  });
  test("acct", () => {
    expect(parseAcct("@Bob@Mastodon.Social")).toEqual({ username: "Bob", domain: "mastodon.social" });
    expect(parseAcct("bob")).toBeNull();
  });
});
