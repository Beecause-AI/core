// Public Identity Platform web config. The API key is a browser key (safe to ship).
// authDomain is set per-request to window.location.host (same-origin /__/auth proxy),
// so it is intentionally omitted here.
// When AUTH_BACKEND=gcp, set NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID
// in your environment. Self-hosters using local or OIDC auth can leave these unset.
export const idpConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
};
