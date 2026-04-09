(function () {
  const UI_STORAGE_KEY = "minyako-blog-ui-v3";
  const DEFAULT_CATEGORY = "科研学习/初学手册";
  const BLOCK_SELECTOR = "TABLE,THEAD,TBODY,TR,TD,TH,SVG,.mermaid,IMG,FIGURE,.article-mark";
  const DEFAULT_LLM_QUESTION = (selectedText) => `解释“${selectedText}”在本文中的含义。`;

  const state = {
    siteTitle: "Minyako的学习日志",
    categories: [],
    pages: [],
    pageCache: {},
    settings: {
      common: {
        siteTitle: "Minyako的学习日志",
        fontScale: 1,
        defaultSidebarCollapsed: false,
        compactCards: false
      },
      llm: {
        enabled: false,
        endpoint: "",
        apiKey: "",
        model: "",
        temperature: 0.2,
        systemPrompt: ""
      }
    },
    ui: loadUiState(),
    askContext: {
      pageId: "",
      selectedText: "",
      pendingRange: null,
      pendingNoteId: ""
    }
  };

  const sidebar = document.getElementById("sidebar");
  const topbar = document.getElementById("topbar");
  const sidebarBrandTitle = document.getElementById("sidebarBrandTitle");
  const topbarTitle = document.getElementById("topbarTitle");
  const contentArea = document.getElementById("contentArea");
  const homeButton = document.getElementById("homeButton");
  const sidebarToggle = document.getElementById("sidebarToggle");
  const categoryTree = document.getElementById("categoryTree");
  const searchInput = document.getElementById("searchInput");
  const clearSearchButton = document.getElementById("clearSearchButton");

  const importModal = document.getElementById("importModal");
  const categoryModal = document.getElementById("categoryModal");
  const settingsModal = document.getElementById("settingsModal");
  const askModal = document.getElementById("askModal");
  const markdownFileInput = document.getElementById("markdownFileInput");
  const pageTitleInput = document.getElementById("pageTitleInput");
  const pageCategoryInput = document.getElementById("pageCategoryInput");
  const categoryPathInput = document.getElementById("categoryPathInput");

  const selectionToolbar = document.getElementById("selectionToolbar");
  const notePopover = document.getElementById("notePopover");
  const notePopoverTitle = document.getElementById("notePopoverTitle");
  const noteQuote = document.getElementById("noteQuote");
  const noteEditor = document.getElementById("noteEditor");
  const notePreview = document.getElementById("notePreview");

  const askSelectedText = document.getElementById("askSelectedText");
  const askQuestionInput = document.getElementById("askQuestionInput");
  const askAnswerOutput = document.getElementById("askAnswerOutput");
  const submitAskButton = document.getElementById("submitAskButton");

  let activeRange = null;
  let activeNoteContext = null;
  let lastModalFocus = null;
  let lastWindowScrollY = window.scrollY || 0;
  const chromeState = {
    topbarVisible: true,
    topbarHover: false,
    pointerNearTop: false
  };

  marked.setOptions({
    gfm: true,
    breaks: true
  });

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "default"
  });

  bindGlobalEvents();
  bootstrap();

  async function bootstrap() {
    try {
      const response = await fetch("/api/bootstrap", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      state.categories = Array.isArray(data.categories) ? data.categories : [];
      state.pages = Array.isArray(data.pages) ? data.pages : [];
      state.settings = data.settings || state.settings;
      state.siteTitle = data.siteTitle || state.settings.common.siteTitle || state.siteTitle;

      if (state.ui.sidebarCollapsed === null) {
        state.ui.sidebarCollapsed = Boolean(state.settings.common.defaultSidebarCollapsed);
      }

      syncSettingsInputs();
      syncTopbarTitle();
      applyCommonSettings();
      renderApp();
    } catch (error) {
      contentArea.innerHTML = `<div class="loading-card">博客数据加载失败：${escapeHtml(error.message)}</div>`;
    }
  }

  function loadUiState() {
    try {
      const raw = localStorage.getItem(UI_STORAGE_KEY);
      if (raw) {
        return {
          currentView: "home",
          activePageId: "",
          activeCategoryPath: "",
          sidebarCollapsed: null,
          collapsedPaths: {},
          searchQuery: "",
          ...JSON.parse(raw)
        };
      }
    } catch (error) {
      console.error("Failed to load UI state.", error);
    }

    return {
      currentView: "home",
      activePageId: "",
      activeCategoryPath: "",
      sidebarCollapsed: null,
      collapsedPaths: {},
      searchQuery: ""
    };
  }

  function saveUiState() {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(state.ui));
  }

  function bindGlobalEvents() {
    selectionToolbar.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    sidebarToggle.addEventListener("click", () => {
      state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
      saveUiState();
      applyCommonSettings();
      renderSidebar();
    });

    homeButton.addEventListener("click", () => {
      clearSearchState();
      state.ui.currentView = "home";
      state.ui.activeCategoryPath = "";
      saveUiState();
      renderApp();
    });

    searchInput.addEventListener("input", () => {
      state.ui.searchQuery = searchInput.value.trim();
      clearSearchButton.classList.toggle("hidden", !state.ui.searchQuery);
      saveUiState();
      renderApp();
    });

    clearSearchButton.addEventListener("click", () => {
      state.ui.searchQuery = "";
      searchInput.value = "";
      clearSearchButton.classList.add("hidden");
      saveUiState();
      renderApp();
    });

    document.getElementById("openImportModal").addEventListener("click", openImportModal);
    document.getElementById("headerImportButton").addEventListener("click", openImportModal);
    document.getElementById("closeImportModal").addEventListener("click", closeImportModal);
    document.getElementById("cancelImportButton").addEventListener("click", closeImportModal);
    document.getElementById("confirmImportButton").addEventListener("click", importMarkdownFile);

    document.getElementById("openCategoryModal").addEventListener("click", openCategoryModal);
    document.getElementById("headerCategoryButton").addEventListener("click", openCategoryModal);
    document.getElementById("closeCategoryModal").addEventListener("click", closeCategoryModal);
    document.getElementById("cancelCategoryButton").addEventListener("click", closeCategoryModal);
    document.getElementById("confirmCategoryButton").addEventListener("click", createCategory);

    document.getElementById("openSettingsButton").addEventListener("click", openSettingsModal);
    document.getElementById("closeSettingsModal").addEventListener("click", closeSettingsModal);
    document.getElementById("cancelSettingsButton").addEventListener("click", closeSettingsModal);
    document.getElementById("saveSettingsButton").addEventListener("click", saveSettings);
    document.getElementById("settingFontScale").addEventListener("input", syncFontScaleHint);

    document.getElementById("highlightSelection").addEventListener("click", () => applySelectionMark("highlight"));
    document.getElementById("annotateSelection").addEventListener("click", () => applySelectionMark("annotation"));
    document.getElementById("askSelection").addEventListener("click", openAskModalFromSelection);

    document.getElementById("closeNotePopover").addEventListener("click", closeNotePopover);
    document.getElementById("saveNoteButton").addEventListener("click", saveNote);
    document.getElementById("deleteNoteButton").addEventListener("click", deleteNoteMark);
    noteEditor.addEventListener("input", updateNotePreview);

    document.getElementById("closeAskModal").addEventListener("click", closeAskModal);
    document.getElementById("closeAskFooterButton").addEventListener("click", closeAskModal);
    document.getElementById("resetAskQuestionButton").addEventListener("click", resetAskQuestion);
    document.getElementById("submitAskButton").addEventListener("click", submitAskQuestion);

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("resize", () => {
      hideSelectionToolbar();
      closeNotePopover();
    });
    window.addEventListener("scroll", () => {
      hideSelectionToolbar();
    }, true);
    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    document.addEventListener("mousemove", handlePointerMoveNearTop);
    topbar.addEventListener("mouseenter", () => {
      chromeState.topbarHover = true;
      syncTopbarVisibility();
    });
    topbar.addEventListener("mouseleave", () => {
      chromeState.topbarHover = false;
      syncTopbarVisibility();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.isComposing || !isAnyModalOpen()) {
        return;
      }

      hideSelectionToolbar();
      closeNotePopover();
      closeImportModal();
      closeCategoryModal();
      closeSettingsModal();
      closeAskModal();
    });
  }

  function renderApp() {
    hideSelectionToolbar();
    closeNotePopover();
    syncTopbarTitle();
    applyCommonSettings();
    syncTopbarVisibility();
    renderSidebar();

    if (state.ui.searchQuery) {
      renderSearchView(state.ui.searchQuery);
      return;
    }

    if (state.ui.currentView === "page" && state.ui.activePageId) {
      renderPageView(state.ui.activePageId);
      return;
    }

    if (state.ui.currentView === "category" && state.ui.activeCategoryPath) {
      renderCategoryView(state.ui.activeCategoryPath);
      return;
    }

    renderHomeView();
  }

  function syncTopbarTitle() {
    const title = state.settings.common.siteTitle || state.siteTitle;
    sidebarBrandTitle.textContent = title;
    topbarTitle.textContent = title;
    document.title = title;
  }

  function applyCommonSettings() {
    document.documentElement.style.setProperty("--article-scale", String(state.settings.common.fontScale || 1));
    document.body.classList.toggle("compact-cards", Boolean(state.settings.common.compactCards));
    if (typeof state.ui.sidebarCollapsed !== "boolean") {
      state.ui.sidebarCollapsed = Boolean(state.settings.common.defaultSidebarCollapsed);
    }
    document.body.classList.toggle("sidebar-collapsed", Boolean(state.ui.sidebarCollapsed));
    sidebar.classList.toggle("collapsed", Boolean(state.ui.sidebarCollapsed));
    searchInput.value = state.ui.searchQuery || "";
    clearSearchButton.classList.toggle("hidden", !state.ui.searchQuery);
  }

  function clearSearchState() {
    state.ui.searchQuery = "";
    searchInput.value = "";
    clearSearchButton.classList.add("hidden");
  }

  function syncSettingsInputs() {
    document.getElementById("settingSiteTitle").value = state.settings.common.siteTitle || "";
    document.getElementById("settingFontScale").value = String(state.settings.common.fontScale || 1);
    document.getElementById("settingSidebarCollapsed").checked = Boolean(state.settings.common.defaultSidebarCollapsed);
    document.getElementById("settingCompactCards").checked = Boolean(state.settings.common.compactCards);

    document.getElementById("settingLlmEnabled").checked = Boolean(state.settings.llm.enabled);
    document.getElementById("settingLlmEndpoint").value = state.settings.llm.endpoint || "";
    document.getElementById("settingLlmApiKey").value = state.settings.llm.apiKey || "";
    document.getElementById("settingLlmModel").value = state.settings.llm.model || "";
    document.getElementById("settingLlmTemperature").value = String(state.settings.llm.temperature ?? 0.2);
    document.getElementById("settingLlmSystemPrompt").value = state.settings.llm.systemPrompt || "";
    syncFontScaleHint();
  }

  function syncFontScaleHint() {
    const value = Number(document.getElementById("settingFontScale").value || 1).toFixed(2);
    document.getElementById("settingFontScaleValue").textContent = `当前倍率：${value}x`;
  }

  function renderSidebar() {
    homeButton.classList.toggle("active", state.ui.currentView === "home" && !state.ui.searchQuery);
    const tree = buildCategoryTree();
    categoryTree.innerHTML = tree.length
      ? buildTreeHtml(tree)
      : '<p class="panel-tip">还没有分类，可以先新建一个。</p>';
    bindTreeEvents();
  }

  function buildCategoryTree() {
    const root = { name: "root", path: "", children: [] };
    const allPaths = uniqueList([
      ...state.categories,
      ...state.pages.map((page) => page.categoryPath)
    ]);

    allPaths.forEach((path) => {
      const parts = normalizeCategoryPath(path).split("/");
      let current = root;
      let currentPath = "";

      parts.forEach((part) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        let child = current.children.find((item) => item.name === part);
        if (!child) {
          child = { name: part, path: currentPath, children: [] };
          current.children.push(child);
        }
        current = child;
      });
    });

    sortTree(root.children);
    return root.children;
  }

  function sortTree(children) {
    children.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    children.forEach((child) => sortTree(child.children));
  }

  function buildTreeHtml(nodes) {
    if (!nodes.length) {
      return "";
    }

    return `<div class="tree-list">${nodes.map((node) => {
      const nodePages = getPagesByExactCategory(node.path);
      const hasChildren = node.children.length > 0;
      const isCollapsed = Boolean(state.ui.collapsedPaths[node.path]);
      const isActiveCategory = state.ui.currentView === "category" && state.ui.activeCategoryPath === node.path;
      const pageItems = nodePages.map((page) => `
        <button class="page-link ${state.ui.currentView === "page" && state.ui.activePageId === page.id ? "active" : ""}" data-page-id="${page.id}" type="button">
          ${escapeHtml(page.title)}
        </button>
      `).join("");

      return `
        <div class="tree-node">
          <div class="tree-node-head">
            <button class="tree-toggle" data-toggle-path="${escapeAttr(node.path)}" type="button">${hasChildren || nodePages.length ? (isCollapsed ? "+" : "−") : "·"}</button>
            <button class="tree-link ${isActiveCategory ? "active" : ""}" data-category-path="${escapeAttr(node.path)}" type="button">
              ${escapeHtml(node.name)}
            </button>
          </div>
          <div class="tree-children ${isCollapsed ? "hidden" : ""}">
            ${buildTreeHtml(node.children)}
            ${pageItems}
          </div>
        </div>
      `;
    }).join("")}</div>`;
  }

  function bindTreeEvents() {
    categoryTree.querySelectorAll("[data-category-path]").forEach((button) => {
      button.addEventListener("click", () => {
        clearSearchState();
        state.ui.currentView = "category";
        state.ui.activeCategoryPath = button.getAttribute("data-category-path");
        saveUiState();
        renderApp();
      });
    });

    categoryTree.querySelectorAll("[data-toggle-path]").forEach((button) => {
      button.addEventListener("click", () => {
        const path = button.getAttribute("data-toggle-path");
        if (!path) {
          return;
        }
        state.ui.collapsedPaths[path] = !state.ui.collapsedPaths[path];
        saveUiState();
        renderSidebar();
      });
    });

    categoryTree.querySelectorAll("[data-page-id]").forEach((button) => {
      button.addEventListener("click", () => {
        openPage(button.getAttribute("data-page-id"));
      });
    });
  }

  function renderHomeView() {
    const topCategories = getTopCategoryStats();
    const recentPages = [...state.pages]
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 6);

    contentArea.innerHTML = `
      <div class="dashboard-grid">
        <article class="card hero-card">
          <div class="eyebrow">学习工作台</div>
          <h2>把 Markdown、PDF、重点标注与 AI 解释放进同一个学习空间</h2>
          <p class="muted">
            这里可以导入文档、全文搜索、选词高亮、写批注、查看标注汇总，并直接让 AI 结合当前文章解释术语或概念。
          </p>
          <div class="hero-actions">
            <button class="primary-btn" id="heroImportButton" type="button">导入文档</button>
            <button class="ghost-btn" id="heroSettingsButton" type="button">打开设置</button>
          </div>
        </article>

        <section class="card stats-card">
          <h3>当前概况</h3>
          <div class="stats-list">
            <span class="stat-chip">文档 ${state.pages.length}</span>
            <span class="stat-chip">分类 ${countAllCategoryNodes()}</span>
            <span class="stat-chip">支持 Markdown / PDF</span>
          </div>
          <p class="muted">
            每篇文档都带有独立正文、批注、资源和渲染缓存，适合长期积累课程资料、科研笔记和题解整理。
          </p>
        </section>

        ${topCategories.map((item) => `
          <section class="card category-card">
            <h3>${escapeHtml(item.name)}</h3>
            <div class="category-meta">
              <span class="category-chip">文档 ${item.count}</span>
              <span class="category-chip">路径 ${escapeHtml(item.path)}</span>
            </div>
            <p class="muted">${escapeHtml(item.description)}</p>
            <button class="ghost-btn" type="button" data-home-category="${escapeAttr(item.path)}">查看分类</button>
          </section>
        `).join("")}

        ${recentPages.map((page) => `
          <article class="card article-card">
            <h3>${escapeHtml(page.title)}</h3>
            <div class="article-meta">
              ${renderSourceChip(page)}
              <span class="article-chip">${escapeHtml(page.categoryPath)}</span>
              <span class="article-chip">更新于 ${formatDate(page.updatedAt)}</span>
            </div>
            <p class="muted">${escapeHtml(page.summary)}</p>
            <button class="primary-btn" type="button" data-open-page="${page.id}">打开文档</button>
          </article>
        `).join("")}
      </div>
    `;

    document.getElementById("heroImportButton").addEventListener("click", openImportModal);
    document.getElementById("heroSettingsButton").addEventListener("click", openSettingsModal);
    contentArea.querySelectorAll("[data-home-category]").forEach((button) => {
      button.addEventListener("click", () => {
        state.ui.currentView = "category";
        state.ui.activeCategoryPath = button.getAttribute("data-home-category");
        saveUiState();
        renderApp();
      });
    });
    contentArea.querySelectorAll("[data-open-page]").forEach((button) => {
      button.addEventListener("click", () => openPage(button.getAttribute("data-open-page")));
    });
  }

  function renderCategoryView(categoryPath) {
    const pages = getPagesUnderCategory(categoryPath);
    contentArea.innerHTML = `
      <section class="article-shell">
        <div class="article-head">
          <div class="article-title-wrap">
            <div class="breadcrumbs">
              ${categoryPath.split("/").map((part) => `<span class="crumb">${escapeHtml(part)}</span>`).join("")}
            </div>
            <h2>${escapeHtml(categoryPath)}</h2>
            <p class="article-summary">这一分类下共有 ${pages.length} 份文档。每份文档都支持全文搜索、重点标注、批注记录与 AI 解释。</p>
          </div>
          <div class="article-tools">
            <button class="ghost-btn" id="categoryImportButton" type="button">导入到此分类</button>
            <button class="primary-btn" id="backHomeButton" type="button">回到首页</button>
          </div>
        </div>
        <div class="dashboard-grid">
          ${pages.length ? pages.map((page) => `
            <article class="card article-card">
              <h3>${escapeHtml(page.title)}</h3>
              <div class="article-meta">
                ${renderSourceChip(page)}
                <span class="article-chip">${escapeHtml(page.categoryPath)}</span>
                <span class="article-chip">更新于 ${formatDate(page.updatedAt)}</span>
              </div>
              <p class="muted">${escapeHtml(page.summary)}</p>
              <button class="primary-btn" type="button" data-open-page="${page.id}">打开文档</button>
            </article>
          `).join("") : `
            <div class="card empty-card">
              <h3>这个分类还没有文档</h3>
              <p class="muted">可以先导入 Markdown 或 PDF，把资料放进这个分类。</p>
            </div>
          `}
        </div>
      </section>
    `;

    document.getElementById("categoryImportButton").addEventListener("click", () => {
      pageCategoryInput.value = categoryPath;
      openImportModal();
    });
    document.getElementById("backHomeButton").addEventListener("click", () => {
      clearSearchState();
      state.ui.currentView = "home";
      state.ui.activeCategoryPath = "";
      saveUiState();
      renderApp();
    });
    contentArea.querySelectorAll("[data-open-page]").forEach((button) => {
      button.addEventListener("click", () => openPage(button.getAttribute("data-open-page")));
    });
  }

  function renderSearchView(query) {
    const q = query.trim().toLowerCase();
    const results = state.pages.filter((page) => {
      const haystack = [
        page.title,
        page.summary,
        page.categoryPath,
        page.searchText || ""
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });

    contentArea.innerHTML = `
      <section class="article-shell">
        <div class="article-head">
          <div class="article-title-wrap">
            <div class="eyebrow">搜索结果</div>
            <h2>“${escapeHtml(query)}”</h2>
            <p class="article-summary">共找到 ${results.length} 份相关文档。搜索范围包括标题、摘要、分类路径和正文全文。</p>
          </div>
        </div>
        <div class="dashboard-grid">
          ${results.length ? results.map((page) => `
            <article class="card article-card">
              <h3>${escapeHtml(page.title)}</h3>
              <div class="article-meta">
                ${renderSourceChip(page)}
                <span class="article-chip">${escapeHtml(page.categoryPath)}</span>
                <span class="article-chip">更新于 ${formatDate(page.updatedAt)}</span>
              </div>
              <p class="muted">${escapeHtml(page.summary)}</p>
              <button class="primary-btn" type="button" data-open-page="${page.id}">打开文档</button>
            </article>
          `).join("") : `
            <div class="card empty-card">
              <h3>没有匹配结果</h3>
              <p class="muted">可以尝试缩短关键词，或者换一种表述方式搜索。</p>
            </div>
          `}
        </div>
      </section>
    `;

    contentArea.querySelectorAll("[data-open-page]").forEach((button) => {
      button.addEventListener("click", () => openPage(button.getAttribute("data-open-page")));
    });
  }

  async function renderPageView(pageId) {
    contentArea.innerHTML = `<div class="loading-card">正在加载页面内容...</div>`;

    try {
      const detail = await fetchPageDetail(pageId);
      if (!detail) {
        throw new Error("页面不存在。");
      }

      const page = detail.meta;
      contentArea.innerHTML = `
        <article class="article-shell">
          <div class="article-head">
            <div class="article-title-wrap">
              <div class="breadcrumbs">
                ${page.categoryPath.split("/").map((part) => `<span class="crumb">${escapeHtml(part)}</span>`).join("")}
              </div>
              <h2>${escapeHtml(page.title)}</h2>
              <p class="article-summary">${escapeHtml(page.summary)}</p>
            </div>
            <div class="article-tools">
              ${renderSourceChip(page)}
              <span class="tag">最后更新 ${formatDate(page.updatedAt)}</span>
              <button class="ghost-btn" id="pageBackButton" type="button">返回分类</button>
            </div>
          </div>
          <div class="article-hint">
            在正文中选中内容后，可以直接高亮、添加批注，或让 AI 结合本文上下文解释它的含义。页末会同步汇总本页所有标注，方便回看重点。
          </div>
          <div class="article-body" id="articleBody"></div>
          <section class="annotation-board">
            <div class="annotation-board-head">
              <div>
                <h3>文档标注汇总</h3>
                <p>集中查看本页的人工批注与 AI 批注，并快速定位回正文。</p>
              </div>
              <div class="stats-list" id="annotationSummaryStats"></div>
            </div>
            <div id="annotationSummary" class="annotation-summary-list"></div>
          </section>
        </article>
      `;

      document.getElementById("pageBackButton").addEventListener("click", () => {
        state.ui.currentView = "category";
        state.ui.activeCategoryPath = page.categoryPath;
        saveUiState();
        renderApp();
      });

      const articleBody = document.getElementById("articleBody");
      if (detail.renderedHtml) {
        articleBody.innerHTML = detail.renderedHtml;
      } else {
        articleBody.innerHTML = marked.parse(detail.markdown || "");
        await renderMermaidInside(articleBody);
      }

      articleBody.querySelectorAll(".article-highlight").forEach(bindHighlightElement);
      articleBody.querySelectorAll(".article-annotation").forEach(bindAnnotationElement);
      renderAnnotationSummary(detail);

      articleBody.addEventListener("mouseup", () => {
        window.setTimeout(handleSelectionChange, 0);
      });
      articleBody.addEventListener("keyup", () => {
        window.setTimeout(handleSelectionChange, 0);
      });
    } catch (error) {
      contentArea.innerHTML = `<div class="loading-card">页面加载失败：${escapeHtml(error.message)}</div>`;
    }
  }

  async function renderMermaidInside(container) {
    const blocks = container.querySelectorAll("pre > code.language-mermaid");
    blocks.forEach((block, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "mermaid";
      wrapper.id = `mermaid-${Date.now()}-${index}`;
      wrapper.textContent = block.textContent;
      block.parentElement.replaceWith(wrapper);
    });

    const nodes = Array.from(container.querySelectorAll(".mermaid"));
    if (nodes.length) {
      await mermaid.run({ nodes });
    }
  }

  async function fetchPageDetail(pageId) {
    if (state.pageCache[pageId]) {
      return state.pageCache[pageId];
    }

    const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const detail = await response.json();
    state.pageCache[pageId] = detail;
    mergePageMeta(detail.meta);
    return detail;
  }

  function openPage(pageId) {
    state.ui.currentView = "page";
    state.ui.activePageId = pageId;
    state.ui.activeCategoryPath = "";
    state.ui.searchQuery = "";
    saveUiState();
    renderApp();
  }

  function openImportModal() {
    openModal(importModal, markdownFileInput);
    markdownFileInput.value = "";
    pageTitleInput.value = "";
    if (!pageCategoryInput.value) {
      pageCategoryInput.value = DEFAULT_CATEGORY;
    }
  }

  function closeImportModal() {
    closeModal(importModal);
  }

  function openCategoryModal() {
    openModal(categoryModal, categoryPathInput);
    categoryPathInput.value = "";
  }

  function closeCategoryModal() {
    closeModal(categoryModal);
  }

  function openSettingsModal() {
    syncSettingsInputs();
    openModal(settingsModal, document.getElementById("settingSiteTitle"));
  }

  function closeSettingsModal() {
    closeModal(settingsModal);
  }

  function openAskModal(selectedText, pageId) {
    state.askContext.pageId = pageId;
    state.askContext.selectedText = selectedText;
    askSelectedText.textContent = selectedText;
    askQuestionInput.value = DEFAULT_LLM_QUESTION(selectedText);
    updateAskUi(false);
    openModal(askModal, askQuestionInput);
  }

  function closeAskModal() {
    closeModal(askModal);
    state.askContext.pageId = "";
    state.askContext.selectedText = "";
    state.askContext.pendingRange = null;
    state.askContext.pendingNoteId = "";
    updateAskUi(false);
  }

  function resetAskQuestion() {
    if (!state.askContext.selectedText) {
      return;
    }
    askQuestionInput.value = DEFAULT_LLM_QUESTION(state.askContext.selectedText);
  }

  async function importMarkdownFile() {
    const file = markdownFileInput.files[0];
    if (!file) {
      window.alert("请先选择一个 Markdown 或 PDF 文件。");
      return;
    }

    try {
      const extension = (file.name.split(".").pop() || "").toLowerCase();
      let response;
      if (extension === "pdf" || file.type === "application/pdf") {
        response = await uploadPdfFile(file);
      } else {
        response = await uploadMarkdownFile(file);
      }
      const data = await response.json();

      if (!response.ok) {
        window.alert(data.error || "导入失败。");
        return;
      }

      mergePageMeta(data.page);
      if (!state.categories.includes(data.page.categoryPath)) {
        state.categories.push(data.page.categoryPath);
      }
      closeImportModal();
      openPage(data.page.id);
    } catch (error) {
      window.alert(`导入失败：${error.message}`);
    }
  }

  async function createCategory() {
    const rawPath = categoryPathInput.value.trim();
    if (!rawPath) {
      window.alert("请输入分类路径。");
      return;
    }

    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ categoryPath: rawPath })
      });
      const data = await response.json();

      if (!response.ok) {
        window.alert(data.error || "创建分类失败。");
        return;
      }

      if (!state.categories.includes(data.categoryPath)) {
        state.categories.push(data.categoryPath);
      }
      closeCategoryModal();
      renderSidebar();
    } catch (error) {
      window.alert(`创建分类失败：${error.message}`);
    }
  }

  async function saveSettings() {
    const payload = {
      common: {
        siteTitle: document.getElementById("settingSiteTitle").value.trim() || "Minyako的学习日志",
        fontScale: Number(document.getElementById("settingFontScale").value || 1),
        defaultSidebarCollapsed: document.getElementById("settingSidebarCollapsed").checked,
        compactCards: document.getElementById("settingCompactCards").checked
      },
      llm: {
        enabled: document.getElementById("settingLlmEnabled").checked,
        endpoint: document.getElementById("settingLlmEndpoint").value.trim(),
        apiKey: document.getElementById("settingLlmApiKey").value.trim(),
        model: document.getElementById("settingLlmModel").value.trim(),
        temperature: Number(document.getElementById("settingLlmTemperature").value || 0.2),
        systemPrompt: document.getElementById("settingLlmSystemPrompt").value.trim()
      }
    };

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      if (!response.ok) {
        window.alert(data.error || "保存设置失败。");
        return;
      }

      state.settings = data.settings;
      state.siteTitle = state.settings.common.siteTitle;
      syncSettingsInputs();
      applyCommonSettings();
      syncTopbarTitle();
      saveUiState();
      closeSettingsModal();
      renderApp();
    } catch (error) {
      window.alert(`保存设置失败：${error.message}`);
    }
  }

  function handleSelectionChange() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      hideSelectionToolbar();
      return;
    }

    const articleBody = document.getElementById("articleBody");
    if (!articleBody) {
      hideSelectionToolbar();
      return;
    }

    const range = selection.getRangeAt(0);
    if (selection.isCollapsed || !articleBody.contains(range.commonAncestorContainer)) {
      hideSelectionToolbar();
      return;
    }

    if (!isRangeAnnotatable(range)) {
      if (rangeTouchesBlockedElement(range)) {
        selection.removeAllRanges();
      }
      hideSelectionToolbar();
      return;
    }

    activeRange = range.cloneRange();
    const rect = range.getBoundingClientRect();
    selectionToolbar.classList.remove("hidden");
    const toolbarRect = selectionToolbar.getBoundingClientRect();
    const toolbarTop = Math.max(12, rect.top - toolbarRect.height - 10);
    const toolbarLeft = clamp(rect.left, 12, Math.max(12, window.innerWidth - toolbarRect.width - 12));
    selectionToolbar.style.top = `${toolbarTop}px`;
    selectionToolbar.style.left = `${toolbarLeft}px`;
  }

  function isRangeAnnotatable(range) {
    if (!range || range.collapsed) {
      return false;
    }
    if (rangeTouchesBlockedElement(range)) {
      return false;
    }

    const startElement = getContainerElement(range.startContainer);
    const endElement = getContainerElement(range.endContainer);
    const startBlock = getClosestBlockElement(startElement);
    const endBlock = getClosestBlockElement(endElement);
    if (startBlock !== endBlock) {
      return false;
    }

    return range.toString().trim().length > 0;
  }

  function rangeTouchesBlockedElement(range) {
    const articleBody = document.getElementById("articleBody");
    const startElement = getContainerElement(range.startContainer);
    const endElement = getContainerElement(range.endContainer);
    if (!articleBody || !startElement || !endElement) {
      return true;
    }

    if (
      startElement.closest(BLOCK_SELECTOR) ||
      endElement.closest(BLOCK_SELECTOR)
    ) {
      return true;
    }

    return Array.from(articleBody.querySelectorAll(BLOCK_SELECTOR)).some((node) => {
      try {
        return range.intersectsNode(node);
      } catch (error) {
        return false;
      }
    });
  }

  async function applySelectionMark(type) {
    if (!activeRange) {
      return;
    }

    const articleBody = document.getElementById("articleBody");
    if (!articleBody || !articleBody.contains(activeRange.commonAncestorContainer)) {
      hideSelectionToolbar();
      return;
    }

    if (type === "annotation") {
      const mark = await createAnnotationMark(activeRange.cloneRange(), {
        noteText: "",
        source: "manual",
        variant: "manual"
      });
      if (mark && mark.dataset.noteId) {
        openNoteEditor(mark, mark.dataset.noteId);
      }
    } else {
      await createHighlightMark(activeRange.cloneRange());
    }

    hideSelectionToolbar();
    activeRange = null;
  }

  function openAskModalFromSelection() {
    if (!activeRange || !state.ui.activePageId) {
      return;
    }

    const rangeForAsk = activeRange.cloneRange();
    const selectedText = rangeForAsk.toString().trim();
    if (!selectedText) {
      return;
    }

    const selection = window.getSelection();
    selection.removeAllRanges();
    hideSelectionToolbar();
    state.askContext.pendingRange = rangeForAsk;
    state.askContext.pendingNoteId = "";
    openAskModal(selectedText, state.ui.activePageId);
  }

  async function submitAskQuestion() {
    if (!state.askContext.pageId || !state.askContext.selectedText) {
      return;
    }

    if (!isLlmReady()) {
      updateAskUi(false);
      return;
    }

    updateAskUi(true);
    let pendingNoteId = state.askContext.pendingNoteId;
    if (!pendingNoteId) {
      const llmMark = await createLlmAnnotation("LLM 正在生成解释...");
      if (llmMark && llmMark.dataset.noteId) {
        pendingNoteId = llmMark.dataset.noteId;
        state.askContext.pendingNoteId = pendingNoteId;
      }
    }

    const payload = {
      pageId: state.askContext.pageId,
      selectedText: state.askContext.selectedText,
      question: askQuestionInput.value.trim() || DEFAULT_LLM_QUESTION(state.askContext.selectedText)
    };

    try {
      const response = await fetch("/api/llm-explain", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "LLM 请求失败。");
      }
      const answer = data.answer || "LLM 没有返回内容。";
      const updated = await updateAnnotationNoteText(pendingNoteId, answer);
      if (updated) {
        askAnswerOutput.textContent = `${answer}\n\n已将这段解释写入正文中的紫色批注。`;
      } else {
        askAnswerOutput.textContent = `${answer}\n\n解释已返回，但未能写回正文批注。你可以重新选中原文再试一次。`;
      }
    } catch (error) {
      const errorMessage = `请求失败：${error.message}`;
      await updateAnnotationNoteText(pendingNoteId, errorMessage);
      askAnswerOutput.textContent = errorMessage;
    } finally {
      updateAskSubmitButton(false);
    }
  }

  function bindAnnotationElement(element) {
    element.title = element.dataset.annotationVariant === "llm" ? "点击查看 LLM 批注" : "点击查看或编辑批注";
    element.addEventListener("click", (event) => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim()) {
        return;
      }
      event.stopPropagation();
      const noteId = element.dataset.noteId;
      if (!noteId) {
        return;
      }
      openNoteEditor(element, noteId);
    });
  }

  function bindHighlightElement(element) {
    element.title = "点击取消高亮";
    element.addEventListener("click", async (event) => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim()) {
        return;
      }
      event.stopPropagation();
      unwrapElement(element);
      await persistCurrentPageFromDom();
    });
  }

  function openNoteEditor(element, noteId) {
    const detail = state.pageCache[state.ui.activePageId];
    if (!detail || !detail.notes[noteId]) {
      return;
    }

    activeNoteContext = {
      noteId,
      pageId: state.ui.activePageId,
      element
    };

    notePopoverTitle.textContent = detail.notes[noteId].source === "llm" ? "LLM 批注" : "批注编辑";
    noteQuote.textContent = detail.notes[noteId].quote || element.textContent.trim();
    noteEditor.value = detail.notes[noteId].text || "";
    updateNotePreview();

    notePopover.classList.remove("hidden");
    const rect = element.getBoundingClientRect();
    const width = notePopover.offsetWidth || 360;
    const height = notePopover.offsetHeight || 280;
    const left = clamp(rect.left, 16, Math.max(16, window.innerWidth - width - 16));
    const placeAbove = rect.bottom + 12 + height > window.innerHeight - 16 && rect.top - 12 - height >= 16;
    const top = placeAbove ? rect.top - height - 12 : Math.min(rect.bottom + 12, window.innerHeight - height - 16);
    notePopover.style.left = `${left}px`;
    notePopover.style.top = `${Math.max(16, top)}px`;
  }

  async function saveNote() {
    if (!activeNoteContext) {
      return;
    }

    const detail = state.pageCache[activeNoteContext.pageId];
    const note = detail && detail.notes[activeNoteContext.noteId];
    if (!note) {
      return;
    }

    note.text = noteEditor.value.trim();
    note.updatedAt = new Date().toISOString();
    await persistCurrentPageFromDom();
    renderAnnotationSummary(detail);
    closeNotePopover();
  }

  async function deleteNoteMark() {
    if (!activeNoteContext) {
      return;
    }

    const detail = state.pageCache[activeNoteContext.pageId];
    if (!detail) {
      return;
    }

    delete detail.notes[activeNoteContext.noteId];
    unwrapElement(activeNoteContext.element);
    await persistCurrentPageFromDom();
    renderAnnotationSummary(detail);
    closeNotePopover();
  }

  function closeNotePopover() {
    notePopover.classList.add("hidden");
    activeNoteContext = null;
  }

  function hideSelectionToolbar() {
    selectionToolbar.classList.add("hidden");
    activeRange = null;
  }

  async function persistCurrentPageFromDom() {
    const articleBody = document.getElementById("articleBody");
    const detail = state.pageCache[state.ui.activePageId];
    if (!articleBody || !detail) {
      return;
    }

    detail.renderedHtml = articleBody.innerHTML;
    let response;
    try {
      response = await fetch(`/api/pages/${encodeURIComponent(state.ui.activePageId)}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          renderedHtml: detail.renderedHtml,
          notes: detail.notes
        })
      });
    } catch (error) {
      console.error("Failed to persist page state.", error);
      return;
    }

    if (!response.ok) {
      console.error("Failed to persist page state.", response.status);
      return;
    }

    const data = await response.json();
    if (data.page) {
      detail.meta = data.page;
      mergePageMeta(data.page);
    }
  }

  function handleDocumentClick(event) {
    const target = event.target;

    if (!selectionToolbar.contains(target)) {
      hideSelectionToolbar();
    }
    if (!notePopover.contains(target) && !target.closest(".article-annotation")) {
      closeNotePopover();
    }
  }

  function mergePageMeta(meta) {
    const index = state.pages.findIndex((item) => item.id === meta.id);
    if (index >= 0) {
      state.pages[index] = { ...state.pages[index], ...meta };
    } else {
      state.pages.unshift(meta);
    }
  }

  function getPagesByExactCategory(categoryPath) {
    return state.pages
      .filter((page) => page.categoryPath === categoryPath)
      .sort((a, b) => (a.order || 999) - (b.order || 999));
  }

  function getPagesUnderCategory(categoryPath) {
    return state.pages
      .filter((page) => page.categoryPath === categoryPath || page.categoryPath.startsWith(`${categoryPath}/`))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function getTopCategoryStats() {
    const top = uniqueList(state.categories.map((path) => normalizeCategoryPath(path).split("/")[0]));
    return top.map((name) => {
      const path = name;
      const count = getPagesUnderCategory(path).length;
      let description = "这个分类还没有文档，适合继续向下扩展。";
      if (path === "科研学习") {
        description = "适合归档教程、框架速查、实验记录与研究方向笔记。";
      } else if (path === "oi学习") {
        description = "适合整理算法题、模板、错题和比赛复盘。";
      } else if (path === "课内学习") {
        description = "适合收纳课程笔记、作业整理、期末复习清单。";
      }
      return { name, path, count, description };
    });
  }

  function countAllCategoryNodes() {
    const paths = new Set();
    state.categories.forEach((path) => {
      const parts = normalizeCategoryParts(path);
      let current = "";
      parts.forEach((part) => {
        current = current ? `${current}/${part}` : part;
        paths.add(current);
      });
    });
    return paths.size;
  }

  function normalizeCategoryParts(path) {
    return String(path)
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function normalizeCategoryPath(path) {
    return normalizeCategoryParts(path).join("/") || DEFAULT_CATEGORY;
  }

  function uniqueList(items) {
    return [...new Set(items.map((item) => normalizeCategoryPath(item)))];
  }

  function formatDate(value) {
    const date = new Date(value);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function makeId(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(text) {
    return escapeHtml(text);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function renderSourceChip(page) {
    const sourceType = (page.sourceType || "markdown").toLowerCase();
    const label = sourceType === "pdf" ? "PDF" : "Markdown";
    return `<span class="article-chip">${label}</span>`;
  }

  function handleWindowScroll() {
    const currentY = window.scrollY || 0;
    const scrollingUp = currentY < lastWindowScrollY - 4;
    const scrollingDown = currentY > lastWindowScrollY + 6;
    const nearTop = currentY <= 48;

    if (nearTop || scrollingUp) {
      chromeState.topbarVisible = true;
    } else if (scrollingDown) {
      chromeState.topbarVisible = false;
    }

    lastWindowScrollY = currentY;
    syncTopbarVisibility();
  }

  function handlePointerMoveNearTop(event) {
    const nextNearTop = event.clientY <= 84;
    if (nextNearTop === chromeState.pointerNearTop) {
      return;
    }
    chromeState.pointerNearTop = nextNearTop;
    syncTopbarVisibility();
  }

  function syncTopbarVisibility() {
    const shouldShow =
      chromeState.topbarVisible ||
      chromeState.topbarHover ||
      chromeState.pointerNearTop ||
      (window.scrollY || 0) <= 48;
    topbar.classList.toggle("topbar-hidden", !shouldShow);
  }

  function isAnyModalOpen() {
    return [importModal, categoryModal, settingsModal, askModal].some((modal) => !modal.classList.contains("hidden"));
  }

  function rememberModalFocus() {
    lastModalFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function restoreModalFocus() {
    if (lastModalFocus && typeof lastModalFocus.focus === "function") {
      lastModalFocus.focus();
    }
    lastModalFocus = null;
  }

  function syncBodyModalState() {
    document.body.classList.toggle("modal-open", isAnyModalOpen());
  }

  function openModal(modal, focusTarget) {
    rememberModalFocus();
    modal.classList.remove("hidden");
    syncBodyModalState();
    if (focusTarget && typeof focusTarget.focus === "function") {
      window.setTimeout(() => {
        focusTarget.focus();
        if (
          typeof focusTarget.select === "function" &&
          focusTarget.tagName === "INPUT" &&
          ["text", "search", "password", "email", "url", "tel"].includes((focusTarget.type || "").toLowerCase())
        ) {
          focusTarget.select();
        }
      }, 0);
    }
  }

  function closeModal(modal) {
    const wasOpen = !modal.classList.contains("hidden");
    modal.classList.add("hidden");
    syncBodyModalState();
    if (wasOpen && !isAnyModalOpen()) {
      restoreModalFocus();
    }
  }

  function isLlmReady() {
    const llm = state.settings.llm || {};
    return Boolean(llm.enabled && llm.endpoint && llm.model && llm.apiKey);
  }

  function updateAskSubmitButton(loading) {
    const ready = isLlmReady();
    submitAskButton.disabled = loading || !ready;
    if (loading) {
      submitAskButton.textContent = "请求中...";
      return;
    }
    submitAskButton.textContent = "发送请求";
  }

  function updateAskUi(loading) {
    updateAskSubmitButton(loading);
    if (loading) {
      askAnswerOutput.textContent = "正在请求 LLM，请稍候...";
      return;
    }

    if (isLlmReady()) {
      askAnswerOutput.textContent = "提交问题后，LLM 会结合当前文章上下文来解释这个词或短语。";
    } else {
      askAnswerOutput.textContent = "LLM 尚未配置完成。请先在右上角“设置”里填写 endpoint、API Key 和 model，并启用 LLM 功能。";
    }
  }

  function getContainerElement(node) {
    return node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  }

  async function uploadMarkdownFile(file) {
    const markdown = await file.text();
    return fetch("/api/upload-markdown", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        title: pageTitleInput.value.trim(),
        categoryPath: normalizeCategoryPath(pageCategoryInput.value || DEFAULT_CATEGORY),
        markdown,
        fileName: file.name
      })
    });
  }

  async function uploadPdfFile(file) {
    const buffer = await file.arrayBuffer();
    return fetch("/api/upload-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        title: pageTitleInput.value.trim(),
        categoryPath: normalizeCategoryPath(pageCategoryInput.value || DEFAULT_CATEGORY),
        fileName: file.name,
        pdfBase64: arrayBufferToBase64(buffer)
      })
    });
  }

  function arrayBufferToBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000;
    let binary = "";
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  function renderAnnotationSummary(detail) {
    const summary = document.getElementById("annotationSummary");
    const stats = document.getElementById("annotationSummaryStats");
    if (!summary || !stats || !detail) {
      return;
    }

    const entries = getOrderedNoteEntries(detail);
    const manualCount = entries.filter((entry) => entry.note.source !== "llm").length;
    const llmCount = entries.filter((entry) => entry.note.source === "llm").length;
    stats.innerHTML = `
      <span class="stat-chip">标注 ${entries.length}</span>
      <span class="stat-chip">人工 ${manualCount}</span>
      <span class="stat-chip">AI ${llmCount}</span>
    `;

    if (!entries.length) {
      summary.innerHTML = `
        <div class="annotation-summary-empty">
          <h4>还没有标注</h4>
          <p>选中正文中的词、句或代码片段后，可以高亮、写批注，或让 AI 直接解释。</p>
        </div>
      `;
      return;
    }

    summary.innerHTML = entries.map((entry, index) => `
      <article class="annotation-summary-item ${entry.note.source === "llm" ? "llm" : ""}">
        <div class="annotation-summary-meta">
          <span class="tag">${entry.note.source === "llm" ? "AI 批注" : "人工批注"}</span>
          <span class="tag">序号 ${index + 1}</span>
          <span class="tag">${formatDate(entry.note.updatedAt)}</span>
        </div>
        <h4>${escapeHtml(entry.note.quote || "未命名标注")}</h4>
        <div class="annotation-summary-content">${marked.parse(entry.note.text || "暂无批注内容。")}</div>
        <div class="annotation-summary-actions">
          <button class="ghost-btn small" type="button" data-note-jump="${entry.note.id}">定位到正文</button>
          <button class="primary-btn small" type="button" data-note-open="${entry.note.id}">打开批注</button>
        </div>
      </article>
    `).join("");

    summary.querySelectorAll("[data-note-jump]").forEach((button) => {
      button.addEventListener("click", () => jumpToNote(button.getAttribute("data-note-jump")));
    });
    summary.querySelectorAll("[data-note-open]").forEach((button) => {
      button.addEventListener("click", () => openNoteFromSummary(button.getAttribute("data-note-open")));
    });
  }

  function getOrderedNoteEntries(detail) {
    const notes = detail && detail.notes ? detail.notes : {};
    const articleBody = document.getElementById("articleBody");
    const entries = [];
    const seen = new Set();

    if (articleBody) {
      articleBody.querySelectorAll(".article-annotation[data-note-id]").forEach((element) => {
        const noteId = element.dataset.noteId;
        if (noteId && notes[noteId]) {
          seen.add(noteId);
          entries.push({ note: notes[noteId], element });
        }
      });
    }

    Object.values(notes).forEach((note) => {
      if (!seen.has(note.id)) {
        entries.push({ note, element: null });
      }
    });

    return entries;
  }

  function jumpToNote(noteId) {
    const element = document.querySelector(`.article-annotation[data-note-id="${CSS.escape(noteId || "")}"]`);
    if (!element) {
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function openNoteFromSummary(noteId) {
    const element = document.querySelector(`.article-annotation[data-note-id="${CSS.escape(noteId || "")}"]`);
    if (!element) {
      return;
    }
    jumpToNote(noteId);
    window.setTimeout(() => openNoteEditor(element, noteId), 180);
  }

  function updateNotePreview() {
    const markdown = noteEditor.value.trim();
    if (!markdown) {
      notePreview.innerHTML = '<p class="note-preview-empty">这里会实时渲染批注里的 Markdown 内容。</p>';
      return;
    }

    notePreview.innerHTML = marked.parse(markdown);
  }

  function getClosestBlockElement(element) {
    return element.closest("p,li,blockquote,td,th,h1,h2,h3,h4,h5,h6,pre,code");
  }

  async function createHighlightMark(range) {
    if (!range) {
      return null;
    }

    const selection = window.getSelection();
    selection.removeAllRanges();

    const mark = document.createElement("span");
    mark.className = "article-mark article-highlight";
    mark.dataset.markId = makeId("mark");
    mark.appendChild(range.extractContents());
    range.insertNode(mark);

    mark.title = "点击取消高亮";
    bindHighlightElement(mark);
    await persistCurrentPageFromDom();
    return mark;
  }

  async function createAnnotationMark(range, options = {}) {
    if (!range) {
      return null;
    }

    const detail = state.pageCache[state.ui.activePageId];
    const articleBody = document.getElementById("articleBody");
    if (!detail || !articleBody || !articleBody.contains(range.commonAncestorContainer)) {
      return null;
    }

    const selection = window.getSelection();
    selection.removeAllRanges();

    const mark = document.createElement("span");
    const variantClass = options.variant === "llm" ? "article-annotation-llm" : "";
    mark.className = `article-mark article-annotation ${variantClass}`.trim();
    mark.dataset.markId = makeId("mark");
    if (options.variant === "llm") {
      mark.dataset.annotationVariant = "llm";
    }
    mark.appendChild(range.extractContents());
    range.insertNode(mark);

    const noteId = makeId("note");
    mark.dataset.noteId = noteId;
    mark.title = options.variant === "llm" ? "点击查看 LLM 批注" : "点击查看或编辑批注";
    detail.notes[noteId] = {
      id: noteId,
      quote: mark.textContent.trim(),
      text: options.noteText || "",
      updatedAt: new Date().toISOString(),
      source: options.source || "manual"
    };
    bindAnnotationElement(mark);
    await persistCurrentPageFromDom();
    renderAnnotationSummary(detail);
    return mark;
  }

  async function createLlmAnnotation(answer) {
    const range = state.askContext.pendingRange;
    if (!range || !state.askContext.pageId || state.askContext.pageId !== state.ui.activePageId) {
      return null;
    }

    const rangeClone = range.cloneRange();
    const mark = await createAnnotationMark(rangeClone, {
      noteText: answer,
      source: "llm",
      variant: "llm"
    });
    if (mark) {
      state.askContext.pendingRange = null;
    }
    return mark;
  }

  async function updateAnnotationNoteText(noteId, text) {
    if (!noteId) {
      return false;
    }

    const detail = state.pageCache[state.ui.activePageId];
    const note = detail && detail.notes ? detail.notes[noteId] : null;
    if (!note) {
      return false;
    }

    note.text = text || "";
    note.updatedAt = new Date().toISOString();
    await persistCurrentPageFromDom();
    renderAnnotationSummary(detail);

    if (activeNoteContext && activeNoteContext.noteId === noteId) {
      noteEditor.value = note.text;
      updateNotePreview();
    }
    return true;
  }

  function unwrapElement(element) {
    const parent = element.parentNode;
    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    parent.removeChild(element);
    parent.normalize();
  }
})();
