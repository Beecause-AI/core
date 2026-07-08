export interface ApprovalPolicy { writeToolsRequireApproval: boolean; overrides?: Record<string, boolean>; }
const SYSTEM_DEFAULT: ApprovalPolicy = { writeToolsRequireApproval: false };

/** org policy (if present) replaces project policy wholesale; else project; else system default. */
export function resolveApprovalRequired(orgPolicy: ApprovalPolicy | null, projectPolicy: ApprovalPolicy | null) {
  const policy = orgPolicy ?? projectPolicy ?? SYSTEM_DEFAULT;
  return (toolName: string, mutates: boolean): boolean => {
    if (!mutates) return false;
    return policy.overrides?.[toolName] ?? policy.writeToolsRequireApproval;
  };
}

/** Injected per-turn approval context the loop consumes. */
export interface ApprovalContext {
  required: (toolName: string, mutates: boolean) => boolean;
  /** resume decision for the pending batch (undefined on a first-run turn). */
  decision?: 'approved' | 'denied';
}
