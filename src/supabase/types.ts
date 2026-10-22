/**
 * The base schema gondol's own modules read and call: the tables and Postgres functions an app's
 * Supabase project has to provide (see README.md, "Supabase base"). An app's generated `Database`
 * type is a superset of this one; gondol's client is typed with it so its queries stay checked.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type GondolDatabase = {
  public: {
    Tables: {
      app_settings: {
        Row: {
          id: string;
          app_id: string;
          scope: string;
          scope_id: string;
          data: Json;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          app_id: string;
          scope: string;
          scope_id: string;
          data?: Json;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          app_id?: string;
          scope?: string;
          scope_id?: string;
          data?: Json;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      public_entities: {
        Row: {
          id: string;
          user_id: string;
          entity_type: string;
          entity_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          entity_type: string;
          entity_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          entity_type?: string;
          entity_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      user_themes: {
        Row: {
          accent_color: string | null;
          created_at: string;
          engine: string;
          id: string;
          identifier: string;
          slug: string;
          mode: string | null;
          saved_themes: Json;
          theme: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          accent_color?: string | null;
          created_at?: string;
          engine?: string;
          id?: string;
          identifier?: string;
          slug?: string;
          mode?: string | null;
          saved_themes?: Json;
          theme?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          accent_color?: string | null;
          created_at?: string;
          engine?: string;
          id?: string;
          identifier?: string;
          slug?: string;
          mode?: string | null;
          saved_themes?: Json;
          theme?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      entity_lifecycle_states: {
        Args: Record<PropertyKey, never>;
        Returns: {
          entity_id: string;
          entity_identifier: string | null;
          entity_slug: string | null;
          entity_type: string;
          future_start: boolean;
          soft_deleted_at: string | null;
        }[];
      };
      entity_slugs: {
        Args: { p_keys: string[] };
        Returns: { key: string; entity_table: string; id: string; slug: string }[];
      };
      global_filter_excluded: {
        Args: { p_conditions?: Json; p_from?: string; p_match?: string; p_to?: string; p_types?: string[] };
        Returns: { entity_id: string; entity_type: string }[];
      };
      search_entities: {
        Args: { p_limit?: number; p_query: string; p_types?: string[] };
        Returns: {
          entity_id: string;
          entity_type: string;
          is_own: boolean;
          is_public: boolean;
          rank: number;
          subtitle: string | null;
          title: string | null;
          updated_at: string;
        }[];
      };
      set_entity_soft_deleted_at: {
        Args: { p_at: string | null; p_entity_key: string; p_entity_type: string };
        Returns: undefined;
      };
      site_for_domain: {
        Args: { p_domain: string };
        Returns: {
          id: string;
          name: string;
          domain: string;
          description: string | null;
          enabled_apps: string[] | null;
          layout: Json;
          theme: Json | null;
          entity_types: string[] | null;
          conditions: Json;
          condition_match: string;
          restricted: boolean;
          allow_anonymous: boolean;
          is_owner: boolean;
          is_member: boolean;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
