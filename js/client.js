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

      // 💡 ここで「表示したい項目名」と「色・アイコン」を自由に設定します！
      // Trelloで使える色は: blue, green, orange, red, yellow, purple, pink, sky, lime, light-gray, black
      var displayRules = {
        '登録ナンバ': { color: 'yellow', icon: '🚗 ' },
        '_N受取区分': { color: 'green', icon: '📥 ' },
        'N引渡区分': { color: 'sky', icon: '📤 ' },
        'N作業完了年月日': { color: 'red', icon: '🏁 ' }
        // 必要なものをどんどん下に追加できます！
      };

      // カードに入力されているデータ群をループ処理
      cardFields.forEach(function(item) {
        // IDから「本当の項目名」を探し出す
        var fieldDef = boardFields.find(function(f) { return f.id === item.idCustomField; });
        if (!fieldDef) return;

        var fieldName = fieldDef.name;
        var rule = displayRules[fieldName];

        // もし上のルールに書いてある項目名と一致したら、バッジを作る！
        if (rule) {
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
              text: rule.icon + displayValue, // 「🚗 130ア 326」みたいになる
              color: rule.color              // 指定した色を塗る
            });
          }
        }
      });

      // 完成したバッジのリストをTrelloに渡して表面に表示させる！
      return badges;
    });
  }
});
