// 零依赖生成插件图标 PNG（圆角渐变底 + 白色播放三角）
// 用法：node tools/gen-icons.js

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const C1 = [255, 77, 109]; // #ff4d6d
const C2 = [177, 77, 255]; // #b14dff
const SIZES = [16, 32, 48, 128];
const SS = 4; // 每像素超采样

function insideRoundRect(x, y) {
  // 单位坐标系 [0,1]，圆角半径 0.22：钳位到圆心后按距离判断
  const r = 0.22;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideTriangle(x, y) {
  const [ax, ay, bx, by, cx2, cy2] = [0.4, 0.27, 0.4, 0.73, 0.72, 0.5];
  const s1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const s2 = (cx2 - bx) * (y - by) - (cy2 - by) * (x - bx);
  const s3 = (ax - cx2) * (y - cy2) - (ay - cy2) * (x - cx2);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (!insideRoundRect(x, y)) continue;
          a += 1;
          if (insideTriangle(x, y)) {
            r += 255; g += 255; b += 255;
          } else {
            const t = Math.min(1, Math.max(0, (x * 0.7 + y * 0.3)));
            r += C1[0] + (C2[0] - C1[0]) * t;
            g += C1[1] + (C2[1] - C1[1]) * t;
            b += C1[2] + (C2[2] - C1[2]) * t;
          }
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = Math.round((a / n) * 255);
    }
  }
  return rgba;
}

// ---- PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const s of SIZES) {
  fs.writeFileSync(path.join(outDir, `icon${s}.png`), encodePNG(render(s), s));
  console.log(`✓ icons/icon${s}.png`);
}
