import { useMemo, useState, type KeyboardEvent } from "react";
import { useActions } from "../actions";
import type { AppAction } from "../types";
import { EntitySheet } from "../../entities/EntitySheet";
import { Input } from "../../design-system/bungalow-79d923";
import { formatShortcut } from "../../navigation/shortcuts";

/**
 * The Actions Menu / command palette (Mod+Shift+P): a searchable list of every registered action.
 * A transient picker rather than an entity form, so it's provider state, not a route (see
 * CLAUDE.md, "Exceptions").
 */
export function ActionsPalette() {
  const { isOpen, closeActionsMenu } = useActions();
  if (!isOpen) return null;
  return <ActionsPaletteSheet onClose={closeActionsMenu} />;
}

function ActionsPaletteSheet({ onClose }: { onClose: () => void }) {
  const { allActions, executeAction } = useActions();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const available = allActions.filter((a) => !a.disabled);
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter((a) =>
      [a.title, a.subtitle, a.description, a.category, ...(a.keywords ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [allActions, query]);
  const highlighted: AppAction | undefined = items[Math.min(active, items.length - 1)];

  function choose(action: AppAction | undefined) {
    if (action) executeAction(action);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    setActive((i) => (Math.min(i, items.length - 1) + step + items.length) % Math.max(items.length, 1));
  }

  return (
    <EntitySheet
      title="Actions"
      onClose={onClose}
      closeLabel="Close"
      onSubmit={(event) => {
        event.preventDefault();
        choose(highlighted);
      }}
      preview={
        highlighted ? (
          <div className="entity-preview">
            <div>
              {highlighted.category && <div className="entity-preview__kind">{highlighted.category}</div>}
              <div className="entity-preview__label">{highlighted.title}</div>
            </div>
            {highlighted.shortcut && <kbd>{formatShortcut(highlighted.shortcut)}</kbd>}
            {highlighted.description && <p className="entity-preview__note">{highlighted.description}</p>}
          </div>
        ) : null
      }
    >
      <div className="stack">
        <Input
          label="Search actions"
          type="search"
          autoFocus
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="actions-palette-list"
          aria-activedescendant={highlighted ? `action-${highlighted.id}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onSearchKeyDown}
        />
        {items.length === 0 ? (
          <p className="stat-label">No matching actions</p>
        ) : (
          <ul id="actions-palette-list" className="create-grid" role="listbox" aria-label="Actions">
            {items.map((action, index) => (
              <li key={action.id} id={`action-${action.id}`} role="option" aria-selected={action === highlighted}>
                <button
                  type="button"
                  className={action === highlighted ? "create-grid__item create-grid__item--active" : "create-grid__item"}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onClick={() => choose(action)}
                >
                  <span className="create-grid__label">{action.title}</span>
                  <span className="create-grid__section">
                    {action.shortcut ? formatShortcut(action.shortcut) : action.category}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </EntitySheet>
  );
}
