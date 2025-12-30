interface WatchButtonProps {
  packageId: string;
  isWatched: boolean;
  onToggle: (packageId: string) => void;
  size?: 'sm' | 'md';
}

export function WatchButton({ packageId, isWatched, onToggle, size = 'md' }: WatchButtonProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onToggle(packageId);
  };

  return (
    <button
      className={`watch-button watch-button-${size} ${isWatched ? 'watched' : ''}`}
      onClick={handleClick}
      title={isWatched ? 'Remove from watch list' : 'Add to watch list'}
    >
      {isWatched ? '★' : '☆'}
    </button>
  );
}

export default WatchButton;
