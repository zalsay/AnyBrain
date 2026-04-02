import { invoke } from '@tauri-apps/api/core';
import type { Platform } from '../../types/app';

const STORAGE_KEY = 'ai-chaty-platforms';

export async function loadPlatformsAsync(): Promise<Platform[]> {
  try {
    const data: string = await invoke('load_platforms');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        invoke('save_platforms', { data: saved }).catch(() => {});
        return parsed;
      }
    }
  } catch {}

  return [];
}

export function savePlatformsToFile(platforms: Platform[]) {
  const data = JSON.stringify(platforms);
  invoke('save_platforms', { data }).catch(console.error);
  localStorage.setItem(STORAGE_KEY, data);
}

export function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function deriveNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, '') || '新标签';
  } catch {
    return '新标签';
  }
}
