/* =====================================================================
 *  バグるLINE引き継ぎ（LINE のポイントの数を、スタンプの台帳に入れる。2026-11-02 ko-dai さんの指示）
 *  お客様が公式アプリに出した会員番号と、LINE のショップカードの画面を見せてもらい、番号で探して数を入れる。
 *  お客様の画面は6秒ほどで変わる（公式アプリの js/stamp-qr.js の openLineMove）。
 *  ・数を決めるのは受け口の台帳。ここは members で探して、lineGive・memberFix を送るだけ（../スタンプ台帳の決めごと.md の7節・9節）
 *  ・LINE の数は1会員1回なので、送る前に番号と数を確かめる画面を1つ挟む。手で直すときも同じ
 *  ・★電話番号は大きく出さない。電話番号で探したときの突き合わせに、下4けただけ小さく出す
 *  ・★api.js は、返事を読めないと黙って2回まで送り直す。1回目が入っていると lineGive は line_done で返るので、数が合えば入った扱いにする。
 *    memberFix は rid を付けて送る（受け口の版 2026-11-02a から）。返ってきた数が違えば知らせる
 *  ・合言葉は予約ボード・Order受付・マネージと同じ置き場所（localStorage の baguru.daicho.pin）。1度入れたら、この端末に覚える
 *  ・★この Mac で試すときは、にせの受け口（プレビュー「予約の受け口（試し）」）から ?test を付けて開く。本物で試さない
 * ===================================================================== */

const $ = (s, el = document) => el.querySelector(s);
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

/* ---- 受け口（予約ボードの公開先の config.js・api.js を読む。公式アプリ・マネージと同じ） ---- */
const LOADED = {};
const loadJs = src => (LOADED[src] ??= new Promise((ok, ng) => {
  const s = document.createElement('script');
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
  line_done: 'この会員は、LINE の引き継ぎが済んでいます。',
  bad_input: '入れた数を確かめてください。',
  busy: '受け口が混み合っています。少し待って、もう一度お試しください。',
  not_ready: '受け口の場所を読めませんでした。少し時間を置いてから、もう一度お試しください。',
  offline: 'つながりませんでした。電波の良い所で、もう一度お試しください。',
  no_answer: 'つながりませんでした。時間を置いて、もう一度お試しください。',
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
let pointing = null;    // 入れている数 { kind: 'line' か 'fix', m: 会員, n: 入れる数（減らすときはマイナス）, note, rid }

/* ---- 画面 ---- */
function show(signedIn, loginText = '') {
  $('#wait').hidden = true;
  $('#app').hidden = !signedIn;
  $('#login').hidden = signedIn;
  $('#loginErr').textContent = loginText;
  $('#loginErr').hidden = !loginText;
  if (signedIn) $('#q').focus(); else $('#pin').focus();
}

function say(ok = '', ng = '') {
  $('#done').textContent = ok; $('#done').hidden = !ok;
  $('#err').textContent = ng; $('#err').hidden = !ng;
}
function pointErr(text) { $('#ptErr').textContent = text; $('#ptErr').hidden = !text; }

/** 合言葉が違う・しばらく使えないと言われたら、合言葉の画面に戻す。ほかは、わけを出す */
function fail(e, showText) {
  if (e?.code !== 'bad_pin' && e?.code !== 'locked') return showText(message(e));
  if (e.code === 'bad_pin') pinSet('');
  if ($('#pointDlg').open) $('#pointDlg').close();
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

function rowHtml(m) {
  const tel = /^\d{4,}$/.test(asked) && m.tel ? `<small>電話 …${esc(m.tel.slice(-4))}</small>` : '';
  return `<li class="l-row">
      <b class="l-no">${esc(m.no)}</b>
      <div class="l-count"><b>${onCard(m.total)}</b>個${m.total > STAMP.goal ? `<small>累計${m.total}個</small>` : ''}</div>
      <span class="l-name">${m.name ? `${esc(m.name)} 様` : '名前の登録なし'}${tel}</span>
      ${m.lineMovedAt ? `<span class="l-tag">✓ LINE は引き継ぎ済み（${dayText(m.lineMovedAt)}）</span>` : ''}
      <div class="l-btns">
        ${m.lineMovedAt ? '' : `<button type="button" class="b-line" data-point="line" data-no="${esc(m.no)}">LINE の数を入れる</button>`}
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

function openPoint(kind, m) {
  const line = kind === 'line';
  pointing = { kind, m, n: 0, note: '', rid: fixRid() };
  $('#ptTitle').textContent = line ? 'LINE のポイントの数を入れる' : '数を直す';
  $('#ptNo').textContent = m.no;
  $('#ptWho').textContent = `${m.name ? `${m.name} 様` : '名前の登録なし'}・いま ${stampCount(m.total)}`;
  $('#ptSign').hidden = $('#ptNoteRow').hidden = line;
  $('#ptLabel').textContent = line ? `LINE のショップカードの数（1〜${LINE_MAX}）` : `直す数（1〜${FIX_MAX}）`;
  $('#ptN').max = line ? LINE_MAX : FIX_MAX;
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
  const { kind, m, n } = pointing;
  const line = kind === 'line';
  const after = Math.max(0, m.total + n);
  $('#ptAsk').textContent = line ? 'お客様の画面と見くらべてください' : '番号と数を確かめてください';
  $('#ptShow').textContent = line ? `LINE の数 ${n}ポイント` : `${n > 0 ? '+' : '−'}${Math.abs(n)}個`;
  $('#ptAfter').textContent = `いま ${stampCount(m.total)} → ${stampCount(after)}`;
  $('#ptWarn').textContent = line ? '★1人1回だけです。入れたあとは、やり直せません（間違えたら「数を直す」で直します）。特典券は出ません。'
    : '特典券は出ません。お客様のアプリの数も変わります。';
  $('#ptOk').textContent = line ? `${n}ポイント入れる` : 'この数に直す';
}

/** 数を読んで、確かめる画面へ。読めなければ、わけを出す */
function pointRead() {
  const { kind, m } = pointing;
  const line = kind === 'line';
  const max = line ? LINE_MAX : FIX_MAX;
  const n = Number($('#ptN').value);
  if (!Number.isInteger(n) || n < 1 || n > max) return pointErr(`数は 1〜${max} で入れてください`);
  const minus = !line && $('#pointDlg input[name="ptSign"]:checked').value === '-1';
  if (minus && !m.total) return pointErr('いまの数が 0 なので、減らせません');
  pointing.n = minus ? -n : n;
  pointing.note = line ? '' : $('#ptNote').value.trim();
  pointStep(2);
}

/** うまくいった（窓を閉じて、探した結果に知らせる） */
function pointDone(row, text, warn = '') {
  $('#pointDlg').close();
  putMember(row);
  say(text, warn);
}

async function pointSend() {
  const { kind, m, n, note, rid } = pointing;
  const line = kind === 'line';
  const gave = row => `${m.no} に ${n}ポイント入れました（いま ${stampCount(row.total)}）。お客様の画面は6秒ほどで変わります。`;
  $('#ptBack').disabled = $('#ptOk').disabled = true;
  pointErr('');
  try {
    const r = await staffPost(line ? { action: 'lineGive', no: m.no, n } : { action: 'memberFix', no: m.no, delta: n, note, rid });
    if (line) return pointDone(r.row, gave(r.row));
    const want = Math.max(0, m.total + n);
    pointDone(r.row, `${m.no} の数を直しました（いま ${stampCount(r.row.total)}）。`,
      r.row.total === want ? '' : `★数が思っていたのと違います（${stampCount(want)}のはずが、${stampCount(r.row.total)}）。確かめて、必要なら直してください。`);
  } catch (e) {
    const row = e.data?.row;
    if (line && e.code === 'line_done' && row) {
      if (!m.lineMovedAt && row.total === m.total + n) return pointDone(row, gave(row));
      return pointDone(row, '', `${MSG.line_done}いまの数は ${stampCount(row.total)} です。`);
    }
    // 届いたかどうか分からないときは、そのまま押し直さない（2回入ることがある）。読み直して、いまの数を見てもらう
    if (unsure(e)) {
      $('#pointDlg').close();
      await findMembers(m.no);
      return say('', '受け口から返事がありませんでした。入っていることがあるので、いまの数を確かめてから、もう一度入れてください。');
    }
    $('#ptBack').disabled = $('#ptOk').disabled = false;
    fail(e, pointErr);
  }
}

/* ---- 押したとき ---- */
$('#find').addEventListener('submit', e => {
  e.preventDefault();
  say();
  findMembers();
});
$('#list').addEventListener('click', e => {
  const b = e.target.closest('[data-point]');
  const m = b && members.find(x => x.no === b.dataset.no);
  if (m) { say(); openPoint(b.dataset.point, m); }
});
$('#ptBack').addEventListener('click', () => { if ($('#ptCheck').hidden) $('#pointDlg').close(); else pointStep(1); });
$('#ptForm').addEventListener('submit', e => {
  e.preventDefault();
  if ($('#ptCheck').hidden) pointRead(); else if (!$('#ptOk').disabled) pointSend();
});
$('#forget').addEventListener('click', () => {
  if (!confirm('この端末の合言葉を消します。同じブラウザの予約ボード・Order受付・マネージでも、また入れることになります。よろしいですか？')) return;
  pinSet('');
  members = [];
  $('#list').innerHTML = '';
  say();
  show(false);
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
  if (!pinGet()) return show(false);
  try {
    await staffPost({ action: 'ping' });
    show(true);
  } catch (e) {
    if (e?.code === 'bad_pin' || e?.code === 'locked') return fail(e);
    show(true);
    say('', message(e));
  }
})();
