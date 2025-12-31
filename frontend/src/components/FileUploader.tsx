import { useState, useCallback, useRef } from 'react';
import { getSupportedFilenames, isSupportedFile, parseFile } from '../lib/parsers';
import type { ParserResult } from '../types/package';

interface FileUploaderProps {
  onFilesParsed: (results: ParserResult[]) => void;
  disabled?: boolean;
}

export function FileUploader({ onFilesParsed, disabled = false }: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      setError(null);
      const results: ParserResult[] = [];

      for (const file of Array.from(files)) {
        if (!isSupportedFile(file.name)) {
          setError(
            `Unsupported file: ${file.name}. Supported: ${getSupportedFilenames().join(', ')}`
          );
          continue;
        }

        try {
          const content = await file.text();
          const result = parseFile(file.name, content);
          results.push(result);
        } catch (e) {
          setError(`Failed to read ${file.name}: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }

      if (results.length > 0) {
        onFilesParsed(results);
      }
    },
    [onFilesParsed]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const files = e.dataTransfer.files;
      handleFiles(files);
    },
    [disabled, handleFiles]
  );

  const handleClick = useCallback(() => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  }, [disabled]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset input so same file can be selected again
      e.target.value = '';
    },
    [handleFiles]
  );

  const supportedFiles = getSupportedFilenames();

  return (
    <div className="file-uploader">
      <div
        className={`upload-zone ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleClick();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleInputChange}
          multiple
          style={{ display: 'none' }}
        />

        <div className="upload-icon">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17,8 12,3 7,8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>

        <div className="upload-text">
          <p className="upload-primary">
            {isDragging ? 'Drop files here' : 'Drop dependency files here'}
          </p>
          <p className="upload-secondary">or click to browse</p>
        </div>

        <div className="supported-files">
          <p>Supported files:</p>
          <div className="file-tags">
            {supportedFiles.map((file) => (
              <span key={file} className="file-tag">
                {file}
              </span>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="upload-error">
          <span className="error-icon">!</span>
          {error}
        </div>
      )}

      <div className="privacy-notice">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>Files are processed locally in your browser. Nothing is uploaded to any server.</span>
      </div>
    </div>
  );
}
