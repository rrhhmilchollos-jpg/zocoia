#!/usr/bin/env node
/**
 * Auditoría SEO + GEO — Zoco IA
 * ================================
 * Script de SOLO LECTURA. No modifica nada en ninguno de los 3 dominios.
 * Comprueba lo básico e imprescindible antes de plantearse aplicar fixes
 * automáticos o generar contenido.
 *
 * Uso:
 *   node seo-geo-audit.js
 *
 * Ejecútalo desde el servidor de Coolify (o cualquier máquina con salida
 * a internet) — no depende de nada del proyecto, solo de Node.js nativo.
 */

const DOMAINS = [
  "https://www.marisai.es",
  "https://zocoia.es",
  "https://creatuwebyappgratis.com",
];

const CHECKS = [
  { path: "/robots.txt", label: "robots.txt" },
  { path: "/sitemap.xml", label: "sitemap.xml" },
  { path: "/llms.txt", label: "llms.txt (GEO)" },
  { path: "/llms-full.txt", label: "llms-full.txt (GEO)" },
  { path: "/", label: "Página de inicio" },
];

async function fetchWithTiming(url) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "ZocoIA-SEO-Audit/1.0" },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, ms: Date.now() - start, text, headers: res.headers };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - start, text: "", error: String(err.message || err) };
  }
}

function checkHomepage(html, url) {
  const issues = [];
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  const desc = /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(html)?.[1]?.trim();
  const canonical = /<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i.exec(html)?.[1];
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  const hasJsonLd = /<script[^>]+application\/ld\+json/i.test(html);
  const hasOgTags = /<meta\s+property=["']og:/i.test(html);
  const hasViewport = /<meta\s+name=["']viewport["']/i.test(html);
  const hasNoindex = /<meta[^>]+noindex/i.test(html);

  if (!title) issues.push("❌ CRÍTICO: no se encontró <title>");
  else if (title.length < 30 || title.length > 65) issues.push(`⚠️  <title> fuera del rango ideal (50-60 car.): ${title.length} caracteres — "${title}"`);

  if (!desc) issues.push("❌ CRÍTICO: no hay <meta name=\"description\">");
  else if (desc.length < 110 || desc.length > 170) issues.push(`⚠️  meta description fuera del rango ideal (150-160 car.): ${desc.length} caracteres`);

  if (!canonical) issues.push("⚠️  Falta <link rel=\"canonical\">");
  if (h1Count === 0) issues.push("❌ CRÍTICO: no hay ningún <h1>");
  if (h1Count > 1) issues.push(`⚠️  Hay ${h1Count} etiquetas <h1> (debería haber solo 1)`);
  if (!hasJsonLd) issues.push("⚠️  No se detectó JSON-LD (schema.org) — importante para GEO y rich snippets");
  if (!hasOgTags) issues.push("⚠️  Faltan Open Graph tags (og:title, og:description, og:image) — afecta a compartir en redes");
  if (!hasViewport) issues.push("❌ CRÍTICO: falta <meta name=\"viewport\"> (mobile-friendliness)");
  if (hasNoindex) issues.push("❌❌ CRÍTICO GRAVE: la página tiene noindex — Google NO la indexará");

  return { title, desc, canonical, h1Count, hasJsonLd, hasOgTags, issues };
}

async function auditDomain(domain) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`🔎 AUDITANDO: ${domain}`);
  console.log("=".repeat(70));

  for (const check of CHECKS) {
    const url = domain + check.path;
    const result = await fetchWithTiming(url);

    if (result.error) {
      console.log(`  ❌ ${check.label.padEnd(22)} → ERROR DE RED: ${result.error}`);
      continue;
    }

    const statusIcon = result.ok ? "✅" : "❌";
    console.log(`  ${statusIcon} ${check.label.padEnd(22)} → HTTP ${result.status} (${result.ms}ms)`);

    if (check.path === "/" && result.ok) {
      const analysis = checkHomepage(result.text, url);
      console.log(`     title: "${analysis.title || "(ninguno)"}"`);
      console.log(`     description: "${(analysis.desc || "(ninguna)").slice(0, 80)}${analysis.desc && analysis.desc.length > 80 ? "..." : ""}"`);
      if (analysis.issues.length === 0) {
        console.log("     ✅ Sin problemas on-page detectados");
      } else {
        for (const issue of analysis.issues) console.log(`     ${issue}`);
      }
    }

    if (check.path === "/sitemap.xml" && result.ok) {
      const urlCount = (result.text.match(/<loc>/g) || []).length;
      console.log(`     → ${urlCount} URL(s) listadas en el sitemap`);
      if (urlCount === 0) console.log("     ⚠️  El sitemap existe pero está vacío o no es XML válido");
    }

    if (check.path === "/robots.txt" && result.ok) {
      const hasSitemapRef = /sitemap:/i.test(result.text);
      const hasDisallowAll = /disallow:\s*\/\s*$/im.test(result.text);
      if (!hasSitemapRef) console.log("     ⚠️  robots.txt no referencia el sitemap.xml");
      if (hasDisallowAll) console.log("     ❌❌ CRÍTICO GRAVE: robots.txt bloquea TODO el rastreo (Disallow: /)");
    }
  }
}

(async () => {
  console.log("Auditoría SEO + GEO — Zoco IA / Maris AI / creatuwebyappgratis.com");
  console.log(`Fecha: ${new Date().toISOString()}\n`);
  for (const domain of DOMAINS) {
    await auditDomain(domain);
  }
  console.log(`\n${"=".repeat(70)}`);
  console.log("Auditoría completa. Esto es un diagnóstico de solo lectura —");
  console.log("nada se ha modificado. Revisa este resultado manualmente para");
  console.log("decidir qué fixes aplicar primero.");
  console.log("=".repeat(70));
})();
