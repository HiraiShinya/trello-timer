TrelloPowerUp.initialize({
  // ボードの右上にボタンを配置する命令
  'board-buttons': function(t, options) {
    return [{
      icon: {
        dark: 'https://cdn-icons-png.flaticon.com/16/2088/2088617.png', // 仮の時計アイコン
        light: 'https://cdn-icons-png.flaticon.com/16/2088/2088617.png'
      },
      text: '作業タイマー',
      callback: function(t) {
        // ボタンが押されたら、モーダル（ポップアップ）を開く
        return t.modal({
          url: './timer.html', // あなたが作ったHTMLを呼び出す
          accentColor: '#0079bf',
          height: 650, // 画面の高さ
          fullscreen: true,
          title: '一括タイマー管理' // ポップアップの上のタイトル
        });
      }
    }];
  }
});
