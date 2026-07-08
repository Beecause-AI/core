'use client';

import { Suspense, useEffect } from 'react';
import { api } from '../../lib/api';

function Redirector() {
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) { window.location.replace('/'); return; }
    api<{ slug: string }>(`/api/org/projects/by-id/${id}`)
      .then((r) => window.location.replace(`/p/${r.slug}`))
      .catch(() => window.location.replace('/'));
  }, []);
  return null;
}

export default function LegacyProjectRedirect() {
  return <Suspense fallback={null}><Redirector /></Suspense>;
}
