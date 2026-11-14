import type { Json } from "../../../supabase/types";

/**
 * The mastodon app's rows and the shapes its functions answer with. Accounts, statuses and
 * notifications come back from the database (mastodon_account_json(), mastodon_status_json(), …)
 * shaped like the Mastodon client API's entities, plus spacify's `identifier` and `slug`.
 */

export const REGISTRATION_MODES = ["open", "approval", "closed"] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

export const ACCOUNT_ROLES = ["owner", "admin", "moderator", "user"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const ACCOUNT_STATUSES = ["pending", "active", "silenced", "suspended", "disabled"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const VISIBILITIES = ["public", "unlisted", "private", "direct"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const DOMAIN_BLOCK_SEVERITIES = ["noop", "silence", "suspend"] as const;
export type DomainBlockSeverity = (typeof DOMAIN_BLOCK_SEVERITIES)[number];

export const REPLIES_POLICIES = ["followed", "list", "none"] as const;
export type RepliesPolicy = (typeof REPLIES_POLICIES)[number];

export const TIMELINES = ["home", "local", "federated", "notifications", "bookmarks", "favourites"] as const;
export type TimelineTab = (typeof TIMELINES)[number];

/** A server this app runs (`mastodon_instances`, spacify type `mastodon_instance`). */
export type MastodonInstance = {
  id: string;
  user_id: string;
  identifier: string;
  slug: string;
  domain: string;
  title: string;
  short_description: string | null;
  description: string | null;
  contact_email: string | null;
  registrations: RegistrationMode;
  registration_message: string | null;
  rules: { text: string; hint?: string }[];
  languages: string[];
  max_status_chars: number;
  site_id: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
  soft_deleted_at: string | null;
};

export type ProfileField = { name: string; value: string; verified_at?: string | null };

/** A profile row (`mastodon_accounts`, spacify type `mastodon_account`), local or remote. */
export type MastodonAccountRow = {
  id: string;
  user_id: string | null;
  instance_id: string | null;
  identifier: string;
  slug: string;
  domain: string | null;
  username: string;
  display_name: string | null;
  note: string | null;
  note_html: string | null;
  avatar_url: string | null;
  avatar_media_id: string | null;
  header_url: string | null;
  header_media_id: string | null;
  fields: ProfileField[];
  locked: boolean;
  bot: boolean;
  discoverable: boolean;
  indexable: boolean;
  role: AccountRole;
  status: AccountStatus;
  reason: string | null;
  actor_uri: string;
  url: string | null;
  followers_count: number;
  following_count: number;
  statuses_count: number;
  created_at: string;
  updated_at: string;
  soft_deleted_at: string | null;
};

export type Relationship = {
  id: string;
  following: boolean;
  requested: boolean;
  followed_by: boolean;
  requested_by: boolean;
  showing_reblogs: boolean;
  notifying: boolean;
  blocking: boolean;
  muting: boolean;
};

/** An account as the API shows it (mastodon_account_json()). */
export type MAccount = {
  id: string;
  identifier: string;
  slug: string;
  username: string;
  acct: string;
  domain: string;
  local: boolean;
  instance_id: string | null;
  user_id: string | null;
  display_name: string;
  note: string | null;
  note_html: string | null;
  avatar: string | null;
  header: string | null;
  fields: ProfileField[];
  locked: boolean;
  bot: boolean;
  discoverable: boolean;
  role: AccountRole;
  status: AccountStatus;
  url: string | null;
  uri: string;
  followers_count: number;
  following_count: number;
  statuses_count: number;
  last_status_at: string | null;
  created_at: string;
  relationship?: Relationship;
};

export type MMedia = {
  id: string;
  type: "image" | "gifv" | "video" | "audio" | "unknown";
  url: string;
  preview_url: string;
  remote_url: string | null;
  description: string | null;
};

export type MPoll = {
  id: string;
  options: { title: string; votes_count: number | null }[];
  multiple: boolean;
  expires_at: string | null;
  expired: boolean;
  votes_count: number;
  voters_count: number;
  hide_totals: boolean;
  voted: boolean;
  own_votes: number[];
};

/** A status as the API shows it (mastodon_status_json()). */
export type MStatus = {
  id: string;
  identifier: string;
  slug: string;
  uri: string;
  url: string | null;
  local: boolean;
  created_at: string;
  edited_at: string | null;
  /** A local status's text as typed (render it with tokenizeStatusText). */
  text: string | null;
  /** A remote status's HTML, sanitised when it arrived (render it with <SafeHtml/>). */
  content_html: string | null;
  spoiler_text: string;
  sensitive: boolean;
  visibility: Visibility;
  language: string | null;
  in_reply_to_id: string | null;
  in_reply_to_account_id: string | null;
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
  account: MAccount;
  reblog: MStatus | null;
  media_attachments: MMedia[];
  mentions: { id: string; username: string; acct: string; url: string | null; slug: string }[];
  tags: { id: string; name: string }[];
  poll: MPoll | null;
  favourited: boolean;
  reblogged: boolean;
  bookmarked: boolean;
};

export type MNotification = {
  id: string;
  identifier: string;
  slug: string;
  type: "mention" | "status" | "reblog" | "follow" | "follow_request" | "favourite" | "poll" | "update" | "admin.sign_up";
  created_at: string;
  read: boolean;
  account: MAccount | null;
  status: MStatus | null;
};

export type MSearchResults = {
  accounts: MAccount[];
  statuses: MStatus[];
  hashtags: { id: string; name: string; slug?: string; url?: string }[];
};

export type MThread = { status: MStatus | null; ancestors: MStatus[]; descendants: MStatus[] };

/** One of the instance's people, as its moderators see them (mastodon_admin_accounts()). */
export type AdminAccount = {
  account: MAccount;
  email: string | null;
  reason: string | null;
  admin_note: string | null;
  approved_at: string | null;
  suspended_at: string | null;
  silenced_at: string | null;
};

export type MastodonList = {
  id: string;
  user_id: string;
  account_id: string;
  identifier: string;
  slug: string;
  title: string;
  replies_policy: RepliesPolicy;
  exclusive: boolean;
  created_at: string;
  updated_at: string;
};

export type MastodonListAccount = { list_id: string; account_id: string; user_id: string; created_at: string };

export type DomainBlock = {
  id: string;
  user_id: string;
  instance_id: string;
  identifier: string;
  slug: string;
  domain: string;
  severity: DomainBlockSeverity;
  reject_media: boolean;
  public_comment: string | null;
  private_comment: string | null;
  created_at: string;
  updated_at: string;
};

/** A sign-in to another Mastodon server, used by the client (`mastodon_remote_sessions`). */
export type RemoteSession = {
  id: string;
  user_id: string;
  host: string;
  redirect_uri: string;
  client_id: string;
  client_secret: string;
  scopes: string;
  access_token: string | null;
  account: Json | null;
  acct: string | null;
  state: "pending" | "active";
  created_at: string;
  updated_at: string;
};

type Row = Record<string, unknown>;
type Table<R, Required extends keyof R = never> = {
  Row: R;
  Insert: Partial<R> & Pick<R, Required>;
  Update: Partial<R>;
  Relationships: [];
};
type Fn<Args, Returns = Json> = { Args: Args; Returns: Returns };

/** The app's tables and functions (created by the host's migration, see docs/guide/mastodon.md). */
export type MastodonDatabase = {
  public: {
    Tables: {
      mastodon_instances: Table<MastodonInstance, "domain" | "title">;
      mastodon_accounts: Table<MastodonAccountRow, "username">;
      mastodon_statuses: Table<Row & { id: string; text: string | null; soft_deleted_at: string | null; published_at: string }>;
      mastodon_follows: Table<Row & { id: string; account_id: string; target_account_id: string; state: string }, "account_id" | "target_account_id">;
      mastodon_favourites: Table<Row & { id: string; account_id: string; status_id: string }, "account_id" | "status_id">;
      mastodon_bookmarks: Table<Row & { id: string; account_id: string; status_id: string }, "account_id" | "status_id">;
      mastodon_blocks: Table<Row & { id: string; account_id: string; target_account_id: string }, "account_id" | "target_account_id">;
      mastodon_mutes: Table<Row & { id: string; account_id: string; target_account_id: string }, "account_id" | "target_account_id">;
      mastodon_poll_votes: Table<Row & { poll_id: string; account_id: string; choice: number }, "poll_id" | "account_id" | "choice">;
      mastodon_lists: Table<MastodonList, "account_id" | "title">;
      mastodon_list_accounts: Table<MastodonListAccount, "list_id" | "account_id">;
      mastodon_notifications: Table<Row & { id: string; account_id: string; read_at: string | null }>;
      mastodon_domain_blocks: Table<DomainBlock, "instance_id" | "domain">;
      mastodon_remote_sessions: Table<RemoteSession, "host" | "redirect_uri" | "client_id" | "client_secret">;
    };
    Views: { [_ in never]: never };
    Functions: {
      mastodon_post_status: Fn<
        {
          p_account: string;
          p_text?: string | null;
          p_spoiler_text?: string | null;
          p_sensitive?: boolean;
          p_visibility?: string;
          p_language?: string | null;
          p_in_reply_to?: string | null;
          p_media?: Json;
          p_poll?: Json | null;
          p_reblog_of?: string | null;
        },
        Row
      >;
      mastodon_timeline: Fn<{ p_kind: string; p_viewer?: string | null; p_arg?: string | null; p_before?: string | null; p_limit?: number; p_with_replies?: boolean }>;
      mastodon_thread: Fn<{ p_status: string; p_viewer?: string | null }>;
      mastodon_notification_list: Fn<{ p_viewer: string; p_before?: string | null; p_limit?: number; p_types?: string[] | null }>;
      mastodon_search: Fn<{ p_query: string; p_viewer?: string | null; p_limit?: number }>;
      mastodon_account_card: Fn<{ p_id: string; p_viewer?: string | null }>;
      mastodon_find_account: Fn<{ p_key: string }, string | null>;
      mastodon_admin_accounts: Fn<{ p_instance: string }, AdminAccount[]>;
      mastodon_admin_set_account: Fn<{ p_account: string; p_status?: string | null; p_role?: string | null; p_admin_note?: string | null }>;
      mastodon_admin_create_account: Fn<{ p_instance: string; p_email: string; p_username: string; p_display_name?: string | null; p_role?: string }>;
      mastodon_instance_info: Fn<{ p_domain: string }>;
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
