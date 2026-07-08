/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AMAZON_AFFILIATE_TAG: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
