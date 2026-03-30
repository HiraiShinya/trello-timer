# trello-timer

## Trello Power-Up 管理画面での必須設定
もし新しい環境に導入する際は、Trelloの開発者ポータルにて以下の設定を行ってください。

* **Iframe connector URL:** `https://hinononiton.netlify.app/index.html`
ホスティング先のURLを指定してください。

### 機能（Capabilities）のトグル設定
以下の2つだけを「ON（緑色）」にし、それ以外はすべて「OFF（灰）」にしてください。
追加で機能開発をする場合は、Capabilities URLにアクセスしてON（緑色）にしてください。
- [x] ボードのボタン (`board-buttons`)
- [x] カードのバッジ (`card-badges`)

* **Capabilities URL:** `https://trello.com/power-ups/69c4db17d70e1c848cc8efb3/edit/capabilities`
