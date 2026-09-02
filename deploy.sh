#!/usr/bin/env bash
# ============================================================================
# deploy.sh — build แล้วส่งขึ้น pr.tdlmc.com
#
# เดิม deploy ผ่าน GitHub Actions → GitHub Pages (.github/workflows/deploy.yml)
# ย้ายมา VPS ของบริษัทเมื่อ 2 ก.ย. 2026 เพราะ:
#   - GitHub Pages บังคับให้ repo เป็น public — repo นี้เคยมีรหัส TRCloud
#     หลุดอยู่ในคอมเมนต์และในไฟล์ Ex.txt
#   - proxy เดิมอยู่ *.deno.net ซึ่งอยู่ใน class โดเมนที่ DPI ปลายทางบล็อกเป็นชุด
#   - อยู่โดเมนตัวเองแล้วได้ด่าน login ของ acct-auth ครอบให้ด้วย
#
# ต้องมี: node + npm ในเครื่อง · ssh เข้า tdlmc.com ได้ (ดู ~/.ssh/config)
# ใช้: ./deploy.sh [--allow-dirty]
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")" || exit 1

# 🔴 บน Git Bash / MSYS ค่าที่ขึ้นต้นด้วย "/" จะถูกแปลงเป็นพาธ Windows ก่อนถึง node
#    VITE_BASE_PATH=/ กลายเป็น C:/Program Files/Git/ แล้ว index.html จะอ้าง
#    src="/Program Files/Git/assets/..." = เว็บจอขาว (เจอจริง 2 ก.ย. 2026)
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*' 

HOST=tdl@tdlmc.com
DEST=/var/www/pr
ALLOW_DIRTY=0
[ "${1:-}" = "--allow-dirty" ] && ALLOW_DIRTY=1

# ── ค่าที่ต่างจาก .env ของเครื่อง dev ─────────────────────────────────────
# ไม่ใช่ความลับ (เป็นแค่ที่อยู่) จึงเขียนไว้ตรงนี้ได้ ค่าลับอื่นมาจาก .env
export VITE_BASE_PATH=/
export VITE_TRCLOUD_PROXY_BASE=https://pr.tdlmc.com/trc
export VITE_USE_MOCK_DB=false   # mock = localStorage ต่อ browser ไม่แชร์ข้าม user

echo "════ ตรวจก่อน build ════"
DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
  echo "  ✗ working tree ไม่สะอาด — ของที่ deploy จะไม่ตรงกับ commit ไหนเลย"
  echo "$DIRTY" | head -8 | sed 's/^/      /'
  if [ "$ALLOW_DIRTY" -eq 1 ]; then echo "  ⚠️  ข้ามด่านด้วย --allow-dirty"
  else echo "     commit ก่อน หรือใช้ --allow-dirty"; exit 1; fi
else
  echo "  ✓ working tree สะอาด"
fi

SHA="$(git rev-parse HEAD)"
if git ls-remote gitea 2>/dev/null | grep -q "^$SHA"; then
  echo "  ✓ commit $(git rev-parse --short HEAD) อยู่บน Gitea แล้ว"
else
  echo "  ⚠️  commit นี้ยังไม่อยู่บน Gitea — ถ้าเครื่องหาย โค้ดที่รันอยู่หายด้วย"
  echo "     สั่ง: git push gitea $(git rev-parse --abbrev-ref HEAD)"
fi

echo
echo "════ build ════"
npm run build || exit 1
[ -f dist/index.html ] || { echo "  ✗ ไม่มี dist/index.html — build ไม่ได้ผลลัพธ์"; exit 1; }
echo "  ได้ $(find dist -type f | wc -l) ไฟล์ · $(du -sh dist | cut -f1)"

# ── ด่านตรวจ base path ────────────────────────────────────────────────────
# ตรวจว่า "ถูก" ไม่ใช่แค่ตรวจว่า "ไม่ใช่ค่าที่เคยผิด" — ค่าผิดมีได้หลายหน้าตา
# (เคยเจอสองแบบ: /pr-warehouse/ ค้างจาก GitHub Pages · /Program Files/Git/ จาก MSYS)
REF="$(grep -oE '(src|href)="[^"]*/assets/[^"]*"' dist/index.html | head -1)"
if ! printf '%s' "$REF" | grep -qE '="/assets/'; then
  echo "  ✗ index.html อ้าง asset ผิดที่: $REF"
  echo "     ต้องเป็น /assets/... — VITE_BASE_PATH ไม่ได้ถูกใช้ตามที่ตั้ง"
  echo "     หยุดก่อน ไม่งั้นได้เว็บจอขาว"
  exit 1
fi
echo "  ✓ asset อ้างถูกที่ ($REF)"

echo
echo "════ ส่งขึ้น $HOST:$DEST ════"
# ใช้ tar ผ่าน ssh ไม่ใช้ rsync — Git Bash บน Windows ไม่มี rsync มาให้
#
# แยกเป็นสองขั้น เพราะ ssh อ่านได้จาก stdin ทางเดียว: ขั้นแรกให้ stdin เป็น
# ข้อมูล tar ขั้นสองจึงส่งสคริปต์ (ถ้ารวมกัน heredoc จะแย่ง stdin ไปจาก tar)
#
# พักไฟล์ใน home ก่อน: /var/www เป็นของ root ผู้ใช้ tdl สร้างโฟลเดอร์ข้าง ๆ ไม่ได้
tar -C dist -czf - . | ssh "$HOST" \
  'rm -rf ~/.pr-deploy-stage && mkdir -p ~/.pr-deploy-stage && tar -C ~/.pr-deploy-stage -xzf -' \
  || { echo "  ✗ ส่งไฟล์ไม่สำเร็จ — ของเดิมยังอยู่ครบ ไม่ได้แตะ"; exit 1; }

ssh "$HOST" 'bash -s' <<'REMOTE' || exit 1
set -e
DEST=/var/www/pr
STAGE=$HOME/.pr-deploy-stage
[ -f "$STAGE/index.html" ] || { echo "  ✗ ของที่ส่งมาไม่มี index.html — ไม่แตะของเดิม"; exit 1; }
# --delete ล้าง asset รอบเก่า (ชื่อไฟล์มี hash ต่อรอบ ไม่ล้างจะกองสะสม)
sudo -n rsync -a --delete "$STAGE/" "$DEST/"
rm -rf "$STAGE"
echo "  วางแล้ว $(find "$DEST" -type f | wc -l) ไฟล์ · $(du -sh "$DEST" | cut -f1)"
REMOTE

echo
echo "════ ยืนยันจากภายนอก ════"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://pr.tdlmc.com/ 2>/dev/null)"
# ไม่มีด่าน login ที่ระดับ Caddy โดยเจตนา (ถอดออก 2 ก.ย. 2026) — แอปมีล็อกอินของตัวเอง
# ที่ตาราง system_users ⇒ 200 คือค่าที่ถูกต้อง ไม่ใช่ความผิดพลาด
case "$CODE" in
  200)     echo "  ✓ ตอบ 200 = เสิร์ฟหน้าเว็บได้ (ล็อกอินเป็นของแอปเอง ไม่ใช่ของ Caddy)" ;;
  302|303) echo "  ⚠️  ตอบ $CODE = มีด่านมาครอบอยู่ ตรวจ forward_auth ใน Caddyfile" ;;
  000)     echo "  ⚠️  ต่อไม่ติด — DNS ของ pr.tdlmc.com ขึ้นแล้วหรือยัง / Caddy มีบล็อกนี้แล้วหรือยัง" ;;
  *)       echo "  ⚠️  ตอบ $CODE" ;;
esac
