'use client';

import { NotFound404 } from '../components/not-found-404';

// Static export emits this as out/404.html; Firebase Hosting serves it for
// any path that matches no file (no SPA catch-all rewrite is configured).
export default function NotFound() {
  return <NotFound404 variant="page" />;
}
