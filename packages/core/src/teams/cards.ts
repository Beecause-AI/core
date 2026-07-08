/** Adaptive Card attachment with a single "Connect this channel" button. Teams renders the
 *  bot's `text` as markdown natively, so rich replies need no card — only the connect prompt
 *  needs a button (Teams has no Block-Kit-style inline buttons in plain messages). */
export function connectCardAttachment(url: string, channelLabel?: string): unknown {
  const where = channelLabel ? ` in ${channelLabel}` : '';
  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.4',
      body: [
        { type: 'TextBlock', text: '👋 Not connected to a Beecause project yet', weight: 'Bolder', wrap: true },
        { type: 'TextBlock', text: `Connect this channel${where} to a Beecause project to get started. Only project owners or managers can connect a channel.`, wrap: true },
      ],
      actions: [{ type: 'Action.OpenUrl', title: 'Connect this channel', url }],
    },
  };
}

export function teamsReplyText(markdown: string): string {
  return (markdown ?? '').trim() || '(no response)';
}
