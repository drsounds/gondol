import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppAction, AppActionContext, IconName } from "./types";
import { useResolutions } from "./contributions";
import { byOrder, navItemsHook } from "./shellHooks";
import { useActiveBundles } from "./hooks";
import { featureCapability } from "./registry";
import { mergeCapability, useSiteOffers } from "../sites/capabilities";
import { matchesShortcut, isEditableElement } from "../navigation/shortcuts";

interface ActionsContextValue {
  isOpen: boolean;
  openActionsMenu: () => void;
  closeActionsMenu: () => void;
  toggleActionsMenu: () => void;
  isShortcutsHelpOpen: boolean;
  openShortcutsHelp: () => void;
  closeShortcutsHelp: () => void;
  toggleShortcutsHelp: () => void;
  allActions: AppAction[];
  executeAction: (action: AppAction) => Promise<void> | void;
  context: AppActionContext;
  registerDynamicActions: (id: string, actions: AppAction[]) => void;
  unregisterDynamicActions: (id: string) => void;
}

const ActionsContext = createContext<ActionsContextValue | null>(null);

/** A root tab: a "Go to …" palette action with a Mod+<n> shortcut, by its place among the tabs. */
export interface RootTab {
  id: string;
  path: string;
  name: string;
  iconName: IconName;
  /** Position among the tabs; apps' navigation items marked `tab` join by their `order`. */
  order: number;
}

/** The shell's own root tabs; apps add theirs through their navigation items (`nav.tab`). */
export const DEFAULT_ROOT_TABS: RootTab[] = [
  { path: "/", id: "overview", name: "Overview", iconName: "home", order: 0 },
  { path: "/search", id: "search", name: "Search", iconName: "magnifying-glass", order: 20 },
  { path: "/app-finder", id: "apps", name: "App Finder", iconName: "grid", order: 90 },
  { path: "/account", id: "account", name: "Account", iconName: "user", order: 100 },
];

export interface ActionsProviderProps {
  children: ReactNode;
  navigate: (path: string) => void;
  openCreate?: () => void;
  toggleSidebar?: () => void;
  toggleTheme?: () => void;
  pathname?: string;
  activeTab?: string;
  /** The shell's own root tabs (default DEFAULT_ROOT_TABS). */
  rootTabs?: RootTab[];
}

export function ActionsProvider({
  children,
  navigate,
  openCreate,
  toggleSidebar,
  toggleTheme,
  pathname = "/",
  activeTab = "overview",
  rootTabs = DEFAULT_ROOT_TABS,
}: ActionsProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
  const [dynamicActionGroups, setDynamicActionGroups] = useState<Map<string, AppAction[]>>(
    () => new Map()
  );

  const activeBundles = useActiveBundles();
  const navItems = useResolutions(navItemsHook);
  const ROOT_TABS = useMemo(
    () =>
      byOrder([
        ...rootTabs,
        ...navItems
          .filter(({ value }) => value.tab)
          .map(({ value }) => ({ id: value.id, path: value.path, name: value.title, iconName: (value.iconName === "@saved" ? "like-fill" : value.iconName) as IconName, order: value.order })),
      ]).map((tab, index) => ({ ...tab, shortcut: index < 9 ? `Mod+${index + 1}` : undefined })),
    [rootTabs, navItems],
  );

  const openActionsMenu = useCallback(() => setIsOpen(true), []);
  const closeActionsMenu = useCallback(() => setIsOpen(false), []);
  const toggleActionsMenu = useCallback(() => setIsOpen((prev) => !prev), []);

  const openShortcutsHelp = useCallback(() => setIsShortcutsHelpOpen(true), []);
  const closeShortcutsHelp = useCallback(() => setIsShortcutsHelpOpen(false), []);
  const toggleShortcutsHelp = useCallback(() => setIsShortcutsHelpOpen((prev) => !prev), []);

  const registerDynamicActions = useCallback((id: string, actions: AppAction[]) => {
    setDynamicActionGroups((prev) => {
      const next = new Map(prev);
      next.set(id, actions);
      return next;
    });
  }, []);

  const unregisterDynamicActions = useCallback((id: string) => {
    setDynamicActionGroups((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const context: AppActionContext = useMemo(
    () => ({
      navigate,
      openCreate,
      toggleSidebar,
      toggleTheme,
      openShortcutsHelp,
      openActionsMenu,
      closeActionsMenu,
      activeTab,
      pathname,
    }),
    [
      navigate,
      openCreate,
      toggleSidebar,
      toggleTheme,
      openShortcutsHelp,
      openActionsMenu,
      closeActionsMenu,
      activeTab,
      pathname,
    ]
  );

  const executeAction = useCallback(
    (action: AppAction) => {
      closeActionsMenu();
      try {
        action.perform(context);
      } catch (err) {
        console.error("Failed to perform action", action.id, err);
      }
    },
    [closeActionsMenu, context]
  );

  // Global Navigation & Utility Actions
  const globalActions: AppAction[] = useMemo(() => {
    const list: AppAction[] = [
      {
        id: "core.openCommandPalette",
        title: "Actions Menu / Command Palette",
        description: "Open the actions palette to search commands and features",
        category: "General",
        iconName: "magnifying-glass",
        shortcut: "Mod+Shift+P",
        keywords: ["palette", "actions", "commands", "menu", "prompt"],
        perform: () => openActionsMenu(),
      },
      {
        id: "core.shortcutsHelp",
        title: "Keyboard Shortcuts",
        description: "Show list of keyboard shortcuts",
        category: "General",
        iconName: "settings",
        shortcut: "?",
        keywords: ["help", "shortcuts", "hotkeys", "keys"],
        perform: () => openShortcutsHelp(),
      },
    ];

    if (toggleSidebar) {
      list.push({
        id: "core.toggleSidebar",
        title: "Toggle Sidebar",
        description: "Collapse or expand the navigation sidebar",
        category: "General",
        iconName: "three-dots-v",
        shortcut: "Mod+B",
        keywords: ["sidebar", "collapse", "expand", "navigation"],
        perform: () => toggleSidebar(),
      });
    }

    if (toggleTheme) {
      list.push({
        id: "core.toggleTheme",
        title: "Toggle Color Theme",
        description: "Switch between light and dark themes",
        category: "General",
        iconName: "brush",
        shortcut: "Mod+Shift+T",
        keywords: ["theme", "dark", "light", "mode", "color"],
        perform: () => toggleTheme(),
      });
    }

    if (openCreate) {
      list.push({
        id: "core.openCreate",
        title: "Create New...",
        description: "Open create entity picker",
        category: "Create",
        aspects: ["create"],
        iconName: "plus",
        shortcut: "Mod+Shift+A",
        keywords: ["new", "create", "add", "picker"],
        perform: () => openCreate(),
      });
    }

    // Tab Navigation Actions
    ROOT_TABS.forEach((tab) => {
      list.push({
        id: `nav.tab.${tab.id}`,
        title: `Go to ${tab.name}`,
        subtitle: tab.path,
        description: `Navigate to ${tab.name} tab`,
        category: "Navigation",
        iconName: tab.iconName,
        shortcut: tab.shortcut,
        keywords: ["navigate", "tab", tab.name.toLowerCase()],
        perform: () => navigate(tab.path),
      });
    });

    list.push(
      {
        id: "nav.tab.previous",
        title: "Previous Tab",
        description: "Switch to previous main tab",
        category: "Navigation",
        shortcut: "Mod+[",
        keywords: ["tab", "previous", "back"],
        perform: () => {
          const currentIndex = ROOT_TABS.findIndex(
            (t) => pathname === t.path || (t.path !== "/" && pathname.startsWith(t.path))
          );
          const nextIndex =
            currentIndex <= 0 ? ROOT_TABS.length - 1 : currentIndex - 1;
          navigate(ROOT_TABS[nextIndex].path);
        },
      },
      {
        id: "nav.tab.next",
        title: "Next Tab",
        description: "Switch to next main tab",
        category: "Navigation",
        shortcut: "Mod+]",
        keywords: ["tab", "next", "forward"],
        perform: () => {
          const currentIndex = ROOT_TABS.findIndex(
            (t) => pathname === t.path || (t.path !== "/" && pathname.startsWith(t.path))
          );
          const nextIndex =
            currentIndex === -1 || currentIndex >= ROOT_TABS.length - 1
              ? 0
              : currentIndex + 1;
          navigate(ROOT_TABS[nextIndex].path);
        },
      }
    );

    return list;
  }, [
    openActionsMenu,
    openShortcutsHelp,
    toggleSidebar,
    toggleTheme,
    openCreate,
    navigate,
    pathname,
    ROOT_TABS,
  ]);

  // Combine actions from:
  // 1. globalActions
  // 2. Active app bundles and their features
  // 3. Dynamic actions registered by mounted views
  // Each is left out when the site served here doesn't offer it (its roles and aspects,
  // sites/capabilities.ts); a feature's actions take the feature's tags unless they set their own.
  const offers = useSiteOffers();
  const allActions = useMemo(() => {
    const list: AppAction[] = globalActions.filter((action) => offers(action));

    // Collect actions declared by apps and features
    for (const bundle of activeBundles) {
      if (bundle.actions) {
        list.push(...bundle.actions.filter((action) => offers(action)));
      }
      for (const feature of bundle.features) {
        const capability = featureCapability(bundle, feature);
        if (feature.actions) {
          list.push(...feature.actions.filter((action) => offers(mergeCapability(action, capability))));
        } else if (offers(capability)) {
          // Provide default navigation action for features that have not defined custom actions
          const featurePath = feature.path.startsWith("/") ? feature.path : `/${feature.path}`;
          list.push({
            id: `app.${bundle.id}.${feature.id}.open`,
            title: `Open ${feature.name}`,
            subtitle: bundle.name,
            description: feature.description,
            category: bundle.name,
            iconName: feature.iconName || bundle.iconName,
            keywords: [bundle.name.toLowerCase(), feature.name.toLowerCase()],
            perform: () => navigate(featurePath),
          });
        }
      }
    }

    // Collect dynamic actions from mounted views
    for (const actions of dynamicActionGroups.values()) {
      list.push(...actions.filter((action) => offers(action)));
    }

    // Deduplicate actions by ID
    const seen = new Set<string>();
    return list.filter((act) => {
      if (seen.has(act.id)) return false;
      seen.add(act.id);
      return true;
    });
  }, [globalActions, activeBundles, dynamicActionGroups, navigate, offers]);

  // Global Keyboard Shortcuts Listener
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 1. Command Palette: Cmd/Ctrl + Shift + P, or Cmd/Ctrl + P, or Cmd/Ctrl + K
      if (
        matchesShortcut(event, "Mod+Shift+P") ||
        matchesShortcut(event, "Mod+P") ||
        matchesShortcut(event, "Mod+K")
      ) {
        event.preventDefault();
        event.stopPropagation();
        toggleActionsMenu();
        return;
      }

      // If Command Palette or Shortcuts Help is open, let their own modal handlers manage Esc/arrows
      if (isOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeActionsMenu();
        }
        return;
      }

      if (isShortcutsHelpOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeShortcutsHelp();
        }
        return;
      }

      const editable = isEditableElement(event.target);

      // Check all action shortcuts
      for (const action of allActions) {
        if (!action.shortcut || action.disabled) continue;

        // Don't fire single-character shortcuts (like "?") when typing inside an input/textarea
        if (editable && !event.metaKey && !event.ctrlKey) {
          continue;
        }

        if (matchesShortcut(event, action.shortcut)) {
          event.preventDefault();
          event.stopPropagation();
          executeAction(action);
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    isOpen,
    isShortcutsHelpOpen,
    allActions,
    toggleActionsMenu,
    closeActionsMenu,
    closeShortcutsHelp,
    executeAction,
  ]);

  const value: ActionsContextValue = useMemo(
    () => ({
      isOpen,
      openActionsMenu,
      closeActionsMenu,
      toggleActionsMenu,
      isShortcutsHelpOpen,
      openShortcutsHelp,
      closeShortcutsHelp,
      toggleShortcutsHelp,
      allActions,
      executeAction,
      context,
      registerDynamicActions,
      unregisterDynamicActions,
    }),
    [
      isOpen,
      openActionsMenu,
      closeActionsMenu,
      toggleActionsMenu,
      isShortcutsHelpOpen,
      openShortcutsHelp,
      closeShortcutsHelp,
      toggleShortcutsHelp,
      allActions,
      executeAction,
      context,
      registerDynamicActions,
      unregisterDynamicActions,
    ]
  );

  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}

/**
 * Access the Actions Menu facility and registered actions.
 */
export function useActions() {
  const ctx = useContext(ActionsContext);
  if (!ctx) {
    throw new Error("useActions must be used within an ActionsProvider");
  }
  return ctx;
}

/**
 * Hook for any page, panel or component to register contextual actions.
 * Actions are automatically removed when the component unmounts.
 */
export function useRegisterActions(actions: AppAction[]) {
  const { registerDynamicActions, unregisterDynamicActions } = useActions();
  const id = useMemo(() => Math.random().toString(36).substring(2, 9), []);

  useEffect(() => {
    registerDynamicActions(id, actions);
    return () => unregisterDynamicActions(id);
  }, [id, actions, registerDynamicActions, unregisterDynamicActions]);
}
