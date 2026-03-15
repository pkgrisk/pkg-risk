import type { Ecosystem } from '../types/package';

const COMPAT_MAP: Record<Ecosystem, string[]> = {
  npm: ['npm', 'yarn', 'pnpm', 'bun'],
  pypi: ['pip', 'poetry', 'pdm', 'uv'],
  homebrew: ['brew'],
};

interface PackageManagerCompatProps {
  ecosystem: Ecosystem;
}

export function PackageManagerCompat({ ecosystem }: PackageManagerCompatProps) {
  const managers = COMPAT_MAP[ecosystem];

  if (!managers || managers.length <= 1) return null;

  return (
    <span className="package-manager-compat">
      {managers.map((pm) => (
        <span key={pm} className="pm-badge">
          {pm}
        </span>
      ))}
    </span>
  );
}
