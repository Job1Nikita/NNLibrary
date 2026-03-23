import type { Request } from "express";
import { randomUUID } from "crypto";

const CAPTCHA_WIDTH = 320;
const CAPTCHA_HEIGHT = 160;
const PIECE_WIDTH = 72;
const PIECE_HEIGHT = 48;
const TOLERANCE = 7;
const TTL_MS = 1000 * 60 * 3;

type Shape =
  | { type: "circle"; cx: number; cy: number; r: number; color: string; opacity: number }
  | { type: "rect"; x: number; y: number; w: number; h: number; color: string; opacity: number; rx: number };

function seedFromString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRng(seed: number): () => number {
  let value = seed || 1;
  return () => {
    value = (value * 1664525 + 1013904223) % 0x100000000;
    return value / 0x100000000;
  };
}

function palette(rng: () => number): [string, string, string] {
  const hues = [18, 32, 188, 205, 154, 224];
  const h1 = hues[Math.floor(rng() * hues.length)];
  const h2 = hues[Math.floor(rng() * hues.length)];
  const h3 = hues[Math.floor(rng() * hues.length)];
  return [
    `hsl(${h1} 75% 54%)`,
    `hsl(${h2} 82% 59%)`,
    `hsl(${h3} 68% 50%)`
  ];
}

function buildShapes(seed: string): { colors: [string, string, string]; shapes: Shape[] } {
  const rng = makeRng(seedFromString(seed));
  const colors = palette(rng);
  const shapes: Shape[] = [];

  for (let i = 0; i < 44; i += 1) {
    if (rng() > 0.42) {
      shapes.push({
        type: "circle",
        cx: Math.floor(rng() * CAPTCHA_WIDTH),
        cy: Math.floor(rng() * CAPTCHA_HEIGHT),
        r: 6 + Math.floor(rng() * 28),
        color: colors[Math.floor(rng() * colors.length)],
        opacity: Number((0.11 + rng() * 0.29).toFixed(2))
      });
    } else {
      shapes.push({
        type: "rect",
        x: Math.floor(rng() * CAPTCHA_WIDTH),
        y: Math.floor(rng() * CAPTCHA_HEIGHT),
        w: 14 + Math.floor(rng() * 52),
        h: 10 + Math.floor(rng() * 34),
        rx: 4 + Math.floor(rng() * 8),
        color: colors[Math.floor(rng() * colors.length)],
        opacity: Number((0.08 + rng() * 0.24).toFixed(2))
      });
    }
  }

  return { colors, shapes };
}

function escapeAttr(input: string): string {
  return input.replace(/"/g, "&quot;");
}

function puzzlePath(x = 0, y = 0): string {
  return [
    `M ${x} ${y + 8}`,
    `Q ${x} ${y} ${x + 8} ${y}`,
    `L ${x + 28} ${y}`,
    `Q ${x + 36} ${y - 8} ${x + 44} ${y}`,
    `L ${x + 64} ${y}`,
    `Q ${x + 72} ${y} ${x + 72} ${y + 8}`,
    `L ${x + 72} ${y + 18}`,
    `Q ${x + 80} ${y + 24} ${x + 72} ${y + 30}`,
    `L ${x + 72} ${y + 40}`,
    `Q ${x + 72} ${y + 48} ${x + 64} ${y + 48}`,
    `L ${x + 44} ${y + 48}`,
    `Q ${x + 36} ${y + 56} ${x + 28} ${y + 48}`,
    `L ${x + 8} ${y + 48}`,
    `Q ${x} ${y + 48} ${x} ${y + 40}`,
    `L ${x} ${y + 30}`,
    `Q ${x - 8} ${y + 24} ${x} ${y + 18}`,
    "Z"
  ].join(" ");
}

function renderShape(shape: Shape): string {
  if (shape.type === "circle") {
    return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
  }

  return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${shape.rx}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function pruneChallenges(req: Request): void {
  if (!req.session.captchaChallenges) {
    return;
  }

  const now = Date.now();
  for (const [id, challenge] of Object.entries(req.session.captchaChallenges)) {
    if (challenge.expiresAt <= now || challenge.used) {
      delete req.session.captchaChallenges[id];
    }
  }
}

export function createCaptchaChallenge(req: Request): {
  challengeId: string;
  backgroundImage: string;
  pieceImage: string;
  targetY: number;
  maxX: number;
} {
  pruneChallenges(req);

  const challengeId = randomUUID().replace(/-/g, "").slice(0, 16);
  const targetX = 70 + Math.floor(Math.random() * 150);
  const targetY = 36 + Math.floor(Math.random() * 62);
  const { colors, shapes } = buildShapes(challengeId);

  const shapeMarkup = shapes.map(renderShape).join("");
  const slotPath = puzzlePath(targetX, targetY);

  const bgSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${CAPTCHA_WIDTH}" height="${CAPTCHA_HEIGHT}" viewBox="0 0 ${CAPTCHA_WIDTH} ${CAPTCHA_HEIGHT}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${escapeAttr(colors[0])}"/>
      <stop offset="50%" stop-color="${escapeAttr(colors[1])}"/>
      <stop offset="100%" stop-color="${escapeAttr(colors[2])}"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <g>${shapeMarkup}</g>
  <path d="${slotPath}" fill="rgba(255,255,255,0.38)" stroke="rgba(9,12,24,0.65)" stroke-width="1.5"/>
</svg>`;

  const pieceSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${PIECE_WIDTH}" height="${PIECE_HEIGHT}" viewBox="0 0 ${PIECE_WIDTH} ${PIECE_HEIGHT}">
  <defs>
    <linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${escapeAttr(colors[0])}"/>
      <stop offset="50%" stop-color="${escapeAttr(colors[1])}"/>
      <stop offset="100%" stop-color="${escapeAttr(colors[2])}"/>
    </linearGradient>
    <clipPath id="clip">
      <path d="${puzzlePath(0, 0)}" />
    </clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect x="-${targetX}" y="-${targetY}" width="${CAPTCHA_WIDTH}" height="${CAPTCHA_HEIGHT}" fill="url(#g2)"/>
    <g transform="translate(-${targetX}, -${targetY})">${shapeMarkup}</g>
  </g>
  <path d="${puzzlePath(0, 0)}" fill="none" stroke="rgba(8, 10, 18, 0.85)" stroke-width="1.4"/>
</svg>`;

  req.session.captchaChallenges ??= {};
  req.session.captchaChallenges[challengeId] = {
    solutionX: targetX,
    targetY,
    expiresAt: Date.now() + TTL_MS,
    used: false
  };

  return {
    challengeId,
    backgroundImage: svgToDataUrl(bgSvg),
    pieceImage: svgToDataUrl(pieceSvg),
    targetY,
    maxX: CAPTCHA_WIDTH - PIECE_WIDTH
  };
}

export function verifyCaptcha(req: Request, challengeId: string, xRaw: number): boolean {
  pruneChallenges(req);

  const challenge = req.session.captchaChallenges?.[challengeId];
  if (!challenge || challenge.used || challenge.expiresAt < Date.now()) {
    return false;
  }

  challenge.used = true;
  delete req.session.captchaChallenges?.[challengeId];

  if (!Number.isFinite(xRaw)) {
    return false;
  }

  return Math.abs(xRaw - challenge.solutionX) <= TOLERANCE;
}
