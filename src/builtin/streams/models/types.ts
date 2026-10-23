/** Whether the user logged a stream by hand or something (a task's play button) did it. */
export type StreamSource = "manual" | "automatic";

/**
 * A stream (`streams`): a subject (the user, `spacify:user:<id>`) doing an action (the predicate)
 * on an object entity, in a context (a task), for a motivation (any entity), from `start_date` to
 * `end_date`. The database sets `duration_seconds` from the two (NULL while it is open).
 */
export type Stream = {
  id: string;
  user_id: string;
  identifier?: string | null;
  slug?: string | null;
  /** The predicate: what the subject does, e.g. "pays rent" or a task's title. */
  action: string;
  subject_uri: string;
  context_uri: string | null;
  object_uri: string | null;
  motivation_uri: string | null;
  description: string | null;
  source: StreamSource;
  start_date: string;
  end_date: string | null;
  duration_seconds: number | null;
  position_seconds: number | null;
  /** How many of the action the stream records (default 1). */
  quantity: number;
  created_at: string;
  updated_at: string;
};

/** An entry of a stream (`stream_entries`): yin out and yang in, to an object, optionally booked to accounts. */
export type StreamEntry = {
  id: string;
  user_id: string;
  identifier?: string | null;
  slug?: string | null;
  stream_id: string;
  object_uri: string | null;
  yin: number;
  yang: number;
  yin_account_id: string | null;
  yang_account_id: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

/** The tables the streams app reads and writes (see docs/guide/streams.md). */
export type StreamsDatabase = {
  public: {
    Tables: {
      streams: Table<Stream, "user_id" | "action" | "subject_uri">;
      stream_entries: Table<StreamEntry, "user_id" | "stream_id">;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
