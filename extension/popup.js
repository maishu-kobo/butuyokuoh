document.addEventListener('DOMContentLoaded', async () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const authTokenInput = document.getElementById('authToken');
  const saveSettingsBtn = document.getElementById('saveSettings');
  const pageInfo = document.getElementById('pageInfo');
  const importBtn = document.getElementById('importBtn');
  const importBtnText = document.getElementById('importBtnText');
  const status = document.getElementById('status');

  // 設定を読み込み
  const settings = await chrome.storage.sync.get(['serverUrl', 'authToken']);
  serverUrlInput.value = settings.serverUrl || 'https://butuyokuoh.exe.xyz:8000';
  authTokenInput.value = settings.authToken || '';

  // 設定を保存
  saveSettingsBtn.addEventListener('click', async () => {
    await chrome.storage.sync.set({ 
      serverUrl: serverUrlInput.value,
      authToken: authTokenInput.value
    });
    showStatus('保存しました', 'success');
  });

  // 現在のタブを取得
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';

  // ページの種類を判定
  let pageType = 'unsupported';
  let siteName = '';

  if (url.includes('amazon.co.jp/hz/wishlist') || url.includes('amazon.co.jp/gp/registry/wishlist') || url.includes('amazon.com/hz/wishlist')) {
    pageType = 'amazon';
    siteName = 'Amazon ほしいものリスト';
  } else if (url.includes('my.bookmark.rakuten.co.jp')) {
    pageType = 'rakuten';
    siteName = '楽天 お気に入り';
  }

  if (pageType !== 'unsupported') {
    pageInfo.textContent = `✅ ${siteName}を検出`;
    pageInfo.classList.add('supported');
    importBtn.disabled = false;
  } else {
    pageInfo.textContent = '⚠️ 対応ページではありません';
    pageInfo.classList.add('unsupported');
  }

  // インポートボタン
  importBtn.addEventListener('click', async () => {
    const serverUrl = serverUrlInput.value.replace(/\/$/, '');
    const authToken = authTokenInput.value;

    if (!serverUrl) {
      showStatus('サーバーURLを設定してください', 'error');
      return;
    }

    if (!authToken) {
      showStatus('認証トークンを設定してください', 'error');
      return;
    }

    importBtn.disabled = true;
    importBtnText.innerHTML = '<span class="spinner"></span> 取得中...';
    showStatus('ページからアイテムを取得しています...', 'info');

    try {
      // Content scriptにメッセージを送信
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getItems' });

      if (!response || !response.items || response.items.length === 0) {
        showStatus('アイテムが見つかりませんでした', 'error');
        return;
      }

      showStatus(`${response.items.length}件のアイテムをインポート中...`, 'info');

      // サーバーに送信
      const importResponse = await fetch(`${serverUrl}/api/extension-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: pageType,
          items: response.items,
          token: authToken,
        }),
      });

      const result = await importResponse.json();

      if (importResponse.ok) {
        showStatus(
          `インポート完了！ ${result.imported}件追加、${result.skipped}件スキップ`,
          'success'
        );
      } else {
        showStatus(result.error || 'インポートに失敗しました', 'error');
      }
    } catch (error) {
      console.error('Import error:', error);
      showStatus('エラーが発生しました: ' + error.message, 'error');
    } finally {
      importBtn.disabled = false;
      importBtnText.textContent = 'インポート';
    }
  });

  function showStatus(message, type) {
    status.textContent = message;
    status.className = 'status show ' + type;
  }
});
