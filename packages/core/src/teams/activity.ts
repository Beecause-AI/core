export type ParsedActivity = {
  type: string;
  tenantId: string | null;
  serviceUrl: string;
  conversationId: string;
  activityId: string;
  fromId: string | null;
  text: string;
  isBotMentioned: boolean;
};

/** Remove Teams `<at>…</at>` mention tags and collapse whitespace. */
export function stripMention(text: string): string {
  return (text ?? '').replace(/<at>.*?<\/at>/g, '').replace(/\s+/g, ' ').trim();
}

export function parseActivity(activity: unknown, botId: string): ParsedActivity {
  const a = (activity ?? {}) as Record<string, any>;
  const tenantId =
    a.channelData?.tenant?.id ?? a.conversation?.tenantId ?? null;
  const entities: any[] = Array.isArray(a.entities) ? a.entities : [];
  const isBotMentioned = entities.some(
    (e) => e?.type === 'mention' && e?.mentioned?.id === botId,
  );
  return {
    type: String(a.type ?? ''),
    tenantId: tenantId ? String(tenantId) : null,
    serviceUrl: String(a.serviceUrl ?? ''),
    conversationId: String(a.conversation?.id ?? ''),
    activityId: String(a.id ?? ''),
    fromId: a.from?.id ? String(a.from.id) : null,
    text: String(a.text ?? ''),
    isBotMentioned,
  };
}
