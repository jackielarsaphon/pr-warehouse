import { ref, watch } from 'vue'

// คืน ref ที่ "ตาม" ค่าของ source แบบหน่วงเวลา (debounce)
// ใช้ลดงานคำนวณหนัก เช่น filter ตารางพันแถว ไม่ให้รันทุกตัวอักษรที่พิมพ์
export function useDebounced(source, delay = 250) {
  const out = ref(source.value)
  let timer
  watch(source, (v) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      out.value = v
    }, delay)
  })
  return out
}
