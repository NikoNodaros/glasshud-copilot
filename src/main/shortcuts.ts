import { globalShortcut } from "electron";
import type { ShortcutAction, ShortcutMap } from "@shared/types";

export class ShortcutManager {
  private currentMap: ShortcutMap | null = null;
  private onTrigger: ((action: ShortcutAction) => void) | null = null;

  apply(map: ShortcutMap, handler: (action: ShortcutAction) => void): Record<ShortcutAction, boolean> {
    this.currentMap = { ...map };
    this.onTrigger = handler;
    return this.reregister();
  }

  reregister(): Record<ShortcutAction, boolean> {
    globalShortcut.unregisterAll();
    const results = {} as Record<ShortcutAction, boolean>;
    if (!this.currentMap || !this.onTrigger) return results;

    for (const [action, accelerator] of Object.entries(this.currentMap) as Array<
      [ShortcutAction, string]
    >) {
      if (!accelerator.trim()) {
        results[action] = true;
        continue;
      }
      try {
        const ok = globalShortcut.register(accelerator, () => {
          this.onTrigger?.(action);
        });
        results[action] = ok;
      } catch {
        results[action] = false;
      }
    }
    return results;
  }

  suspend(): void {
    globalShortcut.unregisterAll();
  }

  dispose(): void {
    globalShortcut.unregisterAll();
    this.currentMap = null;
    this.onTrigger = null;
  }
}
