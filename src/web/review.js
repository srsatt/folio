export function sortComments(comments) {
  return [...comments].sort((left, right) =>
    left.blockOrder - right.blockOrder
    || left.startOffset - right.startOffset
    || left.createdAt.localeCompare(right.createdAt));
}

function quote(text) {
  return text.split("\n").map((line) => `> ${line}`).join("\n");
}

export function buildFeedbackMarkdown(metadata, comments) {
  const lines = [
    `# Review feedback: ${metadata.title}`,
    "",
    `I reviewed Folio report \`${metadata.id}\`.`,
    "",
    "Please address every comment below.",
    "",
    "After addressing the feedback, briefly explain what changed and create a new Folio report if the report itself needs to be updated.",
    "",
    "## Context",
    "",
  ];
  if (metadata.repository.key) lines.push(`- Repository: \`${metadata.repository.key}\``);
  if (metadata.repository.branch) lines.push(`- Branch: \`${metadata.repository.branch}\``);
  if (metadata.repository.commit) lines.push(`- Commit: \`${metadata.repository.commit.slice(0, 7)}\``);
  lines.push(`- Report ID: \`${metadata.id}\``);
  sortComments(comments).forEach((comment, index) => {
    lines.push("", `## Comment ${index + 1}`, "");
    if (comment.sectionTitle) lines.push(`**Section:** ${comment.sectionTitle}`, "");
    if (comment.evidence) lines.push(`**Evidence:** \`${comment.evidence}\``, "");
    lines.push(quote(comment.selectedText), "", comment.body.trim());
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

function headingId(text, used) {
  const base = text.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
  const count = (used.get(base) || 0) + 1;
  used.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

function initTableOfContents() {
  const list = document.querySelector("#folio-toc");
  if (!list) return;
  list.replaceChildren();
  const headings = [...document.querySelectorAll(".folio-document h2, .folio-document h3, .folio-document h4")];
  const used = new Map();
  const links = new Map();
  for (const heading of headings) {
    heading.id = heading.id || headingId(heading.textContent || "", used);
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    link.dataset.level = heading.tagName.slice(1);
    link.textContent = heading.textContent || heading.id;
    item.append(link);
    list.append(item);
    links.set(heading, link);
  }
  if (headings.length === 0) {
    document.querySelector(".folio-sidebar nav")?.setAttribute("hidden", "");
    return;
  }
  links.get(headings[0])?.classList.add("folio-toc-active");
  if (!("IntersectionObserver" in globalThis)) return;
  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    const active = headings.find((heading) => visible.has(heading));
    if (!active) return;
    for (const link of links.values()) link.classList.remove("folio-toc-active");
    links.get(active)?.classList.add("folio-toc-active");
  }, { rootMargin: "-12% 0px -72% 0px" });
  for (const heading of headings) observer.observe(heading);
}

function initTheme() {
  const control = document.querySelector("#folio-theme");
  let theme = "system";
  try {
    const saved = localStorage.getItem("folio:theme");
    if (["system", "light", "dark"].includes(saved)) theme = saved;
  } catch {
    theme = "system";
  }
  const apply = (value) => {
    theme = ["system", "light", "dark"].includes(value) ? value : "system";
    document.documentElement.dataset.folioTheme = theme;
    if (control) control.value = theme;
  };
  apply(theme);
  control?.addEventListener("change", () => {
    apply(control.value);
    try { localStorage.setItem("folio:theme", theme); } catch { /* Keep current-page theme. */ }
  });
}

function configureServedFileLinks(metadata) {
  if (!/^https?:$/.test(location.protocol)) return;
  for (const link of document.querySelectorAll("a.folio-file-ref[data-folio-path]")) {
    const path = link.dataset.folioPath;
    if (!path) continue;
    const url = new URL(`/r/${encodeURIComponent(metadata.id)}/source`, location.origin);
    url.searchParams.set("path", path);
    const lines = link.dataset.folioLines;
    if (lines) {
      url.searchParams.set("lines", lines);
      const [start, end] = lines.split("-");
      url.hash = `L${start}${end ? `-L${end}` : ""}`;
    }
    link.href = url.href;
    link.title = "View repository source";
  }
}

function downloadBlob(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url));
}

function shareableHtml(root, metadata) {
  const clone = root.cloneNode(true);
  clone.querySelector(".folio-server-navigation")?.remove();
  for (const link of clone.querySelectorAll("a.folio-file-ref")) {
    const label = clone.ownerDocument.createElement("span");
    for (const attribute of link.attributes) {
      if (attribute.name !== "href" && attribute.name !== "title") label.setAttribute(attribute.name, attribute.value);
    }
    label.append(...link.childNodes);
    link.replaceWith(label);
  }
  const metadataNode = clone.querySelector("#folio-metadata");
  if (metadataNode) {
    const sharedMetadata = {
      ...metadata,
      repository: { ...metadata.repository, root: null },
    };
    metadataNode.textContent = JSON.stringify(sharedMetadata).replace(/</g, "\\u003c");
  }
  return `<!doctype html>\n${clone.outerHTML}`;
}

function printWithoutLocalLinks() {
  const links = [...document.querySelectorAll("a.folio-file-ref[href]")];
  const hrefs = links.map((link) => link.getAttribute("href"));
  links.forEach((link) => link.removeAttribute("href"));
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    links.forEach((link, index) => {
      const href = hrefs[index];
      if (href) link.setAttribute("href", href);
    });
  };
  window.addEventListener("afterprint", restore, { once: true });
  window.print();
  setTimeout(restore, 1000);
}

function initReview() {
  const metadataNode = document.querySelector("#folio-metadata");
  if (!metadataNode) return;
  const metadata = JSON.parse(metadataNode.textContent || "{}");
  const sourceNode = document.querySelector("#folio-source");
  const source = sourceNode ? JSON.parse(sourceNode.textContent || '""') : "";
  initTheme();
  configureServedFileLinks(metadata);
  initTableOfContents();
  const shareTemplate = document.documentElement.cloneNode(true);
  const storageKey = `folio:review:${metadata.id}:${metadata.contentHash}`;
  const blocks = new Map([...document.querySelectorAll("[data-folio-annotatable]")]
    .map((block) => [block.dataset.folioBlockId, block]));
  const originals = new Map([...blocks].map(([id, block]) => [id, [...block.childNodes].map((node) => node.cloneNode(true))]));
  const action = document.querySelector("#folio-comment-action");
  const dialog = document.querySelector("#folio-comment-dialog");
  const form = document.querySelector("#folio-comment-form");
  const bodyInput = document.querySelector("#folio-comment-body");
  const selectedQuote = document.querySelector("#folio-selected-quote");
  const dialogTitle = document.querySelector("#folio-dialog-title");
  const toast = document.querySelector("#folio-toast");
  const storageNote = document.querySelector("#folio-storage-note");
  const copyButton = document.querySelector("#folio-copy");
  const downloadButton = document.querySelector("#folio-download");
  const clearButton = document.querySelector("#folio-clear");
  const count = document.querySelector("#folio-comment-count");
  const copyFallback = document.querySelector("#folio-copy-fallback");
  const copyText = document.querySelector("#folio-copy-text");
  const htmlButton = document.querySelector("#folio-download-html");
  const pdfButton = document.querySelector("#folio-download-pdf");
  const markdownButton = document.querySelector("#folio-download-markdown");
  const commentList = document.querySelector("#folio-comment-list");
  const visibleCommentCount = document.querySelector("#folio-visible-comment-count");
  let comments = [];
  let pending = null;
  let editingId = null;
  let toastTimer = null;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("folio-toast-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("folio-toast-visible"), 2600);
  }

  function validComment(value) {
    return value && typeof value.id === "string" && typeof value.blockId === "string"
      && Number.isInteger(value.blockOrder) && Number.isInteger(value.startOffset)
      && Number.isInteger(value.endOffset) && value.endOffset > value.startOffset
      && typeof value.selectedText === "string" && typeof value.body === "string"
      && (value.sectionTitle === null || typeof value.sectionTitle === "string")
      && (value.evidence === null || typeof value.evidence === "string")
      && typeof value.createdAt === "string" && typeof value.updatedAt === "string";
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state?.version === 1 && state.reportId === metadata.id && state.contentHash === metadata.contentHash
        && Array.isArray(state.comments)) comments = state.comments.filter(validComment);
    } catch {
      storageNote.hidden = false;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        version: 1,
        reportId: metadata.id,
        contentHash: metadata.contentHash,
        comments,
      }));
    } catch {
      storageNote.hidden = false;
    }
  }

  function rangeToOffsets(block, range) {
    const prefix = document.createRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(range.startContainer, range.startOffset);
    const startOffset = prefix.toString().length;
    const selectedText = range.toString();
    return { startOffset, endOffset: startOffset + selectedText.length, selectedText };
  }

  function offsetsToRange(block, startOffset, endOffset) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let position = 0;
    let startNode = null;
    let endNode = null;
    let start = 0;
    let end = 0;
    let node;
    while ((node = walker.nextNode())) {
      const next = position + node.data.length;
      if (!startNode && startOffset >= position && startOffset <= next) {
        startNode = node;
        start = startOffset - position;
      }
      if (!endNode && endOffset >= position && endOffset <= next) {
        endNode = node;
        end = endOffset - position;
        break;
      }
      position = next;
    }
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode, start);
    range.setEnd(endNode, end);
    return range;
  }

  function highlightRange(block, range, commentId) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const segments = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!range.intersectsNode(node)) continue;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.data.length;
      if (end > start) segments.push({ node, start, end });
    }
    const marks = [];
    for (const segment of segments.reverse()) {
      const part = document.createRange();
      part.setStart(segment.node, segment.start);
      part.setEnd(segment.node, segment.end);
      const mark = document.createElement("mark");
      mark.className = "folio-comment-highlight";
      mark.dataset.commentId = commentId;
      part.surroundContents(mark);
      marks.unshift(mark);
    }
    return marks;
  }

  function selectionContext(block, range) {
    const context = block.closest("[data-folio-context-kind]");
    let sectionTitle = block.dataset.folioSection || null;
    if (context?.dataset.folioContextTitle && context.dataset.folioContextKind !== "summary") {
      const kind = context.dataset.folioContextKind;
      sectionTitle = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}: ${context.dataset.folioContextTitle}`;
    }
    const evidenceNode = block.closest("[data-folio-path]");
    let evidenceLines = evidenceNode?.dataset.folioLines || "";
    if (range && block.classList.contains("folio-source-code")) {
      const elementFor = (node) => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      const startLine = elementFor(range.startContainer)?.closest?.("[data-line]")?.dataset.line;
      const endLine = elementFor(range.endContainer)?.closest?.("[data-line]")?.dataset.line;
      if (startLine) evidenceLines = startLine === endLine || !endLine ? startLine : `${startLine}-${endLine}`;
    }
    const evidence = evidenceNode?.dataset.folioPath
      ? `${evidenceNode.dataset.folioPath}${evidenceLines ? `:${evidenceLines}` : ""}`
      : null;
    return { sectionTitle, evidence };
  }

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      action.hidden = true;
      return;
    }
    const range = selection.getRangeAt(0);
    const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
    const startBlock = startElement?.closest?.("[data-folio-annotatable]");
    const endBlock = endElement?.closest?.("[data-folio-annotatable]");
    if (!startBlock || startBlock !== endBlock) {
      action.hidden = true;
      if (startBlock || endBlock) showToast("Select text within a single block to comment.");
      return;
    }
    const offsets = rangeToOffsets(startBlock, range);
    if (!offsets.selectedText.trim()) {
      action.hidden = true;
      return;
    }
    const overlap = comments.some((comment) => comment.blockId === startBlock.dataset.folioBlockId
      && offsets.startOffset < comment.endOffset && offsets.endOffset > comment.startOffset);
    if (overlap) {
      action.hidden = true;
      showToast("This selection overlaps an existing comment.");
      return;
    }
    pending = {
      blockId: startBlock.dataset.folioBlockId,
      blockOrder: Number(startBlock.dataset.folioBlockOrder),
      ...offsets,
      ...selectionContext(startBlock, range),
    };
    const rect = range.getBoundingClientRect();
    action.style.left = `${Math.min(window.innerWidth - action.offsetWidth - 12, Math.max(12, rect.left + rect.width / 2))}px`;
    action.style.top = `${Math.max(12, rect.top - 44)}px`;
    action.hidden = false;
  }

  function restoreBlocks() {
    for (const [id, block] of blocks) {
      const nodes = originals.get(id) || [];
      block.replaceChildren(...nodes.map((node) => node.cloneNode(true)));
    }
    commentList?.replaceChildren();
  }

  function commentCard(comment, number) {
    const card = document.createElement("article");
    card.className = "folio-comment-card";
    card.dataset.commentId = comment.id;
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      blocks.get(comment.blockId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const heading = document.createElement("strong");
    heading.textContent = `Comment ${number}`;
    const quoteNode = document.createElement("blockquote");
    quoteNode.textContent = comment.selectedText;
    const body = document.createElement("p");
    body.textContent = comment.body;
    const actions = document.createElement("div");
    actions.className = "folio-comment-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openEditor(comment));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      if (!confirm("Delete this comment?")) return;
      comments = comments.filter((candidate) => candidate.id !== comment.id);
      saveState();
      renderComments();
    });
    actions.append(edit, remove);
    card.append(heading, quoteNode, body, actions);
    return card;
  }

  function renderComments() {
    restoreBlocks();
    const sorted = sortComments(comments);
    const numberById = new Map(sorted.map((comment, index) => [comment.id, index + 1]));
    const byBlock = new Map();
    for (const comment of sorted) {
      if (!byBlock.has(comment.blockId)) byBlock.set(comment.blockId, []);
      byBlock.get(comment.blockId).push(comment);
    }
    for (const [blockId, blockComments] of byBlock) {
      const block = blocks.get(blockId);
      if (!block) continue;
      for (const comment of [...blockComments].sort((left, right) => right.startOffset - left.startOffset)) {
        const range = offsetsToRange(block, comment.startOffset, comment.endOffset);
        if (!range || range.toString() !== comment.selectedText) continue;
        const marks = highlightRange(block, range, comment.id);
        if (marks.length === 0) continue;
        const marker = document.createElement("sup");
        marker.className = "folio-comment-marker";
        marker.dataset.number = String(numberById.get(comment.id));
        marker.setAttribute("aria-label", `Comment ${numberById.get(comment.id)}`);
        marks[marks.length - 1].after(marker);
      }
    }
    const visibleComments = sorted.filter((comment) => blocks.has(comment.blockId));
    if (commentList) {
      if (visibleComments.length === 0) {
        const empty = document.createElement("p");
        empty.className = "folio-comment-empty";
        empty.textContent = document.querySelector(".folio-source-document")
          ? "Select code to leave feedback."
          : "Select report text to leave feedback.";
        commentList.append(empty);
      } else {
        for (const comment of visibleComments) commentList.append(commentCard(comment, numberById.get(comment.id)));
      }
    }
    if (visibleCommentCount) visibleCommentCount.textContent = `${visibleComments.length} here`;
    const total = comments.length;
    count.textContent = `${total} comment${total === 1 ? "" : "s"}`;
    copyButton.disabled = total === 0;
    downloadButton.disabled = total === 0;
    clearButton.disabled = total === 0;
  }

  function openEditor(comment = null) {
    editingId = comment?.id || null;
    const selection = comment || pending;
    if (!selection) return;
    dialogTitle.textContent = comment ? "Edit comment" : "Add comment";
    selectedQuote.textContent = selection.selectedText;
    bodyInput.value = comment?.body || "";
    action.hidden = true;
    dialog.showModal();
    bodyInput.focus();
  }

  action.addEventListener("click", () => openEditor());
  document.querySelector("#folio-cancel").addEventListener("click", () => dialog.close());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = bodyInput.value.trim();
    if (!body) return;
    const now = new Date().toISOString();
    if (editingId) {
      comments = comments.map((comment) => comment.id === editingId ? { ...comment, body, updatedAt: now } : comment);
    } else if (pending) {
      comments.push({
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        ...pending,
        body,
        createdAt: now,
        updatedAt: now,
      });
    }
    editingId = null;
    pending = null;
    dialog.close();
    window.getSelection()?.removeAllRanges();
    saveState();
    renderComments();
  });
  bodyInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") form.requestSubmit();
  });
  document.addEventListener("mouseup", () => setTimeout(captureSelection));
  document.addEventListener("keyup", (event) => {
    if (event.key.startsWith("Arrow") || event.key === "Shift") setTimeout(captureSelection);
  });
  window.addEventListener("scroll", () => { action.hidden = true; }, { passive: true });

  async function copyFeedback() {
    const markdown = buildFeedbackMarkdown(metadata, comments);
    try {
      await navigator.clipboard.writeText(markdown);
      showToast("Review feedback copied.");
    } catch {
      copyText.value = markdown;
      copyFallback.showModal();
      copyText.focus();
      copyText.select();
    }
  }
  copyButton.addEventListener("click", copyFeedback);
  htmlButton?.addEventListener("click", () => {
    downloadBlob(shareableHtml(shareTemplate, metadata), "text/html;charset=utf-8", `${metadata.slug}.html`);
  });
  pdfButton?.addEventListener("click", printWithoutLocalLinks);
  markdownButton?.addEventListener("click", () => {
    downloadBlob(source, "text/markdown;charset=utf-8", `${metadata.slug}.md`);
  });
  downloadButton.addEventListener("click", () => {
    downloadBlob(buildFeedbackMarkdown(metadata, comments), "text/markdown;charset=utf-8", `${metadata.slug}-review.md`);
  });
  clearButton.addEventListener("click", () => {
    if (!confirm("Clear all comments for this report?")) return;
    comments = [];
    try { localStorage.removeItem(storageKey); } catch { storageNote.hidden = false; }
    renderComments();
  });

  loadState();
  renderComments();
}

if (typeof document !== "undefined") initReview();
