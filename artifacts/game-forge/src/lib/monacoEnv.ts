/**
 * Configure Monaco's web-worker environment for Vite.
 *
 * Without this, `@monaco-editor/react` falls back to a same-thread polyfill
 * that hard-disables the TypeScript / JSON / CSS language services in
 * production builds and produces the runtime warning:
 *
 *   "You must define a function MonacoEnvironment.getWorkerUrl or
 *    MonacoEnvironment.getWorker"
 *
 * Vite's `?worker` import suffix builds each Monaco language worker as a
 * standalone module that ships in `dist/assets/<hash>.js` and is loaded
 * by the browser on demand. We map each Monaco worker label to its module.
 *
 * Imported for side-effects only — see `main.tsx`.
 */
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker?(workerId: string, label: string): Worker;
    };
  }
}

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case "json":
        return new JsonWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      case "typescript":
      case "javascript":
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};
