-- ============================================================================
-- TRCloud data warehouse: เก็บเอกสาร TRCloud (pr/po/ap/pv/expense) ลง Supabase
-- ----------------------------------------------------------------------------
-- flow ใหม่: TRCloud (proxy) → upsert ลงตารางนี้ → หน้าเว็บอ่านจาก Supabase
--   • backfill ครั้งแรก = ทั้งปีปัจจุบัน
--   • หลังจากนั้นอัพเดทเฉพาะ ~1 เดือนล่าสุด (incremental) แล้ว upsert กันซ้ำด้วย unique_id
-- รันบน Supabase (SQL Editor) ครั้งเดียว
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
-- ตารางหลัก: 1 แถว = 1 เอกสาร TRCloud (เก็บ payload ดิบทั้งก้อนใน data)
--   doc_type   = ประเภท: 'pr' | 'po' | 'ap' | 'pv' | 'expense'
--   unique_id  = ตัวตนของเอกสารจาก TRCloud (ใช้ upsert กันซ้ำ)
--   issue_date = วันที่เอกสาร (แยกออกมาเป็นคอลัมน์เพื่อ filter ช่วงวันที่ได้เร็ว)
--   data       = payload ดิบทั้งหมดจาก TRCloud (หน้าเว็บอ่านคอลัมน์นี้ไปใช้ตรง ๆ)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.trcloud_documents (
  doc_type   text        not null,
  unique_id  text        not null,
  issue_date date,
  data       jsonb       not null,
  synced_at  timestamptz not null default now(),
  primary key (doc_type, unique_id)
);

-- index สำหรับอ่านตามชนิด + ช่วงวันที่ (หน้าเว็บ query แบบนี้เป็นหลัก)
create index if not exists trcloud_documents_type_date
  on public.trcloud_documents (doc_type, issue_date desc);

-- ────────────────────────────────────────────────────────────────────────
-- ตารางสถานะ sync (แถวเดียว id=1) — แชร์กันทุกเครื่อง เพื่อ debounce ไม่ให้
-- ทุกเครื่อง/ทุกการเปิดหน้าไปยิง proxy ซ้ำ ๆ
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.trcloud_sync_state (
  id                 int primary key default 1,
  last_full_backfill timestamptz,
  last_incremental_at timestamptz,
  backfill_from      date,
  backfill_to        date,
  updated_at         timestamptz not null default now(),
  constraint trcloud_sync_state_single_row check (id = 1)
);

insert into public.trcloud_sync_state (id) values (1)
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- สิทธิ์: แอปยิงผ่าน anon key → ต้อง grant + เปิด policy ให้ anon อ่าน/เขียนได้
-- (client-triggered sync: frontend เป็นคน upsert เข้ามาเอง)
-- ────────────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.trcloud_documents  to anon, authenticated;
grant select, insert, update, delete on public.trcloud_sync_state to anon, authenticated;

alter table public.trcloud_documents  enable row level security;
alter table public.trcloud_sync_state enable row level security;

drop policy if exists trcloud_documents_all on public.trcloud_documents;
create policy trcloud_documents_all
  on public.trcloud_documents
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists trcloud_sync_state_all on public.trcloud_sync_state;
create policy trcloud_sync_state_all
  on public.trcloud_sync_state
  for all
  to anon, authenticated
  using (true)
  with check (true);
