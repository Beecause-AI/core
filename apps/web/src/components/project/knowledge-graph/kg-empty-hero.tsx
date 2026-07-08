import { Button } from '../../ui/button';

const VALUE_PROPS = [
  { title: 'Code → business flows', body: 'See which files implement checkout, auth, billing — named automatically.' },
  { title: 'Blast radius', body: 'Understand what a change touches before it ships.' },
  { title: 'Faster root cause', body: 'Jump from a symptom to the code that owns it during incidents.' },
];

function GraphMotif() {
  return (
    <svg viewBox="0 0 240 120" aria-hidden className="h-28 w-full max-w-md text-accent">
      <g stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" fill="none">
        <path d="M60 60 L120 30 M60 60 L120 90 M120 30 L180 60 M120 90 L180 60" />
      </g>
      <g fill="currentColor">
        <circle cx="60" cy="60" r="7" />
        <circle cx="120" cy="30" r="5" fillOpacity="0.7" />
        <circle cx="120" cy="90" r="5" fillOpacity="0.7" />
        <circle cx="180" cy="60" r="9" />
      </g>
    </svg>
  );
}

export function KgEmptyHero({
  projectName,
  onBuild,
  building,
}: {
  projectName?: string;
  onBuild: () => void;
  building: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-6 rounded-card border border-edge bg-surface px-6 py-10 text-center">
      <GraphMotif />
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold tracking-tight text-fg">Build your Knowledge Graph</h3>
        <p className="max-w-md text-sm text-fg-muted">
          {projectName ? (
            <>A living map of <span className="font-mono text-fg">{projectName}</span> — its structure, dependencies, and the business flows your code implements.</>
          ) : (
            <>A living map of your project — its structure, dependencies, and the business flows your code implements.</>
          )}
        </p>
      </div>
      <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-3">
        {VALUE_PROPS.map((p) => (
          <div key={p.title} className="rounded-md border border-edge bg-raised p-3 text-left">
            <span className="text-sm font-medium text-fg">{p.title}</span>
            <span className="mt-1 block text-xs text-fg-faint">{p.body}</span>
          </div>
        ))}
      </div>
      <Button disabled={building} onClick={onBuild}>
        {building ? 'Starting…' : 'Build knowledge graph'}
      </Button>
    </div>
  );
}
