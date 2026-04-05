import { useState, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUpload } from '../../hooks/useUpload';
import { useQueryClient } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.mp4', '.mov', '.m4v', '.flv']);

interface Props {
  children: ReactNode;
}

export function GlobalDropZone({ children }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { startUpload } = useUpload(() => queryClient.invalidateQueries({ queryKey: ['media'] }));

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => {
      if (f.type.startsWith('image/') || f.type.startsWith('video/')) return true;
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return SUPPORTED_EXTENSIONS.has(ext);
    });
    if (files.length > 0) {
      startUpload(files);
      navigate('/upload');
    }
  }, [startUpload, navigate]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative"
    >
      {children}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-blue-600/20 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="bg-zinc-900 border-2 border-blue-500 border-dashed rounded-2xl px-12 py-8 text-center">
            <FolderOpen size={40} className="mb-3 mx-auto" style={{ color: 'var(--accent)' }} />
            <p className="text-xl font-bold text-white">Drop to upload</p>
            <p className="text-sm text-zinc-400 mt-1">Photos and videos</p>
          </div>
        </div>
      )}
    </div>
  );
}
