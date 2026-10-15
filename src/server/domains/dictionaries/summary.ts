import type { DictionarySummary } from '@/types/dictionaries';
import type { DictionaryRecord } from './dictionariesRepo';
import type { DictionaryManifestEntry } from './manifest';
import {
  BUILTIN_DICTIONARY_DESCRIPTION,
  BUILTIN_DICTIONARY_ID,
  BUILTIN_DICTIONARY_NAME,
  type BuiltinDictionaryStats,
} from './builtinDictionary';

export function buildRecordSummary(record: DictionaryRecord): DictionarySummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    language: record.language,
    license: record.license,
    attribution: record.attribution,
    homepage: record.homepage,
    builtin: record.builtin,
    enabled: record.enabled,
    status: record.status,
    error: record.error,
    entryCount: record.entryCount,
    totalEntries: record.totalEntries,
    totalBytes: record.totalBytes,
    downloadedBytes: record.downloadedBytes,
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
  };
}

/** 目录里尚未安装的条目：只展示体积与授权信息，状态为「可下载」。 */
export function buildAvailableSummary(entry: DictionaryManifestEntry): DictionarySummary {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    language: entry.language,
    license: entry.license,
    attribution: entry.attribution,
    homepage: entry.homepage,
    builtin: false,
    enabled: false,
    status: 'available',
    error: '',
    entryCount: 0,
    totalEntries: entry.totalEntries,
    totalBytes: entry.totalBytes,
    downloadedBytes: 0,
    installedAt: null,
    updatedAt: null,
  };
}

export function buildBuiltinSummary(stats: BuiltinDictionaryStats): DictionarySummary {
  return {
    id: BUILTIN_DICTIONARY_ID,
    name: BUILTIN_DICTIONARY_NAME,
    description: BUILTIN_DICTIONARY_DESCRIPTION,
    language: 'en-zh',
    license: 'MIT',
    attribution: 'ECDICT · Copyright (c) 2025 Linwei · MIT License',
    homepage: 'https://github.com/skywind3000/ECDICT',
    builtin: true,
    enabled: true,
    status: 'ready',
    error: '',
    entryCount: stats.entryCount,
    totalEntries: stats.entryCount,
    totalBytes: stats.bytes,
    downloadedBytes: stats.bytes,
    installedAt: null,
    updatedAt: null,
  };
}
