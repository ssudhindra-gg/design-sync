/// <reference types="vite/client" />

// Declared so tsc (with noPropertyAccessFromIndexSignature) knows the
// VITE_* variables src/services/api/real-api.ts reads; all are optional.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_API_USERNAME?: string;
  readonly VITE_API_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
