import React, { useEffect, useRef } from "react";
import "./slices.css";

const CELL = 76;
const RADIUS = 170;
const rand = (min, max) => min + Math.random() * (max - min);

// While the pointer moves over the headline, it lifts into tilted pieces with dark
// gaps beneath, and settles back when the pointer leaves. The pieces are built once
// (a small pool of copies of the headline text) and only their transforms change, so
// hovering costs almost nothing. The engine on the right lifts inside its own canvas.
export default function Slices({ heroRef }) {
  const host = useRef(null);
  useEffect(() => {
    const hero = heroRef.current,
      box = host.current;
    if (!hero || !box) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const copy = hero.querySelector(".hero-copy");
    if (!copy) return;
    let cells = [],
      region = null,
      pointer = null,
      raf = 0,
      builtAt = 0;
    function build() {
      box.replaceChildren();
      cells = [];
      const rect = copy.getBoundingClientRect(),
        intake = copy.querySelector(".intake"),
        bottom = intake ? intake.getBoundingClientRect().top - 6 : rect.bottom;
      region = { left: rect.left, top: rect.top, right: rect.right, bottom };
      builtAt = scrollY;
      box.style.transform = "";
      const clone = copy.cloneNode(true);
      clone.querySelector(".intake")?.remove();
      clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      clone.style.width = rect.width + "px";
      const html = clone.outerHTML;
      const cols = Math.max(1, Math.round((region.right - region.left) / CELL)),
        rows = Math.max(1, Math.round((bottom - region.top) / CELL)),
        cw = (region.right - region.left) / cols,
        ch = (bottom - region.top) / rows;
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const x = region.left + i * cw,
            y = region.top + j * ch;
          const wrap = document.createElement("div");
          wrap.className = "slice";
          Object.assign(wrap.style, {
            left: x + "px",
            top: y + "px",
            width: cw + "px",
            height: ch + "px",
          });
          wrap.innerHTML = `<div class="slice-dark"></div><div class="slice-tile"><div class="slice-clone" style="left:${rect.left - x}px;top:${rect.top - y}px">${html}</div></div>`;
          box.appendChild(wrap);
          const tile = wrap.lastChild;
          const cell = {
            wrap,
            tile,
            cx: x + cw / 2,
            cy: y + ch / 2,
            seed: [rand(-1, 1), rand(-1, 1), rand(-1, 1)],
            s: 0,
          };
          // Hidden at rest; it shows only while it is lifted or settling.
          tile.addEventListener("transitionend", (e) => {
            if (e.propertyName === "transform" && cell.s === 0)
              wrap.classList.remove("shown");
          });
          cells.push(cell);
        }
    }
    function set(c, s) {
      if (s > 0 && Math.abs(c.s - s) < 0.03) return;
      if (s === 0 && c.s === 0) return;
      c.s = s;
      if (s > 0) {
        c.wrap.classList.add("shown", "up");
        const [a, b, r] = c.seed;
        c.tile.style.transform = `perspective(900px) translate3d(${a * 10 * s}px,${-18 * s}px,${30 + 90 * s}px) rotateX(${b * 40 * s}deg) rotateY(${a * 40 * s}deg) rotateZ(${r * 8 * s}deg) scale(${1 - 0.045 * s})`;
        c.tile.style.boxShadow = `0 ${20 * s}px ${36 * s}px rgb(10 12 20 / ${0.28 * s})`;
      } else {
        c.wrap.classList.remove("up");
        c.tile.style.transform = "";
        c.tile.style.boxShadow = "";
      }
    }
    function update() {
      raf = 0;
      if (!region) build();
      const dy = scrollY - builtAt;
      for (const c of cells) {
        let s = 0;
        if (pointer) {
          const d = Math.hypot(c.cx - pointer.x, c.cy - dy - pointer.y);
          if (d < RADIUS) {
            const t = 1 - d / RADIUS;
            s = t * t * (3 - 2 * t);
          }
        }
        set(c, s);
      }
    }
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const move = (e) => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      const dy = scrollY - builtAt;
      const inside =
        region &&
        e.clientX > region.left - RADIUS &&
        e.clientX < region.right + RADIUS &&
        e.clientY > region.top - dy - RADIUS &&
        e.clientY < region.bottom - dy + RADIUS &&
        !e.target.closest?.(".intake, .hero-top, .hero-art");
      const next = inside ? { x: e.clientX, y: e.clientY } : null;
      if (!next && !pointer) return;
      pointer = next;
      queue();
    };
    const leave = () => {
      pointer = null;
      queue();
    };
    const scroll = () => {
      box.style.transform = `translateY(${builtAt - scrollY}px)`;
    };
    const rebuild = () => {
      region = null;
      pointer = null;
      queue();
    };
    // Build after fonts settle so the copies line up with the real headline.
    document.fonts?.ready.then(rebuild);
    addEventListener("pointermove", move);
    document.documentElement.addEventListener("mouseleave", leave);
    addEventListener("scroll", scroll, { passive: true });
    addEventListener("resize", rebuild);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
      removeEventListener("scroll", scroll);
      removeEventListener("resize", rebuild);
      box.replaceChildren();
    };
  }, []);
  return <div className="slices" ref={host} aria-hidden="true" />;
}
