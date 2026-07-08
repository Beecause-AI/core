import { ConnectorClient, MicrosoftAppCredentials } from 'botframework-connector';

export type TeamsAuth = { appId: string; appPassword: string; tenantId: string };
export type TeamsSendInput = { serviceUrl: string; conversationId: string; text: string; attachments?: unknown[]; replyToId?: string };
export type TeamsSendResult = { ok: true; activityId?: string } | { ok: false; error: string };

export interface ConnectorLike {
  conversations: {
    sendToConversation(conversationId: string, activity: unknown): Promise<{ id?: string }>;
    replyToActivity(conversationId: string, activityId: string, activity: unknown): Promise<{ id?: string }>;
    updateActivity(conversationId: string, activityId: string, activity: unknown): Promise<{ id?: string }>;
  };
}
export type ConnectorFactory = (auth: TeamsAuth, serviceUrl: string) => ConnectorLike;

export interface TeamsClient {
  sendActivity(auth: TeamsAuth, input: TeamsSendInput): Promise<TeamsSendResult>;
  updateActivity(auth: TeamsAuth, input: TeamsSendInput & { activityId: string }): Promise<TeamsSendResult>;
}

function messageActivity(input: { text: string; attachments?: unknown[] }): Record<string, unknown> {
  return {
    type: 'message',
    text: input.text,
    textFormat: 'markdown',
    ...(input.attachments && input.attachments.length ? { attachments: input.attachments } : {}),
  };
}

function makeClient(factory: ConnectorFactory): TeamsClient {
  return {
    async sendActivity(auth, input) {
      try {
        const client = factory(auth, input.serviceUrl);
        const activity = messageActivity(input);
        const res = input.replyToId
          ? await client.conversations.replyToActivity(input.conversationId, input.replyToId, activity)
          : await client.conversations.sendToConversation(input.conversationId, activity);
        return { ok: true, activityId: res?.id };
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? 'unreachable' };
      }
    },
    async updateActivity(auth, input) {
      try {
        const client = factory(auth, input.serviceUrl);
        const activity = { ...messageActivity(input), id: input.activityId };
        const res = await client.conversations.updateActivity(input.conversationId, input.activityId, activity);
        return { ok: true, activityId: res?.id ?? input.activityId };
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? 'unreachable' };
      }
    },
  };
}

// Single-tenant Azure Bot ⇒ pass the home tenant as channelAuthTenant on the credentials.
const realFactory: ConnectorFactory = (auth, serviceUrl) =>
  new ConnectorClient(new MicrosoftAppCredentials(auth.appId, auth.appPassword, auth.tenantId), { baseUri: serviceUrl }) as unknown as ConnectorLike;

export const realTeamsClient: TeamsClient = makeClient(realFactory);
export const makeTeamsClientForTest = (factory: ConnectorFactory): TeamsClient => makeClient(factory);
