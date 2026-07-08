import { getProjectConnection, type Db } from '@intellilabs/core';

/** True iff the project is bound to a Cloudflare connection (Cloudflare tools are then offered). */
export async function projectHasCloudflare(db: Db, projectId: string): Promise<boolean> {
  return (await getProjectConnection(db, projectId)) !== null;
}
