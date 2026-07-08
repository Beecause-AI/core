/** A report-gen job, published by the server and consumed by engine-worker.
 *  Triggers AI generation of a conversation report for the given offer. */
export type ReportGenJob = {
  offerId: string;
};

/** What the server uses to publish a report-gen job (concrete impl wired at the server boot). */
export interface ReportGenPublisher {
  publish(job: ReportGenJob): Promise<void>;
}
