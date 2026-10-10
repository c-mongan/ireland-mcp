import { SectionPreview } from "./SectionPreview";

export default {
  title: "Ireland MCP/Sections",
  component: SectionPreview,
  parameters: { layout: "fullscreen", chromatic: { viewports: [1280] }, docs: { description: { component: "Review-only previews of the real Ireland MCP website sections and recorded demo poster. Edit web/index.html and web/styles.css for product changes. These previews block live requests, scripts, video playback, installation links and copy actions." } } },
  argTypes: {
    theme: { control: "radio", options: ["dark", "light"] },
    section: { control: false },
    state: { control: false }
  }
};

export const HeroDark = { args: { section: "top", theme: "dark" }, parameters: { chromatic: { viewports: [360, 1280] } } };
export const HeroLight = { args: { section: "top", theme: "light" }, parameters: { chromatic: { viewports: [360, 1280] } } };
export const DemoPlayerDark = { args: { section: "demo-dialog", theme: "dark" }, parameters: { chromatic: { viewports: [360, 1280] } } };
export const DemoPlayerLight = { args: { section: "demo-dialog", theme: "light" }, parameters: { chromatic: { viewports: [360, 1280] } } };
export const InstallerDark = { args: { section: "install", theme: "dark" } };
export const InstallerLight = { args: { section: "install", theme: "light" } };
export const DirectoryDark = { args: { section: "directory", theme: "dark" } };
export const DirectoryLight = { args: { section: "directory", theme: "light" } };
export const PlaygroundIdleDark = { args: { section: "playground", state: "idle", theme: "dark" } };
export const PlaygroundIdleLight = { args: { section: "playground", state: "idle", theme: "light" } };
export const PlaygroundLoadingDark = { args: { section: "playground", state: "loading", theme: "dark" } };
export const PlaygroundLoadingLight = { args: { section: "playground", state: "loading", theme: "light" } };
export const PlaygroundSuccessDark = { args: { section: "playground", state: "success", theme: "dark" }, parameters: { chromatic: { viewports: [360, 1280] } } };
export const PlaygroundSuccessLight = { args: { section: "playground", state: "success", theme: "light" }, parameters: { chromatic: { viewports: [360, 1280] } } };
export const PlaygroundEmptyDark = { args: { section: "playground", state: "empty", theme: "dark" } };
export const PlaygroundEmptyLight = { args: { section: "playground", state: "empty", theme: "light" } };
export const PlaygroundErrorDark = { args: { section: "playground", state: "error", theme: "dark" } };
export const PlaygroundErrorLight = { args: { section: "playground", state: "error", theme: "light" } };

export const PlaygroundTruncatedDark = { args: { section: "playground", state: "truncated", theme: "dark" } };
export const PlaygroundTruncatedLight = { args: { section: "playground", state: "truncated", theme: "light" } };
export const PlaygroundWeatherDark = { args: { section: "playground", state: "weather", theme: "dark" } };
export const PlaygroundWeatherLight = { args: { section: "playground", state: "weather", theme: "light" } };
export const PlaygroundTransportDark = { args: { section: "playground", state: "transport", theme: "dark" } };
export const PlaygroundTransportLight = { args: { section: "playground", state: "transport", theme: "light" } };
export const PlaygroundRentDark = { args: { section: "playground", state: "rent", theme: "dark" } };
export const PlaygroundRentLight = { args: { section: "playground", state: "rent", theme: "light" } };
export const PlaygroundCachedStaleDark = { args: { section: "playground", state: "cached-stale", theme: "dark" } };
export const PlaygroundCachedStaleLight = { args: { section: "playground", state: "cached-stale", theme: "light" } };
export const StatusHealthyDark = { args: { section: "status", state: "healthy", theme: "dark" } };
export const StatusHealthyLight = { args: { section: "status", state: "healthy", theme: "light" } };
export const StatusDegradedDark = { args: { section: "status", state: "degraded", theme: "dark" } };
export const StatusDegradedLight = { args: { section: "status", state: "degraded", theme: "light" } };
export const StatusStaleDark = { args: { section: "status", state: "stale", theme: "dark" } };
export const StatusStaleLight = { args: { section: "status", state: "stale", theme: "light" } };
export const StatusLoadingDark = { args: { section: "status", state: "loading", theme: "dark" } };
export const StatusLoadingLight = { args: { section: "status", state: "loading", theme: "light" } };
export const StatusUnreachableDark = { args: { section: "status", state: "unreachable", theme: "dark" } };
export const StatusUnreachableLight = { args: { section: "status", state: "unreachable", theme: "light" } };
