import { useQueryClient } from '@tanstack/react-query';
import { MediaUploader } from '../components/media/MediaUploader';

export function UploadPage() {
  const queryClient = useQueryClient();

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">Upload</h2>
      <MediaUploader onComplete={() => queryClient.invalidateQueries({ queryKey: ['media'] })} />
    </div>
  );
}
