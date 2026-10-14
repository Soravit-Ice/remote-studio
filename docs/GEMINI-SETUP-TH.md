# เชื่อม Remote Studio กับ Gemini Web

ไปที่ **Connections → Set up Gemini Web** เพื่อสร้าง HTTPS MCP URL แล้วนำไปใส่ใน Gemini ที่ **เครื่องมือเชื่อมต่อ → กำหนดเอง** (`https://gemini.google.com/customize/connectors`) การเปิดใช้ Custom apps ขึ้นอยู่กับบัญชีและการเปิดให้ใช้งานของ Google ดู [คู่มือ Gemini](https://support.google.com/gemini/answer/17209137?co=GENIE.Platform%3DDesktop&hl=en)

## ลองใช้งานด้วย Quick Tunnel

1. ติดตั้ง `cloudflared` จาก [Cloudflare](https://developers.cloudflare.com/tunnel/get-started/) บน macOS ใช้ `brew install cloudflared` แอปตรวจตำแหน่ง Homebrew ให้อัตโนมัติ หากไม่พบ ให้กด **Choose cloudflared** เลือก executable ที่ติดตั้งไว้
2. เลือก **Quick Tunnel** ไม่ต้องมีบัญชี Cloudflare หรือโดเมน
3. เลือกเฉพาะโฟลเดอร์ที่ต้องการให้ Gemini ใช้ และตั้ง Read only, Reviewed หรือ Workspace Full Access ตามงาน
4. กด **Save & start** รอ **Tunnel connected** แล้วกด **Check Gemini connection** เพื่อยืนยัน metadata ผ่าน HTTPS จริง
5. กด **Copy URL** แล้ววาง URL ที่ลงท้าย `/mcp` ใน Gemini → เพิ่มแอปกำหนดเอง → Next รองรับ Dynamic Client Registration จึงไม่ต้องกรอก OAuth client credentials ด้วยตนเอง
6. เมื่อ Gemini เปิดหน้าเชื่อมบัญชี จะมีรหัสจับคู่หกหลัก กลับมาที่ Remote Studio → Connections → Gemini Web ตรวจรหัสและ callback ให้ตรงกัน แล้วกด **Allow connection** และยืนยันในกล่อง native ของแอป
7. กลับไปหน้าที่เปิดจาก Gemini ระบบจะส่งกลับโดยอัตโนมัติ เลือกแอปด้วย `@` และลองเรียก `workspace_list`

Quick Tunnel มี URL ใหม่ทุกครั้งที่เริ่มใหม่ ต้องเพิ่ม URL ใหม่และเชื่อมบัญชีใน Gemini อีกครั้ง เหมาะกับการทดลอง ตาม [ข้อจำกัดของ Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

## ใช้งานประจำด้วย Named Tunnel

1. สร้าง Cloudflare Tunnel แบบ remotely managed และกำหนดโดเมนคงที่ที่คุณควบคุม เช่น `studio.example.com`
2. ตั้ง Published application route ของ hostname นี้ โดยเว้น Path ว่าง ให้เป็น **HTTP → `127.0.0.1:8766`** หรือ port ที่เลือกใน Remote Studio ให้ route ครอบคลุมทั้ง `/mcp`, `/.well-known/*` และ `/oauth/*`
3. ใน Remote Studio เลือก **Named Tunnel** กรอก **Public HTTPS origin** เช่น `https://studio.example.com` โดยไม่ใส่ `/mcp`, **Local MCP port** และ **Cloudflare tunnel token** กรอก token ในแอป ไม่ต้องส่งผ่านแชต
4. เลือกโฟลเดอร์ กด Save & start และทำขั้นตอนเชื่อมบัญชีเหมือน Quick Tunnel

แอปเข้ารหัส Cloudflare token และ OAuth sessions ด้วย OS credential storage ไม่มี plaintext fallback ไม่มี token ใน command arguments, renderer หรือ MCP results Named Tunnel เก็บ client registrations และ hash ของ OAuth tokens ไว้สำหรับเริ่มแอปใหม่ด้วยโดเมนและสิทธิ์เดิม รอ OS credential storage ปลดล็อกก่อนเริ่ม การเปลี่ยนการตั้งค่าจะสร้าง folder grant ใหม่และยกเลิก OAuth sessions เดิม

ไม่ต้องเปิด Cloudflare email/PIN login หน้า endpoint นี้ เพราะ MCP client เรียก API จาก server โดยใช้ OAuth ของ Remote Studio การตั้ง Cloudflare Access เพิ่มต้องมีนโยบายที่รองรับ API client ของคุณด้วย ดู [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)

## สิทธิ์ สถานะ และการหยุด

- Gemini ใช้ scoped credential แยกจาก ChatGPT และ local stdio clients สิทธิ์ถูกตรวจซ้ำใน agent ทุกครั้งที่ใช้เครื่องมือ โฟลเดอร์ที่เพิ่มภายหลังไม่ถูกอนุญาตอัตโนมัติ
- Read only ซ่อนเครื่องมือเขียนและรันคำสั่ง Reviewed รออนุมัติในเครื่อง Workspace Full Access ทำงานต่อเนื่องภายใต้สิทธิ์โฟลเดอร์และ native sandbox เดิมของ Remote Studio
- **Local MCP** ยืนยันการ handshake ด้วย local diagnostic client **Public HTTPS** ยืนยัน metadata ผ่าน Cloudflare **Tool request received** หมายถึง adapter ได้รับคำขอเครื่องมือที่ผ่าน OAuth แล้ว ไม่ใช่การรับรองบัญชี Gemini หรือการติดตั้งแอปในบัญชีนั้น
- **Stop Gemini tunnel** หยุดทั้ง HTTP adapter และ cloudflared ปิดหน้าต่างยังทำงานต่อใน menu bar ตามเดิม Quit หยุดตามค่าเริ่มต้น Background service เป็นการเปิดใช้โดยชัดเจน
- **Remove Gemini** หยุด tunnel ถอน scoped folder grant และลบ credentials/OAuth state ในเครื่อง ลบ custom app ในบัญชี Gemini แยกต่างหาก
- Authorization codes และ pending approvals ไม่เก็บข้ามการเริ่มแอป Access token มีอายุหนึ่งชั่วโมง Refresh token หมุนเมื่อใช้และมีอายุเจ็ดวัน การใช้ refresh token เดิมซ้ำยกเลิก token family ของการเชื่อมนั้น

## การตรวจสอบของรุ่นนี้

มีการทดสอบ OAuth, MCP SDK v2 ผ่าน HTTP แบบ JSON, folder scope, grant revocation, process lifecycle, การเก็บ sessions แบบเข้ารหัส และการใช้งานใน Electron ผ่าน Playwright การทดสอบ UI ใช้ cloudflared fixture ที่ระบุชัดเจน จึงไม่ถือเป็นหลักฐานการเชื่อมบัญชี Gemini จริง

การทดสอบ runtime จริงเป็นแบบ opt-in และใช้ temporary folder กับสิทธิ์อ่านเท่านั้น:

```sh
pnpm build:services
STUDIO_TEST_CLOUDFLARED_RUNTIME=/opt/homebrew/bin/cloudflared pnpm exec vitest run tests/integration/gemini-cloudflare-runtime.test.ts
```

macOS verification ไม่ใช่ Windows certification ยังต้องเพิ่ม custom app และทดสอบในบัญชี Gemini ของคุณเพื่อยืนยันขั้นตอนของ Google ตั้งแต่ต้นจนจบ
