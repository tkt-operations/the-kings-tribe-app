// Builds the training booklet from content.mjs:
//   docs/training/USER-GUIDE.md
//   docs/training/booklet/booklet.html (+ booklet.css)
//   docs/training/booklet/The-Kings-Tribe-Operations-Training-Guide-DRAFT.pdf
// Usage: node docs/training/booklet/build.mjs   (needs Playwright + Chromium; set
// PLAYWRIGHT_MODULE to a playwright install and CHROME to a Chromium binary if they
// are not on the default paths). Fonts and logos are referenced from the repository,
// not copied.
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { META, SECTIONS } from "./content.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRAINING = path.resolve(HERE, "..");
const REPO = path.resolve(TRAINING, "../..");
const PDF = path.join(HERE, "The-Kings-Tribe-Operations-Training-Guide-DRAFT.pdf");

// ---------------------------------------------------------------- pages
const pages = [{ type: "cover" }, { type: "toc" }];
for (const s of SECTIONS) {
  s.pages.forEach((p, i) => pages.push({ ...p, section: s, first: i === 0 }));
}
pages.forEach((p, i) => { p.no = i + 1; });
const sectionStart = Object.fromEntries(SECTIONS.map((s) => [s.n, pages.find((p) => p.section === s).no]));

// ---------------------------------------------------------------- HTML
const strip = (s) => String(s).replace(/<[^>]+>/g, "");
const rel = (p) => path.posix.join("..", p); // booklet/ → training/
function fig(f, extra = "") {
  return `<figure class="fig ${f.kind} ${extra}"><div class="imgbox"><img src="${rel(f.src)}" alt="${strip(f.caption)}">
  <figcaption><span class="tag ${f.label.startsWith("Training") ? "ill" : f.label.startsWith("Real") ? "real" : f.label.startsWith("Rendered") ? "email" : ""}">${f.label}</span><b>${f.id}</b> · ${f.caption}</figcaption></div></figure>`;
}
function figures(p) {
  const f = p.figs ?? [];
  if (p.layout === "desktop+mobile") return `<div class="figs row dm">${fig(f[0])}${fig(f[1])}</div>`;
  if (p.layout === "two-desktop") return `<div class="figs stack">${f.map((x) => fig(x)).join("")}</div>`;
  if (p.layout === "two-email") return `<div class="figs row ee">${f.map((x) => fig(x)).join("")}</div>`;
  return `<div class="figs single">${f.map((x) => fig(x)).join("")}</div>`;
}
const opener = (p) => p.first ? `<div class="opener"><span class="num">${p.section.n}</span><h1 id="s${p.section.n}">${p.section.title}</h1></div>${p.section.intro ? `<p class="intro">${p.section.intro}</p>` : ""}` : "";
function workflow(p) {
  const steps = `<ol class="steps">${p.steps.map((s) => `<li>${s}</li>`).join("")}</ol>`;
  const facts = `<div class="facts"><div><h4>What this does</h4><p>${p.what}</p></div><div><h4>Who can do it</h4><p>${p.who}</p></div></div>`;
  const side = `<div class="next"><h4>What happens next</h4><p>${p.next}</p></div>${p.notes?.length ? `<div class="notes"><h4>Important notes</h4><ul>${p.notes.map((n) => `<li>${n}</li>`).join("")}</ul></div>` : ""}`;
  if (p.layout === "mobile") {
    return `${opener(p)}<h2>${p.title}</h2><div class="mobilelayout"><div class="col">${facts}<h4 class="sh">Step-by-step</h4>${steps}${side}</div>${fig(p.figs[0], "tall")}</div>`;
  }
  return `${opener(p)}<h2>${p.title}</h2>${facts}<div class="cols"><div><h4 class="sh">Step-by-step</h4>${steps}</div><div>${side}</div></div>${figures(p)}`;
}
function blocks(list) {
  return list.map((b) => {
    if (b.p) return `<p>${b.p}</p>`;
    if (b.h) return `<h3>${b.h}</h3>`;
    if (b.list) return `<ul class="bul">${b.list.map((x) => `<li>${x}</li>`).join("")}</ul>`;
    if (b.callout) return `<div class="callout ${b.callout}"><span>${b.callout.toUpperCase()}</span><p>${b.text}</p></div>`;
    if (b.table) return `<table class="tbl"><thead><tr>${b.table.head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${b.table.rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="k"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    if (b.matrix) return `<table class="tbl matrix"><thead><tr>${b.matrix.head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${b.matrix.rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="k"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    if (b.faq) return `<dl class="faq">${b.faq.map(([q, a]) => `<dt>${q}</dt><dd>${a}</dd>`).join("")}</dl>`;
    if (b.support) return `<div class="support">${b.support}</div>`;
    return "";
  }).join("");
}
function pageHtml(p) {
  if (p.type === "cover") {
    return `<section class="page cover" id="p1"><div class="cv">
      <img class="cvlogo" src="${rel("../../public/brand/logo-primary-gold-on-navy.svg")}" alt="The Kings Tribe">
      <p class="cvorg">${META.org}</p><p class="cvprod">${META.product}</p><p class="cvtitle">${META.title}</p>
      <p class="cvmeta">${META.version} · ${META.date}</p><p class="cvchip">Training environment · fictional data</p></div>
      <p class="cvfoot">DRAFT — for review. Not for distribution.</p></section>`;
  }
  if (p.type === "toc") {
    const rows = [["1", "Cover", 1], ...SECTIONS.map((s) => [String(s.n), s.title, sectionStart[s.n]])];
    return `<section class="page" id="p${p.no}"><div class="content"><div class="opener"><h1>Contents</h1></div>
      <ol class="toc">${rows.map(([n, t, pg]) => `<li><a href="#p${pg}"><span class="n">${n}</span><span class="t">${t}</span><span class="dots"></span><span class="pg">${pg}</span></a></li>`).join("")}</ol></div>${footer(p)}</section>`;
  }
  const body = p.type === "workflow" ? workflow(p) : `${opener(p)}${blocks(p.blocks)}`;
  return `<section class="page" id="p${p.no}"><header class="hd"><span>${p.section.n} · ${p.section.title}</span><img src="${rel("../../public/brand/logo-landscape-navy.svg")}" alt=""></header>
    <div class="content ${p.type}">${body}</div>${footer(p)}</section>`;
}
const footer = (p) => `<footer class="ft"><span>The Kings Tribe · Operations Platform · Training & Onboarding Guide · ${META.version}</span><span class="pgno">${p.no}</span></footer>`;

const CSS = readFileSync(path.join(HERE, "booklet.css"), "utf8").replaceAll("{{FONTS}}", rel("../../assets/fonts"));
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The Kings Tribe — Operations Platform Training & Onboarding Guide (DRAFT)</title><style>${CSS}</style></head><body>${pages.map(pageHtml).join("\n")}</body></html>`;
writeFileSync(path.join(HERE, "booklet.html"), html);

// ---------------------------------------------------------------- Markdown
const md = [];
md.push(`# ${META.org} — ${META.product}`, `## ${META.title}`, "", `*${META.version} · ${META.date} · Training environment, fictional data. DRAFT — for review.*`, "", "## Contents", "");
for (const s of SECTIONS) md.push(`${s.n}. [${s.title}](#${s.n}-${s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")})`);
md.push("");
const mdText = (s) => String(s).replace(/<b>(.*?)<\/b>/g, "**$1**").replace(/<[^>]+>/g, "");
for (const s of SECTIONS) {
  md.push(`## ${s.n}. ${s.title}`, "");
  if (s.intro) md.push(mdText(s.intro), "");
  for (const p of s.pages) {
    if (p.type === "workflow") {
      md.push(`### ${mdText(p.title)}`, "", `**What this does:** ${mdText(p.what)}`, "", `**Who can do it:** ${mdText(p.who)}`, "", "**Step-by-step**", "");
      p.steps.forEach((x, i) => md.push(`${i + 1}. ${mdText(x)}`));
      md.push("", `**What happens next:** ${mdText(p.next)}`, "");
      if (p.notes?.length) { md.push("**Important notes**", ""); p.notes.forEach((n) => md.push(`- ${mdText(n)}`)); md.push(""); }
      for (const f of p.figs ?? []) md.push(`![${f.id} · ${mdText(f.caption)}](${f.src})`, `*${f.label} — ${f.id} · ${mdText(f.caption)}*`, "");
    } else {
      for (const b of p.blocks) {
        if (b.p) md.push(mdText(b.p), "");
        if (b.h) md.push(`### ${b.h}`, "");
        if (b.list) { b.list.forEach((x) => md.push(`- ${mdText(x)}`)); md.push(""); }
        if (b.callout) md.push(`> **${b.callout.toUpperCase()}:** ${mdText(b.text)}`, "");
        if (b.table || b.matrix) {
          const t = b.table ?? b.matrix;
          md.push(`| ${t.head.join(" | ")} |`, `| ${t.head.map(() => "---").join(" | ")} |`);
          t.rows.forEach((r) => md.push(`| ${r.map((c) => mdText(c) || " ").join(" | ")} |`));
          md.push("");
        }
        if (b.faq) b.faq.forEach(([q, a]) => md.push(`**${mdText(q)}**`, "", mdText(a), ""));
        if (b.support) md.push(`**${b.support}**`, "");
      }
    }
  }
}
writeFileSync(path.join(TRAINING, "USER-GUIDE.md"), md.join("\n"));

// ---------------------------------------------------------------- PDF + checks
const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : await import("playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
await page.goto(`file://${path.join(HERE, "booklet.html")}`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
const report = await page.evaluate(() => {
  const out = { pages: document.querySelectorAll(".page").length, overflow: [], images: 0, broken: [], distorted: [], small: [] };
  document.querySelectorAll(".page").forEach((pg) => {
    const c = pg.querySelector(".content");
    if (c && (c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1)) out.overflow.push(`${pg.id} (+${c.scrollHeight - c.clientHeight}px)`);
  });
  document.querySelectorAll("img").forEach((img) => {
    if (!img.closest(".fig")) return;
    out.images++;
    if (!img.complete || img.naturalWidth === 0) { out.broken.push(img.getAttribute("src")); return; }
    const r = img.getBoundingClientRect();
    const natural = img.naturalWidth / img.naturalHeight, shown = r.width / r.height;
    if (Math.abs(natural - shown) / natural > 0.01) out.distorted.push(img.getAttribute("src"));
    if (r.width < 120) out.small.push(`${img.getAttribute("src")} ${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  return out;
});
await page.pdf({ path: PDF, width: "8.5in", height: "11in", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: false });
await browser.close();
const figs = SECTIONS.flatMap((s) => s.pages.flatMap((p) => p.figs ?? []));
const missing = figs.filter((f) => !existsSync(path.join(TRAINING, f.src))).map((f) => f.src);
console.log(JSON.stringify({ pdf: path.relative(REPO, PDF), ...report, figures: figs.length, uniqueImages: new Set(figs.map((f) => f.src)).size, ids: [...new Set(figs.map((f) => f.id))].sort().join(" "), missing, sectionStart }, null, 1));
