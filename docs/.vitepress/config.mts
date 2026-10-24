// The docs site, published to GitHub Pages by .github/workflows/docs.yml at
// https://drsounds.github.io/gondol/ (a project site, hence the base path). A plain object rather
// than defineConfig(): the workflow runs VitePress through npx, so the package isn't importable here.
export default {
  title: "Gondol",
  description: "A web application framework on TanStack Start, React and Supabase.",
  base: "/gondol/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Tutorial", link: "/tutorial/first-app" },
      { text: "Reference", link: "/reference/modules" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Core concepts", link: "/guide/concepts" },
        ],
      },
      {
        text: "Apps",
        items: [
          { text: "Building apps", link: "/guide/apps" },
          { text: "Features", link: "/guide/features" },
          { text: "Actions and shortcuts", link: "/guide/actions" },
          { text: "Widgets", link: "/guide/widgets" },
          { text: "App settings", link: "/guide/settings" },
          { text: "The application shell", link: "/guide/app-shell" },
        ],
      },
      {
        text: "Entities",
        items: [
          { text: "Entities", link: "/guide/entities" },
          { text: "Entity UI", link: "/guide/entity-ui" },
          { text: "Search and filters", link: "/guide/search-and-filters" },
        ],
      },
      {
        text: "Platform",
        items: [
          { text: "Theming", link: "/guide/theming" },
          { text: "Internationalization", link: "/guide/i18n" },
          { text: "Supabase", link: "/guide/supabase" },
          { text: "Sites", link: "/guide/sites" },
          { text: "Platform services", link: "/guide/platform" },
          { text: "App APIs (OpenAPI)", link: "/guide/api" },
          { text: "App functions and MCP", link: "/guide/functions" },
        ],
      },
      {
        text: "Built-in apps",
        items: [
          { text: "The search app", link: "/guide/search" },
          { text: "The library app", link: "/guide/library" },
          { text: "The playlists app", link: "/guide/playlists" },
          { text: "The ai app", link: "/guide/ai" },
          { text: "The agents app", link: "/guide/agents" },
          { text: "The streams app", link: "/guide/streams" },
          { text: "The analytics app", link: "/guide/analytics" },
          { text: "The oauth app", link: "/guide/oauth" },
          { text: "The Service Finder app", link: "/guide/service-finder" },
        ],
      },
      {
        text: "Tutorial",
        items: [{ text: "Build your first app", link: "/tutorial/first-app" }],
      },
      {
        text: "Reference",
        items: [
          { text: "Configuration", link: "/reference/configuration" },
          { text: "Modules", link: "/reference/modules" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/drsounds/gondol" }],
    editLink: {
      pattern: "https://github.com/drsounds/gondol/edit/main/docs/:path",
    },
    search: { provider: "local" },
    outline: { level: [2, 3] },
  },
};
