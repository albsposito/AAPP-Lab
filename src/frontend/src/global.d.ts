declare global {
  interface Window {
    __APP_CONFIG__?: {
      backendUrl?: string;
    };
  }
}

export {};
