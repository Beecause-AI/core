'use client';

import { useEffect, useState } from 'react';
import { api, fetchConversationReports, fetchLatestReportOffer, type ConversationReport, type ConversationSummary, type ReportOffer } from '../../lib/api';
import { EmptyState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { ConversationListRow } from '../conversation/conversation-list-row';
import { ConversationThread } from '../conversation/conversation-thread';

interface ConversationsTabProps {
  slug: string;
  conversationId?: string;
}

export function ConversationsTab({ slug, conversationId }: ConversationsTabProps) {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState('');
  const [reports, setReports] = useState<ConversationReport[] | null>(null);
  const [offer, setOffer] = useState<ReportOffer | null>(null);

  useEffect(() => {
    if (conversationId) return; // detail mode doesn't need the list
    api<ConversationSummary[]>(`/api/org/projects/${slug}/conversations`)
      .then(setConversations)
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 401) return;
        setError(e?.message ?? 'Failed to load conversations');
        setConversations([]);
      });
  }, [slug, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    setReports(null);
    fetchConversationReports(slug, conversationId)
      .then(setReports)
      .catch(() => setReports([])); // non-fatal: just hide the link
  }, [slug, conversationId]);

  // Track the latest report offer so we can show a live status badge on the
  // conversation. While a report is in flight (offered/generating) we poll every
  // ~3s; when it reaches a terminal state we stop, and on success we refresh the
  // reports list so the versioned "View report" link appears.
  useEffect(() => {
    if (!conversationId) return;
    setOffer(null);
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const inProgress = (s?: string) => s === 'offered' || s === 'generating';

    const load = () => {
      fetchLatestReportOffer(slug, conversationId)
        .then((o) => {
          if (cancelled) return;
          setOffer(o);
          if (!inProgress(o?.status)) {
            if (timer) { clearInterval(timer); timer = undefined; }
            if (o?.status === 'generated') {
              fetchConversationReports(slug, conversationId)
                .then((r) => { if (!cancelled) setReports(r); })
                .catch(() => {});
            }
          }
        })
        .catch(() => { if (!cancelled) setOffer(null); }); // non-fatal: hide the badge
    };

    load();
    timer = setInterval(load, 3000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [slug, conversationId]);

  if (conversationId) {
    const latestReport = reports?.[0] ?? null;
    return (
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <a href={`/p/${slug}/conversations`} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            All conversations
          </a>
          <ReportStatus offer={offer} latestReport={latestReport} />
        </div>
        <ConversationThread slug={slug} conversationId={conversationId} />
      </section>
    );
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">Conversations</h2>
      </div>
      {conversations === null && !error ? (
        <Skeleton rows={4} variant="list" />
      ) : error ? (
        <p className="text-sm text-crit">{error}</p>
      ) : conversations!.length === 0 ? (
        <EmptyState title="No conversations yet" body="Conversations will appear here once your assistants start chatting." />
      ) : (
        <div className="flex flex-col gap-2">
          {conversations!.map((c) => (
            <ConversationListRow key={c.id} slug={slug} summary={c} />
          ))}
        </div>
      )}
    </section>
  );
}

/** One reconciled report control for the conversation header: the live offer
 *  status while a report is in flight or failed, otherwise the versioned link to
 *  the stored report. Renders nothing when there is no report and no active offer. */
function ReportStatus({ offer, latestReport }: { offer: ReportOffer | null; latestReport: ConversationReport | null }) {
  if (offer && (offer.status === 'offered' || offer.status === 'generating')) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
        <span className="size-1.5 rounded-full bg-accent animate-pulse" aria-hidden="true" />
        📄 Generating report…
      </span>
    );
  }
  if (offer && offer.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-crit" title={offer.error ?? undefined}>
        📄 Report generation failed
      </span>
    );
  }
  if (latestReport) {
    return (
      <a
        href={`/api/reports/${latestReport.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-accent hover:underline"
      >
        📄 View report (v{latestReport.version})
      </a>
    );
  }
  if (offer && offer.status === 'generated' && offer.reportId) {
    return (
      <a
        href={`/api/reports/${offer.reportId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-accent hover:underline"
      >
        📄 Report ready
      </a>
    );
  }
  return null;
}
