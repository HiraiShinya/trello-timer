import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getDatabase, ref, onValue, set, update, push } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCZSImS2hTSASLj9NfCpCMOWsT54d9hh7k",
  authDomain: "trello-timerbb.firebaseapp.com",
  databaseURL: "https://trello-timerbb-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "trello-timerbb",
  storageBucket: "trello-timerbb.firebasestorage.app",
  messagingSenderId: "1082057229145",
  appId: "1:1082057229145:web:93166029c94b58617fc248"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

var MEMBERS = ['田中', '佐藤', '鈴木', '山田', '伊藤', '渡辺'];
var memberPhotos = {};
var colorIdx = 0;
var memberColors = {};
var palettes = [{ bg: '#B5D4F4', fg: '#0C447C' }, { bg: '#9FE1CB', fg: '#085041' }, { bg: '#F5C4B3', fg: '#712B13' }, { bg: '#FAC775', fg: '#633806' }, { bg: '#C0DD97', fg: '#27500A' }];

let currentFirebaseTimers = {};
let currentPositions = {};
let localTimers = {};
let currentHighlightMember = null;

var t = window.TrelloPowerUp.iframe();

const lanesContainer = document.getElementById('lanesContainer');
const allZones = ['zone_unassigned', 'zone_hold'];

// レーン作成
for (let i = 1; i <= 15; i++) {
  const zoneId = 'zone_lane_' + i;
  allZones.push(zoneId);

  let isCollapsed = localStorage.getItem('lane_collapsed_' + i) === 'true';
  let collapsedClass = isCollapsed ? ' collapsed' : '';
  let iconTxt = isCollapsed ? '▶' : '▼';

  lanesContainer.insertAdjacentHTML('beforeend', `
      <div class="lane-row${collapsedClass}">
        <div class="lane-label" data-lane="${i}">
          <span>${i}レーン</span>
          <span class="toggle-icon">${iconTxt}</span>
          <span class="card-count-badge" id="count_badge_${zoneId}">0件</span>
        </div>
        <div class="dropzone" id="${zoneId}"></div>
      </div>
    `);
}

// レーンのアコーディオン（開閉）機能
document.querySelectorAll('.lane-label').forEach(label => {
  label.addEventListener('click', () => {
    let laneNum = label.dataset.lane;
    let row = label.parentElement;
    let icon = label.querySelector('.toggle-icon');

    row.classList.toggle('collapsed');
    let isCollapsed = row.classList.contains('collapsed');

    icon.textContent = isCollapsed ? '▶' : '▼';
    // レーンの開閉機能の設定情報は、ブラウザのストレージlocalStorageが持つ
    localStorage.setItem('lane_collapsed_' + laneNum, isCollapsed);
  });
});

allZones.forEach(zoneId => {
  let sortableGroup = { name: 'shared' };
  // 未割当エリアに置のは、禁止
  if (zoneId === 'zone_unassigned') sortableGroup.put = false;


  new Sortable(document.getElementById(zoneId), {
    group: sortableGroup,
    animation: 150,
    ghostClass: 'highlight',
    onEnd: function (evt) {
      const itemEl = evt.item;
      const toZone = evt.to.id;
      const cardId = itemEl.dataset.cardId;
      // カードがどのレーンに移動したかを記録
      set(ref(db, 'positions/' + cardId), toZone);
      // 保留エリアに置いたら、該当カードの全員分のタイマー停止
      if (toZone === 'zone_hold') stopAllTimersForCard(cardId);
    }
  });
});

// =========================================================================
// onValue(ref(db, 'photos')で、Firebaseの「db」にある「photo」という名前の格納庫を24時間監視するという意味
// 「{}」は、想定外事象（snapshot.valが空だった場合）のエラー回避
onValue(ref(db, 'photos'), (snapshot) => { memberPhotos = snapshot.val() || {}; buildSettings(); refreshAllTimerAvatars(); });
onValue(ref(db, 'timers'), (snapshot) => { currentFirebaseTimers = snapshot.val() || {}; renderAllTimers(); });
onValue(ref(db, 'logs'), (snapshot) => { renderLogs(snapshot.val() || {}); });
onValue(ref(db, 'positions'), (snapshot) => { currentPositions = snapshot.val() || {}; syncCardPositions(); });
// =========================================================================

// =========================================================================
// ★追加：10秒ごとにTrelloの最新情報を取得する自動ループ（リアルタイム同期）
// =========================================================================

// Trelloボード上の変化（カード追加・移動など）を自動検知して即座に画面を更新する（初回表示も兼ねる）
t.render(function () { fetchTrelloCards(); });

// 10秒ごとにfetchTrelloCardsを実行する
setInterval(function () {
  fetchTrelloCards();
}, 10000); // 10000ミリ秒 = 10秒ごと

function fetchTrelloCards() {
  Promise.all([t.lists('id', 'name'), t.cards('id', 'name', 'idList', 'labels')]).then(function (values) {
    var targetList = values[0].find(list => list.name === '作業中');
    if (!targetList) return;

    // 「作業中」リストに入っている最新のカード一覧だけを抽出して渡す
    renderCardsToFactory(values[1].filter(card => card.idList === targetList.id));
  });
}

// =========================================================================
// ・リスト「作業中」からいなくなったカードを画面からも消去
// ・リスト「作業中」に入ってきたカードを画面に登場
// ・リスト「作業中」に既にあるカードは、何もしない=========================================================================
function renderCardsToFactory(cards) {
  var factory = document.getElementById('hidden-card-factory');
  var unassignedZone = document.getElementById('zone_unassigned');

  var loadingMsg = unassignedZone.querySelector('div[style*="color:#5e6c84"]');
  if (loadingMsg) loadingMsg.remove();

  var currentTrelloCardIds = cards.map(c => c.id);

  document.querySelectorAll('.card-item').forEach(cardEl => {
    if (!currentTrelloCardIds.includes(cardEl.dataset.cardId)) {
      cardEl.remove();
    }
  });

  cards.forEach(card => {
    var cardId = card.id;
    if (document.getElementById('card_' + cardId)) return;

    // --- ラベルHTML（詳細ボタンの高さ24pxに合わせる調整） ---
    var labelsHtml = '';
    if (card.labels && card.labels.length > 0) {
      labelsHtml = '<div class="trello-labels-container" style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">';
      card.labels.forEach(label => {
        var colorClass = label.color ? 't-label-' + label.color : 't-label-default';
        labelsHtml += `<span class="trello-label ${colorClass}" style="
          margin:0; 
          font-size:11px; 
          height:24px; 
          line-height:24px; 
          padding:0 10px; 
          display:inline-flex; 
          align-items:center; 
          box-sizing:border-box; 
          white-space:nowrap;
          border-radius:3px;
        ">${label.name || ''}</span>`;
      });
      labelsHtml += '</div>';
    }

    var cardHtml = `
        <div class="card-item" id="card_${cardId}" data-card-id="${cardId}" style="display:flex; min-height:200px; overflow:hidden; align-items: stretch; margin-bottom: 10px;">
          <div class="working-badge">作業中</div>

          <div class="card-left" style="flex: 1; min-width: 0; padding: 15px 10px; display: flex; flex-direction: column; overflow:hidden;">
            <div style="flex: 1;">
              <div class="card-header" style="font-weight:bold; margin-bottom:12px; line-height:1.4; font-size:15px; color: #172b4d; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${card.name}">${card.name}</div>
              
              <div class="card-meta-row" style="display:flex; align-items:center; gap:8px; margin-bottom:15px; flex-wrap:wrap;">
                ${labelsHtml}
                <button class="btn-open-detail" id="detail_${cardId}" title="別タブで詳細を開く" style="
                  border:1px solid #dfe1e6; 
                  background:#f4f5f7; 
                  border-radius:3px; 
                  padding:0 10px; 
                  cursor:pointer; 
                  color:#5e6c84; 
                  font-size:11px; 
                  height:24px; 
                  display:flex; 
                  align-items:center; 
                  white-space:nowrap; 
                  flex-shrink:0;
                  box-sizing:border-box;
                ">🔍 詳細</button>
              </div>
            </div>
            
            <div class="card-body" style="margin-top:auto; padding-bottom: 5px;">
              <div style="font-size:10px; color:#888; margin-bottom:6px;">タップでアサイン（横スクロール可）</div>
              <div class="quick-member-list" id="quick_${cardId}"></div>
              <button class="btn-batch" id="batch_${cardId}" style="margin-top:15px;"></button>
            </div>
          </div>

          <div class="card-right" id="slots_${cardId}" style="
            width:160px; 
            flex-shrink:0; 
            border-left:1px dashed #ddd; 
            padding:12px 6px; 
            display:grid; 
            grid-template-columns: 1fr 1fr; 
            grid-template-rows: auto auto; 
            gap:15px 8px; 
            background:#fcfcfc;
            align-content: start;
          ">
            <div class="member-slot empty-slot" id="slot_${cardId}_0" style="min-height:105px; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding:8px 0; box-sizing: border-box;"></div>
            <div class="member-slot empty-slot" id="slot_${cardId}_1" style="min-height:105px; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding:8px 0; box-sizing: border-box;"></div>
            <div class="member-slot empty-slot" id="slot_${cardId}_2" style="min-height:105px; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding:8px 0; box-sizing: border-box;"></div>
            <div class="member-slot empty-slot" id="slot_${cardId}_3" style="min-height:105px; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding:8px 0; box-sizing: border-box;"></div>
          </div>
        </div>
      `;
    factory.insertAdjacentHTML('beforeend', cardHtml);

    document.getElementById('detail_' + cardId).addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(`https://trello.com/c/${cardId}`, '_blank');
    });

    var quickList = document.getElementById('quick_' + cardId);
    MEMBERS.forEach(name => {
      var btn = document.createElement('button');
      btn.className = 'quick-add-btn';
      btn.dataset.memberName = name;
      btn.appendChild(makeAvatarEl(name, 18));
      var nameSpan = document.createElement('span');
      nameSpan.textContent = name;
      btn.appendChild(nameSpan);
      btn.addEventListener('click', () => {
        if (btn.classList.contains('added')) return;
        addMemberToCard(cardId, card.name, name);
      });
      quickList.appendChild(btn);
    });

    document.getElementById('batch_' + cardId).addEventListener('click', () => {
      toggleBatchTimersForCard(cardId);
    });
  });

  syncCardPositions();
  renderAllTimers();
}

// アプリ立ち上げ直後、10秒ごとの自動更新で実行される、他の誰かがドラッグ&ドロップした場合に実行される
// 画面上のすべてのカードをチェックしFirebaseに保存されている位置情報を見て、正しいレーンに移動させる
function syncCardPositions() {
  document.querySelectorAll('.card-item').forEach(cardEl => {
    let targetZone = document.getElementById(currentPositions[cardEl.dataset.cardId] || 'zone_unassigned');
    if (targetZone && cardEl.parentElement !== targetZone) targetZone.appendChild(cardEl);
  });

  updateLaneCounts();
}

// 各レーンの件数を数える処理
function updateLaneCounts() {
  for (let i = 1; i <= 15; i++) {
    let zoneId = 'zone_lane_' + i;
    let dropzone = document.getElementById(zoneId);
    let badge = document.getElementById('count_badge_' + zoneId);
    if (dropzone && badge) {
      let count = dropzone.querySelectorAll('.card-item').length;
      badge.textContent = count + '件';
      if (count > 0) {
        badge.classList.add('has-cards');
      } else {
        badge.classList.remove('has-cards');
      }
    }
  }
}

function addMemberToCard(cardId, cardName, member) {
  let activeCount = 0;
  for (let k in currentFirebaseTimers) { if (currentFirebaseTimers[k].cardId === cardId) activeCount++; }
  if (activeCount >= 4) { alert('1つのタスクに割り当てられるメンバーは最大4名枠までです。'); return; }

  var key = cardId + '_' + member;
  if (currentFirebaseTimers[key]) return;

  let currentZone = currentPositions[cardId] || 'zone_unassigned';
  let initialState = (currentZone === 'zone_unassigned' || currentZone === 'zone_hold') ? 'paused' : 'running';

  set(ref(db, 'timers/' + key), { cardId: cardId, cardName: cardName, member: member, state: initialState, startTime: initialState === 'running' ? Date.now() : null, accumulated: 0 });
  addLogToFirebase(member, cardName, 0, initialState === 'running');
}

// 全員再開、全員停止処理の開始
function toggleBatchTimersForCard(cardId) {
  let runningCount = 0;

  // 現在、当該カードで何人のタイマーが作動中かを数える
  for (let k in currentFirebaseTimers) {
    if (currentFirebaseTimers[k].cardId === cardId && currentFirebaseTimers[k].state === 'running') runningCount++;
  }

  // 1名でも動いていれば、全員停止
  if (runningCount > 0) stopAllTimersForCard(cardId);
  // 全員止まっていれば、全員再開
  else resumeAllTimersForCard(cardId);
}

// toggleBatchTimersForCardから呼ばれる
// 誰か1名でも動いていれば実行、全員停止
function stopAllTimersForCard(cardId) {
  for (let key in currentFirebaseTimers) {
    let data = currentFirebaseTimers[key];
    if (data.cardId === cardId && data.state === 'running') {
      // 稼働時間を計算
      let elapsed = data.accumulated + Math.floor((Date.now() - data.startTime) / 1000);
      // Firebase更新（他の人が別端末でみても、常に同じ値が表示されるように更新）
      update(ref(db, 'timers/' + key), { state: 'paused', accumulated: elapsed, startTime: null });
      // 全員分記録
      addLogToFirebase(data.member, data.cardName, elapsed, false);
    }
  }
}

// toggleBatchTimersForCardから呼ばれる
// 全員分止まっている場合に実行、全員再開
function resumeAllTimersForCard(cardId) {
  // 当該カードが未割当か保留にいる場合、処理中断
  let currentZone = currentPositions[cardId] || 'zone_unassigned';
  if (currentZone === 'zone_unassigned' || currentZone === 'zone_hold') return;
  for (let key in currentFirebaseTimers) {
    let data = currentFirebaseTimers[key];
    // そのカードの担当者 & タイマーが今止まっている場合のみ再開する
    if (data.cardId === cardId && data.state === 'paused') {
      update(ref(db, 'timers/' + key), { state: 'running', startTime: Date.now() });
      addLogToFirebase(data.member, data.cardName, data.accumulated, true);
    }
  }
}

function renderAllTimers() {
  let timersByCard = {};
  document.querySelectorAll('.card-item').forEach(cardEl => { timersByCard[cardEl.dataset.cardId] = []; });

  for (let key in currentFirebaseTimers) {
    let data = currentFirebaseTimers[key];
    if (timersByCard[data.cardId]) timersByCard[data.cardId].push({ key: key, data: data });
  }

  document.querySelectorAll('.card-item').forEach(cardEl => {
    let cardId = cardEl.dataset.cardId;
    let timers = timersByCard[cardId] || [];
    let isWorking = false;
    let runningCount = 0;

    for (let i = 0; i < 4; i++) {
      let slotEl = document.getElementById(`slot_${cardId}_${i}`);
      if (!slotEl) continue;

      if (i < timers.length) {
        let t = timers[i];
        if (t.data.state === 'running') { isWorking = true; runningCount++; }
        updateSlotVisuals(slotEl, t.key, t.data);
      } else {
        if (slotEl.dataset.key && localTimers[slotEl.dataset.key]) { clearInterval(localTimers[slotEl.dataset.key]); delete localTimers[slotEl.dataset.key]; }
        slotEl.dataset.key = ''; delete slotEl.dataset.assignedMember;
        slotEl.className = 'member-slot empty-slot'; slotEl.innerHTML = '';
      }
    }

    let activeMembers = timers.map(t => t.data.member);
    cardEl.querySelectorAll('.quick-add-btn').forEach(btn => {
      if (activeMembers.includes(btn.dataset.memberName)) btn.classList.add('added');
      else btn.classList.remove('added');
    });

    if (isWorking) cardEl.classList.add('is-working');
    else cardEl.classList.remove('is-working');

    let btnBatch = document.getElementById('batch_' + cardId);
    if (btnBatch) {
      if (runningCount > 0) {
        btnBatch.style.display = 'block'; btnBatch.className = 'btn-batch stop'; btnBatch.textContent = '全員のタイマーを停止';
      } else if (timers.length > 0) {
        let currentZone = currentPositions[cardId] || 'zone_unassigned';
        if (currentZone === 'zone_unassigned' || currentZone === 'zone_hold') btnBatch.style.display = 'none';
        else { btnBatch.style.display = 'block'; btnBatch.className = 'btn-batch resume'; btnBatch.textContent = '全員のタイマーを再開'; }
      } else { btnBatch.style.display = 'none'; }
    }
  });

  applyHighlight();
}

function updateSlotVisuals(slotEl, key, data) {
  if (slotEl.dataset.key !== key) {
    slotEl.dataset.key = key;
    slotEl.dataset.assignedMember = data.member;
    slotEl.innerHTML = `
        <div class="slot-avatar-wrap" style="margin-bottom:2px;"></div>
        <div class="slot-name">${data.member}</div>
        <div class="slot-time val-text"></div>
        <button class="btn-toggle"></button>
      `;
    let av = makeAvatarEl(data.member, 18);
    av.dataset.member = data.member;
    slotEl.querySelector('.slot-avatar-wrap').appendChild(av);
    slotEl.querySelector('.btn-toggle').addEventListener('click', () => { toggleFirebaseTimer(key); });
  }

  let vs = slotEl.querySelector('.val-text');
  let tb = slotEl.querySelector('.btn-toggle');

  if (data.state === 'running') {
    slotEl.className = 'member-slot filled running';
    vs.className = 'slot-time val-text running'; tb.className = 'btn-toggle btn-running'; tb.textContent = '停止';
    if (!localTimers[key]) {
      localTimers[key] = setInterval(() => { if (vs) vs.textContent = fmt(data.accumulated + Math.floor((Date.now() - data.startTime) / 1000)); }, 1000);
    }
    vs.textContent = fmt(data.accumulated + Math.floor((Date.now() - data.startTime) / 1000));
  } else {
    slotEl.className = 'member-slot filled paused';
    vs.className = 'slot-time val-text paused'; tb.className = 'btn-toggle btn-paused'; tb.textContent = '再開';
    vs.textContent = fmt(data.accumulated);
    if (localTimers[key]) { clearInterval(localTimers[key]); delete localTimers[key]; }
  }
}

function toggleFirebaseTimer(key) {
  let data = currentFirebaseTimers[key];
  if (!data) return;
  let currentZone = currentPositions[data.cardId] || 'zone_unassigned';

  // タイマーが作動している場合
  if (data.state === 'running') {
    // 停止ボタンが押される場合（runningしているということは、タイマーが作動している状態。「タイマーが作動中」の次のアクションは停止しかない）
    let elapsed = data.accumulated + Math.floor((Date.now() - data.startTime) / 1000);
    update(ref(db, 'timers/' + key), { state: 'paused', accumulated: elapsed, startTime: null });
    // ログを記録する
    addLogToFirebase(data.member, data.cardName, elapsed, false);
  }
  // タイマーが作動していない場合（タイマー開始時、再開時の処理）
  else {
    //未割当エリア、保留エリアだった場合、return。タイマーが動かないようにする。
    if (currentZone === 'zone_unassigned' || currentZone === 'zone_hold') return;
    update(ref(db, 'timers/' + key), { state: 'running', startTime: Date.now() });
    addLogToFirebase(data.member, data.cardName, data.accumulated, true);
  }
}

// 各メンバーの顔写真、作業場所のハイライト処理
function buildSettings() {
  var container = document.getElementById('memberSettings'); container.innerHTML = '';

  // 各メンバーに対して処理
  MEMBERS.forEach(name => {
    var item = document.createElement('div');
    item.className = 'member-setting-item';
    item.id = 'setting_' + name;

    var uploadArea = document.createElement('div'); uploadArea.className = 'photo-upload-area';
    if (memberPhotos[name]) {
      // Firebaseに写真があれば、その写真を表示
      var img = document.createElement('img'); img.src = memberPhotos[name]; uploadArea.appendChild(img);
    } else { // 写真がなければ「+」ボタンを表示
      var ph = document.createElement('span'); ph.className = 'photo-placeholder'; ph.textContent = '+'; uploadArea.appendChild(ph);
    }

    var fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/*';
    fileInput.addEventListener('change', e => {
      var file = e.target.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = ev => { set(ref(db, 'photos/' + name), ev.target.result); };
      reader.readAsDataURL(file);
    });
    uploadArea.appendChild(fileInput);

    var info = document.createElement('div');
    var nm = document.createElement('div'); nm.className = 'member-setting-name'; nm.textContent = name;
    var hint = document.createElement('div'); hint.className = 'member-setting-hint'; hint.textContent = memberPhotos[name] ? '登録済み' : '写真未登録';

    info.appendChild(nm); info.appendChild(hint);
    item.appendChild(uploadArea); item.appendChild(info); container.appendChild(item);

    // ハイライト処理
    item.addEventListener('click', (e) => {
      // 写真枠をクリックしたら処理終了
      if (e.target.closest('.photo-upload-area')) return;

      // クリックしたメンバーが既にハイライトされているかどうかを確認する。もしハイライトされていたらハイライトをなくす
      if (currentHighlightMember === name) currentHighlightMember = null;
      // そうでなければ、ハイライトさせるメンバーの情報を格納する
      else currentHighlightMember = name;
      applyHighlight();
    });
  });
  // 写真登録した際に、ハイライトが消えてしまわないように対処
  applyHighlight();
}

// ハイライト処理
function applyHighlight() {
  document.body.classList.remove('has-highlight');
  document.querySelectorAll('.highlight-active').forEach(el => el.classList.remove('highlight-active'));

  if (!currentHighlightMember) return;

  document.body.classList.add('has-highlight');

  let activeSetting = document.getElementById('setting_' + currentHighlightMember);
  if (activeSetting) activeSetting.classList.add('highlight-active');

  document.querySelectorAll('.member-slot').forEach(slot => {
    if (slot.dataset.assignedMember === currentHighlightMember) {
      slot.classList.add('highlight-active');
      let cardEl = slot.closest('.card-item');
      if (cardEl) cardEl.classList.add('highlight-active');
      let laneRow = slot.closest('.lane-row');
      if (laneRow) laneRow.classList.add('highlight-active');
    }
  });
}

function getColor(n) { if (!memberColors[n]) { memberColors[n] = palettes[colorIdx % palettes.length]; colorIdx++; } return memberColors[n]; }
function fmt(s) { return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function makeAvatarEl(member, size) {
  var wrap = document.createElement('div'); wrap.className = 't-avatar'; wrap.style.width = size + 'px'; wrap.style.height = size + 'px';
  if (memberPhotos[member]) {
    var img = document.createElement('img'); img.src = memberPhotos[member]; wrap.appendChild(img);
  } else {
    var col = getColor(member); wrap.style.background = col.bg; wrap.style.color = col.fg; wrap.textContent = member.slice(0, 2);
  }
  return wrap;
}

function refreshAllTimerAvatars() {
  document.querySelectorAll('.t-avatar[data-member]').forEach(el => {
    var member = el.dataset.member; el.innerHTML = '';
    if (memberPhotos[member]) {
      var img = document.createElement('img'); img.src = memberPhotos[member]; el.appendChild(img);
      el.style.background = ''; el.style.color = '';
    } else {
      var col = getColor(member); el.style.background = col.bg; el.style.color = col.fg; el.textContent = member.slice(0, 2);
    }
  });
}

// logs格納、1件につき5カラム分
// member：誰が
// cardName：どのカード
// seconds：時点での合計秒数
// 開始（true）か停止（false）か
// 現時点の日時
function addLogToFirebase(member, cardName, seconds, isResume) {
  push(ref(db, 'logs'), { member: member, cardName: cardName, seconds: seconds, isResume: isResume, timestamp: Date.now() });
}

function renderLogs(logsObj) {
  var list = document.getElementById('logList'); list.innerHTML = '';
  let logsArr = Object.values(logsObj).sort((a, b) => b.timestamp - a.timestamp);
  if (logsArr.length === 0) { list.innerHTML = '<div style="padding:8px; font-size:11px; color:#888;">ログはありません</div>'; return; }
  logsArr.slice(0, 50).forEach(log => {
    var timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var el = document.createElement('div'); el.className = 'log-item';
    var lbl = log.isResume ? '<span style="color:#0052cc;">[開始]</span> ' : '<span style="color:#eb5a46;">[停止]</span> ';
    el.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px; flex:1; overflow:hidden;">
          <b style="flex-shrink:0;">${log.member}</b>
          <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${lbl}${log.cardName}</span>
        </div>
        <div style="font-family:monospace; margin-left:8px;">${fmt(log.seconds)} <span style="color:#888;">${timeStr}</span></div>
      `;
    list.appendChild(el);
  });
}
