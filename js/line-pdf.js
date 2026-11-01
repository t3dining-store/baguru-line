/* =====================================================================
 *  紙の LINE 引き継ぎQRを、A6 の PDF にする（2026-11-02 ko-dai さんの指示：1つのQRを A6 で1枚ずつ、15枚にして保管する）
 *  ・1ページに1つのQR。どの数のQRか、LINE からの引き継ぎのQRかが、見て分かるようにする
 *  ・各ページを絵（300dpi）に描いて PDF に並べる。字の形を PDF に入れなくて済み、外の部品も要らない
 *  ・★PDF はこの端末の中で作る。コードを受け口の外へ送らない
 * ===================================================================== */

const A6_MM = { w: 105, h: 148 };
const A6_PX = { w: 1240, h: 1748 };                                  // 300dpi
const A6_PT = { w: A6_MM.w / 25.4 * 72, h: A6_MM.h / 25.4 * 72 };    // PDF の大きさの単位
const PDF_FONT = '"Zen Kaku Gothic New", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

/** 1枚の絵を描く。t … { n, code }。QR の中身の形は、公式アプリの ticketFrom と同じ */
function ticketCanvas(t) {
  const cv = document.createElement('canvas');
  Object.assign(cv, { width: A6_PX.w, height: A6_PX.h });
  const x = cv.getContext('2d');
  const mid = A6_PX.w / 2;
  const text = (s, y, size, color = '#221c18', weight = 700) => {
    x.font = `${weight} ${size}px ${PDF_FONT}`;
    x.fillStyle = color;
    x.textAlign = 'center';
    x.fillText(s, mid, y);
  };
  x.fillStyle = '#fff';
  x.fillRect(0, 0, A6_PX.w, A6_PX.h);

  // 上の帯：何のQRか
  x.fillStyle = '#1f1916';
  x.fillRect(0, 0, A6_PX.w, 290);
  x.fillStyle = '#c7361d';
  x.fillRect(0, 290, A6_PX.w, 12);
  text('炭焼ハンバーグ バグる', 96, 50, '#ffffff', 500);
  text('LINEからの引き継ぎ', 222, 112, '#ffffff');

  // どの数か：数字をいちばん大きく
  x.font = `700 250px ${PDF_FONT}`;
  const numW = x.measureText(String(t.n)).width;
  x.font = `700 100px ${PDF_FONT}`;
  const unitW = x.measureText('ポイント').width;
  const left = mid - (numW + 24 + unitW) / 2;
  x.textAlign = 'left';
  x.fillStyle = '#c7361d';
  x.font = `700 250px ${PDF_FONT}`;
  x.fillText(String(t.n), left, 556);
  x.fillStyle = '#221c18';
  x.font = `700 100px ${PDF_FONT}`;
  x.fillText('ポイント', left + numW + 24, 556);

  // QR：まわりの白を残して、線がにじまないように整数の大きさで描く
  const q = qrcode(0, 'M');
  q.addData(`BAGURULINE:${t.code}`);
  q.make();
  const count = q.getModuleCount(), cell = Math.floor(820 / count), size = cell * count;
  const left2 = Math.round(mid - size / 2), top = 610;
  x.fillStyle = '#000';
  for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (q.isDark(r, c)) x.fillRect(left2 + c * cell, top + r * cell, cell, cell);

  // 下の案内（店員用）
  const y = top + size + 84;
  text('LINEの画面と同じ数のQRを、お客様に見せてください', y, 44);
  text('アプリの「LINEのポイントカードをお持ちの方」→「紙のQRを読む」', y + 64, 33, '#675d55', 500);
  text('読んでもらったら回収します（お客様に渡しません）', y + 118, 33, '#675d55', 500);
  return cv;
}

const canvasJpeg = cv => new Promise(ok => cv.toBlob(b => b.arrayBuffer().then(buf => ok(new Uint8Array(buf))), 'image/jpeg', 0.95));

/** JPEG の絵を1ページずつ並べた PDF を作る。pages … { jpeg, w, h } の配列 */
function pdfFromJpegs(pages) {
  const parts = [], offsets = [];
  const enc = new TextEncoder();
  let pos = 0;
  const put = v => { const b = typeof v === 'string' ? enc.encode(v) : v; parts.push(b); pos += b.length; };
  const obj = (id, write) => { offsets[id] = pos; put(`${id} 0 obj\n`); write(); put('\nendobj\n'); };
  const pageId = i => 3 + i * 3, drawId = i => 4 + i * 3, imageId = i => 5 + i * 3;
  const pt = n => n.toFixed(2);

  put('%PDF-1.4\n');
  obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => put(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`));
  pages.forEach((p, i) => {
    obj(pageId(i), () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(A6_PT.w)} ${pt(A6_PT.h)}] /Resources << /XObject << /Im ${imageId(i)} 0 R >> >> /Contents ${drawId(i)} 0 R >>`));
    const draw = `q ${pt(A6_PT.w)} 0 0 ${pt(A6_PT.h)} 0 0 cm /Im Do Q`;
    obj(drawId(i), () => { put(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`); });
    obj(imageId(i), () => {
      put(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      put(p.jpeg);
      put('\nendstream');
    });
  });
  const start = pos, total = 3 + pages.length * 3;
  put(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id++) put(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

/** 券の配列から A6 の PDF を作る。1ページに1枚 */
async function ticketPdf(tickets) {
  await document.fonts?.load(`700 100px "Zen Kaku Gothic New"`).catch(() => {});
  const pages = [];
  for (const t of tickets) pages.push({ jpeg: await canvasJpeg(ticketCanvas(t)), ...A6_PX });
  return pdfFromJpegs(pages);
}
