import { createContext, useContext, type ReactNode } from "react";
import type { A2uiActionHandler, A2uiCatalog } from "./A2uiSurface";
import type { UiActionHandler } from "./mcpUi";

/**
 * What generated UIs rendered deep inside something else (an AI answer's markdown, say) do with
 * actions, and the extra components they may use: the nearest `GenUiHost` decides.
 */
export type GenUiHostValue = {
  onAction?: A2uiActionHandler;
  onUiAction?: UiActionHandler;
  catalog?: A2uiCatalog;
};

const GenUiContext = createContext<GenUiHostValue>({});

export function GenUiHost({ value, children }: { value: GenUiHostValue; children: ReactNode }) {
  return <GenUiContext.Provider value={value}>{children}</GenUiContext.Provider>;
}

export function useGenUiHost(): GenUiHostValue {
  return useContext(GenUiContext);
}
