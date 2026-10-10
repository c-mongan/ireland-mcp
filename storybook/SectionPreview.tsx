import { useEffect, useMemo, useRef } from "react";
import { sectionDocument } from "./sectionFixture.js";

export interface SectionPreviewProps {
  /** Production section ID. The preview reads its markup from web/index.html. */
  section: "top" | "install" | "directory" | "playground" | "status";
  /** Fixed website colour theme. Both themes have reviewed visual baselines. */
  theme: "dark" | "light";
  /** Fixed sample response or health state. No provider request runs here. */
  state?: "idle" | "loading" | "success" | "empty" | "truncated" | "error" | "healthy" | "degraded" | "stale" | "unreachable";
}

/**
 * Review-only frame for real Ireland MCP website sections and fixed sample data.
 * Edit web/index.html and web/styles.css to change the product. This wrapper is
 * only a Storybook adapter. Scripts, network access and external actions are blocked.
 * Query states apply to playground; health states apply to status.
 * @import import { SectionPreview } from './SectionPreview';
 */
export function SectionPreview({ section, theme, state = "idle" }: SectionPreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const srcDoc = useMemo(() => sectionDocument({ section, theme, state }), [section, theme, state]);

  useEffect(() => () => observer.current?.disconnect(), [srcDoc]);

  const loaded = () => {
    const element = frame.current;
    const body = element?.contentDocument?.body;
    if (!element || !body) return;
    const resize = () => {
      element.style.height = `${Math.ceil(body.getBoundingClientRect().height) + 32}px`;
    };
    resize();
    observer.current?.disconnect();
    observer.current = new ResizeObserver(resize);
    observer.current.observe(body);
  };

  return <iframe
    ref={frame}
    title="Ireland MCP section preview"
    sandbox="allow-same-origin"
    style={{ display: "block", width: "100%", border: 0, minHeight: 100 }}
    srcDoc={srcDoc}
    onLoad={loaded}
  />;
}
