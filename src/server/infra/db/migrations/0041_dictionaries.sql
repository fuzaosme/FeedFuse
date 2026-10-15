-- 词典数据是实例级共享资源：一次下载，所有账号共用，不做用户隔离。
create table dictionaries (
  id text primary key,
  name text not null,
  description text not null default '',
  language text not null default 'en-zh',
  license text not null default '',
  attribution text not null default '',
  homepage text not null default '',
  source_url text not null default '',
  -- 内置词典由静态资源提供，这里只保留可移除的下载词典记录。
  builtin boolean not null default false,
  enabled boolean not null default true,
  status text not null default 'available',
  error_message text not null default '',
  total_entries integer not null default 0,
  imported_entries integer not null default 0,
  total_bytes bigint not null default 0,
  downloaded_bytes bigint not null default 0,
  -- 数值越大，命中时优先级越高；用户自行导入的词典排在内置词典之前。
  priority integer not null default 100,
  installed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table dictionary_entries (
  dictionary_id text not null references dictionaries(id) on delete cascade,
  -- 存放 normalizeVocabularyTerm 处理后的检索键。
  term text not null,
  meanings jsonb not null,
  phonetic text not null default '',
  primary key (dictionary_id, term)
);

-- 跨词典按词条查询；主键前缀是 dictionary_id，因此需要独立索引 term。
-- 覆盖索引：INCLUDE 携带查询输出列，term 等值命中后无需回表（索引扫描即可返回行）。
create index dictionary_entries_term_covering_idx on dictionary_entries (term)
  include (dictionary_id, meanings, phonetic);
drop index if exists dictionary_entries_term_idx;

-- lookup 的 join 条件 + 排序：d.enabled / d.status 过滤后按 priority 排序，复合索引加速。
create index dictionaries_ready_lookup_idx on dictionaries (status, enabled, priority desc);
