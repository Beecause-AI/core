import { makeLogger, type McpServer } from '@intellilabs/core';

const log = makeLogger({ service: 'mcp-gateway', projectId: process.env.GCP_PROJECT_ID ?? 'local' });

/** A raw tool as returned by an MCP server's listTools response. */
export interface RawTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; [k: string]: unknown };
  [k: string]: unknown;
}

/** The tool definition we expose to callers. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  kind: 'mcp';
  mutates: boolean;
}

/** A live connection to one MCP server. */
export interface McpConn {
  listTools(): Promise<RawTool[]>;
  callTool(name: string, args: unknown): Promise<{ content: string; isError?: boolean }>;
  close(): Promise<void>;
}

export type McpClientFactory = (server: McpServer, token: string | null) => Promise<McpConn>;

export interface McpGatewayDeps {
  loadServers: (orgId: string) => Promise<McpServer[]>;
  clientFactory: McpClientFactory;
  /** Optional: returns the auth token for a server; defaults to () => null. */
  tokenFor?: (server: McpServer) => string | null;
  /** Schema cache TTL in milliseconds; default 60_000. */
  ttlMs?: number;
}

interface SchemaEntry {
  defs: ToolDef[];
  at: number;
}

export class McpGateway {
  private readonly loadServers: (orgId: string) => Promise<McpServer[]>;
  private readonly clientFactory: McpClientFactory;
  private readonly tokenFor: (server: McpServer) => string | null;
  private readonly ttlMs: number;

  // Connection cache: serverId → McpConn
  private readonly connCache = new Map<string, McpConn>();
  // Schema cache: serverId → { defs, at }
  private readonly schemaCache = new Map<string, SchemaEntry>();

  constructor(deps: McpGatewayDeps) {
    this.loadServers = deps.loadServers;
    this.clientFactory = deps.clientFactory;
    this.tokenFor = deps.tokenFor ?? (() => null);
    this.ttlMs = deps.ttlMs ?? 60_000;
  }

  private async ensureConn(server: McpServer): Promise<McpConn> {
    const cached = this.connCache.get(server.id);
    if (cached) return cached;
    const token = this.tokenFor(server);
    const conn = await this.clientFactory(server, token);
    this.connCache.set(server.id, conn);
    return conn;
  }

  private dropConn(server: McpServer): void {
    this.connCache.delete(server.id);
    this.schemaCache.delete(server.id);
  }

  private mapTools(server: McpServer, rawTools: RawTool[]): ToolDef[] {
    return rawTools.map((tool) => ({
      name: `mcp.${server.name}.${tool.name}`,
      description: tool.description ?? '',
      parameters: (tool.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
      kind: 'mcp' as const,
      mutates: tool.annotations?.readOnlyHint === true ? false : true,
    }));
  }

  async listTools(orgId: string, serverNames?: string[]): Promise<ToolDef[]> {
    const servers = await this.loadServers(orgId);
    const filtered = serverNames ? servers.filter((s) => serverNames.includes(s.name)) : servers;

    const results: ToolDef[] = [];
    const now = Date.now();

    for (const server of filtered) {
      try {
        const cached = this.schemaCache.get(server.id);
        if (cached && now - cached.at < this.ttlMs) {
          results.push(...cached.defs);
          continue;
        }

        const conn = await this.ensureConn(server);
        const rawTools = await conn.listTools();
        const defs = this.mapTools(server, rawTools);
        this.schemaCache.set(server.id, { defs, at: now });
        results.push(...defs);
      } catch (err) {
        log.error({ err, serverName: server.name }, '[McpGateway] Failed to list tools for server');
        this.dropConn(server);
      }
    }

    return results;
  }

  async callTool(orgId: string, name: string, args: unknown): Promise<{ content: string; isError?: boolean }> {
    const servers = await this.loadServers(orgId);

    const server = servers.find((s) => name.startsWith(`mcp.${s.name}.`));
    if (!server) {
      return { content: `unknown mcp server for ${name}`, isError: true };
    }

    const prefix = `mcp.${server.name}.`;
    const bareName = name.slice(prefix.length);

    try {
      const conn = await this.ensureConn(server);
      return await conn.callTool(bareName, args);
    } catch (err) {
      this.dropConn(server);
      return { content: String(err), isError: true };
    }
  }
}
