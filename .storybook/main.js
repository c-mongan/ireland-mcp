export default {
  stories: ["../storybook/*.stories.js"],
  framework: "@storybook/react-vite",
  addons: ["@storybook/addon-mcp"],
  features: { componentsManifest: true },
  core: { disableTelemetry: true }
};
