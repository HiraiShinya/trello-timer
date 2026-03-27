window.TrelloPowerUp.initialize({
  // ==========================================
  // 1. 今まで通りの「一括タイマー画面」を開くボタン
  // ==========================================
  'board-buttons': function(t, options) {
    return [{
      text: '⏱️ 一括タイマー管理',
      callback: function(t) {
        return t.modal({
          url: './timer.html',
          accentColor: '#0079bf',
          fullscreen: true,
          title: '配車・アサイン管理ボード'
        });
      }
    }];
  },

  // ==========================================
  // 2. ★新規追加：カード表面に色付きバッジを表示する機能
  // ==========================================
  'card-badges': function(t, options) {
    return Promise.all([
      t.card('customFieldItems'), // カードに入力されたデータを取得
      t.board('customFields')     // ボード全体のカスタムフィールドの設定を取得
    ])
    .then(function(values) {
      var cardFields = values[0].customFieldItems;
      var boardFields = values[1].customFields;
      var badges = [];

      // もしカスタムフィールドが1つも入力されていなければ何もしない
      if (!cardFields || !boardFields) {
        return badges;
      }

      // 💡 ここに書いた【上からの順番】で、必ず左から右へバッジが並びます！
      // Trelloで使える色は: blue, green, orange, red, yellow, purple, pink, sky, lime, light-gray, black
      var displayRules = {
        'Ｎ作業開始年月日': { color: 'blue', icon: '📅 ' },
        'Ｎ作業開始時刻': { color: 'blue', icon: '⌚ ' },
        'Ｎ工予見ＮＯ': { color: 'green', icon: ' ' },
        'Ａ車型': { color: 'sky', icon: '🚚 ' },
        'Ｎ作業完了年月日': { color: 'red', icon: '📅 ' },
        'Ｎ作業完了時刻': { color: 'red', icon: '⌚ ' }
      };

      // Trelloの気まぐれな順番ではなく、上で決めたルールの順番通りに探してバッジを作る
      Object.keys(displayRules).forEach(function(ruleName) {
        var rule = displayRules[ruleName];

        // 1. ボードの設定から、この名前の項目のIDを探す
        var fieldDef = boardFields.find(function(f) { return f.name === ruleName; });
        if (!fieldDef) return;

        // 2. カードに入力されたデータの中から、そのIDと一致するものを探す
        var item = cardFields.find(function(i) { return i.idCustomField === fieldDef.id; });
        if (!item) return; // 未入力ならスキップ

        var displayValue = '';

        // テキストや数値、日付の場合
        if (item.value) {
          displayValue = item.value.text || item.value.number || item.value.date;
          // 日付の場合は「2026-11-28T00:00:00.000Z」みたいになるので、最初の10文字（年-月-日）だけ切り取る
          if (item.value.date) {
            displayValue = displayValue.substring(0, 10);
          }
        } 
        // ドロップダウン（選択肢）の場合
        else if (item.idValue && fieldDef.options) {
          var selectedOption = fieldDef.options.find(function(o) { return o.id === item.idValue; });
          if (selectedOption && selectedOption.value) {
            displayValue = selectedOption.value.text;
          }
        }

        // データが空じゃなければバッジとして追加
        if (displayValue) {
          badges.push({
            text: rule.icon + displayValue, 
            color: rule.color              
          });
        }
      });

      // 完成したバッジのリストをTrelloに渡して表面に表示させる！
      return badges;
    });
  }
});
