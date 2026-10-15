/**
 * 内置词典目录：只收录授权明确、格式能被服务端直接解析（无需解压）的数据源。
 *
 * 收录标准：
 * - 许可证允许下载、转换与再分发，且能在界面上正确署名；
 * - 源文件是纯文本或 JSON（Node 原生只能解 gzip，不能解 xz / zip / 7z）；
 * - 有稳定直链，尽量给出多个镜像按顺序回退。
 *
 * 因此 CC-CEDICT（中→英，方向不符）、FreeDict / WikDict（只有 tar.xz、zip）、
 * StarDict 镜像（多数为商业词典的无授权转载）都没有进入目录。
 */
export interface DictionarySource {
  url: string;
  /** 有校验值时下载后会比对，不匹配则拒绝导入。 */
  sha256?: string;
  bytes?: number;
}

export interface DictionaryManifestEntry {
  id: string;
  name: string;
  description: string;
  language: string;
  license: string;
  attribution: string;
  homepage: string;
  format: 'ecdict-csv';
  /** 解析过滤后可入库的词条数（实测值，仅用于界面预估）。 */
  totalEntries: number;
  /** 源文件字节数（实测值，仅用于界面预估）。 */
  totalBytes: number;
  sources: readonly DictionarySource[];
}

export const DICTIONARY_MANIFEST: readonly DictionaryManifestEntry[] = [
  {
    id: 'ecdict-full',
    name: 'ECDICT 完整版',
    description:
      '76.9 万条英汉词条，含生僻词、专有名词和词形变化，覆盖最全；下载约 63 MB，导入后占用数据库约 120 MB。',
    language: 'en-zh',
    license: 'MIT',
    attribution: 'ECDICT · Copyright (c) 2025 Linwei · MIT License',
    homepage: 'https://github.com/skywind3000/ECDICT',
    format: 'ecdict-csv',
    totalEntries: 768_739,
    totalBytes: 65_936_699,
    sources: [
      {
        // unpkg 直接提供 npm 包内的 CSV，版本固定，国内可访问。
        url: 'https://unpkg.com/ecdict@0.0.4/assets/ecdict.csv',
        sha256: 'd0ce61e560b50d9905d20de3173aa3ca80950ce235bedd21c53e025cf9f38cb0',
        bytes: 65_936_699,
      },
      {
        // 固定到具体 commit，避免上游改动导致同一链接产出不同数据。
        url: 'https://raw.githubusercontent.com/skywind3000/ECDICT/82c9872576b23118d7c42e920c11beb77f510ae2/ecdict.csv',
        bytes: 65_933_428,
      },
    ],
  },
];

export function findManifestEntry(id: string): DictionaryManifestEntry | null {
  return DICTIONARY_MANIFEST.find((entry) => entry.id === id) ?? null;
}

/** 自定义导入链接的字典 id：同一链接始终得到同一个 id，重复导入会覆盖。 */
export function buildCustomDictionaryId(sourceUrl: string): string {
  let hash = 0n;
  for (const char of sourceUrl) {
    hash = (hash * 131n + BigInt(char.codePointAt(0) ?? 0)) % 0xffffffffffffffn;
  }
  return `custom-${hash.toString(16).padStart(14, '0')}`;
}
