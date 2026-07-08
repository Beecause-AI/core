import { getSentryProjectConnection, type Db } from '@intellilabs/core';

/** True iff the project is bound to a Sentry connection (Sentry tools are then offered). */
export async function projectHasSentry(db: Db, projectId: string): Promise<boolean> {
  return (await getSentryProjectConnection(db, projectId)) !== null;
}
