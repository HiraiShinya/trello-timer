// 停止時：Trello に保存
function stopTimer(t, member) {
  var key = member;
  var elapsed = timers[key].accumulated 
    + Math.floor((Date.now() - timers[key].start) / 1000);

  // ← ここだけ変わる（Trelloへ保存）
  Storage.saveTimer(t, member, {
    start: null,
    accumulated: elapsed,
    running: false
  });

  clearInterval(timers[key].iv);
  timers[key].accumulated = elapsed;
  timers[key].running = false;
}

// 開始時：Trello に保存
function startTimer(t, member) {
  var start = Date.now();
  Storage.saveTimer(t, member, {
    start: start,
    accumulated: timers[member]?.accumulated || 0,
    running: true
  });
  // ...タイマーのsetInterval処理
}
