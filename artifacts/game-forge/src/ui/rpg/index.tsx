/**
 * RPG / MMO UI primitives built on the craftpix.net texture pack.
 *
 * Each component renders a composited stack of PNG layers (background →
 * border → fill → overlay) using absolute positioning, exactly like the
 * PSD source files are structured.  All images are served from
 * `/ui/rpg-mmo/` and cached as static assets.
 *
 * Usage:
 *   import { RPGFrame, RPGBar, RPGUnitFrame, RPGActionSlot } from "@/ui/rpg";
 */
import type { CSSProperties, ReactNode } from "react";
import { UI } from "@/lib/uiAssets";

const FONT = "'Rajdhani', 'Inter', system-ui, sans-serif";

// ─── Helpers ───────────────────────────────────────────────────────────
function Tex({
  src,
  className,
  style,
}: {
  src: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={className ?? "absolute inset-0 w-full h-full"}
      style={{ pointerEvents: "none", objectFit: "fill", ...style }}
    />
  );
}

// ─── RPGFrame ──────────────────────────────────────────────────────────
/** Dark panel with ornamental corner borders. */
export function RPGFrame({
  children,
  className,
  style,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`relative ${className ?? ""}`}
      style={{ fontFamily: FONT, ...style }}
    >
      <Tex src={UI.general.background} />
      <Tex src={UI.general.borderTop} style={{ objectFit: "contain", objectPosition: "top" }} />
      <Tex src={UI.general.borderBottom} style={{ objectFit: "contain", objectPosition: "bottom" }} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// ─── RPGBar ────────────────────────────────────────────────────────────
/** Horizontal fill bar with texture background + fill stretch. */
export function RPGBar({
  value,
  max = 100,
  fillSrc,
  bgSrc,
  height = 14,
  label,
  color,
  className,
}: {
  value: number;
  max?: number;
  fillSrc?: string;
  bgSrc?: string;
  height?: number;
  label?: string;
  color?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value / Math.max(1, max)));
  const bg = bgSrc ?? UI.unitFrame.bars.hpBackground;
  const fill = fillSrc ?? UI.unitFrame.bars.hpFill;
  return (
    <div
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{ height, fontFamily: FONT }}
    >
      <Tex src={bg} />
      <div
        className="absolute inset-y-0 left-0 overflow-hidden transition-all duration-200"
        style={{ width: `${pct * 100}%` }}
      >
        <img
          src={fill}
          alt=""
          draggable={false}
          className="h-full w-full"
          style={{
            objectFit: "fill",
            pointerEvents: "none",
            filter: color ? `drop-shadow(0 0 4px ${color})` : undefined,
          }}
        />
      </div>
      {label && (
        <span
          className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/90 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
          style={{ fontFamily: FONT }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

// ─── RPGUnitFrame ──────────────────────────────────────────────────────
/** WoW-style unit frame: avatar circle + HP bar + optional secondary bar. */
export function RPGUnitFrame({
  hp,
  hpMax,
  mp,
  mpMax,
  level,
  name,
  avatarSrc,
  className,
}: {
  hp: number;
  hpMax: number;
  mp?: number;
  mpMax?: number;
  level?: number;
  name?: string;
  avatarSrc?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-start gap-1.5 ${className ?? ""}`}
      style={{ fontFamily: FONT }}
    >
      {/* Avatar */}
      <div className="relative w-12 h-12 flex-shrink-0">
        <Tex src={UI.unitFrame.avatar.background} />
        {avatarSrc && (
          <img
            src={avatarSrc}
            alt=""
            className="absolute inset-[3px] rounded-full object-cover"
          />
        )}
        <Tex src={UI.unitFrame.avatar.border} />
        <Tex src={UI.unitFrame.avatar.overlay} />
        {level != null && (
          <div className="absolute -bottom-1 -right-1 w-5 h-5">
            <Tex src={UI.unitFrame.level.background} />
            <Tex src={UI.unitFrame.level.border} />
            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-amber-200 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
              {level}
            </span>
          </div>
        )}
      </div>

      {/* Bars */}
      <div className="flex-1 min-w-0 pt-0.5">
        {name && (
          <div className="text-[10px] font-semibold text-amber-200/80 truncate mb-0.5 tracking-wider uppercase drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
            {name}
          </div>
        )}
        <RPGBar
          value={hp}
          max={hpMax}
          label={`${hp} / ${hpMax}`}
          height={12}
          className="rounded-sm"
        />
        {mp != null && mpMax != null && (
          <RPGBar
            value={mp}
            max={mpMax}
            bgSrc={UI.unitFrame.bars.mpBackground}
            fillSrc={UI.unitFrame.bars.mpFill}
            label={`${mp} / ${mpMax}`}
            height={8}
            className="rounded-sm mt-0.5"
          />
        )}
      </div>
    </div>
  );
}

// ─── RPGActionSlot ─────────────────────────────────────────────────────
/** Single action bar slot with optional cooldown overlay. */
export function RPGActionSlot({
  iconSrc,
  cooldownPct,
  hotkey,
  pressed,
  size = 42,
  className,
}: {
  iconSrc?: string;
  cooldownPct?: number;
  hotkey?: string;
  pressed?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`relative ${className ?? ""}`}
      style={{ width: size, height: size, fontFamily: FONT }}
    >
      <Tex src={UI.actionBar.slots.mainBackground} />
      {iconSrc && (
        <img
          src={iconSrc}
          alt=""
          draggable={false}
          className="absolute inset-[4px] object-contain"
          style={{ pointerEvents: "none" }}
        />
      )}
      {pressed && <Tex src={UI.actionBar.slots.mainPress} />}
      {cooldownPct != null && cooldownPct > 0 && (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(${(1 - cooldownPct) * 100}% 0 0 0)` }}
        >
          <Tex src={UI.actionBar.slots.mainCooldown} />
        </div>
      )}
      <Tex src={UI.actionBar.slots.mainBorder} />
      {hotkey && (
        <span className="absolute bottom-0.5 right-1 text-[8px] font-bold text-white/70 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
          {hotkey}
        </span>
      )}
    </div>
  );
}

// ─── RPGTooltip ────────────────────────────────────────────────────────
/** Textured tooltip container with border + anchor arrow. */
export function RPGTooltip({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative inline-block ${className ?? ""}`}
      style={{ fontFamily: FONT }}
    >
      <Tex src={UI.tooltip.background} />
      <Tex src={UI.tooltip.border} />
      <div className="relative z-10 px-3 py-2 text-[11px] text-white/90 leading-snug">
        {children}
      </div>
    </div>
  );
}

// ─── RPGNotification ───────────────────────────────────────────────────
/** Kill-feed / notification row with header glow. */
export function RPGNotification({
  children,
  glow,
  className,
}: {
  children?: ReactNode;
  glow?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{ fontFamily: FONT }}
    >
      <Tex src={UI.notifications.border} />
      {glow && <Tex src={UI.notifications.headerGlow} style={{ opacity: 0.6 }} />}
      <div className="relative z-10 px-2 py-1 text-[11px] text-white/90">
        {children}
      </div>
    </div>
  );
}
