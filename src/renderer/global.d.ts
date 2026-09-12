import type { OmegaApi } from '@shared/ipc'

declare global {
  interface Window {
    /** Injected by src/preload/index.ts via contextBridge. */
    omega: OmegaApi
  }
}

export {}
