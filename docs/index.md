---
layout: home

hero:
  name: Gondol
  text: A web application framework on TanStack Start, React and Supabase
  tagline: The application shell, theming engine, navigation, search, entity system and apps framework, so an app only brings its own apps.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Build your first app
      link: /tutorial/first-app
    - theme: alt
      text: Module reference
      link: /reference/modules

features:
  - title: Apps and features
    details: An app built on gondol is a bundle of apps. Each app has features (pages), actions for the command palette and widgets for the shell, and the user can switch apps on and off.
    link: /guide/apps
  - title: Entities
    details: Every row in the database is an entity with a URI (myapp:note:shopping-list), a public address, a slug, a label, cover art, an actions menu and drag and drop.
    link: /guide/entities
  - title: Application shell
    details: A Spotify-style chrome bar, sidebar, phone tab bar and menu drawer, built from the active apps, with a command palette and keyboard shortcuts.
    link: /guide/app-shell
  - title: Theming engine
    details: Light and dark mode, an accent colour, palettes and style flavors, plus the Frutiger Aero and TUI engines, synced across the user's devices.
    link: /guide/theming
  - title: Search and filters
    details: One entity search behind the search page, @ mentions and entity pickers, and a global type, condition and date filter carried in the URL.
    link: /guide/search-and-filters
  - title: App settings and AI
    details: Apps declare their settings (sections, submenus, six types) per user, workspace or site, and the built-in ai app adds an LLM chat on Ollama.
    link: /guide/settings
  - title: Supabase base
    details: Shared browser and server clients, auth middleware for server functions, and the small schema the framework's queries expect.
    link: /guide/supabase
---
