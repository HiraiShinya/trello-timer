import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getDatabase, ref, onValue, set, update, push } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCZSImS2hTSASLj9NfCpCMOWsT54d9hh7k",
  authDomain: "trello-timerbb.firebaseapp.com",
  databaseURL: "https://trello-timerbb-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "trello-timerbb",
  storageBucket: "trello-timerbb.firebasestorage.app",
  messagingSenderId: "1082057229145",
  appId: "1:1082057229145:web:93166029c94b58617fc248"
};

// firebase設定情報を読み込む
const app = initializeApp(firebaseConfig);
// Realtime Databaseのインスタンス作成（タイマーのリアルタイム同期用）
const db = getDatabase(app);
// Firestoreのインスタンスを作成（ログ格納用）
const fs = getFirestore(app);

// 作業員名簿：同姓同名に対応するため、名前ではなくID（社員番号等）で管理
var MEMBERS = [
  { id: 'W01', name: '田中' },
  { id: 'W02', name: '佐藤' },
  { id: 'W03', name: '鈴木' },
  { id: 'W04', name: '山田' },
  { id: 'W05', name: '伊藤' },
  { id: 'W06', name: '渡辺' },
  { id: 'W07', name: '田中' } 
];
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

// レーン作成ループ（HTML生成部分）
// lane-label に style="flex-shrink: 0;" を追加
lanesContainer.insertAdjacentHTML('beforeend', `
    <div class="lane-row${collapsedClass}" style="display: flex; align-items: stretch; margin-bottom: 10px;">
      <div class="lane-label" data-lane="${i}" style="flex-shrink: 0; min-width: 40px; cursor: pointer;">
        <span>${i}レーン</span>
        <span class="toggle-icon">${iconTxt}</span>
        <span class="card-count-badge" id="count_badge_${zoneId}">0件</span>
      </div>

      <div class="dropzone" id="${zoneId}" style="
        flex-grow: 1;
        min-width: 0; /* 親要素を突き破らないための設定 */
        display: flex !important;
        flex-flow: row nowrap !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        padding: 10px;
        min-height: 200px;
        gap: 12px;
        align-items: flex-start;
        background: #f8f9fa; /* 境界がわかりやすいよう薄い色をつけています */
        margin:auto;
      "></div>
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
// 例：onValue(ref(db, 'photos')で、Firebaseの「db」にある「photo」という名前の格納庫を24時間監視するという意味
// 例：「「{}」は、想定外事象（snapshot.valが空だった場合）のエラー回避
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

    var filteredCards = values[1].filter(card => {
      return card.idList === targetList.id && card.name !== 'このリスト内のカード';
    });

    renderCardsToFactory(filteredCards);
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

    var labelsHtml = '';
    if (card.labels && card.labels.length > 0) {
      labelsHtml = '<div class="trello-labels-container" style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">';
      card.labels.forEach(label => {
        var colorClass = label.color ? 't-label-' + label.color : 't-label-default';
        labelsHtml += `<span class="trello-label ${colorClass}" style="margin:0; font-size:11px; height:22px; line-height:22px; padding:0 8px; display:inline-flex; align-items:center; box-sizing:border-box; white-space:nowrap; border-radius:3px;">${label.name || ''}</span>`;
      });
      labelsHtml += '</div>';
    }

    // --- 修正ポイント：flex: 0 0 420px と min-width を指定して横幅を固定 ---
    var cardHtml = `
        <div class="card-item" id="card_${cardId}" data-card-id="${cardId}" style="
          display:flex; 
          flex: 0 0 420px; 
          min-width: 420px; 
          min-height: auto; 
          overflow:visible; 
          align-items: stretch; 
          margin-right: 12px; 
          box-sizing: border-box; 
          position:relative;
          background: #fff;
          border: 1px solid #ddd;
          border-radius: 8px;
        ">
          <div class="working-badge" style="position:absolute; top:-5px; left:10px; z-index:10;">作業中</div>

          <div class="card-left" style="flex: 1; min-width: 0; padding: 20px 10px 10px 12px; display: flex; flex-direction: column; overflow:visible;">
            <div style="margin-bottom: 10px;">
              <div class="card-header" style="font-weight:bold; margin-bottom:8px; line-height:1.4; font-size:14px; color: #172b4d; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${card.name}">${card.name}</div>
              <div class="card-meta-row" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:2px;">
                ${labelsHtml}
                <button class="btn-open-detail" id="detail_${cardId}" title="別タブで詳細を開く" style="border:1px solid #dfe1e6; background:#f4f5f7; border-radius:3px; padding:0 8px; cursor:pointer; color:#5e6c84; font-size:11px; height:22px; display:flex; align-items:center; white-space:nowrap; flex-shrink:0;">🔍 詳細</button>
              </div>
            </div>
            
            <div class="card-body" style="margin-top:auto;">
              <div style="font-size:10px; color:#888; margin-bottom:4px;">タップでアサイン</div>
              <div class="quick-member-list" id="quick_${cardId}" style="display:flex; gap:4px; overflow-x:auto;"></div>
              <button class="btn-batch" id="batch_${cardId}" style="margin-top:10px;"></button>
            </div>
          </div>

          <div class="card-right" id="slots_${cardId}" style="
            width:150px; 
            flex-shrink:0; 
            border-left:1px dashed #ddd; 
            padding:10px 5px; 
            display:grid; 
            grid-template-columns: 1fr 1fr; 
            grid-template-rows: 75px 75px; 
            gap:8px 6px; 
            background:#fcfcfc;
            align-content: start;
            margin:auto;
          ">
            <div class="member-slot empty-slot" id="slot_${cardId}_0" style="height:75px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:5px 0; box-sizing:border-box;"></div>
            <div class="member-slot empty-slot" id="slot_${cardId}_1" style="height:75px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:5px 0; box-sizing:border-box;"></div>
            <div class="member-slot empty-slot" id="slot_${cardId}_2" style="height:75px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:5px 0; box-sizing:border-box;"></div>
            <div class="member-slot empty-slot" id="slot_${cardId}_3" style="height:75px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:2px 0; box-sizing:border-box;"></div>
          </div>
        </div>
      `;
    factory.insertAdjacentHTML('beforeend', cardHtml);

    document.getElementById('detail_' + cardId).addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(`https://trello.com/c/${cardId}`, '_blank');
    });

var quickList = document.getElementById('quick_' + cardId);
MEMBERS.forEach(memberObj => { // name ではなく memberObj を受け取る
  var btn = document.createElement('button');
  btn.className = 'quick-add-btn';
  btn.dataset.memberId = memberObj.id; // 名前ではなくIDをデータ属性に持つ
  btn.appendChild(makeAvatarEl(memberObj, 18)); // オブジェクトを渡す
  var nameSpan = document.createElement('span');
  nameSpan.textContent = memberObj.name; // 表示は名前
  btn.appendChild(nameSpan);
  
  btn.addEventListener('click', () => {
    if (btn.classList.contains('added')) return;
    // 名前ではなくオブジェクト(memberObj)をそのまま渡す
    addMemberToCard(cardId, card.name, memberObj); 
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

function addMemberToCard(cardId, cardName, memberObj) {
  let activeCount = 0;
  for (let k in currentFirebaseTimers) { if (currentFirebaseTimers[k].cardId === cardId) activeCount++; }
  if (activeCount >= 4) { alert('最大4名までです。'); return; }

  // キーに memberObj.id を使用（同姓同名でも衝突しない）
  var key = cardId + '_' + memberObj.id;
  if (currentFirebaseTimers[key]) return;

  let currentZone = currentPositions[cardId] || 'zone_unassigned';
  let initialState = (currentZone === 'zone_unassigned' || currentZone === 'zone_hold') ? 'paused' : 'running';

  // RTDB保存：後で参照しやすいよう memberId と memberName を分ける
  set(ref(db, 'timers/' + key), { 
    cardId: cardId, 
    cardName: cardName, 
    memberId: memberObj.id, 
    memberName: memberObj.name, 
    state: initialState, 
    startTime: initialState === 'running' ? Date.now() : null, 
    accumulated: 0 
  });

  addLogToFirebase(memberObj.name, cardName, 0, initialState === 'running');
  saveToFirestore(memberObj.id, memberObj.name, cardName, cardId, 0, initialState === 'running');
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
      addLogToFirebase(data.memberName, data.cardName, elapsed, false);
      saveToFirestore(data.memberId, data.memberName, data.cardName, data.cardId, elapsed, false);
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
      addLogToFirebase(data.memberName, data.cardName, data.accumulated, true);
      saveToFirestore(data.memberId, data.memberName, data.cardName, data.cardId, data.accumulated, true);
    }
  }
}

function renderAllTimers() {
  let timersByCard = {};
  // 画面上の全カードに対して、空のタイマーリストを準備
  document.querySelectorAll('.card-item').forEach(cardEl => { 
    timersByCard[cardEl.dataset.cardId] = []; 
  });

  // Firebaseから取得したタイマーデータをカードごとに振り分け
  for (let key in currentFirebaseTimers) {
    let data = currentFirebaseTimers[key];
    if (timersByCard[data.cardId]) {
      timersByCard[data.cardId].push({ key: key, data: data });
    }
  }

  // 各カードの表示を更新
  document.querySelectorAll('.card-item').forEach(cardEl => {
    let cardId = cardEl.dataset.cardId;
    let timers = timersByCard[cardId] || [];
    let isWorking = false;
    let runningCount = 0;

    // 4つのメンバースロットを更新
    for (let i = 0; i < 4; i++) {
      let slotEl = document.getElementById(`slot_${cardId}_${i}`);
      if (!slotEl) continue;

      if (i < timers.length) {
        let t = timers[i];
        // 1人でも動いていればカード全体を「作業中」状態にする
        if (t.data.state === 'running') { 
          isWorking = true; 
          runningCount++; 
        }
        updateSlotVisuals(slotEl, t.key, t.data);
      } else {
        // メンバーがいないスロットを掃除
        if (slotEl.dataset.key && localTimers[slotEl.dataset.key]) { 
          clearInterval(localTimers[slotEl.dataset.key]); 
          delete localTimers[slotEl.dataset.key]; 
        }
        slotEl.dataset.key = ''; 
        slotEl.dataset.assignedMemberId = ''; // IDをクリア
        slotEl.className = 'member-slot empty-slot'; 
        slotEl.innerHTML = '';
      }
    }

    // --- 【修正ポイント1】クイックアサインボタン（顔写真ボタン）の「追加済み」状態の判定 ---
    // 名前ではなく memberId で判定を行う
    let activeMemberIds = timers.map(t => t.data.memberId);
    cardEl.querySelectorAll('.quick-add-btn').forEach(btn => {
      // ボタン側の dataset.memberId と比較
      if (activeMemberIds.includes(btn.dataset.memberId)) {
        btn.classList.add('added'); // グレーアウト等
      } else {
        btn.classList.remove('added');
      }
    });

    // カード自体のハイライト（作業中なら枠を光らせる等）
    if (isWorking) cardEl.classList.add('is-working');
    else cardEl.classList.remove('is-working');

    // --- 【修正ポイント2】一括ボタン（全員のタイマーを停止/再開）の表示制御 ---
    let btnBatch = document.getElementById('batch_' + cardId);
    if (btnBatch) {
      if (runningCount > 0) {
        // 1人でも動いていれば「停止」ボタンを表示
        btnBatch.style.display = 'block'; 
        btnBatch.className = 'btn-batch stop'; 
        btnBatch.textContent = '全員のタイマーを停止';
      } else if (timers.length > 0) { 
        // 全員止まっていて、かつメンバーが1人以上アサインされている場合
        let currentZone = currentPositions[cardId] || 'zone_unassigned';
        // 「未割当」や「保留」にいる時はボタンを出さない
        if (currentZone === 'zone_unassigned' || currentZone === 'zone_hold') {
          btnBatch.style.display = 'none';
        } else {
          // 「作業レーン」にいる時だけ「再開」ボタンを表示
          btnBatch.style.display = 'block'; 
          btnBatch.className = 'btn-batch resume'; 
          btnBatch.textContent = '全員のタイマーを再開';
        }
      } else {
        // 誰もアサインされていないカードはボタンを隠す
        btnBatch.style.display = 'none';
      }
    }
  });

  applyHighlight(); // ハイライトの再適用
}

function updateSlotVisuals(slotEl, key, data) {
  // スロットの内容がまだ作られていない、または別のタイマーに切り替わった場合のみ初期化
  if (slotEl.dataset.key !== key) {
    slotEl.dataset.key = key;
    // 重要：名前ではなく「ID」をスロットの目印にする
    slotEl.dataset.assignedMemberId = data.memberId; 

    slotEl.innerHTML = `
        <div class="slot-avatar-wrap" style="margin-bottom:2px;"></div>
        <div class="slot-name" style="font-size:11px; font-weight:bold;">${data.memberName}</div>
        <div class="slot-time val-text"></div>
        <button class="btn-toggle"></button>
      `;

    // アバター要素を作成（オブジェクト形式でIDと名前を渡す）
    let av = makeAvatarEl({ id: data.memberId, name: data.memberName }, 18);
    
    // 重要：画像更新(refreshAllTimerAvatars)のために、アバター自体にもIDを持たせる
    av.dataset.assignedMemberId = data.memberId; 
    
    slotEl.querySelector('.slot-avatar-wrap').appendChild(av);

    // 停止・再開ボタンのクリックイベント
    slotEl.querySelector('.btn-toggle').addEventListener('click', () => { 
      toggleFirebaseTimer(key); 
    });
  }

  // 以下、タイマーの数字とボタンの表示更新
  let vs = slotEl.querySelector('.val-text');
  let tb = slotEl.querySelector('.btn-toggle');

  if (data.state === 'running') {
    slotEl.className = 'member-slot filled running';
    vs.className = 'slot-time val-text running'; 
    tb.className = 'btn-toggle btn-running'; 
    tb.textContent = '停止';
    
    if (!localTimers[key]) {
      localTimers[key] = setInterval(() => { 
        if (vs) vs.textContent = fmt(data.accumulated + Math.floor((Date.now() - data.startTime) / 1000)); 
      }, 1000);
    }
    vs.textContent = fmt(data.accumulated + Math.floor((Date.now() - data.startTime) / 1000));
  } else {
    slotEl.className = 'member-slot filled paused';
    vs.className = 'slot-time val-text paused'; 
    tb.className = 'btn-toggle btn-paused'; 
    tb.textContent = '再開';
    
    vs.textContent = fmt(data.accumulated);
    if (localTimers[key]) { 
      clearInterval(localTimers[key]); 
      delete localTimers[key]; 
    }
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
    addLogToFirebase(data.memberName, data.cardName, elapsed, false);
    saveToFirestore(data.memberId, data.memberName, data.cardName, data.cardId, elapsed, false);
  }
  // タイマーが作動していない場合（タイマー開始時、再開時の処理）
  else {
    //未割当エリア、保留エリアだった場合、return。タイマーが動かないようにする。
    if (currentZone === 'zone_unassigned' || currentZone === 'zone_hold') return;
    update(ref(db, 'timers/' + key), { state: 'running', startTime: Date.now() });
    addLogToFirebase(data.memberName, data.cardName, data.accumulated, true);
    saveToFirestore(data.memberId, data.memberName, data.cardName, data.cardId, data.accumulated, true);
  }
}

// 各メンバーの顔写真、作業場所のハイライト処理
function buildSettings() {
  var container = document.getElementById('memberSettings'); container.innerHTML = '';

  // 各メンバーに対して処理
  MEMBERS.forEach(member => {
    var item = document.createElement('div');
    item.className = 'member-setting-item';
    item.id = 'setting_' + member.id;

    var uploadArea = document.createElement('div'); uploadArea.className = 'photo-upload-area';
    if (memberPhotos[member.id]) {
      // Firebaseに写真があれば、その写真を表示
      var img = document.createElement('img'); img.src = memberPhotos[member.id]; uploadArea.appendChild(img);
    } else { // 写真がなければ「+」ボタンを表示
      var ph = document.createElement('span'); ph.className = 'photo-placeholder'; ph.textContent = '+'; uploadArea.appendChild(ph);
    }

    var fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/*';
    fileInput.addEventListener('change', e => {
      var file = e.target.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = ev => { set(ref(db, 'photos/' + member.id), ev.target.result); };
      reader.readAsDataURL(file);
    });
    uploadArea.appendChild(fileInput);

    var info = document.createElement('div');
    var nm = document.createElement('div'); nm.className = 'member-setting-name'; nm.textContent = member.name;
    var hint = document.createElement('div'); hint.className = 'member-setting-hint'; hint.textContent = memberPhotos[member.id] ? '登録済み' : '写真未登録';

    info.appendChild(nm); info.appendChild(hint);
    item.appendChild(uploadArea); item.appendChild(info); container.appendChild(item);

    // ハイライト処理
    item.addEventListener('click', (e) => {
      // 写真枠をクリックしたら処理終了
      if (e.target.closest('.photo-upload-area')) return;

      // クリックしたメンバーが既にハイライトされているかどうかを確認する。もしハイライトされていたらハイライトをなくす
      if (currentHighlightMember === member.id) currentHighlightMember = null;
      // そうでなければ、ハイライトさせるメンバーの情報を格納する
      else currentHighlightMember = member.id;
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
    if (slot.dataset.assignedMemberId === currentHighlightMember) {
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
function makeAvatarEl(memberObj, size) {
  var wrap = document.createElement('div'); 
  wrap.className = 't-avatar'; 
  wrap.style.width = size + 'px'; 
  wrap.style.height = size + 'px';
  
  // 写真の登録があるか、不変の ID をキーにして確認する
  if (memberPhotos[memberObj.id]) {
    var img = document.createElement('img'); 
    img.src = memberPhotos[memberObj.id]; 
    wrap.appendChild(img);
  } else {
    // 写真がない場合は、IDに基づいて色を決定（同姓同名でもIDが違えば別の色になる）
    var col = getColor(memberObj.id); 
    wrap.style.background = col.bg; 
    wrap.style.color = col.fg; 
    wrap.textContent = memberObj.name.slice(0, 2); // 名前の先頭2文字を表示
  }
  return wrap;
}

function refreshAllTimerAvatars() {
  // 名前(data-member)ではなく、ID(data-assigned-member-id)を持つ要素をすべて探す
  document.querySelectorAll('.t-avatar[data-assigned-member-id]').forEach(el => {
    // 1. 要素から作業員IDを取得
    var workerId = el.dataset.assignedMemberId; 
    if (!workerId) return;

    // 2. MEMBERS配列から該当する作業員のオブジェクトを取得
    var m = MEMBERS.find(mem => mem.id === workerId);
    if (!m) return;
    
    el.innerHTML = '';
    
    // 3. IDを元に写真があるかチェック
    if (memberPhotos[workerId]) {
      var img = document.createElement('img'); 
      img.src = memberPhotos[workerId]; 
      el.appendChild(img);
      el.style.background = ''; 
      el.style.color = '';
    } else {
      // 4. 写真がない場合は、IDを元に色を決めて名前の頭文字を表示
      var col = getColor(workerId); 
      el.style.background = col.bg; 
      el.style.color = col.fg; 
      el.textContent = m.name.slice(0, 2);
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

/**
 * Firestoreへ詳細なログを保存する
 * タイマーが「停止」した時、または「開始」した時に呼ばれる
 */
async function saveToFirestore(workerId, workerName, cardName, cardId, seconds, isResume) {
  try {
    const durationMin = parseFloat((seconds / 60).toFixed(1));
    const today = new Date().toISOString().split('T')[0];

    await addDoc(collection(fs, "work_logs"), {
      timestamp: serverTimestamp(),
      date: today,
      workerId: workerId,    // 同姓・同姓同名回避用
      workerName: workerName, 
      cardName: cardName,
      cardId: cardId,        // カード名重複防止用
      durationMin: durationMin,
      action: isResume ? "開始" : "停止",
      type: "log_entry"
    });
    console.log(`Firestore保存完了: ${workerName} (ID:${workerId})`);
  } catch (e) {
    console.error("Firestoreエラー: ", e);
  }
}
