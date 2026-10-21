/* Jobs dashboard widget.
 *
 * Mount on any page with:
 *   <link rel="stylesheet" href="assets/css/jobs-dashboard.css">
 *   <div class="jd" data-src="assets/data/dashboard-data.json"></div>
 *   <script src="assets/vendor/d3.min.js"></script>          (D3 7.9.0)
 *   <script src="assets/vendor/d3-sankey.min.js"></script>   (d3-sankey 0.12.3)
 *   <script src="assets/js/jobs-dashboard.js" defer></script>
 *
 * The data file holds every number and name the page shows; this file only
 * draws it. One selection drives every view: a job family
 * (toggled with its pill or on the ring), plus the job type, and optionally
 * the job flavour, whose profile is shown below. The top zone always shows
 * everything and only highlights the selection. A second, lighter channel
 * carries the hover: whatever is under the pointer (a family, job type or
 * flavour, on any view) is named in the ring's centre and lit on every view.
 *
 * Page order: hero, numbers, ring + job map (40% of the window height), the
 * family band, then the profile. The job-type tree opens in a window from
 * the link under the ring.
 *
 * Colour: everything inactive is alice blue; the active family is royal
 * orchid (its job types and flavours in lighter orchid steps); the job type
 * whose profile is open is outlined in dark orchid.
 *
 * <div class="jd" data-default-family="..."> picks the family selected on
 * load (by name or id); otherwise DEFAULT_FAMILY, then the largest family.
 */
(function () {
  "use strict";

  const ORCHID = "#9525AA", ORCHID_DARK = "#761C87", ALICE = "#D9E2EC";
  const MUTE = "#B9C6D3";   // inactive map dots: alice blue a step darker, to stay visible on white
  const orchidStep = (t) => d3.interpolateRgb(ORCHID, "#FFFFFF")(t);   // t = 0 orchid ... 1 white
  const MAP_ROTATION = 45;   // degrees clockwise applied to the job map (layout choice only)
  const fmt = (n) => n.toLocaleString("en-US");
  const pct = (x) => `${Math.round(x)}%`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const humanize = (slug) => { const t = String(slug || "unspecified").replace(/-/g, " "); return t[0].toUpperCase() + t.slice(1); };
  // split a name into lines of at most `max` characters, at word breaks
  function wrapWords(s, max) {
    const lines = [""];
    String(s).split(" ").forEach((wd) => { const t = lines[lines.length - 1]; if (t && (t + " " + wd).length > max) lines.push(wd); else lines[lines.length - 1] = t ? `${t} ${wd}` : wd; });
    return lines;
  }

  // short one-line labels for the family pills only, to keep the pill column
  // quiet; every other view, and the pill's accessible name and tooltip, use the
  // family's full name. Keyed by full name; a family not listed shows its full name.
  const PILL_LABELS = {
    "ML Platform & GenAI Engineering": "Gen-AI engineering",
    "Genomics & Computational Biology Research": "Genomics/CompBio",
    "Clinical Research & Medical Affairs Leadership": "Clinical research",
    "Lab-Based Assay & Disease Model Research": "Wetlab-based",
    "Generative ML for Biomolecular Design": "Biomolecular design",
    "Real-World & Clinical Data Science": "Clinical data science",
    "Specialist roles": "Specialist roles",
  };
  const pillLabel = (name) => PILL_LABELS[name] || name;
  // the family selected when the page opens (its pill also comes first), unless
  // the page's <div class="jd" data-default-family="..."> names another
  const DEFAULT_FAMILY = "Genomics & Computational Biology Research";
  const N_EMP_PILLS = 5;   // top employers shown on the profile; "Show more" opens the full top 10

  // line icons for the profile's facts card (24px grid, drawn in currentColor)
  const icon = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const ICONS = {
    seniority: icon(`<path d="M3 20h4v-4h4v-4h4V8h4V4h2"/>`),   // steps
    sector: icon(`<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>`),   // buildings
    seeker: icon(`<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>`),   // magnifier
    educator: icon(`<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>`),   // mortarboard
    hiring: icon(`<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>`),   // briefcase
    title: icon(`<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1"/>`),   // tag
  };

  // centre a chart's drawing within its viewBox width (w), so the space left and
  // right of it is equal; a drawing wider than w is scaled down to fit
  function centreDrawing(svg, w, pad = 8) {
    const n = svg.node(), g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    while (n.firstChild) g.appendChild(n.firstChild);
    n.appendChild(g);
    const b = g.getBBox();
    if (!b.width) return;
    const k = Math.min(1, (w - 2 * pad) / b.width);
    g.setAttribute("transform", `translate(${(w - k * b.width) / 2 - k * b.x},0) scale(${k})`);
  }

  function el(tag, attrs = {}, html = "") {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (html) n.innerHTML = html;
    return n;
  }

  // ---------------------------------------------------------------- tooltip
  function makeTip(root) {
    const tip = el("div", { class: "jd-tip", role: "tooltip" });
    root.appendChild(tip);
    return {
      show(html, event) {
        tip.innerHTML = html;
        tip.classList.add("is-on");
        const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
        let x = event.clientX + pad, y = event.clientY + pad;
        if (x + w > window.innerWidth - 8) x = event.clientX - w - pad;
        if (y + h > window.innerHeight - 8) y = event.clientY - h - pad;
        tip.style.left = `${x}px`; tip.style.top = `${y}px`;
      },
      hide() { tip.classList.remove("is-on"); },
    };
  }

  function band(parent, cls = "") {
    const b = el("section", { class: `jd-band ${cls}` });
    const inner = el("div", { class: "jd-band-inner" });
    b.appendChild(inner);
    parent.appendChild(b);
    return inner;
  }

  // ---------------------------------------------------------------- app
  class Dashboard {
    constructor(root, data) {
      this.root = root;
      this.d = data;
      this.jt = new Map(data.job_types.map((j) => [j.id, j]));
      this.fl = new Map(data.flavours.map((f) => [f.id, f]));
      this.fam = new Map(data.families.map((f) => [f.id, f]));
      this.listeners = [];
      this.hoverListeners = [];
      this.hovered = null;   // { kind: "family" | "job" | "flavour", id } under the pointer, or null
      // the family selected on landing: data-default-family, else DEFAULT_FAMILY,
      // else the largest family
      const pick = (v) => { const w = String(v || "").trim().toLowerCase(); return w && data.families.find((f) => f.id.toLowerCase() === w || f.name.toLowerCase() === w); };
      const fam0 = pick(root.dataset.defaultFamily) || pick(DEFAULT_FAMILY)
        || [...data.families].sort((a, b) => b.n_postings - a.n_postings)[0];
      this.defaultFamily = fam0.id;
      // focus: the item last clicked (family, job type or flavour); null until the first click
      this.state = { family: fam0.id, jobType: this.largestJob(fam0.id), flavour: null, focus: null };
      this.tip = makeTip(root);
    }

    largestJob(familyId) {
      return [...this.fam.get(familyId).job_type_ids].sort((a, b) => this.jt.get(b).n_postings - this.jt.get(a).n_postings)[0];
    }

    // a job type (and flavour): its family becomes the active family
    select(jobType, flavour = null) {
      if (!this.jt.has(jobType)) return;
      const fl = flavour && this.fl.has(flavour) ? flavour : null;
      this.state = { family: this.jt.get(jobType).family_id, jobType, flavour: fl, focus: fl ? { kind: "flavour", id: fl } : { kind: "job", id: jobType } };
      this.listeners.forEach((fn) => fn(this.state));
    }
    // a family: the profile below shows its largest job type
    selectFamily(familyId) {
      if (!this.fam.has(familyId)) return;
      this.state = { family: familyId, jobType: this.largestJob(familyId), flavour: null, focus: { kind: "family", id: familyId } };
      this.listeners.forEach((fn) => fn(this.state));
    }
    onSelect(fn) { this.listeners.push(fn); fn(this.state); }

    // the hover channel. Leaving one mark for the next fires leave then enter, so
    // clearing waits a moment and the ring's centre label doesn't flicker.
    hover(h) {
      clearTimeout(this.hoverTimer);
      if (!h) { this.hoverTimer = setTimeout(() => this.setHover(null), 80); return; }
      this.setHover(h);
    }
    setHover(h) {
      const same = (a, b) => (a && b) ? a.kind === b.kind && a.id === b.id : a === b;
      if (same(h, this.hovered)) return;
      this.hovered = h;
      this.hoverListeners.forEach((fn) => fn(h));
    }
    onHover(fn) { this.hoverListeners.push(fn); }
    // what the views name and light: the hovered item, else the one last clicked,
    // which stays until the next click
    get shown() { return this.hovered || this.state.focus; }
    // does the hovered item cover this job type (and flavour)?
    hits(h, jobId, flavourId = null) {
      if (!h) return false;
      if (h.kind === "family") return this.jt.get(jobId).family_id === h.id;
      if (h.kind === "job") return jobId === h.id;
      return flavourId === h.id;
    }
    hoverInfo(h) {
      const total = this.d.meta.n_postings;
      if (h.kind === "family") { const f = this.fam.get(h.id); return { level: "Job family", name: f.name, n: f.n_postings, share: 100 * f.n_postings / total }; }
      if (h.kind === "job") { const j = this.jt.get(h.id); return { level: "Job type", name: j.name, n: j.n_postings, share: 100 * j.n_postings / total }; }
      const k = this.fl.get(h.id);
      return { level: "Job flavour", name: k.is_residual ? "General" : k.short_name, n: k.n_postings, share: 100 * k.n_postings / total };
    }

    render() {
      const r = this.root;
      r.innerHTML = "";
      // a redraw (on resize) starts the views afresh; the selection and focus carry over
      this.listeners = [];
      this.hoverListeners = [];
      this.hovered = null;
      // bands: deep-blue hero -> numbers -> highlight -> ring + map -> alice family band -> profile -> deep-blue "how can it help me"
      this.renderThesis(band(r, "jd-band--ink jd-hero"));
      this.renderFacts(band(r, "jd-band--facts"));
      this.renderHighlight(band(r, "jd-band--highlight"));
      this.renderPair(band(r, "jd-band--pair"));
      this.renderFamilyBand(band(r, "jd-band--fam"));
      const prof = band(r, "jd-band--profile");
      prof.id = "jd-profile";
      this.renderBar(prof);
      this.renderCard(prof);
      this.renderHelp(band(r, "jd-band--ink jd-band--help"));
      this.tip.hide();
    }

    // ---------- opening statement: the finding the data supports most strongly
    renderThesis(r) {
      const m = this.d.meta;
      const inner = el("div", { class: "jd-hero-inner" });
      inner.innerHTML = `<p class="jd-eyebrow jd-hero-eyebrow">The Atlas of Bioinformatics Professions</p>
        <h2>What is a <em>bioinformatician</em>?</h2>
        <div class="jd-hero-side">
          <p class="jd-hero-sub">We read ${fmt(m.n_postings)} life sciences job postings and grouped them by what they ask people to do. Explore a snapshot of the job profiles including their top duties, skills, and tools, and view who's hiring for those roles around the world.</p>
        </div>`;
      r.appendChild(inner);
    }

    // ---------- closing band: how the atlas helps three kinds of reader, each a
    // panel that unfolds into what we offer and a "Contact us" button (the
    // contact form, opened in a new tab).
    renderHelp(r) {
      const m = this.d.meta;
      const CONTACT_URL = "https://tally.so/r/Ar721B";   // the contact form, the same for every panel
      const panels = [
        ["seeker", "I am a job seeker", [
          "See where your CV falls based on your specific skills and experience.",
          "Learn what alternative careers you could transition into and the skills you’d need.",
          "Get a list of employers that hire for your specific profiles.",
        ]],
        ["educator", "I am an educator", [
          "Identify gaps in your life sciences curriculum based on current market data.",
          "Decide what AI/ML skills are worth incorporating in your programming.",
          "Remain competitive by increasing the job-readiness of your graduates.",
        ]],
        ["hiring", "I am hiring", [
          "Tailor job descriptions to reach the right talent.",
          "Identify the relevant skills and tools for a specific role and cut the noise.",
        ]],
      ];
      const box = el("div", { class: "jd-help" });
      box.innerHTML = `<h2>How can The Atlas of Bioinformatics Professions help me?</h2>
        <p class="jd-help-lede">The full atlas contains ${fmt(m.n_duties)} job duties, ${fmt(m.n_skills)} different skills, and ${fmt(m.n_tool_categories)} tool categories, including ${fmt(m.n_languages)} programming languages and ${fmt(m.n_assays)} wet-lab assays. Job postings span ${fmt(m.n_countries)} countries and ${fmt(m.n_employers)} employers.</p>
        <div class="jd-help-panels">${panels.map(([icon, title, offers]) => `<details class="jd-help-panel">
            <summary><span class="jd-help-icon">${ICONS[icon]}</span><span class="jd-help-title">${title}</span><span class="jd-help-toggle" aria-hidden="true"></span></summary>
            <div class="jd-help-body">
              <p>With our atlas, we can help you:</p>
              <ul>${offers.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>
              <a class="jd-btn" href="${CONTACT_URL}" target="_blank" rel="noopener">Contact us</a>
            </div>
          </details>`).join("")}</div>`;
      r.appendChild(box);
      // the tallest panel's open body, measured with every panel open for a moment.
      // Remeasured whenever a panel opens (so a measure taken before the web fonts
      // arrived never sticks), once the fonts have loaded, and on resize.
      const ds = [...box.querySelectorAll(".jd-help-panel")];
      let measuring = false;
      const fit = () => {
        if (measuring || !box.isConnected) return;
        measuring = true;
        const was = ds.map((d) => d.open);
        box.style.removeProperty("--jd-help-h");
        ds.forEach((d) => { d.open = true; });
        const h = Math.max(...ds.map((d) => d.querySelector(".jd-help-body").scrollHeight));
        ds.forEach((d, i) => { d.open = was[i]; });
        box.style.setProperty("--jd-help-h", `${h}px`);
        // toggle events from the open/close above fire after this; let them pass
        setTimeout(() => { measuring = false; }, 0);
      };
      fit();
      ds.forEach((d) => d.addEventListener("toggle", () => { if (d.open) fit(); }));
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
      if (window.ResizeObserver) new ResizeObserver(fit).observe(box.querySelector(".jd-help-panels"));
    }

    // ---------- the highlight: the key finding, in large centred type across the
    // numbers row's width, right after the numbers
    renderHighlight(r) {
      const q = el("blockquote", { class: "jd-highlight" });
      q.innerHTML = `<p>The data shows <b>clear professional specializations</b>.<br>Half of them require ML/AI and engineering skills<br>that <b>job seekers aren’t being trained on</b>.</p>`;
      r.appendChild(q);
    }

    // ---------- the headline numbers: a banner right below the hero
    renderFacts(r) {
      const m = this.d.meta, spec = this.fam.get("S");
      const items = [
        [m.n_postings, "job postings"], [m.n_employers, "employers"],
        [m.n_families - (spec ? 1 : 0), "job families"], [m.n_job_types, "job types"],
        [spec ? spec.job_type_ids.length : 0, "specialist jobs"], [m.n_flavours, "job flavours"],
      ];
      const ul = el("ul", { class: "jd-facts", "aria-label": "The dataset in numbers" });
      ul.innerHTML = items.map(([n, label]) => `<li><b>${fmt(n)}</b>${label}</li>`).join("");
      r.appendChild(ul);
    }

    // ---------- family pills, ring and job map side by side (widths 2:4:4) and compact,
    // so the top of the profile shows below them: the family pills down the left
    // with "View this as a tree" under them, then the two charts (no headings)
    renderPair(top) {
      const pair = el("div", { class: "jd-pair" });
      pair.innerHTML = `
        <div class="jd-chart jd-pa-rc"></div>
        <div class="jd-chart jd-pa-mc"></div>
        <div class="jd-pa-lg"></div>`;
      top.appendChild(pair);
      this.renderRing(pair.querySelector(".jd-pa-rc"), pair.querySelector(".jd-pa-lg"));
      this.renderTreeLink(pair);   // left-aligned under the pills
      this.alignToRing(pair.querySelector(".jd-pa-lg"), pair.querySelector(".jd-pa-rc"));
      // the map fills the row beside the ring: its drawing is as wide as its box
      const mc = pair.querySelector(".jd-pa-mc");
      const aspect = mc.clientHeight ? Math.max(1, mc.clientWidth / mc.clientHeight) : 1;
      this.renderMap(null, { box: mc, w: Math.round(460 * aspect), h: 460 });
      this.spreadPair(pair);
    }

    // equal visible gaps between the three columns, measured on what is drawn
    // (pills, ring, map dots) rather than the boxes, whose drawings sit inset by
    // different amounts: the ring is slid sideways to sit midway between the
    // widest pill and the map's leftmost dots. Any pill wider than its column
    // (one numbers-banner column) gets a smaller font until it fits. Redone
    // whenever the row changes size.
    spreadPair(pair) {
      const lg = pair.querySelector(".jd-pa-lg"), rc = pair.querySelector(".jd-pa-rc"), mc = pair.querySelector(".jd-pa-mc");
      const fit = () => {
        if (!pair.isConnected) return;
        const colRight = lg.getBoundingClientRect().right;
        lg.querySelectorAll("button.jd-fpill").forEach((b) => {
          b.style.fontSize = "";
          const base = parseFloat(getComputedStyle(b).fontSize);
          for (let k = 0.97; b.getBoundingClientRect().right > colRight && k > 0.6; k -= 0.03) b.style.fontSize = `${base * k}px`;
        });
        rc.style.left = "0px";
        const dotsG = mc.querySelector("circle") && mc.querySelector("circle").parentNode;
        if (!dotsG) return;
        const a = Math.max(...[...lg.querySelectorAll("button.jd-fpill")].map((b) => b.getBoundingClientRect().right));
        const ring = this.ringArcs.node.getBoundingClientRect(), d = dotsG.getBoundingClientRect().left;
        rc.style.left = `${(a + d) / 2 - (ring.left + ring.right) / 2}px`;
      };
      fit();
      if (window.ResizeObserver) new ResizeObserver(fit).observe(pair);
    }

    // the pill column runs from the ring's drawn top edge to its drawn bottom edge
    // (the ring's top and bottom segments don't always reach its square box), so
    // the eyebrow sits level with the ring's top and the link with its bottom;
    // re-measured whenever the ring's box changes size
    alignToRing(col, ringBox) {
      const fit = () => {
        const { node, size, R } = this.ringArcs, svg = ringBox.querySelector("svg");
        if (!node.isConnected || !svg) return;
        const b = node.getBBox(), k = svg.getBoundingClientRect().height / size;
        col.style.setProperty("--jd-ring-top", `${(b.y + R) * k}px`);
        col.style.setProperty("--jd-ring-bottom", `${(R - b.y - b.height) * k}px`);
      };
      fit();
      if (window.ResizeObserver) new ResizeObserver(fit).observe(ringBox);
    }

    renderRing(box, legendBox) {
      const size = 460, R = size / 2;
      const tree = { name: "All", children: this.d.families.map((f) => ({
        id: f.id, kind: "family", name: f.name,
        children: f.job_type_ids.map((jid) => {
          const j = this.jt.get(jid);
          const kids = j.flavour_ids.map((fid) => this.fl.get(fid));
          return { id: jid, kind: "job", name: j.name, value: kids.length ? undefined : j.n_postings,
            children: kids.length ? kids.map((k) => ({ id: k.id, kind: "flavour", parent: jid, name: k.short_name, value: k.n_postings })) : undefined };
        }),
      })) };
      const root = d3.hierarchy(tree).sum((d) => d.value || 0);
      d3.partition().size([2 * Math.PI, R])(root);
      // ring edges as fractions of the radius: centre hole 0.6 (room for the hover
      // label), families 0.175, job types 0.125, flavours 0.1
      const ringR = [0, 0.6, 0.775, 0.9, 1.0].map((t) => t * R);
      const arc = d3.arc()
        .startAngle((d) => d.x0).endAngle((d) => d.x1)
        .padAngle(0.004).padRadius(R)
        .innerRadius((d) => ringR[d.depth]).outerRadius((d) => ringR[d.depth + 1] - 2)
        .cornerRadius(2);
      const svg = d3.select(box).append("svg").attr("viewBox", [-R, -R, size, size])
        .attr("role", "img").attr("aria-label", "Ring chart of job families, job types and job flavours");
      const nodes = root.descendants().filter((d) => d.depth > 0);
      const arcs = svg.append("g");
      this.ringArcs = { node: arcs.node(), size, R };
      const paths = arcs.selectAll("path").data(nodes).join("path")
        .attr("class", "jd-arc").attr("d", arc)
        .attr("stroke", "#fff").attr("stroke-width", 1)
        .on("click", (e, d) => this.selectNode(d))
        .on("mouseenter", (e, d) => this.hover({ kind: d.data.kind, id: d.data.id }))
        .on("mouseleave", () => this.hover(null));
      const markers = svg.append("g").style("pointer-events", "none");
      // the centre: an invitation to explore, or the name of whatever is hovered on any view
      const center = svg.append("g").style("pointer-events", "none");
      const drawCentre = (h) => {
        center.selectAll("*").remove();
        const line = (y, cls, size, text) => center.append("text").attr("class", `jd-ring-center ${cls}`).attr("y", y).style("font-size", `${size}px`).text(text);
        // sized to fill the centre hole (radius 0.6 of the ring)
        if (!h) {
          // nothing hovered or clicked yet: the invitation fills the centre hole
          ["Hover", "the ring", "to explore"].forEach((ln, i) => line((i - 1) * 46, "jd-ring-name", 38, ln));
          return;
        }
        const info = this.hoverInfo(h), lines = wrapWords(info.name, 16);
        const size = lines.length > 3 ? 25 : 29, lh = size * 1.15;
        const y0 = -(lines.length * lh + 56) / 2;   // the block: eyebrow, name lines, count
        line(y0 + 9, "jd-ring-eyebrow", 17, info.level.toUpperCase());
        lines.forEach((ln, i) => line(y0 + 42 + i * lh, "jd-ring-name", size, ln));
        line(y0 + 42 + lines.length * lh + 10, "jd-ring-sub", 21, `${fmt(info.n)} job postings · ${pct(info.share)}`);
      };
      // the family pills: the toggles (identity is never colour alone)
      const legend = el("ul", { class: "jd-legend", "aria-label": "Job families: choose one" });
      // the landing family's pill first, then the rest in the data's order
      const famOrder = [this.fam.get(this.defaultFamily), ...this.d.families.filter((f) => f.id !== this.defaultFamily)];
      legend.innerHTML = famOrder.map((f) => `<li><button type="button" class="jd-tag jd-fpill" data-fam="${f.id}" aria-pressed="false" aria-label="${esc(f.name)}" title="${esc(f.name)}">${esc(pillLabel(f.name))}</button></li>`).join("");
      legendBox.insertAdjacentHTML("beforeend", `<p class="jd-eyebrow jd-eyebrow--sm">Explore families</p>`);
      legendBox.appendChild(legend);
      legend.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => this.selectFamily(b.dataset.fam)));
      legend.querySelectorAll("button").forEach((b) => {
        b.addEventListener("mouseenter", () => this.hover({ kind: "family", id: b.dataset.fam }));
        b.addEventListener("mouseleave", () => this.hover(null));
      });
      const famOf = (d) => d.ancestors().find((a) => a.depth === 1).data.id;
      // one paint for both channels: the selection colours, the hover lights a path
      const paint = () => {
        const { family, jobType, flavour } = this.state, h = this.shown;
        legend.querySelectorAll("button").forEach((b) => {
          const on = b.dataset.fam === family;
          b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on));
          b.classList.toggle("is-hover", !!h && h.kind === "family" && h.id === b.dataset.fam);
        });
        // hovered: the item, everything inside it and the path back to the centre stay; the rest fades
        const hn = h && nodes.find((d) => d.data.kind === h.kind && d.data.id === h.id);
        const lit = hn ? new Set([...hn.ancestors(), ...hn.descendants()]) : null;
        // active family: orchid, its job types and flavours in lighter steps; the rest alice blue
        // (a step darker where hovered, so it stands out from the faded alice around it)
        paths.attr("fill", (d) => famOf(d) === family ? orchidStep([0, 0.3, 0.55][d.depth - 1]) : lit && lit.has(d) ? MUTE : ALICE)
          .attr("fill-opacity", (d) => lit && !lit.has(d) ? 0.35 : 1);
        drawCentre(h);
        // the job type (or flavour) whose profile is open: a dark orchid outline
        const open = (d) => (d.depth === 2 && d.data.id === jobType && !flavour) || (d.depth === 3 && d.data.id === flavour);
        paths.attr("stroke", (d) => open(d) ? ORCHID_DARK : "#fff").attr("stroke-width", (d) => open(d) ? 3 : 1);
        paths.filter(open).raise();
        // the same numbered markers as on the job map, on the active family's job types
        const order = this.fam.get(family).job_type_ids;
        const jobs = nodes.filter((d) => d.depth === 2 && famOf(d) === family);
        const m = markers.selectAll("g").data(jobs, (d) => d.data.id).join((enter) => {
          const g = enter.append("g");
          g.append("circle").attr("r", 9).attr("fill", "var(--jd-ink)").attr("stroke", "#fff").attr("stroke-width", 1.5);
          g.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").attr("fill", "#fff")
            .style("font-family", "var(--jd-display)").style("font-weight", 700).style("font-size", "11px");
          return g;
        });
        m.attr("transform", (d) => { const [cx, cy] = arc.centroid(d); return `translate(${cx},${cy})`; })
          .select("text").text((d) => order.indexOf(d.data.id) + 1);
        // like the arcs: outside the shown item's path, the numbers fade (as on the map)
        m.attr("opacity", (d) => lit && !lit.has(d) ? 0.25 : 1);
        markers.raise();
      };
      this.onSelect(paint);
      this.onHover(paint);
    }
    selectNode(d) {
      if (d.data.kind === "job") this.select(d.data.id);
      else if (d.data.kind === "flavour") this.select(d.data.parent, d.data.id);
      else this.selectFamily(d.data.id);
    }
    // ---------- job map: every posting, the selected job type lit
    renderMap(view, { box = view.querySelector(".jd-chart"), w = 520, h = 460, small = false } = {}) {
      const P = this.d.points;   // anonymous positions only: the data file holds no per-ad details
      // the map is turned MAP_ROTATION degrees clockwise from UMAP's layout; a UMAP's
      // orientation carries no meaning, only who is next to whom
      const t = (MAP_ROTATION * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
      const rx = (px, py) => px * cos + py * sin, ry = (px, py) => -px * sin + py * cos;
      const x = d3.scaleLinear().domain(d3.extent(P, (p) => rx(p.x, p.y))).nice().range([12, w - 12]);
      const y = d3.scaleLinear().domain(d3.extent(P, (p) => ry(p.x, p.y))).nice().range([h - 12, 12]);
      const svg = d3.select(box).append("svg").attr("viewBox", [0, 0, w, h])
        .attr("preserveAspectRatio", "xMidYMin meet")   // pinned to the top of its box, level with the ring
        .attr("role", "img").attr("aria-label", small ? "Where this job type sits on the job map" : "Map of all job postings; similar postings sit close together");
      svg.append("rect").attr("width", w).attr("height", h).attr("rx", 8).attr("fill", "var(--jd-white)");
      const dots = svg.append("g").selectAll("circle").data(P).join("circle")
        .attr("class", small ? "" : "jd-dot").attr("cx", (p) => x(rx(p.x, p.y))).attr("cy", (p) => y(ry(p.x, p.y)))
        .attr("r", small ? 1.6 : 3.2);
      const labels = svg.append("g");
      const sx = (p) => x(rx(p.x, p.y)), sy = (p) => y(ry(p.x, p.y));
      if (!small) {
        dots.on("mousemove", (e, p) => this.tip.show(`<b>${esc(this.jt.get(p.job_type_id).name)}</b>${p.flavour_id ? `<div class="jd-tip-sub">${esc(this.fl.get(p.flavour_id).short_name)}</div>` : ""}<div class="jd-tip-sub">Click to see its profile</div>`, e))
          .on("mouseenter", (e, p) => this.hover({ kind: "job", id: p.job_type_id }))
          .on("mouseleave", () => { this.tip.hide(); this.hover(null); })
          .on("click", (e, p) => this.select(p.job_type_id));
      }
      if (small) return { dots, sx, sy };
      // selection: the active family in orchid; hover: whatever is hovered in dark orchid, on top
      const paint = () => {
        const { family } = this.state, h = this.shown;
        const on = (p) => this.jt.get(p.job_type_id).family_id === family;
        const hov = (p) => this.hits(h, p.job_type_id, p.flavour_id);
        dots.attr("fill", (p) => hov(p) ? ORCHID_DARK : on(p) ? ORCHID : MUTE)
          .attr("fill-opacity", (p) => hov(p) ? 1 : on(p) ? (h ? 0.3 : 0.85) : 0.45)
          .attr("stroke", (p) => hov(p) || on(p) ? "#fff" : "none").attr("stroke-width", 0.8);
        dots.filter(on).raise();
        if (h) dots.filter(hov).raise();
        // a job type or flavour shown: the other job types' numbered markers fade
        const own = (d) => !h || h.kind === "family" || this.hits(h, d.j.id) || (h.kind === "flavour" && d.j.flavour_ids.includes(h.id));
        labels.selectAll("g").attr("opacity", (d) => own(d) ? 1 : 0.25);
        labels.raise();
      };
      this.onSelect(({ family }) => { this.mapLabels(labels, this.fam.get(family), P, sx, sy); paint(); });
      this.onHover(paint);
    }

    // the active family's job types: a numbered marker at the centre of each one's ads,
    // the same numbers as on the ring (hovering either names it in the ring's centre).
    // Flavours split a job type by tools while the map is laid out by duties and skills,
    // so flavours have no place of their own on the map.
    mapLabels(g, fam, P, sx, sy) {
      const items = fam.job_type_ids.map((jid, i) => {
        const j = this.jt.get(jid), pts = P.filter((p) => p.job_type_id === jid);
        return { j, n: i + 1, x: d3.median(pts, sx), y: d3.median(pts, sy) };
      });
      g.selectAll("*").remove();
      const m = g.selectAll("g").data(items).join("g").attr("transform", (d) => `translate(${d.x},${d.y})`)
        .style("cursor", "pointer").on("click", (e, d) => this.select(d.j.id))
        .on("mouseenter", (e, d) => this.hover({ kind: "job", id: d.j.id }))
        .on("mouseleave", () => this.hover(null));
      m.append("circle").attr("r", 9).attr("fill", "var(--jd-ink)").attr("stroke", "#fff").attr("stroke-width", 1.5);
      m.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").attr("fill", "#fff")
        .style("font-family", "var(--jd-display)").style("font-weight", 700).style("font-size", "11px").text((d) => d.n);
      g.raise();
    }

    // ---------- dendrogram: the job-type tree the families are cut from. "View
    // this as a tree", a link under the family pills, opens it in a window as a
    // still picture in the families' own colours (the data file's family colours), not
    // the selection colours. Each job type is a leaf; its job flavours fan out in
    // a column to the right of its name (flavours are not part of the tree: they
    // split its ads by tools).
    renderTreeLink(box) {
      // job variants: the tree's end points, i.e. each flavour, plus each job type that doesn't split
      const nVariants = this.d.job_types.reduce((n, j) => n + Math.max(1, j.flavour_ids.length), 0);
      const link = el("button", { type: "button", class: "jd-howto jd-treelink", "aria-haspopup": "dialog" }, "View this as a tree");
      box.appendChild(link);
      const dlg = el("dialog", { class: "jd-modal jd-modal--wide", "aria-labelledby": "jd-tree-modal-h" });
      dlg.innerHTML = `<div class="jd-modal-inner">
          <div class="jd-modal-head">
            <h3 id="jd-tree-modal-h">The atlas of bioinformatics professions</h3>
            <button type="button" class="jd-modal-close" aria-label="Close">&times;</button>
          </div>
          <p class="jd-modal-sum">The tree contains a total of ${fmt(nVariants)} different job variants. First level are job families, second level are job profiles, and third level are job flavors. First and second level groups are based on normalized job duties and skills. Third level flavors are sub groups of jobs requiring specific tools.</p>
          <div class="jd-tree-full jd-scroll"></div>
        </div>`;
      this.root.appendChild(dlg);
      dlg.querySelector(".jd-modal-close").addEventListener("click", () => dlg.close());
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
      const body = dlg.querySelector(".jd-tree-full");
      link.addEventListener("click", () => {
        dlg.showModal();   // drawn once open, so the pills can be measured
        if (!body.firstChild) this.drawTree(body);
      });
    }
    drawTree(box) {
      const root = d3.hierarchy(this.d.tree, (n) => n.children);
      const leaves = root.leaves();
      // a column on the left holds the family pills, joined to their branch points by dashed lines
      const pillCol = 175;
      const rowH = 20, w = 1240 + pillCol, treeL = 8 + pillCol, treeR = 420 + pillCol, labelX = treeR + 14;
      const fanX = labelX + 390, flavourX = fanX + 40;
      const famOf = (j) => this.fam.get(j.family_id);
      const GREY = MUTE;   // branches that join different families
      // each job type takes as many rows as it has flavours (one if it has none),
      // its name centred on them and the flavours listed to its right
      let row = 0;
      const rows = [];
      leaves.forEach((lf) => {
        const j = this.jt.get(lf.data.job_type_id), n = Math.max(1, j.flavour_ids.length);
        lf.j = j; lf.y = (row + n / 2) * rowH;
        rows.push({ kind: "job", j, y: lf.y });
        j.flavour_ids.forEach((fid, i) => rows.push({ kind: "flavour", j, f: this.fl.get(fid), y: (row + i + 0.5) * rowH }));
        row += n;
      });
      const h = row * rowH + 4;
      const xs = d3.scaleLinear().domain([root.data.height, 0]).range([treeL, treeR]);
      root.eachAfter((n) => {
        n.x = n.children ? xs(n.data.height) : treeR;
        if (n.children) n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2;
        // a branch belongs to a family when all its job types do
        const fams = new Set(n.leaves().map((l) => this.jt.get(l.data.job_type_id).family_id));
        n.family = fams.size === 1 ? [...fams][0] : null;
      });
      const col = (famId) => famId ? this.fam.get(famId).color : GREY;
      const svg = d3.select(box).append("svg").attr("viewBox", [0, 0, w, h]).attr("class", "jd-still")
        .attr("role", "img").attr("aria-label", "Tree of how the job types are related, with their job flavours, coloured by job family");
      const elbow = (l) => `M${l.source.x},${l.source.y}V${l.target.y}H${l.target.x}`;
      // every branch inside a family is in that family's colour; joins between families are grey
      const links = root.links().sort((a, b) => !!a.target.family - !!b.target.family);
      svg.append("g").selectAll("path").data(links).join("path")
        .attr("d", elbow).attr("fill", "none").attr("stroke-width", 2).attr("stroke-linejoin", "round")
        .attr("stroke", (l) => col(l.target.family));
      // fan lines from the end of the job type's name column to each of its flavours
      svg.append("g").selectAll("path").data(rows.filter((r) => r.kind === "flavour")).join("path")
        .attr("d", (r) => { const y0 = leaves.find((l) => l.j === r.j).y; return `M${fanX},${y0}C${fanX + 20},${y0} ${fanX + 14},${r.y} ${flavourX - 6},${r.y}`; })
        .attr("fill", "none").attr("stroke-width", 1.2).attr("stroke", (r) => famOf(r.j).color);
      svg.append("g").selectAll("circle").data(leaves).join("circle")
        .attr("cx", treeR).attr("cy", (l) => l.y).attr("r", 4).attr("fill", (l) => famOf(l.j).color);
      // each family's branch point carries its short pill name (as on the family
      // pills), in the family's tag colours: the pills line up in the left column,
      // each joined to its branch point by a dashed line. Specialist roles has no
      // branch of its own (its job types are single leaves spread over the tree),
      // so it gets none; its leaves carry its colour.
      const famRoots = root.descendants().filter((n) => n.children && n.family && (!n.parent || n.parent.family !== n.family));
      svg.append("g").selectAll("line").data(famRoots).join("line")
        .attr("x1", 8).attr("x2", (n) => n.x).attr("y1", (n) => n.y).attr("y2", (n) => n.y)
        .attr("stroke-width", 1.2).attr("stroke-dasharray", "3 3").attr("stroke", (n) => col(n.family));
      const fpill = svg.append("g").selectAll("g").data(famRoots).join("g").attr("class", "jd-tree-fpill");
      fpill.append("text").attr("y", (n) => n.y).attr("dy", "0.35em").attr("x", 15)
        .attr("fill", (n) => this.fam.get(n.family).tag_text)
        .text((n) => pillLabel(this.fam.get(n.family).name).toUpperCase());
      fpill.insert("rect", "text").attr("fill", (n) => this.fam.get(n.family).tag_tint).each(function () {
        const b = this.nextSibling.getBBox();
        d3.select(this).attr("x", b.x - 7).attr("y", b.y - 3).attr("width", b.width + 14).attr("height", b.height + 6).attr("rx", (b.height + 6) / 2);
      });
      svg.append("g").selectAll("text").data(rows).join("text")
        .attr("x", (r) => r.kind === "job" ? labelX : flavourX).attr("y", (r) => r.y).attr("dy", "0.35em")
        .attr("class", "jd-node-label")
        // in the family's tag text colour: the chart colours are too light for text on white
        .style("fill", (r) => famOf(r.j).tag_text)
        .style("font-size", (r) => r.kind === "job" ? "13px" : "12px").style("font-weight", (r) => r.kind === "job" ? 600 : 400)
        .text((r) => r.kind === "job" ? `${r.j.name}  ${fmt(r.j.n_postings)}` : `${r.f.is_residual ? "General" : r.f.short_name}  ${fmt(r.f.n_postings)}`);
      centreDrawing(svg, w);
    }


    // ---------- the active family, above the job-type picker: an alice-blue band with
    // the family's full name, its description (2/3 of the width) and, in the last
    // third, a thumbnail of its job-flavours Sankey (the same chart as in the
    // profile's "Job flavours"; empty when no job type in the family splits into
    // flavours). The thumbnail opens a window with the full-size chart, drawn
    // still: no hover, no clicks, nothing selected.
    renderFamilyBand(r) {
      const box = el("div", { class: "jd-famband", role: "region", "aria-label": "The selected job family" });
      r.appendChild(box);
      const dlg = el("dialog", { class: "jd-modal jd-modal--wide", "aria-labelledby": "jd-fam-modal-h" });
      dlg.innerHTML = `<div class="jd-modal-inner">
          <div class="jd-modal-head">
            <h3 id="jd-fam-modal-h"></h3>
            <button type="button" class="jd-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="jd-famsankey-full"></div>
        </div>`;
      this.root.appendChild(dlg);
      dlg.querySelector(".jd-modal-close").addEventListener("click", () => dlg.close());
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
      const EXPAND = `<svg class="jd-famband-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
      // a family's job types that split into flavours, largest first
      const splitOf = (fam) => fam.job_type_ids.map((id) => this.jt.get(id)).filter((j) => j.flavour_ids.length)
        .sort((a, b) => b.n_postings - a.n_postings);
      const fillBand = (fam) => {
        const split = splitOf(fam);
        box.innerHTML = `
          <p class="jd-eyebrow jd-famband-eyebrow">View family details</p>
          <h3 class="jd-famband-name">${esc(fam.name)}</h3>
          <p class="jd-famband-desc">${esc(fam.description)}</p>
          <div class="jd-famband-chart">${split.length ? `
            <button type="button" class="jd-famband-thumb" aria-haspopup="dialog" aria-label="Enlarge the job flavours chart for ${esc(fam.name)}">
              <span class="jd-famband-svg"></span>
              <span class="jd-famband-cap">View family map${EXPAND}</span>
            </button>` : ""}</div>`;
        // the thumbnail shows the family's largest split job type
        if (split.length) this.drawFlavours(box.querySelector(".jd-famband-svg"), split[0], null, fam, { still: true });
        return split;
      };
      const full = dlg.querySelector(".jd-famsankey-full"), inner = dlg.querySelector(".jd-modal-inner");
      const fillDialog = (fam) => {
        const split = splitOf(fam);
        dlg.querySelector("h3").textContent = `Job flavours in ${fam.name}`;
        full.innerHTML = split.map((j) => `<section class="jd-famsankey-sec">
            <p class="jd-modal-sum">The ${fmt(j.n_postings)} job postings for ${esc(j.name)} split by the tools they list. Next to each flavour: the three tools that most set it apart.</p>
            <div class="jd-flavours-chart jd-scroll"></div></section>`).join("");
        full.querySelectorAll(".jd-flavours-chart").forEach((c, i) => this.drawFlavours(c, split[i], null, fam, { still: true }));
      };
      // the band and the window keep one height for every family: the tallest
      // family's, measured by filling each in turn (redone on every redraw, since
      // the heights follow the page width)
      const tallest = (fill, node, fams) => Math.max(0, ...fams.map((f) => { fill(f); return node.scrollHeight; }));
      box.style.minHeight = `${tallest(fillBand, box, this.d.families)}px`;
      let dialogHeight = null;   // measured on first open: the window must be open to lay out
      let shown = null;
      this.onSelect(({ family }) => {
        if (family === shown) return;   // the band only changes with the family
        shown = family;
        const fam = this.fam.get(family);
        if (!fillBand(fam).length) return;
        box.querySelector(".jd-famband-thumb").addEventListener("click", () => {
          dlg.showModal();   // drawn once open, so the labels can be measured
          if (dialogHeight === null) {
            inner.style.minHeight = "";
            dialogHeight = tallest(fillDialog, inner, this.d.families.filter((f) => splitOf(f).length));
            // never taller than the window's own height cap (a min-height would win over it)
            inner.style.minHeight = `${Math.min(dialogHeight, window.innerHeight - 64)}px`;
          }
          fillDialog(fam);
        });
      });
    }

    // ---------- the boundary: choose a job type
    renderBar(r) {
      r.appendChild(el("p", { class: "jd-eyebrow jd-bar-eyebrow" }, "Explore job profiles"));
      const bar = el("div", { class: "jd-bar", role: "region", "aria-label": "Choose a job type or job flavour" });
      // each job type, then its flavours indented under it; a flavour's value is "job|flavour"
      const flOpt = (j, k) => `<option value="${j.id}|${k.id}">\u00a0\u00a0\u00a0\u2014 ${esc(k.is_residual ? "General" : k.short_name)} (${k.n_postings})</option>`;
      const opts = this.d.families.map((f) => `<optgroup label="${esc(f.name)}">${
        f.job_type_ids.map((id) => { const j = this.jt.get(id);
          return `<option value="${id}">${esc(j.name)} (${j.n_postings})</option>${j.flavour_ids.map((fid) => flOpt(j, this.fl.get(fid))).join("")}`; }).join("")}</optgroup>`).join("");
      bar.innerHTML = `<label for="jd-pick">Show</label>
        <select id="jd-pick" class="jd-select">${opts}</select>`;
      r.appendChild(bar);
      const sel = bar.querySelector("select");
      sel.addEventListener("change", () => { const [jid, fid] = sel.value.split("|"); this.select(jid, fid || null); });
      this.onSelect(({ jobType, flavour }) => { sel.value = flavour ? `${jobType}|${flavour}` : jobType; });
    }

    // ---------- the profile card
    renderCard(r) {
      const card = el("div", { class: "jd-card", "aria-live": "polite" });
      card.style.marginTop = "var(--jd-s3)";
      r.appendChild(card);
      // the window "Show more" opens: the full top-employers list (filled on open)
      this.empDialog = el("dialog", { class: "jd-modal", "aria-labelledby": "jd-emp-modal-h" });
      this.empDialog.innerHTML = `<div class="jd-modal-inner">
          <div class="jd-modal-head">
            <h3 id="jd-emp-modal-h"></h3>
            <button type="button" class="jd-modal-close" aria-label="Close">&times;</button>
          </div>
          <p class="jd-modal-sum">The employers with the most job postings, and their number of postings.</p>
          <div class="jd-employers jd-employers--all"><ol></ol></div>
        </div>`;
      this.root.appendChild(this.empDialog);
      this.empDialog.querySelector(".jd-modal-close").addEventListener("click", () => this.empDialog.close());
      this.empDialog.addEventListener("click", (e) => { if (e.target === this.empDialog) this.empDialog.close(); });
      this.onSelect((st) => this.drawCard(card, st));
    }
    drawCard(card, { jobType, flavour }) {
      const factRow = (icon, label, value) => `<li class="jd-fact"><span class="jd-fact-icon">${ICONS[icon]}</span>
          <div><p class="jd-fact-label">${label}</p><div class="jd-fact-value">${value}</div></div></li>`;
      const j = this.jt.get(jobType), f = flavour ? this.fl.get(flavour) : null;
      const group = f || j;
      const topSen = j.seniority.filter((s) => s.level !== "unspecified").slice(0, 2);
      const topEmp = j.employer_types.filter((s) => s.type !== "unspecified").slice(0, 2);
      // top employers: the first N_EMP_PILLS as pills, the full list in a window
      const emps = group.top_employers || [];
      // each pill in its own list item; `tail` goes in the last item, after its pill,
      // so "Show more" never wraps onto a line of its own
      const empPills = (list, tail = "") => list.map((e, i) => `<li><span class="jd-emp-pill"><b>${esc(e.name)}</b><span>${e.n}</span></span>${
        i === list.length - 1 ? tail : ""}</li>`).join("");
      card.style.setProperty("--fam", ORCHID);   // the active selection is royal orchid
      card.innerHTML = `
        <div class="jd-card-head">
          <div>
            <div class="jd-card-title"><h3>${esc(j.name)}</h3>
            ${f ? `<p class="jd-card-sub">${esc(f.is_residual ? "General" : f.short_name)}</p>` : ""}</div>
            <p class="jd-card-desc">${esc(group.description || j.description)}</p>
            ${emps.length ? `<div class="jd-employers"><h4>Top employers</h4><ol>${empPills(emps.slice(0, N_EMP_PILLS),
              emps.length > N_EMP_PILLS ? `<button type="button" class="jd-howto jd-emp-more" aria-haspopup="dialog">Show more</button>` : "")}</ol></div>` : ""}
          </div>
          <ul class="jd-facts-card" aria-label="Seniority, sectors and common titles">
            ${factRow("seniority", "Seniority", `Mostly ${topSen.map((s) => esc(s.level)).join(" and ")}`)}
            ${factRow("sector", "Sectors", topEmp.map((s) => esc(humanize(s.type))).join(", "))}
            ${factRow("title", "Common titles", `<ul class="jd-fact-titles">${j.top_titles.slice(0, 3).map((t) => `<li>${esc(t.title[0].toUpperCase() + t.title.slice(1))}</li>`).join("")}</ul>`)}
          </ul>
        </div>
        <div class="jd-cols">${["duties", "skills", "tools"].map((k) => this.cardColumn(k, group.card[k])).join("")}</div>
        <div class="jd-key"><span><i class="k-bar"></i>Share of these job postings</span><span><i class="k-tick"></i>Share of all job postings</span></div>`;
      const more = card.querySelector(".jd-emp-more");
      if (more) more.addEventListener("click", () => {
        const dlg = this.empDialog;
        dlg.querySelector("h3").textContent = `Top employers: ${f ? `${j.name} · ${f.is_residual ? "General" : f.short_name}` : j.name}`;
        dlg.querySelector("ol").innerHTML = empPills(emps);
        dlg.showModal();
      });
    }
    // ---------- job flavours: the job type on the left, its flavours on the right
    // still: a picture only (the family band's thumbnail and its window) - no
    // hover, no clicks, no keyboard stops
    drawFlavours(box, j, f, fam, { still = false } = {}) {
      const kids = j.flavour_ids.map((id) => this.fl.get(id));
      // bars stay proportional to ads; the gaps between them are wide enough that
      // even the smallest flavour has room for its two-line label
      // drawn at the width of the three cards below: the job's name on the left of
      // its bar, the flavours and their tools on the right
      const top = 8, w = 1100, pad = 30, perAd = 1.6;
      const total = d3.sum(kids, (k) => k.n_postings);
      const h = top * 2 + (kids.length - 1) * pad + Math.max(total * perAd, kids.length * 12);
      const leftX = 250, rightX = leftX + 220, labelX = rightX + 22;
      const sk = d3.sankey().nodeId((n) => n.key).nodeWidth(10).nodePadding(pad).nodeSort(null)
        .extent([[leftX, top], [rightX + 10, h - top]]);
      const g = sk({
        nodes: [{ key: j.id, kind: "job" }, ...kids.map((k) => ({ key: k.id, kind: "flavour", k }))],
        links: kids.map((k) => ({ source: j.id, target: k.id, value: k.n_postings, k })),
      });
      const svg = d3.select(box).append("svg").attr("viewBox", [0, 0, w, h])
        .attr("aria-label", `${j.name} split into ${kids.length} job flavours`);
      const isOn = (k) => f && f.id === k.id;
      if (still) svg.attr("role", "img").attr("class", "jd-still");
      const links = svg.append("g").selectAll("path").data(g.links).join("path")
        .attr("class", "jd-link").attr("d", d3.sankeyLinkHorizontal())
        .attr("stroke-width", (l) => Math.max(1, l.width))
        .attr("stroke", (l) => !f || isOn(l.k) ? ORCHID : ALICE)
        .attr("stroke-opacity", (l) => isOn(l.k) ? 0.75 : f ? 0.9 : 0.3);
      const nodes = svg.append("g").selectAll("g").data(g.nodes).join("g").attr("class", "jd-fnode");
      if (!still) {
        links.on("click", (e, l) => this.select(j.id, l.k.id));
        nodes.attr("tabindex", 0).attr("role", "button")
          .attr("aria-pressed", (n) => n.kind === "job" ? String(!f) : String(isOn(n.k)))
          .attr("aria-label", (n) => n.kind === "job" ? `All ${j.n_postings} job postings for ${j.name}` : `${n.k.short_name}, ${n.k.n_postings} job postings`)
          .on("click", (e, n) => this.select(j.id, n.kind === "job" ? null : n.k.id))
          .on("mouseenter", (e, n) => this.hover(n.kind === "job" ? { kind: "job", id: j.id } : { kind: "flavour", id: n.k.id }))
          .on("mouseleave", () => this.hover(null))
          .on("keydown", (e, n) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.select(j.id, n.kind === "job" ? null : n.k.id); } });
      }
      nodes.append("rect").attr("x", (n) => n.x0).attr("y", (n) => n.y0).attr("width", (n) => n.x1 - n.x0)
        .attr("height", (n) => Math.max(2, n.y1 - n.y0)).attr("rx", 2)
        .attr("fill", (n) => n.kind === "job" ? (f ? ALICE : ORCHID) : isOn(n.k) ? ORCHID : f ? ALICE : orchidStep(0.45));
      // the job's name to the left of its bar, wrapped to fit, with its number of ads
      const job = g.nodes[0];
      const lines = wrapWords(j.name, 26);
      const jl = nodes.filter((n) => n.kind === "job").append("text").attr("text-anchor", "end")
        .attr("x", job.x0 - 12).attr("y", (job.y0 + job.y1) / 2 - (lines.length * 17) / 2 + 4);
      lines.forEach((ln, i) => jl.append("tspan").attr("class", "jd-flabel").style("font-weight", 700)
        .attr("x", job.x0 - 12).attr("dy", i ? "1.3em" : 0).text(ln));
      jl.append("tspan").attr("class", "jd-flabel-sub").attr("x", job.x0 - 12).attr("dy", "1.4em").text(`All ${fmt(j.n_postings)} postings`);
      const lab = nodes.filter((n) => n.kind === "flavour").append("text")
        .attr("x", labelX).attr("y", (n) => (n.y0 + n.y1) / 2);
      lab.append("tspan").attr("class", "jd-flabel").attr("dy", "-0.25em")
        .style("font-weight", (n) => isOn(n.k) ? 700 : 600)
        .text((n) => `${n.k.short_name} `);
      lab.append("tspan").attr("class", "jd-flabel-sub").text((n) => `${fmt(n.k.n_postings)} postings`);
      lab.append("tspan").attr("class", "jd-flabel-tools").attr("x", labelX).attr("dy", "1.35em")
        .text((n) => n.k.is_residual ? "No specific tools associated"
          : n.k.enriched_tools.length ? n.k.enriched_tools.slice(0, 3).map((t) => t.label).join(" · ")
          : "No single tool sets it apart");
      centreDrawing(svg, w);
    }

    cardColumn(key, rows) {
      const title = { duties: "Duties", skills: "Skills", tools: "Tools" }[key];
      if (!rows || !rows.length) return `<div class="jd-col"><h4>${title}</h4><p class="jd-empty">These job postings list no tools.</p></div>`;
      return `<div class="jd-col"><h4>${title}</h4><ol class="jd-rows">${rows.map((r) => {
        // skills and tools: examples of the items behind the category; duties: what the duty covers
        const ex = r.description ? `<div class="jd-row-ex">${esc(r.description)}</div>`
          : r.examples && r.examples.length && !(r.examples.length === 1 && r.examples[0] === r.label)
            ? `<div class="jd-row-ex">e.g. ${r.examples.map(esc).join(" · ")}</div>` : "";
        return `<li class="jd-row ${r.bold ? "is-bold" : ""}">
          <div class="jd-row-top"><span class="jd-row-label">${esc(r.label)}</span><span class="jd-row-pct">${pct(r.pct)}</span></div>
          <div class="jd-track" aria-hidden="true">
            <span class="jd-track-bar" style="width:${r.pct}%"></span>
            <span class="jd-track-all" style="left:${r.pct_all}%"></span>
          </div>
          <span class="jd-visually-hidden">${pct(r.pct)} of these job postings, ${pct(r.pct_all)} of all job postings.</span>
          ${ex}</li>`;
      }).join("")}</ol></div>`;
    }
  }

  // ---------------------------------------------------------------- boot
  async function mount(root) {
    root.innerHTML = `<p class="jd-status">Loading the job landscape…</p>`;
    try {
      if (!window.d3 || !d3.sankey) throw new Error("the D3 and d3-sankey scripts didn't load");
      const res = await fetch(root.dataset.src);
      if (!res.ok) throw new Error(`the data file returned ${res.status}`);
      const dash = new Dashboard(root, await res.json());
      dash.render();
      // full-width bands span 100vw, which includes a classic (non-overlay) scrollbar;
      // --jd-sbw takes its width back off so band content stays centred on the page
      const sbw = () => root.style.setProperty("--jd-sbw", `${window.innerWidth - document.documentElement.clientWidth}px`);
      sbw();
      // the job map's shape follows the page width: redraw when the width changes
      // (not the height, which phones change while scrolling)
      let width = window.innerWidth, timer;
      window.addEventListener("resize", () => {
        sbw();
        clearTimeout(timer);
        timer = setTimeout(() => { if (window.innerWidth !== width) { width = window.innerWidth; dash.render(); } }, 200);
      });
    } catch (err) {
      root.innerHTML = `<p class="jd-status">The job landscape can't be shown: ${esc(err.message)}. Reload the page to try again.</p>`;
    }
  }
  const start = () => document.querySelectorAll(".jd[data-src]").forEach(mount);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
