export interface AccountConnection {
  id: string;
  provider: "github";
  external_user_id: string;
  login: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export type AccountsDatabase = {
  public: {
    Tables: { account_connections: Table<AccountConnection> };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
