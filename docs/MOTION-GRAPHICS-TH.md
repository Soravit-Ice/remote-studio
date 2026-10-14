# ทำ Motion Graphics จาก ChatGPT Web ผ่าน Remote Studio

ChatGPT รับบรีฟ วางเรื่อง และเขียน HTML/CSS/GSAP ส่วน Remote Studio รัน HyperFrames บนเครื่อง บันทึกงาน ส่งเฟรมให้ดูในแชต และตรวจไฟล์วิดีโอที่ encode จริง ใช้ connection ChatGPT Web เดิมได้ ไม่ต้องเพิ่ม model loop หรือ API key ของผู้สร้างวิดีโอ

## เริ่มใช้

1. เปิด Remote Studio รุ่นที่ build จาก source นี้ และเชื่อม ChatGPT Web ตาม Connections → Set up ChatGPT Web
2. เลือกโฟลเดอร์สำหรับวิดีโอ ตั้งสิทธิ์โฟลเดอร์และ connection เป็น Full Access เพื่อให้ workflow ต่อเนื่อง หรือใช้ Reviewed และอนุมัติงานใน Activity
3. เปิด Video ใน Tools แล้ว refresh metadata ของ custom MCP plugin และเริ่มแชตใหม่ เพื่อให้เห็น tools ที่เพิ่มมา
4. ให้ ChatGPT เรียก `video_guide` สร้างโปรเจกต์ด้วย `video_project_create` และติดตั้ง runtime ด้วย `project_install` เฉพาะเมื่อใช้งาน

ตัวอย่างข้อความ:

> ใช้ Remote Studio ทำ motion graphic ภาษาไทย 15 วินาที ขนาด 1080×1920 ที่ 30 fps เรื่อง [ใส่เรื่องและข้อความที่ต้องการ] ใช้ HyperFrames เขียนโค้ดตามบรีฟ ดู video_guide ก่อน สร้างในโฟลเดอร์ใหม่ เขียน scenes ให้ครบ ตรวจ composition และส่งเฟรมช่วงกลางแต่ละ scene มาให้ดูก่อนเรนเดอร์ MP4

หากต้องการไฟล์ทันที ให้ระบุว่าให้ตรวจและเรนเดอร์ต่อได้เลย หากต้องการแก้ก่อน ให้ระบุให้หยุดที่เฟรมพรีวิว

## ลำดับ tools

| ขั้นตอน                      | Tool                                         | ผลจริง                                                                               |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| แนวทางและข้อกำหนด            | `video_guide`                                | Workflow และสัญญา composition โดยไม่ติดตั้ง runtime                                  |
| บรีฟและ source               | `video_project_create`                       | BRIEF.md, MOTION-GUIDE.md, package.json และ index.html; starter สำหรับเขียนเรื่องต่อ |
| ติดตั้ง                      | `project_install`                            | Job ติดตั้ง HyperFrames 0.8.153 และ GSAP 3.14.2; เก็บ lockfile ของโปรเจกต์           |
| เขียน/แก้ motion             | `file_read`, `file_batch`, `file_patch_many` | แก้ source ด้วย conflict hashes และ checkpoints                                      |
| สำรวจ assets/effects         | `asset_inspect`, `project_run_script`        | ใช้ script=catalog พร้อม args ของ HyperFrames; ค้น effect ภาษาอังกฤษ                 |
| ตรวจขนาด/เวลา/source         | `video_inspect`                              | ขนาด Duration FPS และ revision รวม source/asset metadata                             |
| ตรวจเร็ว/ดู timeline/ตรวจครบ | `video_validate`                             | mode=lint, timeline หรือ check; ใช้ `job_wait` ตามด้วย `video_status`                |
| ดูเฟรมในแชต                  | `video_snapshot`                             | times เช่น [1,4,8]; `video_status` ส่ง PNG artifacts และ MCP image blocks            |
| เปิด timeline บนเครื่อง      | `video_preview`                              | Studio URL บน loopback; `video_status.ready` ตรวจ HTTP จริง; หยุดด้วย `job_cancel`   |
| ทำไฟล์วิดีโอ                 | `video_render`                               | MP4/WebM/MOV, quality=draft/looks/delivery, workers อัตโนมัติหรือ 1–8                |
| ตรวจและรับผล                 | `video_status`                               | สถานะ findings และ SHA-256/bytes/duration/ขนาด/FPS/codec พร้อม path ของไฟล์          |
| อ่านไฟล์ผ่าน client          | `video_output_read`                          | Base64 ทีละไม่เกิน 512 KiB ต่อที่ nextOffset และตรวจ SHA-256 เมื่อประกอบครบ          |

งานต้อง completed และ `video_status.verified=true` ก่อนแจ้งว่าสำเร็จ การ render ต้องผ่าน mode=check ของ source ปัจจุบันก่อน หาก Studio เพิ่ม metadata หรือผู้ใช้แก้ source ให้ check ใหม่ การแก้ source ขณะรอคิวหรือระหว่าง render ทำให้งานไม่ผ่าน

## ประสิทธิภาพและขอบเขต

- ใช้ lint/timeline และภาพนิ่งระหว่างแก้ ใช้ draft สำหรับ iteration และ delivery เมื่อพร้อมส่ง ลดการ encode ซ้ำโดยไม่จำเป็น
- ใช้ assets/fonts/GSAP ในเครื่อง และ timeline ที่ paused และ seek ได้ หลีกเลี่ยง clock/timer/Math.random ของ browser
- HyperFrames Chrome ดาวน์โหลดเฉพาะเมื่อเรียกงาน check/snapshot/render แล้วใช้ cache ภายใน workspace ไม่ติดตั้ง media runtime ตอนเปิดแอปเฉย ๆ
- เครื่องต้องมี FFmpeg และ FFprobe สำหรับ encode และตรวจไฟล์จริง `toolchain_info` ตรวจ Node/npm; script=doctor ตรวจ runtime HyperFrames ไม่มีการติดตั้ง FFmpeg หรือเปลี่ยนระบบให้อัตโนมัติ
- บันทึก output แยกตาม UUID ใน renders/ ทุกงานใช้ native sandbox, logs, cancellation และกฎสิทธิ์เดิม ปิด Video หรือถอนสิทธิ์จะหยุดงานที่เกี่ยวข้อง
- MP4 เป็นภาพทึบ WebM/MOV รองรับ alpha เมื่อ composition ไม่ทาสีพื้นหลัง ยังไม่มี HDR/lossless export หรือการรับรอง codec compatibility ของทุกแอป
- **Studio URL และ path ของ MP4 เป็นของเครื่องผู้ใช้ ไม่ใช่ลิงก์ดาวน์โหลดสาธารณะใน ChatGPT Web** เฟรม PNG ดูในแชตได้ ส่วน MP4 เปิดจาก path ที่ส่งคืนได้ หรือ client ที่รองรับใช้ chunk tool ดาวน์โหลด หากต้องการเล่น/ดาวน์โหลดวิดีโอผ่าน HTTPS ในแชต ต้องต่อ storage/publishing ที่ได้รับอนุญาตเพิ่มเติม
- ไม่รวมบริการสร้างเสียงพูด เพลง stock media หรือคลาวด์เรนเดอร์ ผลทดสอบ macOS ไม่รับรอง Windows

## ตรวจ source

```sh
pnpm build:services
pnpm exec vitest run tests/integration/video.test.ts
STUDIO_TEST_VIDEO=1 pnpm exec vitest run tests/integration/video-runtime.test.ts
```

การทดสอบ runtime ใช้โฟลเดอร์ชั่วคราวและ HyperFrames/Chrome/FFmpeg จริง รวม check, PNG frames, Studio readiness, ข้อความภาษาไทย, encode MP4/WebM/MOV, chunk read, ตรวจ hash และปฏิเสธไฟล์/source ที่เปลี่ยน ไม่ใช้ renderer จำลอง
