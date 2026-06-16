-- ============================================================================
-- Tracking reconciliation: source_key + orphan flag + UNIQUE index
-- รันบน Supabase (SQL Editor) ทีละ STEP ทั้งตาราง ap_requests และ exp_requests
-- ----------------------------------------------------------------------------
-- source_key  = "เลขเอกสาร ∥ ชื่อรายการ ∥ qty"  (ตัวตนของบรรทัด ใช้กันซ้ำ/ติดป้าย/รีเฟรช)
-- is_orphaned = true เมื่อบรรทัดหลุดจาก TRCloud แต่ยังมีงานมือและย้ายปลายทางไม่ได้
-- UNIQUE index = กันซ้ำระดับฐานข้อมูล (ต้องไม่มี source_key ซ้ำเหลืออยู่ ก่อนสร้าง)
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
-- STEP 1 — เพิ่มคอลัมน์ + backfill source_key ให้ข้อมูลเดิม
-- ────────────────────────────────────────────────────────────────────────
alter table public.ap_requests add column if not exists source_key  text;
alter table public.ap_requests add column if not exists is_orphaned boolean not null default false;
alter table public.ap_requests add column if not exists orphaned_at timestamptz;

alter table public.exp_requests add column if not exists source_key  text;
alter table public.exp_requests add column if not exists is_orphaned boolean not null default false;
alter table public.exp_requests add column if not exists orphaned_at timestamptz;

update public.ap_requests
set source_key =
      btrim(coalesce(nullif(btrim(ap_number), ''), btrim(po_id), '')) || '∥' ||
      btrim(coalesce(item_ref, ''))                                   || '∥' ||
      coalesce(trim(to_char(qty_order, 'FM9999999999990.999999')), '')
where source_key is null;

update public.exp_requests
set source_key =
      btrim(coalesce(nullif(btrim(ap_number), ''), btrim(po_id), '')) || '∥' ||
      btrim(coalesce(item_ref, ''))                                   || '∥' ||
      coalesce(trim(to_char(qty_order, 'FM9999999999990.999999')), '')
where source_key is null;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 2 — ดูว่ามี source_key ซ้ำเหลืออยู่ไหม (ถ้าผลลัพธ์ว่าง = ข้ามไป STEP 4 ได้เลย)
-- ────────────────────────────────────────────────────────────────────────
select 'ap_requests' as tbl, source_key, count(*) c
from public.ap_requests group by source_key having count(*) > 1
union all
select 'exp_requests' as tbl, source_key, count(*) c
from public.exp_requests group by source_key having count(*) > 1;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 3 — ล้างซ้ำ: เก็บแถวล่าสุด (updated_at ใหม่สุด) ต่อ source_key, ลบที่เหลือ
-- ⚠️ รัน STEP 3 เฉพาะเมื่อ STEP 2 พบรายการซ้ำ — เป็นการลบข้อมูลซ้ำของเก่า
-- ────────────────────────────────────────────────────────────────────────
with ranked as (
  select id, source_key,
         row_number() over (partition by source_key
                            order by updated_at desc nulls last, id desc) as rn
  from public.ap_requests
  where source_key is not null
)
delete from public.ap_requests a
using ranked r
where a.id = r.id and r.rn > 1;

with ranked as (
  select id, source_key,
         row_number() over (partition by source_key
                            order by updated_at desc nulls last, id desc) as rn
  from public.exp_requests
  where source_key is not null
)
delete from public.exp_requests e
using ranked r
where e.id = r.id and r.rn > 1;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 4 — สร้าง UNIQUE index (ให้ upsert(onConflict: source_key) ทำงานได้)
-- NULLs ถือว่าไม่เท่ากัน → แถวที่ source_key เป็น null ไม่ถูกบังคับ unique
-- ────────────────────────────────────────────────────────────────────────
create unique index if not exists ap_requests_source_key_uniq
  on public.ap_requests (source_key);

create unique index if not exists exp_requests_source_key_uniq
  on public.exp_requests (source_key);
