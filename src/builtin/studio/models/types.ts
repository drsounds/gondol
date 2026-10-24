import type { Json } from "../../../supabase/types";
import type { GenUiFormat } from "../../../genui/GenerativeUi";

/** An app built in the studio (`lite_apps`, spacify type `lite_app`). */
export type LiteApp = {
  id: string;
  user_id: string;
  identifier: string;
  slug: string;
  name: string;
  description: string | null;
  /** A bungalow glyph for its menu section. */
  icon_name: string | null;
  hue: number | null;
  /** Whether its pages are entries in the main menu. */
  in_menu: boolean;
  menu_order: number | null;
  /** What it is for, told to the agents that change it. */
  instructions: string | null;
  /** The agent (any entity URI) that built it: actions the app doesn't run itself go there. */
  builder_uri: string | null;
  created_at: string;
  updated_at: string;
  soft_deleted_at: string | null;
};

/** A page of an app (`lite_app_pages`): one generated UI at `/lite/<app>/<key>`. */
export type LitePage = {
  id: string;
  user_id: string;
  app_id: string;
  key: string;
  title: string;
  icon_name: string | null;
  position: number;
  in_menu: boolean;
  format: GenUiFormat;
  /** A2UI messages, an Open-JSON-UI tree, or (mcp_ui) HTML as a string or a UI resource. */
  document: Json;
  created_at: string;
  updated_at: string;
};

export type LiteFieldType = "text" | "long_text" | "number" | "integer" | "boolean" | "date" | "datetime" | "url" | "email" | "select" | "multiselect" | "uri";

export const LITE_FIELD_TYPES: readonly LiteFieldType[] = ["text", "long_text", "number", "integer", "boolean", "date", "datetime", "url", "email", "select", "multiselect", "uri"];

export type LiteField = {
  key: string;
  label?: string;
  type: LiteFieldType;
  required?: boolean;
  options?: string[];
  description?: string;
};

/** An entity type of an app (`lite_entity_types`): its records' fields. */
export type LiteEntityType = {
  id: string;
  user_id: string;
  app_id: string;
  key: string;
  name: string;
  plural_name: string | null;
  icon_name: string | null;
  fields: LiteField[];
  /** The field that is a record's name (default the first text field). */
  title_field: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type LiteRelationKind = "one" | "many";

/** A relation from one of an app's types to another, or to any entity type (`lite_entity_relations`). */
export type LiteRelation = {
  id: string;
  user_id: string;
  app_id: string;
  key: string;
  label: string;
  from_type_id: string;
  to_type_id: string | null;
  to_entity_type: string | null;
  kind: LiteRelationKind;
  created_at: string;
  updated_at: string;
};

/** A record of an app's entity type (`lite_records`, spacify type `lite_record`). */
export type LiteRecord = {
  id: string;
  user_id: string;
  identifier: string;
  slug: string;
  app_id: string;
  type_id: string;
  /** Kept from the type's title field by the database. */
  title: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  soft_deleted_at: string | null;
};

/** An app with everything in it, as the studio and the menu read it. */
export type LiteAppTree = LiteApp & {
  pages: LitePage[];
  types: LiteEntityType[];
  relations: LiteRelation[];
};

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

/** The studio app's tables (created by the host's migration, see docs/guide/studio.md). */
export type StudioDatabase = {
  public: {
    Tables: {
      lite_apps: Table<LiteApp, "name">;
      lite_app_pages: Table<LitePage, "app_id" | "key" | "title" | "format">;
      lite_entity_types: Table<LiteEntityType, "app_id" | "key" | "name">;
      lite_entity_relations: Table<LiteRelation, "app_id" | "key" | "label" | "from_type_id">;
      lite_records: Table<LiteRecord, "app_id" | "type_id">;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
