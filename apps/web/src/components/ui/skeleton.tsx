export function Skeleton({ rows = 3, variant = 'list' }: { rows?: number; variant?: 'list' | 'grid' }) {
  if (variant === 'grid') {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-card border border-edge bg-surface"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-card border border-edge bg-surface"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}
