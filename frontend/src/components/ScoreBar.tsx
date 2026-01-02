interface ScoreBarProps {
  label: string;
  score: number;
  weight: number;
  showWeight?: boolean;
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#84cc16';
  if (score >= 40) return '#eab308';
  if (score >= 20) return '#f97316';
  return '#ef4444';
}

export function ScoreBar({ label, score, weight, showWeight = true }: ScoreBarProps) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
        <span style={{ fontSize: '14px', fontWeight: 500 }}>
          {label}
          {showWeight && <span style={{ color: '#555', fontSize: '11px', marginLeft: '6px' }}>({weight}%)</span>}
        </span>
        <span style={{ fontSize: '14px', fontWeight: 600 }}>{score.toFixed(1)}</span>
      </div>
      <div
        style={{
          height: '8px',
          backgroundColor: '#333',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${score}%`,
            height: '100%',
            backgroundColor: getScoreColor(score),
            borderRadius: '4px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}
