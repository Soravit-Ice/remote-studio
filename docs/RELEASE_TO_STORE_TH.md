# Remote Studio: source → repo installer → Store

ใช้โครงสร้างเดียวกับ Precut โดยแยก repo source ออกจาก repo installer:

| หน้าที่                               | Repository                           | Numeric ID   |
| ------------------------------------- | ------------------------------------ | ------------ |
| Source / tests / GitHub Actions       | `Soravit-Ice/remote-studio`          | `1416717142` |
| Public installer / immutable releases | `Soravit-Ice/remote-studio-releases` | `1416782623` |

Owner ID ของทั้งสอง repo คือ `80631648` ตัวเลขเหล่านี้เป็น GitHub IDs ไม่ใช่ Product UUID หรือ OAuth Client ID หากลบแล้วสร้าง repo ใหม่ต้องตรวจ IDs ใหม่

## ค่าที่ตั้งให้แล้ว

สร้าง repo installer เป็น public พร้อม README เชื่อมกลับ source และเปิด immutable releases แล้ว ตั้ง Variables ใน source:

| Variable                            | Value                                |
| ----------------------------------- | ------------------------------------ |
| `REMOTE_STUDIO_DOWNLOAD_REPOSITORY` | `Soravit-Ice/remote-studio-releases` |
| `DOWNLOADS_REPOSITORY_OWNER`        | `Soravit-Ice`                        |
| `DOWNLOADS_REPOSITORY_NAME`         | `remote-studio-releases`             |
| `REMOTE_STUDIO_SIGNED_RELEASE`      | `false`                              |

มี workflow `release.yml` เรียก reusable `store-release.yml@main` เพื่อให้ Store เชื่อถือ workflow ref เดิมได้ทุกเวอร์ชัน โดยยัง checkout/build จาก tag ต้นทาง

## 1. Credential สำหรับเขียน repo installer

ตั้งใน **source repo** → Settings → Secrets and variables → Actions:

- แนะนำ GitHub App ตัวเดียวกับที่ใช้กับ Precut: เพิ่ม `remote-studio-releases` ในรายชื่อ repo ที่ App ติดตั้ง อนุญาต **Contents: read/write** และ **Administration: read** ตั้ง Variable `DOWNLOADS_APP_ID` เป็น App ID และ Secret `DOWNLOADS_APP_PRIVATE_KEY` เป็น private key ของ App
- ทางเลือก: ตั้ง Secret `DOWNLOADS_RELEASE_TOKEN` เป็น fine-grained PAT ที่จำกัดเฉพาะ `remote-studio-releases` และมีสิทธิ์สองรายการเดียวกัน ไม่ต้องตั้ง App ID เมื่อเลือกทางนี้

GitHub ไม่อนุญาตให้อ่าน secret ของ Precut กลับออกมา จึงต้องนำ private key ต้นฉบับหรือ key ใหม่มาเพิ่มใน source repo นี้ `GITHUB_TOKEN` ของ source เขียน repo installer อีกอันไม่ได้ ไม่ต้องส่ง token/private key มาในแชตหรือใส่ใน `product.config.json`

ตั้ง download credential เป็น repository secret เพื่อให้ preflight ตรวจได้ก่อนเริ่ม build ทั้งสามระบบ Environment `release-upload` ใช้เป็น approval gate ได้ แต่ไม่ต้องย้าย download credential เข้า environment นั้น

## 2. เชื่อม Store Admin กับสินค้า RS

เปิดสินค้า **Remote Studio / RS** เดิม ไม่ต้องสร้างสินค้าใหม่

ในส่วนเชื่อม GitHub source ใส่:

| Field              | Value                                                                           |
| ------------------ | ------------------------------------------------------------------------------- |
| Owner login        | `Soravit-Ice`                                                                   |
| Repository name    | `remote-studio`                                                                 |
| Owner ID           | `80631648`                                                                      |
| Repository ID      | `1416717142`                                                                    |
| Workflow ref       | `Soravit-Ice/remote-studio/.github/workflows/store-release.yml@refs/heads/main` |
| Allowed tag prefix | `refs/tags/v`                                                                   |

จากนั้น Admin → Releases → GitHub Releases → **Connect download repository** เลือก `Soravit-Ice/remote-studio-releases` (Repository ID `1416782623`, Owner ID `80631648`) ต้องผูกกับ RS และเป็นคนละ repo กับ source

Store Web/verification worker ใช้ระบบ GitHub Releases ที่เตรียมสำหรับ Precut เดิม ตรวจ actual bytes และ SHA-256 ก่อน READY ถ้าใช้ GitHub App ฝั่ง server เพื่อเพิ่ม API quota ให้ App มี read access ถึง repo installer ใหม่นี้ด้วย ไม่ใช้ CI write token ใน desktop

## 3. SDK Integration และ OAuth

SDK archive ติดตั้งและตรวจ signature แล้ว บันทึกค่าใน Admin → Products → Remote Studio → SDK Integration ให้ตรงกับ [product.config.json](../product.config.json) ที่ source root:

- Product code `RS`, App ID `com.t2etech.remotestudio`
- Public OAuth Client ID `42332f55-29df-42ee-9aba-56fa8fd937eb`
- Exact callback `com.t2etech.remotestudio://oauth/callback`, Authorization Code + PKCE และ Refresh Token
- Trial disabled; policy ปัจจุบันใช้ feature `export` สำหรับ protected work

`DESKTOP_OAUTH_CLIENTS_JSON` อยู่ใน deployment ของ Store และรองรับหลาย client เช่น:

```json
{
  "PRECut_PUBLIC_CLIENT_ID": ["PC"],
  "42332f55-29df-42ee-9aba-56fa8fd937eb": ["RS"]
}
```

แทน placeholder ด้วย Client ID จริงของ Precut และคง mapping เดิมไว้ อย่าแทนที่ทั้ง JSON ด้วย RS เพียงตัวเดียว Deploy/redeploy Store หลังเปลี่ยนค่า การเพิ่ม mapping อย่างเดียวไม่บันทึก SDK Integration หรือเชื่อม repo ให้

หาก export config ใหม่จาก Admin ให้ตรวจ identity/public verification keys แล้ว commit `product.config.json` ก่อน build ไม่มี client secret หรือ signing private key ในไฟล์นี้

## 4. ปล่อยเวอร์ชันจาก source

ทำขั้นตอน credential และ Store bindings ให้ครบก่อนสร้าง tag:

1. แก้ version ใน `package.json` และเพิ่ม `releases/VERSION.md` ให้ตรงกัน เช่น `0.1.0`
2. Commit/push source และรอ **Native verification** ผ่าน ตรวจ actual account login → activate RS → protected work → restart กับ candidate ด้วย
3. สร้าง/push tag จาก commit นั้น:

```sh
git tag v0.1.0
git push origin v0.1.0
```

`Tagged release to T2ETECH Store` จะเริ่มจาก tag อัตโนมัติ หรือ Run workflow โดยเลือก tag เดิมเพื่อ retry งานที่ล้ม อย่าเลือก `main` สำหรับ release และอย่า Re-run run เก่าเพื่อทดสอบ source ที่แก้ใหม่ ให้ push commit ใหม่แล้วรันใหม่

เมื่อ checks ทั้งสามระบบผ่าน จะ publish DMG ARM64/X64, EXE X64, `release-manifest.json` และ `SHA256SUMS` ที่ repo installer แล้วส่งให้ Store ผ่าน OIDC รอ release เป็น **READY** จากนั้น Publish release/product ใน Admin ตามขั้นตอนเดิม CI ไม่มีขั้นตอน Publish สินค้าใน Store

ไฟล์ GitHub เป็น public ทันทีเมื่อ upload job สำเร็จ แม้สินค้า Store ยังไม่ Publish เวอร์ชันที่ publish แล้วห้ามเปลี่ยน tag/แทนที่ไฟล์ ให้ใช้ version ใหม่

## Signing และสถานะปัจจุบัน

Unsigned ใช้งาน flow นี้ได้และ manifest ระบุ `codeSigned: false`, `notarized: false` ตามจริง การติดตั้ง/อัปเดตเป็น manual

ถ้าต้องการ signed release ให้ใส่ publisher pins จริงใน config แล้วตั้ง `REMOTE_STUDIO_SIGNED_RELEASE=true` และ secrets:

- Environment `release-signing-darwin`: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- Environment `release-signing-win32`: `CSC_LINK`, `CSC_KEY_PASSWORD` ของ Windows certificate

source/config/workflow/repo delivery เตรียมแล้ว แต่ยังไม่มี download write credential ใน source, ยังต้องบันทึก Store SDK/repository bindings และยืนยัน real customer activation/native acceptance ก่อน commercial release ไม่มี tag `v0.1.0` หรือ commercial publication ถูกสร้างจากงานเตรียมนี้

## Error Rollup ใน CI

run เก่าล้มด้วย npm 404 ของ `rollup-4.64.6.tgz` ในการติดตั้ง template ซึ่งเลือก transitive dependency ใหม่ในวันนั้น ตรวจภายหลัง URL ตอบ 200 แล้ว แต่ template ตอนติดตั้งครั้งแรกยังเสี่ยง version drift จึงเพิ่ม npm override และ pnpm workspace override เป็น `4.64.3` ตรงกับ source lockfile พร้อมทดสอบ installed version จริงใน template acceptance

ไม่ต้องเพิ่ม npm token เพื่อแก้ error นี้ ตัว tarball เป็น public registry ให้รัน CI จาก commit ที่มี fix การ Re-run run เดิมใช้ template source เดิม
