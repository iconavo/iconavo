"use client";

import { Icon } from "@iconavo-ui/react";
import { useEffect, useRef, useState } from "react";
import type { MessageKey } from "../../lib/account";
import {
  CROP,
  type CropState,
  clampCrop,
  imageRect,
  sourceSquare,
} from "../../lib/crop";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { CabinetDialog } from "./CabinetDialog";

const START: CropState = { zoom: 1, x: 0, y: 0 };

/**
 * «Crop your photo» (кадр B2): картинка на холсте, поверх — круг 200 px с затемнением вокруг (стилями, а не
 * на холсте: цвета — токены сайта). Двигают мышью, пальцем или стрелками, приближают ползунком и «−»/«+».
 * «Save photo» — квадрат 512 × 512 JPEG под кругом (lib/crop.ts) уходит в onSave.
 */
export function PhotoDialog({
  lang,
  image,
  open,
  busy,
  error,
  onClose,
  onSave,
  opener,
}: {
  lang: Lang;
  image: ImageBitmap | null;
  open: boolean;
  busy: boolean;
  /** Фото не ушло (сеть) — текст под ползунком; обрезка остаётся. */
  error?: MessageKey;
  onClose: () => void;
  onSave: (photo: Blob) => void;
  /** Кнопка «Upload photo»: туда вернётся фокус. */
  opener?: { readonly current: HTMLElement | null };
}) {
  const t = DICTIONARIES[lang];
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [state, setState] = useState<CropState>(START);

  // Новая картинка — с начала: посередине, масштаб 1.
  useEffect(() => {
    if (image !== null) setState(START);
  }, [image]);

  // Рисунок — при каждом сдвиге, масштабе и смене размера области.
  useEffect(() => {
    const el = canvas.current;
    if (el === null || image === null || !open) return;
    const draw = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      const ctx = el.getContext("2d");
      if (ctx === null) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const r = imageRect(state, image.width, image.height, w, h);
      try {
        ctx.drawImage(image, r.left, r.top, r.width, r.height);
      } catch {
        // Окно уже закрыли и память картинки отдали, а размер области успел смениться — рисовать нечего.
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => observer.disconnect();
  }, [image, state, open]);

  const move = (dx: number, dy: number, zoom = 0) => {
    if (image === null) return;
    setState((prev) =>
      clampCrop(
        { zoom: prev.zoom + zoom, x: prev.x + dx, y: prev.y + dy },
        image.width,
        image.height,
      ),
    );
  };

  const zoomTo = (zoom: number) => {
    if (image === null) return;
    setState((prev) => clampCrop({ ...prev, zoom }, image.width, image.height));
  };

  const save = () => {
    if (image === null) return;
    const square = sourceSquare(state, image.width, image.height);
    const out = document.createElement("canvas");
    out.width = CROP.out;
    out.height = CROP.out;
    const ctx = out.getContext("2d");
    if (ctx === null) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      image,
      square.x,
      square.y,
      square.size,
      square.size,
      0,
      0,
      CROP.out,
      CROP.out,
    );
    out.toBlob(
      (blob) => {
        if (blob !== null) onSave(blob);
      },
      "image/jpeg",
      0.9,
    );
  };

  return (
    <CabinetDialog
      lang={lang}
      name="crop"
      open={open}
      onClose={onClose}
      title={t.cropTitle}
      description={t.cropText}
      action={t.savePhoto}
      busy={busy}
      onSubmit={save}
      {...(opener === undefined ? {} : { opener })}
    >
      <div className="crop-area preview-dark">
        <canvas
          ref={canvas}
          className="crop-canvas"
          tabIndex={0}
          role="img"
          aria-label={t.cropArea}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const from = drag.current;
            if (from === null) return;
            drag.current = { x: e.clientX, y: e.clientY };
            move(e.clientX - from.x, e.clientY - from.y);
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onKeyDown={(e) => {
            const step = CROP.step;
            const keys: Record<string, [number, number, number]> = {
              ArrowLeft: [-step, 0, 0],
              ArrowRight: [step, 0, 0],
              ArrowUp: [0, -step, 0],
              ArrowDown: [0, step, 0],
              "+": [0, 0, 0.1],
              "=": [0, 0, 0.1],
              "-": [0, 0, -0.1],
            };
            const delta = keys[e.key];
            if (delta === undefined) return;
            e.preventDefault();
            move(...delta);
          }}
        />
        <span className="crop-ring" aria-hidden="true" />
      </div>
      <div className="crop-zoom">
        <button
          type="button"
          className="crop-zoom-button"
          aria-label={t.zoomOut}
          onClick={() => move(0, 0, -0.25)}
        >
          <Icon icon="material-symbols:remove" />
        </button>
        <input
          type="range"
          className="settings-slider"
          min={CROP.minZoom}
          max={CROP.maxZoom}
          step={0.01}
          value={state.zoom}
          aria-label={t.zoom}
          onChange={(e) => zoomTo(Number(e.currentTarget.value))}
        />
        <button
          type="button"
          className="crop-zoom-button"
          aria-label={t.zoomIn}
          onClick={() => move(0, 0, 0.25)}
        >
          <Icon icon="material-symbols:add" />
        </button>
      </div>
      {error === undefined ? null : (
        <p className="auth-note auth-note-error" role="alert">
          {t[error]}
        </p>
      )}
    </CabinetDialog>
  );
}
