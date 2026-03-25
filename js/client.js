window.TrelloPowerUp.initialize({
  // カードの裏面にセクション（作業者リストなど）を表示する
  'card-back-section': function(t, opts) {
    return {
      title: '工数タイマー',
      icon: 'https://cdn.hyperdev.com/us-east-1%3A3d31b21c-011a-4fc2-adbd-b863c06581a8%2Fclock.svg',
      content: {
        type: 'iframe',
        url: t.signUrl('./card-back.html'), // UIの本体
        height: 600 // 画像のUIは縦に長いので少し高めに設定
      }
    };
  }
});
