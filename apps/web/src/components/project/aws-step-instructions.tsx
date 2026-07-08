export function AwsStepInstructions() {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5 text-sm text-fg-muted">
      <p className="font-medium text-fg">Grant read-only access</p>
      <ol className="flex flex-col gap-2 pl-4 list-decimal">
        <li>Create an IAM role (or user) with the AWS managed policies <span className="font-mono text-fg">CloudWatchReadOnlyAccess</span>, <span className="font-mono text-fg">CloudWatchLogsReadOnlyAccess</span>, and <span className="font-mono text-fg">AWSXRayReadOnlyAccess</span>.</li>
        <li><span className="font-medium text-fg">IAM role:</span> set its trust policy to allow our platform principal to <span className="font-mono text-fg">sts:AssumeRole</span> with the generated External ID. Paste the Role ARN here.</li>
        <li><span className="font-medium text-fg">Access key:</span> create an access key for the user and paste the key ID + secret here.</li>
        <li>Save, then click <span className="font-medium text-fg">Verify</span> to confirm the account and which signals are reachable.</li>
      </ol>
    </div>
  );
}
