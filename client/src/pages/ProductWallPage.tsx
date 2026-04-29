import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import SafeImage from "../components/shared/SafeImage";
import { PublicPageShell } from "../components/shared/PublicPageShell";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";

interface WallItem { title: string; image: string }

const ITEMS: WallItem[] = [
  { title: "液压油管总成", image: "/product-wall-assets/yeya-youguan.webp" },
  { title: "高压油管连接", image: "/product-wall-assets/gaoya-youguan.webp" },
  { title: "不锈钢快插接头", image: "/product-wall-assets/buxiugang-kuaicha.webp" },
  { title: "全铜快插接头", image: "/product-wall-assets/quantong-kuaicha.webp" },
  { title: "气动前置过滤", image: "/product-wall-assets/qianzhi-guolvqi.webp" },
  { title: "电磁阀与气路控制", image: "/product-wall-assets/taiwan-jinqi.webp" },
  { title: "不锈钢管件", image: "/product-wall-assets/buxiugang-guanjian.webp" },
  { title: "流体兼容接头", image: "/product-wall-assets/liuti-jianrong.webp" },
  { title: "阀门组件", image: "/product-wall-assets/famen.webp" },
  { title: "气管与尼龙管", image: "/product-wall-assets/qiguan-nilong.webp" },
  { title: "清洗除气场景", image: "/product-wall-assets/qingxi-chuqi.webp" },
  { title: "气控集成模块", image: "/product-wall-assets/qikong-jicheng.webp" },
];

function seededRandom(seed: number) {
  let s = (Math.abs(seed) % 2147483646) + 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hash(a: number, b: number): number {
  let h = a * 374761393 + b * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return (Math.abs(h ^ (h >> 16)) % 2147483646) + 1;
}

const GLOWS = [
  "rgba(100,140,255,0.30)",
  "rgba(160,100,255,0.28)",
  "rgba(80,200,255,0.25)",
  "rgba(200,120,255,0.25)",
  "rgba(100,220,200,0.22)",
  "rgba(140,180,255,0.25)",
];

interface Range { c0: number; c1: number; r0: number; r1: number }

interface LayerCfg {
  cell: number;
  px: number;          // parallax factor
  card: number;        // base card size
  opLo: number; opHi: number;
  rot: number;         // max rotation degrees
  off: number;         // max random offset
  glow: number;        // glow intensity 0-1
}

interface Tile {
  k: string;
  x: number; y: number;
  w: number; h: number;
  img: string;
  title: string;
  rot: number;
  op: number;
  gi: number;  // glow index
}

// ─── helpers ────────────────────────────────────────

function makeTiles(range: Range, cfg: LayerCfg, li: number): Tile[] {
  const out: Tile[] = [];
  for (let c = range.c0; c <= range.c1; c++) {
    for (let r = range.r0; r <= range.r1; r++) {
      const rng = seededRandom(hash(c * 997 + li * 31, r * 1013 + li * 57));
      const item = ITEMS[Math.floor(rng() * ITEMS.length)];
      const sc = 0.78 + rng() * 0.24;
      const w = cfg.card * sc;
      const h = w * 0.78;
      out.push({
        k: `L${li}-${c},${r}`,
        x: c * cfg.cell + (cfg.cell - w) / 2 + (rng() - 0.5) * cfg.off * 2,
        y: r * cfg.cell + (cfg.cell - h) / 2 + (rng() - 0.5) * cfg.off * 2,
        w, h,
        img: item.image,
        title: item.title,
        rot: (rng() - 0.5) * cfg.rot,
        op: cfg.opLo + rng() * (cfg.opHi - cfg.opLo),
        gi: Math.floor(rng() * GLOWS.length),
      });
    }
  }
  return out;
}

function calcRange(epx: number, epy: number, vw: number, vh: number, cell: number, z: number): Range {
  return {
    c0: Math.floor(epx / cell) - 2,
    c1: Math.ceil((epx + vw / z) / cell) + 2,
    r0: Math.floor(epy / cell) - 2,
    r1: Math.ceil((epy + vh / z) / cell) + 2,
  };
}

function eqRange(a: Range, b: Range) {
  return a.c0 === b.c0 && a.c1 === b.c1 && a.r0 === b.r0 && a.r1 === b.r1;
}

// ─── component ──────────────────────────────────────

export default function ProductWallPage() {
  useDocumentTitle("产品墙");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [active, setActive] = useState<WallItem | null>(null);

  // 3 layers — large cells → few tiles
  const cfgs = useMemo<LayerCfg[]>(() => isDesktop ? [
    // bg: small dim slow
    { cell: 230, px: 0.42, card: 60, opLo: 0.18, opHi: 0.38, rot: 14, off: 30, glow: 0.04 },
    // mid
    { cell: 290, px: 1.0, card: 100, opLo: 0.48, opHi: 0.70, rot: 9, off: 22, glow: 0.14 },
    // fg: large bright fast
    { cell: 360, px: 1.65, card: 165, opLo: 0.88, opHi: 1.0, rot: 6, off: 14, glow: 0.35 },
  ] : [
    { cell: 180, px: 0.42, card: 46, opLo: 0.18, opHi: 0.38, rot: 14, off: 24, glow: 0.04 },
    { cell: 225, px: 1.0, card: 76, opLo: 0.48, opHi: 0.70, rot: 9, off: 18, glow: 0.14 },
    { cell: 280, px: 1.65, card: 125, opLo: 0.88, opHi: 1.0, rot: 6, off: 10, glow: 0.35 },
  ], [isDesktop]);

  const vpRef = useRef<HTMLDivElement>(null);
  const wRefs = useRef<(HTMLDivElement | null)[]>([null, null, null]);
  const pan = useRef({ x: 0, y: 0 });
  const zm = useRef(1);
  const vel = useRef({ x: 0, y: 0 });
  const drag = useRef({ on: false, moved: false, sx: 0, sy: 0, lx: 0, ly: 0 });
  const raf = useRef(0);

  // ranges state
  const [ranges, setRanges] = useState<[Range, Range, Range]>(() => {
    const w = window.innerWidth, h = window.innerHeight;
    return cfgs.map(c => calcRange(0, 0, w, h, c.cell, 1)) as [Range, Range, Range];
  });

  // tiles per layer (memoised)
  const tiles = useMemo(
    () => cfgs.map((cfg, i) => makeTiles(ranges[i], cfg, i)),
    [ranges, cfgs],
  );

  // transform all layers
  const apply = useCallback(() => {
    const p = pan.current, z = zm.current;
    for (let i = 0; i < 3; i++) {
      const el = wRefs.current[i];
      if (el) el.style.transform = `scale(${z}) translate(${-p.x * cfgs[i].px}px,${-p.y * cfgs[i].px}px)`;
    }
  }, [cfgs]);

  // recompute ranges
  const check = useCallback(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const { width, height } = vp.getBoundingClientRect();
    const p = pan.current, z = zm.current;
    const nr = cfgs.map(c => calcRange(p.x * c.px, p.y * c.px, width, height, c.cell, z));
    setRanges(prev => {
      for (let i = 0; i < 3; i++) if (!eqRange(prev[i], nr[i])) return nr as [Range, Range, Range];
      return prev;
    });
  }, [cfgs]);

  // inertia loop — only runs when needed
  useEffect(() => {
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(50, now - last) / 1000;
      last = now;
      const v = vel.current;
      if (!drag.current.on && (v.x || v.y)) {
        pan.current.x -= v.x * dt * 60;
        pan.current.y -= v.y * dt * 60;
        v.x *= 0.93; v.y *= 0.93;
        if (Math.abs(v.x) < 0.2) v.x = 0;
        if (Math.abs(v.y) < 0.2) v.y = 0;
        apply();
        check();
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [apply, check]);

  // events
  useEffect(() => {
    const d = drag.current;
    const down = (cx: number, cy: number) => {
      d.on = true; d.moved = false;
      d.sx = cx; d.sy = cy; d.lx = cx; d.ly = cy;
      vel.current = { x: 0, y: 0 };
      if (vpRef.current) vpRef.current.style.cursor = "grabbing";
    };
    const move = (cx: number, cy: number) => {
      if (!d.on) return;
      const dx = cx - d.lx, dy = cy - d.ly;
      if (Math.abs(cx - d.sx) > 3 || Math.abs(cy - d.sy) > 3) d.moved = true;
      const z = zm.current;
      pan.current.x -= dx / z;
      pan.current.y -= dy / z;
      vel.current = { x: dx / z, y: dy / z };
      d.lx = cx; d.ly = cy;
      apply();
    };
    const up = () => {
      d.on = false;
      if (vpRef.current) vpRef.current.style.cursor = "grab";
      check();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const vp = vpRef.current;
      if (!vp) return;
      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const oz = zm.current;
      const nz = Math.max(0.3, Math.min(3, oz * (e.deltaY > 0 ? 0.92 : 1.08)));
      const wx = mx / oz + pan.current.x;
      const wy = my / oz + pan.current.y;
      pan.current.x = wx - mx / nz;
      pan.current.y = wy - my / nz;
      zm.current = nz;
      apply();
      check();
    };

    const el = vpRef.current;
    if (!el) return;
    const md = (e: MouseEvent) => { e.preventDefault(); down(e.clientX, e.clientY); };
    const mm = (e: MouseEvent) => move(e.clientX, e.clientY);
    const mu = () => up();
    const td = (e: TouchEvent) => { e.preventDefault(); down(e.touches[0].clientX, e.touches[0].clientY); };
    const tm = (e: TouchEvent) => { if (d.on) move(e.touches[0].clientX, e.touches[0].clientY); };
    const tu = () => up();

    el.addEventListener("mousedown", md);
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
    el.addEventListener("touchstart", td, { passive: false });
    window.addEventListener("touchmove", tm, { passive: true });
    window.addEventListener("touchend", tu);
    el.addEventListener("wheel", wheel, { passive: false });

    return () => {
      el.removeEventListener("mousedown", md);
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
      el.removeEventListener("touchstart", td);
      window.removeEventListener("touchmove", tm);
      window.removeEventListener("touchend", tu);
      el.removeEventListener("wheel", wheel);
    };
  }, [apply, check]);

  useEffect(() => { check(); }, [check, isDesktop]);

  return (
    <PublicPageShell
      className="flex h-dvh flex-col overflow-hidden"
      mobileClassName="flex h-dvh flex-col overflow-hidden"
      showMobileBottomNav={false}
    >
      <main
        ref={vpRef}
        className="min-h-0 flex-1 overflow-hidden relative select-none"
        style={{
          background: `
            radial-gradient(ellipse at 22% 28%, rgba(50,40,130,0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 78% 72%, rgba(40,55,150,0.06) 0%, transparent 50%),
            linear-gradient(135deg, #050509 0%, #0a0a18 50%, #06060e 100%)
          `,
          cursor: "grab",
        }}
      >
        {cfgs.map((cfg, li) => {
          const isFg = li === 2;
          const isBg = li === 0;
          const radius = isFg ? 14 : isBg ? 8 : 10;

          return (
            <div
              key={li}
              ref={(el) => { wRefs.current[li] = el; }}
              style={{
                position: "absolute",
                top: 0, left: 0,
                width: 0, height: 0,
                willChange: "transform",
                transformOrigin: "0 0",
                zIndex: li * 10,
              }}
            >
              {tiles[li].map((t) =>
                isFg ? (
                  // ── Foreground: full card with image + glass + title ──
                  <div
                    key={t.k}
                    className="pw-fg"
                    style={{
                      position: "absolute",
                      left: t.x, top: t.y,
                      width: t.w, height: t.h,
                      transform: `rotate(${t.rot}deg)`,
                      opacity: t.op,
                      contain: "layout style",
                    }}
                    onClick={() => { if (!drag.current.moved) setActive({ title: t.title, image: t.img }); }}
                  >
                    <div
                      className="pw-face"
                      style={{
                        width: "100%", height: "100%",
                        borderRadius: radius,
                        overflow: "hidden",
                        position: "relative",
                        boxShadow: `0 0 0 1px rgba(255,255,255,0.10), 0 4px 18px rgba(0,0,0,0.45), 0 0 28px ${GLOWS[t.gi]}`,
                        cursor: "pointer",
                        transition: "transform 0.32s cubic-bezier(0.22,1,0.36,1), box-shadow 0.32s ease",
                      }}
                    >
                      <SafeImage src={t.img} alt={t.title}
                        className="h-full w-full object-cover"
                        fallbackClassName="h-full w-full bg-surface-container-high" />
                      {/* Glass */}
                      <div className="pointer-events-none absolute inset-0" style={{
                        borderRadius: radius,
                        background: "linear-gradient(135deg, rgba(255,255,255,0.10) 0%, transparent 38%, transparent 62%, rgba(0,0,0,0.12) 100%)",
                      }} />
                      {/* Title */}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0" style={{
                        height: "48%",
                        borderRadius: `0 0 ${radius}px ${radius}px`,
                        background: "linear-gradient(transparent, rgba(0,0,0,0.65))",
                      }} />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-2.5 pb-2" style={{
                        fontSize: 12, color: "rgba(255,255,255,0.92)", fontWeight: 600,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        textShadow: "0 1px 4px rgba(0,0,0,0.6)", letterSpacing: "0.02em",
                      }}>
                        {t.title}
                      </div>
                    </div>
                  </div>
                ) : (
                  // ── Background / Mid: ultra-light single div ──
                  <div
                    key={t.k}
                    style={{
                      position: "absolute",
                      left: t.x, top: t.y,
                      width: t.w, height: t.h,
                      backgroundImage: `url(${t.img})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      borderRadius: radius,
                      transform: `rotate(${t.rot}deg)`,
                      opacity: t.op,
                      boxShadow: `0 0 ${8 + cfg.glow * 40}px ${GLOWS[t.gi]}`,
                      contain: "layout style",
                    }}
                  />
                )
              )}
            </div>
          );
        })}

        {/* Vignette */}
        <div className="pointer-events-none absolute inset-0" style={{
          background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(5,5,9,0.50) 100%)",
        }} />

        {/* Particles — 8 only */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ opacity: 0.3 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="absolute rounded-full" style={{
              width: 2, height: 2,
              left: `${(i * 23 + 7) % 100}%`, top: `${(i * 31 + 11) % 100}%`,
              background: `rgba(${110 + (i * 37) % 80}, ${130 + (i * 23) % 70}, 255, ${0.35 + (i % 3) * 0.1})`,
              animation: `pwP ${7 + i * 1.5}s ease-in-out infinite`,
              animationDelay: `${-i * 1.8}s`,
            }} />
          ))}
        </div>

        {/* Hint */}
        <div className="pointer-events-none absolute left-1/2 top-14 -translate-x-1/2 z-40 rounded-full px-5 py-2 text-xs text-white/45 backdrop-blur-md"
          style={{
            background: "linear-gradient(135deg, rgba(90,110,255,0.08), rgba(150,90,255,0.08))",
            border: "1px solid rgba(255,255,255,0.05)",
            animation: "pwH 5s ease-out forwards",
          }}>
          拖拽探索 · 滚轮缩放 · 点击查看
        </div>
      </main>

      {/* Lightbox */}
      {active && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          onClick={() => setActive(null)}
          style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(40px)", cursor: "default", animation: "pwFI 0.3s ease-out" }}>
          <div className="w-full max-w-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{
              borderRadius: 20,
              background: "linear-gradient(135deg, rgba(18,18,38,0.96), rgba(28,22,48,0.96))",
              border: "1px solid rgba(255,255,255,0.10)",
              animation: "pwPI 0.4s cubic-bezier(0.16,1,0.3,1)",
            }}>
            <div className="relative aspect-[4/3] bg-black/30">
              <SafeImage src={active.image} alt={active.title}
                className="h-full w-full object-cover" fallbackClassName="h-full w-full" />
              <button onClick={() => setActive(null)}
                className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full text-white transition-all hover:scale-110"
                style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(12px)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-5 text-center">
              <h2 className="text-lg font-semibold text-white/90">{active.title}</h2>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .pw-fg:hover .pw-face {
          transform: scale(1.07) translateY(-3px);
          box-shadow:
            0 0 0 1.5px rgba(255,255,255,0.14),
            0 8px 28px rgba(0,0,0,0.50),
            0 0 38px rgba(120,140,255,0.28) !important;
        }
        @keyframes pwFI { from{opacity:0} to{opacity:1} }
        @keyframes pwPI { from{opacity:0;transform:scale(.85) translateY(20px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes pwH { 0%{opacity:0;transform:translate(-50%,-10px)} 15%{opacity:1;transform:translate(-50%,0)} 70%{opacity:1} 100%{opacity:0;transform:translate(-50%,0)} }
        @keyframes pwP { 0%,100%{transform:translate(0,0);opacity:.25} 50%{transform:translate(15px,-35px);opacity:.45} }
      `}</style>
    </PublicPageShell>
  );
}
