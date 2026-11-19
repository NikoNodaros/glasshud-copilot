import type { glassApi } from "./index";

declare global {
  interface Window {
    glassApi: typeof glassApi;
  }
}
