// Adapted from Conor Mongan's independent Signal cube study; no third-party assets.
export function rotate(x, y, z, yaw, pitch) {
  const rx = x * Math.cos(yaw) + z * Math.sin(yaw);
  const rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
  return { x: rx, y: y * Math.cos(pitch) - rz * Math.sin(pitch), z: y * Math.sin(pitch) + rz * Math.cos(pitch) };
}
const corners = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const faces = [[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[1,5,6,2],[0,3,7,4]];
const palette = ["#73c99a", "#e7eee8", "#efa768"];
export function cubeFaces(yaw = -.55, pitch = -.4) {
  const result = [];
  for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) for (let z = 0; z < 6; z++) {
    if (![x,y,z].some(n => n === 0 || n === 5)) continue;
    const points = corners.map(([a,b,c]) => rotate(x - 2.5 + a * .43, y - 2.5 + b * .43, z - 2.5 + c * .43, yaw, pitch));
    for (const face of faces) {
      const ps = face.map(i => points[i]);
      // Keep outward faces, then paint distant faces first.
      const cross = (ps[1].x-ps[0].x)*(ps[2].y-ps[0].y)-(ps[1].y-ps[0].y)*(ps[2].x-ps[0].x);
      if (cross > 0) continue;
      result.push({ points: ps.map(p => ({ x: 180 + p.x * 23, y: 108 - p.y * 23 })), depth: ps.reduce((n,p)=>n+p.z,0)/4, color: palette[Math.floor(x/2)], detail: (x * 73856093 ^ y * 19349663 ^ z * 83492791) >>> 0 });
    }
  }
  return result.sort((a,b)=>b.depth-a.depth);
}

export function faceDetail(face) {
  const [a,b,,d] = face.points;
  const uv = (u,v) => ({ x: a.x + (b.x-a.x)*u + (d.x-a.x)*v, y: a.y + (b.y-a.y)*u + (d.y-a.y)*v });
  const panels = [];
  for (let i = 0; i < 4; i++) {
    if (!(face.detail & (1 << i))) continue;
    const u = .12 + (i % 2) * .42, v = .12 + Math.floor(i/2) * .42;
    panels.push([uv(u,v), uv(u+.32,v), uv(u+.32,v+.32), uv(u,v+.32)]);
  }
  return { panels, trace: [uv(.05,.48), uv(.48,.48), uv(.48,.95)] };
}
