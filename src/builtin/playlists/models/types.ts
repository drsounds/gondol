/** The playlists app's tables and functions (the host's migrations create them; see docs/guide/playlists.md). */
export type PlaylistsDatabase = {
  public: {
    Tables: {
      playlists: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          identifier: string;
          slug: string;
          is_public: boolean;
          name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          identifier?: string;
          slug?: string;
          is_public?: boolean;
          name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          identifier?: string;
          slug?: string;
          is_public?: boolean;
          name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      playlist_items: {
        Row: {
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          identifier: string;
          slug: string;
          playlist_id: string;
          position: number;
          title: string | null;
          uri: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          identifier?: string;
          slug?: string;
          playlist_id: string;
          position?: number;
          title?: string | null;
          uri: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          identifier?: string;
          slug?: string;
          playlist_id?: string;
          position?: number;
          title?: string | null;
          uri?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "playlist_items_playlist_id_fkey";
            columns: ["playlist_id"];
            isOneToOne: false;
            referencedRelation: "playlists";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      playlist_covers: {
        Args: { p_playlist_id: string };
        Returns: {
          media_id: string;
          name: string;
          slot: string;
          provider: string;
          source: string;
          storage_path: string | null;
          url: string | null;
        }[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
