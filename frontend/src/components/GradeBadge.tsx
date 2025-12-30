import type { Grade } from '../types/package';

interface GradeBadgeProps {
  grade: Grade;
  size?: 'sm' | 'md' | 'lg';
}

const gradeColors: Record<Grade, string> = {
  A: '#22c55e',
  B: '#84cc16',
  C: '#eab308',
  D: '#f97316',
  F: '#ef4444',
};

export function GradeBadge({ grade, size = 'md' }: GradeBadgeProps) {
  const sizeStyles = {
    sm: { width: '24px', height: '24px', fontSize: '12px' },
    md: { width: '36px', height: '36px', fontSize: '16px' },
    lg: { width: '48px', height: '48px', fontSize: '20px' },
  };

  return (
    <div
      style={{
        ...sizeStyles[size],
        backgroundColor: gradeColors[grade],
        color: 'white',
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
      }}
    >
      {grade}
    </div>
  );
}
