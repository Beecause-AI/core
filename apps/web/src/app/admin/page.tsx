'use client';

import { useEffect } from 'react';

// /admin has no content of its own — Members is the panel's landing item.
// Client redirect: the app is a static export, so there are no server redirects.
export default function AdminIndexPage() {
  useEffect(() => {
    window.location.replace('/admin/members');
  }, []);
  return null;
}
