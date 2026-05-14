/**
 * UI Editor — React renderer.
 *
 * Maps a `Widget` to a `<div class="gw-w gw-…">` positioned absolutely
 * inside the screen frame. The same shape is used by `exportHtml.ts` to
 * emit static markup, so when changing visuals here, also update
 * `serializeWidget()` to keep what-you-see = what-you-export.
 */
import type {
  Widget,
  UIScreen,
  PanelProps,
  TextProps,
  BarProps,
  ButtonProps,
  CircleButtonProps,
  HotbarProps,
  ImageProps,
} from "./types";

function styleFor(w: Widget): React.CSSProperties {
  return {
    left: w.x,
    top: w.y,
    width: w.w,
    height: w.h,
  };
}

function asPanel(p: Record<string, unknown>): PanelProps {
  return {
    variant: (p.variant as PanelProps["variant"]) ?? "stone",
    rivets: (p.rivets as boolean) ?? true,
    padding: (p.padding as number) ?? 12,
  };
}
function asText(p: Record<string, unknown>): TextProps {
  return {
    content: (p.content as string) ?? "",
    size: (p.size as TextProps["size"]) ?? "md",
    color: (p.color as string) ?? "#f5e2c1",
    weight: (p.weight as TextProps["weight"]) ?? 400,
    align: (p.align as TextProps["align"]) ?? "left",
  };
}
function asBar(p: Record<string, unknown>): BarProps {
  const value = Math.max(0, Math.min(100, (p.value as number) ?? 0));
  return {
    kind: (p.kind as BarProps["kind"]) ?? "hp",
    value,
    showLabel: (p.showLabel as boolean) ?? true,
    label: p.label as string | undefined,
  };
}
function asButton(p: Record<string, unknown>): ButtonProps {
  return {
    label: (p.label as string) ?? "",
    variant: (p.variant as ButtonProps["variant"]) ?? "primary",
    keyHint: p.keyHint as string | undefined,
  };
}
function asCircleButton(p: Record<string, unknown>): CircleButtonProps {
  return {
    glyph: (p.glyph as string) ?? "?",
    active: (p.active as boolean) ?? false,
    keyHint: p.keyHint as string | undefined,
  };
}
function asHotbar(p: Record<string, unknown>): HotbarProps {
  return {
    slots: Math.max(1, Math.min(12, (p.slots as number) ?? 8)),
    gap: (p.gap as number) ?? 4,
    showKeys: (p.showKeys as boolean) ?? true,
  };
}
function asImage(p: Record<string, unknown>): ImageProps {
  return {
    src: (p.src as string) ?? "",
    fit: (p.fit as ImageProps["fit"]) ?? "contain",
    alt: (p.alt as string) ?? "",
  };
}

function PanelInner({ p }: { p: PanelProps }) {
  if (!p.rivets) return null;
  return (
    <>
      <span className="gw-rivet tl" />
      <span className="gw-rivet tr" />
      <span className="gw-rivet bl" />
      <span className="gw-rivet br" />
    </>
  );
}

function BarInner({ p }: { p: BarProps }) {
  return (
    <>
      <div className="gw-bar-fill" style={{ width: `${p.value}%` }} />
      {p.showLabel ? (
        <div className="gw-bar-lbl">
          {p.label ?? p.kind.toUpperCase()} {Math.round(p.value)}%
        </div>
      ) : null}
    </>
  );
}

function ImageInner({ p }: { p: ImageProps }) {
  if (!p.src) {
    return <div className="gw-image-empty">Image</div>;
  }
  return <img src={p.src} alt={p.alt} />;
}

function HotbarInner({ p }: { p: HotbarProps }) {
  const out: React.ReactElement[] = [];
  for (let i = 0; i < p.slots; i++) {
    out.push(
      <div key={i} className="gw-hotbar-slot">
        {p.showKeys ? <span className="gw-key">{i + 1}</span> : null}
      </div>,
    );
  }
  return <>{out}</>;
}

export function WidgetView({ w }: { w: Widget }) {
  const style = styleFor(w);
  switch (w.type) {
    case "panel": {
      const p = asPanel(w.props);
      return (
        <div
          className={`gw-w gw-panel gw-panel-${p.variant}`}
          style={{ ...style, padding: p.padding }}
        >
          <PanelInner p={p} />
        </div>
      );
    }
    case "text": {
      const p = asText(w.props);
      return (
        <div
          className={`gw-w gw-text size-${p.size}`}
          style={{
            ...style,
            color: p.color,
            fontWeight: p.weight,
            justifyContent:
              p.align === "center"
                ? "center"
                : p.align === "right"
                  ? "flex-end"
                  : "flex-start",
          }}
        >
          <span>{p.content}</span>
        </div>
      );
    }
    case "bar": {
      const p = asBar(w.props);
      return (
        <div className={`gw-w gw-bar kind-${p.kind}`} style={style}>
          <BarInner p={p} />
        </div>
      );
    }
    case "button": {
      const p = asButton(w.props);
      return (
        <div className="gw-w" style={style}>
          <button type="button" className={`gw-btn variant-${p.variant}`}>
            {p.keyHint ? <span className="gw-key">{p.keyHint}</span> : null}
            {p.label}
          </button>
        </div>
      );
    }
    case "circle-button": {
      const p = asCircleButton(w.props);
      return (
        <div className="gw-w" style={style}>
          <button
            type="button"
            className={`gw-cbtn ${p.active ? "is-active" : ""}`}
          >
            {p.glyph}
            {p.keyHint ? <span className="gw-key">{p.keyHint}</span> : null}
          </button>
        </div>
      );
    }
    case "hotbar": {
      const p = asHotbar(w.props);
      return (
        <div
          className="gw-w gw-hotbar"
          style={{ ...style, gap: p.gap }}
        >
          <HotbarInner p={p} />
        </div>
      );
    }
    case "image": {
      const p = asImage(w.props);
      return (
        <div className={`gw-w gw-image fit-${p.fit}`} style={style}>
          <ImageInner p={p} />
        </div>
      );
    }
  }
}

export function ScreenView({
  screen,
  scale = 1,
}: {
  screen: UIScreen;
  scale?: number;
}) {
  return (
    <div
      className="gw-screen"
      style={{
        width: screen.width,
        height: screen.height,
        transform: scale !== 1 ? `scale(${scale})` : undefined,
        transformOrigin: "top left",
      }}
    >
      {screen.widgets.map((w) => (
        <WidgetView key={w.id} w={w} />
      ))}
    </div>
  );
}
