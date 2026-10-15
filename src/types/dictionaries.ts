export type DictionaryStatus = 'available' | 'installing' | 'ready' | 'error';

/** 词典列表项：目录内置条目与数据库记录合并后的视图。 */
export interface DictionarySummary {
  id: string;
  name: string;
  description: string;
  language: string;
  license: string;
  attribution: string;
  homepage: string;
  /** 随应用内置、不可移除的词典。 */
  builtin: boolean;
  enabled: boolean;
  status: DictionaryStatus;
  error: string;
  /** 已导入的词条数。 */
  entryCount: number;
  /** 预计词条数；0 表示未知。 */
  totalEntries: number;
  /** 源文件字节数；0 表示未知。 */
  totalBytes: number;
  downloadedBytes: number;
  installedAt: string | null;
  updatedAt: string | null;
}

export interface DictionaryEntryValue {
  meanings: string[];
  phonetic?: string;
}

export type DictionaryLookupResult =
  | { status: 'found'; entry: DictionaryEntryValue; dictionaryId: string }
  | { status: 'not_found' | 'unconfigured' | 'error' };
