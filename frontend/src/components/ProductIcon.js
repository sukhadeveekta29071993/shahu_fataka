const ICONS = {
  anar: {
    bg: "#FFE3B8",
    paths: ["M16 40L20 26H28L32 40Z", "M24 22V10M18 24L10 14M30 24L38 14"],
  },
  fulzadi: {
    bg: "#FFD6CC",
    paths: ["M12 40L32 14", "M34 8V16M30 12H38M31 9L37 15M37 9L31 15"],
  },
  bomb: {
    bg: "#FFE9A8",
    paths: ["M22 40a12 12 0 1 1 0-24 12 12 0 0 1 0 24Z", "M30 20Q36 14 40 16", "M40 8V12M38 10H42"],
  },
  rocket: {
    bg: "#FFDCC2",
    paths: ["M24 6C32 14 32 28 28 36H20C16 28 16 14 24 6Z", "M20 36L14 42M28 36L34 42"],
    circles: [{ cx: 24, cy: 20, r: 3 }],
  },
  ladi: {
    bg: "#FFD9A6",
    paths: ["M10 14V10M24 14V8M37 14V10"],
    circles: [
      { cx: 10, cy: 24, r: 3 },
      { cx: 19, cy: 24, r: 3 },
      { cx: 28, cy: 24, r: 3 },
      { cx: 37, cy: 24, r: 3 },
    ],
  },
  crackle: {
    bg: "#F9D2DA",
    paths: ["M24 8V16M24 32V40M8 24H16M32 24H40M13 13L19 19M29 29L35 35M35 13L29 19M19 29L13 35"],
  },
  chakri: {
    bg: "#FFE3B8",
    paths: ["M24 12a12 12 0 1 1-12 12", "M24 20a4 4 0 1 1-4 4", "M24 6v2M24 40v2"],
  },
  star: {
    bg: "#FFE9A8",
    paths: ["M24 6l4.8 12.2L42 20l-9.6 8.4L35 42l-11-7-11 7 2.6-13.6L6 20l13.2-1.8Z"],
  },
};

export function iconBg(icon) {
  return (ICONS[icon] || ICONS.anar).bg;
}

export default function ProductIcon({ icon, size = 44 }) {
  const cfg = ICONS[icon] || ICONS.anar;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="#7A1410" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {cfg.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
      {(cfg.circles || []).map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={c.r} />
      ))}
    </svg>
  );
}
