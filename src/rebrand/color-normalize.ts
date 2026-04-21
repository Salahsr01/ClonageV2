const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080',
  silver: '#c0c0c0', maroon: '#800000', olive: '#808000', lime: '#00ff00',
  aqua: '#00ffff', teal: '#008080', navy: '#000080', fuchsia: '#ff00ff',
  purple: '#800080', orange: '#ffa500', transparent: 'rgba(0, 0, 0, 0)',
};

export function normalizeColor(input: string): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();

  if (s in NAMED_COLORS) return normalizeColor(NAMED_COLORS[s]);

  // Hex
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return `rgb(${parseInt(h[0]+h[0], 16)}, ${parseInt(h[1]+h[1], 16)}, ${parseInt(h[2]+h[2], 16)})`;
    }
    if (h.length === 6) {
      return `rgb(${parseInt(h.slice(0,2), 16)}, ${parseInt(h.slice(2,4), 16)}, ${parseInt(h.slice(4,6), 16)})`;
    }
    if (h.length === 8) {
      const r = parseInt(h.slice(0,2), 16);
      const g = parseInt(h.slice(2,4), 16);
      const b = parseInt(h.slice(4,6), 16);
      const a = Math.round(parseInt(h.slice(6,8), 16) / 255 * 100) / 100;
      if (a === 1) return `rgb(${r}, ${g}, ${b})`;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    return null;
  }

  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (rgb) {
    const r = parseInt(rgb[1], 10);
    const g = parseInt(rgb[2], 10);
    const b = parseInt(rgb[3], 10);
    const a = rgb[4] !== undefined ? parseFloat(rgb[4]) : 1;
    if (a >= 1) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  return null;
}
