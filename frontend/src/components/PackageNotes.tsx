import { useState, useCallback } from 'react';
import type { Ecosystem, ReviewStatus, PackageNote } from '../types/package';

interface PackageNotesProps {
  packageName: string;
  ecosystem: Ecosystem;
  note?: PackageNote;
  onSaveNote: (note: string) => void;
  onSetStatus: (status: ReviewStatus) => void;
  onDelete: () => void;
}

export function PackageNotes({
  packageName,
  ecosystem,
  note,
  onSaveNote,
  onSetStatus,
  onDelete,
}: PackageNotesProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(note?.note || '');

  const handleSave = useCallback(() => {
    onSaveNote(editText);
    setIsEditing(false);
  }, [editText, onSaveNote]);

  const handleCancel = useCallback(() => {
    setEditText(note?.note || '');
    setIsEditing(false);
  }, [note]);

  const getStatusIcon = (status: ReviewStatus): string => {
    switch (status) {
      case 'reviewed':
        return '✓';
      case 'approved':
        return '✓✓';
      case 'flagged':
        return '⚑';
      default:
        return '○';
    }
  };

  return (
    <div className="package-notes">
      <div className="notes-header">
        <h4>Notes for {packageName}</h4>
        <span className="ecosystem-tag">{ecosystem}</span>
      </div>

      <div className="review-status-section">
        <span className="status-label">Review Status:</span>
        <div className="status-buttons">
          <button
            className={`status-btn ${note?.reviewStatus === 'not_reviewed' || !note ? 'active' : ''}`}
            onClick={() => onSetStatus('not_reviewed')}
            title="Mark as not reviewed"
          >
            <span className="status-icon">{getStatusIcon('not_reviewed')}</span>
            Not Reviewed
          </button>
          <button
            className={`status-btn reviewed ${note?.reviewStatus === 'reviewed' ? 'active' : ''}`}
            onClick={() => onSetStatus('reviewed')}
            title="Mark as reviewed"
          >
            <span className="status-icon">{getStatusIcon('reviewed')}</span>
            Reviewed
          </button>
          <button
            className={`status-btn approved ${note?.reviewStatus === 'approved' ? 'active' : ''}`}
            onClick={() => onSetStatus('approved')}
            title="Mark as approved"
          >
            <span className="status-icon">{getStatusIcon('approved')}</span>
            Approved
          </button>
          <button
            className={`status-btn flagged ${note?.reviewStatus === 'flagged' ? 'active' : ''}`}
            onClick={() => onSetStatus('flagged')}
            title="Flag for attention"
          >
            <span className="status-icon">{getStatusIcon('flagged')}</span>
            Flagged
          </button>
        </div>
      </div>

      <div className="notes-content">
        {isEditing ? (
          <div className="notes-editor">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              placeholder="Add notes about this package (e.g., why it was approved, alternatives considered, etc.)"
              rows={4}
              autoFocus
            />
            <div className="editor-actions">
              <button className="btn-save" onClick={handleSave}>
                Save
              </button>
              <button className="btn-cancel" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="notes-display">
            {note?.note ? (
              <>
                <p className="note-text">{note.note}</p>
                <div className="note-meta">
                  {note.updatedAt && (
                    <span className="note-updated">
                      Updated {new Date(note.updatedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="no-notes">No notes yet</p>
            )}
            <button className="btn-edit" onClick={() => setIsEditing(true)}>
              {note?.note ? 'Edit Note' : 'Add Note'}
            </button>
          </div>
        )}
      </div>

      {note && (note.note || note.reviewStatus !== 'not_reviewed') && (
        <div className="notes-footer">
          <button className="btn-delete" onClick={onDelete}>
            Clear Note & Status
          </button>
        </div>
      )}
    </div>
  );
}

// Compact inline version for use in table rows
interface PackageReviewBadgeProps {
  reviewStatus?: ReviewStatus;
  hasNote?: boolean;
  onClick: () => void;
}

export function PackageReviewBadge({ reviewStatus, hasNote, onClick }: PackageReviewBadgeProps) {
  if (!reviewStatus || (reviewStatus === 'not_reviewed' && !hasNote)) {
    return (
      <button className="review-badge not-reviewed" onClick={onClick} title="Add review">
        <span className="badge-icon">○</span>
      </button>
    );
  }

  const getClass = () => {
    switch (reviewStatus) {
      case 'approved':
        return 'approved';
      case 'reviewed':
        return 'reviewed';
      case 'flagged':
        return 'flagged';
      default:
        return hasNote ? 'has-note' : 'not-reviewed';
    }
  };

  const getIcon = () => {
    switch (reviewStatus) {
      case 'approved':
        return '✓✓';
      case 'reviewed':
        return '✓';
      case 'flagged':
        return '⚑';
      default:
        return hasNote ? '📝' : '○';
    }
  };

  return (
    <button
      className={`review-badge ${getClass()}`}
      onClick={onClick}
      title={`${reviewStatus}${hasNote ? ' (has notes)' : ''}`}
    >
      <span className="badge-icon">{getIcon()}</span>
    </button>
  );
}

// Filter component for reviewed/not reviewed
interface ReviewFilterProps {
  value: 'all' | 'reviewed' | 'not_reviewed' | 'flagged';
  onChange: (value: 'all' | 'reviewed' | 'not_reviewed' | 'flagged') => void;
}

export function ReviewFilter({ value, onChange }: ReviewFilterProps) {
  return (
    <div className="review-filter">
      <label>Review Status:</label>
      <select value={value} onChange={(e) => onChange(e.target.value as ReviewFilterProps['value'])}>
        <option value="all">All</option>
        <option value="reviewed">Reviewed</option>
        <option value="not_reviewed">Not Reviewed</option>
        <option value="flagged">Flagged</option>
      </select>
    </div>
  );
}
