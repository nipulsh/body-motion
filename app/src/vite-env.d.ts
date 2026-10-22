/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_VISION_DEBUG_ROTATION?: string;
  readonly VITE_EXERCISE_DIAGNOSTIC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
