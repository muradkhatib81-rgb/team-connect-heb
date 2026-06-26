import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronRight, ChevronLeft, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

export interface LightboxImage {
  url: string;
  alt?: string;
}

interface Props {
  images: LightboxImage[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({ images, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % images.length);
    reset();
  }, [images.length, reset]);
  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + images.length) % images.length);
    reset();
  }, [images.length, reset]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") prev(); // RTL: right = previous
      else if (e.key === "ArrowLeft") next();
      else if (e.key === "+" || e.key === "=") setScale((s) => Math.min(s + 0.25, 5));
      else if (e.key === "-") setScale((s) => Math.max(s - 0.25, 1));
      else if (e.key === "0") reset();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, prev, next, reset]);

  if (!images.length) return null;
  const img = images[Math.max(0, Math.min(index, images.length - 1))];

  const content = (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center select-none"
      onClick={onClose}
      onWheel={(e) => {
        e.preventDefault();
        setScale((s) => Math.max(1, Math.min(5, s + (e.deltaY < 0 ? 0.2 : -0.2))));
      }}
    >
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-10 pointer-events-none">
        <div className="flex gap-2 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
          <button
            className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-full"
            onClick={() => setScale((s) => Math.min(5, s + 0.25))}
            aria-label="הגדל"
          >
            <ZoomIn className="size-5" />
          </button>
          <button
            className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-full"
            onClick={() => setScale((s) => Math.max(1, s - 0.25))}
            aria-label="הקטן"
          >
            <ZoomOut className="size-5" />
          </button>
          <button
            className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-full"
            onClick={reset}
            aria-label="איפוס"
          >
            <RotateCcw className="size-5" />
          </button>
          <span className="text-white/80 text-sm px-2 self-center">
            {index + 1} / {images.length}
          </span>
        </div>
        <button
          className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-full pointer-events-auto"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="סגור"
        >
          <X className="size-5" />
        </button>
      </div>

      {images.length > 1 && (
        <>
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white p-3 rounded-full z-10"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            aria-label="הקודם"
          >
            <ChevronRight className="size-6" />
          </button>
          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white p-3 rounded-full z-10"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            aria-label="הבא"
          >
            <ChevronLeft className="size-6" />
          </button>
        </>
      )}

      <img
        src={img.url}
        alt={img.alt ?? ""}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          if (scale > 1) {
            setDragging({ x: e.clientX - translate.x, y: e.clientY - translate.y });
          }
        }}
        onMouseMove={(e) => {
          if (dragging) {
            setTranslate({ x: e.clientX - dragging.x, y: e.clientY - dragging.y });
          }
        }}
        onMouseUp={() => setDragging(null)}
        onMouseLeave={() => setDragging(null)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setScale((s) => (s > 1 ? 1 : 2));
          if (scale > 1) setTranslate({ x: 0, y: 0 });
        }}
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transition: dragging ? "none" : "transform 0.15s ease-out",
          cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
          maxWidth: "95vw",
          maxHeight: "90vh",
          objectFit: "contain",
        }}
      />
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
