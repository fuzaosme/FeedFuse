# 词典资源说明

本目录下的 `en-zh.json` 是由脚本生成的**核心英汉词典**（约 29,005 条），供
`src/features/english-learning/utils/dictionary.ts` 通过 `fetch('/dictionaries/en-zh.json')` 加载。

## 数据来源

- 词库：[ECDICT](https://github.com/skywind3000/ECDICT)（MIT License，Copyright (c) 2025 Linwei）
- 源文件：`assets/ecdict.csv`（npm 包 `ecdict@0.0.4`，亦可从
  <https://unpkg.com/ecdict@0.0.4/assets/ecdict.csv> 下载）
- 本次生成所用源文件 sha256：
  `d0ce61e560b50d9905d20de3173aa3ca80950ce235bedd21c53e025cf9f38cb0`（65,936,699 字节）
- 列顺序：`word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio`

## 筛选规则

保留同时满足以下条件的行：

1. `word` 与 `translation` 均非空；
2. `tag` 非空，**或** `0 < frq <= 30000`（`frq` 为 `0` 表示未知）。

键名使用与 `normalizeVocabularyTerm`（`src/lib/englishLearning.ts`）完全一致的归一化算法；
若多行归一化后键名相同，保留最先出现的一行。`translation` 按换行（真实换行、字面量
`\n`、`\r\n`）切分为多条释义并去除空项。输出为紧凑 JSON（`JSON.stringify`，无缩进）：

```json
{ "<归一化词条>": { "meanings": ["中文释义1", "中文释义2"], "phonetic": "ˈfjuːz" } }
```

## 生成命令

```bash
# 默认从 unpkg 流式下载源 CSV（stderr 显示下载进度）
pnpm dict:build-core

# 使用本地 CSV，并校验 sha256（推荐，离线且更快）
node scripts/dictionaries/build-core.mjs \
  --csv /tmp/ecdictpkg/package/assets/ecdict.csv \
  --sha256 d0ce61e560b50d9905d20de3173aa3ca80950ce235bedd21c53e025cf9f38cb0 \
  --out public/dictionaries/en-zh.json

# 也可通过环境变量指定源 CSV：ECDICT_CSV=/path/to/ecdict.csv pnpm dict:build-core
```

脚本仅使用 `node:` 内置模块与全局 `fetch`，不引入任何依赖。

## 注意

> `en-zh.json` 是**生成产物**，请勿手工编辑；如需更新词典，请修改并重新运行上述生成脚本。
