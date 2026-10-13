import { accountTemplate } from "./account-template";

export const presets = {
  "premium-saas": {
    accent: "#3155d9",
    background: "#f8f9fc",
    foreground: "#151b2d",
    radius: "14px",
    font: "Inter, system-ui, sans-serif",
  },
  "modern-minimal": {
    accent: "#161616",
    background: "#fafafa",
    foreground: "#161616",
    radius: "8px",
    font: "system-ui, sans-serif",
  },
  corporate: {
    accent: "#145c4c",
    background: "#f7faf8",
    foreground: "#172c26",
    radius: "6px",
    font: "system-ui, sans-serif",
  },
  dashboard: {
    accent: "#4f46e5",
    background: "#f4f5f9",
    foreground: "#202331",
    radius: "10px",
    font: "system-ui, sans-serif",
  },
};
export type Preset = keyof typeof presets;
export type Template =
  | "react-vite"
  | "astro"
  | "next"
  | "next-fullstack"
  | "electron"
  | "tauri"
  | "empty"
  | "custom";
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export const designCSS = (preset: Preset = "modern-minimal") => {
  const p = presets[preset];
  return `@import "tailwindcss";\n:root{--background:${p.background};--foreground:${p.foreground};--primary:${p.accent};--radius:${p.radius};--surface:#fff;--muted:#525866;--border:#dce0e6;font-family:${p.font};color:var(--foreground);background:var(--background);color-scheme:light}*{box-sizing:border-box}body{margin:0}a{color:inherit;text-decoration:none}button,input,textarea{font:inherit}button,a,input,textarea{outline-offset:4px}a:hover{text-decoration:underline}.container{width:min(1120px,100% - 48px);margin-inline:auto}header{border-bottom:1px solid var(--border);background:var(--surface)}nav{display:flex;align-items:center;justify-content:space-between;min-height:76px;gap:24px;flex-wrap:wrap}nav .links{display:flex;gap:24px;flex-wrap:wrap}.hero{padding:100px 0 72px;max-width:780px}.eyebrow{font-size:13px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--primary)}h1{font-size:clamp(36px,6vw,72px);letter-spacing:-.05em;line-height:1.06;margin:20px 0}h2{font-size:clamp(26px,4vw,40px);letter-spacing:-.035em}p{color:var(--muted);line-height:1.7;max-width:65ch}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin:40px 0 80px}.card{padding:28px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)}.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 20px;border-radius:var(--radius);background:var(--primary);color:white;border:1px solid transparent;cursor:pointer;font-weight:600}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}.button:disabled{opacity:.6;cursor:wait}form{display:grid;gap:16px;max-width:480px;margin:28px 0}label{display:grid;gap:8px}input,textarea{width:100%;padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--foreground)}footer{border-top:1px solid var(--border);padding:32px 0;color:var(--muted)}.skip-link{position:absolute;top:-100px}.skip-link:focus{top:8px;left:8px;background:var(--surface);padding:12px;z-index:10}@media(max-width:640px){.container{width:calc(100% - 32px)}nav{padding:16px 0;gap:12px}.hero{padding:56px 0 36px}.grid{grid-template-columns:1fr;gap:16px;margin-bottom:48px}}@media(prefers-color-scheme:dark){:root{--background:#12151b;--foreground:#f3f4f6;--surface:#1b2029;--muted:#b4bdcc;--border:#384150;--primary:#728cf5;color-scheme:dark}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\n`;
};
const button = `import * as React from 'react';\nimport {Slot} from '@radix-ui/react-slot';\nimport {clsx} from 'clsx';\nimport {twMerge} from 'tailwind-merge';\nexport function Button({className,asChild=false,...props}:React.ComponentProps<'button'>&{asChild?:boolean}){const Comp=asChild?Slot:'button';return <Comp className={twMerge(clsx('button',className))} {...props}/>;}\n`;
const commonDeps = {
  react: "19.3.0",
  "react-dom": "19.3.0",
  "@radix-ui/react-slot": "1.4.0",
  clsx: "2.1.1",
  "tailwind-merge": "3.7.0",
};
const commonDev = {
  typescript: "6.0.3",
  "@types/react": "19.3.0",
  "@types/react-dom": "19.3.0",
  "@types/node": "26.6.4",
  tailwindcss: "4.3.3",
};
const compiler = {
  target: "ES2022",
  lib: ["ES2022", "DOM", "DOM.Iterable"],
  module: "ESNext",
  moduleResolution: "Bundler",
  jsx: "react-jsx",
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  allowJs: true,
  resolveJsonModule: true,
  esModuleInterop: true,
};
const base = (name: string, preset: Preset) => ({
  ".gitignore":
    "node_modules/\ndist/\nout/\n.next/\n.astro/\n.remote-studio/\nremote-studio-skills/\n.env*\nprisma/*.db*\nsrc/generated/\nsrc-tauri/target/\n",
  "src/components/ui/button.tsx": button,
  "src/styles/globals.css": designCSS(preset),
  "components.json": json({
    $schema: "https://ui.shadcn.com/schema.json",
    style: "new-york",
    rsc: false,
    tsx: true,
    tailwind: {
      config: "",
      css: "src/styles/globals.css",
      baseColor: "neutral",
      cssVariables: true,
    },
    aliases: {
      components: "@/components",
      utils: "@/lib/utils",
      ui: "@/components/ui",
      lib: "@/lib",
      hooks: "@/hooks",
    },
  }),
  "src/lib/utils.ts":
    "import {clsx,type ClassValue} from 'clsx';import {twMerge} from 'tailwind-merge';export function cn(...inputs:ClassValue[]){return twMerge(clsx(inputs));}\n",
  "design.json": json({
    name,
    preset,
    tokens: presets[preset],
    principles: [
      "semantic HTML",
      "WCAG AA",
      "content-led hierarchy",
      "responsive grids",
      "reduced motion",
    ],
  }),
});
export function projectTemplate(
  name: string,
  template: Template,
  preset: Preset = "modern-minimal",
): Record<string, string> {
  const files: Record<string, string> = base(name, preset);
  if (template === "astro") {
    files["package.json"] = json({
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "astro dev",
        build: "astro build",
        preview: "astro preview",
        typecheck: "astro check",
        test: "node --test tests/*.test.mjs",
      },
      dependencies: {
        ...commonDeps,
        astro: "7.3.8",
        "@astrojs/react": "7.0.1",
      },
      devDependencies: {
        ...commonDev,
        "@astrojs/check": "0.9.10",
        "@tailwindcss/vite": "4.3.3",
      },
    });
    files["astro.config.mjs"] =
      "import {defineConfig} from 'astro/config';import react from '@astrojs/react';import tailwindcss from '@tailwindcss/vite';export default defineConfig({integrations:[react()],vite:{plugins:[tailwindcss()]}});\n";
    files["tsconfig.json"] = json({
      extends: "astro/tsconfigs/strict",
      compilerOptions: {
        jsx: "react-jsx",
        jsxImportSource: "react",
        paths: { "@/*": ["./src/*"] },
      },
    });
    files["src/layouts/Layout.astro"] =
      `---\nimport '../styles/globals.css';const {title='${name}',description='A thoughtful place for your next idea.'}=Astro.props;\n---\n<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="description" content={description}/><title>{title}</title></head><body><a class="skip-link" href="#main">Skip to content</a><header><nav class="container" aria-label="Main navigation"><a href="/" aria-label="Home"><strong>${name}</strong></a><div class="links"><a href="/programs">Programs</a><a href="/contact">Contact</a></div></nav></header><main id="main" class="container"><slot/></main><footer><div class="container">${name} · Built for people.</div></footer></body></html>\n`;
    files["src/pages/index.astro"] =
      `---\nimport Layout from '../layouts/Layout.astro';\n---\n<Layout><section class="hero"><span class="eyebrow">A new perspective</span><h1>Make room for what comes next.</h1><p>A considered starting point with space for your story, your community, and the work that matters.</p><a class="button" href="/programs">Explore programs</a></section><section aria-labelledby="values"><h2 id="values">Designed around people.</h2><div class="grid">{['Learn with purpose','Build together','Find your direction'].map((title)=><article class="card"><h3>{title}</h3><p>Clear goals, thoughtful support, and practical opportunities to take the next step.</p></article>)}</div></section></Layout>\n`;
    files["src/pages/programs.astro"] =
      "---\nimport Layout from '../layouts/Layout.astro';\n---\n<Layout title='Programs'><section class='hero'><span class='eyebrow'>Explore</span><h1>A path for every ambition.</h1><p>Replace this starter content with your own programs and admission details.</p></section><div class='grid'>{['Foundations','Creative practice','Advanced learning'].map(title=><article class='card'><h2>{title}</h2><p>Discover the possibilities and talk with our team.</p><a href='/contact'>Ask about this program</a></article>)}</div></Layout>\n";
    files["src/components/Contact.tsx"] =
      "import {useState} from 'react';import {Button} from './ui/button';export default function Contact(){const [message,setMessage]=useState('');return <form onSubmit={e=>{e.preventDefault();setMessage('Preview validated. Connect your backend before accepting submissions.');}}><label>Name<input name='name' required autoComplete='name'/></label><label>Email<input name='email' type='email' required autoComplete='email'/></label><label>Message<textarea name='message' required rows={5}/></label><Button type='submit'>Validate preview</Button><p role='status'>{message}</p></form>;}\n";
    files["src/pages/contact.astro"] =
      "---\nimport Layout from '../layouts/Layout.astro';import Contact from '../components/Contact';\n---\n<Layout title='Contact'><section class='hero'><span class='eyebrow'>Get in touch</span><h1>Start a conversation.</h1><p>This local starter validates input. Configure a real API before accepting public submissions.</p><Contact client:load/></section></Layout>\n";
    files["tests/routes.test.mjs"] =
      "import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';test('every navigation route exists',async()=>{for(const route of ['index','programs','contact'])assert.ok((await readFile(`src/pages/${route}.astro`,'utf8')).includes('Layout'));});\n";
  } else if (template === "next" || template === "next-fullstack") {
    const full = template === "next-fullstack";
    files["package.json"] = json({
      name,
      version: "0.1.0",
      private: true,
      scripts: {
        dev: "next dev --webpack",
        build: "next build",
        start: "next start",
        typecheck: "tsc --noEmit",
        test: "node --test tests/*.test.mjs",
        ...(full
          ? {
              setup:
                "node scripts/setup-auth.mjs && prisma generate && prisma db push",
              postinstall: "prisma generate",
              migrate: "prisma migrate dev",
            }
          : {}),
      },
      dependencies: {
        ...commonDeps,
        next: "16.4.0",
        ...(full
          ? {
              "better-auth": "1.7.7",
              "@prisma/client": "7.10.0",
              "@prisma/adapter-better-sqlite3": "7.10.0",
            }
          : {}),
      },
      devDependencies: {
        ...commonDev,
        "@tailwindcss/postcss": "4.3.3",
        ...(full ? { prisma: "7.10.0" } : {}),
      },
    });
    files["tsconfig.json"] = json({
      compilerOptions: {
        ...compiler,
        jsx: "preserve",
        incremental: true,
        plugins: [{ name: "next" }],
        paths: { "@/*": ["./src/*"] },
      },
      include: [
        "next-env.d.ts",
        "src/**/*.ts",
        "src/**/*.tsx",
        ".next/types/**/*.ts",
      ],
      exclude: ["node_modules"],
    });
    files["next-env.d.ts"] =
      '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n';
    files["postcss.config.mjs"] =
      "export default {plugins:{'@tailwindcss/postcss':{}}};\n";
    files["src/app/layout.tsx"] =
      `import '../styles/globals.css';export const metadata={title:'${name}',description:'A clear starting point for your next idea.'};export default function Layout({children}:{children:React.ReactNode}){return <html lang='en'><body><a className='skip-link' href='#main'>Skip to content</a><header><nav className='container' aria-label='Main navigation'><a href='/'><strong>${name}</strong></a><div className='links'><a href='/about'>About</a>${full ? "<a href='/account'>Account</a>" : ""}</div></nav></header><main id='main' className='container'>{children}</main><footer><div className='container'>${name} · Your next chapter.</div></footer></body></html>;}\n`;
    files["src/app/page.tsx"] =
      "import {Button} from '@/components/ui/button';export default function Home(){return <><section className='hero'><span className='eyebrow'>Built with intention</span><h1>Ideas deserve a strong foundation.</h1><p>A responsive, accessible workspace for the product you want to bring to life.</p><Button asChild><a href='/about'>Explore the project</a></Button></section><div className='grid'>{['Clear by design','Ready to grow','Made for people'].map(title=><article className='card' key={title}><h2>{title}</h2><p>Replace this starter story with your product, your values, and your customers.</p></article>)}</div></>;}\n";
    files["src/app/about/page.tsx"] =
      "export default function About(){return <section className='hero'><span className='eyebrow'>Our purpose</span><h1>Thoughtful from the start.</h1><p>Tell your story here. Every interaction should help someone move forward.</p><a className='button' href='/'>Back home</a></section>;}\n";
    files["src/app/api/health/route.ts"] =
      "export function GET(){return Response.json({status:'ok'});}\n";
    files["src/lib/note-input.mjs"] =
      "export function validateNote(value){return typeof value==='string'&&value.trim().length>0&&value.length<=10000?value.trim():null;}\n";
    files["tests/input.test.mjs"] =
      "import {test} from 'node:test';import assert from 'node:assert/strict';import {validateNote} from '../src/lib/note-input.mjs';test('reject malformed and oversized input',()=>{for(const v of [null,{},'', ' ', 'x'.repeat(10001)])assert.equal(validateNote(v),null);assert.equal(validateNote('  hello  '),'hello');});\n";
    if (full) {
      files["prisma.config.ts"] =
        "import {defineConfig} from 'prisma/config';export default defineConfig({schema:'prisma/schema.prisma',datasource:{url:process.env.DATABASE_URL??'file:./prisma/dev.db'}});\n";
      files["prisma/schema.prisma"] =
        `generator client {\n provider = "prisma-client"\n output = "../src/generated/prisma"\n}\ndatasource db {\n provider = "sqlite"\n}\nmodel User {\n id String @id\n name String\n email String @unique\n emailVerified Boolean @default(false)\n image String?\n createdAt DateTime @default(now())\n updatedAt DateTime @updatedAt\n sessions Session[]\n accounts Account[]\n notes Note[]\n}\nmodel Session {\n id String @id\n token String @unique\n expiresAt DateTime\n createdAt DateTime @default(now())\n updatedAt DateTime @updatedAt\n ipAddress String?\n userAgent String?\n userId String\n user User @relation(fields:[userId],references:[id],onDelete:Cascade)\n}\nmodel Account {\n id String @id\n accountId String\n providerId String\n userId String\n user User @relation(fields:[userId],references:[id],onDelete:Cascade)\n accessToken String?\n refreshToken String?\n idToken String?\n accessTokenExpiresAt DateTime?\n refreshTokenExpiresAt DateTime?\n scope String?\n password String?\n createdAt DateTime @default(now())\n updatedAt DateTime @updatedAt\n}\nmodel Verification {\n id String @id\n identifier String\n value String\n expiresAt DateTime\n createdAt DateTime @default(now())\n updatedAt DateTime @updatedAt\n}\nmodel Note {\n id String @id @default(cuid())\n body String\n userId String\n user User @relation(fields:[userId],references:[id],onDelete:Cascade)\n createdAt DateTime @default(now())\n}\n`;
      files["scripts/setup-auth.mjs"] =
        "import {randomBytes} from 'node:crypto';import {writeFile} from 'node:fs/promises';try{await writeFile('.env.local','BETTER_AUTH_SECRET='+randomBytes(32).toString('hex')+'\\n',{flag:'wx',mode:0o600});console.log('Created a private local auth secret.');}catch(e){if(e.code!=='EEXIST')throw e;console.log('Kept existing local auth configuration.');}\n";
      files["src/lib/db.ts"] =
        "import {PrismaClient} from '@/generated/prisma/client';import {PrismaBetterSqlite3} from '@prisma/adapter-better-sqlite3';const globalDb=globalThis as unknown as {db?:PrismaClient};export const db=globalDb.db??new PrismaClient({adapter:new PrismaBetterSqlite3({url:process.env.DATABASE_URL??'file:./prisma/dev.db'})});if(process.env.NODE_ENV!=='production')globalDb.db=db;\n";
      files["src/lib/auth.ts"] =
        "import {betterAuth} from 'better-auth';import {prismaAdapter} from 'better-auth/adapters/prisma';import {db} from './db';export const auth=betterAuth({database:prismaAdapter(db,{provider:'sqlite'}),secret:process.env.BETTER_AUTH_SECRET,baseURL:process.env.BETTER_AUTH_URL??'http://127.0.0.1:3000',trustedOrigins:[process.env.BETTER_AUTH_URL??'http://127.0.0.1:3000'],emailAndPassword:{enabled:true}});\n";
      files["src/app/api/auth/[...all]/route.ts"] =
        "import {auth} from '@/lib/auth';import {toNextJsHandler} from 'better-auth/next-js';export const {GET,POST}=toNextJsHandler(auth);\n";
      files["src/app/api/notes/route.ts"] =
        "import {auth} from '@/lib/auth';import {db} from '@/lib/db';import {validateNote} from '@/lib/note-input.mjs';async function session(request:Request){return auth.api.getSession({headers:request.headers});}export async function GET(request:Request){const s=await session(request);if(!s)return Response.json({error:'Unauthorized'},{status:401});return Response.json(await db.note.findMany({where:{userId:s.user.id},orderBy:{createdAt:'desc'}}));}export async function POST(request:Request){const s=await session(request);if(!s)return Response.json({error:'Unauthorized'},{status:401});let value;try{value=await request.json();}catch{return Response.json({error:'Invalid JSON'},{status:400});}const body=validateNote(value?.body);if(!body)return Response.json({error:'A note of 1–10000 characters is required'},{status:400});return Response.json(await db.note.create({data:{body,userId:s.user.id}}),{status:201});}\n";
      files["src/app/api/notes/[id]/route.ts"] =
        "import {auth} from '@/lib/auth';import {db} from '@/lib/db';import {validateNote} from '@/lib/note-input.mjs';export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){const s=await auth.api.getSession({headers:request.headers});if(!s)return Response.json({error:'Unauthorized'},{status:401});let input;try{input=await request.json();}catch{return Response.json({error:'Invalid JSON'},{status:400});}const body=validateNote(input?.body);if(!body)return Response.json({error:'A note of 1–10000 characters is required'},{status:400});const {id}=await params;const result=await db.note.updateMany({where:{id,userId:s.user.id},data:{body}});return result.count?Response.json({id,body}):Response.json({error:'Not found'},{status:404});}export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){const s=await auth.api.getSession({headers:request.headers});if(!s)return Response.json({error:'Unauthorized'},{status:401});const {id}=await params;const result=await db.note.deleteMany({where:{id,userId:s.user.id}});return result.count?new Response(null,{status:204}):Response.json({error:'Not found'},{status:404});}\n";
      files["src/app/account/page.tsx"] = accountTemplate;
      files["README.md"] =
        "# Local full-stack starter\n\nInstall dependencies, then run `npm run setup` before typecheck/build/dev. Setup creates a random private `.env.local` auth secret, generates Prisma, and initializes local SQLite. Remote Studio preview supplies BETTER_AUTH_URL for its assigned loopback port. Sign-up/sign-in, per-user note creation/list/editing/deletion are real local operations. No cloud service is required. Do not publish with development configuration.\n";
    }
  } else {
    const native = template === "electron";
    files["package.json"] = json({
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      ...(native ? { main: "out/main/index.js" } : {}),
      scripts: {
        dev: native ? "electron-vite dev" : "vite",
        build: native ? "electron-vite build" : "tsc && vite build",
        typecheck: "tsc --noEmit",
        test: "node --test tests/*.test.mjs",
        ...(native
          ? { package: "electron-builder --dir" }
          : template === "tauri"
            ? { "desktop:dev": "tauri dev", "desktop:build": "tauri build" }
            : {}),
      },
      dependencies: {
        ...commonDeps,
        ...(template === "tauri" ? { "@tauri-apps/api": "2.12.3" } : {}),
      },
      devDependencies: {
        ...commonDev,
        vite: "7.3.7",
        "@vitejs/plugin-react": "5.2.0",
        "@tailwindcss/vite": "4.3.3",
        ...(native
          ? {
              electron: "44.7.0",
              "electron-vite": "5.0.0",
              "electron-builder": "26.15.3",
            }
          : template === "tauri"
            ? { "@tauri-apps/cli": "2.12.2" }
            : {}),
      },
      ...(native
        ? {
            build: {
              appId: "com.example." + name,
              productName: name,
              files: ["out/**/*", "package.json"],
              directories: { output: "release" },
              mac: { target: "dmg" },
              win: { target: "nsis" },
            },
          }
        : {}),
    });
    files["tsconfig.json"] = json({
      compilerOptions: {
        ...compiler,
        paths: { "@/*": ["./src/*"] },
        types: ["vite/client", "node"],
      },
      include: ["src", "electron", "*.ts"],
    });
    files[native ? "src/index.html" : "index.html"] =
      `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>${native ? "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'\"/>" : ""}<title>${name}</title></head><body><div id="root"></div><script type="module" src="${native ? "./main.tsx" : "/src/main.tsx"}"></script></body></html>`;
    files["src/main.tsx"] =
      `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Button} from './components/ui/button';import './styles/globals.css';function App(){const [count,setCount]=useState(0);${native ? "const [status,setStatus]=useState('');" : ""}return <main className='container'><section className='hero'><span className='eyebrow'>${native ? "Desktop workspace" : "A fresh start"}</span><h1>Build something worth using.</h1><p>A responsive foundation with clear boundaries and thoughtful defaults.</p><div className='actions'><Button onClick={()=>setCount(n=>n+1)}>Count: {count}</Button>${native ? "<Button onClick={async()=>{try{setStatus('Version '+await window.app.version());}catch{setStatus('Could not read the app version.');}}}>App version</Button>" : ""}</div>${native ? "<p role='status'>{status}</p>" : ""}</section></main>;}createRoot(document.getElementById('root')!).render(<App/>);\n`;
    files["tests/input.test.mjs"] =
      "import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';test('renderer has no privileged imports',async()=>{const source=await readFile('src/main.tsx','utf8');assert.ok(!source.includes(\"from 'electron'\"));assert.ok(!source.includes(\"from 'node:\"));});\n";
    if (native) {
      files["electron.vite.config.ts"] =
        `import {defineConfig} from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {resolve} from 'node:path';
export default defineConfig({
  main:{build:{rollupOptions:{input:resolve('electron/main.ts'),output:{entryFileNames:'index.js'}}}},
  preload:{build:{rollupOptions:{input:resolve('electron/preload.ts'),output:{format:'cjs',entryFileNames:'index.cjs'}}}},
  renderer:{root:'src',plugins:[react(),tailwindcss(),{
    name:'development-csp',
    transformIndexHtml(html,context){
      return context.server ? html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*") : html;
    }
  }],build:{rollupOptions:{input:resolve('src/index.html')}}}
});\n`;
      files["electron/main.ts"] =
        "import {app,BrowserWindow,ipcMain} from 'electron';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';const __dirname=dirname(fileURLToPath(import.meta.url));app.setName('" +
        name +
        "');if(process.env.STUDIO_APP_USER_DATA)app.setPath('userData',process.env.STUDIO_APP_USER_DATA);if(!app.requestSingleInstanceLock())app.quit();else{app.whenReady().then(()=>{const win=new BrowserWindow({width:1100,height:780,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:join(__dirname,'../preload/index.cjs')}});ipcMain.handle('app:version',event=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('Untrusted sender');return app.getVersion();});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());if(process.env.ELECTRON_RENDERER_URL)void win.loadURL(process.env.ELECTRON_RENDERER_URL);else void win.loadFile(join(__dirname,'../renderer/index.html'));});app.on('window-all-closed',()=>app.quit());}\n";
      files["electron/preload.ts"] =
        "import {contextBridge,ipcRenderer} from 'electron';contextBridge.exposeInMainWorld('app',{version:()=>ipcRenderer.invoke('app:version')});\n";
      files["src/app.d.ts"] =
        "export {};declare global{interface Window{app:{version():Promise<string>}}}\n";
    } else
      files["vite.config.ts"] =
        "import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import tailwindcss from '@tailwindcss/vite';import {resolve} from 'node:path';export default defineConfig({plugins:[react(),tailwindcss()],resolve:{alias:{'@':resolve('src')}}});\n";
    if (template === "tauri") {
      files["src-tauri/Cargo.toml"] =
        `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n[build-dependencies]\ntauri-build = { version = "2", features = [] }\n[dependencies]\ntauri = { version = "2", features = [] }\n`;
      files["src-tauri/build.rs"] = "fn main() { tauri_build::build() }\n";
      files["src-tauri/src/main.rs"] =
        '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\nfn main() { tauri::Builder::default().run(tauri::generate_context!()).expect("application error"); }\n';
      files["src-tauri/tauri.conf.json"] = json({
        $schema: "https://schema.tauri.app/config/2",
        productName: name,
        version: "0.1.0",
        identifier: "com.example." + name,
        build: {
          beforeDevCommand:
            "npm run dev -- --host 127.0.0.1 --port 1420 --strictPort",
          devUrl: "http://127.0.0.1:1420",
          beforeBuildCommand: "npm run build",
          frontendDist: "../dist",
        },
        app: {
          windows: [{ title: name, width: 1100, height: 780 }],
          security: {
            csp: "default-src 'self'; style-src 'self' 'unsafe-inline'",
          },
        },
        bundle: { active: false },
      });
      files["src-tauri/capabilities/default.json"] = json({
        identifier: "default",
        description: "Main window defaults only",
        windows: ["main"],
        permissions: ["core:default"],
      });
    }
  }
  if (files["package.json"]) {
    // Match the source lockfile rather than resolving a newly published Rollup
    // tarball during the first install. Keep its native optional packages in sync.
    const pkg = JSON.parse(files["package.json"]);
    pkg.overrides = { ...pkg.overrides, rollup: "4.64.3" };
    files["package.json"] = json(pkg);
    files["pnpm-workspace.yaml"] = "overrides:\n  rollup: 4.64.3\n";
  }
  return files;
}
