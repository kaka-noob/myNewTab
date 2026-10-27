// 文件作用：提供快捷访问匹配、可选的在线搜索建议以及键盘选择。
"use strict";
const suggestionInput = document.querySelector("#search-input");
const suggestionList = document.querySelector("#suggestions");
const onlineOption = document.querySelector("#online-suggestions");
let suggestionTimer;
let suggestionRequest;
let suggestionItems = [];
let activeSuggestion = -1;
let composingSuggestion = false;
// 新版默认启用真实在线联想；独立设置键避免旧版默认关闭状态继续影响使用。
onlineOption.checked = true;
try { onlineOption.checked = localStorage.getItem("mynewtab-online-suggestions") !== "false"; }
catch { /* 存储不可用时仍按默认设置提供在线建议。 */ }
suggestionInput.setAttribute("role", "combobox");
suggestionInput.setAttribute("aria-autocomplete", "list");
suggestionInput.setAttribute("aria-controls", "suggestions");
suggestionInput.setAttribute("aria-expanded", "false");

// 清理过时的请求及定时器，防止旧建议覆盖新输入。
function cancelSuggestions() {
  clearTimeout(suggestionTimer);
  suggestionRequest?.abort();
  suggestionRequest = undefined;
}

// 隐藏下拉框并清除键盘选择状态。
function closeSuggestions() {
  cancelSuggestions();
  suggestionList.hidden = true;
  activeSuggestion = -1;
  suggestionInput.setAttribute("aria-expanded", "false");
  suggestionInput.removeAttribute("aria-activedescendant");
}

// 仅发送普通关键词，避免将网址或本机地址作为联想请求发送。
function canSuggestOnline(query) {
  return onlineOption.checked && query.length <= 100 && !/[:/@\\]|localhost|(?:[\p{L}\d-]+\.)+[\p{L}\d-]+/iu.test(query);
}

// 根据当前搜索引擎构造联想请求，不携带账户凭据。
async function fetchSuggestions(query, signal) {
  const endpoints = { google: "https://suggestqueries.google.com/complete/search", bing: "https://api.bing.com/osjson.aspx", baidu: "https://suggestion.baidu.com/su" };
  const url = new URL(endpoints[settings.engine]);
  if (settings.engine === "baidu") {
    url.search = new URLSearchParams({ wd: query, cb: "newtabSuggest", ie: "utf-8", oe: "utf-8" });
  } else {
    url.search = new URLSearchParams(settings.engine === "bing" ? { query, market: "zh-CN" } : { q: query, client: "firefox", hl: "zh-CN" });
  }
  const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("搜索建议暂不可用");
  const text = await response.text();
  const words = settings.engine === "baidu" ? parseBaiduSuggestions(text) : JSON.parse(text)[1];
  return Array.isArray(words) ? words.filter(isSuggestionText).slice(0, 8) : [];
}

// 百度返回的对象键未加引号，仅提取字符串数组并解析，绝不执行返回的脚本。
function parseBaiduSuggestions(text) {
  const match = text.match(/\bs\s*:\s*(\[(?:"(?:\\.|[^"\\])*"\s*,?\s*)*\])/);
  return match ? JSON.parse(match[1]) : [];
}

// 验证服务返回的建议只包含长度合理的文本。
function isSuggestionText(value) { return typeof value === "string" && value.length > 0 && value.length <= 150; }

// 以安全的文本节点渲染建议，避免远程内容被当作代码执行。
function renderSuggestions(items) {
  suggestionItems = items;
  activeSuggestion = -1;
  suggestionInput.removeAttribute("aria-activedescendant");
  suggestionList.replaceChildren();
  items.forEach(appendSuggestion);
  suggestionList.hidden = items.length === 0;
  suggestionInput.setAttribute("aria-expanded", String(items.length > 0));
}

// 创建单条建议并绑定点击选择。
function appendSuggestion(item, index) {
  const row = document.createElement("div");
  row.className = "suggestion";
  row.id = `suggestion-${index}`;
  row.setAttribute("role", "option");
  row.setAttribute("aria-selected", "false");
  const label = document.createElement("span");
  label.className = "suggestion-text";
  label.textContent = item.text;
  const source = document.createElement("span");
  source.className = "suggestion-source";
  source.textContent = item.url ? "快捷访问" : "搜索";
  row.append(label, source);
  // 阻止鼠标按下使输入框失焦，从而让点击能完成选择。
  row.addEventListener("mousedown", function retainSearchFocus(event) { event.preventDefault(); });
  // 点击该行时直接打开网址或提交选中的关键词。
  row.addEventListener("click", function chooseClickedSuggestion() { chooseSuggestion(index); });
  suggestionList.append(row);
}

// 即时匹配本地快捷访问，并延迟请求在线建议。
function updateSuggestions() {
  cancelSuggestions();
  const query = suggestionInput.value.trim();
  if (!query || composingSuggestion) { closeSuggestions(); return; }
  // 仅在本机匹配现有快捷项的名称与网址。
  const matches = settings.links.filter(function matchShortcut(link) { return `${link.name} ${link.url}`.toLowerCase().includes(query.toLowerCase()); }).slice(0, 4);
  // 保留命中的快捷访问地址，点击后直接打开。
  const localItems = matches.map(function shortcutSuggestion(link) { return { text: link.name, url: normalizeUrl(link.url) }; });
  localItems.push({ text: query });
  renderSuggestions(localItems);
  if (!canSuggestOnline(query)) return;
  // 输入停止片刻后再查询，减少无效网络请求。
  suggestionTimer = setTimeout(async function loadOnlineSuggestions() {
    const request = new AbortController();
    suggestionRequest = request;
    const engine = settings.engine;
    const timeout = setTimeout(function abortSlowSuggestions() { request.abort(); }, 12000);
    try {
      const words = await fetchSuggestions(query, request.signal);
      if (request.signal.aborted || engine !== settings.engine || suggestionInput.value.trim() !== query || document.activeElement !== suggestionInput) return;
      const items = [...localItems];
      // 去除与当前输入或已有建议重复的文字。
      for (const text of words) {
        if (!items.some(function hasSameText(item) { return item.text === text; })) items.push({ text });
      }
      renderSuggestions(items.slice(0, 8));
    } catch { /* 网络失败时保留本机建议，正常回车搜索不受影响。 */ }
    finally { clearTimeout(timeout); }
  }, 250);
}

// 选择建议后打开匹配网站，或使用当前引擎进行搜索。
function chooseSuggestion(index) {
  const item = suggestionItems[index];
  if (!item) return;
  closeSuggestions();
  if (item.url) location.assign(item.url);
  else { suggestionInput.value = item.text; searchForm.requestSubmit(); }
}

// 上下方向键选择建议，回车确认，退出键关闭。
function handleSuggestionKey(event) {
  if (event.isComposing || composingSuggestion || suggestionList.hidden) return;
  if (event.key === "Escape") { event.preventDefault(); closeSuggestions(); return; }
  if (event.key === "Enter" && activeSuggestion >= 0) { event.preventDefault(); chooseSuggestion(activeSuggestion); return; }
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  activeSuggestion = activeSuggestion < 0 ? (event.key === "ArrowDown" ? 0 : suggestionItems.length - 1) : (activeSuggestion + (event.key === "ArrowDown" ? 1 : -1) + suggestionItems.length) % suggestionItems.length;
  // 更新所有选项的选择状态，保持屏幕阅读器与视觉反馈一致。
  Array.from(suggestionList.children).forEach(function highlightSuggestion(row, index) { row.setAttribute("aria-selected", String(index === activeSuggestion)); });
  suggestionInput.setAttribute("aria-activedescendant", `suggestion-${activeSuggestion}`);
  suggestionList.children[activeSuggestion].scrollIntoView({ block: "nearest" });
}

// 保存用户对在线联想的选择，默认开启，也可在设置中手动关闭。
function changeOnlineSuggestions() {
  try { localStorage.setItem("mynewtab-online-suggestions", String(onlineOption.checked)); }
  catch { document.querySelector("#settings-error").textContent = "在线建议开关暂时无法保存。"; }
  closeSuggestions();
}

// 中文输入法组合期间暂停建议，避免候选词被方向键干扰。
function startSuggestionComposition() { composingSuggestion = true; closeSuggestions(); }

// 中文输入完成后按最终文字刷新建议。
function endSuggestionComposition() { composingSuggestion = false; updateSuggestions(); }

suggestionInput.addEventListener("input", updateSuggestions);
suggestionInput.addEventListener("focus", updateSuggestions);
suggestionInput.addEventListener("blur", closeSuggestions);
suggestionInput.addEventListener("keydown", handleSuggestionKey);
suggestionInput.addEventListener("compositionstart", startSuggestionComposition);
suggestionInput.addEventListener("compositionend", endSuggestionComposition);
onlineOption.addEventListener("change", changeOnlineSuggestions);
document.querySelector("#engine").addEventListener("change", closeSuggestions);
searchForm.addEventListener("submit", closeSuggestions);
