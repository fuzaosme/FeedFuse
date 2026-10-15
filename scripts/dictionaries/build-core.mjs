#!/usr/bin/env node
/**
 * Build the checked-in "core" EN→ZH dictionary from ECDICT.
 *
 * Source data: ECDICT (https://github.com/skywind3000/ECDICT, MIT License,
 * Copyright (c) 2025 Linwei). The CSV columns are:
 *   word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
 *
 * Output shape (consumed by src/features/english-learning/utils/dictionary.ts):
 *   { "<normalized-term>": { "meanings": ["...", "..."], "phonetic": "..." } }
 *
 * Usage:
 *   node scripts/dictionaries/build-core.mjs [--csv <path-or-url>] [--out <path>] [--sha256 <hex>]
 *
 * The CSV may also be provided through the ECDICT_CSV environment variable
 * (a CLI --csv wins over it). Only node: builtins and global fetch are used.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';

const DEFAULT_CSV_URL = 'https://unpkg.com/ecdict@0.0.4/assets/ecdict.csv';
const DEFAULT_OUT = 'public/dictionaries/en-zh.json';

// ECDICT columns (0-based) that the filter/entry builder needs.
const COL_WORD = 0;
const COL_PHONETIC = 1;
const COL_TRANSLATION = 3;
const COL_TAG = 7;
const COL_FRQ = 9;

const MAX_FRQ = 30_000;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { csv: undefined, out: undefined, sha256: undefined, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue; // `pnpm run <script> -- <args>` forwards this
    switch (arg) {
      case '--csv':
        options.csv = argv[++i];
        break;
      case '--out':
        options.out = argv[++i];
        break;
      case '--sha256':
        options.sha256 = argv[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write(
    [
      'Build public/dictionaries/en-zh.json from the ECDICT CSV.',
      '',
      'Options:',
      `  --csv <path-or-url>   ECDICT CSV (default: ${DEFAULT_CSV_URL}, env: ECDICT_CSV)`,
      `  --out <path>          Output JSON (default: ${DEFAULT_OUT})`,
      '  --sha256 <hex>        Verify the input file digest before parsing (optional)',
      '  -h, --help            Show this help',
      '',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Normalization: copied verbatim in behavior from src/lib/englishLearning.ts
// (cleanVocabularyTerm + normalizeVocabularyTerm) so generated keys match the
// runtime lookup keys exactly.
// ---------------------------------------------------------------------------

function cleanVocabularyTerm(text) {
  return text.replace(/\s+/g, ' ').trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
}

function normalizeVocabularyTerm(text) {
  return cleanVocabularyTerm(text)
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/[\u2010-\u2014]/g, '-')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// RFC 4180 streaming CSV parser (state machine, UTF-8 boundary safe).
// Rows are handed to `onRow` and never accumulated.
// ---------------------------------------------------------------------------

function createCsvParser(onRow) {
  let field = '';
  let row = [];
  let inQuotes = false;
  let afterQuote = false; // inside a quoted field, just consumed a '"'
  let skipLF = false; // consumed '\r', ignore a following '\n'

  function endField() {
    row.push(field);
    field = '';
  }

  function endRow() {
    if (row.length === 0 && field === '') return; // blank line
    endField();
    const completed = row;
    row = [];
    onRow(completed);
  }

  return {
    push(text) {
      for (let i = 0; i < text.length; i += 1) {
        const char = text[i];

        if (skipLF) {
          skipLF = false;
          if (char === '\n') continue;
        }

        if (inQuotes) {
          if (afterQuote) {
            afterQuote = false;
            if (char === '"') {
              field += '"'; // "" escape
              continue;
            }
            inQuotes = false;
            // fall through: the quote closed the field, handle char outside
          } else if (char === '"') {
            afterQuote = true;
            continue;
          } else {
            field += char;
            continue;
          }
        }

        if (char === '"') {
          if (field === '') {
            inQuotes = true;
            afterQuote = false;
            continue;
          }
          field += char; // lenient: stray quote in an unquoted field
          continue;
        }
        if (char === ',') {
          endField();
          continue;
        }
        if (char === '\n') {
          endRow();
          continue;
        }
        if (char === '\r') {
          endRow();
          skipLF = true;
          continue;
        }
        field += char;
      }
    },
    end() {
      skipLF = false;
      if (field !== '' || row.length > 0) endRow(); // unterminated final row
    },
  };
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

/** Split an ECDICT translation into meanings: real newlines, "\n", "\r\n". */
function splitMeanings(translation) {
  return translation
    .split(/\r\n|\r|\n|\\r\\n|\\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function isKeptRow(row) {
  const word = row[COL_WORD];
  const translation = row[COL_TRANSLATION];
  if (!word || !translation) return false;

  const tag = row[COL_TAG];
  if (tag) return true;

  const frq = Number.parseInt(row[COL_FRQ] ?? '0', 10);
  return Number.isFinite(frq) && frq > 0 && frq <= MAX_FRQ;
}

// ---------------------------------------------------------------------------
// Input plumbing: local file or streamed download with stderr progress
// ---------------------------------------------------------------------------

async function verifySha256(filePath, expected) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  stream.on('data', (chunk) => hash.update(chunk));
  await finished(stream);
  const actual = hash.digest('hex');
  if (actual !== expected.toLowerCase()) {
    throw new Error(`sha256 mismatch for ${filePath}: expected ${expected}, got ${actual}`);
  }
  return actual;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

async function openLocalInput(csvPath, expectedSha256) {
  if (expectedSha256) await verifySha256(csvPath, expectedSha256);
  const info = await stat(csvPath);
  return {
    stream: createReadStream(csvPath, { highWaterMark: 1 << 20 }),
    label: csvPath,
    totalBytes: info.size,
  };
}

async function openRemoteInput(url, expectedSha256) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  const totalBytes = Number.isFinite(contentLength) ? contentLength : null;

  if (expectedSha256) {
    // Work on a local temp file so the digest can be checked before parsing.
    const tempDir = await mkdtemp(join(tmpdir(), 'ecdict-'));
    const tempFile = join(tempDir, 'ecdict.csv');
    await downloadToFile(response.body, tempFile, totalBytes);
    await verifySha256(tempFile, expectedSha256);
    return {
      stream: createReadStream(tempFile, { highWaterMark: 1 << 20 }),
      label: url,
      totalBytes,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  }

  return {
    stream: response.body,
    label: url,
    totalBytes,
  };
}

async function downloadToFile(body, filePath, totalBytes) {
  let downloaded = 0;
  let lastReport = 0;
  const out = createWriteStream(filePath);
  for await (const chunk of body) {
    downloaded += chunk.byteLength;
    if (!out.write(Buffer.from(chunk))) {
      await new Promise((done) => out.once('drain', done));
    }
    const now = Date.now();
    if (now - lastReport > 500) {
      lastReport = now;
      process.stderr.write(progressLine(downloaded, totalBytes));
    }
  }
  await new Promise((done, fail) => out.end((error) => (error ? fail(error) : done())));
  process.stderr.write(progressLine(downloaded, totalBytes, true));
}

function progressLine(downloaded, totalBytes, final = false) {
  if (totalBytes) {
    const percent = ((downloaded / totalBytes) * 100).toFixed(1);
    return `\rDownloading: ${formatBytes(downloaded)} / ${formatBytes(totalBytes)} (${percent}%)${final ? '\n' : ''}`;
  }
  return `\rDownloading: ${formatBytes(downloaded)}${final ? '\n' : ''}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const csvInput = options.csv ?? process.env.ECDICT_CSV ?? DEFAULT_CSV_URL;
  const outPath = resolve(process.cwd(), options.out ?? DEFAULT_OUT);
  const isUrl = /^https?:\/\//i.test(csvInput);

  let input;
  if (isUrl) {
    input = await openRemoteInput(csvInput, options.sha256);
  } else {
    input = await openLocalInput(resolve(process.cwd(), csvInput), options.sha256);
  }

  const entries = new Map();
  let inputRows = 0;
  let skipped = 0;

  const parser = createCsvParser((row) => {
    if (inputRows === 0) {
      inputRows += 1;
      const header = row[0]?.replace(/^\uFEFF/, '');
      if (header !== 'word') {
        throw new Error(`Unexpected CSV header: ${JSON.stringify(row.slice(0, 3))}`);
      }
      return; // header
    }
    inputRows += 1;
    if (!isKeptRow(row)) {
      skipped += 1;
      return;
    }
    const meanings = splitMeanings(row[COL_TRANSLATION]);
    if (meanings.length === 0) {
      skipped += 1;
      return;
    }
    const key = normalizeVocabularyTerm(row[COL_WORD]);
    if (!key) {
      skipped += 1;
      return;
    }
    if (entries.has(key)) return; // first row wins, deterministic
    entries.set(key, { meanings, phonetic: row[COL_PHONETIC].trim() });
  });

  const decoder = new TextDecoder('utf-8');
  try {
    for await (const chunk of input.stream) {
      parser.push(decoder.decode(chunk, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } finally {
    if (input.cleanup) await input.cleanup();
  }

  const result = {};
  for (const [key, value] of entries) result[key] = value;

  await mkdir(dirname(outPath), { recursive: true });
  const json = JSON.stringify(result);
  await writeFile(outPath, json, 'utf-8');
  const { size } = await stat(outPath);

  const dataRows = Math.max(0, inputRows - 1);
  process.stdout.write(
    [
      `Source:        ${input.label}`,
      `Input rows:    ${dataRows} (header excluded, skipped ${skipped})`,
      `Kept entries:  ${entries.size}`,
      `Output:        ${outPath}`,
      `Output size:   ${size} bytes (${formatBytes(size)})`,
      '',
    ].join('\n'),
  );
}

main().catch((error) => {
  process.stderr.write(`build-core: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
