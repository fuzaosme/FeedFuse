-- 0041 的覆盖索引回填：已执行过 0041 的库在这里补上，无需重跑历史迁移。
-- term 等值查询走索引扫描 + INCLUDE 列免回表；join 侧用复合索引过滤排序。
create index if not exists dictionary_entries_term_covering_idx on dictionary_entries (term)
  include (dictionary_id, meanings, phonetic);
drop index if exists dictionary_entries_term_idx;

create index if not exists dictionaries_ready_lookup_idx
  on dictionaries (status, enabled, priority desc);
