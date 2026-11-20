/** An app's OAuth credential (`oauth_clients`). The secret itself is never stored, only its hash. */
export type OAuthClient = {
  id: string;
  user_id: string;
  /** The app it belongs to, as an entity URI (e.g. spacify:app:<id>); null for none. */
  app_uri: string | null;
  name: string;
  /** Public; sent by the app with every authorize and token request. */
  client_id: string;
  /** The secret's last four characters, to tell secrets apart. */
  secret_hint: string;
  secret_created_at: string;
  /** Where the consent page sends the user back with a code: matched exactly. */
  redirect_uri: string;
  /** The app's own callback (webhook) address, for calls to the app. */
  callback_url: string | null;
  /** The scopes it may ask for; empty: any. */
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

/** What the consent page shows of a client (`oauth_client_for_consent()`). */
export type OAuthConsentClient = {
  client_id: string;
  name: string;
  app_uri: string | null;
  redirect_uri: string;
  scopes: string[];
};

/** An app the user has allowed (`oauth_grant_list()`): one row per client with live tokens. */
export type OAuthGrant = {
  client_id: string;
  name: string;
  app_uri: string | null;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
};

/** What creating a credential or regenerating its secret returns: the secret, this once. */
export type OAuthSecret = { id: string; client_id: string; client_secret: string };

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };

/** The tables and functions the oauth app uses (see the migration in docs/guide/oauth.md). */
export type OAuthDatabase = {
  public: {
    Tables: {
      oauth_clients: Table<OAuthClient, "name" | "redirect_uri">;
    };
    Views: { [_ in never]: never };
    Functions: {
      oauth_create_client: Fn<{ p_name: string; p_redirect_uri: string; p_app_uri?: string | null; p_callback_url?: string | null; p_scopes?: string[] }, OAuthSecret>;
      oauth_regenerate_secret: Fn<{ p_id: string }, OAuthSecret>;
      oauth_client_for_consent: Fn<{ p_client_id: string; p_redirect_uri?: string | null }, OAuthConsentClient>;
      oauth_authorize: Fn<
        { p_client_id: string; p_redirect_uri: string; p_scopes: string[]; p_code_challenge?: string | null; p_code_challenge_method?: string | null },
        string
      >;
      oauth_grant_list: Fn<Record<string, never>, OAuthGrant[]>;
      oauth_revoke_grant: Fn<{ p_client_id: string }, undefined>;
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
