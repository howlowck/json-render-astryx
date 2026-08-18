/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OLLAMA_MODEL?: string;
  readonly VITE_OLLAMA_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
