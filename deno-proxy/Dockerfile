# TRCloud proxy — รันบน VPS tdlmc แทน Deno Deploy
#
# ตรึงเวอร์ชัน ไม่ใช้ :latest — proxy ตัวนี้เป็นทางเดียวที่หน้าเว็บคุย TRCloud
# ถ้า image เปลี่ยนใต้เท้าแล้วพฤติกรรม session เพี้ยน จะไล่หาสาเหตุยาก
FROM denoland/deno:alpine-2.1.4

WORKDIR /app
COPY main.ts .

# cache ตอน build ไม่ใช่ตอน start — ให้ container พร้อมรับงานทันทีที่ขึ้น
RUN deno cache main.ts

# --allow-net = ออกไป thaidrill.trcloud.co ได้ · --allow-env = อ่าน TRCLOUD_* ได้
# ไม่ให้สิทธิ์ไฟล์เลย: proxy ไม่ต้องอ่านเขียนอะไรในดิสก์
CMD ["deno", "run", "--allow-net", "--allow-env", "main.ts"]
