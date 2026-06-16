import { createClient } from '@supabase/supabase-js'
import { mockSupabase, mockSupabaseEmployee } from './supabaseMock'

// โหมดจำลอง: เปิดด้วย VITE_USE_MOCK_DB=true (เก็บข้อมูลในเครื่อง ไม่ยุ่ง Supabase จริง)
const useMock = String(import.meta.env.VITE_USE_MOCK_DB || '').toLowerCase() === 'true'

let supabase
let supabaseEmployee

if (useMock) {
  console.warn('🧪 MOCK DB MODE — ใช้ฐานข้อมูลจำลองในเครื่อง (localStorage) ไม่ได้เชื่อม Supabase จริง')
  supabase = mockSupabase
  supabaseEmployee = mockSupabaseEmployee
} else {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL_MWM
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY_MWM
  supabase = createClient(supabaseUrl, supabaseKey)
  // ====================================== Employee Project ======================================
  const employeeProjectUrl = import.meta.env.VITE_SUPABASE_EMPLOYEE_PROJECT2_DB
  const employeeProjectKey = import.meta.env.VITE_SUPABASE_DB_ANON_KEY_EMPLOYEE_PROJECT2
  supabaseEmployee =
    employeeProjectUrl && employeeProjectKey ? createClient(employeeProjectUrl, employeeProjectKey) : null
}

export { supabase, supabaseEmployee }
