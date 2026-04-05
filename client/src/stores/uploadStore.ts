import { create } from 'zustand';
import { mediaApi } from '../api/mediaApi';

const EXTENSION_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
};

function inferContentType(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  return EXTENSION_MIME[ext] || 'application/octet-stream';
}

export type UploadStatus = 'queued' | 'requesting' | 'uploading' | 'completing' | 'done' | 'error';

export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: UploadStatus;
  mediaId?: string;
  error?: string;
  folderGroup?: string;
}

interface FolderAlbumAssignment {
  type: 'new' | 'existing';
  existingAlbumId?: string;
  existingAlbumName?: string;
}

interface UploadBatch {
  id: string;
  totalFiles: number;
  folderGroups?: Map<string, File[]>;
  folderAssignments?: Map<string, FolderAlbumAssignment>;
  resolve?: (folderMediaMap: Map<string, string[]>) => void;
}

const MAX_CONCURRENT = 12;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;
const BATCH_SAS_SIZE = 100; // Request SAS URLs in batches of 100
const PROGRESS_THROTTLE_MS = 500;
const COMPLETE_FLUSH_INTERVAL = 2000; // Flush complete queue every 2 seconds
const COMPLETE_BATCH_SIZE = 20; // Max items per complete-batch call

// --- Summary counters (derived outside Zustand to avoid re-renders per file) ---
interface UploadSummary {
  total: number;
  done: number;
  error: number;
  uploading: number;
  queued: number;
}

interface UploadStore {
  // We store items in a Map for O(1) lookups instead of scanning 10K arrays
  _itemMap: Map<string, UploadItem>;
  _itemOrder: string[]; // ordered ids for display
  batches: UploadBatch[];
  isUploading: boolean;
  summary: UploadSummary;

  // Public selectors
  getVisibleItems: (offset: number, limit: number) => UploadItem[];
  uploads: UploadItem[]; // kept for backward compat with TaskPanel — returns summary only

  startUpload: (
    files: File[],
    folderGroups?: Map<string, File[]>,
    folderAssignments?: Map<string, FolderAlbumAssignment>,
    onComplete?: () => void,
    onFileComplete?: (mediaId: string, folderGroup?: string) => void
  ) => Promise<Map<string, string[]>>;
  retryUpload: (uploadId: string) => void;
  retryAllFailed: () => void;
  clearCompleted: () => void;
  clearAll: () => void;

  // Internal
  _processQueue: () => void;
  _onCompleteCallbacks: Map<string, () => void>;
  _onFileCompleteCallbacks: Map<string, (mediaId: string, folderGroup?: string) => void>;
  _progressTimers: Map<string, number>; // last progress update timestamp per id
}

export const useUploadStore = create<UploadStore>((set, get) => {

  // --- Batched completion queue ---
  // Instead of calling completeUpload per file, queue mediaIds and flush in batches
  const completeQueue: { mediaId: string; itemId: string }[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let isFlushing = false; // Guard against concurrent flushes

  const flushCompleteQueue = async () => {
    if (isFlushing || completeQueue.length === 0) return;
    isFlushing = true;
    try {
      // Take a snapshot but DON'T remove from queue yet — only remove after confirmed
      const batch = completeQueue.slice(0, COMPLETE_BATCH_SIZE);
      const mediaIds = batch.map(b => b.mediaId);

      const confirmed: Set<string> = new Set();
      try {
        const results = await mediaApi.completeUploadBatch(mediaIds);
        // Only confirm items the server actually completed (response contains succeeded mediaIds)
        const succeededIds = new Set(
          Array.isArray(results) ? results.map((r: any) => String(r.mediaId)) : []
        );
        for (const b of batch) {
          if (succeededIds.has(b.mediaId)) confirmed.add(b.itemId);
        }
      } catch {
        // Batch failed — fall back to individual calls, track each result
        for (const { mediaId, itemId } of batch) {
          try {
            await mediaApi.completeUpload(mediaId);
            confirmed.add(itemId);
          } catch {
            // This item genuinely failed — leave in queue for retry
          }
        }
      }

      // Remove only confirmed items from the queue
      for (let i = completeQueue.length - 1; i >= 0; i--) {
        if (confirmed.has(completeQueue[i].itemId)) {
          completeQueue.splice(i, 1);
        }
      }

      // Mark confirmed items as done
      for (const { mediaId, itemId } of batch) {
        if (!confirmed.has(itemId)) continue;
        updateItem(itemId, { status: 'done', mediaId });
        for (const [, cb] of get()._onFileCompleteCallbacks) {
          const item = get()._itemMap.get(itemId);
          try { cb(mediaId, item?.folderGroup); } catch { }
        }
      }

      // Retry remaining items in queue
      if (completeQueue.length > 0) scheduleFlush();
    } finally {
      isFlushing = false;
    }
  };

  const scheduleFlush = () => {
    if (flushTimer) return; // already scheduled
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushCompleteQueue().then(() => {
        // After flushing, process queue and check batches
        get()._processQueue();
        for (const batch of get().batches) checkBatchComplete(batch.id);
        const s = get().summary;
        if (s.queued === 0 && s.uploading === 0) set({ isUploading: false });
      });
    }, COMPLETE_FLUSH_INTERVAL);
  };

  const queueComplete = (mediaId: string, itemId: string) => {
    updateItem(itemId, { status: 'completing', progress: 100 });
    completeQueue.push({ mediaId, itemId });
    // Flush immediately if batch is full
    if (completeQueue.length >= COMPLETE_BATCH_SIZE) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flushCompleteQueue().then(() => {
        get()._processQueue();
        for (const batch of get().batches) checkBatchComplete(batch.id);
        const s = get().summary;
        if (s.queued === 0 && s.uploading === 0) set({ isUploading: false });
      });
    } else {
      scheduleFlush();
    }
  };

  // Efficient update: mutate the map entry and refresh summary (hoisted for use in flush queue)
  function updateItem(id: string, update: Partial<UploadItem>) {
    const state = get();
    const item = state._itemMap.get(id);
    if (!item) return;

    const oldStatus = item.status;
    Object.assign(item, update);
    const newStatus = item.status;

    if (oldStatus !== newStatus) {
      const summary = { ...state.summary };
      if (oldStatus === 'queued') summary.queued--;
      else if (oldStatus === 'uploading' || oldStatus === 'requesting' || oldStatus === 'completing') summary.uploading--;
      else if (oldStatus === 'done') summary.done--;
      else if (oldStatus === 'error') summary.error--;

      if (newStatus === 'queued') summary.queued++;
      else if (newStatus === 'uploading' || newStatus === 'requesting' || newStatus === 'completing') summary.uploading++;
      else if (newStatus === 'done') summary.done++;
      else if (newStatus === 'error') summary.error++;

      set({ summary });
    }
  }

  // Throttled progress update — avoids hammering Zustand at 60fps per file
  const updateProgress = (id: string, progress: number) => {
    const state = get();
    const item = state._itemMap.get(id);
    if (!item) return;
    const now = Date.now();
    const last = state._progressTimers.get(id) || 0;
    if (progress < 100 && now - last < PROGRESS_THROTTLE_MS) {
      item.progress = progress; // silent update (no re-render)
      return;
    }
    state._progressTimers.set(id, now);
    item.progress = progress;
    // Trigger minimal re-render for visible progress
    set({});
  };

  const uploadToBlob = async (sasUrl: string, file: File, uploadId: string, attempt = 0): Promise<void> => {
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', sasUrl);
        xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
        xhr.setRequestHeader('Content-Type', inferContentType(file));

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            updateProgress(uploadId, Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(file);
      });
    } catch (err: any) {
      const status = parseInt(err.message?.replace('HTTP ', ''));
      if ((status === 429 || status === 503 || isNaN(status)) && attempt < MAX_RETRIES) {
        const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), 30000);
        const jitter = delay * (0.75 + Math.random() * 0.5);
        await new Promise(r => setTimeout(r, jitter));
        return uploadToBlob(sasUrl, file, uploadId, attempt + 1);
      }
      throw err;
    }
  };

  const uploadFile = async (item: UploadItem, attempt = 0) => {
    try {
      updateItem(item.id, { status: 'requesting', progress: 0 });

      // Try batch SAS if available, fall back to single
      let mediaId: string;
      let uploadUrl: string;

      const resp = await mediaApi.requestUpload(item.file.name, inferContentType(item.file), item.file.size);
      mediaId = resp.mediaId;
      uploadUrl = resp.uploadUrl;

      updateItem(item.id, { mediaId, status: 'uploading' });

      await uploadToBlob(uploadUrl, item.file, item.id);

      // Queue completion instead of awaiting — batched for speed
      queueComplete(mediaId, item.id);
    } catch (err: any) {
      if (attempt < MAX_RETRIES) {
        const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), 30000);
        updateItem(item.id, { status: 'uploading', progress: 0, error: `Retry ${attempt + 1}/${MAX_RETRIES}...` });
        await new Promise(r => setTimeout(r, delay));
        return uploadFile(item, attempt + 1);
      }
      updateItem(item.id, { status: 'error', error: err.message || 'Upload failed' });
    }
  };

  // Pre-request SAS URLs in batches to reduce round-trips
  const prefetchSasUrls = async (items: UploadItem[]): Promise<Map<string, { mediaId: string; uploadUrl: string }>> => {
    const results = new Map<string, { mediaId: string; uploadUrl: string }>();

    // Process in batches
    for (let i = 0; i < items.length; i += BATCH_SAS_SIZE) {
      const batch = items.slice(i, i + BATCH_SAS_SIZE);
      const requests = batch.map(item => ({
        fileName: item.file.name,
        contentType: inferContentType(item.file),
        sizeBytes: item.file.size,
      }));

      try {
        const responses = await mediaApi.requestUploadBatch(requests);
        for (let j = 0; j < batch.length && j < responses.length; j++) {
          results.set(batch[j].id, responses[j]);
        }
      } catch {
        // Batch endpoint not available — fall back to individual requests
        return results;
      }
    }
    return results;
  };

  // Using function declaration (hoisted) so flushCompleteQueue can reference it
  function checkBatchComplete(batchId: string) {
    const state = get();
    const batch = state.batches.find(b => b.id === batchId);
    if (!batch) return;

    const batchUploads: UploadItem[] = [];
    if (batch.folderGroups) {
      for (const files of batch.folderGroups.values()) {
        for (const file of files) {
          for (const item of state._itemMap.values()) {
            if (item.file === file) { batchUploads.push(item); break; }
          }
        }
      }
    }

    const allFinished = batchUploads.length > 0 && batchUploads.every(u => u.status === 'done' || u.status === 'error');
    if (!allFinished) return;

    const folderMediaMap = new Map<string, string[]>();
    if (batch.folderGroups) {
      for (const [folder, files] of batch.folderGroups) {
        const mediaIds: string[] = [];
        for (const file of files) {
          for (const item of state._itemMap.values()) {
            if (item.file === file && item.status === 'done' && item.mediaId) {
              mediaIds.push(item.mediaId);
              break;
            }
          }
        }
        if (mediaIds.length > 0) folderMediaMap.set(folder, mediaIds);
      }
    }

    const callback = state._onCompleteCallbacks.get(batchId);
    if (callback) { callback(); state._onCompleteCallbacks.delete(batchId); }

    batch.resolve?.(folderMediaMap);

    set(state => ({ batches: state.batches.filter(b => b.id !== batchId) }));
  }

  // The prefetch cache: uploadItemId → { mediaId, uploadUrl }
  let sasCache = new Map<string, { mediaId: string; uploadUrl: string }>();

  const uploadFileWithCache = async (item: UploadItem, attempt = 0) => {
    const cached = sasCache.get(item.id);
    if (cached) {
      try {
        updateItem(item.id, { status: 'uploading', mediaId: cached.mediaId, progress: 0 });
        await uploadToBlob(cached.uploadUrl, item.file, item.id);
        queueComplete(cached.mediaId, item.id);
        return;
      } catch (err: any) {
        if (attempt < MAX_RETRIES) {
          const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), 30000);
          updateItem(item.id, { status: 'uploading', progress: 0, error: `Retry ${attempt + 1}/${MAX_RETRIES}...` });
          await new Promise(r => setTimeout(r, delay));
          return uploadFileWithCache(item, attempt + 1);
        }
        updateItem(item.id, { status: 'error', error: err.message || 'Upload failed' });
        return;
      }
    }
    // No cache hit — fall back to individual request
    return uploadFile(item, attempt);
  };

  return {
    _itemMap: new Map(),
    _itemOrder: [],
    batches: [],
    isUploading: false,
    summary: { total: 0, done: 0, error: 0, uploading: 0, queued: 0 },
    _onCompleteCallbacks: new Map(),
    _onFileCompleteCallbacks: new Map(),
    _progressTimers: new Map(),

    // For backward compat only — TaskPanel reads .uploads
    get uploads() {
      return [] as UploadItem[];
    },

    getVisibleItems: (offset: number, limit: number) => {
      const state = get();
      const slice = state._itemOrder.slice(offset, offset + limit);
      return slice.map(id => state._itemMap.get(id)!).filter(Boolean);
    },

    startUpload: (files, folderGroups, _folderAssignments, onComplete, onFileComplete) => {
      const batchId = crypto.randomUUID();

      const fileFolderLookup = new Map<File, string>();
      if (folderGroups) {
        for (const [folder, groupFiles] of folderGroups) {
          for (const f of groupFiles) fileFolderLookup.set(f, folder);
        }
      }

      const newItems: UploadItem[] = files.map(file => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: 'queued' as const,
        folderGroup: fileFolderLookup.get(file),
      }));

      return new Promise<Map<string, string[]>>((resolve) => {
        const batch: UploadBatch = { id: batchId, totalFiles: files.length, folderGroups, resolve };
        if (onComplete) get()._onCompleteCallbacks.set(batchId, onComplete);
        if (onFileComplete) get()._onFileCompleteCallbacks.set(batchId, onFileComplete);

        const state = get();
        const newMap = new Map(state._itemMap);
        const newOrder = [...state._itemOrder];
        for (const item of newItems) {
          newMap.set(item.id, item);
          newOrder.push(item.id);
        }

        sasCache = new Map();

        set({
          _itemMap: newMap,
          _itemOrder: newOrder,
          batches: [...state.batches, batch],
          isUploading: true,
          summary: {
            total: state.summary.total + newItems.length,
            done: state.summary.done,
            error: state.summary.error,
            uploading: state.summary.uploading,
            queued: state.summary.queued + newItems.length,
          },
        });

        // Prefetch SAS URLs then start processing — NOT before, to avoid
        // creating duplicate MediaItems (prefetch + individual request race)
        prefetchSasUrls(newItems).then(cache => {
          sasCache = cache;
          get()._processQueue();
        }).catch(() => {
          // Prefetch failed — process without cache (individual requests)
          get()._processQueue();
        });
      });
    },

    _processQueue: () => {
      const state = get();
      let active = 0;
      for (const item of state._itemMap.values()) {
        if (item.status === 'uploading' || item.status === 'completing' || item.status === 'requesting') active++;
      }

      const queued: UploadItem[] = [];
      for (const id of state._itemOrder) {
        if (active >= MAX_CONCURRENT) break;
        const item = state._itemMap.get(id);
        if (item && item.status === 'queued') {
          queued.push(item);
          active++;
        }
      }

      // Mark as 'requesting' synchronously BEFORE async upload to prevent
      // double-dispatch when _processQueue is called again before upload starts
      for (const item of queued) {
        updateItem(item.id, { status: 'requesting' });
      }

      for (const item of queued) {
        uploadFileWithCache(item).then(() => {
          get()._processQueue();
          for (const batch of get().batches) checkBatchComplete(batch.id);

          // Check if all done
          const s = get().summary;
          if (s.queued === 0 && s.uploading === 0) {
            set({ isUploading: false });
          }
        });
      }
    },

    retryUpload: (uploadId) => {
      const item = get()._itemMap.get(uploadId);
      if (!item || item.status !== 'error') return;
      updateItem(uploadId, { status: 'queued', progress: 0, error: undefined });
      set({ isUploading: true });
      get()._processQueue();
    },

    retryAllFailed: () => {
      let count = 0;
      for (const item of get()._itemMap.values()) {
        if (item.status === 'error') {
          updateItem(item.id, { status: 'queued', progress: 0, error: undefined });
          count++;
        }
      }
      if (count > 0) { set({ isUploading: true }); get()._processQueue(); }
    },

    clearCompleted: () => {
      const state = get();
      const newMap = new Map(state._itemMap);
      const newOrder: string[] = [];
      let removedDone = 0;
      for (const id of state._itemOrder) {
        const item = newMap.get(id);
        if (item && item.status === 'done') {
          newMap.delete(id);
          removedDone++;
        } else {
          newOrder.push(id);
        }
      }
      set({
        _itemMap: newMap,
        _itemOrder: newOrder,
        summary: { ...state.summary, total: state.summary.total - removedDone, done: 0 },
      });
    },

    clearAll: () => {
      set({
        _itemMap: new Map(),
        _itemOrder: [],
        batches: [],
        isUploading: false,
        summary: { total: 0, done: 0, error: 0, uploading: 0, queued: 0 },
      });
    },
  };
});
