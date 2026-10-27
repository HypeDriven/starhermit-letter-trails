// Where a tile shows on screen, for scripted pointer and touch play.
// native/render.ts frameCamera + Vector3.project, in logical pixels.
export function project(size, r, c, W, H, free) {
  const fov = 38, tilt = 0.62, margin = 1.25, heightF = 1.05;
  const span = size, half = span / 2 * margin, tanHalf = Math.tan(fov * Math.PI / 360), aspect = W / H;
  const dist = Math.max(half / (tanHalf * Math.max(0.5, free)), half / (tanHalf * aspect * 0.96));
  const cam = [0, dist * Math.cos(tilt) * heightF, dist * Math.sin(tilt)];
  const p = [c - (size - 1) / 2, 0.09, r - (size - 1) / 2];
  // View basis looking at the origin (up +y).
  const len = (v) => Math.hypot(...v), norm = (v) => v.map((x) => x / len(v));
  const zAxis = norm(cam);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const x2 = norm(cross([0, 1, 0], zAxis));
  const yAxis = cross(zAxis, x2);
  const d = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
  const vx = d[0] * x2[0] + d[1] * x2[1] + d[2] * x2[2];
  const vy = d[0] * yAxis[0] + d[1] * yAxis[1] + d[2] * yAxis[2];
  const vz = d[0] * zAxis[0] + d[1] * zAxis[1] + d[2] * zAxis[2];
  const ndcX = vx / (-vz * tanHalf * aspect), ndcY = vy / (-vz * tanHalf);
  return [Math.round((ndcX + 1) / 2 * W), Math.round((1 - ndcY) / 2 * H)];
}
