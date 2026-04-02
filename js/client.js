window.TrelloPowerUp.initialize({
  // ==========================================
  // 1. 今まで通りの「一括タイマー画面」を開くボタン
  // ==========================================
  'board-buttons': function (t, options) {
    return [{
      icon: 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22%2344546f%22%3E%3Cpath%20d%3D%22M11.99%202C6.47%202%202%206.48%202%2012s4.47%2010%209.99%2010C17.52%2022%2022%2017.52%2022%2012S17.52%202%2011.99%202zM12%2020c-4.42%200-8-3.58-8-8s3.58-8%208-8%208%203.58%208%208-3.58%208-8%208zm.5-13H11v6l5.25%203.15.75-1.23-4.5-2.67z%22%2F%3E%3C%2Fsvg%3E',

      // 絵文字は外して、テキストのみにします
      text: 'レーン管理',

      callback: function (t) {
        return t.modal({
          url: './timer.html',
          accentColor: '#0079bf',
          size: large,
          title: '配車・アサイン管理ボード'
        });
      }
    }];
  },

  // ==========================================
  // 2. ★新規追加：カード表面に色付きバッジを表示する機能
  // ※カバー画像の全体表示にした場合は、表示されない
  // ==========================================

  // カスタムフィールドの設定とデータ取得
  'card-badges': function (t, options) {
    return Promise.all([
      t.card('customFieldItems'), // カードに入力されたデータを取得
      t.board('customFields')     // ボード全体のカスタムフィールドの設定を取得
    ])
      // 上記の処理が2つとも終わったら実行開始
      .then(function (values) {
        var cardFields = values[0].customFieldItems;
        var boardFields = values[1].customFields;
        var badges = [];

        // もしカスタムフィールドが1つも入力されていなければ何もしない
        if (!cardFields || !boardFields) {
          return badges;
        }

        // 💡 ここに書いた【上からの順番】で、必ず左から右へバッジが並ぶ
        // Trelloで使える色は: blue, green, orange, red, yellow, purple, pink, sky, lime, light-gray, black
        var displayRules = {
          'Ｎ作業開始年月日': { color: 'blue', icon: '📅 ' },
          'Ｎ作業開始時刻': { color: 'blue', icon: '⌚ ' },
          'Ｎ工予見ＮＯ': { color: 'green', icon: ' ' },
          'Ａ車型': { color: 'sky', icon: '🚚 ' },
          'Ｎ作業完了年月日': { color: 'red', icon: '📅 ' },
          'Ｎ作業完了時刻': { color: 'red', icon: '⌚ ' }
        };

        // カードにラベル表示させたいカスタムフィールドを1件ずつ処理。最初は、「Ｎ作業開始年月日」。その次に「Ｎ作業開始時刻」....
        Object.keys(displayRules).forEach(function (ruleName) {
          var rule = displayRules[ruleName];

          // 1. ボードの設定から、この名前の項目のIDを探す。find関数は、配列の中から条件に合致するものを1件返す。合致するものがあれば値が格納され、合致するものがなければundefined、False扱いとなる。
          var fieldDef = boardFields.find(function (f) { return f.name === ruleName; });

          // 一致する名称がカスタムフィールドのdisplayRulesになければ（undefiendだったら）何もしない。次のカスタムフィールドに進み、最初から。
          // 一致する名称がカスタムフィールドのdisplayRulesにあれば、次に進む
          if (!fieldDef) return;

          // 2. カードに入力されたデータの中から、そのIDと一致するものを探す。
          var item = cardFields.find(function (i) { return i.idCustomField === fieldDef.id; });

          if (!item) return;

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
            var selectedOption = fieldDef.options.find(function (o) { return o.id === item.idValue; });
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
