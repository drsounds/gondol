import { useMemo } from "react";
import { useActions } from "../actions";
import type { AppAction } from "../types";
import { EntitySheet } from "../../entities/EntitySheet";
import { formatShortcut } from "../../navigation/shortcuts";

/** Lists every action that has a keyboard shortcut, grouped by category ("?" opens it). */
export function KeyboardShortcutsDialog() {
  const { isShortcutsHelpOpen, closeShortcutsHelp, allActions } = useActions();

  const groups = useMemo(() => {
    const byCategory = new Map<string, AppAction[]>();
    for (const action of allActions) {
      if (!action.shortcut) continue;
      const category = action.category ?? "General";
      byCategory.set(category, [...(byCategory.get(category) ?? []), action]);
    }
    return [...byCategory.entries()];
  }, [allActions]);

  if (!isShortcutsHelpOpen) return null;

  return (
    <EntitySheet title="Keyboard shortcuts" onClose={closeShortcutsHelp} closeLabel="Close">
      <div className="stack">
        {groups.map(([category, actions]) => (
          <section key={category}>
            <h3 className="stat-label">{category}</h3>
            <dl>
              {actions.map((action) => (
                <div key={action.id}>
                  <dt>{action.title}</dt>
                  <dd>
                    <kbd>{formatShortcut(action.shortcut!)}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </EntitySheet>
  );
}
