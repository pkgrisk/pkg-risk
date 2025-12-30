import type { Scores } from '../types/package';

interface MiniScoreBarsProps {
  scores: Scores;
}

interface ScoreData {
  label: string;
  abbr: string;
  score: number;
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#84cc16';
  if (score >= 40) return '#eab308';
  if (score >= 20) return '#f97316';
  return '#dc2626';
}

export function MiniScoreBars({ scores }: MiniScoreBarsProps) {
  const scoreData: ScoreData[] = [
    { label: 'Security', abbr: 'Sec', score: scores.security.score },
    { label: 'Maintenance', abbr: 'Mnt', score: scores.maintenance.score },
    { label: 'Community', abbr: 'Com', score: scores.community.score },
    { label: 'Bus Factor', abbr: 'Bus', score: scores.bus_factor.score },
    { label: 'Documentation', abbr: 'Doc', score: scores.documentation.score },
    { label: 'Stability', abbr: 'Stb', score: scores.stability.score },
  ];

  return (
    <div className="mini-score-bars">
      {scoreData.map(({ label, abbr, score }) => (
        <div key={abbr} className="mini-score-item" title={`${label}: ${score.toFixed(0)}/100`}>
          <span className="mini-score-label">{abbr}:</span>
          <div className="mini-bar-container">
            <div
              className="mini-bar-fill"
              style={{
                width: `${score}%`,
                backgroundColor: getScoreColor(score),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default MiniScoreBars;
