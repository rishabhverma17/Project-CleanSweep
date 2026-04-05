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

  rename: async (albumId: string, name: string, description?: string) => {
    const { data } = await api.put<Album>(`/api/album/${albumId}`, { name, description });
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

  toggleHidden: async (albumId: string, password?: string) => {
    const { data } = await api.patch<{ isHidden: boolean }>(`/api/album/${albumId}/hidden`, { password: password || null });
    return data;
  },

  setPassword: async (albumId: string, password: string | null) => {
    const { data } = await api.post<{ isPasswordProtected: boolean }>(`/api/album/${albumId}/password`, { password });
    return data;
  },

  unlock: async (albumId: string, password: string) => {
    const { data } = await api.post<{ unlocked: boolean }>(`/api/album/${albumId}/unlock`, { password });
    return data;
  },

  getByIdWithPassword: async (albumId: string, password?: string) => {
    const headers: Record<string, string> = {};
    if (password) headers['X-Album-Password'] = password;
    const { data } = await api.get<AlbumDetail>(`/api/album/${albumId}`, { headers });
    return data;
  },
};
