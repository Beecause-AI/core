import { parse, Kind, type ValueNode, type ObjectValueNode, type FieldNode, type FragmentDefinitionNode } from 'graphql';

export type CfScope =
  | { kind: 'zone'; zoneTag: string }
  | { kind: 'account'; accountTag: string };

export type ValidateResult = { ok: true } | { ok: false; error: string };

/** Resolve a GraphQL value to a string: string literal, or variable looked up in `variables`. */
function resolveString(node: ValueNode | undefined, variables: Record<string, unknown>): string | null {
  if (!node) return null;
  if (node.kind === Kind.STRING) return node.value;
  if (node.kind === Kind.VARIABLE) {
    const v = variables[node.name.value];
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/** Pull the `filter` ObjectValue from a selector field's arguments, if present. */
function filterArg(field: FieldNode): ObjectValueNode | null {
  const arg = field.arguments?.find((a) => a.name.value === 'filter');
  return arg && arg.value.kind === Kind.OBJECT ? arg.value : null;
}

function tagFromFilter(obj: ObjectValueNode | null, key: 'zoneTag' | 'accountTag', variables: Record<string, unknown>): string | null | undefined {
  if (!obj) return undefined; // no filter at all
  const f = obj.fields.find((x) => x.name.value === key);
  if (!f) return undefined; // filter present but no tag key
  return resolveString(f.value, variables); // string | null (unresolvable)
}

/**
 * Validate that `query` only scopes to the bound target.
 * - Walks every `zones`/`accounts` selector field (those are the scope selectors).
 * - zone target: requires ≥1 `zones` whose zoneTag === bound; forbids any `accounts`; every `zones` tag must match.
 * - account target: requires ≥1 `accounts` whose accountTag === bound; forbids top-level `zones`; every `accounts` tag must match.
 * - A missing/unresolvable scope tag on a selector ⇒ reject.
 * Dataset-level filters (fields not named zones/accounts) are not inspected.
 */
export function validateGraphqlScope(query: string, scope: CfScope, variables: Record<string, unknown> = {}): ValidateResult {
  let doc;
  try { doc = parse(query); }
  catch (e) { return { ok: false, error: `invalid GraphQL: ${e instanceof Error ? e.message : String(e)}` }; }

  const bound = scope.kind === 'zone' ? scope.zoneTag : scope.accountTag;
  const wantSelector = scope.kind === 'zone' ? 'zones' : 'accounts';
  const forbidSelector = scope.kind === 'zone' ? 'accounts' : 'zones';
  const tagKey = scope.kind === 'zone' ? 'zoneTag' : 'accountTag';

  // Map of fragment definitions in the document, keyed by name.
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const def of doc.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);
  }

  let matched = 0;
  let bad: string | null = null;

  const walk = (selections: readonly any[] | undefined, visited: Set<string>) => {
    if (!selections) return;
    for (const sel of selections) {
      if (sel.kind === Kind.FIELD) {
        const field = sel as FieldNode;
        const fname = field.name.value;
        if (fname === forbidSelector) {
          bad ??= `${forbidSelector} scope is not allowed for a ${scope.kind} target`;
        } else if (fname === wantSelector) {
          const tag = tagFromFilter(filterArg(field), tagKey as any, variables);
          if (tag === undefined || tag === null) bad ??= `${wantSelector} must scope by ${tagKey} (literal or resolvable variable)`;
          else if (tag !== bound) bad ??= `${tagKey} "${tag}" is outside this target's scope`;
          else matched++;
        }
        walk(field.selectionSet?.selections, visited);
      } else if (sel.kind === Kind.INLINE_FRAGMENT) {
        walk(sel.selectionSet?.selections, visited);
      } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
        const name = sel.name.value;
        const frag = fragments.get(name);
        if (!frag) {
          bad ??= `unknown fragment spread: ${name}`;
        } else if (!visited.has(name)) {
          // Guard against fragment cycles.
          visited.add(name);
          walk(frag.selectionSet.selections, visited);
        }
      }
    }
  };
  for (const def of doc.definitions) {
    if (def.kind === Kind.OPERATION_DEFINITION) walk(def.selectionSet.selections, new Set());
  }

  if (bad) return { ok: false, error: bad };
  if (matched === 0) return { ok: false, error: `query must scope to ${wantSelector}(filter: { ${tagKey}: "${bound}" })` };
  return { ok: true };
}

export type CfAllowed = { zones: Set<string>; accounts: Set<string>; unrestricted: boolean };

/**
 * Validate a raw GraphQL query against a project's allowed resource set.
 * - unrestricted: allow any zoneTag/accountTag (the token is the boundary), but the query
 *   must still scope to at least one viewer.zones/viewer.accounts selector with a resolvable tag.
 * - restricted: every viewer.zones zoneTag must be in `allowed.zones`; every viewer.accounts
 *   accountTag in `allowed.accounts`; a selector whose tag is missing/unresolvable is rejected;
 *   require ≥1 scoped selector.
 */
export function validateGraphqlScopes(query: string, allowed: CfAllowed): ValidateResult {
  let doc;
  try { doc = parse(query); }
  catch (e) { return { ok: false, error: `invalid GraphQL: ${e instanceof Error ? e.message : String(e)}` }; }

  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const def of doc.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);
  }

  let matched = 0;
  let bad: string | null = null;

  const checkSelector = (field: FieldNode, sel: 'zones' | 'accounts') => {
    const tagKey = sel === 'zones' ? 'zoneTag' : 'accountTag';
    const tag = tagFromFilter(filterArg(field), tagKey, {});
    if (tag === undefined || tag === null) {
      bad ??= `${sel} must scope by ${tagKey} (literal or resolvable variable)`;
      return;
    }
    if (!allowed.unrestricted) {
      const set = sel === 'zones' ? allowed.zones : allowed.accounts;
      if (!set.has(tag)) { bad ??= `${tagKey} "${tag}" is outside this project's scope`; return; }
    }
    matched++;
  };

  const walk = (selections: readonly any[] | undefined, visited: Set<string>) => {
    if (!selections) return;
    for (const sel of selections) {
      if (sel.kind === Kind.FIELD) {
        const field = sel as FieldNode;
        const fname = field.name.value;
        if (fname === 'zones') checkSelector(field, 'zones');
        else if (fname === 'accounts') checkSelector(field, 'accounts');
        walk(field.selectionSet?.selections, visited);
      } else if (sel.kind === Kind.INLINE_FRAGMENT) {
        walk(sel.selectionSet?.selections, visited);
      } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
        const name = sel.name.value;
        const frag = fragments.get(name);
        if (!frag) {
          bad ??= `unknown fragment spread: ${name}`;
        } else if (!visited.has(name)) {
          visited.add(name);
          walk(frag.selectionSet.selections, visited);
        }
      }
    }
  };
  for (const def of doc.definitions) {
    if (def.kind === Kind.OPERATION_DEFINITION) walk(def.selectionSet.selections, new Set());
  }

  if (bad) return { ok: false, error: bad };
  if (matched === 0) return { ok: false, error: 'query must scope to viewer.zones(filter:{zoneTag}) or viewer.accounts(filter:{accountTag})' };
  return { ok: true };
}
