"use client";

import { useEffect, useRef } from "react";

const DENSITY = "Ñ@#W$9876543210?!abc;:+=-,._                    ";
const TARGET_FPS = 28;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
const CELL_SIZE = 16;
const CANVAS_SCALE = 1.08;

type ChatCanvasProps = {
  pause?: boolean;
};

export function ChatCanvas({ pause = false }: ChatCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pauseRef = useRef(pause);

  useEffect(() => {
    pauseRef.current = pause;
  }, [pause]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let time = 0;
    let rafId = 0;
    let lastFrameTs = 0;

    const resize = () => {
      width = canvas.width = window.innerWidth * CANVAS_SCALE;
      height = canvas.height = window.innerHeight * CANVAS_SCALE;
    };

    const draw = (ts: number) => {
      if (pauseRef.current) {
        rafId = window.requestAnimationFrame(draw);
        return;
      }

      if (ts - lastFrameTs < FRAME_INTERVAL_MS) {
        rafId = window.requestAnimationFrame(draw);
        return;
      }
      lastFrameTs = ts;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue("--text-primary")
        .trim();
      ctx.font = '13px var(--font-mono), "JetBrains Mono", monospace';

      const cols = Math.floor(width / CELL_SIZE);
      const rows = Math.floor(height / CELL_SIZE);

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * 0.1;
          const y = j * 0.1;

          // Wave formula from the provided reference HTML
          const value =
            Math.sin(x + time) * Math.cos(y + time * 0.5) +
            Math.sin(x * 0.5 - time * 0.3) +
            Math.cos(y * 0.8 + time * 0.2);

          const normalized = (value + 3) / 6;
          let idx = Math.floor(normalized * DENSITY.length);
          idx = Math.max(0, Math.min(DENSITY.length - 1, idx));

          const char = DENSITY[idx];
          if (char !== " ") {
            ctx.fillText(char, i * CELL_SIZE, j * CELL_SIZE);
          }
        }
      }

      time += 0.02;
      rafId = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    rafId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="ascii-canvas-container">
      <canvas id="asciiCanvas" ref={canvasRef} />
    </div>
  );
}
