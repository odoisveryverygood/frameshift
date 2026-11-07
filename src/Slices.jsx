import React, { useEffect, useRef } from "react";
import { revokeSnapshots, snapshotHtml } from "./Rip.jsx";
import "./slices.css";

const RADIUS = 200;
const rand = (min, max) => min + Math.random() * (max - min);

// While the pointer moves over the hero, the page lifts into tilted pieces
// around it and settles back when it leaves. Each piece is a clipped copy of the
// hero sitting exactly over its own cell (so nothing shifts at rest) on top of a
// dark square that shows through the gaps. Lives outside the hero so the rip
// transition never copies it.
export default function Slices({ heroRef }) {
  const host = useRef(null);
  useEffect(() => {
    const hero = heroRef.current,
      box = host.current;
    if (!hero || !box) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (innerWidth < 860) return;
    const cols = Math.round(innerWidth / 96),
      rows = Math.round(innerHeight / 96),
      cw = innerWidth / cols,
      ch = innerHeight / rows;
    let html = snapshotHtml(hero, { owner: "slices" }),
      dirty = false,
      pointer = null,
      raf = 0;
    const cells = new Map();
    const markDirty = () => {
      dirty = true;
    };
    const watcher = new MutationObserver(markDirty);
    watcher.observe(hero, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    hero.addEventListener("input", markDirty);
    hero.addEventListener("change", markDirty);
    const cloneHtml = (i, j, rect) =>
      `<div class="slice-clone" style="left:${rect.left - i * cw}px;top:${rect.top - j * ch}px;width:${rect.width}px;height:${rect.height}px">${html}</div>`;
    function make(i, j, rect) {
      const wrap = document.createElement("div");
      wrap.className = "slice";
      Object.assign(wrap.style, {
        left: i * cw + "px",
        top: j * ch + "px",
        width: cw + "px",
        height: ch + "px",
      });
      wrap.innerHTML = `<div class="slice-dark"></div><div class="slice-tile">${cloneHtml(i, j, rect)}</div>`;
      box.appendChild(wrap);
      const cell = {
        i,
        j,
        wrap,
        tile: wrap.querySelector(".slice-tile"),
        seed: [rand(-1, 1), rand(-1, 1), rand(-1, 1)],
        settled: false,
        timer: 0,
      };
      cell.tile.getBoundingClientRect(); // commit the resting state so the rise animates
      return cell;
    }
    function lift(c, s) {
      const [a, b, r] = c.seed;
      clearTimeout(c.timer);
      c.settled = false;
      c.wrap.classList.add("up");
      c.tile.style.transform = `perspective(900px) translate3d(${a * 12 * s}px,${-20 * s}px,${30 + 100 * s}px) rotateX(${b * 44 * s}deg) rotateY(${a * 44 * s}deg) rotateZ(${r * 9 * s}deg) scale(${1 - 0.045 * s})`;
      c.tile.style.boxShadow = `0 ${22 * s}px ${40 * s}px rgb(10 12 20 / ${0.3 * s})`;
    }
    function settle(key, c) {
      if (c.settled) return;
      c.settled = true;
      c.wrap.classList.remove("up");
      c.tile.style.transform = "";
      c.tile.style.boxShadow = "";
      c.timer = setTimeout(() => {
        c.wrap.remove();
        cells.delete(key);
      }, 460);
    }
    function clear() {
      cells.forEach((c) => {
        clearTimeout(c.timer);
        c.wrap.remove();
      });
      cells.clear();
    }
    function update() {
      raf = 0;
      const rect = hero.getBoundingClientRect();
      if (dirty) {
        html = snapshotHtml(hero, { owner: "slices", release: true });
        dirty = false;
        cells.forEach((c) => {
          c.tile.innerHTML = cloneHtml(c.i, c.j, rect);
        });
      }
      const seen = new Set();
      const keepClear = [
        ...hero.querySelectorAll(".intake, .hero-top, .hero-art"),
      ].map((n) => n.getBoundingClientRect());
      const covers = (x, y) =>
        keepClear.some(
          (r) =>
            x + cw > r.left - 6 &&
            x < r.right + 6 &&
            y + ch > r.top - 6 &&
            y < r.bottom + 6,
        );
      if (pointer && !pointer.blocked) {
        const i0 = Math.max(0, Math.floor((pointer.x - RADIUS) / cw)),
          i1 = Math.min(cols - 1, Math.floor((pointer.x + RADIUS) / cw)),
          j0 = Math.max(0, Math.floor((pointer.y - RADIUS) / ch)),
          j1 = Math.min(rows - 1, Math.floor((pointer.y + RADIUS) / ch));
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const d = Math.hypot(
              (i + 0.5) * cw - pointer.x,
              (j + 0.5) * ch - pointer.y,
            );
            if (d >= RADIUS || covers(i * cw, j * ch)) continue;
            const t = 1 - d / RADIUS,
              s = t * t * (3 - 2 * t),
              key = j * cols + i;
            let c = cells.get(key);
            if (!c) {
              c = make(i, j, rect);
              cells.set(key, c);
            }
            seen.add(key);
            lift(c, s);
          }
      }
      cells.forEach((c, key) => {
        if (!seen.has(key)) settle(key, c);
      });
    }
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const move = (e) => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      pointer = {
        x: e.clientX,
        y: e.clientY,
        // The form and the top bar stay clean so they are easy to use.
        blocked: Boolean(e.target.closest?.(".intake, .hero-top, .hero-art")),
      };
      queue();
    };
    const leave = () => {
      pointer = null;
      queue();
    };
    addEventListener("pointermove", move);
    document.documentElement.addEventListener("mouseleave", leave);
    addEventListener("scroll", clear, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      watcher.disconnect();
      hero.removeEventListener("input", markDirty);
      hero.removeEventListener("change", markDirty);
      removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
      removeEventListener("scroll", clear);
      clear();
      revokeSnapshots("slices");
    };
  }, []);
  return <div className="slices" ref={host} aria-hidden="true" />;
}
