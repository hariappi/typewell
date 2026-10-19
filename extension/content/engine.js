(() => {
  const T = globalThis.Typewell;
  if (T.FontEngine) return;
  const protectedTags = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "SVG", "MATH", "IFRAME", "OBJECT", "EMBED", "CANVAS", "TEXTAREA"]);
  const codeTags = new Set(["CODE", "PRE", "KBD", "SAMP"]);
  // GitHub file views use divs/table cells rather than semantic code tags.
  // Protect each code line and gutter, so file descriptions still get styled.
  const codeClasses = new Set(["react-code-text", "react-line-number", "blob-code", "blob-code-inner", "blob-num"]);
  const iconClass = /(^|[\s_-])(fa[srlbd]?|icon[s]?|glyphicon|octicon|material[-_]icons|material[-_]symbols|google[-_]symbols|google[-_]material[-_]icons|google[-_]sans[-_]icons|mi|bi|ri|ti|lucide)([\s_-]|$)/i;
  const iconFont = /font.?awesome|material.?icons|material.?symbols|google[ _-]*(?:symbols|material[ _-]*icons|sans[ _-]*icons)|glyphicons|icomoon|ionicons|octicons|remixicon|bootstrap.?icons|tabler.?icons|codicon|fluent.?icons|Segoe MDL2/i;
  const privateGlyph = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;
  class FontEngine {
    constructor(requestStyle, resourceURL) {
      this.requestStyle = requestStyle;
      this.resourceURL = resourceURL;
      this.profile = null;
      this.host = null;
      this.records = new Map();
      this.faces = new Map();
      this.shadows = new Map();
      this.pending = new Set();
      this.timer = null;
      this.observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.type === "childList") {
            this.pending.add(mutation.target);
            for (const node of mutation.addedNodes) if (node.nodeType === 1) this.pending.add(node);
          } else this.pending.add(mutation.target.nodeType === 3 ? mutation.target.parentElement : mutation.target);
        }
        if (!this.timer && this.pending.size) this.timer = setTimeout(() => this.refresh(), 80);
      });
    }
    record(element) {
      if (!this.records.has(element)) this.records.set(element, { attrs: new Map(), vars: new Map(), hadStyle: element.hasAttribute("style") });
      return this.records.get(element);
    }
    mark(element, attribute) {
      const record = this.record(element);
      if (!record.attrs.has(attribute)) record.attrs.set(attribute, element.getAttribute(attribute));
    }
    variable(element, name, value) {
      const record = this.record(element);
      if (!record.vars.has(name)) record.vars.set(name, [element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
      element.style.setProperty(name, value);
    }
    restoreElement(element, record) {
      for (const [name, value] of record.attrs) {
        if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
      }
      for (const [name, [value, priority]] of record.vars) {
        if (value) element.style.setProperty(name, value, priority); else element.style.removeProperty(name);
      }
      if (!record.hadStyle && element.getAttribute("style") === "") element.removeAttribute("style");
    }
    activate() {
      for (const [element, record] of this.records) for (const name of record.attrs.keys()) element.setAttribute(name, "");
    }
    deactivate() {
      for (const [element, record] of this.records) for (const name of record.attrs.keys()) element.removeAttribute(name);
    }
    keep(element, style) {
      this.mark(element, "data-typewell-keep");
      for (const [key, value] of Object.entries({font: style.fontFamily, size: style.fontSize, line: style.lineHeight, letter: style.letterSpacing, word: style.wordSpacing})) {
        this.variable(element, `--typewell-keep-${key}`, value);
      }
    }
    protectPseudo(element, pseudo) {
      const style = getComputedStyle(element, `::${pseudo}`);
      if (style.content && style.content !== "none" && style.content !== "normal" &&
        (privateGlyph.test(style.content) || iconFont.test(style.fontFamily))) {
        this.mark(element, `data-typewell-${pseudo}`);
        this.variable(element, `--typewell-${pseudo}-font`, style.fontFamily);
        this.variable(element, `--typewell-${pseudo}-size`, style.fontSize);
      }
    }
    scan(root) {
      const stack = root.nodeType === 1 ? [root] : [...root.children || []];
      while (stack.length) {
        const element = stack.pop();
        if (!element.isConnected || !element.style) continue;
        // A mutation can start inside a subtree excluded by an earlier scan.
        // Respect that ancestor even while its marker is temporarily inactive.
        let protectedParent = false;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (this.records.get(parent)?.attrs.has("data-typewell-keep")) { protectedParent = true; break; }
        }
        if (protectedParent) continue;
        const tag = element.tagName.toUpperCase();
        const className = element.getAttribute("class") || "";
        const text = [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join("").trim();
        // Most editors retain their own typography to avoid disrupting authoring tools.
        // Notion's entire document surface is contenteditable, so its document text must
        // remain eligible for Typewell or the extension appears to do nothing there.
        const protectedEditor = element.isContentEditable && !T.stylesEditableContent(this.host);
        const protectedElement = protectedTags.has(tag) || protectedEditor || element.getAttribute("role") === "img" ||
          (this.profile.preserveCode && (codeTags.has(tag) || [...element.classList].some(name => codeClasses.has(name)))) || iconClass.test(className) || privateGlyph.test(text) ||
          (tag === "INPUT" && ["password", "hidden", "checkbox", "radio", "file", "color", "range"].includes(element.type));
        if (protectedElement) {
          if (!["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE"].includes(tag)) this.keep(element, getComputedStyle(element));
          continue;
        }
        if (element.shadowRoot) {
          if (!this.shadows.has(element.shadowRoot)) {
            const style = document.createElement("style");
            style.textContent = T.engineCSS(this.profile);
            this.shadows.set(element.shadowRoot, style);
            element.shadowRoot.append(style);
          }
          stack.push(...element.shadowRoot.children);
        }
        stack.push(...element.children);
        // Generated icons can live on empty elements and inherit typography from
        // a styled label. Protect them even when this element has no text node.
        this.protectPseudo(element, "before");
        this.protectPseudo(element, "after");
        if (!text && !["INPUT", "SELECT", "BUTTON", "OPTION"].includes(tag)) continue;
        if (this.profile.target === "reading" && !element.closest("article, main, [role='main'], p, h1, h2, h3, h4, h5, h6, blockquote, li, dd, dt")) continue;
        const style = getComputedStyle(element);
        if (iconFont.test(style.fontFamily)) { this.keep(element, style); continue; }
        this.mark(element, "data-typewell-text");
        this.variable(element, "--typewell-size", style.fontSize);
      }
    }
    observe() {
      if (!this.profile) return;
      const options = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "contenteditable", "role"] };
      this.observer.observe(document, options);
      for (const root of this.shadows.keys()) this.observer.observe(root, options);
    }
    refresh() {
      this.timer = null;
      if (!this.profile) return;
      this.observer.disconnect();
      this.deactivate();
      // Read original computed sizes with all overrides temporarily inactive. This prevents
      // repeatedly scaling inherited text when a site inserts new children into styled text.
      const roots = [...this.pending].filter(node => node && (node.isConnected || node === document));
      this.pending.clear();
      const unique = roots.filter((node, index) => !roots.some((other, otherIndex) => otherIndex !== index && other !== node && other.contains?.(node)));
      for (const [element, record] of this.records) {
        if (!element.isConnected || unique.some(root => root === element || root.contains?.(element))) {
          this.restoreElement(element, record);
          this.records.delete(element);
        }
      }
      for (const [root, style] of this.shadows) {
        if (!root.host.isConnected) { style.remove(); this.shadows.delete(root); }
      }
      for (const root of unique) this.scan(root);
      this.activate();
      this.observe();
    }
    async loadFont(profile) {
      const font = T.fontById[profile.fontId];
      if (!font?.bundled) return;
      if (!this.faces.has(font.id)) {
        const promise = (async () => {
          const response = await fetch(this.resourceURL(font.file));
          if (!response.ok) throw new Error(`Could not load ${font.name}. Reload the extension and try again.`);
          // Binary FontFace avoids a site's font-src CSP blocking bundled extension fonts.
          const face = new FontFace(font.family, await response.arrayBuffer(), { weight: "400", style: "normal" });
          await face.load();
          document.fonts.add(face);
          return face;
        })();
        this.faces.set(font.id, promise);
        promise.catch(() => this.faces.delete(font.id));
      }
      await this.faces.get(font.id);
    }
    async apply(profile, host = null) {
      if (profile) await this.loadFont(profile);
      this.observer.disconnect();
      clearTimeout(this.timer); this.timer = null; this.pending.clear();
      if (this.profile) await this.requestStyle(this.profile, null);
      for (const [element, record] of this.records) this.restoreElement(element, record);
      this.records.clear();
      for (const style of this.shadows.values()) style.remove();
      this.shadows.clear();
      this.profile = profile;
      this.host = host;
      if (!profile) return;
      try {
        this.scan(document);
        this.activate();
        await this.requestStyle(null, profile);
        this.observe();
      } catch (error) {
        for (const [element, record] of this.records) this.restoreElement(element, record);
        this.records.clear();
        for (const style of this.shadows.values()) style.remove();
        this.shadows.clear(); this.profile = null;
        throw error;
      }
    }
  }
  T.FontEngine = FontEngine;
})();
