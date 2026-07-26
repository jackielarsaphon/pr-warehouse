<script setup>
// ============================================================================
// TablePager — แถบเปลี่ยนหน้าตาราง (คู่กับ composables/usePagination.js)
// สไตล์อ้างตาม pager เดิมใน expTrackingView/adminLogsView ให้หน้าตากลมกลืนกัน
// ============================================================================
import { computed } from 'vue'
import { PAGE_SIZE_OPTIONS } from '@/composables/usePagination'

const props = defineProps({
  page: { type: Number, required: true },
  pageSize: { type: Number, required: true },
  total: { type: Number, required: true },
  totalPages: { type: Number, required: true },
  startIndex: { type: Number, default: 0 },
  shown: { type: Number, default: 0 }, // จำนวนแถวที่โชว์จริงในหน้านี้
})

const emit = defineEmits(['prev', 'next', 'goTo', 'update:pageSize'])

// ช่วงลำดับที่กำลังแสดง เช่น "101–200" (ถ้าไม่มีแถวเลยให้เป็น 0)
const rangeLabel = computed(() => {
  if (!props.total) return '0'
  const from = props.startIndex + 1
  const to = props.startIndex + props.shown
  return `${from.toLocaleString()}–${to.toLocaleString()}`
})
</script>

<template>
  <div
    v-if="total > 0"
    class="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-t"
    style="border-color: var(--color-border)"
  >
    <div class="flex items-center gap-2 text-[12px]" style="color: var(--color-text-muted)">
      <span>แสดง {{ rangeLabel }} จาก {{ total.toLocaleString() }} รายการ</span>
      <select
        :value="pageSize"
        @change="emit('update:pageSize', Number($event.target.value))"
        class="px-2 py-1 rounded-lg border text-[12px] outline-none"
        style="
          border-color: var(--color-border);
          background: var(--color-bg-card);
          color: var(--color-text-secondary);
        "
        aria-label="จำนวนแถวต่อหน้า"
      >
        <option v-for="n in PAGE_SIZE_OPTIONS" :key="n" :value="n">{{ n }} แถว/หน้า</option>
      </select>
    </div>

    <div class="flex items-center gap-2">
      <button
        @click="emit('goTo', 1)"
        :disabled="page <= 1"
        class="px-2.5 py-1.5 rounded-lg text-[12px] font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style="border-color: var(--color-border); color: var(--color-text-secondary)"
        title="หน้าแรก"
      >
        «
      </button>
      <button
        @click="emit('prev')"
        :disabled="page <= 1"
        class="px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style="border-color: var(--color-border); color: var(--color-text-secondary)"
      >
        ก่อนหน้า
      </button>
      <div class="text-[12px] whitespace-nowrap" style="color: var(--color-text-muted)">
        หน้า {{ page }} / {{ totalPages }}
      </div>
      <button
        @click="emit('next')"
        :disabled="page >= totalPages"
        class="px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style="border-color: var(--color-border); color: var(--color-text-secondary)"
      >
        ถัดไป
      </button>
      <button
        @click="emit('goTo', totalPages)"
        :disabled="page >= totalPages"
        class="px-2.5 py-1.5 rounded-lg text-[12px] font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style="border-color: var(--color-border); color: var(--color-text-secondary)"
        title="หน้าสุดท้าย"
      >
        »
      </button>
    </div>
  </div>
</template>
