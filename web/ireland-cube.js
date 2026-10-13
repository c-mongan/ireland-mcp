import { cubeFaces, faceDetail } from "./ireland-cube-geometry.js?v=20261013-cube";

export function initIrelandCube() {
  const canvas = document.getElementById("ireland-cube");
  const button = document.getElementById("cube-motion");
  const poster = document.getElementById("cube-poster");
  if (!canvas || !button || !poster) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const density = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = 360 * density;
  canvas.height = 216 * density;
  context.setTransform(density, 0, 0, density, 0, 0);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let running = !reduced.matches;
  let visible = false;
  let raf = 0;
  let previous = 0;
  let yaw = -.55;
  let isDragging = false;
  let activePointer = null;
  let startX = 0;
  let startYaw = yaw;

  function draw() {
    context.clearRect(0, 0, 360, 216);
    for (const face of cubeFaces(yaw)) {
      context.beginPath();
      face.points.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
      context.closePath();
      context.fillStyle = "#102219";
      context.fill();
      context.globalAlpha = .45 + (face.detail % 4) * .12;
      context.fillStyle = face.color;
      context.fill();
      context.globalAlpha = 1;
      context.strokeStyle = face.color;
      context.lineWidth = .65;
      context.stroke();
      const detail = faceDetail(face);
      context.fillStyle = "#132920";
      for (const panel of detail.panels) {
        context.beginPath();
        panel.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
        context.closePath();
        context.fill();
      }
      context.beginPath();
      detail.trace.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
      context.lineWidth = .35;
      context.stroke();
    }
  }

  function frame(time) {
    raf = 0;
    if (!running || !visible || document.hidden || reduced.matches) return;
    if (previous && time - previous < 40) {
      raf = requestAnimationFrame(frame);
      return;
    }
    if (previous && !isDragging) {
      yaw += Math.min(time - previous, 80) * .00015;
    }
    previous = time;
    draw();
    raf = requestAnimationFrame(frame);
  }

  function sync() {
    cancelAnimationFrame(raf);
    raf = 0;
    previous = 0;
    const label = running ? "Pause cube" : "Rotate cube";
    button.querySelector("span").textContent = running ? "Ⅱ" : "↻";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.setAttribute("aria-pressed", String(running));
    if (running && visible && !document.hidden && !reduced.matches) {
      raf = requestAnimationFrame(frame);
    }
  }

  button.addEventListener("click", () => {
    if (reduced.matches) {
      yaw += .4;
      draw();
      return;
    }
    running = !running;
    sync();
  });

  // Pointer & touch drag interaction
  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (activePointer !== null || !e.isPrimary) return;
    activePointer = e.pointerId;
    isDragging = true;
    startX = e.clientX;
    startYaw = yaw;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch { /* Capture may be lost when the browser starts scrolling. */ }
  }

  function onPointerMove(e) {
    if (!isDragging || e.pointerId !== activePointer) return;
    const deltaX = e.clientX - startX;
    yaw = startYaw + deltaX * 0.015;
    draw();
  }

  function onPointerUp(e) {
    if (!isDragging || e.pointerId !== activePointer) return;
    isDragging = false;
    activePointer = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch { /* Capture may be lost when the browser starts scrolling. */ }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  canvas.addEventListener("lostpointercapture", onPointerUp);
  canvas.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    running = false;
    yaw += event.key === "ArrowLeft" ? -.2 : .2;
    draw();
    sync();
  });

  reduced.addEventListener("change", () => {
    running = false;
    sync();
  });

  document.addEventListener("visibilitychange", sync);

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  }).observe(canvas);

  draw();
  canvas.hidden = false;
  poster.hidden = true;
  button.hidden = false;
  sync();
}
