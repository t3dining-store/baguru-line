/* =====================================================================
 *  バグるLINE引き継ぎ（LINE のポイントを、スタンプの台帳に引き継ぐためのお店の人用のアプリ。2026-11-02 ko-dai さんの指示）
 *  ・LINE の引き継ぎは紙の QR だけ（下の「紙の引き継ぎ券」。2026-11-02 ko-dai さんの指示で、会員番号で探して数を入れる形はやめた）。
 *    A6 の PDF にして保存する（js/line-pdf.js）。券は何度でも使える。★コードは画面の中に持つだけで、受け口に残さない
 *  ・同じ券をこのアプリの画面にも出せる（下の「画面に出すQR」。2026-11-02 ko-dai さんの指示）。画面用の1組だけは、この端末に覚える
 *  ・「会員を探す」は、数を直すとき（memberFix）だけ。数を決めるのは受け口の台帳（../スタンプ台帳の決めごと.md の7節・9節）
 *  ・送る前に番号と数を確かめる画面を1つ挟む
 *  ・★電話番号は大きく出さない。電話番号で探したときの突き合わせに、下4けただけ小さく出す
 *  ・★api.js は、返事を読めないと黙って2回まで送り直す。memberFix は rid を付けて送る（受け口の版 2026-11-02a から）。返ってきた数が違えば知らせる
 *  ・合言葉は予約ボード・Order受付・マネージと同じ置き場所（localStorage の baguru.daicho.pin）。1度入れたら、この端末に覚える
 *  ・★この Mac で試すときは、にせの受け口（プレビュー「予約の受け口（試し）」）から ?test を付けて開く。本物で試さない
 * ===================================================================== */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---- バグる Owner・バグる Staff から開いたときだけ「🏠 ホーム」（Order受付と同じ印。わけは バグるOrder受付/js/store.js の頭） ---- */
const OWNER_URL = 'https://t3dining.github.io/baguru-owner/';
const STAFF_URL = 'https://t3dining.github.io/baguru-staff/';
const FROM_OWNER = (() => {
  const mark = /[?&]from=owner\b/.test(location.search);
  try {
    if (mark) sessionStorage.setItem('bg.fromOwner', '1');
    return sessionStorage.getItem('bg.fromOwner') === '1';
  } catch (e) { return mark; }
})();
function goOwner() {
  let to = '';
  try { to = sessionStorage.getItem('bg.owner') || ''; } catch (e) {}
  if (!to) try { to = localStorage.getItem('bg.hub') || ''; } catch (e) {}
  if (/[?&]hub=staff\b/.test(location.search) && !/staff/i.test(to)) to = STAFF_URL;
  location.href = to || OWNER_URL;
}
if (FROM_OWNER) {
  $('#homeBtn').hidden = false;
  $('#homeBtn').onclick = goOwner;
}

/* ---- Android でホーム画面に入れる（2026-11-02 ko-dai さんの指示：Chrome のマークが付かないように。公式アプリの js/install.js と同じ考え方） ----
 *  サービスワーカー（sw.js。何も保存しない）があると、Chrome が「インストールしますか」を出せる。
 *  メニューから「ショートカットを作成」で入れると Chrome のマークが付くので、Android ではこのボタンから入れてもらう。
 *  入れたあと（ホーム画面から開いたとき）と、バグる Owner・バグる Staff の中から開いたときは出さない */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
let installPrompt = null;
addEventListener('beforeinstallprompt', e => {
  if (!/Android/.test(navigator.userAgent) || FROM_OWNER) return;   // パソコンでは Chrome のふだんの案内のまま
  e.preventDefault();
  installPrompt = e;
  $('#install').hidden = false;
});
addEventListener('appinstalled', () => { installPrompt = null; $('#install').hidden = true; });
$('#installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  const p = installPrompt;
  installPrompt = null;   // 1回しか出せない。やめたときは、次に開いたときにまた出る
  $('#install').hidden = true;
  p.prompt();
  await p.userChoice.catch(() => {});
});

/* ---- 受け口（予約ボードの公開先の config.js・api.js を読む。公式アプリ・マネージと同じ） ---- */
const LOADED = {};
const loadJs = (src, integrity = '') => (LOADED[src] ??= new Promise((ok, ng) => {
  const s = document.createElement('script');
  if (integrity) Object.assign(s, { integrity, crossOrigin: 'anonymous' });
  Object.assign(s, { src, onload: ok, onerror: () => { delete LOADED[src]; s.remove(); ng(Object.assign(new Error('offline'), { code: 'offline' })); } });
  document.head.append(s);
}));
const api = () => loadJs(SHOP.reserveBase + 'config.js').then(() => loadJs(SHOP.reserveBase + 'api.js'))
  .then(() => { if (!window.BaguruApi?.ready()) throw Object.assign(new Error('not_ready'), { code: 'not_ready' }); });
const post = payload => api().then(() => BaguruApi.post(payload));

const MSG = {
  bad_pin: '合言葉が違います。',
  locked: '何度も違ったため、しばらく使えません。時間を置いてから、もう一度お試しください。',
  not_found: 'この番号の会員が見つかりませんでした。番号を確かめて、探し直してください。',
  need_register: 'この会員は登録がまだです。お客様のアプリで、先にお名前と電話番号を登録してもらってください。',
  bad_input: '入れた数を確かめてください。',
  busy: '受け口が混み合っています。少し待って、もう一度お試しください。',
  not_ready: '受け口の場所を読めませんでした。少し時間を置いてから、もう一度お試しください。',
  offline: 'つながりませんでした。電波の良い所で、もう一度お試しください。',
  no_answer: 'つながりませんでした。時間を置いて、もう一度お試しください。',
  forgot: '作っているあいだに画面のQRを消したので、作るのをやめました。もう一度お試しください。',
};
const message = e => MSG[e?.code] || MSG.no_answer;
const unsure = e => e?.code === 'no_answer' || e?.code === 'offline';   // 受け口に届いたかどうか分からない

const PIN_KEY = 'baguru.daicho.pin';
function pinGet() { try { return localStorage.getItem(PIN_KEY) || ''; } catch (e) { return ''; } }
function pinSet(v) { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) {} }
const staffPost = payload => post({ ...payload, pin: pinGet() });

const LINE_MAX = STAMP.lineMove.max;   // 受け口の LINE_MAX と同じ
const FIX_MAX = 50;                    // 受け口の memberFix の上限と同じ
const onCard = t => (t === 0 ? 0 : ((t - 1) % STAMP.goal) + 1);   // 公式アプリの stampOnCard と同じ。15個を超えた分は次のカードに進む
const stampCount = t => (onCard(t) === t ? `${t}個` : `${onCard(t)}個（累計${t}個）`);
const dayText = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fixRid = () => 'f' + [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

let members = [];       // 探した会員（受け口の形）
let asked = '';         // 探した言葉（電話番号で探したときだけ、下4けたを出す）
let pointing = null;    // 直している数 { m: 会員, n: 足す数（減らすときはマイナス）, note, rid }

/* ---- 画面 ---- */
function show(signedIn, loginText = '') {
  $('#wait').hidden = true;
  $('#tabs').hidden = !signedIn || !MEMBER_PLUS;
  $('#login').hidden = signedIn;
  $('#loginErr').textContent = loginText;
  $('#loginErr').hidden = !loginText;
  if (!signedIn) { $('#app').hidden = $('#paper').hidden = $('#screen').hidden = true; return $('#pin').focus(); }
  openTab(MEMBER_PLUS ? 'screen' : 'app');   // ふだんは画面のQRから（引き継ぎは画面か紙のQRだけ）
}

function say(ok = '', ng = '') {
  $('#done').textContent = ok; $('#done').hidden = !ok;
  $('#err').textContent = ng; $('#err').hidden = !ng;
}
function pointErr(text) { $('#ptErr').textContent = text; $('#ptErr').hidden = !text; }

/** 合言葉が違う・しばらく使えないと言われたら、合言葉の画面に戻す。ほかは、わけを出す */
function fail(e, showText) {
  if (e?.code !== 'bad_pin' && e?.code !== 'locked') return showText(message(e));
  if (e.code === 'bad_pin') { pinSet(''); screenForget(); }   // 合言葉が替わった端末には、画面のQRのコードも残さない
  if ($('#pointDlg').open) $('#pointDlg').close();
  closeQr();
  show(false, message(e));
}

/** 探す。全角で入っても探せるようにそろえる。番号はスペースや「-」が入っていても探せるように、英数字だけのときは取り除く */
async function findMembers(q = $('#q').value) {
  q = q.normalize('NFKC').trim();
  if (/^[0-9A-Za-z\s-]+$/.test(q)) q = q.replace(/[\s-]/g, '');
  $('#findBtn').disabled = true;
  try {
    const r = await staffPost({ action: 'members', q });
    members = r.list || [];
    asked = q;
    paint(r.total || 0);
    return true;
  } catch (e) {
    fail(e, text => say('', text));
    return false;
  } finally {
    $('#findBtn').disabled = false;
  }
}

const needsRegister = m => MEMBER_PLUS && !m.registeredAt;   // LINE の引き継ぎは登録した人だけ（../スタンプ台帳の決めごと.md の11節）

function rowHtml(m) {
  const tel = /^\d{4,}$/.test(asked) && m.tel ? `<small>電話 …${esc(m.tel.slice(-4))}</small>` : '';
  return `<li class="l-row">
      <b class="l-no">${esc(m.no)}</b>
      <div class="l-count"><b>${onCard(m.total)}</b>個${m.total > STAMP.goal ? `<small>累計${m.total}個</small>` : ''}</div>
      <span class="l-name">${m.name ? `${esc(m.name)} 様` : '名前の登録なし'}${tel}</span>
      ${m.lineMovedAt ? `<span class="l-tag">✓ LINE は引き継ぎ済み（${dayText(m.lineMovedAt)}）</span>` : needsRegister(m) ? '<span class="l-tag warn">登録がまだなので、LINE の引き継ぎはできません</span>' : ''}
      <div class="l-btns">
        <button type="button" class="b-fix" data-point="fix" data-no="${esc(m.no)}">数を直す</button>
      </div>
    </li>`;
}

/** total は見つかった数 */
function paint(total) {
  $('#list').innerHTML = members.length ? members.map(rowHtml).join('') : '<li class="l-row none">見つかりませんでした</li>';
  $('#count').hidden = !(total > members.length);
  $('#count').textContent = `${total}人見つかりました。はじめの${members.length}人を出しています。番号を足して、しぼってください。`;
}

/** 受け口が返した1人を、探した結果に入れて描き直す */
function putMember(row) {
  members = members.map(m => (m.no === row.no ? row : m));
  paint(members.length);
}

function openPoint(m) {
  pointing = { m, n: 0, note: '', rid: fixRid() };
  $('#ptTitle').textContent = '数を直す';
  $('#ptNo').textContent = m.no;
  $('#ptWho').textContent = `${m.name ? `${m.name} 様` : '名前の登録なし'}・いま ${stampCount(m.total)}`;
  $('#ptLabel').textContent = `直す数（1〜${FIX_MAX}）`;
  $('#ptN').max = FIX_MAX;
  $('#ptN').value = '';
  $('#ptNote').value = '';
  $('#pointDlg input[name="ptSign"][value="1"]').checked = true;
  pointStep(1);
  $('#pointDlg').showModal();
  setTimeout(() => $('#ptN').focus(), 50);
}

/** 1：数を入れる／2：番号と数を確かめる */
function pointStep(step) {
  $('#ptInput').hidden = step !== 1;
  $('#ptCheck').hidden = step !== 2;
  $('#ptBack').textContent = step === 1 ? 'やめる' : '戻って直す';
  pointErr('');
  $('#ptBack').disabled = $('#ptOk').disabled = false;
  if (step === 1) { $('#ptOk').textContent = '確かめる'; return; }
  const { m, n } = pointing;
  const after = Math.max(0, m.total + n);
  $('#ptAsk').textContent = '番号と数を確かめてください';
  $('#ptShow').textContent = `${n > 0 ? '+' : '−'}${Math.abs(n)}個`;
  $('#ptAfter').textContent = `いま ${stampCount(m.total)} → ${stampCount(after)}`;
  $('#ptWarn').textContent = '特典券は出ません。お客様のアプリの数も変わります。';
  $('#ptOk').textContent = 'この数に直す';
}

/** 数を読んで、確かめる画面へ。読めなければ、わけを出す */
function pointRead() {
  const { m } = pointing;
  const n = Number($('#ptN').value);
  if (!Number.isInteger(n) || n < 1 || n > FIX_MAX) return pointErr(`数は 1〜${FIX_MAX} で入れてください`);
  const minus = $('#pointDlg input[name="ptSign"]:checked').value === '-1';
  if (minus && !m.total) return pointErr('いまの数が 0 なので、減らせません');
  pointing.n = minus ? -n : n;
  pointing.note = $('#ptNote').value.trim();
  pointStep(2);
}

/** うまくいった（窓を閉じて、探した結果に知らせる）。送っているあいだに窓を閉じて、ほかの会員を開いていたら、その窓は閉じない */
function pointDone(me, row, text, warn = '') {
  if (pointing === me) $('#pointDlg').close();
  putMember(row);
  say(text, warn);
}

async function pointSend() {
  const me = pointing, { m, n, note, rid } = me;
  $('#ptBack').disabled = $('#ptOk').disabled = true;
  pointErr('');
  try {
    const r = await staffPost({ action: 'memberFix', no: m.no, delta: n, note, rid });
    const want = Math.max(0, m.total + n);
    pointDone(me, r.row, `${m.no} の数を直しました（いま ${stampCount(r.row.total)}）。`,
      r.row.total === want ? '' : `★数が思っていたのと違います（${stampCount(want)}のはずが、${stampCount(r.row.total)}）。確かめて、必要なら直してください。`);
  } catch (e) {
    const mine = pointing === me;   // ほかの会員の窓を開いていたら、その窓には書かない
    // 届いたかどうか分からないときは、そのまま押し直さない（2回入ることがある）。読み直して、いまの数を見てもらう
    if (unsure(e)) {
      if (mine) { $('#pointDlg').close(); await findMembers(m.no); }
      return say('', `${m.no} は、受け口から返事がありませんでした。入っていることがあるので、いまの数を確かめてから、もう一度入れてください。`);
    }
    if (!mine) return fail(e, text => say('', `${m.no}：${text}`));
    $('#ptBack').disabled = $('#ptOk').disabled = false;
    fail(e, pointErr);
  }
}

/* ---- 紙の引き継ぎ券（../スタンプ台帳の決めごと.md の10節）。ふだんは STAMP.memberPlus で切り替え。この Mac では ?test のときに出す ---- */
const MEMBER_PLUS = !!STAMP.memberPlus || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]test\b/.test(location.search));
const QR_LIB = { src: 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js', integrity: 'sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1' };   // 公式アプリの LIB.qrMake と同じ
let issuing = null;           // 発行している組 { sets, rid }。返事が届かなくて押し直しても、同じ rid なら2組発行されない
let issued = [];              // 発行した券。PDF を作るあいだだけ、この画面の中に持つ
let unsaved = false;          // 発行して、まだ PDF を保存していない
let paperBusy = false;        // 発行と「全部無効にする」を、同時に進めない（無効にしたすぐあとに、前に押した発行が届いて使える券ができないように）
function paperLock(on) { paperBusy = on; $('#issueBtn').disabled = $('#voidBtn').disabled = on; }

function openTab(name) {
  $$('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $('#app').hidden = name !== 'app';
  $('#paper').hidden = name !== 'paper';
  $('#screen').hidden = name !== 'screen';
  if (name === 'paper') paintLeft();
  else if (name === 'app') $('#q').focus();
  else { screenSay(); screenPrepare(); }   // 押したらすぐ出せるように、先に用意しておく
}
function paperSay(ok = '', ng = '') {
  $('#pDone').textContent = ok; $('#pDone').hidden = !ok;
  $('#pErr').textContent = ng; $('#pErr').hidden = !ng;
}
const leftHtml = left => Array.from({ length: LINE_MAX }, (_, i) => `<span class="${left[i + 1] ? '' : 'none'}"><em>${i + 1}</em><b>${left[i + 1] || 0}</b></span>`).join('');
function showLeft(left, used) {
  $('#left').innerHTML = leftHtml(left);
  $('#leftNote').textContent = `上が数、下が使える枚数です${used === undefined ? '' : `（これまでに読まれた回数 ${used}回）`}。`;
}
async function paintLeft() {
  paperSay();
  try {
    const r = await staffPost({ action: 'lineTicketInfo' });
    showLeft(r.left || {}, r.used);
  } catch (e) {
    fail(e, text => paperSay('', text));
  }
}

/** 発行した券を A6 の PDF にして、この端末に保存する（js/line-pdf.js） */
async function saveTickets() {
  $('#pdfBtn').disabled = true;
  paperSay();
  try {
    const url = URL.createObjectURL(await ticketPdf(issued));
    Object.assign(document.createElement('a'), { href: url, download: 'バグるLINE引き継ぎQR_A6.pdf' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    unsaved = false;
  } catch (e) {
    paperSay('', 'PDF を作れませんでした。もう一度お試しください。');
  } finally {
    $('#pdfBtn').disabled = false;
  }
}

async function issueTickets() {
  const sets = Number($('#sets').value);
  if (paperBusy) return;
  if (unsaved && !confirm('前に発行したQRの PDF が、まだ保存されていません。新しく発行すると、前のQRは保存できなくなります。続けますか？')) return;
  if (issuing?.sets !== sets) issuing = { sets, rid: fixRid() };
  paperLock(true);
  paperSay();
  try {
    await loadJs(QR_LIB.src, QR_LIB.integrity);
    const r = await staffPost({ action: 'lineTickets', sets, rid: issuing.rid });
    issuing = null;
    issued = r.tickets;
    unsaved = true;
    $('#issuedNote').textContent = `${r.tickets.length}枚（${sets}組）発行しました。★この画面を閉じると、同じQRは出せません。続けて PDF を保存してください。`;
    $('#issued').hidden = false;
    showLeft(r.left || {});
  } catch (e) {
    fail(e, text => paperSay('', text));
  } finally {
    paperLock(false);
  }
}

async function voidTickets() {
  if (paperBusy || !confirm('いま使えるQRを全部無効にします。印刷した紙も、画面のQRも、全部読めなくなります。よろしいですか？')) return;
  paperLock(true);
  paperSay();
  try {
    const r = await staffPost({ action: 'lineTicketVoid' });
    screenForget();
    showLeft(r.left || {});
    paperSay(`${r.voided}枚を無効にしました。`);
  } catch (e) {
    fail(e, text => paperSay('', text));
  } finally {
    paperLock(false);
  }
}

/* ---- 画面に出すQR（2026-11-02 ko-dai さんの指示「アプリ内でもQRコードを表示させて引き継ぎができるように」）----
 *  ・紙と同じ券（lineTickets）を1組だけ発行して、この端末に覚えて使い回す。受け口は紙と同じで、変えていない
 *  ・★コードは紙の PDF と同じく、この端末の中だけ（localStorage の baguru.line.screen）。「全部無効にする」「合言葉を消す」で消す
 *  ・★押したらすぐ出す（2026-11-02 ko-dai さんの指示「用意していますの時間が長い」）。15枚のQRの絵（マスの形）は、発行したときに作って
 *    コードと一緒に覚えておく。タブを開いたときに用意しておき、押したときは受け口の返事を待たない（受け口は1回 1〜3秒かかる）
 *  ・ほかの端末で「全部無効にする」を押すと、この端末のQRは読めなくなる。どれかの数の使える枚数が0なら、覚えた組は無効なので作り直す
 *    （タブを開いたときと、QR を出したあとに見る。出したあとに分かったら、出しているQRも新しいものに替える）。
 *    見分けられないとき（あとで別の券を発行したとき）は、お客様に「このQRは使えません」と出るので「作り直す」を押す
 *  ・出しているあいだ lineTicketInfo の読まれた回数（used）を見て、増えたら「読み取られました」にする（紙の券が読まれても増えるので、目安）
 *  ・置いたままにしないように、3分で閉じる（受け口の返事を待っていても閉じる）。出しているあいだは画面を暗くしない
 *  ・★消したあとに、消す前に頼んだ発行の答えが届いても覚えない（screenGen）。合言葉が無い・違うと分かった端末にも残さない */
const SCREEN_KEY = 'baguru.line.screen';
const SHOW_MS = 180000;    // QR を出しておく長さ
const WATCH_MS = 4000;     // 読まれたかを見る間
let screenSet = screenLoad();   // { at, tickets: [{ id, n, code, size, d }] }。size・d は QR の絵（qrPath）
let screenRid = '';             // 作っている組の rid。返事が届かなくて押し直しても、同じ rid なら2組作られない
let screenMaking = null;        // 発行している途中（タブを開いたときと押したときが重なっても、1回だけ）
let screenGen = 0;              // 消すたびに増やす。消す前に頼んだ発行の答えは捨てる
let showing = null;             // 出している QR { n, used }
let wakeLock = null;

/** 覚えた組を読む。絵の形がおかしければ捨てて、あとで作り直す（コードは使う） */
function screenLoad() {
  try {
    const s = JSON.parse(localStorage.getItem(SCREEN_KEY) || 'null');
    const ok = s?.tickets?.length === LINE_MAX && s.tickets.every(t => /^[2-9A-HJKMNP-Z]{16}$/.test(t.code));
    if (!ok) return null;
    s.tickets.forEach(t => { if (!(Number.isInteger(t.size) && /^[Mhvz\d -]+$/.test(t.d || ''))) delete t.d; });
    return s;
  } catch (e) { return null; }
}
function screenKeep() {
  try { localStorage.setItem(SCREEN_KEY, JSON.stringify(screenSet)); } catch (e) {}   // 覚えられなくても、開いているあいだは使える
}
function screenForget() {
  screenGen++;
  screenSet = screenMaking = null;
  screenRid = '';
  try { localStorage.removeItem(SCREEN_KEY); } catch (e) {}
}
/** 絵が無い券（前の版で覚えた組）に、絵を作って覚える */
async function screenDraw() {
  if (!screenSet || screenSet.tickets.every(t => t.d)) return;
  await loadJs(QR_LIB.src, QR_LIB.integrity);
  if (!screenSet) return;
  screenSet.tickets.forEach(t => { if (!t.d) Object.assign(t, qrPath(`BAGURULINE:${t.code}`)); });
  screenKeep();
}
/** 画面用の1組。無ければ発行して、絵も作って、この端末に覚える */
function screenTickets() {
  if (screenSet) return screenDraw().then(() => screenSet);
  const gen = screenGen;
  return screenMaking ??= (async () => {
    try {
      screenRid ||= fixRid();
      const [r] = await Promise.all([staffPost({ action: 'lineTickets', sets: 1, rid: screenRid }), loadJs(QR_LIB.src, QR_LIB.integrity)]);
      if (gen !== screenGen) throw Object.assign(new Error('forgot'), { code: 'forgot' });   // 待っているあいだに消した（合言葉を消した・全部無効にした）
      screenRid = '';
      screenSet = { at: new Date().toISOString(), tickets: r.tickets.map(t => ({ ...t, ...qrPath(`BAGURULINE:${t.code}`) })) };
      screenKeep();
      return screenSet;
    } finally {
      if (gen === screenGen) screenMaking = null;   // 消したあとに始めた発行は、消さない
    }
  })();
}
/** タブを開いたときに、押したらすぐ出せるようにしておく。ほかの端末で全部無効にされていたら、作り直しておく */
async function screenPrepare() {
  try {
    await screenDraw();
    const had = screenSet, info = await infoNow();
    if (info && had && had === screenSet && !allLeft(info)) screenForget();
    await screenTickets();
  } catch (e) {
    if (e?.code === 'bad_pin' || e?.code === 'locked') fail(e);   // ほかの失敗は、押したときに知らせる
  }
}

function screenSay(ok = '', ng = '') {
  $('#sDone').textContent = ok; $('#sDone').hidden = !ok;
  $('#sErr').textContent = ng; $('#sErr').hidden = !ng;
}
const qrState = (text, cls = '') => { $('#qrState').textContent = text; $('#qrState').className = `qr-state ${cls}`; };

/** QR のマスの形を作る（SVG の path）。まわりに白を4マス残す。中身の形は紙と同じ（js/line-pdf.js） */
function qrPath(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const count = q.getModuleCount(), pad = 4;
  let d = '';
  for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (q.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`;
  return { size: count + pad * 2, d };
}
const qrSvg = ({ size, d }) => `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="LINE 引き継ぎのQR"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
/** 用意できている券（絵まであるもの）。無ければ空 */
const readyTicket = n => screenSet?.tickets.find(t => t.n === n && t.d);

async function wake(on) {
  if (!on) { wakeLock?.release().catch(() => {}); wakeLock = null; return; }
  try {
    const w = await navigator.wakeLock?.request('screen');
    if (showing && !wakeLock) wakeLock = w; else w?.release();
  } catch (e) {}
}

/** 合言葉が違うときは、ほかの画面と同じく合言葉の画面へ。ほかの失敗は無かったことにする（見るだけなので） */
const infoNow = () => staffPost({ action: 'lineTicketInfo' }).catch(e => { if (e?.code === 'bad_pin' || e?.code === 'locked') throw e; return null; });
const allLeft = info => Array.from({ length: LINE_MAX }, (_, i) => info.left?.[i + 1] || 0).every(k => k > 0);

/** 出している窓に、その数の QR を入れる。用意できていれば待たない */
async function putQr(me) {
  const t = readyTicket(me.n) || (await screenTickets()).tickets.find(x => x.n === me.n);
  if (showing !== me) return;
  $('#qrBox').innerHTML = qrSvg(t);
  qrState('お客様のアプリで読んでもらってください');
}

async function showQr(n) {
  screenSay();
  const me = showing = { n, used: undefined };
  const had = screenSet;
  setTimeout(() => {   // 受け口の返事を待っていても、3分で閉じる
    if (showing !== me) return;
    closeQr();
    screenSay('3分たったので、QRを閉じました。もう一度出すときは、数を押してください。');
  }, SHOW_MS);
  const seen = infoNow();   // 読まれた回数は、QR を出すのと同時に数え始める（返事は待たない）
  seen.catch(() => {});
  $('#qrN').textContent = n;
  const t = readyTicket(n);
  $('#qrBox').innerHTML = t ? qrSvg(t) : '<p class="qr-wait">QRを用意しています…</p>';   // ふだんは、ここでもう出ている
  qrState(t ? 'お客様のアプリで読んでもらってください' : '');
  $('#qrDlg').showModal();
  try {
    if (!t) await putQr(me);
    if (showing !== me) return;
    wake(true);
    const info = await seen;
    if (showing !== me) return;
    if (info && had && had === screenSet && !allLeft(info)) screenForget();   // ほかの端末で全部無効にされていた
    if (had && screenSet !== had) {   // 出しているのは無効になった組のQR。新しい組のものに替える
      await putQr(me);
      if (showing !== me) return;
    }
    me.used = info?.used;
    watchRead(me);
  } catch (e) {
    if (showing !== me) return;
    closeQr();
    fail(e, text => screenSay('', text));
  }
}

/** 出しているあいだ、読まれた回数を見る。増えたら「読まれました」 */
async function watchRead(me) {
  while (showing === me) {
    await new Promise(ok => setTimeout(ok, WATCH_MS));
    if (showing !== me) return;
    try {
      const info = await infoNow();
      if (showing !== me || !info) continue;
      if (me.used === undefined) me.used = info.used;
      else if (info.used > me.used) return qrRead(me);
    } catch (e) {
      if (showing !== me) return;
      closeQr();
      return fail(e);
    }
  }
}

/** QR の窓を閉じて、QR を画面から消す。★close の知らせを待たない（画面が裏にあると、表に出るまで届かない） */
function closeQr() {
  showing = null;
  wake(false);
  $('#qrBox').innerHTML = '';
  if ($('#qrDlg').open) $('#qrDlg').close();
}

function qrRead(me) {
  showing = null;
  wake(false);
  $('#qrBox').innerHTML = '<p class="qr-ok" aria-hidden="true">✓</p>';
  // ★読まれた回数は全部の券の合計なので、紙の券が読まれても増える。お客様のアプリで、引き継げたかを必ず見てもらう
  qrState(`QRが読まれました。お客様のアプリに「${me.n}ポイント引き継ぎました」と出ているか、必ず見せてもらってください。`, 'ok');
}

async function remakeScreen() {
  if (!confirm('画面のQRを新しく作ります。この端末の前の画面のQRは、もう出せなくなります。よろしいですか？')) return;
  screenForget();
  screenSay();
  try {
    await screenTickets();
    screenSay('画面のQRを作り直しました。');
  } catch (e) {
    fail(e, text => screenSay('', text));
  }
}

/* ---- 押したとき ---- */
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) openTab(b.dataset.tab); });
$('#issue').addEventListener('submit', e => { e.preventDefault(); issueTickets(); });
$('#pdfBtn').addEventListener('click', saveTickets);
addEventListener('beforeunload', e => { if (unsaved) { e.preventDefault(); e.returnValue = ''; } });
$('#voidBtn').addEventListener('click', voidTickets);
$('#nums').innerHTML = Array.from({ length: LINE_MAX }, (_, i) => `<button type="button" data-n="${i + 1}"><b>${i + 1}</b><small>ポイント</small></button>`).join('');
$('#nums').addEventListener('click', e => { const b = e.target.closest('[data-n]'); if (b) showQr(Number(b.dataset.n)); });
$('#qrClose').addEventListener('click', closeQr);
$('#qrDlg').addEventListener('close', closeQr);   // Esc で閉じたとき
$('#remake').addEventListener('click', remakeScreen);
$('#find').addEventListener('submit', e => {
  e.preventDefault();
  say();
  findMembers();
});
$('#list').addEventListener('click', e => {
  const b = e.target.closest('[data-point]');
  const m = b && members.find(x => x.no === b.dataset.no);
  if (m) { say(); openPoint(m); }
});
$('#ptBack').addEventListener('click', () => { if ($('#ptCheck').hidden) $('#pointDlg').close(); else pointStep(1); });
$('#ptForm').addEventListener('submit', e => {
  e.preventDefault();
  if ($('#ptCheck').hidden) pointRead(); else if (!$('#ptOk').disabled) pointSend();
});
/** 合言葉を消したとき。画面のQRのコードも、この端末から消す */
function signOut() {
  screenForget();
  members = [];
  $('#list').innerHTML = '';
  say();
  if ($('#pointDlg').open) $('#pointDlg').close();
  closeQr();
  show(false);
}
$('#forget').addEventListener('click', () => {
  if (!confirm('この端末の合言葉を消します。同じブラウザの予約ボード・Order受付・マネージでも、また入れることになります。よろしいですか？')) return;
  pinSet('');
  signOut();
});
/* ほかのタブ・同じブラウザのほかのアプリ（予約ボードなど）で、合言葉や画面のQRを変えたとき */
addEventListener('storage', e => {
  if (e.key !== null && e.key !== PIN_KEY && e.key !== SCREEN_KEY) return;
  if (!pinGet()) return signOut();
  if (e.key !== PIN_KEY) { screenGen++; screenMaking = null; screenRid = ''; screenSet = screenLoad(); }   // ほかのタブで作り直した・消した組に合わせる
});
$('#login').addEventListener('submit', async e => {
  e.preventDefault();
  const v = $('#pin').value.trim();
  if (!v) return;
  $('#loginBtn').disabled = true;
  try {
    await post({ action: 'ping', pin: v });
    pinSet(v);
    $('#pin').value = '';
    show(true);
  } catch (err) {
    show(false, message(err));
  }
  $('#loginBtn').disabled = false;
});

/* ---- はじめ ---- */
(async () => {
  if (!pinGet()) { screenForget(); return show(false); }   // ほかのアプリで合言葉を消していたら、画面のQRのコードも残さない
  try {
    await staffPost({ action: 'ping' });
    show(true);
  } catch (e) {
    if (e?.code === 'bad_pin' || e?.code === 'locked') return fail(e);
    show(true);
    say('', message(e));
  }
})();
