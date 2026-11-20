/** The library app's tables (the host's migrations create them; see docs/guide/library.md). */
export type LibraryDatabase = {
  public: {
    Tables: {
      saved_items: {
        Row: {
          created_at: string;
          id: string;
          identifier: string;
          slug: string;
          label: string | null;
          spacify_uri: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          identifier?: string;
          slug?: string;
          label?: string | null;
          spacify_uri: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          identifier?: string;
          slug?: string;
          label?: string | null;
          spacify_uri?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      pinned_items: {
        Row: {
          created_at: string;
          id: string;
          identifier: string;
          slug: string;
          label: string | null;
          position: number;
          spacify_uri: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          identifier?: string;
          slug?: string;
          label?: string | null;
          position?: number;
          spacify_uri: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          identifier?: string;
          slug?: string;
          label?: string | null;
          position?: number;
          spacify_uri?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
