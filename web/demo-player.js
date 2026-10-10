export function initDemoPlayer(root = document) {
  const dialog = root.getElementById("demo-dialog");
  const opener = root.getElementById("demo-open");
  const fallback = root.getElementById("demo-fallback");
  const video = root.getElementById("demo-video");
  const close = root.getElementById("demo-close");
  const live = root.getElementById("demo-try-live");
  const status = root.getElementById("demo-media-status");
  if (!dialog || typeof dialog.showModal !== "function" || !opener || !video || !close || !live || !status) return;

  let returnFocus = opener;
  let loaded = false;
  dialog.removeAttribute("open");
  opener.hidden = false;
  if (fallback) fallback.hidden = true;
  close.hidden = false;
  video.hidden = false;
  opener.addEventListener("click", () => {
    returnFocus = opener;
    if (!loaded) {
      video.poster = "media/rent-demo-poster.jpg";
      video.src = "media/rent-demo.mp4";
      video.querySelector("track").src = "media/rent-demo.vtt";
      loaded = true;
    }
    dialog.showModal();
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    video.pause();
    returnFocus.focus({ preventScroll: true });
  });
  live.addEventListener("click", (event) => {
    event.preventDefault();
    const select = root.getElementById("example-select");
    const heading = root.getElementById("playground-title");
    if (heading) heading.tabIndex = -1;
    returnFocus = select && !select.disabled ? select : heading || opener;
    dialog.close();
    if (select && !select.disabled) {
      select.value = "6";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    root.getElementById("playground")?.scrollIntoView({ block: "start", behavior: "instant" });
  });
  video.addEventListener("error", () => {
    status.hidden = false;
    status.textContent = "The video could not load. Read the transcript or try the live query.";
  });
}
