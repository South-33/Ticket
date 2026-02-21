"use client";

import { useEffect, useRef } from "react";

const CHARS = ["@", "%", "#", "*", "+", "=", "-", ":", ".", " "];

export function ChatCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const mouse = { x: -1000, y: -1000 };
    const gridSize = 14;
    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let time = 0;
    let animationFrameId = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / gridSize);
      rows = Math.ceil(height / gridSize);
      context.font = `${gridSize * 0.8}px var(--font-space-mono), monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
    };

    const getNoise = (x: number, y: number, tick: number) => {
      return (
        Math.sin(x * 0.05 + tick) +
        Math.sin(y * 0.03 - tick * 0.5) +
        Math.cos((x + y) * 0.02 + tick * 0.8)
      );
    };

    const render = () => {
      context.clearRect(0, 0, width, height);
      time += 0.015;

      for (let i = 0; i < cols; i += 1) {
        for (let j = 0; j < rows; j += 1) {
          const x = i * gridSize;
          const y = j * gridSize;
          const baseNoise = getNoise(i, j, time);

          const distanceX = x - mouse.x;
          const distanceY = y - mouse.y;
          const distance = Math.hypot(distanceX, distanceY);
          const mouseEffect = distance < 200 ? (200 - distance) / 100 : 0;

          const value = baseNoise + mouseEffect;
          if (value <= 0.5 || value >= 2.5) {
            continue;
          }

          const normalized = (value - 0.5) / 2;
          const characterIndex = Math.max(
            0,
            Math.min(CHARS.length - 1, Math.floor(normalized * CHARS.length)),
          );

          const alpha = (1 - Math.abs(normalized - 0.5) * 2) * 0.15;
          context.fillStyle = `rgba(17, 17, 17, ${alpha})`;
          context.fillText(
            CHARS[characterIndex],
            x + gridSize / 2,
            y + gridSize / 2,
          );
        }
      }

      animationFrameId = window.requestAnimationFrame(render);
    };

    const onMouseMove = (event: MouseEvent) => {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMouseMove);
    animationFrameId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return <canvas id="ascii-canvas" ref={canvasRef} />;
}
