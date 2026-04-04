import api from './client';
import type { MediaItem, PaginatedResult, UploadRequestResponse } from '../types/media';

// Force download by fetching blob data and creating object URL
// This bypasses cross-origin <a download> limitation
async function forceDownload(url: string, fileName: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

export const mediaApi = {
  browse: async (page = 1, pageSize = 50, type?: number, from?: string, to?: string, sort?: string) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (type !== undefined) params.set('type', String(type));
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (sort) params.set('sort', sort);
    const { data } = await api.get<PaginatedResult<MediaItem>>(`/api/media?${params}`);
    return data;
  },

  requestUpload: async (fileName: string, contentType: string, sizeBytes: number) => {
    const { data } = await api.post<UploadRequestResponse>('/api/media/upload/request', {
      fileName, contentType, sizeBytes,
    });
    return data;
  },

  completeUpload: async (mediaId: string) => {
    const { data } = await api.post('/api/media/upload/complete', { mediaId });
    return data;
  },

  download: async (id: string) => {
    const { data } = await api.get<{ downloadUrl: string; fileName: string }>(`/api/media/${id}/download`);
    await forceDownload(data.downloadUrl, data.fileName);
  },

  deleteMedia: async (id: string) => {
    await api.delete(`/api/media/${id}`);
  },

  deleteBatch: async (ids: string[]) => {
    await api.post('/api/media/delete-batch', { mediaIds: ids });
  },

  downloadBatch: async (ids: string[]) => {
    const { data } = await api.post<{ downloadUrl: string; fileName: string }>(
      '/api/media/download-batch', { mediaIds: ids }
    );
    await forceDownload(data.downloadUrl, data.fileName);
  },

  resetAll: async () => {
    await api.post('/api/admin/reset');
  },
};

export const shareApi = {
  create: async (mediaId?: string, albumId?: string, expiryHours = 72) => {
    const { data } = await api.post<{ token: string }>('/api/share', { mediaId, albumId, expiryHours });
    return data;
  },
  getByToken: async (token: string) => {
    const { data } = await api.get(`/api/share/${token}`);
    return data as {
      type: string;
      albumId?: string;
      mediaId?: string;
      expiresAt: string;
      media?: any;
      album?: any;
    };
  },
};
