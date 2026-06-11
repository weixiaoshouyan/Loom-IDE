const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; ihdrData[9] = 2; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
  const ihdrChunk = createChunk('IHDR', ihdrData);
  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 3;
      const di = y * (1 + width * 3) + 1 + x * 3;
      rawData[di] = pixels[si]; rawData[di+1] = pixels[si+1]; rawData[di+2] = pixels[si+2];
    }
  }
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let j = 0; j < 8; j++) { if (c & 1) c = (c >>> 1) ^ 0xEDB88320; else c >>>= 1; } }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const S = 256;
const px = Buffer.alloc(S * S * 3);

function sp(x, y, r, g, b) { if (x>=0&&x<S&&y>=0&&y<S) { const i=(y*S+x)*3; px[i]=r; px[i+1]=g; px[i+2]=b; } }
function bp(x, y, r, g, b, a) { if (x>=0&&x<S&&y>=0&&y<S) { const i=(y*S+x)*3; px[i]=Math.round(px[i]*(1-a)+r*a); px[i+1]=Math.round(px[i+1]*(1-a)+g*a); px[i+2]=Math.round(px[i+2]*(1-a)+b*a); } }

// Background gradient
for (let y=0;y<S;y++) for (let x=0;x<S;x++) { const t=(x+y)/(2*S); sp(x,y, Math.round(13+t*14), Math.round(27+t*13), Math.round(42+t*14)); }

// Grid lines
for (let x=0;x<S;x++) { bp(x,128,0,122,204,0.08); bp(x,96,0,122,204,0.04); bp(x,160,0,122,204,0.04); }
for (let y=0;y<S;y++) { bp(128,y,78,201,176,0.08); bp(96,y,78,201,176,0.04); bp(160,y,78,201,176,0.04); }

// Diagonal threads
for (let i=0;i<200;i++) { bp(56+i,56+i,78,201,176,0.04); bp(200-i,56+i,78,201,176,0.03); }

// L vertical bar
for (let y=40;y<220;y++) for (let x=58;x<86;x++) { const t=(y-40)/180; sp(x,y, Math.round(79*(1-t)+0*t), Math.round(193*(1-t)+122*t), Math.round(255*(1-t)+204*t)); }
// L horizontal bar
for (let y=193;y<221;y++) for (let x=58;x<185;x++) { const t=x/256; sp(x,y, Math.round(0*(1-t)+78*t), Math.round(122*(1-t)+201*t), Math.round(204*(1-t)+176*t)); }
// L border (darker outline)
for (let y=38;y<222;y++) { sp(56,y,0,80,140); sp(87,y,0,80,140); sp(56,y,0,80,140); }
for (let x=56;x<186;x++) { sp(x,191,0,80,140); sp(x,222,0,80,140); }
for (let y=191;y<222;y++) { sp(186,y,0,80,140); }

// Inner L accent
for (let y=58;y<192;y++) for (let x=86;x<96;x++) bp(x,y,78,201,176,0.25);
for (let y=180;y<192;y++) for (let x=86;x<165;x++) bp(x,y,78,201,176,0.25);

// Center node
for (let dy=-8;dy<=8;dy++) for (let dx=-8;dx<=8;dx++) if(dx*dx+dy*dy<=64) bp(128+dx,128+dy,78,201,176,0.9);
for (let dy=-4;dy<=4;dy++) for (let dx=-4;dx<=4;dx++) if(dx*dx+dy*dy<=16) bp(128+dx,128+dy,255,255,255,0.2);

// Constellation nodes
[[60,128,4,0,122,204,0.5],[196,128,4,0,122,204,0.5],[128,60,4,78,201,176,0.4],[128,196,4,78,201,176,0.4],[185,72,3,79,193,255,0.6],[75,185,2,79,193,255,0.3]].forEach(([nx,ny,nr,r,g,b,a])=>{
  for(let dy=-nr;dy<=nr;dy++) for(let dx=-nr;dx<=nr;dx++) if(dx*dx+dy*dy<=nr*nr) bp(nx+dx,ny+dy,r,g,b,a);
});

// Neural connections
for(let i=0;i<68;i++) bp(60+i,128,0,122,204,0.08);
for(let i=0;i<68;i++) bp(128+i,128,0,122,204,0.08);
for(let i=0;i<68;i++) bp(128,60+i,78,201,176,0.08);
for(let i=0;i<68;i++) bp(128,128+i,78,201,176,0.08);

// AI sparkle glow at top-right
for (let dy=-20;dy<=20;dy++) for (let dx=-20;dx<=20;dx++) {
  const d=Math.sqrt(dx*dx+dy*dy);
  if(d<20) bp(185+dx,72+dy,79,193,255,Math.max(0,(20-d)/20)*0.15);
}

const png = createPNG(S, S, px);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('Generated icon.png:', png.length, 'bytes');
