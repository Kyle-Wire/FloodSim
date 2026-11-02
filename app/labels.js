// Map text labels drawn as images. A symbol layer with text needs a style "glyphs" font source, which the app's style
// has none of (a font server would also break offline use); a symbol layer with only an icon needs none.

/** Image id for `text` with a halo, added to the map on first use; null for empty text. */
export function labelImage(map, text, { color = '#ffffff', halo = '#000000', size = 11 } = {}) {
  if (!text) return null;
  const id = `label:${size}:${color}:${halo}:${text}`;
  if (map.hasImage(id)) return id;
  const r = Math.max(1, Math.ceil(window.devicePixelRatio || 1)), font = `600 ${size * r}px system-ui, sans-serif`;
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = font;
  const pad = 2 * r, w = Math.ceil(g.measureText(text).width) + 2 * pad, h = Math.ceil(1.5 * size * r);
  c.width = w; c.height = h; // resizing resets the context
  Object.assign(g, { font, textBaseline: 'middle', lineJoin: 'round', strokeStyle: halo, lineWidth: 3 * r, fillStyle: color });
  g.strokeText(text, pad, h / 2); g.fillText(text, pad, h / 2);
  map.addImage(id, g.getImageData(0, 0, w, h), { pixelRatio: r });
  return id;
}
