// 文件作用：处理搜索跳转、快捷访问编辑以及本机背景和布局设置。
"use strict";
const engines = { google: "https://www.google.com/search", bing: "https://www.bing.com/search", baidu: "https://www.baidu.com/s" };
const searchForm = document.querySelector("#search-form");
const shortcutDialog = document.querySelector("#shortcut-dialog");
const settingsDialog = document.querySelector("#settings-dialog");
let editingIndex = -1;
let settings = readSettings();

// 读取本地设置；首次使用或数据异常时采用内置默认值。
function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("minimal-newtab-v1"));
    if (saved && Array.isArray(saved.links)) {
      return { engine: engines[saved.engine] ? saved.engine : "google", position: ["center", "upper", "lower"].includes(saved.position) ? saved.position : "center", background: typeof saved.background === "string" && saved.background.startsWith("data:image/") ? saved.background : "", links: saved.links.filter(isValidLink) };
    }
  } catch { /* 本地存储不可用时仍允许使用默认页面。 */ }
  return { engine: "google", position: "center", background: "", links: structuredClone(DEFAULT_LINKS) };
}

// 校验保存的网址仅使用普通网页协议。
function normalizeUrl(value) {
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("请输入有效的 HTTP 或 HTTPS 网址。");
  return url.href;
}

// 检查已保存的快捷访问是否具有合法名称和网址。
function isValidLink(link) {
  try { return typeof link.name === "string" && link.name.trim().length > 0 && typeof link.url === "string" && Boolean(normalizeUrl(link.url)); }
  catch { return false; }
}

// 将设置写入本机存储，失败时保留当前界面并显示原因。
function saveSettings(errorElement) {
  try { localStorage.setItem("minimal-newtab-v1", JSON.stringify(settings)); return true; }
  catch { errorElement.textContent = "保存失败：本机存储空间不足或被禁用，请改用较小的背景图片。"; return false; }
}

// 应用背景、搜索引擎和内容位置设置。
function applySettings() {
  document.body.style.backgroundImage = settings.background ? `url("${settings.background}")` : "";
  document.body.dataset.position = settings.position;
  searchForm.action = engines[settings.engine];
  document.querySelector("#search-input").name = settings.engine === "baidu" ? "wd" : "q";
  document.querySelector("#engine").value = settings.engine;
  document.querySelector("#position").value = settings.position;
}

// 创建不依赖远程图标服务的快捷访问图标。
// 优先使用保留的原网站图标，新添加的网站从 Chrome 图标缓存读取，失败时显示文字。
function createIcon(name, pageUrl) {
  const icon = document.createElement("span");
  icon.className = "shortcut-icon";
  icon.textContent = Array.from(name)[0].toUpperCase();
  if (pageUrl) {
    let source = DEFAULT_LINKS.find(findMatchingIcon)?.icon;
    // 匹配默认快捷项，以便已保存的快捷访问也能显示随扩展附带的图标。
    function findMatchingIcon(link) { return normalizeUrl(link.url) === pageUrl; }
    if (!source && globalThis.chrome?.runtime?.id) {
      const faviconUrl = new URL(chrome.runtime.getURL("/_favicon/"));
      faviconUrl.searchParams.set("pageUrl", pageUrl);
      faviconUrl.searchParams.set("size", "32");
      source = faviconUrl.href;
    }
    if (source) {
      const image = document.createElement("img");
      image.alt = "";
      image.className = "site-favicon";
      // 图片成功加载后替换文字，避免出现破损图片。
      image.addEventListener("load", function showSiteIcon() { icon.replaceChildren(image); });
      image.src = source;
    }
  }
  return icon;
}

// 根据本地设置重建快捷访问列表。
function renderShortcuts() {
  const container = document.querySelector("#shortcuts");
  container.replaceChildren();
  settings.links.forEach(renderShortcut);
  const addItem = document.createElement("div");
  addItem.className = "shortcut";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "shortcut-link";
  add.title = "添加快捷访问";
  add.append(createIcon("+"));
  const label = document.createElement("span");
  label.className = "shortcut-label";
  label.textContent = "添加快捷访问";
  add.append(label);
  add.addEventListener("click", openNewShortcut);
  addItem.append(add);
  container.append(addItem);
}

// 渲染单个快捷访问及其编辑入口。
function renderShortcut(link, index) {
  const item = document.createElement("div");
  item.className = "shortcut";
  const anchor = document.createElement("a");
  anchor.className = "shortcut-link";
  anchor.href = normalizeUrl(link.url);
  anchor.title = link.name;
  anchor.append(createIcon(link.name, anchor.href));
  const label = document.createElement("span");
  label.className = "shortcut-label";
  label.textContent = link.name;
  anchor.append(label);
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "edit-shortcut";
  edit.textContent = "⋮";
  edit.setAttribute("aria-label", `编辑${link.name}`);
  // 记录当前快捷项并打开编辑窗口。
  edit.addEventListener("click", function editCurrentShortcut() { openShortcut(index); });
  item.append(anchor, edit);
  document.querySelector("#shortcuts").append(item);
}

// 打开新增快捷访问窗口。
function openNewShortcut() { openShortcut(-1); }

// 填入待编辑信息并打开快捷访问窗口。
function openShortcut(index) {
  editingIndex = index;
  document.querySelector("#shortcut-heading").textContent = index < 0 ? "添加快捷访问" : "编辑快捷访问";
  document.querySelector("#shortcut-name").value = settings.links[index]?.name || "";
  document.querySelector("#shortcut-url").value = settings.links[index]?.url || "";
  document.querySelector("#delete-shortcut").hidden = index < 0;
  document.querySelector("#shortcut-error").textContent = "";
  shortcutDialog.showModal();
}

// 保存新增或编辑后的快捷项，保存失败时回滚内存状态。
function submitShortcut(event) {
  event.preventDefault();
  const errorElement = document.querySelector("#shortcut-error");
  try {
    const link = { name: document.querySelector("#shortcut-name").value.trim(), url: normalizeUrl(document.querySelector("#shortcut-url").value.trim()) };
    if (!link.name) throw new Error("请输入快捷访问名称。");
    const previous = structuredClone(settings.links);
    if (editingIndex < 0) settings.links.push(link); else settings.links[editingIndex] = link;
    if (!saveSettings(errorElement)) { settings.links = previous; return; }
    renderShortcuts();
    shortcutDialog.close();
  } catch (error) { errorElement.textContent = error.message || "请输入有效的网址。"; }
}

// 删除当前快捷项，保存成功后立即刷新列表。
function deleteShortcut() {
  const previous = structuredClone(settings.links);
  settings.links.splice(editingIndex, 1);
  if (!saveSettings(document.querySelector("#shortcut-error"))) { settings.links = previous; return; }
  renderShortcuts();
  shortcutDialog.close();
}

// 将搜索框中的网址直接打开，其他内容交由所选引擎搜索。
function submitSearch(event) {
  const value = document.querySelector("#search-input").value.trim();
  if (!value) { event.preventDefault(); return; }
  if (/^https?:\/\//i.test(value) || /^(localhost|(?:[\p{L}\d-]+\.)+[\p{L}\d-]+)(:\d+)?([/?#]\S*)?$/u.test(value)) {
    event.preventDefault();
    try { location.assign(normalizeUrl(/^localhost(?=[:/]|$)/i.test(value) ? `http://${value}` : value)); }
    catch { /* 无效网址保持当前页面，便于用户修改。 */ }
  }
}

// 打开页面设置窗口。
function openSettings() { document.querySelector("#settings-error").textContent = ""; settingsDialog.showModal(); }

// 关闭页面设置窗口。
function closeSettings() { settingsDialog.close(); }

// 关闭快捷访问窗口。
function closeShortcut() { shortcutDialog.close(); }

// 保存搜索引擎与内容位置，失败时恢复旧设置。
function updateOptions() {
  const previous = { ...settings };
  settings.engine = document.querySelector("#engine").value;
  settings.position = document.querySelector("#position").value;
  if (!saveSettings(document.querySelector("#settings-error"))) settings = previous;
  applySettings();
}

// 加载用户选择的本地背景图片，并限制大小避免超出存储额度。
function uploadBackground(event) {
  const file = event.target.files[0];
  const errorElement = document.querySelector("#settings-error");
  errorElement.textContent = "";
  if (!file) return;
  if (file.size > 3 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    errorElement.textContent = "请选择不超过 3 MB 的 JPG、PNG 或 WebP 图片。";
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  // 图片读取成功后保存为本地背景。
  reader.addEventListener("load", function saveUploadedBackground() {
    const previous = settings.background;
    settings.background = reader.result;
    if (!saveSettings(errorElement)) settings.background = previous;
    applySettings();
    event.target.value = "";
  });
  // 文件读取失败时显示提示。
  reader.addEventListener("error", function showImageReadError() { errorElement.textContent = "无法读取图片，请重新选择。"; });
  reader.readAsDataURL(file);
}

// 清除自定义图片并恢复随扩展附带的原始背景。
function resetBackground() {
  const previous = settings.background;
  settings.background = "";
  if (!saveSettings(document.querySelector("#settings-error"))) settings.background = previous;
  applySettings();
}

searchForm.addEventListener("submit", submitSearch);
document.querySelector("#shortcut-form").addEventListener("submit", submitShortcut);
document.querySelector("#delete-shortcut").addEventListener("click", deleteShortcut);
document.querySelector("#cancel-shortcut").addEventListener("click", closeShortcut);
document.querySelector("#settings-button").addEventListener("click", openSettings);
document.querySelector("#close-settings").addEventListener("click", closeSettings);
document.querySelector("#engine").addEventListener("change", updateOptions);
document.querySelector("#position").addEventListener("change", updateOptions);
document.querySelector("#background-file").addEventListener("change", uploadBackground);
document.querySelector("#reset-background").addEventListener("click", resetBackground);
applySettings();
renderShortcuts();
