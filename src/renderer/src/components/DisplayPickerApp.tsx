import { Monitor } from "lucide-react";

export function DisplayPickerApp({
  displayId,
  label,
}: {
  displayId: number;
  label: string;
}) {
  return (
    <div
      onClick={() => void window.glassApi.displays.moveOverlay(displayId)}
      onKeyDown={(e) => {
        if (e.key === "Escape") window.glassApi.displays.hidePickers();
      }}
      tabIndex={0}
      className="flex h-full w-full cursor-pointer items-center justify-center bg-slate-950/55 backdrop-blur-xs transition hover:bg-indigo-950/60"
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-indigo-400/50 bg-slate-900/90 px-8 py-6 text-center shadow-2xl">
        <Monitor className="h-10 w-10 text-indigo-400" />
        <div className="text-lg font-semibold text-white">{label}</div>
        <div className="text-xs text-slate-300">
          Click anywhere on this display to move GlassHUD here
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            window.glassApi.displays.hidePickers();
          }}
          className="mt-1 rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-300 hover:bg-white/10"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
