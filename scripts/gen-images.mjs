// 生成游戏美术资源：调用 gpt-image-2.5-sunburst，PNG 落到 assets-src/，再用 PowerShell 转成压缩 JPEG 到 public/assets/
// 用法：XXAPI_KEY=sk-xxx node scripts/gen-images.mjs [only-id ...]
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";

const KEY = process.env.XXAPI_KEY;
if (!KEY) { console.error("缺少 XXAPI_KEY 环境变量"); process.exit(1); }
const API = "https://xxapi.info/v1/images/generations";
const MODEL = "gpt-image-2.5-sunburst";

const STYLE = "painterly digital illustration, soft brush texture, deep navy night palette with warm amber lamp light, restrained and calm mood, no text, no watermark, no letters";
const ASSETS = [
  { id: "bg-desk", size: "1536x1024", width: 1600, quality: 72,
    prompt: `Top-down slightly angled view of an old wooden post office desk at midnight. Warm brass desk lamp pooling light on kraft paper envelopes, red wax seals, a glass ink bottle, wooden rubber stamps, a small brass bell, a cup of tea with steam. Deep navy shadows at the edges, quiet and cozy. Wide composition with empty space in the center for UI. ${STYLE}` },
  { id: "liukanshan", size: "1024x1024", width: 512, quality: 82,
    prompt: `Cute white arctic fox mascot with round face and small black eyes, wearing a tiny navy postman cap with a brass badge and a bright blue scarf, holding a kraft envelope with both paws, sitting upright, friendly calm expression. Centered bust portrait, flat-shaded vector style with soft shading, plain dark navy background (#0c1526). no text` },
  { id: "char-laozhou", size: "1024x1024", width: 512, quality: 80,
    prompt: `Bust portrait of a warm Chinese man in his early forties, reading glasses pushed up, grey cardigan over a shirt, gentle tired smile, sitting under a warm desk lamp at night, holding a mug. Looking slightly off camera as if remembering something. Plain dark navy background. ${STYLE}` },
  { id: "char-data", size: "1024x1024", width: 512, quality: 80,
    prompt: `Bust portrait of a sharp young Chinese woman with a short bob haircut and thin metal glasses, black turtleneck, neutral analytical expression, faint translucent line-charts and numbers glowing in cool blue behind her, cool rim light on one side and warm lamp light on the other. Plain dark navy background. ${STYLE}` },
  { id: "char-contrarian", size: "1024x1024", width: 512, quality: 80,
    prompt: `Bust portrait of a lean Chinese man in his thirties, black hoodie, unshaven, one eyebrow raised skeptically, slight smirk, a black crow perched on his shoulder looking at the viewer, moody low-key lighting. Plain dark navy background. ${STYLE}` },
  { id: "char-silent", size: "1024x1024", width: 512, quality: 80,
    prompt: `A person seen from behind, sitting alone on a chair by a tall window at night, face not visible, city lights and gentle rain outside, a single warm lamp reflection on the glass, quiet loneliness. Plain dark navy background. ${STYLE}` },
  { id: "card-paper", size: "1024x1536", width: 900, quality: 78,
    prompt: `Vertical kraft paper postcard texture, aged warm beige paper with subtle fibers, faint circular postmark stamps in navy ink in the corners, a small red wax seal at the bottom center, a thin dashed border like a vintage stamp edge, mostly empty space in the middle. Clean flat lighting. no text, no letters, no words` },
  { id: "envelope", size: "1024x1024", width: 640, quality: 80,
    prompt: `A single sealed kraft paper envelope lying flat, slightly rotated, with a red wax seal and a blue vintage postage stamp in the corner, a few dried osmanthus flowers beside it, warm lamp light from top left, deep navy wooden desk background. ${STYLE}` },
];

const only = process.argv.slice(2);
const list = only.length ? ASSETS.filter(a => only.includes(a.id)) : ASSETS;

async function gen(a) {
  const src = path.join("assets-src", `${a.id}.png`);
  if (!existsSync(src)) {
    const t0 = Date.now();
    const res = await fetch(API, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt: a.prompt, n: 1, size: a.size, quality: "medium" }) });
    const json = await res.json();
    if (!json.data?.[0]?.b64_json) throw new Error(`${a.id}: 生成失败 ${JSON.stringify(json).slice(0, 300)}`);
    await writeFile(src, Buffer.from(json.data[0].b64_json, "base64"));
    console.log(`✓ ${a.id} 生成 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } else console.log(`· ${a.id} 已存在，跳过生成`);
  await toJpeg(src, path.join("public", "assets", `${a.id}.jpg`), a.width, a.quality);
}

function toJpeg(src, out, width, quality) {
  const ps = `
Add-Type -AssemblyName System.Drawing
$img=[System.Drawing.Image]::FromFile((Resolve-Path '${src}'))
$w=[int]${width}; if($img.Width -lt $w){$w=$img.Width}; $h=[int]($img.Height*$w/$img.Width)
$bmp=New-Object System.Drawing.Bitmap($w,$h)
$g=[System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode='HighQualityBicubic'; $g.SmoothingMode='HighQuality'; $g.DrawImage($img,0,0,$w,$h)
$codec=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object {$_.MimeType -eq 'image/jpeg'}
$ep=New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality,[long]${quality})
$bmp.Save('${path.resolve(out)}',$codec,$ep); $g.Dispose(); $bmp.Dispose(); $img.Dispose()
Write-Output ("{0}x{1}" -f $w,$h)`;
  return new Promise((ok, bad) => execFile("powershell", ["-NoProfile", "-Command", ps], (err, stdout, stderr) => {
    if (err) return bad(new Error(`${out}: ${stderr || err.message}`));
    console.log(`  → ${out} ${stdout.trim()}`); ok();
  }));
}

await mkdir("assets-src", { recursive: true }); await mkdir("public/assets", { recursive: true });
let failed = 0;
// 两路并发
const queue = [...list];
await Promise.all([0, 1].map(async () => { while (queue.length) { const a = queue.shift(); try { await gen(a); } catch (e) { failed++; console.error("✗", e.message); } } }));
console.log(failed ? `完成，${failed} 个失败` : "全部完成");
process.exit(failed ? 1 : 0);
