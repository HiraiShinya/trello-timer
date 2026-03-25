var Storage = {

  // タイマーデータを保存（カードに紐づく）
  saveTimer: function(t, member, data) {
    return t.get('card', 'shared', 'timers', {})
      .then(function(timers) {
        timers[member] = {
          start: data.start,           // 開始時刻（Unix ms）
          accumulated: data.accumulated, // 累計秒数
          running: data.running
        };
        return t.set('card', 'shared', 'timers', timers);
      });
  },

  // タイマーデータを取得
  getTimers: function(t) {
    return t.get('card', 'shared', 'timers', {});
  },

  // 顔写真をメンバーごとに保存（ボード全体で共有）
  savePhoto: function(t, memberName, base64) {
    return t.get('board', 'shared', 'photos', {})
      .then(function(photos) {
        photos[memberName] = base64;
        return t.set('board', 'shared', 'photos', photos);
      });
  },

  // 顔写真を取得
  getPhotos: function(t) {
    return t.get('board', 'shared', 'photos', {});
  }
};
