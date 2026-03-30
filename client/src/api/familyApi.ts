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
  resetAll: async () => {
    await api.post('/api/admin/reset');
  },
  reprocess: async () => {
    const { data } = await api.post('/api/admin/reprocess');
    return data as { message: string };
  },
};
