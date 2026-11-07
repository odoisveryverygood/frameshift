import { useEffect, useRef, useState } from "react";

const query = "(prefers-reduced-motion: reduce)";
const reducedNow = () => {
  try {
    return matchMedia(query).matches;
  } catch {
    return false;
  }
};

export function useReducedMotion() {
  const [reduced, setReduced] = useState(reducedNow);
  useEffect(() => {
    const media = matchMedia(query);
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return reduced;
}

// True once the element has been on screen; animations replay only when seen.
export function useInView(ref, threshold = 0.25) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setSeen(true),
      { threshold },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, threshold]);
  return seen;
}

// A critically damped-ish spring toward `target`, stepped on requestAnimationFrame.
// Each value carries its own delay so assemblies can move in a staggered order.
export function useSprings(
  targets,
  { stiffness = 170, damping = 20, stagger = 0.08, reduced } = {},
) {
  const state = useRef(targets.map((t) => ({ x: t, v: 0 })));
  const [values, setValues] = useState(targets);
  const key = targets.join(",");
  useEffect(() => {
    if (reduced) {
      state.current = targets.map((t) => ({ x: t, v: 0 }));
      setValues(targets);
      return;
    }
    let frame,
      last = performance.now();
    const start = last;
    const tick = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      let moving = false;
      state.current = state.current.map((s, i) => {
        if ((now - start) / 1000 < i * stagger) return ((moving = true), s);
        const a = stiffness * (targets[i] - s.x) - damping * s.v;
        const v = s.v + a * dt,
          x = s.x + v * dt;
        if (Math.abs(targets[i] - x) > 0.001 || Math.abs(v) > 0.001)
          moving = true;
        return { x, v };
      });
      setValues(state.current.map((s) => s.x));
      if (moving) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [key, reduced]);
  return values;
}

export const formatNumber = (value, digits = 0) =>
  Number.isFinite(value)
    ? digits
      ? value.toFixed(digits)
      : Math.round(value).toLocaleString()
    : null;
