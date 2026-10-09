import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { EntitySheet } from "./EntitySheet";
import { FormActions } from "./FormActions";
import { Input } from "../design-system/bungalow-79d923";
import { supabase } from "../supabase/client";
import { showToast } from "../shell/clipboard";
import type { DateRangeSearch } from "../navigation/dateRangeSearch";
import type { DragData } from "./dragEntity";
import { entityTable, entityTypeLabel, isKnownEntityType } from "./lookup";
import { useI18n } from "../i18n/i18n";
import { isDefaultSlug, matchesEntityKey, slugify, slugProblem, type Keyed } from "./slugs";
import { parseEntityUri } from "./uri";

type SlugRow = Required<Keyed> & { slug: string; identifier: string };

// The table is picked at runtime from the entity type, so the typed client's per-table overloads
// can't apply.
type LooseTable = {
  select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> } };
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: string) => { select: (columns: string) => PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }> };
  };
};
const looseFrom = supabase.from.bind(supabase) as unknown as (table: string) => LooseTable;

/**
 * "Change address…" for any entity with a spacify URI: edits its slug, the key used in its URLs
 * (blank resets it to the identifier). If the current address uses the old key it's updated too.
 */
export function EntitySlugSheet({ entity, onClose }: { entity: DragData; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const parsed = parseEntityUri(entity.uri);
  const table = parsed && isKnownEntityType(parsed.entityType) ? entityTable(parsed.entityType) : null;
  const id = parsed?.entityId ?? "";

  const row = useQuery({
    queryKey: ["entity-slug", table, id],
    enabled: !!table,
    queryFn: async () => {
      const { data, error } = await looseFrom(table!).select("id, identifier, slug").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data ?? null) as SlugRow | null;
    },
  });
  const current = row.data ?? null;

  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (current) setDraft(isDefaultSlug(current) ? "" : current.slug);
  }, [current]);

  const save = useMutation({
    mutationFn: async (slug: string) => {
      const { data, error } = await looseFrom(table!).update({ slug: slug || null }).eq("id", id).select("slug");
      if (error) throw error;
      const saved = (data?.[0] as { slug?: string } | undefined)?.slug;
      if (!saved) throw { code: "denied" };
      return saved;
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries();
      showToast(t("slug.saved"));
      // Keep the open page on the entity it was showing.
      if (current) {
        const next = pathname
          .split("/")
          .map((segment) => (matchesEntityKey(current, segment) ? saved : segment))
          .join("/");
        if (next !== pathname) {
          navigate({ to: next, search: (prev: DateRangeSearch) => prev, replace: true } as Parameters<typeof navigate>[0]);
        }
      }
      onClose();
    },
  });

  const slug = draft.trim();
  const problem = slugProblem(slug);
  const errorCode = (save.error as { code?: string } | null)?.code;
  const error = problem
    ? t(`slug.error.${problem}`)
    : errorCode === "23505"
      ? t("slug.error.taken")
      : errorCode === "23514"
        ? t("slug.error.reserved")
        : save.error
          ? t("slug.error.denied")
          : undefined;
  const shownKey = slug || current?.identifier || "…";
  const shownPath = pathname
    .split("/")
    .map((segment) => (current && matchesEntityKey(current, segment) ? shownKey : segment))
    .join("/");

  return (
    <EntitySheet
      title={t("slug.title")}
      subtitle={entity.label}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!current || problem) return;
        save.mutate(slugify(slug));
      }}
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={t("form.save")}
          saving={save.isPending}
          submitDisabled={!current || problem !== null}
        />
      }
      preview={
        <div className="entity-preview">
          <div>
            <div className="entity-preview__kind">{entityTypeLabel(t, entity.uri)}</div>
            <div className="entity-preview__label">{entity.label}</div>
          </div>
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("slug.label")}</dt>
              <dd>{shownKey}</dd>
            </div>
            {current ? (
              <div>
                <dt>{t("slug.identifier")}</dt>
                <dd>{current.identifier}</dd>
              </div>
            ) : null}
            {shownPath !== pathname ? (
              <div>
                <dt>{t("slug.preview")}</dt>
                <dd>{shownPath}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      }
    >
      <div className="form-grid">
        <Input
          label={t("slug.label")}
          placeholder={slugify(entity.label) || current?.identifier}
          value={draft}
          disabled={!current}
          hint={t("slug.hint", { identifier: current?.identifier ?? "…" })}
          error={error}
          onChange={(e) => setDraft(e.target.value.toLowerCase())}
          onBlur={() => setDraft((value) => slugify(value))}
        />
      </div>
    </EntitySheet>
  );
}
