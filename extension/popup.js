document.addEventListener('DOMContentLoaded', async () => {
  // 要素取得
  const serverUrlInput = document.getElementById('serverUrl');
  const authTokenInput = document.getElementById('authToken');
  const saveSettingsBtn = document.getElementById('saveSettings');
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  
  // モード切り替え用
  const productMode = document.getElementById('productMode');
  const importMode = document.getElementById('importMode');
  const unsupportedMode = document.getElementById('unsupportedMode');
  
  // 商品モード用
  const productImage = document.getElementById('productImage');
  const productName = document.getElementById('productName');
  const productPrice = document.getElementById('productPrice');
  const productSource = document.getElementById('productSource');
  const prioritySelector = document.getElementById('prioritySelector');
  const categorySelect = document.getElementById('categorySelect');
  const addBtn = document.getElementById('addBtn');
  const addBtnText = document.getElementById('addBtnText');
  const addStatus = document.getElementById('addStatus');
  
  // インポートモード用
  const pageInfo = document.getElementById('pageInfo');
  const importBtn = document.getElementById('importBtn');
  const importBtnText = document.getElementById('importBtnText');
  const importStatus = document.getElementById('importStatus');

  let currentProduct = null;
  let selectedPriority = 3;

  // 設定を読み込み
  const settings = await chrome.storage.sync.get(['serverUrl', 'authToken']);
  serverUrlInput.value = settings.serverUrl || 'https://butsuyokuoh.exe.xyz:8000';
  authTokenInput.value = settings.authToken || '';

  // 設定パネルのトグル
  settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('show');
  });

  // 設定を保存
  saveSettingsBtn.addEventListener('click', async () => {
    await chrome.storage.sync.set({ 
      serverUrl: serverUrlInput.value,
      authToken: authTokenInput.value
    });
    showStatus(addStatus, '保存しました', 'success');
  });

  // 現在のタブを取得
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';

  // ページの種類を判定
  const pageType = detectPageType(url);

  if (pageType === 'amazon-product' || pageType === 'rakuten-product') {
    // 商品ページモード
    await initProductMode(tab, pageType);
  } else if (pageType === 'amazon-wishlist' || pageType === 'rakuten-wishlist') {
    // インポートモード
    initImportMode(tab, pageType);
  } else {
    // 非対応ページ
    unsupportedMode.classList.remove('hidden');
  }

  function detectPageType(url) {
    // Amazon 商品ページ
    if (url.match(/amazon\.(co\.jp|com)\/.*\/dp\//) || 
        url.match(/amazon\.(co\.jp|com)\/dp\//) ||
        url.match(/amazon\.(co\.jp|com)\/gp\/product\//)) {
      return 'amazon-product';
    }
    // 楽天 商品ページ
    if (url.includes('item.rakuten.co.jp')) {
      return 'rakuten-product';
    }
    // Amazon ほしいものリスト
    if (url.includes('amazon.co.jp/hz/wishlist') || 
        url.includes('amazon.co.jp/gp/registry/wishlist') || 
        url.includes('amazon.com/hz/wishlist')) {
      return 'amazon-wishlist';
    }
    // 楽天 お気に入り
    if (url.includes('my.bookmark.rakuten.co.jp')) {
      return 'rakuten-wishlist';
    }
    return 'unsupported';
  }

  async function initProductMode(tab, pageType) {
    productMode.classList.remove('hidden');
    
    const siteName = pageType === 'amazon-product' ? 'Amazon' : '楽天';
    
    try {
      // Content scriptから商品情報を取得
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProductInfo' });
      
      if (!response || !response.product) {
        showStatus(addStatus, '商品情報を取得できませんでした', 'error');
        addBtn.disabled = true;
        return;
      }

      currentProduct = response.product;
      
      // プレビュー表示
      productImage.src = currentProduct.imageUrl || '';
      productName.textContent = currentProduct.name;
      productPrice.textContent = currentProduct.price 
        ? `¥${currentProduct.price.toLocaleString()}`
        : '価格不明';
      productSource.textContent = siteName;

      // カテゴリを取得
      await loadCategories();

    } catch (e) {
      console.error('Error:', e);
      showStatus(addStatus, 'ページを再読み込みしてからお試しください', 'error');
      addBtn.disabled = true;
    }
  }

  // 優先度選択
  prioritySelector.addEventListener('click', (e) => {
    if (e.target.classList.contains('priority-btn')) {
      prioritySelector.querySelectorAll('.priority-btn').forEach(btn => {
        btn.classList.remove('selected');
      });
      e.target.classList.add('selected');
      selectedPriority = parseInt(e.target.dataset.value, 10);
    }
  });

  // 追加ボタン
  addBtn.addEventListener('click', async () => {
    const serverUrl = serverUrlInput.value.replace(/\/$/, '');
    const authToken = authTokenInput.value;

    if (!serverUrl || !authToken) {
      settingsPanel.classList.add('show');
      showStatus(addStatus, 'サーバー設定を入力してください', 'error');
      return;
    }

    if (!currentProduct) {
      showStatus(addStatus, '商品情報がありません', 'error');
      return;
    }

    addBtn.disabled = true;
    addBtnText.innerHTML = '<span class="spinner"></span> 追加中...';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(`${serverUrl}/api/extension-add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          token: authToken,
          item: {
            name: currentProduct.name,
            url: currentProduct.url,
            price: currentProduct.price,
            imageUrl: currentProduct.imageUrl,
            priority: selectedPriority,
            categoryId: categorySelect.value || null,
          },
        }),
      });

      const result = await response.json();

      if (response.ok) {
        showStatus(addStatus, '✅ 追加しました！', 'success');
        addBtnText.textContent = '✅ 追加済み';
      } else {
        showStatus(addStatus, result.error || '追加に失敗しました', 'error');
        addBtn.disabled = false;
        addBtnText.textContent = '👑 物欲王に追加';
      }
    } catch (error) {
      console.error('Add error:', error);
      const timedOut = error && (error.name === 'AbortError' || /aborted/i.test(String(error.message || '')));
      showStatus(addStatus, timedOut ? 'タイムアウトしました。もう一度お試しください' : 'エラー: ' + error.message, 'error');
      addBtn.disabled = false;
      addBtnText.textContent = '👑 物欲王に追加';
    } finally {
      clearTimeout(timeoutId);
    }
  });

  async function loadCategories() {
    const serverUrl = serverUrlInput.value.replace(/\/$/, '');
    const authToken = authTokenInput.value;
    
    if (!serverUrl || !authToken) return;

    try {
      const response = await fetch(`${serverUrl}/api/extension-categories`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      
      if (response.ok) {
        const categories = await response.json();
        categories.forEach(cat => {
          const option = document.createElement('option');
          option.value = cat.id;
          option.textContent = cat.name;
          categorySelect.appendChild(option);
        });
      }
    } catch (e) {
      console.error('Failed to load categories:', e);
    }
  }

  function initImportMode(tab, pageType) {
    importMode.classList.remove('hidden');
    
    const siteName = pageType === 'amazon-wishlist' ? 'Amazon ほしいものリスト' : '楽天 お気に入り';
    pageInfo.textContent = `✅ ${siteName}を検出`;
    pageInfo.classList.add('supported');
    importBtn.disabled = false;

    importBtn.addEventListener('click', async () => {
      const serverUrl = serverUrlInput.value.replace(/\/$/, '');
      const authToken = authTokenInput.value;

      if (!serverUrl || !authToken) {
        settingsPanel.classList.add('show');
        showStatus(importStatus, 'サーバー設定を入力してください', 'error');
        return;
      }

      importBtn.disabled = true;
      importBtnText.innerHTML = '<span class="spinner"></span> 取得中...';
      showStatus(importStatus, 'ページからアイテムを取得しています...', 'info');

      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getItems' });

        if (!response || !response.items || response.items.length === 0) {
          showStatus(importStatus, 'アイテムが見つかりませんでした', 'error');
          importBtn.disabled = false;
          importBtnText.textContent = 'インポート';
          return;
        }

        showStatus(importStatus, `${response.items.length}件のアイテムをインポート中...`, 'info');

        const importResponse = await fetch(`${serverUrl}/api/extension-import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: pageType.replace('-wishlist', ''),
            items: response.items,
            token: authToken,
          }),
        });

        const result = await importResponse.json();

        if (importResponse.ok) {
          showStatus(importStatus,
            `インポート完了！ ${result.imported}件追加、${result.skipped}件スキップ`,
            'success'
          );
        } else {
          showStatus(importStatus, result.error || 'インポートに失敗しました', 'error');
        }
      } catch (error) {
        console.error('Import error:', error);
        showStatus(importStatus, 'エラー: ' + error.message, 'error');
      } finally {
        importBtn.disabled = false;
        importBtnText.textContent = 'インポート';
      }
    });
  }

  function showStatus(element, message, type) {
    element.textContent = message;
    element.className = 'status show ' + type;
  }
});
