import api from './client';
import type { Album, MediaItem } from '../types/media';

export interface AlbumDetail {
  album: Album;
  media: MediaItem[];
}

export const albumApi = {
  getAll: async () => {
    const { data } = await api.get<Album[]>('/api/album');
    return data;
  },

  getById: async (albumId: string) => {
    const { data } = await api.get<AlbumDetail>(`/api/album/${albumId}`);
    return data;
  },

  create: async (name: string, description?: string) => {
    const { data } = await api.post<Album>('/api/album', { name, description });
    return data;
  },

  deleteAlbum: async (albumId: string, deleteMedia: boolean) => {
    await api.delete(`/api/album/${albumId}?deleteMedia=${deleteMedia}`);
  },

  addMedia: async (albumId: string, mediaIds: string[]) => {
    await api.post(`/api/album/${albumId}/media`, { mediaIds });
  },

  removeMedia: async (albumId: string, mediaId: string) => {
    await api.delete(`/api/album/${albumId}/media/${mediaId}`);
  },

  toggleHidden: async (albumId: string) => {
    const { data } = await api.patch<{ isHidden: boolean }>(`/api/album/${albumId}/hidden`);
    return data;
  },
};
