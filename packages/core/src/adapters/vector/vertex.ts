import { GoogleAuth } from 'google-auth-library';
import type { Neighbor, VectorIndex, VectorPoint } from '../../ports/vector.js';

export type VertexVectorConfig = {
  location: string;
  indexId: string;
  indexEndpointId: string;
  deployedIndexId: string;
};

/** True only when every field needed to reach a deployed index is present. When vector search
 *  is not provisioned, infra injects empty strings — guard on that so callers pick DisabledVectorIndex. */
export function vectorConfigured(cfg: VertexVectorConfig): boolean {
  return !!(cfg.location && cfg.indexId && cfg.indexEndpointId && cfg.deployedIndexId);
}

/** Vertex AI Vector Search (Matching Engine) over REST. Auth via ADC. */
export class VertexVectorIndex implements VectorIndex {
  private auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

  constructor(
    private projectId: string,
    private cfg: VertexVectorConfig,
  ) {}

  private apiBase(): string {
    return `https://${this.cfg.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.cfg.location}`;
  }

  private async token(): Promise<string> {
    const t = await this.auth.getAccessToken();
    if (!t) throw new Error('vertex-vector: failed to obtain ADC access token');
    return t;
  }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.apiBase()}/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await this.token()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`vertex-vector ${path} ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res.json();
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.post(`indexes/${this.cfg.indexId}:upsertDatapoints`, {
      datapoints: points.map((p) => ({
        datapointId: p.id,
        featureVector: p.embedding,
        restricts: Object.entries(p.restricts ?? {}).map(([namespace, value]) => ({
          namespace,
          allowList: [value],
        })),
      })),
    });
  }

  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.post(`indexes/${this.cfg.indexId}:removeDatapoints`, { datapointIds: ids });
  }

  async findNeighbors(
    embedding: number[],
    opts: { limit: number; filter?: Record<string, string[]> },
  ): Promise<Neighbor[]> {
    const restricts = Object.entries(opts.filter ?? {}).map(([namespace, allowList]) => ({
      namespace,
      allowList,
    }));
    const json = await this.post(`indexEndpoints/${this.cfg.indexEndpointId}:findNeighbors`, {
      deployedIndexId: this.cfg.deployedIndexId,
      queries: [{ datapoint: { featureVector: embedding, restricts }, neighborCount: opts.limit }],
    });
    const neighbors = json?.nearestNeighbors?.[0]?.neighbors ?? [];
    return neighbors.map((n: any) => ({
      id: n.datapoint?.datapointId as string,
      distance: n.distance as number,
    }));
  }
}
