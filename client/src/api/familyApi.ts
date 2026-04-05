import api from './client';

export interface FamilyDto {
  id: string;
  name: string;
  inviteCode?: string;
  memberCount: number;
  mediaCount: number;
  storageUsedBytes: number;
  quotaBytes: number;
  role: string;
  createdAt: string;
}

export interface StorageUsageDto {
  usedBytes: number;
  quotaBytes: number;
  usedPercent: number;
  usedFormatted: string;
  quotaFormatted: string;
}

export const familyApi = {
  getMyFamilies: async () => {
    const { data } = await api.get<FamilyDto[]>('/api/family');
    return data;
  },
  create: async (name: string) => {
    const { data } = await api.post<FamilyDto>('/api/family', { name });
    return data;
  },
  join: async (inviteCode: string) => {
    const { data } = await api.post<{ familyName: string }>('/api/family/join', { inviteCode });
    return data;
  },
  shareMedia: async (familyId: string, mediaIds: string[]) => {
    await api.post(`/api/family/${familyId}/share`, { mediaIds });
  },
  unshareMedia: async (familyId: string, mediaId: string) => {
    await api.delete(`/api/family/${familyId}/media/${mediaId}`);
  },
  getFamilyMedia: async (familyId: string, page = 1, pageSize = 50) => {
    const { data } = await api.get(`/api/family/${familyId}/media?page=${page}&pageSize=${pageSize}`);
    return data;
  },
  removeMember: async (familyId: string, userId: string) => {
    await api.delete(`/api/family/${familyId}/members/${userId}`);
  },
  deleteFamily: async (familyId: string) => {
    await api.delete(`/api/family/${familyId}`);
  },
  regenerateInvite: async (familyId: string, expiryDays = 30) => {
    const { data } = await api.post<{ inviteCode: string }>(`/api/family/${familyId}/invite`, { expiryDays });
    return data;
  },
};

export const quotaApi = {
  getMyUsage: async () => {
    const { data } = await api.get<StorageUsageDto>('/api/quota');
    return data;
  },
  setUserQuota: async (userId: string, quotaBytes: number) => {
    await api.put(`/api/quota/users/${userId}/quota`, { quotaBytes });
  },
};

export const adminApi = {
  getUsers: async () => {
    const { data } = await api.get('/api/admin/users');
    return data as any[];
  },
  getStats: async () => {
    const { data } = await api.get('/api/admin/stats');
    return data as {
      queueDepth: number;
      total: number; complete: number; pending: number; processing: number;
      uploading: number; transcoding: number; failed: number;
      noThumbnail: number; inPipeline: number; softDeleted: number;
    };
  },
  resetAll: async () => {
    await api.post('/api/admin/reset');
  },
  reprocess: async () => {
    const { data } = await api.post('/api/admin/reprocess');
    return data as { message: string };
  },
  reprocessStuck: async () => {
    const { data } = await api.post('/api/admin/reprocess-stuck');
    return data as { message: string };
  },
  fixStuckStatus: async () => {
    const { data } = await api.post('/api/admin/fix-stuck-status');
    return data as { message: string };
  },
  triggerCleanup: async () => {
    const { data } = await api.post('/api/admin/trigger-cleanup');
    return data as { message: string };
  },
  resetProcessing: async () => {
    const { data } = await api.post('/api/admin/reset-processing');
    return data as { message: string };
  },
  purgeFailed: async () => {
    const { data } = await api.post('/api/admin/purge-failed');
    return data as { message: string };
  },
  getActivity: async () => {
    const { data } = await api.get('/api/admin/activity');
    return data as {
      id: string; fileName: string; status: string; contentType: string;
      hasThumbnail: boolean; hasPlayback: boolean; sizeMB: number; uploadedAt: string;
    }[];
  },
  getSoftDeleted: async () => {
    const { data } = await api.get('/api/admin/soft-deleted');
    return data as {
      id: string; fileName: string; contentType: string; status: string;
      sizeMB: number; hasThumbnail: boolean; hasPlayback: boolean;
      uploadedAt: string; deletedAt: string;
    }[];
  },
};
