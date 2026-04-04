export interface MediaItem {
  id: string;
  fileName: string;
  mediaType: number; // 0=Photo, 1=Video
  contentType: string;
  fileSizeBytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  capturedAt?: string;
  uploadedAt: string;
  processingStatus: number; // 0=Uploading,1=Pending,2=Processing,3=Transcoding,4=Complete,5=Failed
  thumbnailUrl?: string;
  playbackUrl?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

export interface UploadRequestResponse {
  mediaId: string;
  uploadUrl: string;
  blobPath: string;
}

export interface Album {
  id: string;
  name: string;
  description?: string;
  coverThumbnailUrl?: string;
  mediaCount: number;
  isHidden: boolean;
  isPasswordProtected: boolean;
  createdAt: string;
}
